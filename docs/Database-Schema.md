# Database Schema

Complete schema for all tables in `trading.db`. Two schema groups: backtest tables (created by `recorder.py`) and live trading tables (created by `db_setup.py`).

---

## Database Overview

| Table group | Created by | Purpose |
|-------------|-----------|---------|
| `runs` | `backtest/recorder.py` | One row per backtest run |
| `trades` | `backtest/recorder.py` | Individual backtest trades |
| `baselines` | `backtest/recorder.py` | B1 buy-hold and B2 baseline metrics |
| `experiments` | `backtest/recorder.py` | Experiment metadata and conclusions |
| `data_windows` | `backtest/recorder.py` | 18 window registry |
| `TQQQ_daily` | `data/loader.py` | Daily bar cache (from CSV + Yahoo sync) |
| `TQQQ_1h` | `live/db_setup.py` | Hourly bars for live stop monitoring |
| `orders_live` | `live/db_setup.py` | Every order placed in live/paper mode |
| `trades_live` | `live/db_setup.py` | Open and closed live/paper trades |
| `signals_live` | `live/db_setup.py` | Daily signal evaluations |
| `Events_log_live` | `live/db_setup.py` | Structured event log (WARNING+) |
| `Events_log_live_archive` | `live/db_setup.py` | Archived old events |
| `config_log_live` | `live/db_setup.py` | Session start/stop records |
| `circuit_breaker_live` | `live/db_setup.py` | CB alert history |
| `daily_equity_live` | `live/db_setup.py` | EOD equity snapshots |
| `hourly_snapshot_live` | `live/db_setup.py` | Per-tick indicator + position snapshots |
| `session_events_live` | `live/db_setup.py` | Detailed session event timeline |
| `nav_snapshots` | `live/db_setup.py` | Intraday NAV for daily loss limit |

---

## Backtest Tables

### `runs` — One row per backtest run

Primary key: `run_id TEXT` (format: `"run_0001"`, `"run_0002"`, ...)

**Identity and metadata:**

| Column | Type | Description |
|--------|------|-------------|
| `run_id` | TEXT PK | Auto-generated `"run_{N:04d}"` |
| `experiment_id` | TEXT | Links to `experiments.experiment_id` (e.g., `"exp_018_atr_wider"`) |
| `strategy_name` | TEXT | From `config.strategy_name` |
| `symbol` | TEXT | e.g., `"TQQQ"` |
| `date_from` | TEXT | Measurement window start (ISO date) |
| `date_to` | TEXT | Measurement window end (ISO date) |
| `window_label` | TEXT | Registry key (e.g., `"rolling_5y"`) |
| `git_commit` | TEXT | Git commit SHA at run time |
| `notes` | TEXT | Optional run notes |
| `config_snapshot` | TEXT | Full `Config.to_dict()` serialised as JSON |
| `initial_capital` | REAL | Starting equity (e.g., 20000.0) |
| `created_at` | TEXT | ISO datetime (UTC) |

**Performance metrics:**

| Column | Type | Description |
|--------|------|-------------|
| `cagr_annual_pct` | REAL | Combined CAGR % (trading + cash interest) |
| `trading_cagr_pct` | REAL | Trading component of CAGR only |
| `cash_contribution_pct` | REAL | Cash interest component of CAGR |
| `cagr_hp_pct` | REAL | Holding-period CAGR (not annualised) |
| `sharpe_ratio` | REAL | Annualised Sharpe (vs risk_free_rate) |
| `sortino_ratio` | REAL | Downside-only Sharpe |
| `calmar_ratio` | REAL | `cagr / abs(max_drawdown)` |
| `max_drawdown_pct` | REAL | Maximum peak-to-trough decline (negative) |
| `max_dd_duration` | INTEGER | Days from peak to trough |
| `expectancy_pct` | REAL | Average expected return per trade |
| `win_rate_pct` | REAL | % of trades that were profitable |
| `avg_win_pct` | REAL | Average winning trade return |
| `avg_loss_pct` | REAL | Average losing trade return |
| `profit_factor` | REAL | Gross profit / gross loss |
| `total_trades` | INTEGER | Number of completed round-trips |
| `trades_per_year` | REAL | Annualised trade frequency |
| `total_net_pnl_usd` | REAL | Total profit/loss in dollars |
| `equity_final` | REAL | Final equity including idle cash interest |
| `time_in_market_pct` | REAL | % of window days where a position was held |
| `total_commission` | REAL | Total commissions paid |
| `equity_curve` | TEXT | JSON array of `{date, equity}` objects |

