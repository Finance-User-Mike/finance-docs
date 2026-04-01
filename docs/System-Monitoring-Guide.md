# System Monitoring Guide

Circuit breaker, daily loss limit, connection health, and how to read live system status.

Source files: [03-Live/live/circuit_breaker.py](../../03-Live/live/circuit_breaker.py), [03-Live/live/main.py](../../03-Live/live/main.py)

---

## Overview: Three Protection Layers

The live system has three independent protection mechanisms that can halt trading:

```
Layer 1 — Circuit Breaker (circuit_breaker.py)
  Tracks: session_capital + closed P&L + unrealised P&L (from DB)
  Action: escalating alerts → emergency_shutdown() at 20% drawdown

Layer 2 — Daily Loss Limit (main.py)
  Tracks: session-start NAV → current IBKR NetLiquidation
  Action: WARNING at 50% of limit → CRITICAL at limit → emergency_shutdown()

Layer 3 — Connection Health (main.py / broker.py)
  Tracks: IB ping every tick, reconnect on failure
  Action: reconnect → CRITICAL alert → 10-min wait if all retries fail
```

All three run independently. Any one can trigger `emergency_shutdown()`.

---

## Circuit Breaker — `check_circuit_breaker()`

Runs on every main loop tick. Monitors **strategy equity** — not full account NAV.

### What it tracks

```python
strategy_equity = session_capital + SUM(all closed P&L) + unrealised_P&L
```

- `session_capital` = original allocation from `config.live.session_capital` (e.g., $100,000)
- Closed P&L = sum of all `trades_live.pnl_dollar` where `exit_date IS NOT NULL`
- Unrealised P&L = `(current_close - entry_price) × shares` using latest `TQQQ_1h` bar

**Why DB-based, not IBKR NAV?** The full IBKR account may contain other strategies, cash, and positions unrelated to TQQQ momentum. Using the strategy equity isolates the drawdown calculation to only this strategy's allocated capital and trades.

### Alert levels

| Level | Threshold | Frequency | Action |
|-------|----------|-----------|--------|
| 1 — WARNING | 10% drawdown | Once per session | Log WARNING to `Events_log_live` + `circuit_breaker_live` |
| 2 — ERROR | 15% drawdown | Once per session | Log ERROR |
| 3 — CRITICAL | 18% drawdown | Once per session | Log CRITICAL |
| 4 — STOP | 20% drawdown | Every 5 min until resolved | Log CRITICAL + trigger `emergency_shutdown()` |

**Example with $100K session_capital:**

| Equity | Drawdown | Alert |
|--------|---------|-------|
| $95,000 | 5% | None |
| $90,000 | 10% | Level 1 — WARNING |
| $85,000 | 15% | Level 2 — ERROR |
| $82,000 | 18% | Level 3 — CRITICAL |
| $80,000 | 20% | Level 4 — STOP → emergency_shutdown() |

**Alert state resets on restart.** Calling `reset_alert_state()` in `startup()` clears all fired-once flags so a fresh session starts with clean alert state. If equity is already at 15% drawdown when restarting, the WARNING and ERROR alerts will fire again on the first tick.

### Circuit breaker in backtests vs live

| Context | Where configured | Threshold |
|---------|-----------------|----------|
| Backtest | `backtest.max_dd_threshold` (e.g., 30%) | Percentage of peak equity |
| Live | `circuit_breaker.py` hardcoded levels | 10/15/18/20% of session_capital |

The backtest CB and live CB are separate systems. The backtest CB prevents entering new trades after a drawdown. The live CB triggers emergency position closure.

**Phase 2 finding:** The backtest CB with 30% threshold (exp_008) fired during 2022 bear and missed the 2023–2025 recovery. The live CB with 20% threshold is much tighter. These are intentionally different — the live system protects real capital more aggressively.

---

## Daily Loss Limit — `check_daily_loss_limit()`

Runs every main loop tick when market is open. Uses IBKR account NAV directly.

```python
start_equity    = daily_equity_live.nav (yesterday's EOD) — persists across restarts
current_equity  = ib.accountSummary()["NetLiquidation"]

loss_pct = (start_equity - current_equity) / start_equity × 100
threshold = config.live.max_daily_loss_pct   # default 3.0%
```

### Alert levels

