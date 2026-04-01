# IB Broker Reference

Every public function in `live/broker.py` — the IBKR order management layer.

Source file: [03-Live/live/broker.py](../../03-Live/live/broker.py)

All functions in this module enforce `_safety_check()` before any order. Never import `os.environ` directly — use `live/config.py` for environment variables.

---

## Connection Functions

### `connect(config, db_path)`

```python
def connect(config: Config, db_path: str = "trading.db") -> IB
```

Connect to IB Gateway, validate the account type, and log balance on connect.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `config` | `Config` | Uses `live.ibkr_host`, `live.ibkr_port`, `live.ibkr_client_id` |
| `db_path` | `str` | For event logging |

**Returns:** Connected `IB` object

**Side effects:**
- Logs account number and net liquidation value to stdout
- Calls `connect_ibkr()` from `live/data.py` for the actual ib_insync connection

**Raises:** `ConnectionError` if Gateway unreachable after all client ID attempts.

---

### `get_ib_connection()`

```python
def get_ib_connection() -> IB
```

Lower-level connector — tries client IDs 2 through 6 to handle stale Gateway reservations.

**Returns:** Connected `IB` object

**Why auto-try client IDs:** IB Gateway reserves a client ID slot when a session disconnects uncleanly. The slot may stay reserved as a "ghost" for up to 30 seconds. Trying IDs 2–6 immediately avoids that wait.

**Timeout:** 10 seconds per client ID attempt.

**Raises:** `ConnectionError` if all 5 client ID attempts fail.

---

### `reconnect(ib, config, db_path)`

```python
def reconnect(ib, config: Config, db_path: str = "trading.db") -> IB
```

Attempt reconnect after a disconnect. 5 attempts × 15s apart.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Existing (possibly disconnected) IB object |
| `config` | `Config` | For reconnect configuration |
| `db_path` | `str` | For logging each attempt and outcome |

**Returns:** Reconnected `IB` object

**Side effects:** Logs each attempt and outcome to `Events_log_live`.

**Raises:** `ConnectionError` if all 5 attempts fail. Caller (`keepalive_ping`) catches this and waits 10 minutes.

---

### `ensure_connected(ib, db_path)`

```python
def ensure_connected(ib: IB, db_path: str = "trading.db") -> bool
```

Verify connection is live before critical IBKR operations. Used as a guard in the main loop.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Connected or disconnected IB object |
| `db_path` | `str` | For reconnect event logging |

**Returns:** `True` = connected and ready, `False` = all retries exhausted (caller should trigger shutdown)

---

### `register_disconnect_handler(ib, db_path)`

```python
def register_disconnect_handler(ib: IB, db_path: str = "trading.db") -> None
```

Hook into `ib_insync.disconnectedEvent` — fires immediately on Gateway drop.

**Side effects:** Attaches `on_disconnected()` callback to `ib.disconnectedEvent`. The callback logs WARNING to `Events_log_live`. Does not attempt reconnect — that is `keepalive_ping()`'s responsibility.

**Call once after** `get_ib_connection()` in startup.

---

### `validate_account_environment(ib, config)`

```python
def validate_account_environment(ib: IB, config: Config) -> None
```

Confirm connected account type matches `config.live.is_paper_trading`. Called once in `startup()`.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Connected IB object |
| `config` | `Config` | Uses `live.is_paper_trading` (derived from mode) |

**Returns:** None (silent success)

**Account type detection:**
- Paper accounts: managed account ID starts with `"DU"`
- Live accounts: managed account ID starts with `"U"` (but not `"DU"`)

**Raises:** `RuntimeError` if connected account type does not match expected. This aborts startup — trading on the wrong account is prevented at the connection stage.

---

## Order Functions

All order functions call `_safety_check()` first. The check enforces:
- `mode=paper` → must use port 4002
- `mode=live` → must use port 4001

If the check fails, `RuntimeError` is raised before any IBKR call is made.

---

### `place_limit_order(ib, config, action, shares, limit_price, reason, db_path)`

