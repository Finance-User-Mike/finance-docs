# Troubleshooting Playbook

Diagnosis and resolution steps for every error state the live system can enter.

Source references: [03-Live/live/](../../03-Live/live/), [03-Live/live/validate.py](../../03-Live/live/validate.py), [03-Live/live/main.py](../../03-Live/live/main.py)

---

## Quick Diagnostic Index

| Symptom | Jump to |
|---------|---------|
| System won't start — `emergency.lock` exists | [Emergency Lock Active](#emergency-lock-active) |
| System won't start — "IB Gateway not running" | [Readiness Check 1 Fails](#readiness-check-1--ib-gateway-not-reachable) |
| System won't start — "config validation failed" | [Readiness Check 2 Fails](#readiness-check-2--config-invalid) |
| System won't start — "DB not writable" | [Readiness Check 3 Fails](#readiness-check-3--db-not-writable) |
| System won't start — "hourly data stale" | [Readiness Check 4 Fails](#readiness-check-4--hourly-data-stale) |
| System won't start — "position reconciliation failed" | [Position Mismatch on Startup](#position-mismatch-on-startup) |
| System won't start — "account environment mismatch" | [Account Type Mismatch](#account-type-mismatch) |
| System connected but orders fail | [Safety Check Violations](#safety-check-violations) |
| Stop didn't fire when price dropped | [Stop Not Firing](#stop-not-firing) |
| Entry order timed out | [Order Timeout](#order-timeout) |
| Partial fill — position smaller than expected | [Partial Fill Handling](#partial-fill-handling) |
| Frequent disconnects | [IB Gateway Disconnects](#ib-gateway-disconnects) |
| Circuit breaker fired | [Circuit Breaker Triggered](#circuit-breaker-triggered) |
| Daily loss limit triggered | [Daily Loss Limit Triggered](#daily-loss-limit-triggered) |
| Signal mismatch warning | [Signal Mismatch Warning](#signal-mismatch-warning) |
| GUI shows no data | [GUI Shows No Data](#gui-shows-no-data) |
| `TQQQ_1h` table empty | [Hourly Data Missing](#hourly-data-missing) |
| GUI Live Status shows "Disconnected" | [GUI Live Status Disconnected](#gui-live-status-disconnected) |

---

## Startup Failures

### Emergency Lock Active

**Error:**
```
Emergency lock active — startup aborted
See live/emergency.lock for reason.
```

**Cause:** `emergency_shutdown()` wrote `live/emergency.lock` in a previous session. The system blocks startup until the lock is manually removed to force human review.

**Resolution:**

```bash
# 1. Read the lock file — understand why it fired
cat live/emergency.lock
# {"timestamp": "2026-03-30T14:23:11", "reason": "CIRCUIT BREAKER TRIGGERED — portfolio down 20.1%"}

# 2. Check circuit breaker history
sqlite3 trading.db "
  SELECT timestamp, level, drawdown_pct, message
  FROM circuit_breaker_live
  ORDER BY timestamp DESC
  LIMIT 10;"

# 3. Verify all positions are closed on IBKR
#    Log into IBKR TWS and check the Portfolio tab
#    Also check the DB:
sqlite3 trading.db "SELECT * FROM trades_live WHERE exit_date IS NULL;"
# Should return 0 rows

# 4. If position is still open on IBKR but DB shows closed:
#    Close manually in IBKR TWS, then update DB if needed

# 5. Once satisfied with the situation, remove the lock
rm live/emergency.lock

# 6. Restart
python -m live.main
```

**Important:** Alert state resets on restart — if equity is still at the drawdown level that triggered the CB, new alerts will fire on the first tick. Consider reducing `session_capital` or pausing if CB fires repeatedly.

---

### Readiness Check 1 — IB Gateway Not Reachable

**Error:**
```
[CHECK 1] IB Gateway reachable...
  FAIL  IB Gateway not running on port 4002 — start IB Gateway first
```

**Cause:** TCP socket to `config.live.ibkr_host:ibkr_port` timed out.

**Resolution:**

1. Open IB Gateway (not TWS) — they use different ports:
   - Paper: port 4002
   - Live: port 4001
2. In IB Gateway → Configuration → API → Settings:
   - Enable ActiveX and Socket Clients: ✓
   - Port: must match `IB_PORT` in `.env`
   - Socket port: same value
3. Confirm `.env` matches:
   ```bash
   cat .env
   # IB_PORT=4002   ← paper
   # IB_PORT=4001   ← live
   ```
4. Re-run the readiness check:
   ```bash
   python -m live.main
   ```

**If IB Gateway is running but check still fails:**
- Check Windows Firewall — localhost connections should not be blocked
- Verify IB Gateway is on the correct account type (paper vs live)
- Try `telnet 127.0.0.1 4002` to test the socket directly

---

### Readiness Check 2 — Config Invalid

**Error:**
```
[CHECK 2] Config valid...
  FAIL  ENV=dev but IB_PORT=4001 — live port requires ENV=live
```

**Cause:** `.env` has inconsistent `ENV` and `IB_PORT` values. The config validator enforces:

| ENV | Required IB_PORT |
|-----|-----------------|
| `dev` | `4002` (paper only) |
| `paper` | `4002` |
| `live` | `4001` |

**Resolution:**

```bash
# Check current .env
cat .env

# Paper trading — correct pairing:
ENV=paper
IB_PORT=4002

# Live trading — correct pairing:
ENV=live
IB_PORT=4001

# Dev testing — always paper:
ENV=dev
IB_PORT=4002
```

Also check `ALLOW_LIVE_PORT=false` in `.env` — this blocks `IB_PORT=4001` unless explicitly set to `true`. Never set `ALLOW_LIVE_PORT=true` in dev.

---

### Readiness Check 3 — DB Not Writable

**Error:**
```
[CHECK 3] DB writable...
  FAIL  DB write test failed: database is locked
```

**Cause:** Another process holds a write lock on `trading.db`. Check 3 does a test INSERT + DELETE on `Events_log_live`.

**Resolution:**

```bash
# Find what's holding the lock
lsof trading.db 2>/dev/null || handle trading.db  # Windows

# Common culprits:
# 1. Another python -m live.main process running
ps aux | grep live.main
# Kill it: kill <PID>

# 2. DB Browser for SQLite has the file open
# Close DB Browser or switch it to read-only mode

# 3. Previous crash left a WAL lock
ls trading.db-wal trading.db-shm
# Safe to delete if no process is running:
rm trading.db-wal trading.db-shm
```

---

### Readiness Check 4 — Hourly Data Stale

**Error:**
```
[CHECK 4] Hourly data fresh...
  FAIL  Last hourly bar is 2026-03-28 15:00 — 48 hours old (threshold: 24h)
```

**Cause:** `TQQQ_1h` table has no bars within the last 72 hours (the check uses 72h tolerance to handle weekends). This fires on Monday startup after a long weekend, or if `sync_hourly_db()` has not been run.

**Resolution:**

```bash
# Option 1 — Start the system anyway and let startup sync run
# sync_hourly_db() is called in the main loop before any trading action

# Option 2 — Manual backfill
cd E:\Trading\tqqq-dev\03-Live
python -c "
from engine.config import load_config
from live.data import backfill_hourly_db
import ib_insync as ibi

config = load_config('config.yaml')
ib = ibi.IB()
ib.connect(config.live.ibkr_host, config.live.ibkr_port, clientId=2)
n = backfill_hourly_db(ib, config, days=30)
print(f'Inserted {n} bars')
ib.disconnect()
"

# Verify
sqlite3 trading.db "SELECT MAX(timestamp) FROM TQQQ_1h;"
```

**On weekend startup:** Check 4 will pass if the last bar is within 72 hours. A Friday 15:00 bar is fine for Monday startup. If it fails on Monday, the weekend gap exceeded 72 hours — run the backfill above.

---

### Position Mismatch on Startup

**Error:**
```
CRITICAL position_mismatch: ibkr_shares=1382 db_shares=0
Position reconciliation failed — startup aborted
```

**Cause:** `reconcile_positions()` found that IBKR holds a position in TQQQ that `trades_live` has no record of (or vice versa). The system **never auto-corrects** — it aborts and waits for human decision.

**Resolution steps:**

```bash
# 1. Check what IBKR actually holds
#    Log into IBKR TWS → Portfolio → TQQQ position

# 2. Check what the DB thinks
sqlite3 trading.db "
  SELECT trade_id, entry_date, entry_price, shares, stop_price, exit_date
  FROM trades_live
  ORDER BY entry_date DESC LIMIT 5;"

# 3. Check recent events for context
sqlite3 trading.db "
  SELECT timestamp, level, event_type, details
  FROM Events_log_live
  ORDER BY timestamp DESC LIMIT 20;"
```

**Scenario A — IBKR has position, DB has no open trade:**
The position exists on IBKR from a previous session where the DB write failed. Options:
- **Option 1 (safe):** Close the position manually in IBKR TWS, then restart — DB will show no position, IBKR will match.
- **Option 2 (preserve position):** Manually insert a `trades_live` row for the existing position, then restart.

```sql
INSERT INTO trades_live (
    trade_id, symbol, entry_date, entry_price, shares,
    stop_price, entry_order_id, exit_date, exit_price
) VALUES (
    'manual-YYYYMMDD', 'TQQQ', '2026-03-28', 72.45, 1382,
    69.15, 'manual-entry', NULL, NULL
);
```

**Scenario B — DB has open trade, IBKR has no position:**
The exit was executed on IBKR but the DB wasn't updated. Options:
- Find the actual exit price from IBKR activity log.
- Update `trades_live` to close the trade.

```sql
UPDATE trades_live
SET exit_date='2026-03-30', exit_price=70.25, exit_reason='manual_reconcile',
    pnl_dollar=((70.25 - 72.45) * 1382)
WHERE exit_date IS NULL AND symbol='TQQQ';
```

---

### Account Type Mismatch

**Error:**
```
SAFETY: config says paper trading but connected to LIVE account DU1234567
```

or

```
SAFETY: config says live trading but connected to PAPER account U9876543
```

**Cause:** `validate_account_environment()` checks whether the connected account ID starts with `"DU"` (paper) or `"U"` (live) and rejects a mismatch.

**Resolution:**

1. Confirm which account you intend to use
2. Update `.env` to match:
   ```
   ENV=paper    # for DU accounts
   ENV=live     # for U accounts (real money)
   ```
3. Or connect IB Gateway to the correct account type
4. Restart

---

## Safety Check Violations

### `RuntimeError: Safety violation: mode=paper but ibkr_port=4001`

**Cause:** `_safety_check()` detected that `config.live.mode` and `config.live.ibkr_port` are inconsistent. This fires before every order placement.

| mode | Required port | Error if |
|------|--------------|----------|
| `paper` | `4002` | port is `4001` |
| `live` | `4001` | port is `4002` |

**Resolution:** Fix `.env` — `ENV` and `IB_PORT` must pair correctly. Restart the system.

This is a hard stop by design. No orders can be placed with a mismatched config.

---

## Order Issues

### Order Timeout

**Symptom:** Log shows `order_timeout` event. Position not opened.

**What happened:** The entry limit order was not filled within `fill_timeout_seconds` (default 30s). The system cancelled the order and marked it `expired` in `orders_live`.

**Why it happens:** The limit price (`proxy_close + $0.05`) was too far below the ask at the time of order placement. TQQQ moved up quickly between signal time (15:00 ET) and order placement.

**System response:** `act()` returns `None` — no position is opened. The next day's signal evaluation will place a new entry if conditions still hold.

**Manual check:**
```sql
SELECT order_id, limit_price, status, fill_price, fill_qty, created_at, updated_at
FROM orders_live
WHERE status = 'expired'
ORDER BY created_at DESC LIMIT 5;
```

**If this happens repeatedly:** Consider increasing `fill_timeout_seconds` in `config.yaml`, or accepting that some entries will be missed when momentum is strong.

---

### Partial Fill Handling

**Symptom:** Log shows `partial_fill` event. Position is smaller than expected.

**What happened:** The limit order was partially filled before timing out. The filled portion was kept; the remainder was cancelled.

**System response:** `handle_partial_fill()` writes a `trades_live` row for the actual filled quantity and sets the stop at the correct distance. The system manages the partial position as if it were a full position.

**Manual check:**
```sql
SELECT trade_id, shares, entry_price, stop_price, entry_date
FROM trades_live
WHERE exit_date IS NULL;

SELECT order_id, qty, fill_qty, fill_price, status
FROM orders_live
WHERE status = 'partial'
ORDER BY created_at DESC LIMIT 5;
```

---

### Cancel on Timeout Failed (`cancel_on_timeout`)

**Symptom:** WARNING event `cancel_on_timeout`. Order may still be live on IBKR.

**Action required:**
1. Log into IBKR TWS → Orders → check for open orders on TQQQ
2. Cancel manually if found
3. Check `orders_live.status` for the order — update to `cancelled` if confirmed cancelled:

```sql
UPDATE orders_live
SET status = 'cancelled', updated_at = datetime('now')
WHERE order_id = 'the-order-id-from-log';
```

---

## Stop Issues

### Stop Not Firing

**Symptom:** TQQQ price dropped below `stop_price` but no exit occurred.

**Diagnosis:**

```bash
# Check the last hourly bars seen by the monitor
sqlite3 trading.db "
  SELECT timestamp, open, high, low, close
  FROM TQQQ_1h
  ORDER BY timestamp DESC LIMIT 10;"

# Check the current stop price
sqlite3 trading.db "
  SELECT trade_id, stop_price, entry_price, shares
  FROM trades_live
  WHERE exit_date IS NULL;"
```

**Possible causes:**

| Cause | Check | Fix |
|-------|-------|-----|
| `monitor_stops()` not being called | Check log for `stop_hit` events today | Verify main loop is running |
| Hourly bar not synced — stale data | `MAX(timestamp)` in `TQQQ_1h` | Run `sync_hourly_db()` manually |
| Price dropped intraday but recovered | Hourly bar `low` > stop | Not a bug — stop fires on hourly `low` only |
| System was paused | Check for `command` PAUSE events | Send RESUME command |

**Stop fires on hourly `low`:** The stop monitor checks `TQQQ_1h.low <= stop_price`. If the price dipped below the stop but the hourly bar closed above it, the stop does NOT fire. This is by design — the system uses hourly granularity, not tick-level.

---

## Connection Issues

### IB Gateway Disconnects

**Symptom:** Repeated `disconnected` → `reconnect_attempt` → `reconnect_success` cycles in the log.

**Common causes and fixes:**

| Cause | Fix |
|-------|-----|
| IB Gateway session timeout (24h default) | Gateway → Configuration → API → Misc: set "Auto logoff timer" to 0 (disabled) |
| IB Gateway RAM limit reached | Increase Java heap in IB Gateway config or restart Gateway daily |
| Windows Update / sleep / hibernate | Disable sleep in power settings; set Windows Update to not restart during market hours |
| Network interruption | Check router/switch logs for drops around the disconnect time |
| IB Gateway version | Keep Gateway updated — old versions have connection stability bugs |

**Check disconnect history:**
```sql
SELECT timestamp, level, event_type, details
FROM Events_log_live
WHERE event_type IN ('disconnected', 'connection_lost', 'reconnect_failed')
ORDER BY timestamp DESC LIMIT 20;
```

**If `reconnect_failed` fires (all 5 attempts failed):**
The system waits 10 minutes, then tries again. If IB Gateway recovered, the next cycle will reconnect automatically. If not — restart IB Gateway, then wait for the next keepalive cycle.

---

### All 5 Reconnect Attempts Failed

**Symptom:** CRITICAL `reconnect_failed` event. System is in 10-minute sleep.

**Resolution options:**

1. **Wait:** If IB Gateway recovered on its own, the system will reconnect on the next tick (after the 10-minute sleep).

2. **Restart IB Gateway:** Then wait for the system to reconnect automatically.

3. **Force restart the trading system:**
   - Press Ctrl+C in the terminal → `safe_shutdown()` runs
   - Restart IB Gateway
   - Re-run `python -m live.main`

---

## Protection System Triggers

### Circuit Breaker Triggered

**Symptom:** CRITICAL `circuit_breaker` event. `emergency_shutdown()` called. `live/emergency.lock` written.

**What happened:** Strategy equity dropped ≥ 20% from `session_capital`. All positions closed via market order. System exited.

**Recovery:**

```bash
# 1. Read the lock file
cat live/emergency.lock

# 2. Check CB history
sqlite3 trading.db "
  SELECT timestamp, level, drawdown_pct, nav, starting_capital, message
  FROM circuit_breaker_live
  ORDER BY timestamp;"

# 3. Check final position (should be closed)
sqlite3 trading.db "SELECT * FROM trades_live WHERE exit_date IS NULL;"

# 4. If position is still open on IBKR despite CB close attempt:
#    Check emergency_close_failed event in Events_log_live
#    Close manually in IBKR TWS immediately

# 5. Assess situation:
#    - What caused the drawdown? Review trades_live.
#    - Is the strategy still valid? Review recent signals.
#    - Consider reducing session_capital if you want tighter position sizing

# 6. When ready to resume, remove lock and restart
rm live/emergency.lock
python -m live.main
```

**Alert state on restart:** All 4 CB alert levels fire fresh. If equity is still at drawdown levels, WARNING/ERROR/CRITICAL will fire on the first tick. This is correct behavior — do not suppress.

---

### Daily Loss Limit Triggered

**Symptom:** CRITICAL `daily_loss_limit` event. `emergency_shutdown()` called.

**What happened:** Today's IBKR NAV dropped ≥ `max_daily_loss_pct` (default 3%) from yesterday's close. All positions closed. Lock file written.

**Recovery:**

```bash
# 1. Check the event details
sqlite3 trading.db "
  SELECT timestamp, details
  FROM Events_log_live
  WHERE event_type = 'daily_loss_limit'
  ORDER BY timestamp DESC LIMIT 3;"

# 2. Check NAV history
sqlite3 trading.db "
  SELECT timestamp, nav
  FROM nav_snapshots
  ORDER BY timestamp DESC LIMIT 10;"

# 3. Check daily_equity_live for the baseline that was used
sqlite3 trading.db "
  SELECT date, nav
  FROM daily_equity_live
  ORDER BY date DESC LIMIT 5;"

# 4. Remove lock and restart when ready (next day or after review)
rm live/emergency.lock
python -m live.main
```

**If the daily loss limit feels too tight:** Increase `max_daily_loss_pct` in `config.yaml`. Default is 3%. The daily loss limit protects against single-day catastrophes. The circuit breaker handles multi-day drawdowns.

---

## Data Issues

### Hourly Data Missing

**Symptom:** `get_proxy_close()` raises `ValueError: TQQQ_1h is empty`. Or `monitor_stops()` fails because `TQQQ_1h` has no recent bars.

**Resolution:**

```bash
# Check what's in the table
sqlite3 trading.db "
  SELECT COUNT(*), MIN(timestamp), MAX(timestamp) FROM TQQQ_1h;"

# If empty or very old, run the backfill
cd E:\Trading\tqqq-dev\03-Live
python -c "
from engine.config import load_config
from live.data import backfill_hourly_db
import ib_insync as ibi

config = load_config('config.yaml')
ib = ibi.IB()
ib.connect(config.live.ibkr_host, config.live.ibkr_port, clientId=2)
n = backfill_hourly_db(ib, config, days=30)
print(f'Inserted {n} bars')
ib.disconnect()
"

# Verify
sqlite3 trading.db "SELECT MAX(timestamp) FROM TQQQ_1h;"
```

---

### Signal Mismatch Warning

**Symptom:** WARNING `signal_mismatch` in log. `validate_signal_match()` found that today's live signal differs from what the backtest engine produces for the same date.

**Typical causes:**

| Cause | Explanation |
|-------|-------------|
| Adjustment factors updated | Yahoo Finance retroactively adjusts historical prices — the backtest engine recomputes using updated factors while `signals_live` stores the original result |
| Config changed between sessions | `atr_multiplier`, `hard_stop_pct`, or other params changed in `config.yaml` |
| Data gap | A bar was missing when the live signal was evaluated but is now present |

**Is it a problem?**
A single mismatch on a recent date is usually benign — adjustment factors are updated regularly. If mismatches are on today's date, the live signal may be unreliable.

**Resolution:**
```sql
-- Check which dates have mismatches
SELECT date, backtest_action, live_action, details
FROM signal_mismatch_log  -- or from Events_log_live details field
ORDER BY date DESC;

-- Review the live signals recorded
SELECT signal_date, action, close_price, indicators
FROM signals_live
ORDER BY signal_date DESC LIMIT 10;
```

If the mismatch is on the current trading day: do not place a new entry order until the discrepancy is understood. The HOLD or SELL case is safe — a missed entry is better than a wrong entry.

---

## GUI Issues

### GUI Shows No Data

**Symptom:** GUI loads but screens show empty tables or "no data".

**Diagnosis:**

```bash
# Test Flask backend
curl http://127.0.0.1:5000/api/health

# Check if Flask is running
ps aux | grep "gui.app"

# If backend not running, start it:
cd E:\Trading\tqqq-dev\03-Live
python -m gui.app
```

**If Flask returns data but React shows empty:**
```bash
# Check if React dev server is running
ps aux | grep "node"

# Start React:
cd E:\Trading\tqqq-dev\03-Live\gui\frontend
npm start
```

**If DB has no runs:**
```sql
SELECT COUNT(*) FROM runs;
-- If 0, no backtest experiments have been saved yet
```

---

### GUI Live Status Disconnected

**Symptom:** Screen 8 (Live Status) shows "Disconnected" or stale data.

**Diagnosis:**

```bash
# Check the heartbeat API
curl http://127.0.0.1:5000/api/live/heartbeat

# Check the heartbeat table
sqlite3 trading.db "
  SELECT pid, timestamp, ib_connected, open_position
  FROM process_heartbeat
  ORDER BY timestamp DESC LIMIT 5;"

# Check if the live trading process is running
ps aux | grep "live.main"
```

**The heartbeat table is updated by `keepalive_ping()` on every successful IB ping.** If the last entry is more than 2 hours old, the live system is not running or has been disconnected for an extended period.

---

## Database Issues

### `trading.db` Locked / Corrupted

**Symptom:** `sqlite3.OperationalError: database is locked` or `database disk image is malformed`.

**For lock issues:**
```bash
# Stop all processes accessing the DB
# Delete WAL files if no process is running
rm trading.db-wal trading.db-shm
# Restart
```

**For corruption:**
```bash
# Check integrity
sqlite3 trading.db "PRAGMA integrity_check;"
# "ok" = no corruption

# If corrupted, restore from latest backup
# See Backup-Recovery.md for restore steps
```

---

### Tables Missing

**Symptom:** `sqlite3.OperationalError: no such table: TQQQ_1h`

**Cause:** `create_tables()` was not run, or the DB was replaced with an older version.

**Resolution:**
```bash
cd E:\Trading\tqqq-dev\03-Live
python -c "
from live.db_setup import create_tables
create_tables('trading.db')
print('Tables created.')
"
```

This is idempotent — safe to run if tables already exist. `migrate_tables()` runs first to rename any legacy `dev_*` tables.

---

## Pending Commands Not Working

**Symptom:** `FORCE_CLOSE` command written to `live/commands/pending.json` but nothing happened.

**Diagnosis:**
```bash
# Check if the file exists and has valid JSON
cat live/commands/pending.json
# Expected: {"action": "FORCE_CLOSE"}

# Check Events_log_live for command events
sqlite3 trading.db "
  SELECT timestamp, event_type, details
  FROM Events_log_live
  WHERE event_type LIKE 'command%'
  ORDER BY timestamp DESC LIMIT 5;"
```

**Common issues:**

| Problem | Fix |
|---------|-----|
| JSON parse error | Ensure valid JSON: `{"action": "FORCE_CLOSE"}` — no trailing commas |
| File in wrong directory | Must be `03-Live/live/commands/pending.json` relative to where `live.main` runs |
| System is sleeping | `check_pending_commands()` runs on every tick — wait for the next bar boundary (up to 60 min) |
| System is paused | A PAUSE command prevents new actions — send RESUME first, then FORCE_CLOSE |

**Command is consumed once:** The file is deleted immediately after being read. If the command did nothing, it was either already consumed or had a parse error. Check `Events_log_live` for `command_parse` or `command_unknown` events.

---

## Common Log Patterns

### Normal healthy session

```
[INFO] Live session started — mode: paper — session: uuid... — equity: $100,000
[INFO] connected: host=127.0.0.1 port=4002 account=DU1234567
[INFO] connection_ok: Pulse check — 10:00 UTC — IB Gateway connected
[INFO] sleep_bar: sleep_seconds=3555.3 next_bar_et=15:00
[INFO] signal: Signal evaluated: HOLD — in_position
[INFO] stop_update: Ratchet stop updated $69.15 -> $70.22
```

### Session with stop hit

```
[INFO] sync_hourly_db: new_bars=1 latest_ts=2026-03-30 14:00:00
[CRITICAL] stop_hit: low=68.91 stop=69.15 shares=1382 exit_price=69.15
[INFO] order_filled: order_id=... fill_price=69.12 fill_qty=1382
[INFO] shutdown: phase=complete
```

### Session with reconnect

```
[ERROR] connection_lost: error=... host=127.0.0.1 port=4002
[WARNING] reconnect_attempt: attempt=1 of=5
[ERROR] reconnect_attempt_failed: attempt=1 error=...
[WARNING] reconnect_attempt: attempt=2 of=5
[INFO] reconnect_success: attempt=2 host=127.0.0.1 port=4002
[INFO] post_reconnect_sync: bars_upserted=1
```

---

## Related Pages

- [IB Control Operations](IB-Control-Operations.md) — day-to-day operator procedures
- [System Monitoring Guide](System-Monitoring-Guide.md) — CB and daily loss limit details
- [Session Log Reference](Session-Log-Reference.md) — all event types
- [IB Gateway Integration](IB-Gateway-Integration.md) — connection architecture
- [Backup-Recovery](Backup-Recovery.md) — restoring from backup after data corruption
