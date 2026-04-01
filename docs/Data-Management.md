# Data Management

How price data enters the system, stays current, and feeds both backtests and live trading.

---

## Overview

The system uses two data tiers:

```
Tier 1 — CSV file (primary source)
  data/TQQQ_1d.csv
  Daily OHLCV + adj_close.
  Checked into git. Updated periodically.

Tier 2 — SQLite daily cache (DB table)
  trading.db → TQQQ_daily
  Seeded from CSV on first use.
  Auto-synced with Yahoo Finance on each backtest run.

Tier 3 — SQLite hourly cache (live only)
  trading.db → TQQQ_1h
  Populated by live/data.py backfill and sync functions.
  Used by live executor for stop monitoring.
```

All data flows through `data/loader.py`. That module imports nothing from the project — it is an isolated, pure data layer.

---

## Data Flow Diagram

```
Yahoo Finance
      │
      │  yfinance API
      ▼
download_yahoo() ──────────────────────→ data/TQQQ_1d.csv
                                              │
                                              │  load_csv()
                                              ▼
                                      raw DataFrame (unadjusted close)
                                              │
                                              │  apply_adjustment()
                                              ▼
                                      adjusted DataFrame
                                      (all OHLC × adj_factor)
                                              │
                                              │  slice_window()
                                              ▼
                               (df_with_warmup, actual_warmup)
                                              │
                                              │  runner.py
                                              ▼
                                        Backtest run

─────────────────────────────────────────────────────────────────

      ┌─────────────────────────────────────────────────────┐
      │                get_daily_bars()                     │
      │                                                     │
      │  1. Open trading.db → check TQQQ_daily table        │
      │  2. If empty:                                       │
      │     a. csv_path given → seed from CSV               │
      │     b. no csv_path   → full Yahoo download          │
      │  3. last_date < today → fetch incremental update    │
      │  4. Return full DataFrame from DB                   │
      └─────────────────────────────────────────────────────┘
              Used by runner.py on every backtest run
```

---

## Daily CSV: `data/TQQQ_1d.csv`

### Format

```
date,open,high,low,close,volume,adj_close
2010-02-11,5.01,5.09,4.87,4.97,1234567,3.21
2010-02-12,4.98,5.04,4.90,5.02,987654,3.25
...
```

**Required columns (case-insensitive):** `date`, `open`, `high`, `low`, `close`, `volume`, `adj_close`

`adj_close` is the split/dividend adjusted closing price from Yahoo Finance. All other columns contain unadjusted market prices.

### File status

| Detail | Value |
|--------|-------|
| File path | `data/TQQQ_1d.csv` |
| History | 2010-02-11 → current |
| Symbol | TQQQ (3× leveraged NASDAQ-100 ETF) |
| Git status | **Committed intentionally** — marked binary in `.gitattributes` |
| Size (approx) | ~400 KB, ~4,000 rows |

### Why it is committed to git

Most data files should not be committed, but TQQQ_1d.csv is an exception because:
1. It is required for a new machine to run backtests immediately without a Yahoo download
2. It is marked binary in `.gitattributes` — no diffs, no merge conflicts
3. It changes infrequently (only when new bars are appended)

---

## Price Adjustment

`apply_adjustment()` must be called before any indicator calculation.

### Why adjustment is needed

TQQQ has undergone reverse splits. Without adjustment, price charts show artificial jumps that would produce false ATR spikes, incorrect VWAP calculations, and phantom stop hits.

### How it works

```python
factor = adj_close / close          # per-bar ratio (usually < 1.0)
open   = open   × factor
high   = high   × factor
low    = low    × factor
close  = adj_close                  # replace with the adjusted series
```

**Example — 2022 reverse split bar:**

| Column | Raw value | Factor | Adjusted value |
|--------|----------|--------|---------------|
| open | 27.45 | 0.3333 | 9.15 |
| high | 28.10 | 0.3333 | 9.37 |
| low | 27.20 | 0.3333 | 9.07 |
| close | 27.80 | 0.3333 | adj_close = 9.27 |
| adj_close | 9.27 | — | 9.27 |

After adjustment, all OHLC prices are on the same scale as today's prices. A chart of the adjusted series shows a smooth continuous history.

### Important: live orders use unadjusted prices

The adjustment is for **indicator calculation only**. Live buy/sell orders always use the current unadjusted market price from the broker feed — never the adjusted value.

---

## `load_csv()` — Loading the CSV File

```python
df = load_csv("data/TQQQ_1d.csv")
```

**What it does:**
1. Reads the CSV with `parse_dates=["date"]`
2. Normalises all column names to lowercase
3. Checks all required columns are present
4. Sorts ascending by date with a fresh RangeIndex
5. Returns a clean DataFrame

