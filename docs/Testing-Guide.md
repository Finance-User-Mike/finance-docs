# Testing Guide

> **Audience:** Developers — how to run tests, what each suite covers, and what to do when tests fail.
> **Related:** [Ref-Engine-Core](Ref-Engine-Core) · [Ref-Data-Backtest](Ref-Data-Backtest) · [Batch-Operations](Batch-Operations) · [Impact-Matrix](Impact-Matrix)

---

## The Testing Rule

> **Never commit with failing tests. Never run a backtest with failing tests.**

`backtest/run.py` runs `pytest tests/unit/ -q` as a safety gate before every backtest. If any test fails, the process exits with code 1 and the backtest never runs. This is non-negotiable.

---

## Test Suite Structure

```
project root
├── pytest.ini                               ← testpaths configured here
│
├── 02-Common/tests/                         ← engine + data tests
│   ├── unit/
│   │   ├── test_config.py                   ← Config dataclass + load_config()
│   │   ├── test_indicators.py               ← true_range, ema, atr, vwap, adx
│   │   ├── test_signals.py                  ← evaluate(), is_long/short_signal()
│   │   ├── test_risk.py                     ← position sizing, ratchet, stops
│   │   ├── test_data.py                     ← load_csv, slice_window, apply_adjustment
│   │   └── test_verdict.py                  ← classify_verdict() logic
│   └── fixtures/
│       ├── test_config.yaml                 ← minimal config for tests
│       ├── synthetic_prices.csv             ← known synthetic OHLCV data
│       └── golden_result.json               ← locked expected result for regression
│
├── 01-Backtest/tests/                       ← backtest-specific tests
│   ├── unit/
│   │   └── test_metrics.py                  ← all metrics functions + 3-component CAGR
│   ├── integration/
│   │   └── test_backtest.py                 ← full pipeline: data→sim→metrics
│   ├── regression/
│   │   └── test_regression.py               ← golden_result comparison
│   └── stress/
│       └── test_stress.py                   ← 10y synthetic data, extreme edge cases
│
└── 03-Live/tests/                           ← live trading tests (no TWS required)
    ├── test_phase3_batch1.py                ← db_setup, data, broker, executor, logger, validate
    └── test_phase3_batch2.py                ← main.py orchestration, commands, shutdown
```

**pytest.ini configuration:**

```ini
[pytest]
testpaths = 02-Common/tests 01-Backtest/tests 03-Live/tests
python_files = test_*.py
python_functions = test_*
```

---

## How to Run Tests

All commands from the **project root** (`E:\Trading\tqqq-dev`).

### Run everything

```bash
pytest -v
```

### Run only unit tests (fastest — used by safety gate)

```bash
pytest 02-Common/tests/unit/ 01-Backtest/tests/unit/ -q
```

### Run one test file

```bash
pytest 02-Common/tests/unit/test_indicators.py -v
```

### Run one specific test

```bash
pytest 02-Common/tests/unit/test_risk.py::test_ratchet_long_never_moves_down -v
```

### Run with short traceback (same as safety gate)

```bash
pytest 02-Common/tests/unit/ -q --tb=short
```

### Run integration tests

```bash
pytest 01-Backtest/tests/integration/ -v
```

### Run live tests (no TWS connection required)

```bash
pytest 03-Live/tests/ -v
```

### Run all with coverage

```bash
pytest --cov=engine --cov=backtest --cov-report=term-missing
```

---

## Test Suites in Detail

### Unit: test_config.py

Tests the `engine/config.py` config loading and validation.

| Test | What it verifies |
|------|-----------------|
| `test_load_config_valid` | Correct values loaded from YAML |
| `test_load_config_missing_file` | `FileNotFoundError` on nonexistent file |
| `test_config_to_dict_is_serialisable` | `Config.to_dict()` produces JSON-serialisable output |
| `test_symbol_config_found` | `config.symbol_config("TQQQ")` returns correct `SymbolConfig` |
| `test_symbol_config_missing_raises` | `KeyError` on unknown ticker |
| `test_load_config_missing_symbols_key` | `ConfigError` when `symbols:` absent |
| `test_load_config_empty_symbols` | `ConfigError` when `symbols: []` |
| `test_load_config_unknown_keys_ignored` | Forward-compatible — extra keys silently ignored |
| `test_config_defaults_applied` | Minimal YAML gets dataclass defaults (vwap=250, capital=20000) |

