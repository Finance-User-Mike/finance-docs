# Live Trading Engine

The daily orchestration loop, startup sequence, signal evaluation, stop monitoring, and shutdown handling for paper and live TQQQ trading.

Source file: [03-Live/live/main.py](../../03-Live/live/main.py)

---

## Architecture Overview

```
.env ──→ live/config.py ──→ validate()
                               │
config.yaml ──→ engine/config.py ──→ Config
                               │
                               ▼
                         run_live_loop()
                               │
              ┌────────────────┼────────────────┐
              │                │                │
         run_readiness_check() │          setup_logger()
              │                │
         startup()             │
         (connect, reconcile,  │
          reset CB state)      │
              │                │
              └────────────────▼
                     MAIN LOOP  ←──────────────────────────────────┐
                     (every interval_minutes)                       │
                          │                                         │
              ┌───────────┼────────────────────────┐               │
              │           │                        │               │
         not open?   commands?    circuit_breaker?  │               │
         sleep 5m    consume     emergency_shutdown │               │
              │                                    │               │
              │    sync_hourly_db()                │               │
              │    monitor_stops()  ←── stop hit?──┤               │
              │                        place_market │               │
              │    is_signal_time()?               │               │
              │    └─→ evaluate()                  │               │
              │         └─→ act()                  │               │
              │              └─→ dry_run? log only │               │
              │              └─→ else: place order  │               │
              │                                    │               │
              │    write hourly_snapshot_live      │               │
              │    sleep_until_next_bar() ─────────┘               │
              │                                                     │
              └─────────────────────────────────────────────────────┘

KeyboardInterrupt → safe_shutdown()
Fatal exception  → emergency_shutdown()
```

---

## Module Responsibilities

| Module | Responsibility |
|--------|--------------|
| `live/main.py` | Orchestration loop, startup, shutdown, timing |
| `live/executor.py` | Translates signals into orders; stop monitoring |
| `live/validate.py` | 5-check pre-flight readiness; signal match validation |
| `live/logger.py` | Three-handler logging; DB event writes |
| `live/broker.py` | IBKR connection, order placement, position query |
| `live/data.py` | Daily + hourly bar fetch, IBKR sync |
| `live/circuit_breaker.py` | Portfolio-level drawdown protection |
| `engine/` | Signal evaluation, indicators — identical to backtest |

---

## Startup Sequence

`run_live_loop()` calls these in order before entering the main loop:

### Step 1 — Non-trading day check

```python
if not should_connect_today():
    logger.info("Non-trading day — system offline. No IB connection.")
    return
```

`should_connect_today()` checks:
1. Is today a weekday? (`weekday() >= 5` → return False)
2. Is today a NYSE holiday? (via `pandas_market_calendars`)

If not a trading day, the process exits cleanly without connecting to IB Gateway. This prevents unnecessary connection attempts on weekends and holidays.

### Step 2 — Readiness check (5 checks)

```python
if not run_readiness_check(config, db_path):
    logger.critical("Readiness check failed — aborting startup")
    return
```

| Check | What is verified | Pass condition |
|-------|-----------------|----------------|
| CHECK 1 | IB Gateway reachable | TCP connect to `ibkr_host:ibkr_port` succeeds within 5s |
| CHECK 2 | Config valid | `mode` ∈ {paper/live}, port matches mode |
| CHECK 3 | DB writable | Test row INSERT + DELETE in Events_log_live succeeds |
| CHECK 4 | Hourly data fresh | Last `TQQQ_1h` timestamp within 72 hours |
| CHECK 5 | Mode confirmation | Paper: auto-pass. Live: user must type `"I CONFIRM LIVE TRADING"` |

All 5 must pass. A single failure aborts startup. See [IB Control Operations](IB-Control-Operations.md) for how to fix each check.

### Step 3 — Connect and reconcile

```python
ib = startup(config, db_path)
```

`startup()` does:
1. Checks for `live/emergency.lock` → **aborts if present** (requires manual deletion)
2. Attempts `connect()` up to 20 times, 30s apart (handles IB Gateway 11pm restart)
3. Calls `validate_account_environment(ib, config)` → confirms paper/live account type matches config
4. Calls `reconcile_positions(ib, config, db_path)` → compares IBKR positions vs `trades_live` DB. **Aborts on mismatch — never auto-corrects**
5. Calls `reset_alert_state()` to clear any stale circuit breaker flags from prior session

### Step 4 — Startup DB writes

After successful connect:
- `sync_daily_db(ib, config, db_path)` — catches up any missed daily bars
- `_write_config_log_startup()` — writes session row to `config_log_live` with session_id, mode, equity
- `log_session_event(..., "market_open")` — first market-open of the day