**Benchmark comparison columns:**

| Column | Description |
|--------|-------------|
| `bh_cagr_pct` | Buy-and-hold CAGR for same window |
| `bh_max_dd_pct` | Buy-and-hold max DD for same window |
| `bh_sharpe` | Buy-and-hold Sharpe for same window |
| `b2_cagr_pct` | Baseline (exp_018/atr45) CAGR for same window |
| `b2_max_dd_pct` | Baseline max DD |
| `b2_sharpe` | Baseline Sharpe |
| `vs_bh_cagr_delta` | Strategy CAGR - B1 CAGR |
| `vs_bh_sharpe_delta` | Strategy Sharpe - B1 Sharpe |
| `vs_b2_cagr_delta` | Strategy CAGR - B2 CAGR |
| `vs_b2_sharpe_delta` | Strategy Sharpe - B2 Sharpe (used for verdict) |
| `delta_vs_bh_cagr` | Legacy: same as `vs_bh_cagr_delta` |
| `delta_vs_bh_dd` | Strategy DD - B1 DD |
| `delta_vs_atr_cagr` | Strategy CAGR - B2 CAGR (legacy) |
| `delta_vs_atr_dd` | Strategy DD - B2 DD (legacy) |

**Circuit breaker columns:**

| Column | Type | Description |
|--------|------|-------------|
| `cb_activated` | INTEGER | 1 if CB fired at least once, 0 otherwise |
| `cb_count` | INTEGER | Total number of CB activations |
| `cb_first_date` | TEXT | Date of first CB activation |

**Verdict:**

| Column | Type | Values |
|--------|------|--------|
| `verdict` | TEXT | `IMPROVEMENT` / `NEUTRAL` / `NO_IMPROVEMENT` / `BASELINE` / `ZERO_TRADES` / `NO_BASELINE` |

Verdict rules: `vs_b2_sharpe_delta ≥ 0.02` → IMPROVEMENT, `≤ -0.02` → NO_IMPROVEMENT, within ±0.02 → NEUTRAL.

---

### `trades` — Individual backtest trade records

Primary key: `trade_id TEXT` (format: `"{run_id}_t000"`, `"{run_id}_t001"`, ...)

| Column | Type | Description |
|--------|------|-------------|
| `trade_id` | TEXT PK | `"{run_id}_t{i:03d}"` |
| `run_id` | TEXT FK | References `runs.run_id` |
| `symbol` | TEXT | e.g., `"TQQQ"` |
| `direction` | TEXT | `"LONG"` or `"SHORT"` |
| `entry_date` | TEXT | ISO date |
| `exit_date` | TEXT | ISO date |
| `entry_price` | REAL | Adjusted fill price |
| `exit_price` | REAL | Adjusted exit fill price |
| `shares` | INTEGER | Number of shares |
| `stop_price` | REAL | Stop price at exit |
| `exit_reason` | TEXT | e.g., `"stop_hit"`, `"signal_exit"` |
| `hold_bars` | INTEGER | Trading days held |
| `pnl_usd` | REAL | Dollar P&L for this trade |
| `pnl_pct` | REAL | % return on entry capital |
| `r_multiple` | REAL | P&L / initial risk (in R units) |
| `initial_risk_usd` | REAL | `abs(entry - stop) × shares` |
| `entry_bar_idx` | INTEGER | Bar index in the window |
| `exit_bar_idx` | INTEGER | Bar index in the window |

---

### `baselines` — B1 and B2 reference metrics

Primary key: `(baseline_key TEXT, baseline_type TEXT)`