```python
def place_limit_order(
    ib, config: Config, action: str, shares: int,
    limit_price: float, reason: str, db_path: str = "trading.db",
) -> str
```

Place a DAY limit order for entry. Records to `orders_live` immediately.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Connected IB object |
| `config` | `Config` | Uses `live.symbol`, `live.exchange`, `live.currency`, `live.mode`, `live.ibkr_port` |
| `action` | `str` | `"BUY"` or `"SELL"` |
| `shares` | `int` | Number of shares |
| `limit_price` | `float` | Limit price in dollars |
| `reason` | `str` | Human label stored in `orders_live.reason` |
| `db_path` | `str` | For `orders_live` insert |

**Returns:** `order_id` (UUID string) — local order identifier

**Order type:** DAY limit (`tif="DAY"`) — expires at market close if unfilled.

**Entry price convention:** Called by `act()` with `limit_price = proxy_close + $0.05` — a small buffer above the last known close to improve fill probability.

**Side effects:**
- Calls `_safety_check()` — raises if port/mode mismatch
- Inserts row into `orders_live` with `status="pending"`
- Prints confirmation to stdout

---

### `place_market_order(ib, config, action, shares, reason, db_path)`

```python
def place_market_order(
    ib, config: Config, action: str, shares: int,
    reason: str, db_path: str = "trading.db",
) -> str
```

Place a market order for stop hits and emergency exits. Records to `orders_live` immediately.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | Connected IB object |
| `config` | `Config` | Uses symbol, exchange, currency, mode, port |
| `action` | `str` | `"BUY"` or `"SELL"` |
| `shares` | `int` | Number of shares |
| `reason` | `str` | E.g., `"stop_hit"`, `"signal_exit"`, `"emergency_shutdown"`, `"force_close"` |
| `db_path` | `str` | For `orders_live` insert |

**Returns:** `order_id` (UUID string)

**Why market orders for exits:** Stop hits and emergencies require guaranteed execution. A limit order could fail to fill in a fast-moving market. Slippage on exit is acceptable; missing the exit is not.

**Side effects:**
- Calls `_safety_check()`
- Inserts row into `orders_live` with `status="pending"`
- Prints confirmation to stdout

---

### `wait_for_fill(ib, order_id, config, db_path)`

```python
def wait_for_fill(
    ib, order_id: str, config: Config,
    db_path: str = "trading.db",
) -> dict | None
```

Poll IBKR until the order is filled, cancelled, or timed out.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | For `ib.trades()` polling |
| `order_id` | `str` | Local UUID — looked up to get `ibkr_order_id` |
| `config` | `Config` | Uses `live.fill_timeout_seconds` |
| `db_path` | `str` | For `orders_live` updates |

**Returns:**
- On fill: `{"fill_price": float, "fill_qty": int, "fill_time": str}`
- On cancel/timeout: `None`

**Polling:** Every 2 seconds up to `fill_timeout_seconds` (default 30).

**On timeout:** Cancels the remaining order on IBKR, updates `orders_live` to `status="expired"`.

**Status transitions:**

| IBKR status | `orders_live` update | Return |
|-------------|---------------------|--------|
| `"Filled"` | `status="filled"`, fill details | Fill dict |
| `"Cancelled"` | `status="cancelled"` | `None` |
| `"Inactive"` | `status="cancelled"` | `None` |
| Timeout | Cancel on IBKR, `status="expired"` | `None` |

---

## Position Functions

### `get_position(ib, config, db_path)`

```python
def get_position(
    ib, config: Config, db_path: str = "trading.db"
) -> dict
```

Return current TQQQ position merging IBKR live data with `trades_live` stop information.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | For `ib.positions()` |
| `config` | `Config` | Uses `live.symbol` |
| `db_path` | `str` | For `trades_live` query |

**Returns:** Position dict

**Dict keys:**