---

## Main Loop

The main loop runs continuously, sleeping `interval_minutes` (typically 60) between iterations.

### Per-tick sequence

```
Each tick (every interval_minutes):

1. keepalive_ping()           Send reqCurrentTime() to IB — prevent connection timeout
                              Write heartbeat to process_heartbeat table
                              DB log throttled to once per hour

2. market_is_open()?
   NO  → sleep 5 minutes, continue
   YES → proceed

3. check_pending_commands()   Read + consume live/commands/pending.json
                              Supported: FORCE_CLOSE, PAUSE, RESUME, UPDATE_STOP

4. check_circuit_breaker()    Portfolio-level drawdown check
                              If CB fires → emergency_shutdown()

5. sync_hourly_db()           Fetch new hourly bars from IBKR since last stored
                              Write to TQQQ_1h table

6. load_daily_bars_db()       Read full daily bar history for signal evaluation

7. get_position()             Query IBKR for current position state

8. _update_ratchet_stop()     If in position: recalculate and save ratchet stop
                              Logs stop change if stop moved

9. monitor_stops()            If in position: check latest TQQQ_1h low vs stop_price
                              If low <= stop_price → market order + close trade record

10. is_signal_time()?         Within ±2 min of config.live.signal_time (15:00 ET)
    AND NOT _paused?          Fires at most once per calendar day
    → evaluate()              Run engine signal with full bar history
    → act()                   dry_run? → log only. else → place order

11. write_hourly_snapshot_live()
                              Write close, VWAP, EMA, ATR, signal, position to DB
                              GUI reads this for live dashboard

12. sleep_until_next_bar()    Sleep (interval_minutes × 60) - elapsed_seconds
                              IB keepalive ping every 2 minutes during sleep
```

---

## Signal Evaluation

### Timing: `is_signal_time()`

```python
def is_signal_time(config: Config) -> bool:
    now_et = datetime.now(ET_ZONE)
    sig_min = (sig_h * 60 + sig_m)        # from config.live.signal_time = "15:00"
    now_min = now_et.hour * 60 + now_et.minute

    if abs(now_min - sig_min) <= 2:
        _signal_fired_date = today_str     # lock — will not fire again today
        return True
    return False
```

The signal window is `signal_time ± 2 minutes` (e.g., 14:58–15:02 ET for a 15:00 setting).

**Daily-fire guarantee:** `_signal_fired_date` is a module-level variable. Once set to today's date, `is_signal_time()` always returns False until the next calendar day, regardless of how many loop iterations run.

### What the signal evaluates

The daily signal uses the exact same `engine.evaluate()` function as the backtest. Same indicators, same entry rules, same code path:

```
LONG:  Close > VWAP_250 AND Close > EMA_10 AND not in position → BUY
SHORT: Close < VWAP_250 AND Close < EMA_10 AND not in position → SELL (short)
Else:  HOLD
```

