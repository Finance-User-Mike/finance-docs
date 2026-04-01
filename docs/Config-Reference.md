# Config Reference

Every configurable parameter in the system, with type, default, valid range, and impact level.

Two configuration files control the system:
- **`config.yaml`** — strategy parameters, loaded by `engine/config.py` into typed dataclasses
- **`.env`** — environment and infrastructure, loaded by `live/config.py` at process startup

For the YAML file hierarchy (base → experiment overlay) see [YAML Config Guide](YAML-Config-Guide.md).
For data window parameters see [Data Windows Reference](Data-Windows-Reference.md).

---

## Impact Key

| Symbol | Meaning |
|--------|---------|
| 🔴 HIGH | Changes trade results or stop logic — affects backtest performance |
| 🟡 MED  | Changes behavior without directly affecting P&L calculation |
| 🟢 LOW  | Operational / logging / UI only |

---

## config.yaml Parameters

### Top-Level

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `strategy_name` | string | `"momentum_vwap_ema_atr_v1"` | Any string | 🟢 LOW — metadata label stored in DB with each run |

---

### `symbols` Section

Each entry in the `symbols` list is a per-symbol override. The list must contain at least one entry.

```yaml
symbols:
  - symbol: TQQQ
    data_file: data/TQQQ_1d.csv
    atr_multiplier: 4.5
    hard_stop_pct: 0.08
    allow_short: true
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `symbol` | string | — (required) | Any ticker string | 🔴 HIGH — used to match price data and DB records |
| `data_file` | string | — (required) | Path to CSV file | 🔴 HIGH — determines which price file is loaded |
| `atr_multiplier` | float | `4.5` | `1.0 – 10.0` | 🔴 HIGH — controls ratchet stop width; higher = wider stop, fewer exits |
| `hard_stop_pct` | float | `0.08` | `0.01 – 0.30` | 🔴 HIGH — maximum loss per trade as fraction of entry price |
| `allow_short` | bool | `true` | `true` / `false` | 🔴 HIGH — enables/disables all short entries |

**`atr_multiplier` impact detail:**

| Value | Effect |
|-------|--------|
| 4.5 (baseline) | Moderate stop width — baseline B2 config |
| 5.0 (exp_018) | Wider stop — fewer premature exits, shallower DD in bear markets |
| < 4.0 | Tight stop — more trades, higher whipsaw risk |
| > 6.0 | Very wide — few trades, large per-trade risk |

Tested range in Phase 2: `2.5 – 6.5` (exp_002). Conclusion: 4.5 is optimal for baseline; 5.0 improves Calmar without sacrificing CAGR.

**`hard_stop_pct` impact detail:**

| Value | Effect |
|-------|--------|
| 0.08 (8%) | Baseline — exits bad trades quickly |
| 0.10 (10%) | Better — tested in exp_006, confirmed improvement |
| 0.11 (11%) | exp_018 best config — complements wider ATR multiplier |
| > 0.15 | Hard stop rarely fires; relies entirely on ratchet |

**`allow_short` impact detail:**

Short trades added: `Close < VWAP_250 AND Close < EMA_10`.
Disabling this produces a long-only strategy. Current experiments all tested with `allow_short: true`.

---

### `indicators` Section

Controls which indicator periods are used for signal generation. These values are also the warmup requirements.

```yaml
indicators:
  vwap_period: 250
  vwap_price: close
  ema_period: 10
  atr_period: 45
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `vwap_period` | int | `250` | `20 – 500` | 🔴 HIGH — sets trend filter lookback; also drives warmup_bars requirement |
| `vwap_price` | string | `"close"` | `"close"` / `"typical"` | 🔴 HIGH — `"typical"` uses (H+L+C)/3; tested only with `"close"` |
| `ema_period` | int | `10` | `5 – 50` | 🔴 HIGH — short-term momentum filter period |
| `atr_period` | int | `45` | `10 – 90` | 🔴 HIGH — volatility smoothing window; longer = smoother stop movement |

**Warmup rule (critical):**

```
warmup_bars = max(vwap_period, ema_period, atr_period) = vwap_period = 250
```

All windows prepend 250 extra bars before `measure_from`. Changing `vwap_period` changes the warmup requirement — if you increase it, also increase `warmup_bars` passed to `slice_window()`.

**Indicator sweep results (Phase 2):**

