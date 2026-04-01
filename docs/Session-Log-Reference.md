# Session Log Reference

Every `event_type` value written to `Events_log_live` and `session_events_live`, with the exact `details` payload, level, and which source module fires it.

Source files: [03-Live/live/logger.py](../../03-Live/live/logger.py), [03-Live/live/main.py](../../03-Live/live/main.py), [03-Live/live/broker.py](../../03-Live/live/broker.py), [03-Live/live/executor.py](../../03-Live/live/executor.py), [03-Live/live/data.py](../../03-Live/live/data.py), [03-Live/live/circuit_breaker.py](../../03-Live/live/circuit_breaker.py)

---

## Two Log Tables

| Table | Written by | Queried by |
|-------|-----------|-----------|
| `Events_log_live` | `log_event()` — every module | GUI System Log tab 3, DB monitoring queries |
| `session_events_live` | `log_session_event()` — main.py only | GUI System Log tab 1 (Timeline), tab 2 (Events) |
| `Events_log_live_archive` | Auto-archive job (not yet implemented) | Historical queries |

`Events_log_live` is the primary log — all events appear here. `session_events_live` stores the high-level timeline events (market open, signals, reconnects) that populate the GUI Overview tab. These are a curated subset of `Events_log_live`.

**Schema:**

```sql
-- Events_log_live
CREATE TABLE Events_log_live (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL,          -- ISO datetime UTC
    level       TEXT NOT NULL,          -- INFO / WARNING / ERROR / CRITICAL / DEBUG
    event_type  TEXT NOT NULL,          -- snake_case event identifier
    details     TEXT,                   -- JSON string
    session_id  TEXT,                   -- UUID linking to config_log_live
    source      TEXT,                   -- module name that fired the event
    symbol      TEXT DEFAULT 'TQQQ'
)

-- session_events_live
CREATE TABLE session_events_live (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    level       TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    summary     TEXT,                   -- human-readable one-line description
    details     TEXT                    -- JSON string (optional)
)
```

---

## Level Guide

| Level | Meaning | Action required |
|-------|---------|----------------|
| `DEBUG` | Diagnostic detail — polling loops, sleep timers | None — informational |
| `INFO` | Normal operation milestones | None |
| `WARNING` | Degraded state — worth reviewing | Monitor; may self-resolve |
| `ERROR` | Something failed — system continues | Investigate at next opportunity |
| `CRITICAL` | Severe — may trigger shutdown or require intervention | Immediate attention |

---

## Connection Events

### `connected`

**Level:** INFO
**Source:** `live/data.py` — `connect_ibkr()`
**Fires:** On every successful IB Gateway connection (startup or reconnect)

```json
{
  "host": "127.0.0.1",
  "port": 4002,
  "client_id": 3,
  "account": "DU1234567"
}
```

---

### `disconnected`

**Level:** ERROR
**Source:** `live/data.py` — `_on_disconnect()` callback
**Fires:** Immediately when IB Gateway drops the connection (via `ib_insync.disconnectedEvent`)

```json
{
  "host": "127.0.0.1",
  "port": 4002
}
```

> **Note:** This fires immediately on drop. The actual reconnect is handled by `keepalive_ping()` on the next tick — this event just records that the drop was detected.

---

### `connection_ok`

**Level:** INFO
**Source:** `live/main.py` — `keepalive_ping()`
**Fires:** Once per hour (not on every tick — throttled by `_ping_logged_hour` flag)

```json
{
  "msg": "Pulse check — 14:00 UTC — IB Gateway connected",
  "host": "127.0.0.1",
  "port": 4002
}
```

> **Monitoring use:** If there is no `connection_ok` event in the last 2 hours during market hours, the system may be down. See [System Monitoring Guide](System-Monitoring-Guide.md) for the health check script.

---

### `connection_lost`

**Level:** ERROR
**Source:** `live/main.py` — `keepalive_ping()` exception handler, `_handle_disconnect()`
**Fires:** When `ib.reqCurrentTime()` raises an exception during the ping

