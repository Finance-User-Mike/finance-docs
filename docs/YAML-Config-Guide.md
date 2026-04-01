# YAML Config Guide

> **Audience:** Everyone — how to read, write, and modify config files.
> **Related:** [Config-Reference](Config-Reference) · [Batch-Operations](Batch-Operations) · [Strategy-Logic](Strategy-Logic) · [Impact-Matrix](Impact-Matrix)

---

## Overview

Every backtest and live trading session is controlled by a YAML config file. The config defines what the strategy does, what parameters it uses, and how it executes orders. **No magic numbers in code** — every value comes from the config.

**Three types of YAML files:**

| Type | Location | Purpose |
|------|---------|---------|
| `config.yaml` | Project root | Active running config — NOT committed |
| `config.yaml.example` | Project root | Template for new machine setup — committed |
| `experiments/*.yaml` | `01-Backtest/experiments/` | Per-experiment parameter overrides |

---

## File Hierarchy

```
config.yaml.example     ← clean template, checked into git
    │
    └── copy to ──► config.yaml   ← active config (git-ignored)
                        │
                        └── overridden by ──► experiments/exp_018_atr_wider.yaml
                                              (experiment-specific params)
```

**Resolution order** (lowest to highest priority):

```
engine/config.py dataclass defaults
    ↑ overridden by
config.yaml (base config)
    ↑ overridden by
experiments/{id}.yaml (experiment-specific params)
```

When `run_all_windows.py` finds `experiments/{id}.yaml`, it loads that file directly — it does **not** merge with `config.yaml`. The experiment YAML must be self-contained (all required fields present).

---

## config.yaml.example — Full Annotated

This is the committed template. Copy it to `config.yaml` and edit the values for your environment.

```yaml
strategy_name: momentum_vwap_ema_atr_v1

# ── Symbols ─────────────────────────────────────────────────────────────────
# One entry per traded symbol. Current system: TQQQ only.
symbols:
  - symbol: TQQQ
    data_file: 02-Common/data/TQQQ_1d.csv  # path to CSV for initial DB seed
    atr_multiplier: 4.5                     # ratchet stop width: stop = anchor - (mult × ATR)
    hard_stop_pct: 0.08                     # fixed hard stop as % of entry price
    allow_short: true                       # enable SHORT positions

# ── Indicators ──────────────────────────────────────────────────────────────
indicators:
  vwap_period: 250      # rolling VWAP lookback — LOCKED (never change)
  vwap_price: close     # VWAP computed on close prices
  ema_period: 10        # EMA signal period — LOCKED (never change)
  atr_period: 45        # ATR smoothing period — LOCKED (never change)

# ── Entry Rules ─────────────────────────────────────────────────────────────
entry:
  require_both_long: true   # LONG only when close > VWAP AND close > EMA
  require_both_short: true  # SHORT only when close < VWAP AND close < EMA

# ── Stop Rules ──────────────────────────────────────────────────────────────
stop:
  use_hard_stop: true    # enforce hard stop (as % of entry)
  use_ratchet: true      # use ratchet (trailing ATR stop)

# ── Risk & Position Sizing ───────────────────────────────────────────────────
risk:
  position_sizing_mode: full_capital   # "full_capital" | "per_risk"
  risk_per_trade_pct: 1.0              # % of equity risked per trade (per_risk mode only)
  max_position_pct: 0.95               # max position as % of equity (95% buffer)
  max_portfolio_risk_pct: 4.0          # max total portfolio risk across all positions
  ml_mode: false                       # enable ML-predicted position sizing
  ml_model: atr_multiplier_v1          # ML model name (ml_mode=true only)
  use_volatility_sizing: false         # scale shares by current vs avg ATR
  vol_lookback_period: 20              # bars for avg ATR calculation (vol sizing)
  min_position_size: 0.5               # min vol-sizing multiplier (50% of base)
  max_position_size: 1.5               # max vol-sizing multiplier (150% of base)
  cash_rate_annual: 0.03               # annualised idle cash return (T-bill proxy, 3%)

# ── Timing ──────────────────────────────────────────────────────────────────
timing:
  cooldown_bars: 1     # bars to wait after exit before new entry
  flip_wait_bars: 1    # bars to wait before flipping long→short or vice versa

# ── Execution ───────────────────────────────────────────────────────────────
execution:
  mode: backtest         # "backtest" | "paper" | "live"
  entry_fill: close      # entry fill: "close" | "next_open"
  exit_fill: close       # exit fill: "close" (v0.6.7 gap-aware) | "stop_price"
  commission: 1.0        # per-side commission in USD
  slippage_pct: 0.05     # slippage as % of price (each side)

# ── Live Trading ─────────────────────────────────────────────────────────────
live:
  signal_frequency: hourly    # "hourly" | "daily"
  max_orders_per_day: 1       # hard limit on orders placed per session
  order_type: limit           # "limit" | "market"
  tif: DAY                    # Time In Force: DAY | GTC | IOC
  max_daily_loss_pct: 3.0     # kill switch: pause if day P&L < -3%
  reconnect_attempts: 3       # IB reconnection retries before abort
  reconnect_wait_seconds: 10  # seconds between reconnection attempts

# ── Backtest ─────────────────────────────────────────────────────────────────
backtest:
  date_from: "2021-03-16"       # measurement window start
  date_to: "2026-03-16"         # measurement window end
  window_label: rolling_5y      # label stored in DB (must match data_windows.window_id)
  is_baseline: false            # true only for B2 runs (set-baseline flag)
  initial_capital: 20000.0      # starting equity in USD
  use_circuit_breaker: false    # halt new entries if portfolio DD > max_dd_threshold
  max_dd_threshold: 30.0        # drawdown % that trips the circuit breaker
  circuit_breaker_cooldown_days: 10  # bars to pause after CB trips
  apply_cash_return: false      # apply cash_rate to idle days (handled in runner.py)
  risk_free_rate: 0.03          # used in Sharpe/Sortino calculation
```