| Column | Type | Description |
|--------|------|-------------|
| `baseline_key` | TEXT | `"{symbol}_{date_from}_{date_to}"` |
| `baseline_type` | TEXT | `"buy_and_hold"` (B1) or `"atr_default"` (B2) |
| `symbol` | TEXT | e.g., `"TQQQ"` |
| `date_from` | TEXT | Window start |
| `date_to` | TEXT | Window end |
| `cagr_annual_pct` | REAL | |
| `max_drawdown_pct` | REAL | |
| `sharpe_ratio` | REAL | |
| `calmar_ratio` | REAL | |
| `total_return_pct` | REAL | Total (not annualised) return |
| `created_at` | TEXT | ISO datetime |

---

### `experiments` — Experiment metadata

Primary key: `experiment_id TEXT`

| Column | Type | Description |
|--------|------|-------------|
| `experiment_id` | TEXT PK | e.g., `"exp_018_atr_wider"` |
| `status` | TEXT | `"active"` / `"concluded"` / `"rejected"` |
| `conclusion` | TEXT | Human-readable conclusion string |
| `outcome` | TEXT | `"positive"` / `"negative"` / `"inconclusive"` |
| `winning_run_id` | TEXT | Best run ID for this experiment |
| `experiment_yaml` | TEXT | Full YAML file content |
| `created_at` | TEXT | ISO datetime |
| `updated_at` | TEXT | ISO datetime |

---

### `data_windows` — 18-window registry

Primary key: `window_id TEXT`

| Column | Type | Description |
|--------|------|-------------|
| `window_id` | TEXT PK | e.g., `"rolling_5y"`, `"bear_period_5"` |
| `window_type` | TEXT | `"bear"` / `"bull"` / `"full"` / `"rolling"` / `"ml_train"` |
| `label` | TEXT | Human label (e.g., `"5 Year Rolling"`) |
| `symbol` | TEXT | `"TQQQ"` |
| `warmup_from` | TEXT | Earliest date needed for warmup (ISO date) |
| `measure_from` | TEXT | Start of measurement window |
| `measure_to` | TEXT | End of measurement window |
| `warmup_bars` | INTEGER | Default 250 |
| `tqqq_return_pct` | REAL | TQQQ buy-hold return over this window |
| `regime` | TEXT | `"bear"` / `"bull"` / `"mixed"` |
| `data_available` | INTEGER | 1 = CSV covers this window, 0 = needs download |
| `notes` | TEXT | Context note |
| `created_at` | TEXT | ISO datetime |

---

## Price Data Tables

### `TQQQ_daily` — Daily bar cache

Created by `data/loader.py`. Auto-seeded from CSV and synced with Yahoo Finance.

| Column | Type | Description |
|--------|------|-------------|
| `date` | TEXT PK | `"YYYY-MM-DD"` |
| `open` | REAL | Unadjusted open |
| `high` | REAL | Unadjusted high |
| `low` | REAL | Unadjusted low |
| `close` | REAL | Unadjusted close |
| `volume` | REAL | Volume |
| `adj_close` | REAL | Split/dividend adjusted close |

**Note:** This table stores raw (unadjusted) OHLC. `apply_adjustment()` is called at backtest time, not at storage time.

---

### `TQQQ_1h` — Hourly bars (live trading)

Created by `live/db_setup.py`. Populated by `live/data.py`.

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | TEXT PK | ISO datetime (UTC) e.g., `"2026-03-30 14:00:00"` |
| `open` | REAL | |
| `high` | REAL | |
| `low` | REAL | Used by `monitor_stops()` for stop checks |
| `close` | REAL | Latest close — used by `get_strategy_equity()` for unrealised P&L |
| `volume` | INTEGER | |
| `adj_open` | REAL | Adjusted open (added by `populate_adjusted_prices()`) |
| `adj_high` | REAL | |
| `adj_low` | REAL | |
| `adj_close` | REAL | |

