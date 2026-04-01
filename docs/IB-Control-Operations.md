# IB Control Operations

Practical guide for starting, stopping, and controlling the live trading system day-to-day.

---

## Daily Startup Procedure

### Before the market opens (by 09:00 ET)

**Step 1 — Start IB Gateway**

1. Open IB Gateway (not TWS)
2. Log in with your IBKR credentials
3. Confirm port shows **4002** (paper) or **4001** (live) in the title bar
4. Leave it running — do not close the window

**Step 2 — Verify data is current**

```bash
cd E:\Trading\tqqq-dev

# Check last bar in TQQQ_1h (must be from yesterday or today)
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
row = conn.execute('SELECT MAX(timestamp) FROM TQQQ_1h').fetchone()
print('Last hourly bar:', row[0])
conn.close()
"
```

If the last hourly bar is more than 72 hours old:
```bash
# Sync hourly data (requires IB Gateway running)
python -c "
from engine.config import load_config
from live.data import sync_hourly_db
from live.broker import connect_ibkr  # or use connect_ibkr
config = load_config()
# ib = connect(config)
# sync_hourly_db(ib, config, 'trading.db')
print('Run sync_hourly_db() with connected IB instance')
"
```

**Step 3 — Run readiness check**

```bash
python -c "
from engine.config import load_config
from live.validate import run_readiness_check
config = load_config()
result = run_readiness_check(config, 'trading.db')
print('Ready:', result)
"
```

All 5 checks must show PASS:
```
[CHECK 1] IB Gateway reachable...
  PASS  IB Gateway is reachable

[CHECK 2] Config valid...
  PASS  Config valid

[CHECK 3] DB writable...
  PASS  DB writable (trading.db)

[CHECK 4] Hourly data fresh...
  PASS  Hourly data is current

[CHECK 5] Mode confirmation...
  PASS  Paper mode confirmed — safe to start

All checks passed — ready to start.
```

**Step 4 — Start the trading loop**

```bash
# From the project root
cd E:\Trading\tqqq-dev
python -m live.main
```

Or via the scheduled task / startup script if configured.

The system logs startup to `logs/live_main.log` and writes a session row to `config_log_live`. The `[CHECK N]` results are printed to terminal.

---

## Resolving Readiness Check Failures

### CHECK 1 FAIL — IB Gateway not reachable

```
FAIL  IB Gateway not running on port 4002 — start IB Gateway first
```

**Cause:** IB Gateway is not running, or is running on a different port.

**Fix:**
1. Open IB Gateway and log in
2. Verify the port in IB Gateway settings: Configure → API → Settings → Socket Port = 4002
3. Re-run readiness check

### CHECK 2 FAIL — Config invalid

```
FAIL  mode=paper requires port 4002 (Gateway), got port=7497
```

**Fix:** Edit `config.yaml`:
```yaml
live:
  mode: paper
  ibkr_port: 4002   # ← Gateway paper port
```

### CHECK 3 FAIL — DB not writable

```
FAIL  DB not writable at 'trading.db': unable to open database file
```

**Cause:** File path wrong, disk full, or file locked by another process.

**Fix:**
```bash
# Check if another process has the DB locked
lsof trading.db  # macOS/Linux
# Windows: check Task Manager for python processes

# Verify path
ls -la trading.db

# Re-create if missing
python -c "from backtest.recorder import init_db; init_db('trading.db')"
```

### CHECK 4 FAIL — Hourly data stale

```
FAIL  Hourly data stale (last bar: 2026-03-25 16:00:00) — run sync_hourly_db() first
```

**Fix:**
```python
# With IB Gateway running:
from engine.config import load_config
from live.broker import connect
from live.data import sync_hourly_db

config = load_config()
ib = connect(config)
sync_hourly_db(ib, config, 'trading.db')
ib.disconnect()
```

### CHECK 5 FAIL — Live mode not confirmed

```
FAIL  Live trading not confirmed — aborting
```

You did not type the confirmation string exactly. Re-run the system and type:
```
I CONFIRM LIVE TRADING
```
(case-sensitive, including spaces)

---

## Safe Shutdown (Planned)

Press **Ctrl+C** in the terminal running `live.main`:

```
^C
[INFO] market_close — Session ended — safe shutdown initiated
Safe shutdown complete.
```

