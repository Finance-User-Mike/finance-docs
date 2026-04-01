# Live Trading Reference

Every public function in the live trading modules, with signatures, parameters, returns, and critical rules.

Modules covered: `live/main.py`, `live/executor.py`, `live/validate.py`, `live/logger.py`, `live/circuit_breaker.py`

---

## live/main.py

Orchestration loop. Imports from `engine/` only. Never imported by `backtest/` or `gui/`.

---

### `startup(config, db_path)`

```python
def startup(config: Config, db_path: str = "trading.db") -> IB
```

Called once when the live system boots. Returns a connected IB instance ready for the main loop.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | Loaded config with live section populated |
| `db_path` | `str` | Path to trading.db |

**Returns:** Connected `IB` object (ib_insync)

**Steps:**
1. Check `live/emergency.lock` — raises `SystemExit` if present
2. Connect to IB Gateway (up to 20 attempts × 30s)
3. `validate_account_environment()` — confirms paper/live account type
4. `register_disconnect_handler()` — hooks `ib.disconnectedEvent`
5. `reconcile_positions()` — aborts on mismatch
6. `reset_alert_state()` — clears CB alert flags

**Raises:** `SystemExit` on emergency lock or all connect attempts fail, position mismatch.

---

### `run_live_loop(config, db_path)`

```python
def run_live_loop(config: Config, db_path: str = "trading.db") -> None
```

Main orchestration loop — runs until `KeyboardInterrupt` or fatal error.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | Loaded configuration |
| `db_path` | `str` | Path to trading.db |

**Returns:** None

**Loop sequence (every `interval_minutes`):**
1. `keepalive_ping()` — IB connection check
2. If market closed: sleep 5 min, continue
3. `check_pending_commands()` — consume `pending.json`
4. `check_circuit_breaker()` — emergency shutdown if fired
5. `sync_hourly_db()` — fetch new TQQQ_1h bars
6. `get_position()` — current IBKR + DB position
7. `_update_ratchet_stop()` — recalculate ratchet if in position
8. `monitor_stops()` — exit on stop hit
9. `is_signal_time()` → `evaluate()` → `act()` (once per day at signal_time)
10. `write_hourly_snapshot_live()` — write indicator snapshot to DB
11. `sleep_until_next_bar()` — sleep with IB keepalive pings

**Exception handling:** `IBConnectionError` → reconnect. `KeyboardInterrupt` → `safe_shutdown()`. Other exceptions → log ERROR and continue (never crash).

---

### `should_connect_today()`

```python
def should_connect_today() -> bool
```

Returns `True` only if today is a trading day (weekday + not a NYSE holiday). Called before connecting to IB Gateway — the system stays fully offline on non-trading days.

**Returns:** `True` = trading day, `False` = weekend or holiday

Uses `pandas_market_calendars` for the NYSE holiday list. Falls back to weekday-only check if not installed.

---

### `market_is_open(config)`

```python
def market_is_open(config: Config) -> bool
```

Returns `True` if current ET time is within market hours on a trading day.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | Uses `live.market_open` and `live.market_close` |

**Returns:** `True` = market is open and trading is allowed

**Checks:** Weekday check → time window (market_open ≤ now < market_close) → NYSE holiday check via `pandas_market_calendars`.

---

### `is_signal_time(config)`

```python
def is_signal_time(config: Config) -> bool
```

Returns `True` if current ET time is within ±2 minutes of `config.live.signal_time`. Fires at most once per calendar day via module-level `_signal_fired_date` flag.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | Uses `live.signal_time` (e.g., `"15:00"`) |

**Returns:** `True` = evaluate signal now. `False` = already fired today or not signal window.

**Critical:** The date-lock (`_signal_fired_date`) is a module-level variable. Once set to today, this function always returns `False` until the next calendar day.

---

### `keepalive_ping(ib, config, db_path)`

```python
def keepalive_ping(ib, config: Config, db_path: str = "trading.db") -> None
```

Sends `reqCurrentTime()` to IBKR to keep the connection alive. DB write throttled to once per hour. Attempts reconnect on failure.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Connected ib_insync IB object |
| `config` | `Config` | For reconnect config |
| `db_path` | `str` | For event logging |

**Side effects:** Writes `connection_ok` to `Events_log_live` once per hour. Writes heartbeat to `process_heartbeat` table every call. Calls `reconnect()` on ping failure.

---

### `sleep_until_next_bar(config, tick_start, db_path, ib)`

```python
def sleep_until_next_bar(
    config: Config, tick_start: datetime,
    db_path: str = "trading.db", ib=None,
) -> None
```