**Adjustment columns** (`adj_*`) are added post-creation via `populate_adjusted_prices()` in `db_setup.py`. They are computed per-date using the factor from `TQQQ_1d.csv`.

---

## Live Trading Tables

### `orders_live` — Every order placement

| Column | Type | Description |
|--------|------|-------------|
| `order_id` | TEXT PK | Local UUID generated on placement |
| `ibkr_order_id` | INTEGER | IBKR-assigned order ID |
| `symbol` | TEXT | e.g., `"TQQQ"` |
| `side` | TEXT | `"BUY"` or `"SELL"` |
| `order_type` | TEXT | `"LIMIT"` or `"MARKET"` |
| `qty` | INTEGER | Requested shares |
| `limit_price` | REAL | NULL for market orders |
| `status` | TEXT | `pending` → `filled` / `cancelled` / `expired` / `partial` |
| `fill_price` | REAL | Actual average fill price |
| `fill_qty` | INTEGER | Actual shares filled |
| `fill_time` | TEXT | ISO datetime of fill |
| `reason` | TEXT | `"entry"` / `"stop_hit"` / `"signal_exit"` / `"emergency_shutdown"` / `"force_close"` |
| `mode` | TEXT | `"paper"` or `"live"` |
| `created_at` | TEXT | ISO datetime |
| `updated_at` | TEXT | ISO datetime |

---

### `trades_live` — Open and closed live trades

| Column | Type | Description |
|--------|------|-------------|
| `trade_id` | TEXT PK | UUID |
| `entry_order_id` | TEXT | FK to `orders_live.order_id` |
| `exit_order_id` | TEXT | FK to `orders_live.order_id` (NULL while open) |
| `symbol` | TEXT | |
| `entry_date` | TEXT | ISO date |
| `exit_date` | TEXT | ISO date (NULL while open) |
| `entry_price` | REAL | Fill price on entry |
| `exit_price` | REAL | Fill price on exit (NULL while open) |
| `shares` | INTEGER | |
| `pnl_dollar` | REAL | Dollar P&L (NULL while open) |
| `pnl_pct` | REAL | % return (NULL while open) |
| `stop_price` | REAL | Current ratchet stop — updated each tick |
| `exit_reason` | TEXT | `"stop_hit"` / `"signal_exit"` / `"emergency_shutdown"` (NULL while open) |
| `mode` | TEXT | `"paper"` or `"live"` |
| `created_at` | TEXT | ISO datetime |

**Open trade query:** `WHERE exit_date IS NULL`

**The `stop_price` column is live state** — it is updated on every tick by `_update_ratchet_stop()`. The `stop_price` at any given moment is the current effective ratchet stop for `monitor_stops()` to check against.

---

### `signals_live` — Daily signal log

| Column | Type | Description |
|--------|------|-------------|
| `signal_id` | INTEGER PK (autoincrement) | |
| `signal_date` | TEXT | `"YYYY-MM-DD"` |
| `action` | TEXT | `"BUY"` / `"SELL"` / `"HOLD"` |
| `close_price` | REAL | Close price at signal evaluation |
| `proxy_close` | REAL | Price used for order placement |
| `indicators_snapshot` | TEXT | JSON: close, vwap, ema, atr values |
| `order_placed` | INTEGER | 1 if order was placed, 0 if dry_run or HOLD |
| `fill_price` | REAL | Actual fill price (NULL if no order) |
| `mode` | TEXT | `"paper"` or `"live"` |
| `created_at` | TEXT | ISO datetime |

---

### `Events_log_live` — Structured event log

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | INTEGER PK (autoincrement) | |
| `timestamp` | TEXT | SGT datetime (`YYYY-MM-DD HH:MM:SS.ffffff`) |
| `level` | TEXT | `"DEBUG"` / `"INFO"` / `"WARNING"` / `"ERROR"` / `"CRITICAL"` |
| `event_type` | TEXT | Event category (see [Session Log Reference](Session-Log-Reference.md)) |
| `symbol` | TEXT | e.g., `"TQQQ"` (NULL for system events) |
| `details` | TEXT | JSON payload — event-specific fields |
| `session_id` | TEXT | UUID of the session that fired this event |
| `created_at` | TEXT | SGT datetime |