| Key | Source | Description |
|-----|--------|-------------|
| `shares` | IBKR | Current shares held (0 = no position) |
| `avg_cost` | IBKR | Average cost basis per share |
| `unrealised_pnl` | IBKR | Mark-to-market P&L |
| `entry_price` | `trades_live` | Strategy entry price |
| `stop_price` | `trades_live` | Current ratchet stop (None if no position) |
| `trade_id` | `trades_live` | UUID of the open trade row |
| `entry_date` | `trades_live` | Date of entry |
| `entry_order_id` | `trades_live` | Order ID of the entry order |

When `shares == 0`, only `{"shares": 0, "avg_cost": 0.0, "unrealised_pnl": 0.0}` is returned.

**Why two sources?** IBKR is authoritative for position size and cost basis. `trades_live` is the only place strategy stop prices and trade IDs are stored — IBKR has no knowledge of the ratchet stop mechanism.

---

### `reconcile_positions(ib, config, db_path)`

```python
def reconcile_positions(
    ib, config: Config, db_path: str = "trading.db",
) -> bool
```

Compare IBKR live positions vs open `trades_live` records. Called once on every startup.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `ib` | `IB` | For `ib.positions()` |
| `config` | `Config` | Uses `live.symbol` |
| `db_path` | `str` | For `trades_live` query |

**Returns:** `True` = positions reconciled (within 1-share tolerance), `False` = mismatch detected

**Tolerance:** 1-share difference is allowed (integer rounding in partial fills).

**On mismatch:** Logs `CRITICAL position_mismatch` to `Events_log_live`. Prints discrepancy to stdout. Returns `False` → `startup()` aborts. **Never auto-corrects.**

---

## Internal Safety Function

### `_safety_check(config)`

```python
def _safety_check(config: Config) -> None
```

Enforce mode/port pairing before any order. Internal — called by all order functions.

**Raises:** `RuntimeError` with descriptive message on any mismatch:

```
Safety violation: mode=paper but ibkr_port=4001.
Paper trading requires port 4002 (Gateway).
```

| mode | Required port | Raises if wrong |
|------|--------------|----------------|
| `"paper"` | `4002` | `ibkr_port ≠ 4002` |
| `"live"` | `4001` | `ibkr_port ≠ 4001` |

---

## `orders_live` Schema Reference

Every order placement writes to `orders_live`:

```sql
CREATE TABLE orders_live (
    order_id       TEXT PRIMARY KEY,    -- local UUID
    ibkr_order_id  INTEGER,             -- IBKR assigned order ID
    symbol         TEXT,                -- e.g. "TQQQ"
    side           TEXT,                -- "BUY" or "SELL"
    order_type     TEXT,                -- "LIMIT" or "MARKET"
    qty            INTEGER,             -- requested shares
    limit_price    REAL,                -- NULL for market orders
    status         TEXT,                -- pending → filled/cancelled/expired/partial
    fill_price     REAL,                -- actual average fill price
    fill_qty       INTEGER,             -- actual shares filled
    fill_time      TEXT,                -- ISO datetime of fill
    reason         TEXT,                -- e.g. "entry", "stop_hit", "signal_exit"
    mode           TEXT,                -- "paper" or "live"
    created_at     TEXT,                -- ISO datetime
    updated_at     TEXT                 -- ISO datetime
)
```

**`reason` values used in the system:**

| Reason | When |
|--------|------|
| `"entry"` | New position entry via limit order |
| `"signal_exit"` | Exit triggered by daily signal (SELL signal or HOLD with reversal) |
| `"stop_hit"` | Exit triggered by `monitor_stops()` when hourly bar breaches stop |
| `"emergency_shutdown"` | Exit triggered by `emergency_shutdown()` |
| `"force_close"` | Exit triggered by `FORCE_CLOSE` pending command |

---

## Related Pages

- [IB Gateway Integration](IB-Gateway-Integration.md) — connection architecture, port reference
- [IB Control Operations](IB-Control-Operations.md) — operational procedures
- [Ref-Live-Trading](Ref-Live-Trading.md) — executor.py, main.py, validate.py, logger.py
- [Database Schema](Database-Schema.md) — full `orders_live` and `trades_live` schema
- [Config Reference](Config-Reference.md) — `live.*` parameters used by broker functions