Sleeps until the next `interval_minutes` boundary, sending IB pings every 2 minutes during sleep to prevent NAT timeout.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | Uses `live.interval_minutes` |
| `tick_start` | `datetime` | When the current tick started (ET) |
| `db_path` | `str` | For debug event logging |
| `ib` | `IB` | For keepalive pings during sleep |

**Sleep duration:** `max(0, interval_seconds - elapsed_processing_time)`

---

### `check_daily_loss_limit(ib, config, db_path, session_id, start_equity)`

```python
def check_daily_loss_limit(
    ib, config: Config, db_path: str,
    session_id: str = "", start_equity: float = 0.0,
) -> None
```

Compares current IBKR NAV to session-start equity. Triggers `emergency_shutdown()` if loss exceeds `max_daily_loss_pct`.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | For reading `accountSummary()["NetLiquidation"]` |
| `config` | `Config` | Uses `live.max_daily_loss_pct` |
| `db_path` | `str` | For event logging and NAV snapshot write |
| `session_id` | `str` | For event correlation |
| `start_equity` | `float` | Baseline NAV from session start |

**Side effects:** Writes NAV to `nav_snapshots` table on every call. Calls `emergency_shutdown()` when limit hit.

---

### `check_pending_commands(ib, config, db_path)`

```python
def check_pending_commands(ib, config: Config, db_path: str = "trading.db") -> None
```

Reads `live/commands/pending.json`, executes the command, and deletes the file. Commands: `FORCE_CLOSE`, `PAUSE`, `RESUME`, `UPDATE_STOP`.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Required for FORCE_CLOSE (places market order) |
| `config` | `Config` | For order placement config |
| `db_path` | `str` | For DB writes and event logging |

**Side effects:** Modifies module-level `_paused` flag. Places market orders (FORCE_CLOSE). Updates `trades_live.stop_price` (UPDATE_STOP). File is deleted after reading.

---

### `safe_shutdown(ib, config, session_id, db_path, config_log_id)`

```python
def safe_shutdown(
    ib, config: Config, session_id: str,
    db_path: str, config_log_id: int = 0,
) -> None
```

Planned exit — cancels pending orders, logs final state, updates DB, disconnects.

**Steps:**
1. Cancel all pending limit orders
2. Log final position to `Events_log_live`
3. Update `config_log_live`: `stopped_at=now, status=inactive`
4. Disconnect IBKR

**Does NOT close open positions.** Existing stops continue on next session.

---

### `emergency_shutdown(ib, config, session_id, db_path, reason)`

```python
def emergency_shutdown(
    ib, config: Config, session_id: str,
    db_path: str, reason: str = "unknown",
) -> None
```

Immediate exit — closes all positions via market order, writes `live/emergency.lock`, disconnects.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | For placing market orders and disconnect |
| `config` | `Config` | For order placement |
| `session_id` | `str` | For event correlation |
| `db_path` | `str` | For event logging |
| `reason` | `str` | Human-readable reason (stored in lock file) |

**Steps:**
1. Market order to close all open positions
2. Write `live/emergency.lock` with `{timestamp, reason}`
3. Update `config_log_live` to `status=crashed`
4. Log `CRITICAL emergency_shutdown` event
5. Disconnect IBKR

**System will not restart until `live/emergency.lock` is manually deleted.**

---

## live/executor.py

Translates engine signals into broker orders. Monitors intraday stops.

---

### `act(signal, position, ib, config, db_path)`

```python
def act(
    signal, position: dict, ib, config: Config,
    db_path: str = "trading.db",
) -> None
```

Translates an engine `SignalResult` into a broker order.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `signal` | `SignalResult` | From `engine.signals.evaluate()` |
| `position` | `dict` | From `get_position()` |
| `ib` | `IB` | Connected IB object |
| `config` | `Config` | For order placement and sizing |
| `db_path` | `str` | For DB writes |

**Logic:**

| Signal | Condition | Action |
|--------|-----------|--------|
| BUY | `position["shares"] == 0` | Limit order at `proxy_close + $0.05`, wait for fill, write `trades_live` row |
| SELL | `position["shares"] > 0` | Market order, wait for fill, close `trades_live` row |
| HOLD | Any | Log to `signals_live` only — no order |

**Side effects:** Writes to `signals_live` (every call). Writes/updates `trades_live` (on BUY/SELL). Places orders via `place_limit_order()` / `place_market_order()`.

---

### `monitor_stops(position, ib, config, db_path)`

```python
def monitor_stops(
    position: dict, ib, config: Config,
    db_path: str = "trading.db",
) -> None
```

Checks intraday stop on every hourly bar. If the latest `TQQQ_1h.low ≤ stop_price`, places a market exit order.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `position` | `dict` | Must contain `shares` and `stop_price` |
| `ib` | `IB` | For market order placement |
| `config` | `Config` | For order config |
| `db_path` | `str` | For TQQQ_1h read and DB writes |

