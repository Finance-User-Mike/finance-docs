# Engine Core Functions Reference

> **Audience:** Developers. This page documents every public function in the shared strategy engine (`02-Common/engine/`). The engine is the zero-import core — it must never import from `backtest/`, `live/`, or `gui/`. All functions are pure (no side effects, no I/O) unless explicitly noted.

**Related pages:** [Strategy Logic](Strategy-Logic) · [Impact Matrix](Impact-Matrix) · [Testing Guide](Testing-Guide) · [Ref-Data-Backtest](Ref-Data-Backtest)

---

## Module Map

| File | Functions | Purpose |
|------|-----------|---------|
| `engine/config.py` | `load_config`, `Config.to_dict`, `Config.symbol_config` | Configuration loading and dataclasses |
| `engine/indicators.py` | `true_range`, `vwap_rolling`, `ema`, `atr`, `adx` | Technical indicator calculations |
| `engine/signals.py` | `evaluate`, `is_long_signal`, `is_short_signal` | Entry/exit signal generation |
| `engine/risk.py` | `calc_position_size`, `calc_ratchet_stop`, `effective_stop`, `is_stop_hit`, `portfolio_cap_allows` | Risk management and stop logic |

---

## Table of Contents

**config.py**
- [Config dataclass](#config-dataclass)
- [load\_config()](#load_config)
- [Config.to\_dict()](#config-to_dict)
- [Config.symbol\_config()](#config-symbol_config)

**indicators.py**
- [true\_range()](#true_range)
- [vwap\_rolling()](#vwap_rolling)
- [ema()](#ema)
- [atr()](#atr)
- [adx()](#adx)

**signals.py**
- [SignalResult dataclass](#signalresult-dataclass)
- [evaluate()](#evaluate)
- [is\_long\_signal()](#is_long_signal)
- [is\_short\_signal()](#is_short_signal)

**risk.py**
- [calc\_position\_size()](#calc_position_size)
- [calc\_ratchet\_stop()](#calc_ratchet_stop)
- [effective\_stop()](#effective_stop)
- [is\_stop\_hit()](#is_stop_hit)
- [portfolio\_cap\_allows()](#portfolio_cap_allows)

---

## config.py

### Config dataclass

**File:** `02-Common/engine/config.py`

The root configuration object. Every module that needs parameters receives a `Config` instance. Never access `config.yaml` directly in engine code — always use this dataclass.

```python
@dataclass
class Config:
    strategy_name: str
    symbols:       list[SymbolConfig]
    indicators:    IndicatorConfig
    entry:         EntryConfig
    stop:          StopConfig
    risk:          RiskConfig
    timing:        TimingConfig
    execution:     ExecutionConfig
    live:          LiveConfig
    backtest:      BacktestConfig
```

**Nested dataclasses:**

```python
@dataclass
class SymbolConfig:
    symbol:          str           # e.g. "TQQQ"
    data_file:       str           # path to CSV
    atr_multiplier:  float = 4.5   # ratchet stop distance in ATR units
    hard_stop_pct:   float = 0.08  # max loss from entry (8% default)
    allow_short:     bool  = True  # allow short positions

@dataclass
class IndicatorConfig:
    vwap_period:  int = 250   # rolling VWAP lookback bars
    ema_period:   int = 10    # EMA lookback bars
    atr_period:   int = 45    # ATR lookback bars (Wilder smoothing)

@dataclass
class EntryConfig:
    require_both_long:  bool = True  # BUY requires BOTH close>VWAP AND close>EMA
    require_both_short: bool = True  # SELL requires BOTH close<VWAP AND close<EMA

@dataclass
class StopConfig:
    use_hard_stop: bool = True  # enforce hard_stop_pct
    use_ratchet:   bool = True  # enable ratchet trailing stop

@dataclass
class RiskConfig:
    position_sizing_mode:  str   = "full_capital"  # or "risk_based"
    risk_per_trade_pct:    float = 1.0    # % equity at risk (risk_based mode only)
    max_position_pct:      float = 0.95   # max equity deployed per trade
    max_portfolio_risk_pct:float = 4.0    # total portfolio risk cap
    cash_rate_annual:      float = 0.03   # idle cash return rate (3% default)
    use_volatility_sizing: bool  = False  # scale position by recent vol
    vol_lookback:          int   = 20     # bars for vol_sizing calculation
    vol_clip_min:          float = 0.50   # minimum vol scalar
    vol_clip_max:          float = 1.50   # maximum vol scalar

@dataclass
class TimingConfig:
    cooldown_bars:  int = 1  # bars to wait after exit before re-entry
    flip_wait_bars: int = 1  # bars to wait when switching long↔short

@dataclass
class ExecutionConfig:
    mode:         str   = "backtest"  # "backtest" or "live"
    entry_fill:   str   = "close"     # "close" or "next_open"
    exit_fill:    str   = "close"     # "close", "stop_price", "next_open"
    commission:   float = 1.0         # $ per trade (one-way)
    slippage_pct: float = 0.0005      # 0.05% adverse slippage

@dataclass
class LiveConfig:
    mode:                  str   = "paper"      # "paper" or "live"
    ibkr_port:             int   = 4002         # 4002=paper, 4001=live
    ibkr_host:             str   = "127.0.0.1"
    ibkr_client_id:        int   = 2
    dry_run:               bool  = True         # log signals only, no orders
    signal_time:           str   = "15:00"      # ET daily signal time
    interval_minutes:      int   = 60           # stop monitor frequency
    max_daily_loss_pct:    float = 3.0          # auto-shutdown threshold
    fill_timeout_seconds:  int   = 30
    reconnect_attempts:    int   = 3
    session_capital:       float = 100000.0     # allocated capital
    symbol:                str   = "TQQQ"
    exchange:              str   = "SMART"

@dataclass
class BacktestConfig:
    date_from:           str   = "2017-01-01"
    date_to:             str   = "2026-03-16"
    window_label:        str   = "full_cycle_2"
    is_baseline:         bool  = False
    initial_capital:     float = 20000.0
    warmup_bars:         int   = 250
    use_circuit_breaker: bool  = False
    max_dd_threshold:    float = 30.0
```

**Used by:** Every module that reads configuration parameters.

---

### `load_config()`

**File:** `02-Common/engine/config.py`
**Signature:**
```python
def load_config(path: str = "config.yaml") -> Config:
```

**Summary:** Loads a YAML configuration file and returns a fully populated `Config` dataclass. Validates required fields and raises on missing or invalid values.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `str` | `"config.yaml"` | Path to the YAML config file |

**Returns:** `Config` — fully populated dataclass with all nested configs

**Raises:**
- `FileNotFoundError` — if `path` does not exist
- `ValueError` — if required fields are missing or values are out of valid range
- `yaml.YAMLError` — if the file is not valid YAML

**Example:**
```python
from engine.config import load_config

config = load_config("config.yaml")
print(config.strategy_name)               # "momentum_vwap_ema_atr_v1"
print(config.indicators.vwap_period)      # 250
print(config.symbols[0].atr_multiplier)   # 5.0
print(config.backtest.initial_capital)    # 20000.0

# With custom path (e.g. experiment override)
config = load_config("01-Backtest/experiments/exp_018_atr_wider.yaml")
```

**Side effects:** None. Pure function — reads a file but does not modify any state.

**Used by:** `backtest/run.py`, `live/main.py`, all test fixtures via `_make_config()`

---

### `Config.to_dict()`

**Signature:**
```python
def to_dict(self) -> dict:
```

**Summary:** Serialises the entire Config to a plain Python dictionary suitable for JSON storage. Used by `recorder.py` to store `config_snapshot` in the `runs` table.

**Returns:** `dict` — all nested dataclasses recursively converted to dicts

**Example:**
```python
config = load_config("config.yaml")
d = config.to_dict()
import json
json_str = json.dumps(d)   # store in DB

# Reconstruct from DB
d_restored = json.loads(json_str)
# Note: reconstruction requires manual dataclass instantiation
```

---

### `Config.symbol_config()`

**Signature:**
```python
def symbol_config(self, symbol: str) -> SymbolConfig:
```

**Summary:** Returns the `SymbolConfig` for a given symbol. Raises if symbol is not in the config.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `symbol` | `str` | Symbol to look up, e.g. `"TQQQ"` |

**Returns:** `SymbolConfig` for the given symbol

**Raises:** `KeyError` — if symbol not found in `config.symbols`

**Example:**
```python
sym = config.symbol_config("TQQQ")
print(sym.atr_multiplier)  # 5.0
print(sym.hard_stop_pct)   # 0.11
```

---

## indicators.py

### `true_range()`

**File:** `02-Common/engine/indicators.py`
**Signature:**
```python
def true_range(
    high:  pd.Series,
    low:   pd.Series,
    close: pd.Series,
) -> pd.Series:
```

**Summary:** Computes the True Range for each bar — the largest of three possible ranges. True Range extends the simple High−Low range to account for overnight gaps.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `high` | `pd.Series` | Bar high prices (adjusted) |
| `low` | `pd.Series` | Bar low prices (adjusted) |
| `close` | `pd.Series` | Bar close prices (adjusted) — used for previous close |

**Returns:** `pd.Series` of True Range values, same index as inputs. First value is NaN (no previous close).

**Formula:**
```
TR[t] = MAX(
    High[t] − Low[t],              # intraday range
    |High[t] − Close[t-1]|,        # gap up
    |Low[t]  − Close[t-1]|         # gap down
)
```

**Example:**
```python
import pandas as pd
from engine.indicators import true_range

high  = pd.Series([35.0, 36.5, 38.0, 36.0])
low   = pd.Series([33.0, 34.0, 35.0, 32.0])
close = pd.Series([34.5, 35.5, 37.0, 33.0])

tr = true_range(high, low, close)
# Index 0: NaN (no previous close)
# Index 1: MAX(36.5-34.0, |36.5-34.5|, |34.0-34.5|) = MAX(2.5, 2.0, 0.5) = 2.5
# Index 2: MAX(38.0-35.0, |38.0-35.5|, |35.0-35.5|) = MAX(3.0, 2.5, 0.5) = 3.0
# Index 3: MAX(36.0-32.0, |36.0-37.0|, |32.0-37.0|) = MAX(4.0, 1.0, 5.0) = 5.0
```

**Impact if changed:** [Impact Matrix — ATR Period](Impact-Matrix#atr-period)
**Called by:** [`atr()`](#atr)

---

### `vwap_rolling()`

**File:** `02-Common/engine/indicators.py`
**Signature:**
```python
def vwap_rolling(
    close:  pd.Series,
    volume: pd.Series,
    period: int = 250,
) -> pd.Series:
```

**Summary:** Computes a rolling Volume-Weighted Average Price over the specified lookback period. Returns NaN for the first `period − 1` bars (insufficient history for a complete window).

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `close` | `pd.Series` | — | Adjusted close prices |
| `volume` | `pd.Series` | — | Raw (unadjusted) trading volume |
| `period` | `int` | `250` | Rolling window in bars |

**Returns:** `pd.Series` of VWAP values. First `period − 1` values are `NaN`.

**Formula:**
```
VWAP[t] = SUM(Close[t-period+1 : t] × Volume[t-period+1 : t])
           ────────────────────────────────────────────────────
                    SUM(Volume[t-period+1 : t])
```

**Example:**
```python
from engine.indicators import vwap_rolling

# With period=3 for illustration (normally 250)
close  = pd.Series([30.0, 31.0, 32.0, 33.0, 34.0])
volume = pd.Series([1000, 2000, 1500, 3000, 2500])

vwap = vwap_rolling(close, volume, period=3)
# Index 0: NaN
# Index 1: NaN
# Index 2: (30*1000 + 31*2000 + 32*1500) / (1000+2000+1500) = 140000/4500 = 31.11
# Index 3: (31*2000 + 32*1500 + 33*3000) / (2000+1500+3000) = 227000/6500 = 34.92
```

**Important note on volume:** Volume is NOT adjusted for splits. Raw volume is used for VWAP weighting, matching standard VWAP convention.

**Warmup:** First `period − 1` = 249 bars are NaN. The simulation loop's `warmup_bars = 250` ensures the first valid signal bar always has a valid VWAP.

**Impact if changed:** [Impact Matrix — VWAP Period](Impact-Matrix#vwap-period)
**Used by:** [`evaluate()`](#evaluate) via computed indicators dict

---

### `ema()`

**File:** `02-Common/engine/indicators.py`
**Signature:**
```python
def ema(
    prices: pd.Series,
    period: int = 10,
) -> pd.Series:
```

**Summary:** Computes an Exponential Moving Average using a manual loop with SMA seeding. **Must not use `pandas.ewm()`** — the manual loop produces different boundary values that match test golden results.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prices` | `pd.Series` | — | Adjusted close prices |
| `period` | `int` | `10` | EMA lookback in bars |

**Returns:** `pd.Series` of EMA values. First `period − 1` values are `None` (not NaN — explicit None to distinguish from a computed zero).

**Formula:**
```
multiplier = 2 / (period + 1)    # = 0.1818 for period=10

EMA[period-1] = mean(prices[0 : period])          # seed: simple average
EMA[t]        = prices[t] × multiplier
              + EMA[t-1]  × (1 − multiplier)       # recursive
```

**Example:**
```python
from engine.indicators import ema
import pandas as pd

prices = pd.Series([10.0, 11.0, 12.0, 11.5, 13.0, 12.5, 14.0,
                    13.5, 15.0, 14.5,    # ← EMA seed = mean of these 10 = 13.15
                    15.0,                # ← first computed EMA bar
                    16.0])

result = ema(prices, period=10)
# Index 0–8:  None  (warmup)
# Index 9:    13.15  (SMA seed = mean of first 10 values)
# Index 10:   13.15 × 0.8182 + 15.0 × 0.1818 = 13.51
# Index 11:   13.51 × 0.8182 + 16.0 × 0.1818 = 14.01
```

**⚠️ Critical rule:** Never replace this with `pandas.ewm(span=period).mean()`. The ewm seeding method produces different values at the boundary, causing test failures and signal date shifts. See [Impact Matrix — EMA Implementation](Impact-Matrix#ema-implementation).

**Impact if changed:** [Impact Matrix — EMA Period](Impact-Matrix#ema-period)
**Used by:** [`evaluate()`](#evaluate)

---

### `atr()`

**File:** `02-Common/engine/indicators.py`
**Signature:**
```python
def atr(
    high:   pd.Series,
    low:    pd.Series,
    close:  pd.Series,
    period: int = 45,
) -> pd.Series:
```

**Summary:** Computes Average True Range using Wilder's smoothing (equivalent to EMA with period=`period` but with Wilder's specific multiplier `1/period`). Seeded with a simple average of the first `period` True Range values.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `high` | `pd.Series` | — | Adjusted bar highs |
| `low` | `pd.Series` | — | Adjusted bar lows |
| `close` | `pd.Series` | — | Adjusted close prices |
| `period` | `int` | `45` | ATR lookback in bars |

**Returns:** `pd.Series` of ATR values. First `period` values are NaN (Wilder needs `period` True Ranges to seed).

**Formula:**
```
TR[t]    = true_range(high, low, close)[t]
ATR[44]  = mean(TR[0:45])                     # seed: SMA of first 45 TRs
ATR[t]   = (ATR[t-1] × (period-1) + TR[t]) / period
         = ATR[t-1] × (44/45) + TR[t] × (1/45)
```

**Example:**
```python
from engine.indicators import atr
import pandas as pd

# Assume 50 bars of TQQQ data
# ATR values are available from bar index 45 onwards

result = atr(high, low, close, period=45)
# Index 0–44:  NaN
# Index 45:    Wilder ATR computed
# ...
# Index 100:   e.g. 1.82  (TQQQ moves ~$1.82/day on average)
```

**Used by:** [`evaluate()`](#evaluate) to compute `stop_price = close ± (mult × atr)`
**Called after:** [`true_range()`](#true_range)

---

### `adx()`

**File:** `02-Common/engine/indicators.py`
**Signature:**
```python
def adx(
    high:   pd.Series,
    low:    pd.Series,
    close:  pd.Series,
    period: int = 14,
) -> pd.Series:
```

**Summary:** Computes the Average Directional Index — a measure of trend **strength** (not direction). Returns values 0–100; higher = stronger trend regardless of direction.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `high` | `pd.Series` | — | Adjusted bar highs |
| `low` | `pd.Series` | — | Adjusted bar lows |
| `close` | `pd.Series` | — | Adjusted close prices |
| `period` | `int` | `14` | ADX smoothing period |

**Returns:** `pd.Series` of ADX values (0–100). First `2×period` values are NaN.

**⚠️ PERMANENTLY REJECTED as entry filter.** ADX was tested in experiments exp_010, exp_016, exp_017, exp_019 and found to **destroy performance** on TQQQ:
- ADX measures trend STRENGTH not DIRECTION
- In the 2022 bear market, high ADX = strong downtrend → admitted more losing short trades
- rolling_5y: CAGR −4.46%, Calmar −0.07 vs baseline
- **Decision: Never use ADX as entry filter on TQQQ. Do not re-test.**

The function remains in the codebase for completeness and future strategy research on other instruments.

**See:** [Experiment Results — ADX Experiments](Experiment-Results#adx-permanently-rejected)

---

## signals.py

### `SignalResult` dataclass

**File:** `02-Common/engine/signals.py`

The return type of [`evaluate()`](#evaluate). Carries all information needed by the backtest runner or live executor to act on the signal.

```python
@dataclass
class SignalResult:
    action:     str    # "BUY", "SELL", or "HOLD"
    direction:  str    # "long", "short", or "none"
    stop_price: float  # initial stop for new position; 0.0 if HOLD
    confidence: float  # 0.0–1.0 signal confidence (ML mode); 1.0 for rule-based
    indicators: dict   # {"vwap": float, "ema": float, "atr": float, "close": float}
    reason:     str    # human-readable explanation string
```

**`reason` string examples:**
```
"warmup_incomplete"           ← not enough bars for VWAP
"cooldown_active"             ← within cooldown_bars of last exit
"long_entry"                  ← close > VWAP and close > EMA, no position
"short_entry"                 ← close < VWAP and close < EMA, allow_short=True
"hold_long_position"          ← in long, no exit signal
"signal_flip_long_to_short"   ← was long, now SELL conditions met
"no_signal"                   ← flat, neither long nor short conditions met
```

---

### `evaluate()`

**File:** `02-Common/engine/signals.py`
**Signature:**
```python
def evaluate(
    bars:             pd.DataFrame,
    config:           Config,
    symbol:           str,
    current_position: str = "none",
    cooldown_counter: int = 0,
) -> SignalResult:
```

**Summary:** Evaluates the trading signal on the latest bar of the provided data slice. This is the central decision function of the strategy. Called once per bar by the backtest runner and once per day by the live loop.

**⚠️ Critical calling convention:** `bars` must be a slice of data up to and including the current bar only:
```python
signal = evaluate(bars.iloc[:bar_idx + 1], config, symbol)  # CORRECT
signal = evaluate(bars, config, symbol)                      # WRONG — lookahead bias
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bars` | `pd.DataFrame` | — | OHLCV data up to current bar (no lookahead) |
| `config` | `Config` | — | Strategy configuration |
| `symbol` | `str` | — | Symbol being evaluated, e.g. `"TQQQ"` |
| `current_position` | `str` | `"none"` | Current position: `"long"`, `"short"`, or `"none"` |
| `cooldown_counter` | `int` | `0` | Bars remaining in post-exit cooldown |

**Returns:** [`SignalResult`](#signalresult-dataclass)

**Decision logic (in order):**

```
1. len(bars) < warmup_bars → HOLD (reason: "warmup_incomplete")
2. cooldown_counter > 0    → HOLD (reason: "cooldown_active")
3. Compute: vwap, ema, atr from bars (using indicator functions)
4. current_position == "long":
   - close < vwap AND close < ema AND allow_short → SELL (flip)
   - else → HOLD
5. current_position == "short":
   - close > vwap AND close > ema → BUY (flip)
   - else → HOLD
6. current_position == "none":
   - close > vwap AND close > ema → BUY (long entry)
   - close < vwap AND close < ema AND allow_short → SELL (short entry)
   - else → HOLD
```

**Example:**
```python
import pandas as pd
from engine.config import load_config
from engine.signals import evaluate

config = load_config("config.yaml")
bars = pd.read_csv("02-Common/data/TQQQ_1d.csv", parse_dates=["date"], index_col="date")
bars = bars.iloc[:300]  # 300 bars (250 warmup + 50 measurement)

result = evaluate(bars, config, "TQQQ", current_position="none", cooldown_counter=0)

print(result.action)               # "BUY", "SELL", or "HOLD"
print(result.direction)            # "long", "short", or "none"
print(result.stop_price)           # e.g. 28.50
print(result.indicators["vwap"])   # e.g. 31.20
print(result.indicators["ema"])    # e.g. 32.80
print(result.reason)               # e.g. "long_entry"
```

**Called by:**
- [`runner.py:process_bar()`](Ref-Data-Backtest#process_bar) — every bar in simulation
- `live/main.py:_check_signal_time()` — once per trading day at 15:00 ET

**Impact if changed:** [Impact Matrix — evaluate() Signal Logic](Impact-Matrix#evaluate-signal-logic)

---

### `is_long_signal()`

**File:** `02-Common/engine/signals.py`
**Signature:**
```python
def is_long_signal(
    close: float,
    vwap:  float,
    ema:   float,
) -> bool:
```

**Summary:** Returns `True` if the long entry conditions are satisfied. Used internally by `evaluate()` and also directly in tests to verify individual condition logic.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `close` | `float` | Current bar adjusted close price |
| `vwap` | `float` | VWAP(250) value for this bar |
| `ema` | `float` | EMA(10) value for this bar |

**Returns:** `bool` — `True` if `close > vwap AND close > ema`

**Example:**
```python
from engine.signals import is_long_signal

is_long_signal(close=35.00, vwap=32.50, ema=33.80)  # True — both conditions met
is_long_signal(close=35.00, vwap=36.00, ema=33.80)  # False — close < vwap
is_long_signal(close=35.00, vwap=32.50, ema=36.00)  # False — close < ema
```

---

### `is_short_signal()`

**File:** `02-Common/engine/signals.py`
**Signature:**
```python
def is_short_signal(
    close: float,
    vwap:  float,
    ema:   float,
) -> bool:
```

**Summary:** Returns `True` if the short entry conditions are satisfied. Called by `evaluate()` only when `allow_short = True`.

**Returns:** `bool` — `True` if `close < vwap AND close < ema`

**Example:**
```python
from engine.signals import is_short_signal

is_short_signal(close=28.00, vwap=32.50, ema=30.00)  # True — both below
is_short_signal(close=28.00, vwap=25.00, ema=30.00)  # False — close > vwap
```

---

## risk.py

### `calc_position_size()`

**File:** `02-Common/engine/risk.py`
**Signature:**
```python
def calc_position_size(
    equity:              float,
    entry_price:         float,
    stop_price:          float,
    risk_per_trade_pct:  float,
    max_position_pct:    float = 0.95,
    sizing_mode:         str   = "risk_based",
) -> int:
```

**Summary:** Calculates the number of shares to buy or sell short. Supports two modes: `full_capital` (deploy a fixed fraction of equity) and `risk_based` (size so that hitting the stop costs exactly `risk_per_trade_pct` of equity).

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `equity` | `float` | — | Current portfolio value |
| `entry_price` | `float` | — | Expected fill price |
| `stop_price` | `float` | — | Initial stop price |
| `risk_per_trade_pct` | `float` | — | Risk % of equity (risk_based mode only) |
| `max_position_pct` | `float` | `0.95` | Max equity fraction to deploy |
| `sizing_mode` | `str` | `"risk_based"` | `"full_capital"` or `"risk_based"` |

**Returns:** `int` — number of shares (always ≥ 0, floored)

**Formulas:**

```python
# full_capital mode (current active mode)
shares = floor(equity × max_position_pct / entry_price)
# e.g. equity=$100,000, max_position_pct=0.95, entry=$35.00
# shares = floor(100000 × 0.95 / 35.00) = floor(2714.28) = 2714

# risk_based mode (kept for Phase 4 experiments)
risk_amount   = equity × risk_per_trade_pct          # e.g. 1% of $100k = $1,000
risk_per_share = abs(entry_price - stop_price)        # e.g. |35.00 - 31.15| = $3.85
shares_risk   = floor(risk_amount / risk_per_share)   # floor(259.74) = 259
shares_cap    = floor(equity × max_position_pct / entry_price)  # 2714
shares        = min(shares_risk, shares_cap)           # 259 (risk-based smaller)
```

**Raises:** `ValueError` — if `entry_price <= 0` or `max_position_pct <= 0`

**Example:**
```python
from engine.risk import calc_position_size

# Current active mode: full_capital
shares = calc_position_size(
    equity=100000,
    entry_price=35.00,
    stop_price=31.15,     # not used in full_capital mode
    risk_per_trade_pct=1.0,
    max_position_pct=0.95,
    sizing_mode="full_capital"
)
# Returns: 2714

# Alternative: risk_based mode
shares = calc_position_size(
    equity=100000,
    entry_price=35.00,
    stop_price=31.15,
    risk_per_trade_pct=1.0,
    max_position_pct=0.95,
    sizing_mode="risk_based"
)
# Returns: 259
```

**Impact if changed:** [Impact Matrix — Position Sizing Mode](Impact-Matrix#position-sizing-mode)

---

### `calc_ratchet_stop()`

**File:** `02-Common/engine/risk.py`
**Signature:**
```python
def calc_ratchet_stop(
    direction:     str,
    current_stop:  float,
    anchor:        float,
    bar_high:      float,
    bar_low:       float,
    atr:           float,
    multiplier:    float,
) -> tuple[float, float]:
```

**Summary:** Updates the ratchet trailing stop for the current bar. The stop only ever moves in the trade's favour — for a long trade it can only increase, for a short trade it can only decrease. This is enforced by `MAX()` (long) and `MIN()` (short) — not conditional logic.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `direction` | `str` | `"long"` or `"short"` |
| `current_stop` | `float` | Ratchet stop price from the previous bar |
| `anchor` | `float` | highest_high (long) or lowest_low (short) from previous bar |
| `bar_high` | `float` | Current bar's adjusted High |
| `bar_low` | `float` | Current bar's adjusted Low |
| `atr` | `float` | ATR(45) value for current bar |
| `multiplier` | `float` | ATR multiplier from config (`atr_multiplier`) |

**Returns:** `tuple[float, float]` — `(new_stop_price, new_anchor)`

**Formulas:**

```python
# Long:
new_anchor = max(anchor, bar_high)                         # only moves up
raw_stop   = new_anchor - (multiplier × atr)
new_stop   = max(current_stop, raw_stop)                   # invariant: never decreases

# Short:
new_anchor = min(anchor, bar_low)                          # only moves down
raw_stop   = new_anchor + (multiplier × atr)
new_stop   = min(current_stop, raw_stop)                   # invariant: never increases
```

**Critical invariant:**
```
Long:  new_stop >= current_stop   ALWAYS
Short: new_stop <= current_stop   ALWAYS
```

Tested by `test_ratchet_long_never_moves_down()` — 100 random bar sequences, all must pass.

**Example:**
```python
from engine.risk import calc_ratchet_stop

# Long trade — Day 1 (entry bar)
stop, anchor = calc_ratchet_stop(
    direction="long", current_stop=26.50, anchor=35.50,
    bar_high=35.50, bar_low=34.80, atr=1.80, multiplier=5.0
)
# new_anchor = max(35.50, 35.50) = 35.50
# raw_stop   = 35.50 - (5.0 × 1.80) = 26.50
# new_stop   = max(26.50, 26.50) = 26.50
print(stop, anchor)  # 26.50, 35.50

# Day 3 — new high reached
stop, anchor = calc_ratchet_stop(
    direction="long", current_stop=26.50, anchor=35.50,
    bar_high=38.50, bar_low=37.20, atr=1.80, multiplier=5.0
)
# new_anchor = max(35.50, 38.50) = 38.50
# raw_stop   = 38.50 - 9.0 = 29.50
# new_stop   = max(26.50, 29.50) = 29.50  ← stop moves up
print(stop, anchor)  # 29.50, 38.50

# Day 4 — lower high (no new high)
stop, anchor = calc_ratchet_stop(
    direction="long", current_stop=29.50, anchor=38.50,
    bar_high=37.80, bar_low=36.90, atr=1.82, multiplier=5.0
)
# new_anchor = max(38.50, 37.80) = 38.50  ← anchor unchanged
# raw_stop   = 38.50 - 9.10 = 29.40
# new_stop   = max(29.50, 29.40) = 29.50  ← stop UNCHANGED (invariant holds)
print(stop, anchor)  # 29.50, 38.50
```

**Impact if changed:** [Impact Matrix — calc\_ratchet\_stop()](Impact-Matrix#calc_ratchet_stop-logic)
**Called by:** `runner.py` every bar (in position), `live/executor.py:monitor_stops()`

---

### `effective_stop()`

**File:** `02-Common/engine/risk.py`
**Signature:**
```python
def effective_stop(
    direction:     str,
    ratchet_stop:  float,
    hard_stop:     float,
) -> float:
```

**Summary:** Returns the stop price that is actually used for exit decisions — the tighter of the ratchet stop and the hard stop.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `direction` | `str` | `"long"` or `"short"` |
| `ratchet_stop` | `float` | Current ratchet stop price |
| `hard_stop` | `float` | Fixed hard stop set at entry |

**Returns:** `float` — the effective stop price

**Formula:**
```python
if direction == "long":
    return max(ratchet_stop, hard_stop)   # higher stop is tighter for long

if direction == "short":
    return min(ratchet_stop, hard_stop)   # lower stop is tighter for short
```

**Example:**
```python
from engine.risk import effective_stop

# Early in trade — hard stop leads (ratchet hasn't tightened yet)
eff = effective_stop("long", ratchet_stop=26.50, hard_stop=31.15)
# max(26.50, 31.15) = 31.15   ← hard stop controls early exit

# Later in trade — ratchet has tightened beyond hard stop
eff = effective_stop("long", ratchet_stop=33.00, hard_stop=31.15)
# max(33.00, 31.15) = 33.00   ← ratchet controls now
```

**Called by:** `runner.py:process_bar()` on every bar when in position

---

### `is_stop_hit()`

**File:** `02-Common/engine/risk.py`
**Signature:**
```python
def is_stop_hit(
    direction: str,
    bar_low:   float,
    bar_high:  float,
    stop:      float,
) -> bool:
```

**Summary:** Returns `True` if the bar's price range touched or crossed the stop price. For long trades, checks if `bar_low ≤ stop`. For short trades, checks if `bar_high ≥ stop`.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `direction` | `str` | `"long"` or `"short"` |
| `bar_low` | `float` | Current bar's adjusted Low |
| `bar_high` | `float` | Current bar's adjusted High |
| `stop` | `float` | The effective stop price to check against |

**Returns:** `bool`

**Example:**
```python
from engine.risk import is_stop_hit

# Long position, stop at $33.00
is_stop_hit("long", bar_low=32.50, bar_high=35.00, stop=33.00)  # True — low < stop
is_stop_hit("long", bar_low=33.50, bar_high=35.00, stop=33.00)  # False — low > stop
is_stop_hit("long", bar_low=33.00, bar_high=35.00, stop=33.00)  # True — exact touch

# Short position, stop at $38.00
is_stop_hit("short", bar_low=35.00, bar_high=38.50, stop=38.00)  # True — high > stop
is_stop_hit("short", bar_low=35.00, bar_high=37.50, stop=38.00)  # False
```

**Called by:** `runner.py:process_bar()` to decide if a stop exit is needed this bar

---

### `portfolio_cap_allows()`

**File:** `02-Common/engine/risk.py`
**Signature:**
```python
def portfolio_cap_allows(
    equity:                 float,
    entry_price:            float,
    shares:                 int,
    max_portfolio_risk_pct: float,
) -> bool:
```

**Summary:** Checks whether opening a new position with `shares` shares would exceed the portfolio risk cap. Used as a pre-entry safety gate.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `equity` | `float` | Current portfolio value |
| `entry_price` | `float` | Expected entry fill price |
| `shares` | `int` | Proposed number of shares |
| `max_portfolio_risk_pct` | `float` | Maximum fraction of equity to deploy |

**Returns:** `bool` — `True` if the trade is within cap limits

**Formula:**
```python
position_value = entry_price × shares
return (position_value / equity) <= max_portfolio_risk_pct
```

**Example:**
```python
from engine.risk import portfolio_cap_allows

# equity=$100k, buying 2714 shares at $35
portfolio_cap_allows(100000, 35.00, 2714, 0.95)
# position_value = 35 × 2714 = $94,990
# 94990 / 100000 = 94.99% ≤ 95%  → True

# Would exceed cap
portfolio_cap_allows(100000, 35.00, 2800, 0.95)
# position_value = 35 × 2800 = $98,000
# 98000 / 100000 = 98% > 95%  → False
```

**Called by:** `runner.py:process_bar()` before every entry — if False, entry is skipped