What happens:
1. All pending limit orders are cancelled on IBKR
2. Final position state is logged to `Events_log_live`
3. `config_log_live` row is updated: `status=inactive`, `stopped_at=now`
4. IB Gateway connection is cleanly disconnected

**Note:** Safe shutdown does NOT close open positions. Any held TQQQ position remains in `trades_live` and will be picked up on next session startup via position reconciliation.

---

## Emergency Lock — After Crash

If the system crashed or `emergency_shutdown()` was triggered, a lock file is created:

```
live/emergency.lock
```

**Contents:**
```json
{
  "timestamp": "2026-03-30T14:23:11.432Z",
  "reason": "daily loss 3.2% >= limit 3.0%"
}
```

**The system will NOT restart until this file is deleted.**

**Resolution steps:**
```bash
# 1. Read the lock file to understand why it was created
cat live/emergency.lock

# 2. Log into IBKR to verify actual position state
#    (system may have placed market orders during shutdown)

# 3. Verify trading.db matches actual position
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
rows = conn.execute('SELECT * FROM trades_live WHERE exit_date IS NULL').fetchall()
print('Open trades:', rows)
conn.close()
"

# 4. If satisfied, delete the lock file
rm live/emergency.lock   # or del live\emergency.lock on Windows

# 5. Restart
python -m live.main
```

---

## Operator Commands — `pending.json`

Write a command file to control the running loop without stopping it. The file is consumed (deleted) on the next loop tick (~60 minutes maximum wait, ~2 minutes minimum).

### File location

```
live/commands/pending.json
```

Create this file in the `03-Live/live/commands/` directory. The directory may need to be created:

```bash
mkdir -p 03-Live/live/commands   # macOS/Linux
# mkdir 03-Live\live\commands     # Windows
```

### Available commands

**PAUSE — Stop new entries (stops still monitored)**

```json
{"action": "PAUSE"}
```

Effect: Sets `_paused = True` in the main loop. No new BUY/SELL signals will trigger orders. Stop monitoring (`monitor_stops()`) continues — existing positions are still protected.

Use when: You want to suspend new entries temporarily (e.g., before news event, earnings) without stopping the system entirely.

**RESUME — Re-enable entries**

```json
{"action": "RESUME"}
```

Effect: Sets `_paused = False`. Normal operation resumes.

**FORCE_CLOSE — Close all positions immediately**

```json
{"action": "FORCE_CLOSE"}
```

Effect: Places a market order for all held shares immediately on the next loop tick. Logs WARNING event. Does not shut down the system — loop continues, no new entries will be placed until a BUY signal fires.

Use when: You want to exit immediately but keep the system running for monitoring.

**UPDATE_STOP — Tighten the stop manually**

```json
{"action": "UPDATE_STOP", "trade_id": "uuid-here", "new_stop": 42.50}
```