GUI reads: `SELECT ... FROM Events_log_live ORDER BY timestamp DESC LIMIT 100`

**`Events_log_live_archive`** — identical schema, used for archiving old events when the main table grows large.

---

### `config_log_live` — Session start/stop records

| Column | Type | Description |
|--------|------|-------------|
| `config_id` | INTEGER PK (autoincrement) | |
| `started_at` | TEXT | Session start ISO datetime |
| `stopped_at` | TEXT | Session stop ISO datetime (NULL while running) |
| `status` | TEXT | `"active"` / `"inactive"` / `"crashed"` |
| `mode` | TEXT | `"paper"` or `"live"` |
| `strategy_name` | TEXT | From `config.strategy_name` |
| `strategy_version` | TEXT | |
| `tested_on` | TEXT | |
| `approved_by` | TEXT | |
| `atr_multiplier` | REAL | |
| `vwap_period` | INTEGER | |
| `ema_period` | INTEGER | |
| `atr_period` | INTEGER | |
| `vol_sizing_on` | INTEGER | 1/0 |
| `vol_clip_min` | REAL | |
| `vol_clip_max` | REAL | |
| `cb_threshold` | REAL | |
| `cb_cooldown_days` | INTEGER | |
| `max_daily_loss_pct` | REAL | |
| `signal_time` | TEXT | e.g., `"15:00"` |
| `ibkr_port` | INTEGER | |
| `full_config_json` | TEXT | Full `Config.to_dict()` snapshot |

---

### `circuit_breaker_live` — CB alert history

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK (autoincrement) | |
| `timestamp` | TEXT NOT NULL | ISO datetime (UTC) |
| `type` | TEXT NOT NULL | Always `"CIRCUIT_BREAKER"` |
| `level` | TEXT NOT NULL | `"WARNING"` / `"ERROR"` / `"CRITICAL"` |
| `drawdown_pct` | REAL | Drawdown at time of alert (%) |
| `nav` | REAL | Strategy NAV at time of alert |
| `starting_capital` | REAL | Session capital baseline |
| `message` | TEXT | Human-readable alert message |

**Alert levels:** 10% = WARNING, 15% = ERROR, 18% = CRITICAL, 20% = STOP (triggers emergency shutdown)

---

### `daily_equity_live` — EOD equity snapshots

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK (autoincrement) | |
| `date` | TEXT UNIQUE | `"YYYY-MM-DD"` |
| `nav` | REAL | Total strategy NAV |
| `cash` | REAL | Uninvested cash |
| `position_value` | REAL | Market value of open position |
| `unrealised_pnl` | REAL | Open position P&L |
| `realised_pnl_today` | REAL | P&L from trades closed today |
| `daily_return_pct` | REAL | % return for this day |
| `peak_nav` | REAL | Running all-time peak NAV |
| `drawdown_pct` | REAL | Current drawdown from peak |
| `in_position` | TEXT | `"LONG"` / `"SHORT"` / `"NONE"` |
| `session_id` | TEXT | Session that wrote this row |
| `created_at` | TEXT | ISO datetime |