| Parameter | Tested | Winner | Notes |
|-----------|--------|--------|-------|
| `vwap_period` | 50–500 (exp_007) | **250** (baseline) | Shorter = noisy; longer = lagged |
| `ema_period` | 5–50 (exp_004) | **10** (baseline) | 5 too noisy; 20+ misses entries |
| `atr_period` | 10–90 (exp_002) | **45** (baseline) | Wilder smoothing balanced |

**Never change these values** without re-running the full Phase 2 sweep — they are interdependent.

---

### `entry` Section

Controls which indicators must agree for an entry signal to fire.

```yaml
entry:
  require_both_long: true
  require_both_short: true
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `require_both_long` | bool | `true` | `true` / `false` | 🔴 HIGH — `false` = entry if either VWAP OR EMA signals long |
| `require_both_short` | bool | `true` | `true` / `false` | 🔴 HIGH — `false` = entry if either VWAP OR EMA signals short |

**Entry logic (when both required):**

```
LONG:  Close > VWAP_250  AND  Close > EMA_10  AND  not in position
SHORT: Close < VWAP_250  AND  Close < EMA_10  AND  not in position  AND  allow_short
```

Setting `require_both_long: false` creates a "signal OR" mode — more entries but more false positives. This was not tested in Phase 2 experiments and is untested territory.

---

### `stop` Section

Enables/disables each stop mechanism independently.

```yaml
stop:
  use_hard_stop: true
  use_ratchet: true
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `use_hard_stop` | bool | `true` | `true` / `false` | 🔴 HIGH — disabling removes the maximum-loss safety net |
| `use_ratchet` | bool | `true` | `true` / `false` | 🔴 HIGH — disabling removes profit-locking; trades can fully reverse |

**Effective stop calculation:**

```
Long:  effective_stop = MAX(ratchet_stop, hard_stop)   # highest floor wins
Short: effective_stop = MIN(ratchet_stop, hard_stop)   # lowest ceiling wins
```

Both mechanisms should remain `true` in production. Disabling either is only for ablation experiments.

**INVARIANT — never relax:** The ratchet stop only moves in the trade's favour. See [Engine Core Reference — risk.py](Ref-Engine-Core.md#riskpy) for the monotonicity proof.

---

### `risk` Section

Controls position sizing, volatility adjustments, and cash accounting.

```yaml
risk:
  position_sizing_mode: "full_capital"
  risk_per_trade_pct: 1.0
  max_position_pct: 0.95
  max_portfolio_risk_pct: 4.0
  ml_mode: false
  ml_model: atr_multiplier_v1
  use_volatility_sizing: false
  vol_lookback_period: 20
  min_position_size: 0.5
  max_position_size: 1.5
  cash_rate_annual: 0.03
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `position_sizing_mode` | string | `"per_risk"` | `"per_risk"` / `"full_capital"` | 🔴 HIGH — determines how many shares are bought |
| `risk_per_trade_pct` | float | `1.0` | `0.1 – 5.0` | 🔴 HIGH — used only in `per_risk` mode |
| `max_position_pct` | float | `0.95` | `0.5 – 1.0` | 🔴 HIGH — caps capital deployment in `full_capital` mode |
| `max_portfolio_risk_pct` | float | `4.0` | `1.0 – 20.0` | 🟡 MED — aggregate risk cap before new entries blocked |
| `ml_mode` | bool | `false` | `true` / `false` | 🟡 MED — enables ML-predicted ATR multiplier (Phase 4) |
| `ml_model` | string | `"atr_multiplier_v1"` | Model file name | 🟡 MED — only read when `ml_mode: true` |
| `use_volatility_sizing` | bool | `false` | `true` / `false` | 🔴 HIGH — scales shares by rolling vol ratio |
| `vol_lookback_period` | int | `20` | `5 – 60` | 🔴 HIGH — used only when `use_volatility_sizing: true` |
| `min_position_size` | float | `0.5` | `0.1 – 1.0` | 🔴 HIGH — vol sizing floor multiplier (0.5 = half normal size) |
| `max_position_size` | float | `1.5` | `1.0 – 3.0` | 🔴 HIGH — vol sizing ceiling multiplier (1.5 = 1.5× normal size) |
| `cash_rate_annual` | float | `0.03` | `0.0 – 0.10` | 🟡 MED — annual return credited on idle capital between trades |

**Position sizing mode comparison:**

| Mode | Formula | Phase 2 result |
|------|---------|---------------|
| `full_capital` | `shares = floor(equity × max_position_pct / entry_price)` | **Deployed in all Phase 2 experiments** |
| `per_risk` | `shares = floor(equity × risk_per_trade_pct / abs(entry - stop))` | Available for Phase 4 experiments |

The `full_capital` mode was chosen after testing showed it produces better CAGR on TQQQ's trending nature. The per-risk formula remains in code for future experiments.

**`use_volatility_sizing` detail:**

When `true`, a multiplier is calculated daily:
```
vol_ratio      = target_vol / current_vol
multiplier     = clip(vol_ratio, min_position_size, max_position_size)
adjusted_shares = floor(base_shares × multiplier)
```
Tested in exp_011 — volatility sizing alone did not improve results on TQQQ.

**`cash_rate_annual` detail:**

Idle cash earns a simulated T-bill return while no position is held:
```
idle_days     = total_window_days - sum(all trade hold days)
idle_interest = equity × ((1 + cash_rate_annual)^(idle_days/365.25) - 1)
```
At 3% annual, a 250-day idle period on $20,000 earns ≈ $410. This is the "Step 2" component of the 3-part CAGR formula. See [Ref-Data-Backtest — metrics.py](Ref-Data-Backtest.md#metricspy) for full formula.

---

### `signal` Section

Controls optional entry filters applied on top of the base VWAP+EMA signals.

```yaml
signal:
  use_adx_filter: false
  min_adx_for_entry: 15.0
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `use_adx_filter` | bool | `false` | `true` / `false` | 🔴 HIGH — **PERMANENTLY DISABLED** — see warning below |
| `min_adx_for_entry` | float | `15.0` | `10.0 – 40.0` | 🔴 HIGH — ADX threshold (unused unless `use_adx_filter: true`) |

