# Glossary

> Every domain-specific term used across this wiki, defined in plain English with formula, context, and a link to the file where it lives in the codebase.

**Related pages:** [Strategy Logic](Strategy-Logic) · [Performance Metrics Guide](Performance-Metrics-Guide) · [Ref-Engine-Core](Ref-Engine-Core)

---

## Quick Index

[A](#a) · [B](#b) · [C](#c) · [D](#d) · [E](#e) · [F](#f) · [G](#g) · [H](#h) · [I](#i) · [L](#l) · [M](#m) · [P](#p) · [R](#r) · [S](#s) · [T](#t) · [V](#v) · [W](#w)

---

## A

### `adjustment_factor`
The ratio used to normalise historical prices for stock splits and dividends.

```
adjustment_factor = Adj_Close / Close
```

Applied to Open, High, Low so all indicator calculations use comparable prices across splits. The Close itself is replaced by Adj_Close. Volume is **not** adjusted.

**Where:** [`apply_adjustment()`](Ref-Data-Backtest#apply_adjustment) · `02-Common/data/loader.py`
**See also:** [Strategy Logic — Data Preparation](Strategy-Logic#data-preparation)

---

### `allow_short`
Config flag (`symbols[].allow_short`) that controls whether the strategy can open short positions.

When `false`: only LONG trades allowed; SELL signals return HOLD.
When `true`: both LONG and SHORT entries enabled.

**Default:** `true` (both directions)
**Where:** `config.yaml` · [`evaluate()`](Ref-Engine-Core#evaluate)
**Impact if changed:** [Impact Matrix — Allow Short](Impact-Matrix#allow-short)

---

### `anchor`
The running extreme price since entry, used as the reference point for the ratchet stop calculation.

- **Long trade:** anchor = `highest_high` (maximum High since entry — only moves up)
- **Short trade:** anchor = `lowest_low` (minimum Low since entry — only moves down)

The anchor never resets while the position is open. It is passed to [`calc_ratchet_stop()`](Ref-Engine-Core#calc_ratchet_stop) on every bar.

**Where:** `02-Common/engine/risk.py`
**See also:** [Ratchet Stop](Glossary#ratchet-stop)

---

### `ATR` (Average True Range)
A measure of daily price volatility — how much TQQQ typically moves per day, including overnight gaps.

```
True Range[t] = MAX(High[t] − Low[t],  |High[t] − Close[t-1]|,  |Low[t] − Close[t-1]|)

ATR[t] = (ATR[t-1] × (period − 1) + TR[t]) / period    ← Wilder smoothing
ATR[0] = SMA(True Range, period)                         ← seed
```

Period = 45 bars. ATR controls the ratchet stop distance: `stop = anchor − (atr_multiplier × ATR)`.

**Where:** [`atr()`](Ref-Engine-Core#atr) · [`true_range()`](Ref-Engine-Core#true_range) · `02-Common/engine/indicators.py`
**See also:** [ATR(45)](Strategy-Logic#atr-45)

---

### `atr_multiplier`
How many ATR units the ratchet stop is placed below the highest high (long) or above the lowest low (short).

```
ratchet_stop_long = highest_high − (atr_multiplier × ATR_45)
```

Higher multiplier → wider stop → fewer stop-outs → larger potential drawdowns but more room for trades to run.

**Baseline:** 4.5 · **Best config (exp_018):** 5.0
**Where:** `config.yaml` → `symbols[].atr_multiplier`
**Impact if changed:** [Impact Matrix — ATR Multiplier](Impact-Matrix#atr-multiplier)

---

## B

### `B1` (Baseline 1 — Buy & Hold)
The passive benchmark: buy TQQQ on day 1, never sell.

```
shares = initial_capital / close[0]
equity[t] = shares × close[t]
```

No simulation loop — pure math. Trades = 1. Warmup = 0.
Used on every equity curve chart as the lower reference line.

**Experiment ID:** `baseline_bh`
**Where:** `01-Backtest/experiments/baseline_bh.yaml`
**Results:** [Experiment Results — Baselines](Experiment-Results#baselines)

---

### `B2` (Baseline 2 — Default Strategy)
The default ATR-based momentum strategy with no enhancements (no volatility sizing, no circuit breaker).

**Params:** ATR=45 · atr_mult=4.5 · EMA=10 · VWAP=250 · hard_stop=8% · vol_sizing=OFF · CB=OFF

**Experiment ID:** `baseline_atr45`
**Where:** `01-Backtest/experiments/baseline_atr45.yaml`
**Results:** rolling_5y CAGR=40.8% · Calmar=1.34

---

### `bar`
One row of OHLCV price data representing a single time period.

- **Daily bar:** one trading day (used in backtest and daily signal evaluation)
- **Hourly bar:** one trading hour (used in live trading stop monitoring)

**Columns:** `date`, `open`, `high`, `low`, `close`, `volume`, (optionally: `adj_close`)

---

### `bar_idx`
The integer index of the current bar in the simulation loop, starting at 0.

The lookahead prevention slice is: `bars.iloc[:bar_idx + 1]` — the signal sees only bars from index 0 to bar_idx inclusive. Never `bars.iloc[:bar_idx + 2]` or beyond.

**Where:** `01-Backtest/backtest/runner.py`
**See also:** [Lookahead Bias](Glossary#lookahead-bias)

---

## C

### `CAGR` (Compound Annual Growth Rate)
The headline performance metric — the annualised return assuming gains compound.

This system uses a **3-component formula:**

```
Step 1 — Trading CAGR (pure strategy P&L):
  total_years   = (date_to − date_from).days / 365.25
  trading_cagr  = (equity_after_trades / initial_capital)^(1/total_years) − 1

Step 2 — Idle cash return (3% annual on uninvested capital):
  idle_days     = total_window_days − sum(all trade hold days)
  idle_interest = equity_after_trades × ((1.03)^(idle_days/365.25) − 1)
  equity_final  = equity_after_trades + idle_interest

Step 3 — Combined CAGR (headline):
  combined_cagr = (equity_final / initial_capital)^(1/total_years) − 1
```

**Always use calendar days, never bar count.**

**Where:** [`calc_cagr()`](Ref-Data-Backtest#calc_cagr) · `01-Backtest/backtest/metrics.py`
**See also:** [Performance Metrics Guide — CAGR](Performance-Metrics-Guide#cagr)

---

### `Calmar Ratio`
Risk-adjusted return: CAGR divided by the absolute maximum drawdown.

```
calmar = cagr_pct / |max_drawdown_pct|

Example: CAGR=45.8%, max_DD=-28.2% → Calmar = 45.8/28.2 = 1.63
```

A Calmar > 1.0 means the strategy earns more than 1% per year for every 1% of drawdown risk. Phase 2 target was Calmar > 1.0 on both rolling_5y AND full_cycle_2.

**Where:** [`calmar_ratio()`](Ref-Data-Backtest#calmar_ratio) · `01-Backtest/backtest/metrics.py`
**See also:** [Performance Metrics Guide — Calmar](Performance-Metrics-Guide#calmar-ratio)

---

### `cash_contribution_pct`
The portion of combined CAGR that comes from idle cash earning interest (not from trades).

```
cash_contribution_pct = combined_cagr − trading_cagr
```

Stored separately in the `runs` table. For strategies with many trades (short holding periods), this is small. For buy-and-hold (always in market), this is zero.

**Where:** `01-Backtest/backtest/metrics.py` · `trading.db → runs.cash_contribution_pct`

---

### `circuit_breaker` (CB)
An automatic pause mechanism that stops trading when portfolio drawdown exceeds a threshold.

**Backtest:** `backtest.use_circuit_breaker` + `backtest.max_dd_threshold`. If activated, trading pauses for `cooldown_days = threshold / 3`.

**Live:** 4-level escalating alerts in `circuit_breaker.py`:
- 10% → WARNING (once)
- 15% → ERROR (once)
- 18% → CRITICAL (once)
- 20% → STOP (repeats every 5 min + triggers emergency shutdown)

**Where:** [`check_circuit_breaker()`](Ref-Live-Trading#check_circuit_breaker) · `03-Live/live/circuit_breaker.py`
**See also:** [System Monitoring Guide — Circuit Breaker](System-Monitoring-Guide#circuit-breaker)

---

### `client_id`
The integer identifier used to distinguish multiple connections to the same IB Gateway instance. The live loop uses client_id=2 (IDs 1 reserved/stale). Range 1–32.

**Where:** `.env → IB_CLIENT_ID` · `03-Live/live/config.py`

---

### `config_snapshot`
A JSON blob stored in the `runs` table capturing the full `Config` dataclass at the time a backtest ran. Enables full result reproducibility — you can reload the exact config that produced any historical run.

**Where:** `01-Backtest/backtest/recorder.py → save_run()`
**DB column:** `runs.config_snapshot TEXT`

---

### `cooldown_bars`
The number of bars the strategy must wait after a trade closes before opening a new position.

Default = 1. On the bar immediately after an exit, `cooldown_counter = cooldown_bars`. It decrements each bar. When it reaches 0, entries are allowed again.

**Config key:** `timing.cooldown_bars`
**Where:** `01-Backtest/backtest/runner.py` · [`evaluate()`](Ref-Engine-Core#evaluate)
**Impact if changed:** [Impact Matrix — Cooldown Bars](Impact-Matrix#cooldown-bars)

---

## D

### `data_window`
A defined date range used to evaluate backtest performance. Each window has a `measure_from`, `measure_to`, and `warmup_from` (250 bars before `measure_from`).

18 windows are defined, covering bears, bulls, full cycles, rolling periods, and ML training. See [Data Windows Reference](Data-Windows-Reference) for the full list.

**DB table:** `data_windows`
**Where:** `01-Backtest/scripts/run_all_windows.py`

---

### `direction`
The trade direction: `"long"` or `"short"`.

- **Long:** bought TQQQ, profits when price rises
- **Short:** sold TQQQ (via IB margin), profits when price falls

Used throughout: `SignalResult.direction`, `trades.direction`, `calc_ratchet_stop(direction, ...)`.

---

### `dry_run`
Config flag (`live.dry_run`). When `true`: signals are evaluated and logged to `signals_live`, but no orders are placed in IB Gateway. Used for testing the live loop without executing real (or paper) trades.

**Default:** `true` (safe default)
**Where:** `config.yaml` · `03-Live/live/executor.py → act()`

---

## E

### `effective_stop`
The stop price actually used to check for exits — the tighter of the ratchet stop and the hard stop.

```
Long:   effective_stop = MAX(ratchet_stop, hard_stop)
Short:  effective_stop = MIN(ratchet_stop, hard_stop)
```

The hard stop leads early in a trade (ratchet hasn't tightened yet). The ratchet takes over once it exceeds the hard stop.

**Where:** [`effective_stop()`](Ref-Engine-Core#effective_stop) · `02-Common/engine/risk.py`
**See also:** [Strategy Logic — Effective Stop](Strategy-Logic#effective-stop)

---

### `emergency.lock`
A sentinel file (`live/emergency.lock`) written during emergency shutdown. If this file exists when `main.py` starts, the entire system refuses to start. Requires manual deletion by an operator after investigation.

**Purpose:** Prevents automatic restart after a catastrophic event (position mismatch, unrecoverable circuit breaker trip).

**Where:** [`lock_manager.py`](Ref-IB-Broker#lock_manager) · [`safe_shutdown()`](Ref-Live-Trading#safe_shutdown)
**See also:** [IB Control — Emergency Procedures](IB-Control-Operations#emergency-procedures)

---

### `EMA` (Exponential Moving Average)
A moving average that gives exponentially more weight to recent prices. Used as short-term momentum confirmation.

```
multiplier = 2 / (period + 1) = 2/11 = 0.1818 for period=10
EMA[0]     = SMA(prices, period)     ← seed with simple average
EMA[t]     = prices[t] × 0.1818 + EMA[t-1] × 0.8182
```

Period = 10 bars. Must be computed with a manual loop — `pandas.ewm()` is forbidden.

**Where:** [`ema()`](Ref-Engine-Core#ema) · `02-Common/engine/indicators.py`
**See also:** [Strategy Logic — EMA(10)](Strategy-Logic#ema-10)

---

### `equity_curve`
A list of daily portfolio values over the backtest window, one value per bar. Stored as a JSON array in `runs.equity_curve`. Used to compute all metrics and render the equity growth chart on Screen 3 of the dashboard.

**Where:** `01-Backtest/backtest/runner.py` · `trading.db → runs.equity_curve`

---

### `expectancy`
The expected P&L per trade, as a percentage of capital at risk.

```
expectancy = (win_rate × avg_win_pct) + ((1 − win_rate) × avg_loss_pct)
```

A positive expectancy means the strategy has a statistical edge. For exp_018 on rolling_5y, expectancy is positive across all 27 trades.

**Where:** [`expectancy()`](Ref-Data-Backtest#expectancy) · `01-Backtest/backtest/metrics.py`

---

### `experiment`
A specific combination of strategy parameters tested against one or more data windows. Stored in a YAML file under `01-Backtest/experiments/` and tracked in the `experiments` DB table.

Each experiment has: `experiment_id`, `hypothesis`, `params`, `status` (active/concluded), `outcome` (positive/negative/neutral), and `conclusion`.

**See also:** [Experiment Results](Experiment-Results) · [YAML Config Guide](YAML-Config-Guide)

---

## F

### `fill_exit`
The simulated or real exit price when a stop is triggered.

Three scenarios (v0.6.7 gap-aware logic):
1. `open ≤ stop_price` → fill at `open` (gap-down through stop)
2. `open > stop, low ≤ stop` → fill at `stop_price` (intraday touch)
3. `low > stop` → no exit (stop not triggered this bar)

**Where:** [`fill_exit()`](Ref-Data-Backtest#fill_exit) · `01-Backtest/backtest/simulator.py`
**See also:** [Strategy Logic — Fill Logic v0.6.7](Strategy-Logic#fill-logic)

---

### `full_capital` (sizing mode)
Position sizing mode where nearly all available equity is deployed in every trade.

```
shares = floor(equity × max_position_pct / entry_price)
       = floor(equity × 0.95 / entry_price)
```

The opposite of `risk_based` sizing. This mode produces higher CAGR and higher drawdowns. Current active mode.

**Config key:** `risk.position_sizing_mode = full_capital`
**Where:** [`calc_position_size()`](Ref-Engine-Core#calc_position_size)
**Impact if changed:** [Impact Matrix — Position Sizing Mode](Impact-Matrix#position-sizing-mode)

---

## G

### `gap-down`
When the market opens significantly below the previous close, jumping through the stop level before any intraday trading occurs.

In v0.6.7 fill logic: if `open ≤ stop_price`, the stop is considered triggered at the opening auction. Fill = `open`.

**Real example (Oct 26 2023):** TQQQ stop=$15.80, open=$15.77 → fill at $15.77 (not close=$15.03).

**Where:** [`fill_exit()`](Ref-Data-Backtest#fill_exit)

---

### `golden_result`
A reference JSON file (`tests/fixtures/golden_result.json`) containing known-correct backtest metrics for a specific config and dataset. Regression tests compare current output against this file to detect unintended changes.

**Where:** `02-Common/tests/fixtures/golden_result.json` · `01-Backtest/tests/regression/test_regression.py`

---

## H

### `hard_stop`
A fixed maximum loss limit set at entry. Unlike the ratchet stop, it never moves.

```
Long:   hard_stop = entry_price × (1 − hard_stop_pct)
Short:  hard_stop = entry_price × (1 + hard_stop_pct)
```

Acts as the effective stop floor before the ratchet stop has tightened enough. Config key: `symbols[].hard_stop_pct`.

**Where:** `02-Common/engine/risk.py` · `03-Live/live/executor.py`
**See also:** [Strategy Logic — Hard Stop](Strategy-Logic#hard-stop)

---

### `highest_high`
The maximum bar High seen since the current long position was opened. Never resets while the position is open. Used as the anchor for ratchet stop calculation.

```
highest_high[t] = MAX(highest_high[t-1], High[t])
```

**Where:** [`calc_ratchet_stop()`](Ref-Engine-Core#calc_ratchet_stop) · `02-Common/engine/risk.py`

---

## I

### `idle_days`
The total number of calendar days in a backtest window where no position was held. Used in the CAGR 3-component formula to calculate idle cash return.

```
idle_days = total_window_days − sum(hold_days for all trades)
```

**Where:** `01-Backtest/backtest/metrics.py → calc_cagr()`

---

## L

### `lookahead bias`
A critical bug where the signal evaluation uses future data that would not have been available at the time of the decision. Results in massively inflated backtest performance.

**Prevention:** The runner always passes `bars.iloc[:bar_idx + 1]` — a slice up to and including the current bar only.

```python
# CORRECT (no lookahead)
signal = evaluate(bars.iloc[:bar_idx + 1], config, symbol)

# WRONG (uses future bars)
signal = evaluate(bars, config, symbol)
```

**Where:** `01-Backtest/backtest/runner.py`
**Test:** `test_no_lookahead_bias()` in `02-Common/tests/unit/test_signals.py`

---

### `lowest_low`
The minimum bar Low seen since the current short position was opened. Never resets while the position is open. Mirror of `highest_high` for short trades.

```
lowest_low[t] = MIN(lowest_low[t-1], Low[t])
```

**Where:** [`calc_ratchet_stop()`](Ref-Engine-Core#calc_ratchet_stop)

---

## M

### `max_drawdown` (max DD)
The largest peak-to-trough decline in portfolio value, expressed as a percentage.

```
For each bar:
  if equity > peak: peak = equity
  drawdown = (equity − peak) / peak × 100
max_drawdown = minimum drawdown seen (most negative value)
```

Always ≤ 0. Example: max_drawdown = -28.15% means the portfolio fell 28.15% from its peak before recovering.

**Where:** [`max_drawdown()`](Ref-Data-Backtest#max_drawdown) · `01-Backtest/backtest/metrics.py`
**See also:** [Performance Metrics Guide — Max Drawdown](Performance-Metrics-Guide#max-drawdown)

---

### `measure_from` / `measure_to`
The actual date range for a data window's performance measurement (after warmup). Metrics are computed only on bars within this range.

The data loaded actually starts at `warmup_from = measure_from − 250 bars` to allow indicator initialisation.

**DB columns:** `data_windows.measure_from`, `data_windows.measure_to`

---

## P

### `pending.json`
A JSON command file at `live/commands/pending.json`. The main loop reads and consumes this file on every iteration. If a command is present, it is executed and the file is deleted.

Commands: `STOP`, `PAUSE`, `RESUME`, `DISCONNECT_IB`, `RECONNECT_IB`, `FORCE_CLOSE`.

**Where:** `03-Live/live/main.py → check_pending_commands()`
**See also:** [IB Control — Commands](IB-Control-Operations#commands)

---

### `PID lock` (`trading.lock`)
A file-based mutex that prevents duplicate `main.py` processes. Written on startup with the process ID. On shutdown, the lock is released. If the lock exists and the PID is alive → startup aborts.

**Where:** [`lock_manager.py`](Ref-IB-Broker#lock_manager)
**Troubleshooting:** [Troubleshooting — Stale PID Lock](Troubleshooting-Playbook#stale-pid-lock)

---

### `profit_factor`
The ratio of total winning dollars to total losing dollars across all trades.

```
profit_factor = sum(winning_trade_pnl) / |sum(losing_trade_pnl)|
```

> 1.0 = profitable. > 1.5 = strong edge. The strategy has profit_factor > 2.0 on rolling_5y.

**Where:** `01-Backtest/backtest/metrics.py`

---

### `proxy_close`
The close price of the most recent completed hourly bar, used as a reference for placing limit orders in the live loop.

In live trading, the entry limit order is placed at `proxy_close + $0.05` to ensure the order fills at or near the signal-day close.

**Where:** [`get_proxy_close()`](Ref-IB-Broker#get_proxy_close) · `03-Live/live/data.py`

---

## R

### `ratchet stop`
The trailing stop that only moves in the trade's favour — never against. The defining risk management mechanism of this strategy.

```
Long:
  highest_high[t]  = MAX(highest_high[t-1], High[t])
  raw_stop         = highest_high − (atr_multiplier × ATR_45)
  ratchet_stop[t]  = MAX(ratchet_stop[t-1], raw_stop)   ← only moves UP

Short:
  lowest_low[t]    = MIN(lowest_low[t-1], Low[t])
  raw_stop         = lowest_low + (atr_multiplier × ATR_45)
  ratchet_stop[t]  = MIN(ratchet_stop[t-1], raw_stop)   ← only moves DOWN
```

**Critical invariant:** Long: `new_stop ≥ current_stop` always. Short: `new_stop ≤ current_stop` always.

**Where:** [`calc_ratchet_stop()`](Ref-Engine-Core#calc_ratchet_stop) · `02-Common/engine/risk.py`
**See also:** [Strategy Logic — Ratchet Stop](Strategy-Logic#stop-management)

---

### `reconcile_positions`
Startup check that compares the open position recorded in `trades_live` (DB) against the live position in IB Gateway (broker API). If they disagree by more than 1 share, startup is aborted.

**Rule:** Never auto-correct. Require human decision.

**Where:** [`reconcile_positions()`](Ref-IB-Broker#reconcile_positions) · `03-Live/live/broker.py`
**See also:** [Troubleshooting — Position Mismatch](Troubleshooting-Playbook#position-mismatch)

---

### `r_multiple`
A trade quality metric measuring how many units of initial risk the trade won or lost.

```
initial_risk_usd = |entry_price − stop_price| × shares
r_multiple       = pnl_usd / initial_risk_usd

Examples:
  r_multiple = +2.5 → trade won 2.5× the initial risk (excellent)
  r_multiple = +1.0 → trade won exactly the risk amount (break even on R)
  r_multiple = −1.0 → trade lost exactly the risk (stop hit as planned)
  r_multiple = −1.5 → trade lost 1.5× risk (gap-down beyond stop)
```

**Where:** `01-Backtest/backtest/metrics.py` · `trading.db → trades.r_multiple`
**See also:** [Performance Metrics Guide — R-Multiple](Performance-Metrics-Guide#r-multiple)

---

### `rolling window`
A data window defined by a trailing period from a fixed end date (e.g., "last 5 years to today").

Example: `rolling_5y` ends on 2026-03-16 and starts 5 years earlier (2021-03-16). As time passes, a rolling window covers different market regimes.

**See also:** [Data Windows Reference](Data-Windows-Reference)

---

### `run_id`
A unique identifier (UUID string) for a single backtest execution. Primary key in the `runs` table. Every run of `backtest/run.py` generates a new `run_id`.

**Format:** `run_YYYYMMDD_HHMMSS_EXPID` or UUID4
**Where:** `01-Backtest/backtest/recorder.py → save_run()`

---

## S

### `session_capital`
The allocated capital for a live trading session. Default: $100,000. Used for:
- Position sizing: `shares = floor(session_capital × 0.95 / entry_price)`
- Circuit breaker: drawdown measured against `session_capital` (not total account NAV)

Does not need to equal total IB account balance — it represents the portion allocated to this strategy.

**Config key:** `live.session_capital`
**Where:** `03-Live/live/executor.py` · `03-Live/live/circuit_breaker.py`

---

### `session_id`
A UUID generated at the start of each live trading session (each run of `main.py`). All events, signals, and trades logged during that session share the same `session_id` for grouping and replay.

**Where:** `03-Live/live/main.py → run_live_loop()` · `Events_log_live.session_id`

---

### `Sharpe Ratio`
Annualised return per unit of total volatility (risk-adjusted return).

```
daily_returns = diff(equity_curve) / equity_curve[:-1]
sharpe        = (mean(daily_returns) / std(daily_returns)) × sqrt(252)
```

252 = trading days per year. Risk-free rate defaults to 0.

**Interpretation:** > 1.0 is good. > 1.5 is excellent. exp_018 rolling_5y Sharpe ≈ 0.83.

**Where:** [`sharpe_ratio()`](Ref-Data-Backtest#sharpe_ratio) · `01-Backtest/backtest/metrics.py`

---

### `SignalResult`
The return type of [`evaluate()`](Ref-Engine-Core#evaluate). A dataclass containing:

| Field | Type | Description |
|-------|------|-------------|
| `action` | `str` | `"BUY"`, `"SELL"`, or `"HOLD"` |
| `direction` | `str` | `"long"`, `"short"`, or `"none"` |
| `stop_price` | `float` | Initial stop for the new position |
| `confidence` | `float` | Signal confidence 0.0–1.0 (ML mode) |
| `indicators` | `dict` | `{vwap, ema, atr, close}` snapshot |
| `reason` | `str` | Human-readable reason string |

**Where:** `02-Common/engine/signals.py`

---

### `slippage_pct`
A small adverse price adjustment applied to simulated fills to approximate real-world market impact.

```
Entry fill (long):  close + (close × slippage_pct)   ← buy slightly above close
Exit fill (long):   fill − (fill × slippage_pct)      ← sell slightly below fill price
```

Default: 0.05% (0.0005). Very small — TQQQ is highly liquid.

**Config key:** `execution.slippage_pct`
**Where:** `01-Backtest/backtest/simulator.py`

---

### `Sortino Ratio`
Like Sharpe but penalises only downside volatility (returns below zero).

```
downside_returns = [r for r in daily_returns if r < 0]
sortino          = (mean(daily_returns) / std(downside_returns)) × sqrt(252)
```

A Sortino ratio higher than the Sharpe ratio indicates that volatility is skewed to the upside (more good days than bad).

**Where:** [`sortino_ratio()`](Ref-Data-Backtest#sortino_ratio) · `01-Backtest/backtest/metrics.py`

---

## T

### `time_in_market_pct`
The percentage of total backtest bars spent in an open position (either long or short).

```
time_in_market_pct = (sum of all trade hold_bars) / total_measurement_bars × 100
```

Lower is not always better — it indicates the strategy is idle more often. exp_018 spends ~30–40% of time in market on rolling_5y.

**Where:** `01-Backtest/backtest/metrics.py` · `trading.db → runs.time_in_market_pct`

---

### `TQQQ`
ProShares UltraPro QQQ — a 3× leveraged ETF that tracks 3× the daily return of the NASDAQ-100 index (QQQ). Extreme volatility, high ATR, suitable for momentum strategies with wide stops.

Launched: February 2010. Daily data starts: 2010-02-11.

---

### `trading.db`
The single SQLite database file at the project root. Contains all backtest results and all live trading records. Uses WAL (Write-Ahead Logging) mode for concurrent access.

**Never commit to git** (listed in `.gitignore`) — but backed up by `backup.py`.

**See also:** [Database Schema](Database-Schema)

---

### `true_range`
A measure of daily price movement that accounts for overnight gaps.

```
true_range[t] = MAX(
    High[t] − Low[t],              ← intraday range
    |High[t] − Close[t-1]|,        ← gap up
    |Low[t]  − Close[t-1]|         ← gap down
)
```

**Where:** [`true_range()`](Ref-Engine-Core#true_range) · `02-Common/engine/indicators.py`

---

## V

### `VWAP` (Volume-Weighted Average Price)
A price level representing the average price TQQQ has traded at over the past 250 days, weighted by trading volume.

```
VWAP_250[t] = SUM(Close[i] × Volume[i], i=t-249 to t)
              ──────────────────────────────────────────
                     SUM(Volume[i], i=t-249 to t)
```

When price > VWAP → long-term uptrend. When price < VWAP → long-term downtrend.

**Where:** [`vwap_rolling()`](Ref-Engine-Core#vwap_rolling) · `02-Common/engine/indicators.py`
**See also:** [Strategy Logic — VWAP(250)](Strategy-Logic#vwap-250)

---

### `verdict`
A classification assigned to each backtest run comparing it against the B2 baseline.

| Verdict | Condition |
|---------|-----------|
| `IMPROVEMENT` | CAGR and/or Calmar better than B2 by threshold |
| `NEUTRAL` | Within threshold of B2 |
| `NO_IMPROVEMENT` | Worse than B2 |

**Where:** `02-Common/tests/unit/test_verdict.py` · `trading.db → runs.verdict`

---

## W

### `warmup_bars`
The number of leading bars loaded before the measurement window to initialise long-lookback indicators (especially VWAP(250)).

**Rule:** `warmup_bars` must equal or exceed `vwap_period` (both currently 250). The warmup bars run through the simulation loop to build up indicator state, but are excluded from all performance metrics.

**Config key:** `backtest.warmup_bars`
**Where:** `01-Backtest/backtest/runner.py` · `02-Common/data/loader.py → slice_window()`
**Impact if changed:** [Impact Matrix — Warmup Bars](Impact-Matrix#warmup-bars)

---

### `window_label`
The string identifier for a data window (e.g., `"rolling_5y"`, `"full_cycle_2"`, `"bear_period_5"`). Stored in `runs.window_label` and `data_windows.window_id`.

**See also:** [Data Windows Reference](Data-Windows-Reference) for all 18 window definitions.