```json
{
  "error": "ConnectionError: ...",
  "host": "127.0.0.1",
  "port": 4002
}
```

**Sequence:** `connection_lost` → `reconnect_attempt` × N → `reconnect_success` or `reconnect_failed`

---

### `reconnect_attempt`

**Level:** WARNING
**Source:** `live/broker.py` — `reconnect()`
**Fires:** Before each reconnect attempt (up to 5)

```json
{
  "attempt": 2,
  "of": 5,
  "host": "127.0.0.1",
  "port": 4002
}
```

---

### `reconnect_attempt_failed`

**Level:** ERROR
**Source:** `live/broker.py` — `reconnect()`
**Fires:** When a single reconnect attempt fails (but more attempts remain)

```json
{
  "attempt": 2,
  "error": "ConnectionError: Cannot connect to 127.0.0.1:4002"
}
```

---

### `reconnect_success`

**Level:** INFO
**Source:** `live/broker.py` — `reconnect()` and `live/main.py` — `_handle_disconnect()`
**Fires:** When reconnect succeeds

```json
{
  "attempt": 3,
  "host": "127.0.0.1",
  "port": 4002
}
```

---

### `reconnect_failed`

**Level:** CRITICAL
**Source:** `live/main.py` — `keepalive_ping()` and `_handle_disconnect()`
**Fires:** When all 5 reconnect attempts fail — system will wait 10 minutes and retry

```json
{
  "error": "ConnectionError: All 5 attempts failed",
  "next_retry_minutes": 10
}
```

> **After this event:** System sleeps 600 seconds, then `keepalive_ping()` is called again on the next tick. If IB Gateway recovered, reconnect will succeed. If not, another 5-attempt cycle begins.

---

### `post_reconnect_sync`

**Level:** INFO or WARNING
**Source:** `live/main.py` — after reconnect
**Fires:** After successful reconnect — system immediately syncs hourly bars to catch up missed data

```json
// INFO
{ "bars_upserted": 3, "symbol": "TQQQ" }

// WARNING (sync failed — non-fatal)
{ "error": "...", "symbol": "TQQQ" }
```

---

## Order Events

### `order_filled`

**Level:** INFO
**Source:** `live/broker.py` — `wait_for_fill()`
**Fires:** When IBKR reports status `"Filled"`

```json
{
  "order_id": "b3f2a1d0-...",
  "fill_price": 72.45,
  "fill_qty": 1382
}
```

---

### `order_cancelled`

**Level:** INFO
**Source:** `live/broker.py` — `wait_for_fill()`
**Fires:** When IBKR reports status `"Cancelled"` or `"Inactive"` before timeout

```json
{
  "order_id": "b3f2a1d0-..."
}
```

---

### `order_timeout`

**Level:** INFO
**Source:** `live/broker.py` — `wait_for_fill()`
**Fires:** When the fill poll loop times out (`fill_timeout_seconds`, default 30s) — the order is cancelled on IBKR and marked `expired` in `orders_live`

```json
{
  "order_id": "b3f2a1d0-...",
  "timeout_seconds": 30
}
```

---

### `order_expired`

**Level:** INFO
**Source:** `live/executor.py` — `handle_partial_fill()`
**Fires:** When a DAY limit order expires at market close with a partial fill — the unfilled remainder expired naturally

```json
{
  "order_id": "b3f2a1d0-...",
  "filled_qty": 500,
  "requested_qty": 1382,
  "fill_price": 72.45
}
```

---

### `cancel_on_timeout`

**Level:** WARNING
**Source:** `live/broker.py` — `wait_for_fill()` timeout handler
**Fires:** If an exception occurs while cancelling the order after timeout (the cancel itself failed — the order may still be live on IBKR)

```json
{
  "error": "Exception: ..."
}
```

> **Action required:** Log into IBKR TWS and manually verify the order was cancelled.

---

### `wait_for_fill`