---

## Experiment YAML Files

Experiment YAMLs inherit the same structure as `config.yaml` but document the single change being tested. They must be self-contained — all required sections present.

### Structure

```yaml
# Header block — documents the experiment
experiment_id: exp_018_atr_wider
experiment_name: "exp_018_Vol Sizing + CB 30% · ATR 5.0× · HS 11%"
date_run: "2026-03-18"

strategy_name: momentum_vwap_ema_atr_v1

# Full config sections follow (same as config.yaml)
symbols:
  - symbol: TQQQ
    ...
```

**Naming convention:** `exp_{NNN}_{short_description}.yaml`

### How experiment_id Flows Through the System

```
experiments/exp_018_atr_wider.yaml
           ↓  loaded by run_all_windows.py
           ↓  passed to save_run() as experiment_id
           ↓  stored in runs.experiment_id column
           ↓  shown in Dashboard Screen 1 as experiment name
           ↓  used by classify_verdict() to detect the B2 baseline
```

### Active Experiment Files

**`experiments/baseline_bh.yaml`** — B1 Buy & Hold

```yaml
experiment_id: baseline_bh
experiment_name: "BL1-Buy & Hold TQQQ"
implementation: direct_math   # run_bh_window() — no simulation loop
# No symbols/indicators/stop/risk sections needed
# run_bh_window() uses config.yaml for dates and initial_capital
```

Special: `implementation: direct_math` signals `run_all_windows.py` to call `run_bh_window()` instead of `run_window()`. Buy-and-hold skips the strategy engine entirely.

---

**`experiments/exp_008_combined_v1.yaml`** — Combined params

Key changes from B2:
```yaml
atr_multiplier: 4.5            # unchanged
hard_stop_pct: 0.10            # CHANGED: 8% → 10%
use_volatility_sizing: true    # CHANGED: was false
vol_lookback_period: 20
min_position_size: 0.5
max_position_size: 1.5
use_circuit_breaker: true      # CHANGED: was false
max_dd_threshold: 30.0
```

---

**`experiments/exp_009_cb_free.yaml`** — No circuit breaker

Key change from exp_008:
```yaml
use_circuit_breaker: false    # CHANGED: true → false
# All other params identical to exp_008
```

---

**`experiments/exp_018_atr_wider.yaml`** — Best config

Key changes from exp_008:
```yaml
atr_multiplier: 5.0           # CHANGED: 4.5 → 5.0
hard_stop_pct: 0.11           # CHANGED: 0.10 → 0.11
# All other params identical to exp_008
```

---

## Section-by-Section Reference

### `symbols` — Per-Symbol Parameters

```yaml
symbols:
  - symbol: TQQQ
    data_file: 02-Common/data/TQQQ_1d.csv
    atr_multiplier: 5.0
    hard_stop_pct: 0.11
    allow_short: true
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `symbol` | str | required | Ticker symbol |
| `data_file` | str | required | Path to CSV for DB seed |
| `atr_multiplier` | float | 4.5 | Ratchet stop = anchor ± (mult × ATR) |
| `hard_stop_pct` | float | 0.08 | Hard stop as fraction of entry (0.11 = 11%) |
| `allow_short` | bool | false | Enable SHORT positions |

**Impact:** `atr_multiplier` and `hard_stop_pct` are the two most impactful parameters after vwap_period. See [Impact-Matrix](Impact-Matrix).

---

### `indicators` — Indicator Periods

```yaml
indicators:
  vwap_period: 250
  vwap_price: close
  ema_period: 10
  atr_period: 45