> ⛔ **ADX FILTER — PERMANENTLY REJECTED**
>
> `use_adx_filter: true` was tested in exp_010, exp_017, exp_019, exp_016. All variants destroyed performance.
>
> Root cause: ADX measures trend **strength**, not **direction**. A high ADX value during the 2022 bear market admitted more losing short trades rather than filtering them. VWAP(250) + EMA(10) already provide a sufficient directional filter.
>
> **Never set `use_adx_filter: true` on TQQQ.** The parameter exists in code only for forward compatibility with other symbols.

---

### `timing` Section

Controls re-entry delays and flip-direction waiting periods.

```yaml
timing:
  cooldown_bars: 1
  flip_wait_bars: 1
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `cooldown_bars` | int | `1` | `0 – 10` | 🟡 MED — bars to skip after any exit before the next entry is allowed |
| `flip_wait_bars` | int | `1` | `0 – 5` | 🟡 MED — extra bars to wait before flipping long→short or short→long |

**Cooldown detail:**

```
Exit fires on bar t  →  next entry allowed on bar t + cooldown_bars + 1
```

With `cooldown_bars: 1`, a one-bar gap exists between exit and the earliest possible re-entry. This prevents immediately re-entering the same trade on noise. Setting to `0` allows same-bar re-entries (used only in stress tests).

---

### `execution` Section

Controls fill price assumptions and cost model.

```yaml
execution:
  mode: backtest
  entry_fill: close
  exit_fill: close
  commission: 1.0
  slippage_pct: 0.05
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `mode` | string | `"backtest"` | `"backtest"` / `"live"` | 🟡 MED — switches fill logic path in executor.py |
| `entry_fill` | string | `"close"` | `"close"` / `"next_open"` | 🔴 HIGH — determines entry price; `"close"` = signal bar close |
| `exit_fill` | string | `"close"` | `"close"` / `"stop_price"` / `"next_open"` | 🔴 HIGH — **in practice overridden by v0.6.7 gap-aware logic** |
| `commission` | float | `1.0` | `0.0 – 5.0` | 🟡 MED — dollars per side (charged ×2 per round-trip) |
| `slippage_pct` | float | `0.05` | `0.0 – 0.5` | 🟡 MED — applied as fraction of fill price |

**Fill logic override (important):**

The `exit_fill` config value is superseded by the v0.6.7 gap-aware fill logic in `simulator.py`. Regardless of the `exit_fill` setting, exits follow this decision tree:

```
if open[t] <= stop_price:        fill = open[t]         ← gap-down
elif low[t] <= stop_price:       fill = stop_price      ← intraday touch
elif close[t] < stop_price:      fill = close[t]        ← blow-through
```

