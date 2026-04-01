# Dashboard Guide

The Investo GUI — all screens, how to navigate between them, and what each panel shows.

**Architecture:** Flask 3.0 backend (`gui/app.py`, localhost:5000) + React 18 frontend (`gui/frontend/`, localhost:3000). The GUI is **read-only** — it never writes to `trading.db`.

---

## Starting the Dashboard

```bash
# Terminal 1 — Flask backend
cd E:\Trading\tqqq-dev\03-Live
python -m gui.app
# → Running on http://127.0.0.1:5000

# Terminal 2 — React frontend
cd E:\Trading\tqqq-dev\03-Live\gui\frontend
npm start
# → Compiled successfully! http://localhost:3000
```

---

## Navigation

The sidebar on the left contains navigation links to all screens. The **active screen** is highlighted with the primary teal colour (`#1D9E75`). The top bar shows the current screen title.

URL-based navigation is supported — the screen is preserved on browser reload.

---

## Colour System (Locked)

All colour decisions in the GUI are locked and should not change.

| Colour | Hex | Used for |
|--------|-----|---------|
| Primary teal | `#1D9E75` | Sidebar active, table headers, buttons, positive CAGR |
| Accent blue | `#185FA5` | Links, info badges, 0-trade cells |
| Win green | `#1D9E75` | Winning trades, positive metrics |
| Loss red | `#A32D2D` | Losing trades, negative metrics |
| Cash blue | `#185FA5` | 0-trade periods (idle cash return) |
| Neutral amber | `#E8A020` | Warnings, neutral results |

Source: [gui/frontend/src/styles/theme.js](../../03-Live/gui/frontend/src/styles/theme.js)

---

## Number Formatting (Locked)

All numbers use these formats — never deviate.

| Metric | Format | Example |
|--------|--------|---------|
| CAGR | `±XX.XX%` | `+45.80%` |
| Sharpe | `X.XX` (no sign) | `1.63` |
| Max DD | `-XX.XX%` (always negative) | `-28.15%` |
| Date | `DD MMM YYYY` | `16 Mar 2021` |
| Dollar P&L | `+$X,XXX` / `-$X,XXX` | `+$41,628` |
| Calmar | `X.XX` | `1.63` |

Source: [gui/frontend/src/styles/format.js](../../03-Live/gui/frontend/src/styles/format.js)

---

## Screen 1 — All Experiments

**Route:** `?screen=experiments`

The main research screen. Shows all backtest runs, grouped and filterable.

### Filters

| Filter | Options | Default |
|--------|---------|---------|
| Experiment | All + key configs (exp_018, exp_009, exp_008, exp_002, etc.) + baselines | All |
| Window | All + rolling (1y–15y) + full cycles + bear periods | All |
| Sort | Sharpe, CAGR, Max DD | Sharpe |

### Layout

**Collapsible experiment groups** — each group shows one experiment's results across all windows it was run on. Collapsed by default; click the group header to expand.

**Group header shows:**
- Badge: `BEST` / `PREV BEST` / `BASE` / `B&H`
- Experiment name (plain English label from `EXPERIMENT_NAMES` map)
- Window count
- Strategy params string (e.g., `ATR×5.0 | HS 11% | Vol ON | CB 30%`)
- Headline stats for `rolling_5y`: CAGR, Max DD, Sharpe, Calmar in colour-coded cards

**Table columns (per run row):**
- Window name
- Date range
- CAGR (coloured green/red)
- Max DD
- Sharpe
- Calmar
- Trades (underlined — clickable → Trade Log for that run)
- Net P&L
- Verdict badge

**Clicking a row** navigates to Screen 3 (Equity Growth) for that run.

**Pagination:** 20 rows per page.

**CSV export:** Available — exports 11 columns for all visible runs.

### Verdict Badges

| Badge | Meaning | Criteria |
|-------|---------|---------|
| `IMPROVEMENT` | Significantly better than baseline | Sharpe delta > +0.02 vs B2 |
| `NEUTRAL` | Similar to baseline | Sharpe delta within ±0.02 |
| `NO_IMPROVEMENT` | Significantly worse | Sharpe delta < -0.02 |
| `BASELINE` | This is the baseline run | `is_baseline = true` |
| `ZERO_TRADES` | No trades fired | `trades = 0` |

---

## Screen 2 — Results by Window (Heatmap Grid)

**Route:** `?screen=grid`

A matrix showing how each experiment performs across all windows simultaneously.

### Layout

- **Rows:** Experiments (BL1 buy-hold, BL2 baseline, then alphabetical)
- **Columns:** 11 windows (rolling 1y through full_cycle_2, bear periods)
- **Metric toggle:** Sharpe / CAGR / Max DD — switches which value is displayed in cells

### Cell colours

| Colour | Meaning |
|--------|---------|
| Teal/green | Metric beats the default baseline (B2) |
| Amber | Neutral (within threshold) |
| Red | Worse than baseline |
| Blue | 0 trades — only idle cash return |
| Gray | No data for this experiment/window combination |

