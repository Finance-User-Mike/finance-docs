# IB Gateway Integration

How the system connects to Interactive Brokers, the port architecture, account validation, and reconnection handling.

Source files: [03-Live/live/broker.py](../../03-Live/live/broker.py), [03-Live/live/config.py](../../03-Live/live/config.py)

---

## Connection Architecture

```
IB Gateway (local machine)
    ├─ Port 4002  ← Paper trading account (DU-prefix account ID)
    └─ Port 4001  ← Live trading account  (U-prefix account ID)

ib_insync library
    └─ IB() object — asyncio-based TWS/Gateway client

live/broker.py
    ├─ connect()             → wraps connect_ibkr() from live/data.py
    ├─ get_ib_connection()   → tries clientIds 2–6 for IB slot availability
    ├─ reconnect()           → 5 attempts × 15s apart
    ├─ _safety_check()       → port/mode enforcement on every order
    └─ validate_account_environment() → paper/live account type confirmation
```

---

## Port Reference

| Port | Service | When to use |
|------|---------|------------|
| `4001` | IB Gateway — **live** account | `ENV=live`, `ALLOW_LIVE_PORT=true` |
| `4002` | IB Gateway — **paper** account | `ENV=dev` or `ENV=preprod` (default) |
| `7496` | TWS Desktop — live account | Legacy; not used — Gateway preferred |
| `7497` | TWS Desktop — paper account | Legacy; not used — Gateway preferred |

**Always use IB Gateway, not TWS.** Gateway is designed for API connections and runs headless without a GUI. TWS requires a logged-in desktop session and may disconnect during 11pm maintenance.

---

## Safety Check — `_safety_check()`

Runs before **every single order** placement. Cannot be bypassed.

```python
def _safety_check(config: Config) -> None:
    mode = config.live.mode
    port = config.live.ibkr_port

    if mode == "paper" and port != 4002:
        raise RuntimeError(f"Safety violation: mode=paper but ibkr_port={port}. "
                           "Paper trading requires port 4002.")
    if mode == "live" and port != 4001:
        raise RuntimeError(f"Safety violation: mode=live but ibkr_port={port}. "
                           "Live trading requires port 4001.")
```

**Why this matters:** Without this check, a misconfigured `config.yaml` could accidentally place live orders through a paper account (or vice versa). The check runs at the moment of order placement — not just at startup — so a config reload during a session cannot bypass it.

---

## Account Type Validation — `validate_account_environment()`

Called once in `startup()` after successful IB connection.

```python
managed = ib.managedAccounts()   # e.g. ["DU1234567"] or ["U1234567"]

is_paper = any(acc.startswith("DU") for acc in managed)

if config expects paper  AND connected to live  → RuntimeError
if config expects live   AND connected to paper → RuntimeError
```

**Account ID prefixes:**

| Prefix | Account type |
|--------|-------------|
| `DU...` | Paper/demo account |
| `U...` (not DU) | Live account |

This is a second layer of protection on top of `_safety_check()`. It confirms the **actual connected account type**, not just the port number — catching cases where the wrong IB Gateway instance is running.

---

## `.env` Port Enforcement — `validate()`

`live/config.py` calls `validate()` at process startup (before IB connection):

```python
# live/config.py
def validate():
    if ENV == "live" and IB_PORT != 4001:
        raise RuntimeError("ENV=live must use IB_PORT=4001")
    if ENV in ("dev", "preprod") and IB_PORT != 4002:
        raise RuntimeError(f"ENV={ENV} must use IB_PORT=4002")
    if not ALLOW_LIVE_PORT and IB_PORT == 4001:
        raise RuntimeError("ALLOW_LIVE_PORT=false but IB_PORT=4001 — blocked")
```

Three layers of port safety:

| Layer | Where | What it checks |
|-------|-------|----------------|
| 1. `.env` validation | startup | `ENV` matches `IB_PORT` |
| 2. `_safety_check()` | every order | `config.live.mode` matches `ibkr_port` |
| 3. `validate_account_environment()` | once on connect | Actual IBKR account type matches expected |

---

