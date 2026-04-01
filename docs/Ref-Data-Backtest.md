# Ref: Data & Backtest Modules

> **Audience:** Developers — complete function reference for data loading, backtest simulation, metrics, and result persistence.
> **Related:** [Backtest-Engine](Backtest-Engine) · [Performance-Metrics-Guide](Performance-Metrics-Guide) · [Ref-Engine-Core](Ref-Engine-Core) · [Data-Windows-Reference](Data-Windows-Reference) · [Database-Schema](Database-Schema)

---

## Module Map

| Module | File | Role |
|--------|------|------|
| **loader** | `02-Common/data/loader.py` | CSV/Yahoo data loading, DB cache, window slicing |
| **runner** | `01-Backtest/backtest/runner.py` | Bar-by-bar simulation loop, position lifecycle |
| **simulator** | `01-Backtest/backtest/simulator.py` | Fill price simulation, P&L calculation |
| **metrics** | `01-Backtest/backtest/metrics.py` | CAGR, Sharpe, Calmar, drawdown, and 15+ metrics |
| **recorder** | `01-Backtest/backtest/recorder.py` | SQLite persistence, verdict classification, DB schema |

**Import rule (never violate):**
```
data/        ← imports NOTHING from this project
backtest/    ← imports from engine/ only
```

---

## Contents