**Level:** DEBUG
**Source:** `live/broker.py` — `wait_for_fill()` poll loop
**Fires:** Every 2 seconds while polling for fill status

```json
{
  "order_id": "b3f2a1d0-...",
  "status": "Submitted",
  "elapsed": 4.2
}
```

---

### `wait_for_fill_poll`

**Level:** WARNING
**Source:** `live/broker.py` — `wait_for_fill()` poll loop exception handler
**Fires:** When `ib.trades()` raises an exception during polling (non-fatal — poll continues)

```json
{
  "error": "Exception: ...",
  "elapsed": 6.0
}
```

---

### `partial_fill`

**Level:** WARNING
**Source:** `live/executor.py` — `handle_partial_fill()`
**Fires:** When an entry order fills fewer shares than requested — position opened at partial size

```json
{
  "order_id": "b3f2a1d0-...",
  "filled": 500,
  "requested": 1382,
  "fill_price": 72.45
}
```

---

### `partial_cancel_error`

**Level:** WARNING
**Source:** `live/executor.py` — `handle_partial_fill()`
**Fires:** If cancelling the remainder of a partial fill order fails

```json
{
  "error": "Exception: ...",
  "order_id": "b3f2a1d0-..."
}
```

---

## Position and Trade Events

### `reconcile`

**Level:** INFO
**Source:** `live/broker.py` — `reconcile_positions()`
**Fires:** At startup when IBKR position matches `trades_live` (within 1-share tolerance)

```json
{
  "msg": "Positions reconciled — 1382 shares match",
  "ibkr_shares": 1382,
  "db_shares": 1382
}
```

---

### `position_mismatch`

**Level:** CRITICAL
**Source:** `live/broker.py` — `reconcile_positions()`
**Fires:** At startup when IBKR position does not match `trades_live` — system aborts

```json
{
  "ibkr_shares": 1382,
  "db_shares": 0,
  "discrepancy": 1382,
  "msg": "POSITION MISMATCH — manual review required"
}
```