### Side panel

Clicking any cell opens a 300px side panel on the right showing:
- Config details and window info
- 4 mini metrics: annual return, max loss, risk score, delta vs baseline
- Trade count and run ID
- Two navigation buttons: **View Equity Curve** → Screen 3 | **View Trade Log** → Screen 6

---

## Screen 3 — Equity Growth

**Route:** `?screen=equity`

Detailed performance view for a single run. Navigate here by clicking any row in Screen 1 or via the side panel in Screen 2.

### Run selector

Dropdown groups runs by type:
- Baselines (B1 buy-hold, B2 baseline_atr45)
- Best configs (exp_018, exp_009)
- Other experiments

### Starting capital input

User-adjustable input field (default $10,000). All dollar amounts on the screen recalculate live with a 500ms debounce. CAGR and percentages are not affected — only dollar values change.

### Charts

**Equity curve chart (top):**
- Strategy equity — solid line (teal)
- B1 buy-and-hold — dashed line (6,3 pattern)
- B2 baseline — dashed line (3,3 pattern)
- Y-axis starts at the entered starting capital value

**Drawdown chart (bottom):**
- Red bars showing equity decline from peak
- X-axis shared with equity chart

### Metrics panels

Three rows of metric cards:

| Row 1 | Row 2 | Row 3 |
|-------|-------|-------|
| CAGR | Sharpe | Total trades |
| Max DD | Calmar | Win rate |
| Total profit | Sortino | Avg win |
| Final value | Profit factor | Avg loss |
| Period | Expectancy | Time in market |

**CAGR breakdown:**
```
Trading CAGR  +29.86%
Cash contrib  + 3.00%
Combined      +32.86%
```

**Annual returns:** Year-by-year bar chart with green (positive) / red (negative) bars.

---

## Screen 4 — vs Benchmarks

**Route:** `?screen=comparison`

Compares the selected experiment against B1 (buy-and-hold) and B2 (baseline) side by side.

Shows:
- Side-by-side metric comparison for all three configs
- Benchmark bars visualising relative performance

---

## Screen 5 — Run Progress

**Route:** `?screen=progress`

Live progress view for an active `run_all_windows.py` or Phase 2 sweep. Polls the progress endpoint every 5 seconds and streams SSE log lines.

### What it shows

- Total runs completed vs planned
- Current experiment being processed
- ETA (estimated completion)
- Progress bar with percentage
- Experiment status badges: `✓` (complete) or `…` (in progress)
- Live log panel (max 50 lines, auto-scrolling to bottom)

### Log line colours

| Colour | Content |
|--------|---------|
| Teal | `IMPROVEMENT` — experiment beat baseline |
| Red | `NO_IMPROVEMENT` — experiment underperformed |
| Blue | `0 TRADES` — no entries fired |
| Orange | `RUNNING` — currently executing |
| Gray | Other output |

### Data source

Reads from `phase2_progress.log` — written by `scripts/run_all_windows.py`. The Flask SSE endpoint at `/api/progress/stream` streams new lines as they are appended.

---

## Screen 6 — Trade Log

**Route:** `?screen=trades`

Detailed trade-by-trade view for any experiment/window combination.

### Filters

- Experiment dropdown (includes all run experiments)
- Run/Window dropdown (populated based on experiment selection)

### Summary metrics

Displayed above the trade table:
- Total trades, win rate
- Initial and final capital (scaled to entered starting capital)
- Total profit/loss
- CAGR, Max DD, Sharpe

**Config strip:** ATR multiplier, hard stop %, vol sizing mode, circuit breaker status.

**Not-persisted warning:** If individual trade records were not saved per-trade in the DB (older runs), a warning banner is shown.

### Trade table columns

| Column | Description |
|--------|-------------|
| # | Trade sequence number |
| Direction | LONG or SHORT |
| Entry date | Bar date of entry |
| Exit date | Bar date of exit |
| Entry price | Adjusted fill price |
| Exit price | Adjusted exit fill price |
| P&L | Dollar P&L for this trade |
| Return % | Percentage return on entry capital |
| R-multiple | Return in units of initial risk |
| Exit reason | `stop_hit`, `signal_exit`, `eod`, etc. |
| Balance | Running account balance after this trade |

**Final balance row** is highlighted with the total equity.

**CSV export** available — exports all visible trade rows.

---

## Screen 7 — Top Winners

**Route:** `?screen=winners`

Ranked comparison of the top 3 performing experiments by the selected sort metric.

### Sort options

- Sharpe (default)
- CAGR
- Max DD (least negative wins)

### Winner cards (#1, #2, #3)

Each card shows:
- Rank icon (🏆, 🥈, 🥉) and coloured accent strip
- Experiment name and badge
- Window label
- Entry/exit criteria description
- 6 metric cards: Annual return, Max DD, Sharpe, B2 CAGR (baseline comparison), B1 CAGR (buy-hold comparison), Win rate
- Total trades (clickable → Trade Log)
- **Top 3 wins** and **bottom 3 losses** tables (Rank 1 only)