**Fixtures:** Uses `tmp_path` (pytest built-in) to write config YAMLs to temp directories — no filesystem state pollution.

---

### Unit: test_indicators.py

Tests all 5 indicator functions in `engine/indicators.py`.

#### true_range()

| Test | What it verifies |
|------|-----------------|
| `test_true_range_known_values` | TR = max(H-L, \|H-prevC\|, \|L-prevC\|) matches manual calculation |
| `test_true_range_same_length_as_input` | Output length = input length |

#### ema()

| Test | What it verifies |
|------|-----------------|
| `test_ema_known_values` | EMA(3) matches hand-calculated values for known series |
| `test_ema_insufficient_data` | Returns all-NaN safely when bars < period |
| `test_ema_first_valid_index` | First non-NaN is at index `period-1` |
| `test_ema_period_1` | EMA(1) = prices (multiplier=1.0, no smoothing) |
| `test_ema_raises_on_bad_period` | `ValueError` for period < 1 |

**Critical:** The EMA tests verify the **manual loop implementation**, not `pandas.ewm()`. The two implementations have different boundary values. If EMA is ever switched to `ewm()`, these tests will catch the divergence.

**Worked check example:**

```
prices = [10, 11, 12, 13, 14, 15],  period=3
seed = SMA(prices[0:3]) = (10+11+12)/3 = 11.0
multiplier = 2/(3+1) = 0.5

EMA[2] = 11.0
EMA[3] = 13 × 0.5 + 11.0 × 0.5 = 12.0
EMA[4] = 14 × 0.5 + 12.0 × 0.5 = 13.0
EMA[5] = 15 × 0.5 + 13.0 × 0.5 = 14.0
```

#### atr()

| Test | What it verifies |
|------|-----------------|
| `test_atr_wilder_smoothing` | Constant prices converge to 2.0 (H-L gap of 2 throughout) |
| `test_atr_first_valid_index` | First valid ATR at index `period` (not period-1) |
| `test_atr_raises_on_bad_period` | `ValueError` for period < 1 |

**Note:** ATR first valid is at `period`, not `period-1`, because the Wilder seed requires a full `period` of true range values before the first smoothed value.

#### vwap_rolling()

| Test | What it verifies |
|------|-----------------|
| `test_vwap_rolling_known_values` | VWAP = SUM(close×vol, N) / SUM(vol, N) matches manual |
| `test_vwap_rolling_window_slides` | Old bars drop off correctly when a price spike occurs |
| `test_vwap_rolling_first_valid_at_period_minus_one` | First non-NaN at `period-1` |
| `test_vwap_rolling_raises_on_bad_period` | `ValueError` for period < 1 |

#### adx()

| Test | What it verifies |
|------|-----------------|
| `test_adx_range` | ADX values always in [0, 100] |
| `test_adx_trending_vs_choppy` | ADX correctly higher for trending vs choppy data |