See [Ref-Engine-Core — signals.py](Ref-Engine-Core.md#signalspy) for the full evaluation logic.

### Dry run mode

When `config.live.dry_run = true` (default):
- Signal is evaluated and logged to `signals_live`
- No order is placed
- Log message: `"[DRY RUN] Signal: BUY — no order placed"`

Switch to live: set `dry_run: false` in `config.yaml` (or `live` section).

---

## Stop Monitoring

Stop monitoring runs on **every hourly bar**, not just at signal time.

### `monitor_stops()` in executor.py

```python
def monitor_stops(position, ib, config, db_path):
    if position["shares"] == 0:
        return

    # Read latest TQQQ_1h bar
    bar_low, bar_ts = conn.execute(
        "SELECT low, timestamp FROM TQQQ_1h ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()

    if bar_low > stop_price:
        return   # stop not triggered

    # Stop hit — place market order immediately
    order_id = place_market_order(ib, config, "SELL", shares, "stop_hit", db_path)
    fill = wait_for_fill(ib, order_id, config, db_path)
    _close_entry_trade(position, order_id, fill["fill_price"], "stop_hit", db_path)

    log_event(db_path, "CRITICAL", "stop_hit", {...})
```

**Trigger condition:** `bar_low ≤ stop_price` (long position)

**Execution:** Market order — fastest possible exit when stop triggers. No limit order that could fail to fill.

**Ratchet stop updates:** Each tick, `_update_ratchet_stop()` recalculates the stop using the ratchet formula and updates `trades_live.stop_price`:

```python
def calc_ratchet_stop(position, current_high, atr, config):
    new_stop = current_high - (atr × atr_multiplier)
    current_stop = position["stop_price"]
    return max(new_stop, current_stop)   # NEVER moves down
```

The stop only moves up (for long positions). This is the same CRITICAL INVARIANT as in the backtest. See [Ref-Engine-Core — risk.py](Ref-Engine-Core.md#riskpy) for the monotonicity rule.

---

## Order Execution

### Entry: `act()` in executor.py

When signal = BUY and no position:

```
1. get_proxy_close(db_path)   Latest close from TQQQ_daily or TQQQ_1h
2. _get_equity()              Strategy equity (session_capital + cumulative P&L)
3. _calc_shares()             floor(equity × max_position_pct / entry_price)
4. place_limit_order()        Limit = proxy_close + $0.05 (slight edge above market)
5. wait_for_fill()            Wait up to fill_timeout_seconds
6. _record_entry_trade()      Write open trades_live row with hard_stop calculated
```

Entry price is `proxy_close + $0.05` — a small buffer ensures the limit order hits the market without chasing.

Hard stop written to DB immediately after fill: `hard_stop = fill_price × (1 - hard_stop_pct)`. Stop monitoring can then check this value from the very first hourly bar.

### Exit: `act()` in executor.py

When signal = SELL (or HOLD with stop hit):

```
1. place_market_order()       Market order for all held shares
2. wait_for_fill()            Wait for confirmation
3. _close_entry_trade()       Update trades_live: exit_price, pnl_dollar, pnl_pct, exit_reason
```

Market orders are used for exits (not limit) to guarantee execution — especially for stop-hit exits where slippage is acceptable but missing the exit is not.

### Partial fills: `handle_partial_fill()`

If `wait_for_fill()` times out with a partial fill:
1. Cancel the remaining unfilled portion on IBKR
2. Update `orders_live` to `status=partial`
3. Create `trades_live` row for the filled shares only
4. Set hard stop based on the partial fill price
5. Log WARNING — operator should monitor

---

## Pending Commands

Write `live/commands/pending.json` to send operator commands to the running loop. The file is consumed (deleted) once, on the next loop tick.

**File format:**

```json
{"action": "PAUSE"}
{"action": "RESUME"}
{"action": "FORCE_CLOSE"}
{"action": "UPDATE_STOP", "trade_id": "uuid-here", "new_stop": 42.50}
```

**Supported commands:**

| Command | Effect |
|---------|--------|
| `PAUSE` | Sets `_paused = True` — no new entries, stop monitoring still active |
| `RESUME` | Sets `_paused = False` — re-enables entries |
| `FORCE_CLOSE` | Market order to close all positions immediately |
| `UPDATE_STOP` | Update `stop_price` in `trades_live` (operator can tighten stop manually) |

**Note:** `UPDATE_STOP` only allows tightening the stop. The ratchet invariant (stop never moves against the trade) should be respected manually.

See [IB Control Operations](IB-Control-Operations.md) for the command workflow and examples.

---

## Daily Loss Limit

`check_daily_loss_limit()` runs on every tick when market is open.

```
start_equity = NAV at session start (from daily_equity_live or get_strategy_equity())
current_equity = ib.accountSummary()["NetLiquidation"]

loss_pct = (start_equity - current_equity) / start_equity × 100

if loss_pct >= max_daily_loss_pct (default 3%):
    → CRITICAL log
    → emergency_shutdown()

elif loss_pct >= max_daily_loss_pct × 0.75:
    → WARNING "approaching limit"

elif loss_pct >= max_daily_loss_pct × 0.50:
    → WARNING "daily loss warning"
```

NAV is also written to `nav_snapshots` table on every tick so the GUI can display it without calling IB.

**Important:** `start_equity` is read from `daily_equity_live.nav` (yesterday's EOD NAV), not from the current IB account. This prevents the daily loss counter from resetting if the process restarts intraday.

---

## Keepalive and Sleep

### `keepalive_ping()`

Runs every tick. Sends `ib.reqCurrentTime()` to prevent NAT timeout on idle connections.

- IBKR ping: every tick (every 5 or 60 minutes)
- DB log (`connection_ok` event): throttled to once per hour — prevents log flood

If ping fails → attempts `reconnect()`. If reconnect fails → logs CRITICAL and sleeps 10 minutes before next attempt.

### `sleep_until_next_bar()`

Sleeps for `(interval_minutes × 60) - elapsed_seconds` to maintain a consistent bar rhythm.

**Keepalive during sleep:** Instead of one long sleep, this function sleeps in 2-minute chunks, sending an IB ping after each chunk. This beats any NAT table timeout (typically 5–30 minutes) that could silently drop the connection.

```
interval = 3600s (60 min)
elapsed  = 45s  (processing time this tick)
sleep    = 3555s

Chunk loop:
  sleep(120s) → ping IB
  sleep(120s) → ping IB
  ... × 29
  sleep(15s)  → done
```

---

## Shutdown Procedures

### Safe shutdown — `safe_shutdown()`

Triggered by `KeyboardInterrupt` (Ctrl+C).

```
a. Cancel all pending limit orders
b. Record final position state to Events_log_live
c. Update config_log_live: stopped_at=now, status=inactive
d. Disconnect from IBKR
```

Does **not** close open positions. Existing stops continue to be monitored on the next session restart.

### Emergency shutdown — `emergency_shutdown()`

Triggered by:
- Daily loss limit exceeded (`check_daily_loss_limit()`)
- Circuit breaker fired (`check_circuit_breaker()`)
- Manual via `FORCE_CLOSE` command + process kill

```
a. Market order to close ALL open positions immediately
b. Write live/emergency.lock with timestamp + reason JSON
c. Update config_log_live: status=crashed
d. Log CRITICAL event to Events_log_live
e. Disconnect from IBKR
```

**After emergency shutdown:** The system will NOT restart until `live/emergency.lock` is manually deleted. This prevents automatic restart into an unknown state.

**To restart after emergency:**
```bash
cat live/emergency.lock          # read the reason
# Investigate and resolve
rm live/emergency.lock           # delete to allow restart
python -m live.main              # restart session
```

---

## Logging Architecture

Three output destinations — configured by `setup_logger()`:

| Destination | Format | Level | Notes |
|-------------|--------|-------|-------|
| `logs/live_main.log` | `YYYY-MM-DD HH:MM:SS [LEVEL] name — message` | DEBUG+ | Rotated at 3 MB with timestamp suffix |
| Terminal (stdout) | Same format with ANSI colour | INFO+ | Colour by level: green=INFO, yellow=WARNING, red=ERROR, bold-red=CRITICAL |
| `Events_log_live` table | JSON details | WARNING+ | GUI System Log reads last 100 rows |

**Log rotation:** When `live_main.log` reaches 3 MB, it is renamed to `live_main_YYYYMMDD_HHMM.log` and a fresh empty file is created. No log data is lost.

**`log_event()` — never raises:** If the DB write fails (locked, disk full, schema missing), the error is printed to stderr and execution continues. The trading loop is never interrupted by a logging failure.

### Key event types

| `event_type` | Level | Meaning |
|-------------|-------|---------|
| `STARTUP` | INFO | Session started |
| `market_open` | INFO | First tick of trading day |
| `connection_ok` | INFO | Hourly IB ping success |
| `connection_lost` | ERROR | IB ping failed |
| `reconnect_failed` | CRITICAL | All reconnect attempts failed |
| `signal` | INFO | Daily signal evaluated |
| `stop_update` | INFO | Ratchet stop moved higher |
| `stop_hit` | CRITICAL | Stop triggered, market order placed |
| `daily_loss_warning` | WARNING | Loss ≥ 50% of daily limit |
| `daily_loss_approaching` | WARNING | Loss ≥ 75% of daily limit |
| `daily_loss_limit` | CRITICAL | Daily loss limit hit — emergency shutdown |
| `MANUAL_OVERRIDE` | WARNING | FORCE_CLOSE command consumed |
| `shutdown` | INFO | Safe shutdown started/complete |
| `emergency_shutdown` | CRITICAL | Emergency shutdown triggered |
| `unhandled_exception` | ERROR | Unexpected exception caught — loop continues |

---

## Safety Invariants — Never Relax

1. **`_safety_check()` on every order** — paper→port 4002, live→port 4001. Wrong port = no orders.
2. **`reconcile_positions()` on every startup** — abort on mismatch. Never auto-correct.
3. **`emergency.lock` blocks restart** — operator must inspect and delete manually.
4. **`is_signal_time()` fires at most once per day** — module-level date lock.
5. **Ratchet stop never moves against trade** — `max(new_stop, current_stop)` invariant.
6. **`dry_run: true` by default** — must be explicitly set false for live orders.
7. **Position reconciliation before any order** — `get_position()` queries IBKR, not just DB.

---

## Related Pages

- [IB Gateway Integration](IB-Gateway-Integration.md) — connection architecture and port reference
- [IB Control Operations](IB-Control-Operations.md) — startup/shutdown procedures and command reference
- [System Monitoring Guide](System-Monitoring-Guide.md) — circuit breaker, daily loss limit, health checks
- [Ref-Live-Trading](Ref-Live-Trading.md) — all function signatures and parameters
- [Session Log Reference](Session-Log-Reference.md) — all event types and DB log tables
- [Ref-Engine-Core](Ref-Engine-Core.md) — `evaluate()` and `calc_ratchet_stop()` used unchanged in live