**Error handling:**

| Condition | Exception |
|-----------|---------|
| File does not exist | `FileNotFoundError` |
| Empty file | `ValueError: CSV file is empty` |
| Missing columns | `ValueError: CSV missing required columns: [...]` |
| Unparseable dates | `ValueError: Failed to parse 'date' column: ...` |

---

## `validate_data()` — Data Quality Checks

```python
warnings = validate_data(df, symbol="TQQQ")
for w in warnings:
    print(w)
```

Returns a list of warning strings — never raises. The caller decides what to do with them. Five checks run:

| Check | Trigger |
|-------|---------|
| Duplicate dates | Any date appears more than once |
| Large gaps | More than 5 calendar days between consecutive bars |
| OHLC logic | `high < low`, `high < open`, `high < close`, `low > open`, `low > close` |
| Zero/negative prices | Any price ≤ 0 in open/high/low/close |
| Zero volume | More than 10% of rows have `volume == 0` |

**When to run validation:**

Run after every CSV update and after every Yahoo download:
```python
df = load_csv("data/TQQQ_1d.csv")
warnings = validate_data(df, symbol="TQQQ")
if warnings:
    for w in warnings:
        print(f"WARNING: {w}")
```

A TQQQ CSV with no issues will produce an empty list. Large-gap warnings are normal around holiday periods (e.g., Christmas, New Year).

---

## `slice_window()` — Cutting Backtest Windows

```python
df_window, actual_warmup = slice_window(
    df,
    date_from="2021-03-16",
    date_to="2026-03-16",
    warmup_bars=250,
)
```

**What it does:**

```
Full CSV:  [2010 ──────────────────────────────────── 2026]

date_from = 2021-03-16
date_to   = 2026-03-16

Without warmup:
  Result:  [2021-03-16 ──── 2026-03-16]  ← measurement window only

With warmup_bars=250:
  Prepend: up to 250 bars before 2021-03-16 (typically 2020-02-xx)
  Result:  [2020-02-xx ─ warmup ─ 2021-03-16 ── measurement ── 2026-03-16]
             ↑ actual_warmup bars ↑
```

The `actual_warmup` return value tells `runner.py` exactly how many leading bars to skip when recording results — so P&L counting starts at `date_from`, not at the warmup start.

**Returns:**

| Value | Type | Description |
|-------|------|-------------|
| `df_with_warmup` | `pd.DataFrame` | Warmup + measurement rows |
| `actual_warmup` | `int` | Number of prepended warmup rows (≤ requested `warmup_bars`) |

**Why `actual_warmup` may be less than requested:**

If `date_from` is close to the start of the CSV (e.g., `date_from=2010-02-15` with `warmup_bars=250`), there may be fewer than 250 bars available before the window. The function returns whatever is available — indicators will be partially warmed, not fully.

For all standard windows, sufficient history exists. The only exception is `full_cycle_1` (starts 2010-02-11) where warmup approaches the very beginning of TQQQ history.

---

## `update_data()` — Keeping the CSV Current

```python
new_rows = update_data("TQQQ", output_dir="data")
print(f"Added {new_rows} new bars")
```

This is the standard way to keep `data/TQQQ_1d.csv` up to date. Run it before each trading session or before re-running experiments on fresh data.

**Logic:**

```
If file does not exist:
    download_yahoo("TQQQ", "2010-01-01", today) → saves full history
    return total rows

Else:
    last_date = max(date) in existing CSV
    If last_date >= today:
        return 0  ← already up to date

    Download: date_from = last_date + 1 day → today
    Merge with existing CSV
    Deduplicate by date
    Sort ascending
    Overwrite TQQQ_1d.csv
    return rows added
```

**Safe to run repeatedly.** Idempotent — duplicate dates are automatically removed.

---

## `download_yahoo()` — Full History Download

```python
filepath = download_yahoo(
    symbol="TQQQ",
    date_from="2010-02-11",
    date_to="2026-03-30",
    output_dir="data",
)
```

Downloads full OHLCV history and saves to `data/TQQQ_1d.csv`. Used when setting up a new machine or when the CSV needs a full rebuild.

**Column normalisation:**

`yfinance` has changed its column naming across versions. `download_yahoo()` handles all variants:

| yfinance output | Normalised to |
|----------------|--------------|
| `Adj Close` | `adj_close` |
| `adj_close` | `adj_close` |
| `adjclose` | `adj_close` |
| Missing (v1.x) | `adj_close = close` (fallback) |

**Timezone handling:**

Yahoo returns timestamps with UTC timezone. The function strips timezone info (`tz_localize(None)`) so dates are naive, consistent with the rest of the codebase.