- [data/loader.py](#dataladerpy)
  - [load\_csv()](#load_csv)
  - [apply\_adjustment()](#apply_adjustment)
  - [validate\_data()](#validate_data)
  - [slice\_window()](#slice_window)
  - [download\_yahoo()](#download_yahoo)
  - [update\_data()](#update_data)
  - [seed\_from\_csv()](#seed_from_csv)
  - [get\_daily\_bars()](#get_daily_bars)
- [backtest/runner.py](#backtestrunnerpy)
  - [BacktestResult](#backtestresult)
  - [open\_position()](#open_position)
  - [close\_position()](#close_position)
  - [check\_circuit\_breaker()](#check_circuit_breaker)
  - [process\_bar()](#process_bar)
  - [run\_symbol()](#run_symbol)
  - [run()](#run)
  - [run\_multi\_symbol()](#run_multi_symbol)
- [backtest/simulator.py](#backtestsimulatorpy)
  - [fill\_entry()](#fill_entry)
  - [fill\_exit()](#fill_exit)
  - [apply\_cash\_return()](#apply_cash_return)
  - [calc\_pnl()](#calc_pnl)
- [backtest/metrics.py](#backtestmetricspy)
  - [calc\_cagr()](#calc_cagr)
  - [cagr\_annual()](#cagr_annual)
  - [sharpe\_ratio()](#sharpe_ratio)
  - [sortino\_ratio()](#sortino_ratio)
  - [calmar\_ratio()](#calmar_ratio)
  - [max\_drawdown()](#max_drawdown)
  - [expectancy()](#expectancy)
  - [r\_multiples()](#r_multiples)
  - [buy\_and\_hold()](#buy_and_hold)
  - [benchmark\_comparison()](#benchmark_comparison)
  - [compute\_all()](#compute_all)
- [backtest/recorder.py](#backtestrecorderpy)
  - [init\_db()](#init_db)
  - [classify\_verdict()](#classify_verdict)
  - [save\_run()](#save_run)
  - [save\_trades()](#save_trades)
  - [get\_or\_create\_baseline()](#get_or_create_baseline)
  - [diff\_runs()](#diff_runs)
  - [readiness\_check()](#readiness_check)
  - [restore\_config\_from\_run()](#restore_config_from_run)
  - [save\_experiment()](#save_experiment)
  - [conclude\_experiment()](#conclude_experiment)
  - [populate\_data\_windows()](#populate_data_windows)
  - [export\_to\_csv()](#export_to_csv)

---

## data/loader.py

Handles all OHLCV data ingestion: CSV loading, split/dividend adjustment, quality validation, window slicing, Yahoo Finance download, and a SQLite-backed per-symbol daily bar cache that eliminates redundant downloads.

**Import invariant:** `data/` imports **nothing** from this project. It may use `pandas`, `sqlite3`, `os`, and `yfinance` only.

---

### load_csv()

```python
def load_csv(filepath: str) -> pd.DataFrame
```

Load OHLCV daily data from a CSV file. Returns a clean, sorted DataFrame.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `filepath` | `str` | Absolute or relative path to CSV file |

**Returns:** `pd.DataFrame` — sorted ascending by `date` with a clean `RangeIndex`. Columns normalised to lowercase.

**Required columns:** `date`, `open`, `high`, `low`, `close`, `volume`, `adj_close`

**Raises**
- `FileNotFoundError` — file does not exist at `filepath`
- `ValueError` — file is empty, or required columns are missing

**What it does:**
1. Reads CSV with `parse_dates=["date"]`
2. Normalises all column names to lowercase and strips whitespace
3. Checks that all 7 required columns are present
4. Sorts ascending by `date`, resets index to `RangeIndex`

**Example**

```python
df = load_csv("data/TQQQ_1d.csv")
print(df.shape)          # (2320, 7)
print(df.columns.tolist())
# ['date', 'open', 'high', 'low', 'close', 'volume', 'adj_close']
print(df["date"].iloc[0])  # 2017-01-03 00:00:00
```

**Critical rule:** Always call `apply_adjustment()` after `load_csv()` before running indicators. Raw OHLC is not split-adjusted.

---

### apply_adjustment()

```python
def apply_adjustment(df: pd.DataFrame) -> pd.DataFrame
```

Apply the split/dividend adjustment factor to Open, High, Low prices. Does **not** modify the input DataFrame — returns a new one.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `df` | `pd.DataFrame` | Raw OHLCV DataFrame from `load_csv()` |

**Returns:** New `pd.DataFrame` with adjusted `open`, `high`, `low`, `close` columns.

**Raises:** `ValueError` — if any `close` price is zero (cannot compute factor).

**Formula:**

```
factor      = adj_close / close
adj_open    = open  × factor
adj_high    = high  × factor
adj_low     = low   × factor
adj_close   = adj_close  (already correct)
```

**Worked example — TQQQ split on Jan 13, 2021 (5-for-1 split)**

| Column | Before | After |
|--------|--------|-------|
| `close` | 75.00 | 75.00 (pivots to adj_close) |
| `adj_close` | 15.00 | 15.00 |
| `factor` | — | 15.00 / 75.00 = 0.20 |
| `open` | 74.50 | 74.50 × 0.20 = **14.90** |
| `high` | 75.80 | 75.80 × 0.20 = **15.16** |
| `low` | 73.20 | 73.20 × 0.20 = **14.64** |

After adjustment, all indicators compute on prices that are directly comparable across split boundaries. Live orders always use the **unadjusted** market price.

**See also:** [Strategy-Logic — Data Preparation](Strategy-Logic#data-preparation) · [Impact-Matrix — apply_adjustment()](Impact-Matrix#apply_adjustment)

---

### validate_data()

```python
def validate_data(df: pd.DataFrame, symbol: str = "") -> list[str]
```

Run 5 data quality checks. Returns a list of warning strings — never raises. Caller decides what to do with warnings.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `df` | `pd.DataFrame` | Adjusted DataFrame |
| `symbol` | `str` | Symbol name for warning prefix (e.g. `"TQQQ"`) |

**Returns:** `list[str]` — empty list if all checks pass; one string per issue found.

**Checks performed:**

| # | Check | Trigger |
|---|-------|---------|
| 1 | Duplicate dates | Any `date` value appears more than once |
| 2 | Large gaps | Gap > 5 calendar days between consecutive dates |
| 3 | OHLC logic | `high < low`, `high < open`, `high < close`, `low > open`, `low > close` |
| 4 | Zero/negative prices | Any `open`, `high`, `low`, or `close` ≤ 0 |
| 5 | Zero volume | Zero volume on > 10% of rows |

**Example**

```python
warnings = validate_data(df, "TQQQ")
if warnings:
    for w in warnings:
        print(f"WARNING: {w}")
# WARNING: [TQQQ] Gap of 8 calendar days between 2021-12-31 and 2022-01-10
```

**Usage in runner:** `run()` calls `validate_data()` after loading each symbol and logs warnings — it does **not** abort on warnings. A gap warning for a holiday week is normal.

---

### slice_window()

```python
def slice_window(
    df: pd.DataFrame,
    date_from: str,
    date_to: str,
    warmup_bars: int = 0,
) -> tuple[pd.DataFrame, int]
```

Extract a date window from `df` and prepend warmup bars so indicators are fully initialised before measurement begins.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `df` | `pd.DataFrame` | Full adjusted OHLCV DataFrame |
| `date_from` | `str` | Measurement window start, `"YYYY-MM-DD"` |
| `date_to` | `str` | Measurement window end, `"YYYY-MM-DD"` (inclusive) |
| `warmup_bars` | `int` | Bars to prepend before `date_from` (default 0) |

**Returns:** `tuple[pd.DataFrame, int]`
- `df_with_warmup` — full slice with warmup bars prepended
- `actual_warmup` — actual bars prepended (may be < `warmup_bars` if not enough history)

**Raises:** `ValueError` — if no rows fall in the `date_from` → `date_to` range.

**Warmup logic diagram:**

```
Full history:
  [2016-01-01 ─────────── 2016-12-31] [2017-01-01 ───────────────── 2026-03-16]
                                        ↑ date_from                  ↑ date_to
  ←─────── warmup_bars=250 ──────────→ ←── measurement window ──────────────→
  └─ prepended to warm up VWAP(250) ─┘

Returned DataFrame:
  [warmup prefix │ measurement window]
       250 bars  │  ~2,320 bars
  actual_warmup=250
```

**Worked example**

```python
df, warmup = slice_window(df, "2021-03-16", "2026-03-16", warmup_bars=250)
print(len(df))     # ~1,513  (250 warmup + 1,263 measurement bars)
print(warmup)      # 250
# First 250 rows run indicators through the loop but are stripped from results
```

**What happens to warmup bars:**  `run_symbol()` passes `actual_warmup` so the bar loop trims equity_curve and trades back to the measurement window only. See [run\_symbol()](#run_symbol).

**See also:** [Backtest-Engine — Window Slicing](Backtest-Engine#window-slicing) · [Data-Windows-Reference](Data-Windows-Reference)

---

### download_yahoo()

```python
def download_yahoo(
    symbol: str,
    date_from: str,
    date_to: str,
    output_dir: str = "data",
) -> str
```

Download daily OHLCV bars from Yahoo Finance via `yfinance`. Saves to `{output_dir}/{symbol}_1d.csv`. Returns the file path.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | `str` | Ticker symbol, e.g. `"TQQQ"` |
| `date_from` | `str` | Start date `"YYYY-MM-DD"` |
| `date_to` | `str` | End date `"YYYY-MM-DD"` |
| `output_dir` | `str` | Directory to save CSV (created if missing) |

**Returns:** `str` — filepath of saved CSV, e.g. `"data/TQQQ_1d.csv"`.

**Raises:** `ValueError` — if Yahoo returns no data for the given symbol/range.

**yfinance compatibility:** Works with both `0.1.x` and `0.2.x`. Uses `auto_adjust=False` to get raw + adj_close columns separately. Handles MultiIndex columns from 0.2.x.

**Column normalisation:** Maps `"adj close"`, `"adj_close"`, `"adjclose"` → `"adj_close"`. If `adj_close` is missing (some yfinance versions), falls back to `close`.

**Example**

```python
# Initial seed — download full TQQQ history
path = download_yahoo("TQQQ", "2010-01-01", "2026-03-16")
# Saved 4180 bars to data/TQQQ_1d.csv
df = load_csv(path)
```

**See also:** [Data-Management](Data-Management) · [update_data()](#update_data) · [get_daily_bars()](#get_daily_bars)

---

### update_data()

```python
def update_data(symbol: str, output_dir: str = "data") -> int
```

Append only missing recent bars to an existing CSV file. Safe to call repeatedly — no duplicate dates are ever written.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | `str` | Ticker symbol |
| `output_dir` | `str` | Directory containing `{symbol}_1d.csv` |

**Returns:** `int` — number of new bars appended (0 if file was already up to date).

**Logic:**
1. If file does not exist → calls `download_yahoo()` for full history since `2010-01-01`
2. If file exists → reads `last_date`, downloads `last_date+1` → today
3. Merges, deduplicates by `date`, sorts, overwrites file

**Idempotency:** Running `update_data("TQQQ")` twice on the same day always returns `0` on the second call.

**Example**

```python
new_rows = update_data("TQQQ")
print(f"Added {new_rows} new bars")   # Added 5 new bars  (after a week away)
```

**Preferred for daily maintenance.** Use `get_daily_bars()` for backtest runs (DB-cached, no file rewrite).

---

### seed_from_csv()

```python
def seed_from_csv(symbol: str, csv_path: str, db_path: str) -> int
```

One-time population of the `{SYMBOL}_daily` SQLite table from an existing CSV file. Safe to call multiple times — uses `INSERT OR REPLACE`.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | `str` | Ticker symbol |
| `csv_path` | `str` | Path to the source CSV |
| `db_path` | `str` | Path to `trading.db` |

**Returns:** `int` — number of rows written.

**When to use:** First-time setup when you have a local CSV but an empty DB. After seeding, subsequent calls to `get_daily_bars()` only fetch new bars from Yahoo.

**Example**

```python
n = seed_from_csv("TQQQ", "data/TQQQ_1d.csv", "trading.db")
print(f"Seeded {n} bars into TQQQ_daily")   # Seeded 2320 bars into TQQQ_daily
```

**See also:** [Setup-Deployment — DB Initialisation](Setup-Deployment#db-initialisation)

---

### get_daily_bars()

```python
def get_daily_bars(
    symbol: str,
    db_path: str,
    csv_path: str | None = None,
) -> pd.DataFrame
```

Return full daily OHLCV history for a symbol from the local SQLite cache. Automatically seeds from CSV on first call and fetches only new bars on subsequent calls.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | `str` | Ticker symbol |
| `db_path` | `str` | Path to `trading.db` |
| `csv_path` | `str \| None` | Optional CSV path for initial seed |

**Returns:** `pd.DataFrame` — full OHLCV history sorted by `date`.

**Call sequence:**

```
First call (DB empty):
  csv_path provided? → seed from CSV → fetch newer bars from Yahoo → return all
  no csv_path?       → download full history from Yahoo (2010-01-01 → today)

Subsequent calls:
  check last stored date → fetch only new bars from Yahoo → upsert → return all
```

**Why DB-cached matters for backtests:** Each experiment run calls `get_daily_bars()` for each symbol. Without the DB cache, every run would download the full CSV from disk or Yahoo — slow and error-prone. With the cache, only new bars since the last download are fetched.

**Table name:** `TQQQ_daily` (safe-alphanumeric of symbol + `_daily`).

**Example**

```python
# First call for this machine — seeds from CSV, fetches any newer bars
df = get_daily_bars("TQQQ", "trading.db", csv_path="data/TQQQ_1d.csv")
print(len(df))   # 2320

# Next day — only fetches yesterday's bar (< 1 second)
df = get_daily_bars("TQQQ", "trading.db")
print(len(df))   # 2321
```

**See also:** [Data-Management](Data-Management) · [seed_from_csv()](#seed_from_csv)

---

## backtest/runner.py

The core simulation engine. Drives the bar-by-bar loop, manages the position lifecycle (open → ratchet update → exit check → signal → open), and aggregates results across symbols.

---

### BacktestResult

```python
@dataclass
class BacktestResult:
    results_per_symbol: dict          # symbol → per-symbol result dict
    trades: list                      # all completed trades across symbols
    equity_curve: list                # daily equity values (measurement period)
    final_equity: float               # equity after trades (no cash interest)
    config_snapshot: dict             # config.to_dict() at run time
    idle_days: int                    # calendar days not in any trade
    active_days: int                  # calendar days in a trade
    equity_after_trades: float        # same as final_equity
    equity_final: float               # equity_after_trades + idle cash interest
    idle_interest_earned: float       # cash earned at cash_rate during idle time
    circuit_breaker_activated: bool   # True if CB fired at any point
    circuit_breaker_activation_count: int
    circuit_breaker_first_activation_date: str
```

The container returned by `run()`. All metrics are computed from `trades` and `equity_curve` by `compute_all()` in metrics.py.

**equity_final vs equity_after_trades:**

```
equity_after_trades = equity at end of last trade (no cash interest)
equity_final        = equity_after_trades × (1 + cash_rate)^(idle_days/365.25)
                    = the 3-component CAGR headline number uses equity_final
```

---

### open_position()

```python
def open_position(
    symbol: str,
    direction: str,
    entry_price: float,
    stop_price: float,
    shares: int,
    entry_bar_idx: int,
    bar: pd.Series,
    signal: SignalResult,
) -> dict
```

Create a new position state dictionary. Initialises the ratchet tracking anchors.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | `str` | Ticker symbol |
| `direction` | `str` | `"long"` or `"short"` |
| `entry_price` | `float` | Simulated fill price from `fill_entry()` |
| `stop_price` | `float` | Initial stop from `signal.stop_price` |
| `shares` | `int` | Number of shares from `calc_position_size()` |
| `entry_bar_idx` | `int` | Bar index in `bars` DataFrame |
| `bar` | `pd.Series` | Current bar (provides `high`, `low`, `date`) |
| `signal` | `SignalResult` | Signal that triggered the entry |

**Returns:** `dict` — position state with all tracking fields initialised.

**Position dict fields:**

| Field | Value at open | Updated each bar |
|-------|---------------|-----------------|
| `highest_high` | `bar["high"]` | Updated in `process_bar()` |
| `lowest_low` | `bar["low"]` | Updated in `process_bar()` |
| `ratchet_stop` | `stop_price` | Output of `calc_ratchet_stop()` |
| `entry_signal` | `signal.reason` | Frozen at entry |

**Critical:** `highest_high` / `lowest_low` are the running anchors for the ratchet stop. They **never reset** while in position — see [calc\_ratchet\_stop()](Ref-Engine-Core#calc_ratchet_stop).

---

### close_position()

```python
def close_position(
    position: dict,
    exit_price: float,
    exit_bar_idx: int,
    exit_reason: str,
    commission: float,
    exit_date: str = "",
) -> dict
```

Record the exit, compute P&L, and calculate the R-multiple. Returns the completed trade dict.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `position` | `dict` | Open position from `open_position()` |
| `exit_price` | `float` | Simulated fill price from `fill_exit()` |
| `exit_bar_idx` | `int` | Bar index of exit |
| `exit_reason` | `str` | `"trailing_stop"`, `"hard_stop"` |
| `commission` | `float` | Commission per side in USD |
| `exit_date` | `str` | Date string of exit bar |

**Returns:** `dict` — all position fields plus exit fields and P&L.

**R-multiple formula:**

```
initial_risk_usd = |entry_price - initial_stop_price| × shares
r_multiple       = net_pnl_usd / initial_risk_usd
```

An R-multiple of 2.0 means the trade earned twice its initial risk.

**Worked example**

```
Long entry: price=$20.00, stop=$18.50, shares=500
initial_risk_usd = |20.00 - 18.50| × 500 = $750

Exit at ratchet stop: price=$25.00, commission=$1.00 each side
gross_pnl = (25.00 - 20.00) × 500 = $2,500
net_pnl   = $2,500 - $2.00        = $2,498
r_multiple = $2,498 / $750        = 3.33R ✅
```

**See also:** [r\_multiples()](#r_multiples) · [Performance-Metrics-Guide — R-Multiple](Performance-Metrics-Guide#r-multiple-distribution)

---

### check_circuit_breaker()

```python
def check_circuit_breaker(
    peak_equity: float,
    current_equity: float,
    threshold_pct: float = 30.0,
    active: bool = False,
    cooldown_counter: int = 0,
) -> tuple[bool, int]
```

Check if the portfolio drawdown has tripped the circuit breaker. Returns `(breaker_active, new_cooldown_counter)`.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `peak_equity` | `float` | Highest equity reached so far |
| `current_equity` | `float` | Current equity value |
| `threshold_pct` | `float` | Drawdown % to trip the breaker (default 30%) |
| `active` | `bool` | Whether breaker is currently active |
| `cooldown_counter` | `int` | Bars of cooldown remaining |

**Returns:** `tuple[bool, int]` — `(new_active, new_counter)`

**State machine:**

```
State         Condition          Action
──────────────────────────────────────────────────────────
Not active    DD < threshold     Stay off  → (False, 0)
Not active    DD ≥ threshold     TRIP!     → (True,  cooldown_days)
Active        counter > 0        Tick down → (True,  counter - 1)
Active        counter == 0       EXPIRE    → (False, 0)
```

**Cooldown duration:** `max(5, int(threshold_pct / 3))` bars. At 30% threshold → 10 bars (~2 weeks).

**Why cooldown expires to False:**  After expiry, `run_symbol()` resets `peak_equity = current_equity`. Without this reset, equity stays flat during the pause, DD stays above threshold, and the breaker would re-trip on every expiry cycle — permanently halting trading.

**Worked example — 30% threshold, $20,000 start**

```
Bar 50:  peak=$24,000  current=$16,000  DD=33%  → TRIP! (True, 10)
Bar 51:  active=True   counter=9         → still active
...
Bar 60:  active=True   counter=0         → EXPIRE (False, 0)
         runner sets peak_equity=$16,000  (resets base)
Bar 61:  new entries allowed again
```

**See also:** [Backtest-Engine — Circuit Breaker](Backtest-Engine#circuit-breaker) · [YAML-Config-Guide — circuit_breaker](YAML-Config-Guide)

---

### process_bar()

```python
def process_bar(
    bar_idx: int,
    bars: pd.DataFrame,
    position: dict | None,
    equity: float,
    cooldown_counter: int,
    config: Config,
    symbol: str,
    open_positions_all: list | None = None,
    peak_equity: float = 0.0,
    breaker_active: bool = False,
    breaker_cooldown: int = 0,
    precomputed_adx: float | None = None,
) -> tuple[dict | None, list, float, int, float, bool, int]
```

**The core loop body.** Processes a single bar: updates ratchet, checks stops, evaluates signals, opens positions.

**Returns:**
```python
(updated_position, new_trades, updated_equity,
 updated_cooldown, updated_peak_equity,
 updated_breaker_active, updated_breaker_cooldown)
```

**Execution sequence (7 steps every bar):**

```
Step 1 ─ Update peak equity
          peak_equity = max(peak_equity, equity)

Step 2 ─ Circuit breaker check
          if use_circuit_breaker:
              breaker_active, breaker_cooldown = check_circuit_breaker(...)

Step 3 ─ If in position: update ratchet
          Recomputes ATR on bars.iloc[:bar_idx+1]
          new_stop, new_anchor = calc_ratchet_stop(...)
          Updates position["ratchet_stop"] and position["highest_high"/"lowest_low"]
          effective_stop = max(ratchet, hard_stop) for long

Step 4 ─ If in position: check exit
          if is_stop_hit(direction, bar.low, bar.high, effective_stop):
              exit_price = fill_exit(bar, direction, effective_stop, config)
              trade = close_position(...)
              equity += trade["pnl_usd"]
              cooldown_counter = config.timing.cooldown_bars
              return early (exits bar processing here)

Step 5 ─ Decrement cooldown
          if cooldown_counter > 0: cooldown_counter -= 1

Step 6 ─ Evaluate signal (NO LOOKAHEAD!)
          signal = evaluate(bars.iloc[:bar_idx+1], config, symbol, ...)
                             ↑ CRITICAL: only bars up to current bar

Step 7 ─ Open new position (if signal fires AND no active position AND breaker off)
          portfolio_cap_allows()?
          entry_price = fill_entry(bar, signal.direction, config)
          shares = calc_position_size(...) [+ volatility sizing if enabled]
          position = open_position(...)
```

**Lookahead guard:** The slice `bars.iloc[:bar_idx+1]` is the single most important correctness guarantee in the entire codebase. Passing `bars` (the full DataFrame) would give `evaluate()` access to future prices. See [Impact-Matrix — Lookahead Bias](Impact-Matrix#lookahead-bias-bug).

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bar_idx` | `int` | Index into `bars` (0-based) |
| `bars` | `pd.DataFrame` | Full window including warmup |
| `position` | `dict \| None` | Current open position, or `None` |
| `equity` | `float` | Current portfolio equity |
| `cooldown_counter` | `int` | Bars until next entry is allowed |
| `open_positions_all` | `list \| None` | All open positions (multi-symbol cap check) |
| `precomputed_adx` | `float \| None` | Pre-computed ADX for this bar (O(1) lookup) |

---

### run_symbol()

```python
def run_symbol(
    bars: pd.DataFrame,
    config: Config,
    symbol: str,
    warmup_bars: int = 0,
) -> dict
```

Run the bar-by-bar simulation for one symbol. Returns a result dict.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bars` | `pd.DataFrame` | Sliced window with warmup prepended |
| `config` | `Config` | Full configuration |
| `symbol` | `str` | Ticker symbol |
| `warmup_bars` | `int` | Number of leading bars that are warmup-only |

**Returns:** `dict` with keys:

| Key | Type | Description |
|-----|------|-------------|
| `trades` | `list[dict]` | Completed trades (measurement period only) |
| `equity_curve` | `list[float]` | Daily equity (measurement period + initial) |
| `equity_after_trades` | `float` | Equity at end of simulation |
| `equity_final` | `float` | + idle cash interest |
| `idle_days` | `int` | Calendar days not in trade |
| `active_days` | `int` | Calendar days in trade |
| `idle_interest_earned` | `float` | Cash return for idle days |
| `cb_activated` | `bool` | Whether circuit breaker fired |
| `cb_count` | `int` | Number of CB activations |
| `cb_first_date` | `str` | Date of first CB activation |

**Warmup handling:**

```
bars layout:   [─── 250 warmup ───│─── measurement window ───]
                bar 0 … bar 249   bar 250 … bar N

After loop:
  equity_curve = equity_curve[250:]   ← strips warmup
  trades       = [t for t if t.entry_bar_idx >= 250]
  bar indices re-indexed: -= 250      ← relative to measurement start
```

**Idle cash calculation:**

```
active_days   = sum of calendar days across all completed trades
                (exit_date - entry_date).days per trade

total_window  = (last_bar_date - first_measurement_bar_date).days

idle_days     = max(0, total_window - active_days)
cash_rate     = config.risk.cash_rate_annual   (default 3%)
idle_interest = equity_after_trades × ((1 + cash_rate)^(idle_days/365.25) - 1)
equity_final  = equity_after_trades + idle_interest
```

**Worked example (rolling_5y window, exp_018 config):**

```
Window: 2021-03-16 → 2026-03-16 = 1827 calendar days
27 trades, avg hold 14 days: active_days ≈ 378
idle_days  = 1827 - 378 = 1449

equity_after_trades = $48,320
cash_rate = 0.03
idle_interest = $48,320 × ((1.03)^(1449/365.25) - 1)
             = $48,320 × ((1.03)^3.967 - 1)
             = $48,320 × 0.1263
             = $6,105
equity_final = $48,320 + $6,105 = $54,425
```

---

### run()

```python
def run(config: Config, db_path: str = "trading.db") -> BacktestResult
```

**Main backtest entry point.** Loads data, runs all symbols, returns aggregated `BacktestResult`.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `Config` | Full config loaded from YAML |
| `db_path` | `str` | Path to `trading.db` |

**Returns:** `BacktestResult`

**Pipeline:**

```
For each symbol in config.symbols:
  1. get_daily_bars(symbol, db_path, csv_path)   ← DB cache + Yahoo sync
  2. apply_adjustment(df)                         ← split-adjust OHLC
  3. validate_data(df, symbol)                    ← log any warnings
  4. slice_window(df, date_from, date_to,         ← prepend warmup_bars
                  warmup_bars=config.indicators.vwap_period)
  5. run_symbol(df, config, symbol, actual_warmup)

Aggregate:
  combined equity_curve = sum of per-symbol curves
  total idle/active days = sum across symbols
  equity_final = sum across symbols
```

**warmup_bars = config.indicators.vwap_period** — always equals 250. VWAP(250) is the longest-lookback indicator; all others are warm by bar 250.

**Single-symbol vs multi-symbol:** `run()` runs each symbol independently (no shared portfolio cap). For shared cap enforcement across symbols, use `run_multi_symbol()`.

**Typical CLI usage:**

```python
from engine.config import load_config
from backtest.runner import run

config = load_config("experiments/exp_018_atr_wider.yaml")
result = run(config, db_path="trading.db")
print(f"Final equity: ${result.equity_final:,.2f}")
print(f"Trades: {len(result.trades)}")
```

---

### run_multi_symbol()

```python
def run_multi_symbol(config: Config, db_path: str = "trading.db") -> BacktestResult
```

Run multiple symbols simultaneously with a **shared portfolio equity** and portfolio cap enforcement across all open positions.

**Difference from run():**

| Aspect | `run()` | `run_multi_symbol()` |
|--------|---------|---------------------|
| Portfolio tracking | Per-symbol independent | Single shared equity |
| Cap check | Each symbol caps its own | All open positions checked before any new entry |
| Bar alignment | Not required | Required — uses `min(lengths)` |
| Use case | Single-symbol backtests | Multi-symbol portfolio test |

**Bar alignment:** All symbols must have data for the same date range. Uses `min(len(df))` across symbols to avoid index errors on unequal lengths.

---

## backtest/simulator.py

Simulates realistic market execution: slippage on entry and exit, the three-scenario v0.6.7 fill logic for stop exits, idle cash compounding, and P&L calculation.

---

### fill_entry()

```python
def fill_entry(
    bar: pd.Series,
    direction: str,
    config: ExecutionConfig,
) -> float
```

Return the simulated entry fill price including slippage.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bar` | `pd.Series` | Current bar OHLCV |
| `direction` | `str` | `"long"` or `"short"` |
| `config` | `ExecutionConfig` | Entry fill mode and slippage settings |

**Returns:** `float` — fill price with slippage applied.

**Fill modes (`config.entry_fill`):**

| Mode | Base price | Notes |
|------|-----------|-------|
| `"close"` | `bar["close"]` | Default — backtest fills at signal bar close |
| `"next_open"` | `bar["open"]` | Next bar open (not used in default config) |

**Slippage:**
```
slippage = base_price × (slippage_pct / 100)

long:  fill = base_price + slippage   ← buy higher (adverse)
short: fill = base_price - slippage   ← sell lower (adverse)
```

**Worked example (long, slippage_pct=0.05%)**

```
bar.close = $25.00
slippage  = $25.00 × 0.0005 = $0.0125
fill      = $25.00 + $0.0125 = $25.0125
```

---

### fill_exit()

```python
def fill_exit(
    bar: pd.Series,
    direction: str,
    stop_price: float,
    config: ExecutionConfig,
) -> float
```

Return the simulated exit fill price. Implements the **v0.6.7 gap-aware** three-scenario logic.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bar` | `pd.Series` | Bar when exit is triggered |
| `direction` | `str` | `"long"` or `"short"` |
| `stop_price` | `float` | Effective stop level (ratchet or hard, whichever is tighter) |
| `config` | `ExecutionConfig` | Exit fill mode and slippage settings |

**Returns:** `float` — fill price with slippage applied.

**v0.6.7 three-scenario decision tree (exit_fill="close"):**

```
LONG EXIT:
─────────────────────────────────────────────────────────────────
Scenario 1 — Gap-down at open:
  Condition: bar.open <= stop_price
  Base fill: bar.open
  Reason:    Stop-market fires immediately at opening auction price.
             We cannot get a price better than open.

Scenario 2 — Intraday touch (price recovers above stop by close):
  Condition: bar.open > stop_price  AND  bar.low <= stop_price
             AND  bar.close > stop_price
  Base fill: stop_price
  Reason:    Stop fires intraday at stop level. Recovery does NOT
             change the fill (old bug: used bar.close — too optimistic).

Scenario 3 — Intraday blow-through (close below stop):
  Condition: bar.open > stop_price  AND  bar.close < stop_price
  Base fill: bar.close
  Reason:    Stop fires intraday but price continues falling.
             Worst-case fill at close.

Formula applied to all:
  fill = base_price - slippage   (adverse: sell lower)

SHORT EXIT: mirror logic with >= / >= / > and fill = base_price + slippage
```

**Real TQQQ example — Oct 26, 2023 (the bug-fix case):**

```
bar.open  = $15.77
bar.low   = $15.00
bar.close = $15.03
stop      = $15.80

Scenario 1 applies: open ($15.77) < stop ($15.80) → gap-down

v0.6.6 fill (old): min(close, stop) = min($15.03, $15.80) = $15.03  → -15.47%
v0.6.7 fill (fix): bar.open         = $15.77               → -11.22%  ← correct
Improvement: +4.25 percentage points on that single trade
```

**Fill mode table:**

| `exit_fill` | Base price | Notes |
|-------------|-----------|-------|
| `"close"` | 3-scenario v0.6.7 | Default — realistic stop simulation |
| `"stop_price"` | `stop_price` | Ideal fill — used in clean testing |
| `"next_open"` | `bar["open"]` | Next bar open model |

**See also:** [Strategy-Logic — Fill Logic v0.6.7](Strategy-Logic#fill-logic-v067) · [Backtest-Engine — Fill Logic](Backtest-Engine#fill-logic) · [Impact-Matrix — fill\_exit()](Impact-Matrix#fill_exit)

---

### apply_cash_return()

```python
def apply_cash_return(
    equity: float,
    idle_days: int,
    annual_rate: float = 0.03,
) -> float
```

Compound idle cash at the risk-free rate for `idle_days`.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `equity` | `float` | Equity to compound |
| `idle_days` | `int` | Number of idle days (not in a trade) |
| `annual_rate` | `float` | Annual rate, default 3% (0.03) |

**Returns:** `float` — equity after compounding. Returns `equity` unchanged if `idle_days <= 0` or `annual_rate <= 0`.

**Formula:**
```
daily_rate = annual_rate / 252
return     = equity × (1 + daily_rate)^idle_days
```

**Note:** Uses 252 trading days per year (not 365.25). `run_symbol()` uses calendar days with 365.25 for the 3-component CAGR calc_cagr(). This function is a utility for direct compounding.

**Worked example**

```
equity     = $20,000
idle_days  = 365  (roughly half the year not trading)
annual_rate = 0.03
daily_rate = 0.03 / 252 = 0.0001190

return = $20,000 × (1.0001190)^365 = $20,000 × 1.0447 = $20,894
```

---

### calc_pnl()

```python
def calc_pnl(
    direction: str,
    entry_price: float,
    exit_price: float,
    shares: int,
    commission: float,
) -> tuple[float, float]
```

Calculate net P&L after commission. Returns `(pnl_usd, pnl_pct)`.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `direction` | `str` | `"long"` or `"short"` |
| `entry_price` | `float` | Simulated fill at entry |
| `exit_price` | `float` | Simulated fill at exit |
| `shares` | `int` | Number of shares |
| `commission` | `float` | Commission per side in USD |

**Returns:** `tuple[float, float]` — `(net_pnl_usd, pnl_pct)`

**Formulas:**

```
long:  gross_pnl = (exit_price - entry_price) × shares
short: gross_pnl = (entry_price - exit_price) × shares

total_commission = commission × 2   ← charged on entry AND exit
net_pnl          = gross_pnl - total_commission

cost_basis = entry_price × shares
pnl_pct    = net_pnl / cost_basis × 100
```

**Worked example**

```
Long: entry=$20.00, exit=$25.00, shares=500, commission=$1.00

gross_pnl = (25.00 - 20.00) × 500 = $2,500.00
commission = $1.00 × 2             = $2.00
net_pnl   = $2,500 - $2            = $2,498.00
cost_basis = $20.00 × 500          = $10,000
pnl_pct   = $2,498 / $10,000 × 100 = +24.98%
```

**Short example (same prices):**

```
Short: entry=$25.00, exit=$20.00, shares=500, commission=$1.00

gross_pnl = (25.00 - 20.00) × 500 = $2,500.00
net_pnl   = $2,498.00
pnl_pct   = +24.98%   ← same profit, different direction
```

---

## backtest/metrics.py

All performance metrics computed from a `trades` list and `equity_curve`. Each function is pure — no DB access, no side effects. `compute_all()` calls all others and returns a single metrics dict.

---

### calc_cagr()

```python
def calc_cagr(
    equity_final: float,
    equity_after_trades: float,
    initial_capital: float,
    date_from: str,
    date_to: str,
) -> dict
```

**Three-component CAGR breakdown.** The headline CAGR number has three components: trading return, idle cash return, and combined.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `equity_final` | `float` | `equity_after_trades + idle_interest` |
| `equity_after_trades` | `float` | Equity after all trades closed |
| `initial_capital` | `float` | Starting capital |
| `date_from` | `str` | Window start `"YYYY-MM-DD"` |
| `date_to` | `str` | Window end `"YYYY-MM-DD"` |

**Returns:** `dict` with three keys:
- `combined_cagr_pct` — headline CAGR using `equity_final`
- `trading_cagr_pct` — CAGR from trades only (using `equity_after_trades`)
- `cash_contribution_pct` — `combined - trading`

**Formula:**

```
total_days    = (date_to - date_from).days
total_years   = total_days / 365.25

trading_cagr  = (equity_after_trades / initial_capital)^(1/total_years) - 1
combined_cagr = (equity_final        / initial_capital)^(1/total_years) - 1
cash_contrib  = combined_cagr - trading_cagr
```

**Edge cases:**
- `total_days < 7` → returns `0.0` for all three (window too short)
- `initial_capital <= 0` → returns `0.0` for all three

**Worked example (exp_018, full_cycle_2, 2017–2026):**

```
initial_capital      = $20,000
equity_after_trades  = $48,320   (from 48 trades)
idle_interest        = $6,105    (cash at 3% during idle days)
equity_final         = $54,425

total_days   = (2026-03-16 - 2017-01-01).days = 3361
total_years  = 3361 / 365.25 = 9.2

trading_cagr  = ($48,320/$20,000)^(1/9.2) - 1 = 2.416^0.1087 - 1 = 10.25%
combined_cagr = ($54,425/$20,000)^(1/9.2) - 1 = 2.721^0.1087 - 1 = 11.37%
cash_contrib  = 11.37% - 10.25% = 1.12%
```

**See also:** [Performance-Metrics-Guide — CAGR](Performance-Metrics-Guide#cagr) · [CLAUDE.md — CAGR 3-Component Formula](CLAUDE.md)

---

### cagr_annual()

```python
def cagr_annual(
    start_equity: float,
    end_equity: float,
    date_from: str,
    date_to: str,
) -> float
```

Simple annualised CAGR as a percentage (e.g. `14.82`, not `0.1482`).

**Formula:** `(end/start)^(365.25/days) - 1`, as `%`.

**Returns:** `0.0` if `start_equity <= 0` or dates span < 1 day. `-100.0` if `end_equity <= 0`.

**Example**

```python
cagr = cagr_annual(20_000, 48_320, "2017-01-01", "2026-03-16")
# returns 10.25
```

---

### sharpe_ratio()

```python
def sharpe_ratio(
    equity_curve: list[float],
    risk_free_rate: float = 0.0,
) -> float
```

Annualised Sharpe ratio from a daily equity curve.

**Formula:**
```
daily_returns = diff(equity_curve) / equity_curve[:-1]
sharpe        = (mean(daily_returns) - rf/252) / std(daily_returns) × √252
```

**Returns:** `0.0` if fewer than 2 data points or `std == 0`.

**Interpretation table:**

| Sharpe | Meaning |
|--------|---------|
| > 2.0 | Exceptional |
| 1.0–2.0 | Strong |
| 0.5–1.0 | Acceptable |
| < 0.5 | Weak |

**Benchmark:** B2 (baseline) rolling_5y Sharpe = 0.827. exp_018 rolling_5y = 0.923.

---

### sortino_ratio()

```python
def sortino_ratio(
    equity_curve: list[float],
    risk_free_rate: float = 0.0,
) -> float
```

Annualised Sortino ratio — penalises **only downside** volatility.

**Formula:**
```
downside = daily_returns[daily_returns < 0]
sortino  = (mean(daily_returns) - rf/252) / std(downside) × √252
```

**Returns:** `0.0` if no negative returns (zero downside risk).

**vs Sharpe:** Sortino is preferred for strategies with asymmetric returns (long right tail). Higher Sortino relative to Sharpe indicates the volatility is mostly upside. See [Performance-Metrics-Guide — Sortino vs Sharpe](Performance-Metrics-Guide#sortino-vs-sharpe).

---

### calmar_ratio()

```python
def calmar_ratio(cagr_pct: float, max_drawdown_pct: float) -> float
```

Calmar ratio: `CAGR% / |max_drawdown%|`. The primary risk-adjusted metric for Phase 2 evaluation.

**Returns:** `0.0` if `max_drawdown_pct == 0`.

**Example:** `calmar_ratio(45.80, -28.15)` → `45.80 / 28.15` → **1.63** ✅

**Phase 2 target:** Calmar > 1.0 on both `rolling_5y` AND `full_cycle_2`.

| Result | Meaning |
|--------|---------|
| > 2.0 | Excellent risk management |
| 1.0–2.0 | Target zone |
| 0.5–1.0 | Below target |
| < 0.5 | Poor risk management |

---

### max_drawdown()

```python
def max_drawdown(equity_curve: list[float]) -> tuple[float, int]
```

Maximum peak-to-trough drawdown and its duration in bars.

**Returns:** `tuple[float, int]` — `(max_drawdown_pct, duration_bars)`.
- `max_drawdown_pct` ≤ 0 (e.g. `-28.15` means -28.15%)
- `duration_bars` = bars from peak to trough of worst drawdown

**Algorithm:**
```
peak = equity_curve[0]
for each equity value:
    if equity > peak: update peak, reset peak_idx
    dd = (equity - peak) / peak × 100
    if dd < max_dd: record max_dd and duration
```

**Worked example:**

```
equity_curve = [20000, 22000, 18000, 19000, 21000]
                        ↑peak         ↑worst
peak at index 1 = 22000
trough at index 2 = 18000
max_dd  = (18000 - 22000) / 22000 × 100 = -18.18%
duration = 2 - 1 = 1 bar
```

**Returns:** `(0.0, 0)` for monotonically non-decreasing equity.

---

### expectancy()

```python
def expectancy(trades: list[dict]) -> float
```

Expected return per trade as a percentage.

**Formula:**
```
win_rate  = wins / total_trades
loss_rate = 1 - win_rate
avg_win   = mean(pnl_pct for winning trades)
avg_loss  = mean(pnl_pct for losing trades)
expectancy = (win_rate × avg_win) + (loss_rate × avg_loss)
```

**Returns:** `0.0` for empty trades list.

**Worked example:**

```
10 trades: 6 wins (avg +15%), 4 losses (avg -8%)
win_rate  = 0.6,  loss_rate = 0.4
expectancy = (0.6 × 15%) + (0.4 × -8%) = 9% - 3.2% = +5.8%
```

A positive expectancy means the strategy makes money on average per trade. A system with 40% win rate can still be profitable with high expectancy if avg wins >> avg losses.

---

### r_multiples()

```python
def r_multiples(trades: list[dict]) -> tuple[float, float]
```

Average and standard deviation of R-multiples across all trades.

**Formula:** `r_multiple = pnl_usd / initial_risk_usd` per trade.

**Returns:** `tuple[float, float]` — `(mean_R, std_R)`. Returns `(0.0, 0.0)` for empty list.

**Worked example:**

```
5 trades: [3.3R, 1.2R, -0.8R, 2.1R, -1.0R]
mean_R = (3.3 + 1.2 - 0.8 + 2.1 - 1.0) / 5 = 4.8 / 5 = 0.96
std_R  = std([3.3, 1.2, -0.8, 2.1, -1.0])   = 1.58
```

An `avg_R > 1.0` indicates trades earn more than their initial risk. See [Performance-Metrics-Guide — R-Multiple](Performance-Metrics-Guide#r-multiple-distribution).

---

### buy_and_hold()

```python
def buy_and_hold(bars: pd.DataFrame, initial_capital: float) -> dict
```

Compute the buy-and-hold (B1) baseline for the same date window.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `bars` | `pd.DataFrame` | Same bars as the backtest window |
| `initial_capital` | `float` | Starting capital |

**Returns:** `dict` with keys:
- `cagr_annual_pct`, `max_drawdown_pct`, `sharpe_ratio`, `calmar_ratio`, `total_return_pct`

**Method:** Buys at close of first bar, sells at close of last bar. No costs, no stops.

```
shares       = initial_capital / bars.close[0]
equity_curve = [shares × price for price in bars.close]
```

**TQQQ B1 locked results (full_cycle_2):**
```
CAGR:    38.57%
Max DD:  -81.66%
Calmar:  0.47
```

Every strategy run is compared against B1 — if the strategy can't beat buy-and-hold on Calmar, it's not adding value.

---

### benchmark_comparison()

```python
def benchmark_comparison(
    equity_curve: list[float],
    benchmark_bars: pd.DataFrame,
) -> dict
```

Compare strategy daily returns vs a benchmark. Returns alpha, beta, and correlation.

**Returns:** `dict` with keys:
- `alpha_pct` — annualised Jensen's alpha (rf=0), as %
- `beta` — market sensitivity (cov(strat, bench) / var(bench))
- `correlation` — Pearson correlation of daily returns

**Returns** `{"alpha_pct": 0.0, "beta": 0.0, "correlation": 0.0}` if fewer than 2 data points.

---

### compute_all()

```python
def compute_all(
    trades: list[dict],
    equity_curve: list[float],
    config: Config,
    equity_after_trades: float | None = None,
    equity_final: float | None = None,
) -> dict
```

**Master metrics function.** Computes all 19 metrics and returns a single dict. Called once per run by `recorder.py` before `save_run()`.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `trades` | `list[dict]` | Completed trades from `run_symbol()` |
| `equity_curve` | `list[float]` | Daily equity (measurement period) |
| `config` | `Config` | For `initial_capital`, `date_from/to`, `commission` |
| `equity_after_trades` | `float \| None` | If provided, enables 3-component CAGR |
| `equity_final` | `float \| None` | `equity_after_trades + idle_interest` |

**Returns dict — all 19 keys always present:**

| Key | Formula / Source |
|-----|-----------------|
| `cagr_annual_pct` | `calc_cagr()` combined (uses `equity_final`) |
| `trading_cagr_pct` | `calc_cagr()` trading component |
| `cash_contribution_pct` | `calc_cagr()` cash component |
| `cagr_holding_period_pct` | `cagr_annual()` on equity_curve endpoints |
| `sharpe_ratio` | `sharpe_ratio(equity_curve)` |
| `sortino_ratio` | `sortino_ratio(equity_curve)` |
| `calmar_ratio` | `calmar_ratio(cagr, max_dd)` |
| `max_drawdown_pct` | `max_drawdown(equity_curve)[0]` |
| `max_drawdown_duration_days` | `max_drawdown(equity_curve)[1]` |
| `expectancy_pct` | `expectancy(trades)` |
| `win_rate_pct` | `len(wins)/total × 100` |
| `avg_win_pct` | Mean `pnl_pct` of winning trades |
| `avg_loss_pct` | Mean `pnl_pct` of losing trades |
| `profit_factor` | `sum(wins_usd) / sum(|losses_usd|)` |
| `total_trades` | `len(trades)` |
| `trades_per_year` | `total_trades / years` |
| `total_net_pnl_usd` | `sum(pnl_usd for t in trades)` |
| `time_in_market_pct` | `sum(hold_bars) / total_bars × 100` |
| `total_commission_paid` | `commission × 2 × n_trades` |

**3-component CAGR is populated only when `equity_after_trades` and `equity_final` are provided** (set by `run_symbol()`). For backward compatibility, if they are `None`, `trading_cagr_pct` and `cash_contribution_pct` default to `0.0` and `cagr_annual_pct` uses `equity_curve` only.

**See also:** [Performance-Metrics-Guide](Performance-Metrics-Guide) · [Database-Schema — runs table](Database-Schema#runs-table)

---

## backtest/recorder.py

SQLite persistence layer. Stores runs, baselines, experiments, trades, and the 18-window registry. Computes baseline deltas and verdict classification automatically on `save_run()`.

---

### init_db()

```python
def init_db(db_path: str = "trading.db") -> sqlite3.Connection
```

Create all 5 tables (idempotent) and return an open connection. Applies forward migrations on each call.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `db_path` | `str` | Path to SQLite database file |

**Returns:** `sqlite3.Connection` — must be closed by caller.

**Tables created:**

| Table | Purpose |
|-------|---------|
| `runs` | One row per backtest run — all metrics, config snapshot, baseline deltas |
| `baselines` | B1 (buy-and-hold) and B2 (ATR45 baseline) per symbol/window |
| `experiments` | Experiment metadata and conclusions |
| `trades` | Individual trade records linked to `run_id` |
| `data_windows` | 18-window registry with dates, regimes, and availability |

**Migrations:** On each open, checks `PRAGMA table_info(runs)` and adds any missing columns (e.g. `trading_cagr_pct`, `cb_activated`). Safe to call on any DB version.

**Idempotency:** Uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN` with existence checks. Running twice is safe.

**Example**

```python
conn = init_db("trading.db")
try:
    save_run(conn, ...)
finally:
    conn.close()
```

**See also:** [Database-Schema](Database-Schema)

---

### classify_verdict()

```python
def classify_verdict(
    vs_b2_sharpe_delta: float | None,
    total_trades: int,
    experiment_id: str,
) -> str
```

Classify a run result into a verdict label based on Sharpe vs B2 baseline.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `vs_b2_sharpe_delta` | `float \| None` | `strat_sharpe - b2_sharpe` |
| `total_trades` | `int` | Number of completed trades |
| `experiment_id` | `str` | Experiment name (detects B2 itself) |

**Returns:** `str` — one of 6 verdict labels.

**Decision logic:**

```
experiment_id == "baseline_atr45"    → "BASELINE"   (this run IS the B2)
total_trades == 0                    → "ZERO_TRADES" (no signals fired)
vs_b2_sharpe_delta is None           → "NO_BASELINE" (B2 not yet stored)
|delta| < 0.001                      → "BASELINE"    (effectively identical to B2)
delta >= +0.02                       → "IMPROVEMENT"
delta <= -0.02                       → "NO_IMPROVEMENT"
-0.02 < delta < +0.02               → "NEUTRAL"      (noise dead zone)
```

**Why ±0.02 threshold:** Prevents noise from being labelled as meaningful improvement. A Sharpe delta of < 0.02 is within typical estimation error for the window sizes used.

**Example**

```
B2 rolling_5y Sharpe = 0.827
exp_018 rolling_5y Sharpe = 0.923
delta = 0.923 - 0.827 = +0.096 → "IMPROVEMENT" ✅
```

---

### save_run()

```python
def save_run(
    conn: sqlite3.Connection,
    experiment_id: str,
    config: Config,
    metrics: dict,
    result: BacktestResult,
    git_commit: str,
    notes: str = "",
) -> str
```

Persist a completed backtest run to the `runs` table. Returns the auto-generated `run_id`.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `conn` | `Connection` | Open DB connection from `init_db()` |
| `experiment_id` | `str` | e.g. `"exp_018_atr_wider"` |
| `config` | `Config` | Full config (stored as JSON snapshot) |
| `metrics` | `dict` | Output of `compute_all()` |
| `result` | `BacktestResult` | Output of `run()` |
| `git_commit` | `str` | SHA from `git rev-parse HEAD` |
| `notes` | `str` | Optional notes |

**Returns:** `str` — `run_id` in format `"run_0001"`, `"run_0002"`, etc.

**What gets computed automatically:**

```
run_id          = "run_{max_N + 1:04d}"
config_snapshot = json.dumps(config.to_dict())   ← full reproducibility
bh baseline     = fetched from baselines table (B1)
b2 baseline     = fetched from runs table (experiment_id='baseline_atr45', same window)
delta_bh_cagr   = strat_cagr - bh_cagr
delta_b2_cagr   = strat_cagr - b2_cagr
verdict         = classify_verdict(vs_b2_sharpe_delta, total_trades, experiment_id)
```

**Run ID generation:**

```python
cursor.execute("SELECT MAX(CAST(SUBSTR(run_id, 5) AS INTEGER)) FROM runs")
max_num = cursor.fetchone()[0] or 0
run_id = f"run_{max_num + 1:04d}"
# First run: "run_0001"
# 100th run:  "run_0100"
```

**Example**

```python
conn = init_db("trading.db")
result = run(config, db_path="trading.db")
metrics = compute_all(result.trades, result.equity_curve, config,
                      result.equity_after_trades, result.equity_final)
run_id = save_run(conn, "exp_018_atr_wider", config, metrics, result,
                  git_commit="9916cb0", notes="Phase 2 best config")
print(run_id)   # "run_0078"
conn.close()
```

---

### save_trades()

```python
def save_trades(
    conn: sqlite3.Connection,
    run_id: str,
    trades: list,
) -> None
```

Persist all individual trades for a run to the `trades` table.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `conn` | `Connection` | Open DB connection |
| `run_id` | `str` | Run ID from `save_run()` — must exist in `runs` |
| `trades` | `list[dict]` | Trade dicts from `run()` |

**Returns:** None

**Trade ID format:** `"{run_id}_t{i:03d}"` — e.g. `"run_0078_t000"`, `"run_0078_t001"`.

**Must be called after `save_run()`** — the trades table has a `FOREIGN KEY (run_id) REFERENCES runs(run_id)`. Calling before `save_run()` will fail.

**Fields stored per trade:**

| Field | Type |
|-------|------|
| `trade_id` | `TEXT` |
| `run_id` | `TEXT FK→runs` |
| `symbol`, `direction` | `TEXT` |
| `entry_date`, `exit_date` | `TEXT` |
| `entry_price`, `exit_price` | `REAL` |
| `shares`, `stop_price` | `INTEGER/REAL` |
| `exit_reason` | `TEXT` |
| `hold_bars`, `pnl_usd`, `pnl_pct` | `INTEGER/REAL` |
| `r_multiple`, `initial_risk_usd` | `REAL` |
| `entry_bar_idx`, `exit_bar_idx` | `INTEGER` |

---

### get_or_create_baseline()

```python
def get_or_create_baseline(
    conn: sqlite3.Connection,
    baseline_type: str,
    symbol: str,
    date_from: str,
    date_to: str,
    metrics: dict | None = None,
) -> dict
```

Return an existing baseline or create one from `metrics`. Idempotent — calling twice never overwrites.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `baseline_type` | `str` | `"buy_and_hold"` or `"atr_default"` |
| `symbol` | `str` | Ticker symbol |
| `date_from`, `date_to` | `str` | Window dates |
| `metrics` | `dict \| None` | Metrics to store on first call |

**baseline_key:** `"{symbol}_{date_from}_{date_to}"` — uniquely identifies the window.

**Raises:** `ValueError` — if no baseline exists and `metrics=None`.

**Usage pattern:**

```python
# B1 run first — store buy-and-hold baseline
bh_metrics = buy_and_hold(bars, config.backtest.initial_capital)
get_or_create_baseline(conn, "buy_and_hold", "TQQQ",
                       config.backtest.date_from, config.backtest.date_to,
                       metrics=bh_metrics)

# B2 run (baseline_atr45) — stored as a regular run
# save_run() then fetches it from runs table when computing vs_b2 deltas
```

---

### diff_runs()

```python
def diff_runs(
    conn: sqlite3.Connection,
    run_id_a: str,
    run_id_b: str,
) -> None
```

Print config and metric differences between two runs to stdout. Useful for understanding what changed between experiments.

**Output format:**

```
============================================================
DIFF: run_0050  vs  run_0078
============================================================

--- CONFIG DIFF ---
  indicators.atr_multiplier          4.5  →  5.0
  stop.hard_stop_pct                0.10  →  0.11
  risk.use_volatility_sizing        False →  True

--- METRIC DIFF ---
  cagr_annual_pct              41.87     →  45.80   (Δ 3.93) <--
  max_drawdown_pct            -29.48     → -28.15   (Δ 1.33) <--
  sharpe_ratio                  0.827    →  0.923   (Δ 0.096) <--
  calmar_ratio                  1.42     →  1.63    (Δ 0.21) <--
  win_rate_pct                 54.29     →  55.56   (Δ 1.27)
  total_trades                    35     →     27   (Δ -8) <--
```

**Example**

```python
conn = init_db("trading.db")
diff_runs(conn, "run_0050", "run_0078")   # B2 vs exp_018
conn.close()
```

---

### readiness_check()

```python
def readiness_check(
    conn: sqlite3.Connection,
    strategy_name: str,
) -> dict
```

Evaluate 8 hard criteria for live-trading readiness. Returns a pass/fail dict.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `conn` | `Connection` | Open DB connection |
| `strategy_name` | `str` | e.g. `"TQQQ_momentum"` |

**Returns:**

```python
{
  "pass": True/False,           # True only if ALL 8 criteria pass
  "criteria": [
    {"name": "...", "status": "PASS"/"FAIL", "detail": "..."},
    ...
  ]
}
```

**8 criteria:**

| # | Criterion | Threshold |
|---|-----------|-----------|
| 1 | Minimum runs | ≥ 10 runs logged |
| 2 | Minimum symbols | ≥ 1 symbol tested |
| 3 | Minimum regimes | ≥ 2 distinct date windows |
| 4 | Stress test | ≥ 1 completed run |
| 5 | OOS test | ≥ 2 distinct windows |
| 6 | Calmar ratio | Best run Calmar > 1.0 |
| 7 | Win rate | Best run win rate > 40% |
| 8 | Max drawdown | Best run DD > -30% |

**Example**

```python
conn = init_db("trading.db")
result = readiness_check(conn, "TQQQ_momentum")
if result["pass"]:
    print("✅ Strategy is ready for live trading")
else:
    for c in result["criteria"]:
        if c["status"] == "FAIL":
            print(f"❌ {c['name']}: {c['detail']}")
```

---

### restore_config_from_run()

```python
def restore_config_from_run(
    conn: sqlite3.Connection,
    run_id: str,
    output_path: str = "config.yaml",
) -> str
```

Extract the `config_snapshot` from a stored run and write it to a YAML file. Enables full reproduction of any past run.

**Returns:** `str` — git commit SHA from the run record.

**Example**

```python
git_sha = restore_config_from_run(conn, "run_0078", "config_restored.yaml")
print(f"Restore config at git commit: {git_sha}")
# Now: git checkout {git_sha} && python backtest/run.py --config config_restored.yaml
```

---

### save_experiment()

```python
def save_experiment(
    conn: sqlite3.Connection,
    experiment_id: str,
    yaml_path: str,
) -> None
```

Upsert an experiment record from its YAML file. Reads metadata fields (`status`, `outcome`, `conclusion`, `winning_run_id`) and stores raw YAML text.

**Idempotent:** Uses `INSERT OR REPLACE` — safe to call before every run during an experiment.

**Example**

```python
save_experiment(conn, "exp_018_atr_wider", "experiments/exp_018_atr_wider.yaml")
```

---

### conclude_experiment()

```python
def conclude_experiment(
    conn: sqlite3.Connection,
    experiment_id: str,
    conclusion: str,
    outcome: str,
    winning_run_id: str | None,
) -> None
```

Mark an experiment as concluded. Sets `status = 'concluded'` in the `experiments` table.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `outcome` | `str` | `"positive"`, `"negative"`, or `"inconclusive"` |
| `winning_run_id` | `str \| None` | Best run ID for this experiment |

**Example**

```python
conclude_experiment(
    conn, "exp_018_atr_wider",
    conclusion="Best Calmar on 5Y (1.63). Full cycle Calmar 0.75 — below target.",
    outcome="positive",
    winning_run_id="run_0078",
)
```

---

### populate_data_windows()

```python
def populate_data_windows(conn: sqlite3.Connection) -> int
```

Insert all 18 dataset registry rows into the `data_windows` table. Idempotent — uses `INSERT OR IGNORE`.

**Returns:** `int` — number of rows actually inserted (0 if all already exist).

**When to call:** Once after `init_db()` on a fresh database. The window registry is stable — it never changes during normal operation.

**Window IDs match `window_label` in the `runs` table** — enabling `JOIN` queries between runs and window metadata.

**18 windows registered:**

| ID | Type | Dates |
|----|------|-------|
| `bear_period_3` | bear | 2018-06-01 → 2019-07-30 |
| `bear_period_4` | bear | 2019-10-01 → 2020-09-30 |
| `bear_period_5` | bear | 2021-07-01 → 2023-07-30 |
| `bear_period_3_new` | bear | 2018-06-01 → 2019-07-30 |
| `bear_period_4_new` | bear | 2019-11-01 → 2020-07-30 |
| `bear_period_5_new` | bear | 2021-11-01 → 2023-07-30 |
| `bull_period_1–5` | bull | Various |
| `full_cycle_1` | full | 2010-02-11 → 2026-03-16 |
| `full_cycle_2` | full | 2017-01-01 → 2026-03-16 |
| `rolling_1y/3y/5y/10y/15y` | rolling | Various |
| `train_full` | ml_train | 2010-02-11 → 2016-12-31 |

**See also:** [Data-Windows-Reference](Data-Windows-Reference)

---

### export_to_csv()

```python
def export_to_csv(
    conn: sqlite3.Connection,
    output_path: str = "runs_export.csv",
) -> int
```

Export all rows from the `runs` table to CSV. Returns number of rows written.

**Returns:** `int` — 0 if table is empty (writes empty file).

**Use cases:**
- Share results with teammates without DB access
- Import into Excel for analysis
- Archive before a major rerun

**Example**

```python
n = export_to_csv(conn, "results_2026_03_19.csv")
print(f"Exported {n} runs")   # Exported 78 runs
```

---

## Quick Reference — Call Order

**Running a new experiment:**

```python
from engine.config import load_config
from backtest.runner import run
from backtest.metrics import compute_all, buy_and_hold
from backtest.recorder import init_db, save_run, save_trades, save_experiment

# 1. Load config
config = load_config("experiments/exp_018_atr_wider.yaml")

# 2. Init DB (idempotent)
conn = init_db("trading.db")

# 3. Store experiment metadata
save_experiment(conn, "exp_018_atr_wider", "experiments/exp_018_atr_wider.yaml")

# 4. Run backtest
result = run(config, db_path="trading.db")

# 5. Compute metrics
metrics = compute_all(result.trades, result.equity_curve, config,
                      result.equity_after_trades, result.equity_final)

# 6. Save run
run_id = save_run(conn, "exp_018_atr_wider", config, metrics, result,
                  git_commit="9916cb0")

# 7. Save individual trades
save_trades(conn, run_id, result.trades)

conn.close()
print(f"Run saved: {run_id}")
print(f"CAGR: {metrics['cagr_annual_pct']:.2f}%  Calmar: {metrics['calmar_ratio']:.2f}")
```

---

*Back to [Home](Home) · [Ref-Engine-Core](Ref-Engine-Core) · [Backtest-Engine](Backtest-Engine) · [Performance-Metrics-Guide](Performance-Metrics-Guide)*