**Used by `check_daily_loss_limit()`** to get `start_equity` (yesterday's NAV) without calling IB.

---

### `hourly_snapshot_live` — Per-tick indicator snapshots

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK (autoincrement) | |
| `tick_time` | TEXT NOT NULL | `"YYYY-MM-DD HH:MM:SS"` (ET) |
| `session_id` | TEXT | |
| `symbol` | TEXT | |
| `close` | REAL | Current close price |
| `vwap_250` | REAL | VWAP(250) value |
| `ema_10` | REAL | EMA(10) value |
| `atr_45` | REAL | ATR(45) value |
| `atr_multiplier` | REAL | Configured ATR multiplier |
| `close_vs_vwap` | REAL | `close - vwap_250` |
| `close_vs_ema` | REAL | `close - ema_10` |
| `signal` | TEXT | `"BUY"` / `"SELL"` / `"HOLD"` |
| `signal_reason` | TEXT | e.g., `"in_position"`, `"long_entry"` |
| `position_side` | TEXT | `"LONG"` / `"SHORT"` / `"NONE"` |
| `position_shares` | INTEGER | |
| `entry_price` | REAL | |
| `ratchet_stop` | REAL | Current ratchet stop |
| `hard_stop` | REAL | Calculated hard stop |
| `unrealised_pnl` | REAL | Mark-to-market P&L |
| `created_at` | TEXT | ISO datetime |

**GUI reads this table** for the live dashboard indicator display.

---

### `session_events_live` — Detailed session timeline

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK (autoincrement) | |
| `event_time` | TEXT NOT NULL | SGT datetime |
| `session_id` | TEXT | |
| `level` | TEXT | `"INFO"` / `"WARNING"` / `"ERROR"` / `"CRITICAL"` |
| `event_type` | TEXT | e.g., `"signal"`, `"stop_update"`, `"sync"` |
| `symbol` | TEXT | |
| `summary` | TEXT | Plain-English one-liner for GUI timeline |
| `details` | TEXT | JSON payload for drill-down |
| `duration_ms` | REAL | Operation duration (NULL if not applicable) |
| `created_at` | TEXT | ISO datetime |

Differs from `Events_log_live` in that it includes `summary` (human-readable) and `duration_ms`. GUI Session Analysis screen reads this table.

---

### `nav_snapshots` — Intraday NAV records

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK (autoincrement) | |
| `timestamp` | TEXT NOT NULL | ISO datetime (UTC) |
| `nav` | REAL NOT NULL | IBKR `NetLiquidation` value at this moment |

Written every tick by `check_daily_loss_limit()`. GUI NAV widget polls this table instead of calling IB directly.

---

## Initialising the Database

**Backtest tables (always needed):**
```python
from backtest.recorder import init_db
conn = init_db("trading.db")
conn.close()
```

**Live tables (needed for live/paper trading):**
```python
from live.db_setup import create_tables
create_tables("trading.db")
```

Or from command line:
```bash
python -m live.db_setup --db trading.db
```

**Seed daily price cache:**
```python
from data.loader import seed_from_csv
seed_from_csv("TQQQ", "data/TQQQ_1d.csv", "trading.db")
```

**Populate adjusted prices in TQQQ_1h (after backfilling hourly bars):**
```bash
python -m live.db_setup --db trading.db --populate-adj
```

---

## Common Queries

**All runs for an experiment, sorted by Calmar:**
```sql
SELECT run_id, window_label, cagr_annual_pct, max_drawdown_pct, calmar_ratio, total_trades
FROM runs
WHERE experiment_id = 'exp_018_atr_wider'
ORDER BY calmar_ratio DESC;
```

**Latest signal evaluation:**
```sql
SELECT signal_date, action, close_price, order_placed, fill_price
FROM signals_live
ORDER BY signal_date DESC
LIMIT 1;
```

**Current open position:**
```sql
SELECT symbol, entry_date, entry_price, stop_price, shares
FROM trades_live
WHERE exit_date IS NULL;
```

**Recent circuit breaker events:**
```sql
SELECT timestamp, level, drawdown_pct, nav, message
FROM circuit_breaker_live
ORDER BY timestamp DESC
LIMIT 10;
```

**Session history:**
```sql
SELECT config_id, started_at, stopped_at, status, mode
FROM config_log_live
ORDER BY started_at DESC;
```

---

## Related Pages

- [Data Management](Data-Management.md) — how `TQQQ_daily` is populated and kept current
- [Ref-Data-Backtest](Ref-Data-Backtest.md) — `recorder.py` API for writing to backtest tables
- [Session Log Reference](Session-Log-Reference.md) — all event types in `Events_log_live`
- [System Monitoring Guide](System-Monitoring-Guide.md) — `circuit_breaker_live` and `nav_snapshots`
- [Ref-IB-Broker](Ref-IB-Broker.md) — how `orders_live` and `trades_live` are written