## Connecting — `connect()` / `get_ib_connection()`

```python
ib = connect(config, db_path)
```

`connect()` wraps `connect_ibkr()` from `live/data.py` which handles the actual `ib_insync` connection. After connection it logs the account number and net liquidation value.

`get_ib_connection()` (lower-level) auto-tries `clientId` slots 2 through 6:

```python
for client_id in range(IB_CLIENT_ID, IB_CLIENT_ID + 5):    # 2, 3, 4, 5, 6
    ib.connect(IB_HOST, IB_PORT, clientId=client_id, timeout=10)
    if ib.isConnected():
        return ib
```

**Why auto-try client IDs?** IB Gateway reserves client ID slots. If the previous session exited uncleanly, slot 2 may be reserved as "ghost" until Gateway clears it (up to 30 seconds). Trying slots 3–6 immediately avoids waiting for the ghost to expire.

**Connection timeout:** 10 seconds per attempt. If Gateway doesn't respond within 10 seconds, that client ID attempt fails and the next is tried.

**Startup retry loop (main.py):** `startup()` wraps `connect()` in a 20-attempt loop with 30s pauses — designed to survive the IB Gateway nightly maintenance window (typically 11:45pm–12:00am ET).

```
IB Gateway restarts at 11:45pm ET
System is running, detects disconnect
Retry loop: 20 × 30s = 10 minutes of retries
Gateway back online at ~12:00am
Reconnect succeeds on attempt N
```

---

## Disconnect Detection — `register_disconnect_handler()`

Called once in `startup()` after successful connection:

```python
ib.disconnectedEvent += on_disconnected
```