### Trade mini-tables (Rank 1 only)

| Column | Description |
|--------|-------------|
| # | Trade number |
| Direction | LONG/SHORT badge |
| Dates | Entry → exit |
| Bars held | Duration in trading days |
| Entry/exit price | Adjusted prices |
| Return % | Per-trade return |
| R-multiple | Risk-adjusted return |
| Exit reason | `hard_stop` (red badge) vs `trailing_stop` (green badge) |
| P&L | Dollar amount |

---

## Screen 8 — Live Status

**Route:** `?screen=live`

Live trading monitoring panel. Currently shows paper trading session status.

### Panels

**System status bar:**
- IB Gateway connection: Connected / Disconnected (with last ping time)
- Mode: PAPER / LIVE
- Session ID

**Position panel:**
- Current TQQQ position (shares, entry price, current price, unrealised P&L)
- Current ratchet stop price and hard stop price
- Distance to stop as % and $

**Signal panel:**
- Today's signal: BUY / SELL / HOLD
- Signal time (ET)
- Indicators snapshot: Close, VWAP(250), EMA(10), ATR(45)

**Recent trades:**
- Last 5 closed trades from `trades_live`
- Entry/exit dates, prices, P&L

**API endpoints:**
- `GET /api/live/status` — position, signal, connection state
- `GET /api/live/trades` — recent trades from `trades_live`

---

## Screen 9 — Session Analysis (System Log)

**Route:** `?screen=session` (or via sidebar "System Log")

Deep-dive into live session events, connection health, and log files.

### Heartbeat banner

- **Green:** System online — shows "Last pulse: N minutes ago"
- **Red:** System offline — shows "Last seen: timestamp" or "System has never run"
- Polls `/api/live/heartbeat` every 30 seconds

### NAV snapshot widget

- Current strategy portfolio NAV
- Drawdown % from session start
- Last updated timestamp (warns if stale > 5 minutes)
- Polls `/api/live/nav` every 60 seconds

### 4 tabs

**Tab 1 — Overview:** Timeline of last 20 session events with level badges and summaries.

**Tab 2 — Events:** Full session event table with filters:
- Date range (from/to)
- Level (INFO/WARNING/ERROR/CRITICAL/DEBUG)
- Event type
- Each row expandable — shows JSON details in dark monospace box

**Tab 3 — Event Log:** `Events_log_live` table view:
- Timestamp, Level (colour-coded badge), Message, Source
- Most recent first

**Tab 4 — Log File:** `logs/live_main.log` viewer:
- Dark terminal-style panel
- Date range and level filters
- Line numbers
- Shows last N of total lines
- Level-coloured text

### Level badge colours

| Level | Colour |
|-------|--------|
| INFO | Teal `#1D9E75` |
| WARNING | Amber `#E8A020` |
| ERROR | Red `#A32D2D` |
| CRITICAL | Dark red `#7B1111` |
| DEBUG | Gray |

---

## Flask API Endpoints Reference

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/api/health` | GET | DB connection status |
| `/api/experiments` | GET | List of experiments with run counts |
| `/api/windows` | GET | List of data windows with labels |
| `/api/runs` | GET | All runs (filtered by experiment/window, sorted) |
| `/api/run/<run_id>` | GET | Single run details |
| `/api/grid` | GET | Heatmap matrix data for all experiments × windows |
| `/api/equity_curve/<run_id>` | GET | Equity curve + metrics for one run |
| `/api/equity_curve_runs` | GET | Grouped run list for equity screen dropdown |
| `/api/trades` | GET | Trades for a run_id |
| `/api/trades/experiments` | GET | Experiment list for trade log filter |
| `/api/trades/runs` | GET | Run list filtered by experiment + window |
| `/api/winners` | GET | Top 3 ranked by metric |
| `/api/progress/status` | GET | Current run_all_windows progress |
| `/api/progress/stream` | GET | SSE stream of progress log lines |
| `/api/live/status` | GET | Live position + signal + IB status |
| `/api/live/trades` | GET | Recent live trades from trades_live |
| `/api/live/heartbeat` | GET | Process heartbeat (last ping, connected) |
| `/api/live/nav` | GET | Strategy NAV from nav_snapshots |
| `/api/live/log` | GET | Events from Events_log_live + log file |
| `/api/live/logfile` | GET | Parsed live_main.log with filters |
| `/api/analysis/sessions` | GET | Session list from config_log_live |
| `/api/analysis/events` | GET | Session events with date/level/type filters |

---

## Related Pages

- [Experiment Results](Experiment-Results.md) — experiment IDs, parameters, and results shown in the GUI
- [Data Windows Reference](Data-Windows-Reference.md) — all 18 windows displayed in the grid
- [Session Log Reference](Session-Log-Reference.md) — event types shown in Screen 9
- [Database Schema](Database-Schema.md) — tables read by each API endpoint
- [System Monitoring Guide](System-Monitoring-Guide.md) — circuit breaker and health status shown in Screen 9