---

## `get_daily_bars()` — DB-Cached Bar Access

```python
df = get_daily_bars(
    symbol="TQQQ",
    db_path="trading.db",
    csv_path="data/TQQQ_1d.csv",
)
```

This is the function `runner.py` calls on every backtest run. It maintains the `TQQQ_daily` table in `trading.db` as a cache of the CSV, automatically syncing new bars.

**Decision tree:**

```
┌─ Is TQQQ_daily empty?
│
├─ YES and csv_path given → seed from CSV
│      Print: "[TQQQ] Seeding TQQQ_daily from data/TQQQ_1d.csv..."
│
├─ YES and no csv_path → full Yahoo download (2010-01-01 → today)
│      Print: "[TQQQ] No local data — downloading full history from Yahoo..."
│
└─ NO (table has data)
       └─ Is last_date < today?
          ├─ YES → fetch date_from = last_date+1 → today
          │        Insert new bars (INSERT OR REPLACE)
          │        Print: "[TQQQ] Added N new bar(s) to ticker_daily"
          └─ NO  → Print: "[TQQQ] ticker_daily is up to date (last: YYYY-MM-DD)"

Return: full TQQQ_daily as DataFrame
```

**Why this approach:**

- First call is fast if CSV exists — seeds from local file, no network required
- Subsequent calls are fast — only fetches days since the last stored date
- Weekend/holiday runs are safe — Yahoo returns an empty result, `ValueError` is silently caught
- Yahoo rate limits are handled gracefully — no crash, uses existing data

**`TQQQ_daily` table schema:**

```sql
CREATE TABLE IF NOT EXISTS TQQQ_daily (
    date      TEXT PRIMARY KEY,   -- YYYY-MM-DD
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    volume    REAL,
    adj_close REAL
)
```

---

## `seed_from_csv()` — One-Time DB Population

```python
rows_written = seed_from_csv(
    symbol="TQQQ",
    csv_path="data/TQQQ_1d.csv",
    db_path="trading.db",
)
print(f"Seeded {rows_written} bars")
```

Explicitly seeds the `TQQQ_daily` table from the CSV. Used when:
- Setting up a new machine where the DB table does not yet exist
- Rebuilding the DB after a database reset

Safe to call multiple times — uses `INSERT OR REPLACE` so no duplicate rows are created.

---

## Hourly Bars: `TQQQ_1h` (Live Trading Only)

The hourly bar table is used exclusively by the live trading system for stop monitoring between daily signal evaluations. It is populated by functions in `live/data.py`, not by `data/loader.py`.

```sql
CREATE TABLE IF NOT EXISTS TQQQ_1h (
    timestamp TEXT PRIMARY KEY,   -- ISO datetime string
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    volume    INTEGER
)
```

**How it is populated:**

| Function | When called | What it does |
|----------|------------|-------------|
| `backfill_hourly_db()` | Once, on first setup | Downloads 5 years of hourly bars from IBKR |
| `sync_hourly_db()` | Daily, on live loop start | Fetches any missing bars since last stored timestamp |
| `fetch_hourly_bars()` | On demand | Returns hourly bars as DataFrame for stop checks |

See [Live Trading Engine](Live-Trading-Engine.md) for the stop monitoring loop that reads this table.

---

## Common Data Tasks

### Set up a new machine

```bash
# Step 1: Clone the repo (TQQQ_1d.csv is already in git)
git clone <repo> tqqq-dev
cd tqqq-dev

# Step 2: Copy and configure files
cp config.yaml.example config.yaml
# Edit config.yaml with your settings
cp .env.example .env  # (create if needed)
# Edit .env with WORKING_DIR etc.

# Step 3: Seed the DB from the CSV
python -c "from data.loader import seed_from_csv; seed_from_csv('TQQQ', 'data/TQQQ_1d.csv', 'trading.db')"

# Step 4: Verify
python -c "from data.loader import get_daily_bars; df = get_daily_bars('TQQQ', 'trading.db', 'data/TQQQ_1d.csv'); print(f'Loaded {len(df)} bars, last: {df[\"date\"].max().date()}')"
```

### Update data before running backtests

```bash
python -c "from data.loader import update_data; n = update_data('TQQQ', 'data'); print(f'{n} new bars')"
```

Or via the backtest CLI (it calls `get_daily_bars()` which auto-syncs):

```bash
python backtest/run.py --config experiments/exp_018_atr_wider.yaml --window rolling_5y
```

### Validate CSV quality