This is the correct behaviour. The config field is preserved for experimental variants. See [Ref-Data-Backtest — fill_exit()](Ref-Data-Backtest.md#fill_exit) for full documentation.

---

### `live` Section

Controls live/paper trading connection and operational limits. These parameters are used by `live/broker.py`, `live/executor.py`, and `live/main.py`.

```yaml
live:
  mode: paper                  # paper | live
  ibkr_port: 7497              # 7497 paper / 7496 real
  ibkr_host: 127.0.0.1
  ibkr_client_id: 1
  signal_time: "15:00"         # ET
  interval_minutes: 60
  max_daily_loss_pct: 3.0
  fill_timeout_seconds: 30
  reconnect_attempts: 3
  reconnect_wait_seconds: 10
  market_open: "09:30"
  market_close: "16:00"
  symbol: TQQQ
  currency: USD
  exchange: SMART
  dry_run: true
  session_capital: 100000.0
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `mode` | string | `"paper"` | `"paper"` / `"live"` | 🔴 HIGH — controls TWS port enforcement in `_safety_check()` |
| `ibkr_port` | int | `7497` | `7497` (paper) / `7496` (live) | 🔴 HIGH — **must match mode** — enforced by `_safety_check()` |
| `ibkr_host` | string | `"127.0.0.1"` | IP address | 🟡 MED — localhost only for security |
| `ibkr_client_id` | int | `1` | `1 – 99` | 🟡 MED — TWS client slot; use different IDs for parallel connections |
| `signal_time` | string | `"15:00"` | `"HH:MM"` ET | 🔴 HIGH — time of day the daily signal is evaluated; fires at most once per day |
| `interval_minutes` | int | `60` | `15 – 60` | 🟡 MED — how often stop monitoring runs between signal evaluations |
| `max_daily_loss_pct` | float | `3.0` | `1.0 – 10.0` | 🔴 HIGH — auto-shutdown threshold; checked in `check_daily_loss_limit()` |
| `fill_timeout_seconds` | int | `30` | `10 – 120` | 🟡 MED — how long `wait_for_fill()` waits before handling as partial |
| `reconnect_attempts` | int | `3` | `1 – 10` | 🟡 MED — TWS reconnect retries before escalating to CRITICAL alert |
| `reconnect_wait_seconds` | int | `10` | `5 – 60` | 🟡 MED — pause between reconnect attempts |
| `market_open` | string | `"09:30"` | `"HH:MM"` ET | 🟡 MED — used by `market_is_open()` to guard order placement |
| `market_close` | string | `"16:00"` | `"HH:MM"` ET | 🟡 MED — used by `market_is_open()` |
| `symbol` | string | `"TQQQ"` | Any valid ticker | 🔴 HIGH — ticker used for all live orders |
| `currency` | string | `"USD"` | `"USD"` | 🟢 LOW — passed to IBKR contract definition |
| `exchange` | string | `"SMART"` | `"SMART"` | 🟢 LOW — IBKR smart routing |
| `dry_run` | bool | `true` | `true` / `false` | 🔴 HIGH — `true` = log signals only, no orders placed. **Must be explicitly set false for live trading** |
| `session_capital` | float | `100000.0` | `> 0` | 🔴 HIGH — allocated capital for circuit breaker and sizing reference |

**`_safety_check()` enforcement:**

```python
# live/broker.py — runs before EVERY order
if config.live.mode == "paper" and port != 7497:
    raise RuntimeError("Paper mode must use port 7497")
if config.live.mode == "live" and port != 7496:
    raise RuntimeError("Live mode must use port 7496")
```

This check cannot be bypassed. Misconfigured port = no orders. See [IB Gateway Integration](IB-Gateway-Integration.md) for port architecture.

---

### `backtest` Section

Sets the date range, initial capital, and circuit breaker for a single backtest run.

```yaml
backtest:
  date_from: "2019-01-01"
  date_to: "2024-12-31"
  window_label: full_2019_2024
  is_baseline: false
  initial_capital: 20000.0
  use_circuit_breaker: false
  max_dd_threshold: 30.0
  circuit_breaker_cooldown_days: 10
  apply_cash_return: false
  risk_free_rate: 0.03
```

| Parameter | Type | Default | Valid Values | Impact |
|-----------|------|---------|-------------|--------|
| `date_from` | string | `"2019-01-01"` | ISO date string | 🔴 HIGH — start of measurement window (warmup prepended separately) |
| `date_to` | string | `"2024-12-31"` | ISO date string | 🔴 HIGH — end of measurement window |
| `window_label` | string | `"full_2019_2024"` | Any string | 🟢 LOW — metadata label stored in DB; used in GUI display |
| `is_baseline` | bool | `false` | `true` / `false` | 🟡 MED — marks run as baseline in DB; affects verdict comparison |
| `initial_capital` | float | `20000.0` | `1000 – 1e9` | 🔴 HIGH — starting equity; all P&L calculated relative to this |
| `use_circuit_breaker` | bool | `false` | `true` / `false` | 🔴 HIGH — halts trading when drawdown exceeds `max_dd_threshold` |
| `max_dd_threshold` | float | `30.0` | `5.0 – 80.0` | 🔴 HIGH — drawdown % that triggers circuit breaker (from equity peak) |
| `circuit_breaker_cooldown_days` | int | `10` | `1 – 90` | 🟡 MED — calendar days of no-trading after CB fires |
| `apply_cash_return` | bool | `false` | `true` / `false` | 🟡 MED — enables idle cash interest component in CAGR (always true in recorder.py) |
| `risk_free_rate` | float | `0.03` | `0.0 – 0.10` | 🟡 MED — used in Sharpe ratio denominator |

**Circuit breaker detail:**

When `use_circuit_breaker: true` and `max_dd_threshold: 30.0`:
```
equity_peak updated each bar
current_dd = (equity_peak - equity_now) / equity_peak

if current_dd >= 0.30:
    freeze trading for circuit_breaker_cooldown_days calendar days
    no new entries during cooldown
    CB event logged to circuit_breaker_live table
```

Phase 2 finding: CB with threshold 30% fired during 2022 bear market in exp_008, but then **missed the 2023–2025 recovery** — resulting in worse 5-year CAGR than without CB. exp_018 uses CB because it was best overall, but exp_009 (no CB) achieved higher raw CAGR on rolling_5y.

**`initial_capital` note:**

Always set to `20000.0` for experiment comparisons. Changing this does not affect CAGR or Calmar (which are ratios) but does affect the dollar P&L numbers shown in the GUI.

---

## .env Parameters

The `.env` file is loaded by `live/config.py` at process startup. It controls **infrastructure**, not strategy logic. All live/ modules import from `live/config.py` — never `os.environ` directly.

```dotenv
ENV=dev
IB_PORT=4002
IB_CLIENT_ID=1
MACHINE_ID=dev-laptop
WORKING_DIR=E:/Trading/tqqq-dev
APP_PORT=5000
ALLOW_LIVE_PORT=false
DB_FILE=trading.db
LOCK_FILE=trading.lock
LOG_DIR=logs/
```

| Variable | Type | Default | Valid Values | Impact |
|----------|------|---------|-------------|--------|
| `ENV` | string | `"dev"` | `"dev"` / `"preprod"` / `"live"` | 🔴 HIGH — controls port enforcement rules |
| `IB_PORT` | int | `4002` | `4002` (paper) / `4001` (live) | 🔴 HIGH — IB Gateway port; validated against ENV |
| `IB_CLIENT_ID` | int | `1` | `1 – 99` | 🟡 MED — TWS client slot |
| `IB_HOST` | string | `"127.0.0.1"` | IP address | 🟡 MED — IB Gateway host |
| `MACHINE_ID` | string | `"unknown"` | Any string | 🟢 LOW — identifies machine in log output and DB events |
| `WORKING_DIR` | path | `cwd()` | Absolute path | 🟡 MED — all relative paths resolve from here |
| `APP_PORT` | int | `5000` | `1024 – 65535` | 🟢 LOW — Flask GUI server port |
| `ALLOW_LIVE_PORT` | bool | `"false"` | `"true"` / `"false"` | 🔴 HIGH — safety gate; must be `"true"` to connect to live port 4001 |
| `DB_FILE` | string | `"trading.db"` | Filename | 🟡 MED — SQLite database path (relative to WORKING_DIR) |
| `LOCK_FILE` | string | `"trading.lock"` | Filename | 🟡 MED — process lock file prevents duplicate live instances |
| `LOG_DIR` | string | `"logs/"` | Directory path | 🟢 LOW — where live_main.log and flask.log are written |

**ENV validation rules (enforced by `validate()` on startup):**

| ENV | Required IB_PORT | ALLOW_LIVE_PORT check |
|-----|-----------------|----------------------|
| `dev` | `4002` | `false` — live port blocked |
| `preprod` | `4002` | `false` — live port blocked |
| `live` | `4001` | `true` required |

```python
# live/config.py — validate() called at startup
if ENV == "live" and IB_PORT != 4001:
    raise RuntimeError("ENV=live must use IB_PORT=4001")
if ENV in ("dev", "preprod") and IB_PORT != 4002:
    raise RuntimeError(f"ENV={ENV} must use IB_PORT=4002")
if not ALLOW_LIVE_PORT and IB_PORT == 4001:
    raise RuntimeError("ALLOW_LIVE_PORT=false but IB_PORT=4001")
```

**Port number reference:**

| Port | Service | Used when |
|------|---------|----------|
| `4001` | IB Gateway — live account | ENV=live, ALLOW_LIVE_PORT=true |
| `4002` | IB Gateway — paper account | ENV=dev or preprod |
| `7496` | TWS — live account | Alternative to Gateway (legacy) |
| `7497` | TWS — paper account | Alternative to Gateway (legacy) |

The CLAUDE.md references ports 7496/7497 (TWS) while live/config.py uses 4001/4002 (IB Gateway). Both are correct for their respective connection types — Gateway is preferred for production.

---

## Computed / Derived Values

These are not config parameters but are derived from config at runtime:

| Derived Value | Formula | Source |
|--------------|---------|--------|
| `warmup_bars` | `max(vwap_period, ema_period, atr_period)` | `slice_window()` in loader.py |
| `ema_multiplier` | `2 / (ema_period + 1)` | `ema()` in indicators.py |
| `effective_stop` | `MAX(ratchet_stop, hard_stop)` long / `MIN(ratchet_stop, hard_stop)` short | `calc_ratchet_stop()` in risk.py |
| `idle_interest` | `equity × ((1 + cash_rate_annual)^(idle_days/365.25) - 1)` | `compute_all()` in metrics.py |
| `run_id` | `"run_{N:04d}"` (auto-increment) | `save_run()` in recorder.py |

---

## Parameter Interaction Map

```
symbols.atr_multiplier ──────────────────────────→ ratchet stop width
symbols.hard_stop_pct ───────────────────────────→ maximum loss floor
indicators.vwap_period ──────────────────────────→ warmup_bars  ──→ slice_window()
indicators.atr_period ───────────────────────────→ stop smoothness
risk.position_sizing_mode ────┬──────────────────→ shares per trade
risk.max_position_pct ────────┘
risk.use_volatility_sizing ──────────────────────→ shares × vol_ratio
risk.cash_rate_annual ───────────────────────────→ CAGR cash component
backtest.use_circuit_breaker ─┬──────────────────→ trade freeze
backtest.max_dd_threshold ────┘
live.dry_run ────────────────────────────────────→ order placement (true = blocked)
live.mode + ibkr_port ───────────────────────────→ _safety_check()
ENV + ALLOW_LIVE_PORT ───────────────────────────→ validate()
```

---

## Quick Reference: Experiment Configs vs Baseline

| Parameter | Baseline (B2) | exp_018 (best Calmar) | exp_009 (best CAGR) |
|-----------|-------------|---------------------|---------------------|
| `atr_multiplier` | 4.5 | **5.0** | 4.5 |
| `hard_stop_pct` | 0.08 | **0.11** | 0.10 |
| `use_volatility_sizing` | false | **true** | true |
| `use_circuit_breaker` | false | **true** | false |
| `max_dd_threshold` | — | 30.0 | — |
| `allow_short` | true | true | true |
| `position_sizing_mode` | full_capital | full_capital | full_capital |
| rolling_5y Calmar | 1.34 | **1.63** | 1.47 |
| rolling_5y CAGR | 40.8% | 45.8% | **45.9%** |

For full experiment comparison tables see [Experiment Results](Experiment-Results.md).

---

## Related Pages

- [YAML Config Guide](YAML-Config-Guide.md) — file hierarchy, experiment overlay, annotated example
- [Experiment Results](Experiment-Results.md) — impact of each parameter change on performance
- [Ref-Engine-Core](Ref-Engine-Core.md) — how parameters are consumed in indicators.py, signals.py, risk.py
- [Ref-Data-Backtest](Ref-Data-Backtest.md) — how parameters flow through runner.py and simulator.py
- [IB Gateway Integration](IB-Gateway-Integration.md) — live.* and .env port configuration