```

| Key | Locked? | Value | Description |
|-----|---------|-------|-------------|
| `vwap_period` | **YES** | 250 | Rolling VWAP lookback — also sets warmup_bars |
| `vwap_price` | yes | close | Price series for VWAP computation |
| `ema_period` | **YES** | 10 | EMA signal period |
| `atr_period` | **YES** | 45 | Wilder ATR smoothing period |

All three periods were tested in exp_002, exp_004, exp_007 and found optimal at their defaults. **Never change these in production.**

---

### `entry` — Signal Logic

```yaml
entry:
  require_both_long: true
  require_both_short: true
```

| Key | Default | Description |
|-----|---------|-------------|
| `require_both_long` | true | LONG requires close > VWAP AND close > EMA |
| `require_both_short` | true | SHORT requires close < VWAP AND close < EMA |

Setting either to `false` means one condition is sufficient (OR logic instead of AND). This produces more trades but lower signal quality. Not tested in Phase 2.

---

### `stop` — Stop Logic

```yaml
stop:
  use_hard_stop: true
  use_ratchet: true
```

| Key | Default | Description |
|-----|---------|-------------|
| `use_hard_stop` | true | Enforce a fixed % hard stop from entry |
| `use_ratchet` | true | Use ratchet (ATR-based trailing stop) |

**Warning:** Setting `use_ratchet: false` disables the primary exit mechanism. The strategy would only exit on hard stop or manual intervention. Never set `use_ratchet: false` in production.

---

### `risk` — Position Sizing and Portfolio Risk

```yaml
risk:
  position_sizing_mode: full_capital
  risk_per_trade_pct: 1.0
  max_position_pct: 0.95
  max_portfolio_risk_pct: 4.0
  use_volatility_sizing: true
  vol_lookback_period: 20
  min_position_size: 0.5
  max_position_size: 1.5
  cash_rate_annual: 0.03
```

**Position sizing modes:**

```
full_capital:
  shares = floor(equity × max_position_pct / entry_price)
  e.g. equity=$20,000, max_position_pct=0.95, entry=$25
       shares = floor($20,000 × 0.95 / $25) = floor(760) = 760

per_risk:
  risk_amount = equity × (risk_per_trade_pct / 100)
  shares = floor(risk_amount / |entry - stop|)
  e.g. equity=$20,000, risk=1%, entry=$25, stop=$23
       risk_amount=$200, risk_per_share=$2
       shares = floor($200 / $2) = 100
```

**Volatility sizing** (when `use_volatility_sizing: true`):

```
multiplier = avg_atr / current_atr   (inverted: high vol → less size)
multiplier clamped to [min_position_size, max_position_size]
final_shares = base_shares × multiplier
```

| Key | Default | Best config (exp_018) |
|-----|---------|----------------------|
| `position_sizing_mode` | full_capital | full_capital |
| `max_position_pct` | 0.95 | 0.95 |
| `use_volatility_sizing` | false | **true** |
| `vol_lookback_period` | 20 | 20 |
| `min_position_size` | 0.5 | 0.5 |
| `max_position_size` | 1.5 | 1.5 |
| `cash_rate_annual` | 0.03 | 0.03 |

---

### `timing` — Cooldown and Flip

```yaml
timing:
  cooldown_bars: 1
  flip_wait_bars: 1
```

| Key | Default | Description |
|-----|---------|-------------|
| `cooldown_bars` | 1 | Bars to wait after any exit before new entry |
| `flip_wait_bars` | 1 | Bars to wait before flipping direction |

`cooldown_bars: 1` means: if you exit today (bar N), the next entry can be bar N+1 at earliest. This prevents re-entering on the same bar that triggered the exit.

---

### `execution` — Fill and Commission

```yaml
execution:
  mode: backtest
  entry_fill: close
  exit_fill: close
  commission: 1.0
  slippage_pct: 0.05
```

| Key | Values | Description |
|-----|--------|-------------|
| `mode` | backtest / paper / live | Execution mode — controls order routing |
| `entry_fill` | close / next_open | Backtest entry fill price |
| `exit_fill` | close / stop_price / next_open | Exit fill — use `close` for v0.6.7 logic |
| `commission` | float | Per-side commission USD |
| `slippage_pct` | float | Slippage as % of price per side |

**Never change `exit_fill` from `close`** — the v0.6.7 gap-aware fill logic is only active when `exit_fill == "close"`. Using `stop_price` bypasses the gap-down scenario handling and produces over-optimistic results.

---

### `backtest` — Window and Capital

```yaml
backtest:
  date_from: "2021-03-16"
  date_to: "2026-03-16"
  window_label: rolling_5y
  initial_capital: 20000.0
  use_circuit_breaker: false
  max_dd_threshold: 30.0
  circuit_breaker_cooldown_days: 10