| Condition | Level | Action |
|-----------|-------|--------|
| `loss_pct >= threshold × 0.50` (1.5%) | WARNING | Log `daily_loss_warning` |
| `loss_pct >= threshold × 0.75` (2.25%) | WARNING | Log `daily_loss_approaching` |
| `loss_pct >= threshold` (3.0%) | CRITICAL | Log + `emergency_shutdown()` |

### Why two separate loss mechanisms?

| Mechanism | What it measures | Typical trigger |
|-----------|-----------------|----------------|
| Circuit breaker | Strategy equity drawdown from session start | Multi-day losing streak |
| Daily loss limit | Today's NAV change only | Single bad trading day |

The daily loss limit resets each morning (based on previous day's EOD NAV). It protects against a single bad day. The circuit breaker accumulates across multiple days — it protects against a sustained losing period.

### `start_equity` persistence

`start_equity` is read from `daily_equity_live.nav` (yesterday's recorded NAV) at startup:

```python
# From main.py
start_equity = _get_start_equity_from_db(db_path, session_capital)
```

This prevents the daily loss counter from resetting if the process restarts intraday. A restart mid-day does not reset the loss baseline — it always uses yesterday's close as the reference.

**First-ever run:** If `daily_equity_live` is empty (no prior sessions), falls back to `get_strategy_equity()` which uses `session_capital` as the baseline.

---

## Connection Health Monitoring

### keepalive_ping() — Every tick

```
ib.reqCurrentTime()  → success: write heartbeat, log once/hour to Events_log_live
                     → failure: attempt reconnect

reconnect() fails → log CRITICAL "reconnect_failed"
                  → sleep 600s (10 min), then retry on next tick
```

**Heartbeat table:** Each successful ping also writes to `process_heartbeat` table:
```sql
(pid, timestamp, ib_connected=True, ib_port, client_id, open_position)
```
The GUI Process Manager reads this to display process health.

### Disconnect event handler

`register_disconnect_handler()` hooks into `ib_insync.disconnectedEvent`:

```
IB Gateway drops connection
→ on_disconnected() fires immediately
→ Logs WARNING to Events_log_live: "IB Gateway disconnected event received"
→ Does NOT attempt reconnect (handled by keepalive_ping on next tick)
```

### Reconnect sequence

```
keepalive_ping() fails
→ reconnect() called
  Attempt 1: disconnect() → connect_ibkr() → success? return
                                            → fail? wait 15s
  Attempt 2: ...
  Attempt 5: fail
    → log CRITICAL "reconnect_failed" with next_retry_minutes: 10
    → sleep(600)  ← 10 minute pause before next tick

Next tick: keepalive_ping() called again
  → if IB Gateway came back: reconnect succeeds
  → if still down: another 5-attempt cycle
```

---

## Reading System Status

### Via terminal log

```bash
tail -f logs/live_main.log
```

Key patterns to watch:

| Log message | Status |
|-------------|--------|
| `* Pulse check -- HH:MM UTC -- IB Gateway connected -- session active` | Normal |
| `Sleeping 3555s — next bar at HH:MM ET` | Normal |
| `Signal evaluated: HOLD — in_position` | Normal daily signal |
| `Signal evaluated: BUY — long_entry` | Entry about to be placed |
| `IB Gateway disconnected event received` | Disconnect detected — reconnect will follow |
| `Reconnected to IB Gateway (attempt N/5)` | Reconnect succeeded |
| `All 5 reconnect attempts failed` | Extended outage |
| `CIRCUIT BREAKER FIRED` | CB triggered — emergency shutdown imminent |
| `Safe shutdown complete.` | Graceful exit |
| `EMERGENCY SHUTDOWN — reason` | Emergency exit triggered |

### Via DB queries

**Recent events:**
```sql
SELECT timestamp, level, event_type, details
FROM Events_log_live
ORDER BY timestamp DESC
LIMIT 30;
```

**Circuit breaker history:**
```sql
SELECT timestamp, level, drawdown_pct, nav, starting_capital, message
FROM circuit_breaker_live
ORDER BY timestamp DESC;
```

**Current position:**
```sql
SELECT symbol, entry_date, entry_price, stop_price, shares,
       (SELECT close FROM TQQQ_1h ORDER BY timestamp DESC LIMIT 1) AS current_price
FROM trades_live
WHERE exit_date IS NULL;
```

**Recent signals:**
```sql
SELECT signal_date, action, close_price, order_placed, fill_price, mode
FROM signals_live
ORDER BY signal_date DESC
LIMIT 10;
```

**Recent trades:**
```sql
SELECT trade_id, entry_date, exit_date, entry_price, exit_price,
       shares, pnl_dollar, pnl_pct, exit_reason
FROM trades_live
ORDER BY entry_date DESC
LIMIT 10;
```

**Today's loss vs limit:**
```sql
-- Check most recent NAV snapshot vs session capital
SELECT timestamp, nav
FROM nav_snapshots
ORDER BY timestamp DESC
LIMIT 5;
```

### Via GUI Dashboard

The GUI [System Log screen](Dashboard-Guide.md#screen-9--system-log) reads:
- `Events_log_live` — last 100 rows, oldest-first
- `hourly_snapshot_live` — per-tick indicators for the live dashboard

See [Dashboard Guide](Dashboard-Guide.md) for all screens.

---

## Circuit Breaker Recovery

After `emergency_shutdown()` fires due to circuit breaker:

1. `live/emergency.lock` is written with the reason
2. All positions are closed via market order
3. System exits

**To restart:**
```bash
# 1. Check what triggered it
cat live/emergency.lock
# {"timestamp": "...", "reason": "CIRCUIT BREAKER TRIGGERED — portfolio down 20.1%"}

# 2. Check circuit_breaker_live for history
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
rows = conn.execute(
    'SELECT timestamp, level, drawdown_pct, message '
    'FROM circuit_breaker_live ORDER BY timestamp'
).fetchall()
for r in rows:
    print(r)
conn.close()
"

# 3. Verify all positions are closed (IBKR + DB)
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
rows = conn.execute(
    'SELECT * FROM trades_live WHERE exit_date IS NULL'
).fetchall()
print('Open positions:', rows)
conn.close()
"

# 4. If satisfied with the situation, delete lock and restart
rm live/emergency.lock
python -m live.main
```

**After restart:** `reset_alert_state()` clears alert flags. If equity is still at drawdown levels, new alerts will fire on the first CB check. Consider reducing `session_capital` or pausing the system if the CB fires repeatedly.

---

## Setting Up Monitoring Alerts (Recommended)

The system writes all events to `Events_log_live`. Set up external monitoring by polling this table:

**Simple health check script:**
```python
# health_check.py — run every 5 minutes via cron/Task Scheduler
import sqlite3
from datetime import datetime, timedelta

conn = sqlite3.connect("trading.db")

# Check for CRITICAL events in last 10 minutes
cutoff = (datetime.utcnow() - timedelta(minutes=10)).isoformat()
rows = conn.execute(
    "SELECT timestamp, event_type, details FROM Events_log_live "
    "WHERE level='CRITICAL' AND timestamp > ? ORDER BY timestamp",
    (cutoff,)
).fetchall()

if rows:
    print("CRITICAL ALERTS:")
    for r in rows:
        print(f"  {r[0]} | {r[1]} | {r[2]}")
    # Send email/SMS/Slack notification here

# Check if system is alive (last heartbeat within 2 hours)
row = conn.execute(
    "SELECT MAX(timestamp) FROM Events_log_live WHERE event_type='connection_ok'"
).fetchone()
last_ping = row[0] if row else None
if last_ping:
    delta = datetime.utcnow() - datetime.fromisoformat(last_ping[:19])
    if delta.total_seconds() > 7200:  # 2 hours
        print(f"WARNING: Last connection ping was {delta} ago — system may be down")

conn.close()
```

---

## Health Dashboard (Quick Reference)

| Indicator | Normal | Warning | Critical |
|-----------|--------|---------|---------|
| Last IB ping | < 2 hours ago | 2–6 hours | > 6 hours |
| Strategy drawdown | < 10% | 10–18% | ≥ 18% |
| Daily loss | < 1.5% | 1.5–3% | ≥ 3% |
| Open position stop | > 5% buffer from price | 2–5% buffer | < 2% buffer |
| `Events_log_live` CRITICAL rows today | 0 | 1 | ≥ 2 |
| `emergency.lock` exists | No | — | Yes |

---

## Related Pages

- [Live Trading Engine](Live-Trading-Engine.md) — main loop where monitoring calls are made
- [IB Gateway Integration](IB-Gateway-Integration.md) — connection architecture
- [IB Control Operations](IB-Control-Operations.md) — operator response procedures
- [Session Log Reference](Session-Log-Reference.md) — all event types in Events_log_live
- [Database Schema](Database-Schema.md) — `circuit_breaker_live`, `nav_snapshots`, `process_heartbeat`