**Returns:** None (no-op if `position["shares"] == 0` or `stop_price` is None)

**Side effects:** Places market order. Calls `wait_for_fill()`. Closes `trades_live` row. Logs `CRITICAL stop_hit` event.

---

### `handle_partial_fill(order_id, fill_qty, fill_price, config, db_path, ib)`

```python
def handle_partial_fill(
    order_id: str, fill_qty: int, fill_price: float,
    config: Config, db_path: str = "trading.db", ib=None,
) -> None
```

Handles a limit order that only partially filled by EOD.

**Steps:**
1. Cancel remaining unfilled portion on IBKR
2. Update `orders_live`: `status=partial` (if any fill) or `status=expired` (if no fill)
3. If `fill_qty > 0`: create `trades_live` entry for the filled shares with hard stop
4. Log WARNING

---

### `calc_ratchet_stop(position, current_high, atr, config)`

```python
def calc_ratchet_stop(
    position: dict, current_high: float, atr: float, config: Config
) -> float
```

Calculates the updated ratchet stop — only moves in trade's favour, never against.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `position` | `dict` | Must contain `stop_price` |
| `current_high` | `float` | Latest bar's high price |
| `atr` | `float` | Current ATR(45) value |
| `config` | `Config` | Uses `symbol_config().atr_multiplier` |

**Formula:**
```
new_stop = current_high - (atr × atr_multiplier)
return max(new_stop, position["stop_price"])   # NEVER decreases
```

**Returns:** New stop price (≥ current stop)