Effect: Updates `stop_price` in `trades_live` for the given `trade_id`. The ratchet invariant (stop only moves in trade's favour) should be respected — do not loosen the stop below the current ratchet level.

To find the `trade_id`:
```bash
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
rows = conn.execute(
    'SELECT trade_id, symbol, entry_price, stop_price FROM trades_live '
    'WHERE exit_date IS NULL'
).fetchall()
for r in rows:
    print(r)
conn.close()
"
```

### Writing a command (examples)

**bash:**
```bash
echo '{"action": "PAUSE"}' > 03-Live/live/commands/pending.json
```

**Python:**
```python
import json
from pathlib import Path

cmd_path = Path("03-Live/live/commands/pending.json")
cmd_path.parent.mkdir(exist_ok=True)
cmd_path.write_text(json.dumps({"action": "FORCE_CLOSE"}))
print("Command queued — will be executed on next tick")
```

**Note:** The file is consumed and deleted immediately on the next loop tick. Do not write a new command until the previous one has been consumed (check `Events_log_live` for the MANUAL_OVERRIDE event).

---

## Monitoring While Running

### Check system health (terminal)

The main loop logs a pulse message every tick:
```
2026-03-30 09:30:15 [INFO] live.main — * Pulse check -- 14:30 UTC -- IB Gateway connected -- session active
2026-03-30 09:30:15 [INFO] live.main — Sleeping 3555s — next bar at 10:30 ET
```

### Check recent events (DB)

```bash
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
rows = conn.execute(
    'SELECT timestamp, level, event_type, details '
    'FROM Events_log_live '
    'ORDER BY timestamp DESC LIMIT 20'
).fetchall()
for r in rows:
    print(r)
conn.close()
"
```

### Check current position

```bash
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
rows = conn.execute(
    'SELECT symbol, entry_date, entry_price, stop_price, shares '
    'FROM trades_live WHERE exit_date IS NULL'
).fetchall()
if rows:
    for r in rows:
        print(f'Open: {r[0]} | Entry: {r[1]} @ \${r[2]:.2f} | Stop: \${r[3]:.2f} | Shares: {r[4]}')
else:
    print('No open positions')
conn.close()
"
```

### Validate live signals match backtest

Run after a few sessions to confirm the live system is generating the same signals as the backtest engine:

```python
from engine.config import load_config
from live.validate import validate_signal_match

config = load_config()
validate_signal_match(config, db_path='trading.db', check_days=5)
```

Output:
```
Date           Backtest         Live      Match
----------------------------------------------------
2026-03-30         HOLD         HOLD         OK
2026-03-29          BUY          BUY         OK
2026-03-28         HOLD         HOLD         OK
2026-03-27         HOLD         HOLD         OK
2026-03-26         SELL         SELL         OK

All signals match — validation passed.
```

Any MISMATCH rows require investigation before continuing to live mode.

---

## Log Files

| File | Content | Max size | Rotation |
|------|---------|----------|----------|
| `logs/live_main.log` | All trading events (DEBUG+) | 3 MB | Renamed to `live_main_YYYYMMDD_HHMM.log` |
| `logs/flask.log` | GUI server log | — | Manual |

**Tail the live log:**
```bash
# macOS/Linux
tail -f logs/live_main.log

# Windows (PowerShell)
Get-Content logs\live_main.log -Wait -Tail 50
```

---

## Switching Paper → Live

Follow this checklist when ready to move from paper to live trading:

```
Prerequisites:
[ ] At least 4 weeks of stable paper trading
[ ] validate_signal_match() returning all OK for last 5 days
[ ] No position mismatches in paper sessions
[ ] emergency.lock has never been triggered unexpectedly
[ ] IBKR live account funded with strategy capital

Config changes (config.yaml):
[ ] live.mode: live
[ ] live.ibkr_port: 4001
[ ] live.dry_run: false
[ ] live.session_capital: <actual capital amount>

.env changes:
[ ] ENV=live
[ ] IB_PORT=4001
[ ] ALLOW_LIVE_PORT=true

Backup first:
[ ] python backup.py pre_live_trading
[ ] Push to momentum_engine_template repo

First live session:
[ ] Run readiness check manually before starting
[ ] Type "I CONFIRM LIVE TRADING" at CHECK 5
[ ] Watch the first signal evaluation closely
[ ] Verify first order fill matches signals_live record
```

---

## Common Operations Quick Reference

| Task | Command / Action |
|------|----------------|
| Start system | `python -m live.main` |
| Stop gracefully | `Ctrl+C` |
| Pause new entries | Write `{"action": "PAUSE"}` to `pending.json` |
| Resume entries | Write `{"action": "RESUME"}` to `pending.json` |
| Force close position | Write `{"action": "FORCE_CLOSE"}` to `pending.json` |
| Clear emergency lock | `rm live/emergency.lock` |
| Check readiness | `run_readiness_check(config, db_path)` |
| Validate signals | `validate_signal_match(config, db_path, check_days=5)` |
| Check open trades | Query `trades_live WHERE exit_date IS NULL` |
| Check recent events | Query `Events_log_live ORDER BY timestamp DESC LIMIT 20` |
| Tail log | `tail -f logs/live_main.log` |

---

## Related Pages

- [IB Gateway Integration](IB-Gateway-Integration.md) — connection architecture and port reference
- [Live Trading Engine](Live-Trading-Engine.md) — main loop, signal evaluation, stop monitoring
- [System Monitoring Guide](System-Monitoring-Guide.md) — circuit breaker, daily loss limit, health
- [Session Log Reference](Session-Log-Reference.md) — all event types and log tables
- [Troubleshooting Playbook](Troubleshooting-Playbook.md) — errors and resolution steps