```

**`window_label` must match a registered `window_id`** in the `data_windows` table (or at minimum be a consistent string for new experiments). The Dashboard groups results by window_label.

**Circuit breaker:**

```
use_circuit_breaker: true + max_dd_threshold: 30.0

→ When portfolio drawdown from peak > 30%:
     - Block all new entries
     - Cooldown for circuit_breaker_cooldown_days bars
     - Then resume normally
```

Best config (exp_018): CB=ON, threshold=30%, cooldown=10 bars.

---

### `live` — Live Trading Parameters

```yaml
live:
  signal_frequency: hourly
  max_orders_per_day: 1
  order_type: limit
  tif: DAY
  max_daily_loss_pct: 3.0
  reconnect_attempts: 3
  reconnect_wait_seconds: 10
```

These settings only take effect when `execution.mode = live` or `paper`. In backtest mode, they are loaded but ignored.

**`max_daily_loss_pct`** is the daily kill switch: if the portfolio loses more than 3% in a single session, all activity stops. See [IB-Control-Operations](IB-Control-Operations).

---

## Common Config Patterns

### Quick experiment — just change one parameter

```yaml
# Inherit everything from baseline, change only atr_multiplier
experiment_id: my_atr_test

symbols:
  - symbol: TQQQ
    data_file: 02-Common/data/TQQQ_1d.csv
    atr_multiplier: 6.0          # ← the one change
    hard_stop_pct: 0.11
    allow_short: true

indicators:
  vwap_period: 250
  vwap_price: close
  ema_period: 10
  atr_period: 45

# ... (copy remaining sections from exp_018_atr_wider.yaml)
```

### Paper trading config

```yaml
execution:
  mode: paper          # ← paper mode
  entry_fill: close    # still used for signal price reference
  exit_fill: close
  commission: 1.0
  slippage_pct: 0.05

live:
  signal_frequency: hourly
  max_orders_per_day: 1
  order_type: limit
  tif: DAY
  max_daily_loss_pct: 3.0
  reconnect_attempts: 3
  reconnect_wait_seconds: 10
```

The IB broker module checks `execution.mode` and routes to port 4002 (paper) or 4001 (live). See [IB-Gateway-Integration](IB-Gateway-Integration).

### Disable short selling

```yaml
symbols:
  - symbol: TQQQ
    allow_short: false   # ← only long positions
```

This makes the strategy long-only. Suitable for tax-deferred accounts where short selling is restricted.

### Full capital with 100% exposure

```yaml
risk:
  position_sizing_mode: full_capital
  max_position_pct: 1.00    # 100% (remove the 5% cash buffer)
```

Not recommended — the 5% buffer covers commission, bid-ask spread, and partial fill scenarios.

---

## Validation — What load_config() Checks

`load_config()` validates the YAML on load and raises `ConfigError` for these conditions:

| Error | Condition |
|-------|-----------|
| `ConfigError: symbols list required` | `symbols:` key absent |
| `ConfigError: at least one symbol required` | `symbols: []` |
| `FileNotFoundError` | YAML file does not exist |
| `ValueError` | YAML is syntactically invalid |

**Unknown keys are silently ignored** — forward-compatible with future config additions.

**Missing optional sections** fall back to dataclass defaults. The minimum valid YAML is:

```yaml
symbols:
  - symbol: TQQQ
    data_file: 02-Common/data/TQQQ_1d.csv
```

All other sections use defaults from `engine/config.py`.

---

## Config Change Impact Summary

| Section | Parameter | Impact | Safe to change? |
|---------|-----------|--------|----------------|
| symbols | `atr_multiplier` | Stop width, trade frequency | Research only |
| symbols | `hard_stop_pct` | Hard floor protection | Research only |
| symbols | `allow_short` | Enables/disables shorts | Research only |
| indicators | `vwap_period` | **ALL results invalid** | Never |
| indicators | `ema_period` | All results invalid | Never |
| indicators | `atr_period` | All results invalid | Never |
| risk | `position_sizing_mode` | Capital deployment | Research only |
| risk | `cash_rate_annual` | CAGR decomposition | Safe |
| backtest | `initial_capital` | Absolute $ values | Safe |
| backtest | `use_circuit_breaker` | Trade count, recovery | Research only |
| execution | `exit_fill` | Fill accuracy | Never (keep "close") |
| execution | `commission` | P&L accuracy | Match broker |

Full cascade analysis: [Impact-Matrix](Impact-Matrix)

---

*Back to [Home](Home) · [Config-Reference](Config-Reference) · [Batch-Operations](Batch-Operations) · [Impact-Matrix](Impact-Matrix)*