> **Action required:** Do NOT restart until the discrepancy is resolved manually. See [IB Control Operations](IB-Control-Operations.md#resolving-position-mismatch) for resolution steps.

---

### `stop_hit`

**Level:** CRITICAL
**Source:** `live/executor.py` — `monitor_stops()`
**Fires:** When the hourly bar's low (`TQQQ_1h.low`) breaches `stop_price`

```json
{
  "low": 68.91,
  "stop": 69.15,
  "shares": 1382,
  "exit_price": 69.15
}
```

**What happens next:** Market exit order placed immediately via `place_market_order()` with `reason="stop_hit"`.

---

## Circuit Breaker Events

Circuit breaker events are written to both `Events_log_live` and `circuit_breaker_live`. The `circuit_breaker_live` table records the full drawdown history.

**Level:** Matches alert level — WARNING / ERROR / CRITICAL
**Source:** `live/circuit_breaker.py` — `check_circuit_breaker()`

```json
// Level 1 — WARNING (10% drawdown)
{
  "drawdown_pct": 10.3,
  "strategy_equity": 89700,
  "session_capital": 100000,
  "threshold": 10,
  "level": 1
}

// Level 4 — STOP (20% drawdown → emergency_shutdown())
{
  "drawdown_pct": 20.1,
  "strategy_equity": 79900,
  "session_capital": 100000,
  "threshold": 20,
  "level": 4,
  "action": "emergency_shutdown"
}
```

| Alert | Level | Threshold | Repeats |
|-------|-------|-----------|---------|
| Level 1 | WARNING | 10% | Once per session |
| Level 2 | ERROR | 15% | Once per session |
| Level 3 | CRITICAL | 18% | Once per session |
| Level 4 | STOP | 20% | Every 5 min until resolved → `emergency_shutdown()` |

See [System Monitoring Guide](System-Monitoring-Guide.md#circuit-breaker) for full escalation details.

---

## Daily Loss Limit Events

### `daily_loss_warning`

**Level:** WARNING
**Source:** `live/main.py` — `check_daily_loss_limit()`
**Fires:** When today's NAV loss ≥ 50% of `max_daily_loss_pct` (default: 1.5%)

```json
{
  "loss_pct": 1.7,
  "threshold": 3.0
}
```

---

### `daily_loss_approaching`

**Level:** WARNING
**Source:** `live/main.py` — `check_daily_loss_limit()`
**Fires:** When today's NAV loss ≥ 75% of threshold (default: 2.25%)

```json
{
  "loss_pct": 2.4,
  "threshold": 3.0
}
```

---

### `daily_loss_limit`

**Level:** CRITICAL
**Source:** `live/main.py` — `check_daily_loss_limit()`
**Fires:** When today's NAV loss ≥ threshold (default: 3.0%) — triggers `emergency_shutdown()`

```json
{
  "loss_pct": 3.1,
  "threshold": 3.0,
  "start_equity": 102000,
  "current_equity": 98838
}
```

---

### `daily_loss_check`

**Level:** ERROR
**Source:** `live/main.py` — `check_daily_loss_limit()`
**Fires:** If the daily loss calculation itself fails (non-fatal — system continues without the check)

```json
{
  "error": "Exception: ..."
}
```

---

## Data Sync Events

### `sync_daily_db`

**Level:** INFO / WARNING / ERROR
**Source:** `live/data.py` — `sync_daily_db()`
**Fires:** After every daily bar sync from IBKR

```json
// INFO — bars upserted
{ "bars_upserted": 1, "fetch_days": 5, "last_date_before": "2026-03-28" }

// WARNING — IBKR returned no bars
{ "msg": "IBKR returned no daily bars", "fetch_days": 5, "last_date": "2026-03-28" }

// ERROR — fetch failed
{ "error": "Exception: ...", "fetch_days": 5, "last_date": "2026-03-28" }
```

---

### `sync_hourly_db`

**Level:** INFO / ERROR
**Source:** `live/data.py` — `sync_hourly_db()`
**Fires:** After every hourly bar sync from IBKR

```json
// INFO
{ "new_bars": 2, "latest_ts": "2026-03-30 14:00:00", "symbol": "TQQQ" }

// ERROR
{ "error": "Exception: ...", "symbol": "TQQQ" }
```

---

### `load_daily_bars_db`

**Level:** DEBUG / WARNING
**Source:** `live/data.py` — `load_daily_bars_db()`
**Fires:** When loading daily bars from `TQQQ_daily` to build the signal DataFrame

```json
// DEBUG — normal load
{ "rows_loaded": 250, "latest_date": "2026-03-30", "today_bar_appended": true }

// WARNING — table is empty
{ "msg": "TQQQ_daily is empty — run sync_daily_db() first" }
```

---

### `daily_sync_post_close`

**Level:** INFO / WARNING
**Source:** `live/main.py` — `_sync_daily_after_close()`
**Fires:** After 16:00 ET — system syncs today's closed daily bar to `TQQQ_daily`

```json
// INFO
{ "bars_upserted": 1, "date": "2026-03-30", "symbol": "TQQQ" }

// WARNING — non-fatal, will retry next off-hours tick
{ "error": "Exception: ...", "date": "2026-03-30" }
```

---

### `daily_equity_snapshot`

**Level:** WARNING
**Source:** `live/main.py` — `_sync_daily_after_close()`
**Fires:** If saving the EOD NAV snapshot to `daily_equity_live` fails

```json
{ "error": "Exception: ...", "date": "2026-03-30" }
```

> **Impact:** If this fails, tomorrow's `start_equity` for the daily loss limit will fall back to `get_strategy_equity()` using `session_capital` as the baseline instead of yesterday's actual NAV.

---

### `eod_sync_timeout`

**Level:** WARNING
**Source:** `live/main.py` — EOD sync watchdog
**Fires:** If the post-close daily sync takes more than 10 minutes (then forces disconnect)

```json
{ "timeout_minutes": 10, "date": "2026-03-30" }
```

---

### `eod_disconnect`

**Level:** INFO
**Source:** `live/main.py` — after successful EOD sync
**Fires:** When system cleanly disconnects from IB Gateway at end of day

```json
{ "msg": "Clean daily disconnect after EOD sync", "date": "2026-03-30" }
```

---

## Command Events

### `command`

**Level:** INFO
**Source:** `live/main.py` — `check_pending_commands()`
**Fires:** When a valid pending command is consumed from `live/commands/pending.json`

```json
// PAUSE
{ "action": "PAUSE", "paused": true }

// RESUME
{ "action": "RESUME", "paused": false }

// UPDATE_STOP
{ "action": "UPDATE_STOP", "trade_id": "t-abc...", "new_stop": 71.50, "old_stop": 69.15 }
```

---

### `command_unknown`

**Level:** WARNING
**Source:** `live/main.py` — `check_pending_commands()`
**Fires:** When `pending.json` contains an action not in `{PAUSE, RESUME, FORCE_CLOSE, UPDATE_STOP}`

```json
{ "action": "UNKNOWN_CMD", "raw": {"action": "UNKNOWN_CMD"} }
```

---

### `command_read`

**Level:** ERROR
**Source:** `live/main.py` — `check_pending_commands()`
**Fires:** If reading `pending.json` raises an `OSError`

```json
{ "error": "FileNotFoundError: ..." }
```

---

### `command_parse`

**Level:** ERROR
**Source:** `live/main.py` — `check_pending_commands()`
**Fires:** If `pending.json` contains invalid JSON

```json
{ "error": "JSONDecodeError: ...", "content": "{broken..." }
```

---

## Shutdown Events

### `shutdown`

**Level:** INFO
**Source:** `live/main.py` — `safe_shutdown()`
**Fires:** Twice — at the start and end of safe shutdown sequence

```json
// phase: starting
{ "phase": "starting", "session_id": "uuid..." }

// phase: complete
{ "phase": "complete", "session_id": "uuid..." }
```

---

### `shutdown_cancel`

**Level:** ERROR
**Source:** `live/main.py` — `safe_shutdown()`
**Fires:** If cancelling open orders during shutdown raises an exception

```json
{ "error": "Exception: ..." }
```

---

### `shutdown_position`

**Level:** ERROR
**Source:** `live/main.py` — `safe_shutdown()`
**Fires:** If reading the final position during shutdown raises an exception

```json
{ "error": "Exception: ..." }
```

---

### `final_position`

**Level:** INFO
**Source:** `live/main.py` — `safe_shutdown()`
**Fires:** Records position state at the moment of shutdown

```json
{
  "shares": 1382,
  "avg_cost": 71.23,
  "unrealised_pnl": 1724.50,
  "stop_price": 69.15
}
```

---

### `disconnect_error`

**Level:** WARNING
**Source:** `live/main.py` — `safe_shutdown()`
**Fires:** If `ib.disconnect()` raises during shutdown (non-fatal)

```json
{ "error": "Exception: ..." }
```

---

### `emergency_close_failed`

**Level:** CRITICAL
**Source:** `live/main.py` — `emergency_shutdown()`
**Fires:** If the emergency market close order itself fails — this is worst-case: position open, system shutting down

```json
{ "error": "Exception: ..." }
```

> **Action required:** Log into IBKR TWS immediately and close position manually.

---

### `lock_file_write`

**Level:** ERROR
**Source:** `live/main.py` — `emergency_shutdown()`
**Fires:** If writing `live/emergency.lock` fails — system still exits, but startup won't be blocked

```json
{ "error": "OSError: ..." }
```

---

## System Events

### `unhandled_exception`

**Level:** ERROR
**Source:** `live/main.py` — main loop exception handler
**Fires:** When an exception reaches the top-level catch in the main loop (system continues to next tick)

```json
{
  "error": "Exception message",
  "traceback": "Traceback (most recent call last):\n  ..."
}
```

---

### `sleep_bar`

**Level:** DEBUG
**Source:** `live/main.py` — `sleep_until_next_bar()`
**Fires:** Once per tick, just before sleeping until the next hourly bar

```json
{
  "sleep_seconds": 3555.3,
  "next_bar_et": "15:00"
}
```

---

### `market_calendar`

**Level:** WARNING
**Source:** `live/main.py` — `market_is_open()`
**Fires:** If the holiday calendar library is unavailable — system falls back to weekday-only check

```json
{ "msg": "Holiday calendar not available — using weekday check only" }
```

---

## Validation Events

### `signal_mismatch`

**Level:** WARNING
**Source:** `live/validate.py` — `validate_signal_match()`
**Fires:** When `engine.evaluate()` produces a different signal than `signals_live` records for a historical date

```json
{
  "date": "2026-03-28",
  "backtest": "BUY",
  "live": "HOLD"
}
```

> **Typical cause:** Data adjustment factors updated since the live signal was evaluated, or config changed between sessions. See [IB Control Operations](IB-Control-Operations.md#signal-mismatch) for resolution guidance.

---

## session_events_live Event Types

These are the high-level timeline events shown in the GUI Overview tab. Written by `log_session_event()` in `main.py` only.

| `event_type` | Level | When |
|-------------|-------|------|
| `market_open` | INFO | First tick when `market_is_open()` returns True for the day |
| `market_close` | INFO | `KeyboardInterrupt` received — safe shutdown initiated |
| `sync` | INFO / ERROR | After each `sync_hourly_db()` call |
| `stop_update` | INFO | When ratchet stop moves up: `new_stop != old_stop` |
| `signal` | INFO | After `engine.evaluate()` — shows action and reason |
| `reconnect` | INFO / ERROR / CRITICAL | IB Gateway reconnect events (mirrors Events_log_live) |
| `unhandled_exception` | ERROR | When exception reaches the main loop catch |

**`signal` event example summary string:**
```
Signal evaluated: BUY — long_entry
Signal evaluated: HOLD — in_position
Signal evaluated: SELL — exit_signal
```

---

## Monitoring Queries

**Most recent events:**
```sql
SELECT timestamp, level, event_type, details
FROM Events_log_live
ORDER BY timestamp DESC
LIMIT 30;
```

**Today's CRITICAL events:**
```sql
SELECT timestamp, event_type, details
FROM Events_log_live
WHERE level = 'CRITICAL'
  AND date(timestamp) = date('now')
ORDER BY timestamp;
```

**Connection health — last ping:**
```sql
SELECT MAX(timestamp) AS last_ping
FROM Events_log_live
WHERE event_type = 'connection_ok';
```

**Order lifecycle for a specific order:**
```sql
SELECT timestamp, level, event_type, details
FROM Events_log_live
WHERE details LIKE '%b3f2a1d0%'  -- replace with order_id fragment
ORDER BY timestamp;
```

**Today's session timeline:**
```sql
SELECT timestamp, level, event_type, summary
FROM session_events_live
WHERE date(timestamp) = date('now')
ORDER BY timestamp;
```

**Circuit breaker history:**
```sql
SELECT timestamp, level, drawdown_pct, nav, starting_capital, message
FROM circuit_breaker_live
ORDER BY timestamp DESC;
```

---

## Related Pages

- [Live Trading Engine](Live-Trading-Engine.md) — main loop where most events are generated
- [System Monitoring Guide](System-Monitoring-Guide.md) — using these events to monitor system health
- [IB Control Operations](IB-Control-Operations.md) — operator response to WARNING/CRITICAL events
- [Database Schema](Database-Schema.md) — full `Events_log_live` and `session_events_live` column definitions
- [Dashboard Guide](Dashboard-Guide.md#screen-9--session-analysis-system-log) — GUI screens that display these events