**Critical invariant:** The returned value is always ≥ `position["stop_price"]`. This is the live equivalent of the backtest ratchet. See [Ref-Engine-Core — risk.py](Ref-Engine-Core.md#riskpy) for the same rule in backtest.

---

## live/validate.py

Pre-flight readiness checks and live-vs-backtest signal validation.

---

### `run_readiness_check(config, db_path)`

```python
def run_readiness_check(config: Config, db_path: str = "trading.db") -> bool
```

Runs all 5 pre-flight checks. Returns `True` only if all pass.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | For IB port, mode, and data file |
| `db_path` | `str` | For DB write test |

**Returns:** `True` = all checks pass, `False` = one or more failed

**Checks:**

| Check | What is tested | Passing condition |
|-------|---------------|------------------|
| 1 | IB Gateway reachable | TCP connect to `ibkr_host:ibkr_port` within 5s |
| 2 | Config valid | `mode` ∈ {paper/live}, port matches mode (4002/4001) |
| 3 | DB writable | INSERT + DELETE test row in `Events_log_live` succeeds |
| 4 | Hourly data fresh | Last `TQQQ_1h` timestamp within 72 hours |
| 5 | Mode confirmation | Paper = auto-pass. Live = user must type `"I CONFIRM LIVE TRADING"` |

**Side effects:** Prints each check result to stdout.

---

### `validate_signal_match(config, db_path, check_days)`

```python
def validate_signal_match(
    config: Config, db_path: str = "trading.db", check_days: int = 5,
) -> bool
```

Confirms live signals match backtest engine for the last `check_days` sessions.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | For CSV path and indicator settings |
| `db_path` | `str` | For reading `signals_live` |
| `check_days` | `int` | How many recent days to validate |

**Returns:** `True` = all signals match, `False` = at least one mismatch

**How it works:**
1. Read last `check_days` rows from `signals_live`
2. For each date: load CSV bars up to that date, run `engine.evaluate()`
3. Compare backtest action vs logged live action
4. Print comparison table; log WARNING for each mismatch

**Side effects:** Prints comparison table. Logs WARNING events to `Events_log_live` for mismatches.

---

## live/logger.py

Three-handler structured logging for live sessions.

---

### `setup_logger(session_id, log_dir, db_path)`

```python
def setup_logger(
    session_id: str, log_dir: str = "logs",
    db_path: str = "trading.db",
) -> logging.Logger
```

Configure Python logging for a live trading session with three handlers.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `session_id` | `str` | UUID for this session — used as logger name |
| `log_dir` | `str` | Directory for log file |
| `db_path` | `str` | For DB handler |

**Returns:** Configured `logging.Logger`

**Handlers:**

| Handler | Destination | Level | Notes |
|---------|-------------|-------|-------|
| `_SizeRotatingHandler` | `logs/live_main.log` | DEBUG | Rotates at 3 MB with timestamp backup name |
| `StreamHandler` | stdout | INFO | ANSI colour by level |
| `_DBHandler` | `Events_log_live` | WARNING | Writes WARNING+ records to DB |

**Safe to call multiple times** — clears existing handlers before adding new ones.

---

### `log_event(db_path, level, event_type, details, symbol, session_id)`

```python
def log_event(
    db_path: str, level: str, event_type: str,
    details: dict, symbol: str | None = None,
    session_id: str | None = None,
) -> None
```

Write one row to `Events_log_live`. **Never raises** — DB write failures print to stderr.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `db_path` | `str` | Path to trading.db |
| `level` | `str` | `"DEBUG"` / `"INFO"` / `"WARNING"` / `"ERROR"` / `"CRITICAL"` |
| `event_type` | `str` | Event category string (e.g., `"signal"`, `"stop_hit"`) |
| `details` | `dict` | Event payload — serialised to JSON |
| `symbol` | `str \| None` | Trading symbol (e.g., `"TQQQ"`) |
| `session_id` | `str \| None` | Session UUID for correlation |

**Timestamp:** Singapore Time (SGT, UTC+8). Stored as `YYYY-MM-DD HH:MM:SS.ffffff`.

---

### `log_session_event(db_path, level, event_type, summary, details, ...)`

```python
def log_session_event(
    db_path: str, level: str, event_type: str, summary: str,
    details: dict, symbol: str | None = None,
    session_id: str | None = None, duration_ms: float | None = None,
) -> None
```

Write one row to `session_events_live`. Plain-English `summary` for the GUI timeline. `details` dict for JSON drill-down.

**Never raises** — failures print to stderr.

---

### `write_hourly_snapshot_live(db_path, tick_time, session_id, symbol, indicators, signal, signal_reason, position, config)`

```python
def write_hourly_snapshot_live(
    db_path: str, tick_time: str, session_id: str, symbol: str,
    indicators: dict, signal: str, signal_reason: str,
    position: dict, config,
) -> None
```

Write one row to `hourly_snapshot_live` for the current market tick.

**`indicators` dict must contain:** `close`, `vwap`, `ema`, `atr`, `atr_multiplier`

**`position` dict:** `shares`, `side`, `entry_price`, `stop_price`

**Computed values written:**
- `close_vs_vwap` = `close - vwap`
- `close_vs_ema` = `close - ema`
- `unrealised_pnl` = `(close - entry_price) × shares × direction_multiplier`
- `hard_stop` = `entry_price × (1 - hard_stop_pct)` for long

**Never raises** — failures print to stderr.

---

## live/circuit_breaker.py

Portfolio-level drawdown protection.

---

### `check_circuit_breaker(ib, starting_capital, db_path, session_id)`

```python
def check_circuit_breaker(
    ib, starting_capital: float,
    db_path: str = "trading.db", session_id: str = "",
) -> bool
```

Check strategy equity drawdown and fire escalating alerts.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Not used for equity calc (DB-based) — legacy parameter |
| `starting_capital` | `float` | Session capital (`config.live.session_capital`) |
| `db_path` | `str` | For DB equity calc and event writes |
| `session_id` | `str` | For event correlation |

**Returns:** `True` = STOP level (20%) triggered — caller must emergency shutdown. `False` = below stop threshold.

**Alert levels:**

| Level | Threshold | Fires |
|-------|----------|-------|
| WARNING | ≥ 10% | Once per session |
| ERROR | ≥ 15% | Once per session |
| CRITICAL | ≥ 18% | Once per session |
| STOP | ≥ 20% | Every 5 min + returns True |

---

### `get_strategy_equity(db_path, session_capital, include_unrealised)`

```python
def get_strategy_equity(
    db_path: str, session_capital: float, include_unrealised: bool = True,
) -> float
```

Return current strategy equity from DB — never reads IBKR account NAV.

**Formula:**
```
equity = session_capital
       + SUM(all closed trades pnl_dollar WHERE exit_date IS NOT NULL)
       + unrealised_pnl  (if include_unrealised=True)
```

**`unrealised_pnl`:** `(TQQQ_1h.close_latest - entry_price) × shares` for open trade.

**Returns:** Rounded float. Falls back to `session_capital` on any DB error.

**Called by:** `check_circuit_breaker()`, `executor._get_equity()`, `main.py` for daily snapshots.

---

### `reset_alert_state()`

```python
def reset_alert_state() -> None
```

Reset in-memory alert flags. Call once in `startup()` before each session.

**Side effects:** Sets all `_alerts_fired` to `False`. Sets `_last_stop_alert_time` to `None`.

---

## Related Pages

- [Live Trading Engine](Live-Trading-Engine.md) — how these functions are called in the main loop
- [Ref-IB-Broker](Ref-IB-Broker.md) — `broker.py` function reference (connect, orders, position)
- [IB Control Operations](IB-Control-Operations.md) — operational usage of these functions
- [Session Log Reference](Session-Log-Reference.md) — all `event_type` values in `log_event()`
- [Ref-Engine-Core](Ref-Engine-Core.md) — `evaluate()` and `calc_ratchet_stop()` called from executor