When IB Gateway drops the connection, `disconnectedEvent` fires immediately. The handler:
1. Logs WARNING to `Events_log_live`
2. Sets internal state (does not attempt reconnect — that is `ensure_connected()`'s job)

The reconnect happens on the next loop cycle when `keepalive_ping()` catches the failed `reqCurrentTime()`.

---

## Reconnecting — `reconnect()`

```python
ib = reconnect(ib, config, db_path)
```

Called from `keepalive_ping()` when an IB ping fails.

```
Attempt 1 of 5:  disconnect() → connect_ibkr() → success? return
                                                 → fail? wait 15s
Attempt 2 of 5:  ...
...
Attempt 5 of 5:  fail → raise ConnectionError
```

On `ConnectionError` from `reconnect()`, `keepalive_ping()` logs CRITICAL and sleeps 10 minutes before the main loop retries on the next cycle.

---

## Keepalive — `keepalive_ping()`

Every loop tick (every 5 min off-hours, every 60 min market hours):

```python
ib.reqCurrentTime()        # IB API call — returns current server time
                           # If this raises, connection is lost
```

**Why `reqCurrentTime()`?** It is the lightest possible API call — no data returned, no quota impact, just a roundtrip ping to confirm the connection is alive. NAT tables on home routers typically have 5–30 minute timeouts; a 60-minute market hours loop alone could trigger a silent disconnect.

**During sleep:** `sleep_until_next_bar()` also pings every 2 minutes during the inter-bar sleep to beat any NAT timeout.

---

## Position Query — `get_position()`

```python
position = get_position(ib, config, db_path)
```

Returns a dict merging two data sources:

| Field | Source | Why |
|-------|--------|-----|
| `shares` | IBKR `ib.positions()` | Authoritative — actual shares held |
| `avg_cost` | IBKR | IBKR cost basis (may differ from our entry_price due to partial fills) |
| `unrealised_pnl` | IBKR | Real-time mark-to-market |
| `entry_price` | `trades_live` DB | Our strategy entry price |
| `stop_price` | `trades_live` DB | Current ratchet/hard stop — IBKR has no concept of this |
| `trade_id` | `trades_live` DB | Required to update the trade row on exit |
| `entry_date` | `trades_live` DB | For P&L calculation |

IBKR is the authority for position size. `trades_live` is the authority for stop prices and trade metadata. Both are needed simultaneously — neither source alone is sufficient.

---

## Position Reconciliation — `reconcile_positions()`

Called once on every startup. Compares IBKR shares vs `trades_live` open shares.

```python
ibkr_shares = ib.positions() → filter by symbol
db_shares   = SELECT SUM(shares) FROM trades_live WHERE exit_date IS NULL

if abs(ibkr_shares - db_shares) <= 1:   # 1-share tolerance for rounding
    return True   # reconciled

# Mismatch:
log CRITICAL to Events_log_live
print discrepancy
return False   → startup() aborts
```

**Why 1-share tolerance?** Integer rounding during partial fills can create a 1-share difference between `floor()` calculations and actual fills. This is not a real mismatch.

**Why never auto-correct?** A mismatch means either:
- A trade was closed outside the system (manual, broker-forced)
- A DB write failed during the previous session
- The system was restarted mid-order

In any of these cases, the correct response is human inspection. Auto-correcting could silently create phantom trades or leave real positions untracked.

**To resolve a mismatch:**
```sql
-- If IBKR shows 0 shares but DB shows open trade:
-- Option A: position was closed externally — close the DB trade record manually
UPDATE trades_live
SET exit_date = '2026-03-30', exit_price = <fill_price>,
    pnl_dollar = <actual_pnl>, exit_reason = 'manual_close'
WHERE trade_id = '<trade_id>' AND exit_date IS NULL;

-- Option B: DB trade is stale from a failed exit — same update
```

After manual reconciliation, delete `live/emergency.lock` if present and restart.

---

## Order DB Recording

Every order is written to `orders_live` **before** waiting for fill confirmation. This ensures a record exists even if the process crashes between placement and fill.

**Order lifecycle in `orders_live`:**

```
placed    → status='pending'                (INSERT on place_limit_order/place_market_order)
filled    → status='filled', fill_price=X   (UPDATE in wait_for_fill)
cancelled → status='cancelled'              (UPDATE in wait_for_fill)
expired   → status='expired'               (UPDATE on fill_timeout)
partial   → status='partial', fill_qty=N   (UPDATE in handle_partial_fill)
```

The `order_id` is a UUID generated by the system. The `ibkr_order_id` is the integer assigned by IBKR and used to match the order in `ib.trades()`.

---

## IB Gateway Settings

For the connection to work, IB Gateway must be configured:

| Setting | Value | Location |
|---------|-------|----------|
| Enable API | Checked | IB Gateway → Configure → API → Settings |
| Socket port | 4002 (paper) or 4001 (live) | Same settings panel |
| Allow connections from localhost | Checked | Same settings panel |
| Auto-restart | Recommended for production | IB Gateway → Configure → General |
| Read-only API | **Unchecked** — must allow orders | Same settings panel |

**IB Gateway nightly restart:** IB Gateway restarts automatically around 11:45pm ET for maintenance. The system's 20-attempt startup retry loop (20 × 30s = 10 minutes) is designed to survive this window.

---

## Troubleshooting Connection Issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ConnectionError: IB Gateway not running on 127.0.0.1:4002` | Gateway not started | Start IB Gateway app |
| `CHECK 1 FAIL: IB Gateway not running on port 4002` | Wrong port in config | Check `ibkr_port` in config.yaml matches Gateway port |
| `Safety violation: mode=paper but ibkr_port=4001` | Port/mode mismatch | Set `ibkr_port: 4002` in config.yaml for paper mode |
| `SAFETY: config says paper but connected to LIVE account` | Wrong Gateway running | Ensure paper Gateway is running, not live |
| `All 5 reconnect attempts failed` | Extended Gateway outage | Wait for Gateway restart (11pm window) |
| Client ID conflict `Market data farm connection is OK` but `reqCurrentTime` hangs | Another process using the same client ID | Change `ibkr_client_id` in config.yaml |

---

## Related Pages

- [IB Control Operations](IB-Control-Operations.md) — startup procedures, daily workflows, command reference
- [Live Trading Engine](Live-Trading-Engine.md) — how the connection is used in the main loop
- [Config Reference](Config-Reference.md) — `live.*` and `.env` parameter reference
- [Ref-IB-Broker](Ref-IB-Broker.md) — all broker.py function signatures