**ADX note:** These tests are retained even though ADX is [permanently rejected as an entry filter](Experiment-Results#exp_010--adx-entry-filter-permanently-rejected). The function itself is correct — only its use as an entry filter was rejected.

---

### Unit: test_signals.py

Tests `engine/signals.py` — the entry signal logic.

#### is_long_signal() / is_short_signal()

| Test | What it verifies |
|------|-----------------|
| `test_is_long_signal_both_true` | Long fires when close > VWAP AND close > EMA |
| `test_is_long_signal_blocked_by_position` | No double-entry when already long |
| `test_is_long_signal_blocked_by_short_position` | No flip without explicit exit first |
| `test_is_long_signal_vwap_fails` | Long blocked when close < VWAP |
| `test_is_long_signal_ema_fails` | Long blocked when close < EMA (require_both=True) |
| `test_is_long_signal_nan_vwap` | Long blocked during warmup (NaN VWAP) |
| `test_is_long_signal_require_both_false` | Fires on either condition when require_both=False |
| `test_is_short_signal_allow_short_false` | Short never fires when allow_short=False |
| `test_is_short_signal_fires` | Short fires when close < VWAP AND close < EMA |

#### evaluate()

| Test | What it verifies |
|------|-----------------|
| `test_evaluate_warmup_returns_hold` | HOLD with reason=warmup when bars < vwap_period |
| `test_evaluate_cooldown_blocks_entry` | HOLD with reason=cooldown when cooldown_counter > 0 |
| `test_evaluate_long_signal` | BUY with direction=long when price spikes above both indicators |
| `test_evaluate_hold_no_signal` | HOLD on flat neutral prices (close ≈ VWAP ≈ EMA) |
| `test_evaluate_returns_signal_result` | Always returns a `SignalResult` instance |

**The cooldown test is one of the most important:** It verifies that after an exit, the strategy waits `cooldown_bars` before re-entering — preventing immediate re-entry on the same signal.

---

### Unit: test_risk.py

Tests `engine/risk.py` — position sizing, ratchet stops, and portfolio cap.

#### calc_position_size()

| Test | What it verifies |
|------|-----------------|
| `test_calc_position_size_known_value` | Exact share count for known equity/entry/stop |
| `test_calc_position_size_zero_risk` | Returns 0 when entry == stop (no risk basis) |
| `test_calc_position_size_cap` | Capped at 95% of equity (no over-leverage) |
| `test_calc_position_size_zero_entry` | Returns 0 when entry_price is zero (safety guard) |
| `test_calc_position_size_returns_int` | Always returns int (whole shares) |
| `test_calc_position_size_never_negative` | Returns 0, never negative |

**Known value check:**

```
equity=20000, risk_pct=1.0% → risk_amount = $200
entry=45.00, stop=40.50 → risk_per_share = $4.50
shares = floor($200 / $4.50) = floor(44.44) = 44
```

#### calc_ratchet_stop()

| Test | What it verifies |
|------|-----------------|
| `test_ratchet_long_known_values` | Exact stop values for known inputs |
| `test_ratchet_long_never_moves_down` | **100 random bars — stop only rises** ← critical invariant |
| `test_ratchet_short_known_values` | Exact stop values for short |
| `test_ratchet_short_never_moves_up` | **100 random bars — stop only falls** ← critical invariant |
| `test_ratchet_invalid_direction` | `ValueError` for unknown direction |

**The monotonicity tests are the most important tests in the entire suite.** If the ratchet stop ever moves against the trade, it means a position that was protected could become unprotected — allowing larger losses than intended.

```
test_ratchet_long_never_moves_down:
  random.seed(42)
  for 100 bars with random high/low/atr:
      new_stop, anchor = calc_ratchet_stop("long", stop, anchor, ...)
      assert new_stop >= stop   ← MUST NEVER FAIL
      stop = new_stop
```

#### effective_stop() and is_stop_hit()

| Test | What it verifies |
|------|-----------------|
| `test_effective_stop_hard_fires_first` | Hard stop wins when ratchet is below hard level |
| `test_effective_stop_ratchet_tighter` | Ratchet wins when it has risen above hard level |
| `test_effective_stop_short_hard_fires` | Mirror logic for shorts |
| `test_effective_stop_no_hard_stop` | Returns ratchet directly when hard stop disabled |
| `test_is_stop_hit_long_breach` | Long stop triggered when low < stop |
| `test_is_stop_hit_long_equal_not_hit` | Equality (low == stop) does NOT trigger exit |
| `test_is_stop_hit_short_breach` | Short stop triggered when high > stop |

---

### Unit: test_metrics.py

Tests all metrics functions in `backtest/metrics.py`.

**Key tests — 3-component CAGR:**

| Test | What it verifies |
|------|-----------------|
| `test_cagr_feb_example` | Feb example: combined=13.01%, trading=10.00%, cash=3.00% |
| `test_cagr_zero_trades` | Zero trades: combined≈3.00%, trading=0.00% |
| `test_cagr_full_cycle` | Full cycle 2017–2026: combined≈28.33%, trading≈25.49% |
| `test_cagr_window_too_short` | < 7 days → all zeros |

**These locked numeric examples** define exactly what the formula must produce. If the formula ever changes, these fail immediately.

| Test | What it verifies |
|------|-----------------|
| `test_compute_all_keys_present` | All 17 required metric keys present |
| `test_compute_all_no_nan` | No NaN values in output |
| `test_compute_all_empty_trades` | Handles zero trades gracefully |
| `test_max_drawdown_known` | Peak 12000, trough 9000 → -25% |
| `test_expectancy_positive_edge` | 60% win at 2% avg / 40% loss at 1% → expectancy +0.8% |

---

### Integration: test_backtest.py

Full pipeline tests — from config load through run() to metrics. Uses `test_config.yaml` and `synthetic_prices.csv` from fixtures.

| Test | What it verifies |
|------|-----------------|
| `test_full_pipeline_runs` | `run()` completes without exception |
| `test_metrics_all_keys_present` | `compute_all()` on real run output has all required keys |
| `test_metrics_no_none_values` | No `None` values in metrics |
| `test_no_lookahead_bias` | All trade `entry_bar_idx` ≥ 0 (no pre-history trades) |
| `test_entry_bar_always_valid_index` | All bar indices within valid range |
| `test_commission_deducted` | `pnl_usd = gross - 2×commission` for every trade |
| `test_deterministic_output` | Same input → identical trades and equity curve both calls |
| `test_ratchet_stops_only_improve` | Stop prices never decrease for long trades |
| `test_equity_curve_length` | len(equity_curve) == len(bars) + 1 |
| `test_circuit_breaker_halts_entries` | CB trips at 30% DD, counts down correctly |
| `test_cash_return_applied_on_idle_days` | Idle cash at 3% increases equity over 252 days |

**Lookahead bias test** is the integration-level version of the critical correctness guarantee:

```
for each trade in result["trades"]:
    assert trade["entry_bar_idx"] >= 0
    assert entry_bar_idx < len(bars)
    assert exit_bar_idx < len(bars)
```

If `evaluate()` received future bars, a trade could open at bar -1 or the entry date would precede the signal date.

---

### Regression: test_regression.py

Compares a full backtest run against `golden_result.json` — a locked snapshot of known-correct results.

**Purpose:** Catch silent regressions where a code change alters numeric output without breaking any unit tests. The golden result was recorded after all known bugs were fixed (v0.6.7).

**What it checks:** CAGR, Sharpe, Calmar, max_drawdown, total_trades — all within tight tolerances (±0.01%).

**Updating the golden result:** Only done intentionally after a deliberate engine change. Never update golden_result.json as a "fix" for a failing regression test without understanding why it changed.

```bash
# Run regression tests only
pytest 01-Backtest/tests/regression/ -v

# If you intentionally changed the engine and need to update golden:
python -c "
from backtest.runner import run
from engine.config import load_config
import json
config = load_config('02-Common/tests/fixtures/test_config.yaml')
result = run(config)
# ... compute and save new golden
"
```

---

### Stress: test_stress.py

Tests on extreme or edge-case inputs — very large datasets, volatile price series, edge conditions.

| What is tested |
|---------------|
| 10-year synthetic daily data (~2,500 bars) completes without crash |
| Extreme volatility (50% daily moves) doesn't produce NaN metrics |
| All-flat prices (no signals fire) handles zero trades gracefully |
| Price that goes to near-zero doesn't cause division errors |
| Random walk with known seed produces consistent output |

---

### Live Tests: test_phase3_batch1.py, test_phase3_batch2.py

**No TWS / IB Gateway connection required** — all live tests use mocking or offline DB operations.

**Batch 1 (24 tests):** Tests for `live/db_setup.py`, `live/data.py`, `live/broker.py`, `live/executor.py`, `live/logger.py`, `live/validate.py`.

**Batch 2 (21 tests):** Tests for `live/main.py` orchestration — `run_live_loop()`, `market_is_open()`, `is_signal_time()`, `check_daily_loss_limit()`, `safe_shutdown()`, `emergency_shutdown()`.

**45 total live tests** — all pass without any IBKR connection.

---

## Test Fixtures

All fixtures live in `02-Common/tests/fixtures/`.

### test_config.yaml

Minimal config pointing at `synthetic_prices.csv`. Used by integration tests.

```yaml
symbols:
  - symbol: TQQQ
    data_file: 02-Common/tests/fixtures/synthetic_prices.csv
    atr_multiplier: 4.5
    hard_stop_pct: 0.08
    allow_short: true
indicators:
  vwap_period: 50      ← shortened for fast test runs
  ema_period: 10
  atr_period: 14
backtest:
  date_from: "2020-01-01"
  date_to: "2024-12-31"
  initial_capital: 10000.0
```

**Note:** `vwap_period: 50` in the test config (not 250) so tests run fast on the small synthetic dataset. The 250 value is tested indirectly through the indicator unit tests.

### synthetic_prices.csv

Deterministic synthetic OHLCV data covering several years. Contains:
- A clear uptrend segment (to test long entry + trailing stop behaviour)
- A correction segment (to test stop-out and short entry)
- Flat/sideways segment (to test no-signal periods and cooldown)

**Never modify this file** — it is a test fixture with known expected outputs. If test results need to change because of a strategy logic change, update the integration tests to reflect new expected behaviour, not the fixture.

### golden_result.json

Locked expected output for the regression test suite. Contains exact metric values produced by the v0.6.7 engine on the synthetic_prices.csv data.

```json
{
  "cagr_annual_pct": 14.82,
  "max_drawdown_pct": -7.93,
  "sharpe_ratio": 0.876,
  "calmar_ratio": 1.87,
  "total_trades": 8
}
```

---

## When Tests Fail

### Before investigating — read the error

```bash
pytest 02-Common/tests/unit/test_risk.py -v --tb=long
```

Always use `--tb=long` when debugging — the default `--tb=short` may truncate the relevant stack frame.

### Common failure patterns

**Ratchet monotonicity failure:**
```
AssertionError: Stop moved down: 92.3 → 91.8
```
→ Check `calc_ratchet_stop()` in `engine/risk.py`. The `MAX(ratchet, raw_stop)` or `MIN(ratchet, raw_stop)` guard is missing or inverted.

**EMA divergence:**
```
AssertionError: 12.000 != 11.500 (within 0.0001)
```
→ EMA seed or multiplier changed. Check manual loop vs formula. Never switch to `pandas.ewm()`.

**CAGR formula failure:**
```
AssertionError: 28.0 ≈ 13.01% (within 0.1) FAILED
```
→ 3-component formula changed. Check `calc_cagr()` in `metrics.py` — verify all three steps and the 365.25 divisor.

**Integration lookahead failure:**
```
AssertionError: entry_bar_idx = -3
```
→ `evaluate()` is receiving `bars` (full frame) instead of `bars.iloc[:bar_idx+1]`. Check `process_bar()` in `runner.py`.

**Config missing field:**
```
ConfigError: symbols list required
```
→ `test_config.yaml` fixture missing required field, or `load_config()` validation changed.

### Escalation rule

If a test fails after 2 fix attempts:
1. Stop and read the full error with `--tb=long`
2. Copy the error + failing code
3. Bring to Claude Chat for diagnosis
4. Apply exact fix
5. Rerun — green — commit — continue

**Never commit with failing tests. Never bypass the safety gate.**

---

## Adding New Tests

When adding a new engine function or modifying an existing one:

1. **Read the relevant spec** in `docs/doc3_test_specs.md` first
2. **Add tests to the appropriate file** (unit → correct module file)
3. **Cover the critical invariants** — monotonicity, NaN safety, zero-division
4. **Run the full suite** before committing

**Test naming convention:**

```python
def test_{function_name}_{condition}():
    """One-line docstring: what the test verifies."""
```

**Docstring is mandatory** — it must describe WHAT the test verifies (not HOW). The safety gate runs `pytest -q` which shows docstrings on failure, so clear docstrings save debugging time.

**Parametrize for sweeps:**

```python
@pytest.mark.parametrize("period,expected", [(3, 11.0), (5, 10.0), (10, 9.5)])
def test_ema_seed_values(period, expected):
    """EMA seed equals SMA of first `period` values."""
    prices = pd.Series(range(1, 20), dtype=float)
    result = ema(prices, period)
    assert result.iloc[period - 1] == pytest.approx(expected, abs=0.001)
```

---

## Test Coverage Summary

| Module | Unit tests | Integration | Critical invariants |
|--------|-----------|-------------|---------------------|
| `engine/config.py` | 9 | via cfg fixture | defaults, validation |
| `engine/indicators.py` | 14 | via integration | EMA manual loop, ATR Wilder |
| `engine/signals.py` | 14 | via integration | warmup, cooldown, NaN safety |
| `engine/risk.py` | 18 | via integration | **ratchet monotonicity** (100 random bars) |
| `backtest/metrics.py` | 20 | via integration | 3-component CAGR locked examples |
| `backtest/runner.py` | — | 12 | no lookahead, determinism |
| `backtest/simulator.py` | — | commission test | fill logic |
| `backtest/recorder.py` | — | — | verdict classification |
| `live/` | — | 45 | no TWS required |

**Total: 159 tests passing (Phase 1 complete, Phase 3 added 45)**

---

*Back to [Home](Home) · [Ref-Engine-Core](Ref-Engine-Core) · [Batch-Operations](Batch-Operations) · [Impact-Matrix](Impact-Matrix)*