```python
from data.loader import load_csv, validate_data

df = load_csv("data/TQQQ_1d.csv")
warnings = validate_data(df, symbol="TQQQ")

if not warnings:
    print(f"OK — {len(df)} bars, {df['date'].min().date()} to {df['date'].max().date()}")
else:
    for w in warnings:
        print(f"WARNING: {w}")
```

### Rebuild DB from scratch

```bash
# Delete and recreate tables
rm trading.db
python -c "
from backtest.recorder import init_db
init_db('trading.db')
from data.loader import seed_from_csv
seed_from_csv('TQQQ', 'data/TQQQ_1d.csv', 'trading.db')
print('DB rebuilt')
"
```

### Download pre-2017 data (for full_cycle_1, rolling_10y, rolling_15y)

Standard CSV covers 2010-onwards, but some windows need pre-2017 data that may not be in the committed CSV:

```python
from data.loader import download_yahoo, load_csv, update_data
import pandas as pd

# Download full history if current file lacks pre-2017
df = load_csv("data/TQQQ_1d.csv")
if df["date"].min() > pd.Timestamp("2010-02-11"):
    print("Downloading full history...")
    download_yahoo("TQQQ", "2010-02-11", "2026-03-30", output_dir="data")
    print("Done — run seed_from_csv() to update the DB cache")
```

### Check what data windows are available

```python
from data.loader import load_csv
import pandas as pd

df = load_csv("data/TQQQ_1d.csv")
first = df["date"].min().date()
last  = df["date"].max().date()
bars  = len(df)
print(f"Available: {first} to {last} ({bars} bars)")

# Check a specific window
test_from = pd.Timestamp("2021-03-16")
test_warmup_from = test_from - pd.offsets.BDay(250)
print(f"rolling_5y warmup starts: {test_warmup_from.date()}")
print(f"Has warmup data: {df['date'].min() <= test_warmup_from}")
```

---

## Data Consistency Rules

### Rule 1: Always adjust before indicators

```python
df = load_csv("data/TQQQ_1d.csv")
df = apply_adjustment(df)          # ← never skip this
df_win, warmup = slice_window(df, date_from, date_to, warmup_bars=250)
```

Calling `slice_window()` before `apply_adjustment()` would produce indicators on unadjusted prices — a subtle bug that would not raise an error but would produce wrong signals around split dates.

### Rule 2: Never slice before adjusting

Wrong order:
```python
df = load_csv(...)
df_win, _ = slice_window(df, ...)  # ← wrong: sliced before adjustment
df_win = apply_adjustment(df_win)  # adjustment factor is relative to full history
```

The adjustment factor (`adj_close / close`) must be computed on the full dataset. If you slice first, the factor is still computed correctly (it's per-bar), but you lose the continuity of the pre-window history that is needed for factor consistency. Always adjust first.

### Rule 3: warmup_bars must equal vwap_period

```python
warmup_bars = config.indicators.vwap_period  # = 250
df_win, actual_warmup = slice_window(df, date_from, date_to, warmup_bars)
```

VWAP(250) requires 250 prior bars to be fully warmed. ATR(45) needs 45. EMA(10) needs 10. The dominant requirement is VWAP(250), so `warmup_bars=250` satisfies all three simultaneously.

### Rule 4: runner.py strips warmup from results

`runner.py` passes `actual_warmup` to the main loop and skips recording any trades/equity points in the warmup region. The P&L starts counting only after `date_from`.

### Rule 5: NEVER run backtests on two machines simultaneously

`trading.db` is a SQLite file. Concurrent writes from two machines will corrupt the database. The Google Drive sync must be stopped before running backtests, and only one machine should write to the DB at a time.

---

## File Locations

| File | Path | Purpose |
|------|------|---------|
| Daily bars (CSV) | `data/TQQQ_1d.csv` | Primary price source — committed to git |
| Daily bars (DB) | `trading.db → TQQQ_daily` | DB cache — auto-synced by `get_daily_bars()` |
| Hourly bars (DB) | `trading.db → TQQQ_1h` | Live trading stop monitoring |
| loader module | `02-Common/data/loader.py` | All CSV and DB operations |
| live data module | `03-Live/live/data.py` | Hourly bar fetch, backfill, sync |

---

## Related Pages

- [Data Windows Reference](Data-Windows-Reference.md) — all 18 backtest windows with dates and warmup
- [Ref-Data-Backtest](Ref-Data-Backtest.md) — `runner.py` and how it consumes the data pipeline
- [Config Reference](Config-Reference.md) — `data_file`, `vwap_period`, `cash_rate_annual` parameters
- [Database Schema](Database-Schema.md) — full schema for `TQQQ_daily`, `TQQQ_1h`, and all tables
- [Live Trading Engine](Live-Trading-Engine.md) — how hourly bars feed the stop monitoring loop
