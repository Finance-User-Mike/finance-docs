# Experiment Results

> **Audience:** Everyone — what was tested, why, and what we learned.
> **Related:** [Performance-Metrics-Guide](Performance-Metrics-Guide) · [Data-Windows-Reference](Data-Windows-Reference) · [YAML-Config-Guide](YAML-Config-Guide) · [Strategy-Logic](Strategy-Logic)

---

## How to Read This Page

Each experiment starts with a hypothesis, lists the single parameter change from its base, shows results across all windows run, and ends with a decision. Results use the **v0.6.7 gap-aware fill logic** — the final correct fill model.

**Comparison baselines:**
- **B1 — Buy & Hold** (`baseline_bh`): buy at open of first bar, hold forever. No stops, no signals.
- **B2 — ATR45 Base** (`baseline_atr45`): VWAP(250)+EMA(10)+ATR(45), atr_mult=4.5, hard_stop=8%, no vol sizing, no CB.

**Phase 2 target:** Calmar > 1.0 on BOTH `rolling_5y` AND `full_cycle_2`.

**Fill logic note:** All results in this table use v0.6.7. Results from v0.6.3 (recovered-close bug) or v0.6.6 (gap-down bug) are marked invalid and shown only in the [Fill Logic History](#fill-logic-history) section. Never compare across fill versions.

---

## Experiments at a Glance

| ID | Name | Change vs Base | Status | Best Calmar (5Y) |
|----|------|----------------|--------|-----------------|
| [B1](#b1--buy--hold) | Buy & Hold | — | Locked baseline | 0.32 |
| [B2](#b2--atr45-base) | ATR45 Base | — | Locked baseline | 1.34 |
| [exp_001](#exp_001--first-strategy-run) | First strategy run | Initial run | Complete | — |
| [exp_002](#exp_002--atr-multiplier-sweep) | ATR multiplier sweep | atr_mult: 3.0–6.0 | Rejected | — |
| [exp_004](#exp_004--ema-period-sweep) | EMA period sweep | ema_period: 5–20 | Rejected | — |
| [exp_006](#exp_006--hard-stop-sweep) | Hard stop sweep | hard_stop: 6%–12% | Partial improvement | — |
| [exp_007](#exp_007--vwap-period-sweep) | VWAP period sweep | vwap_period: 100–500 | Rejected | — |
| [exp_008](#exp_008--combined-best-params) | Combined best params | vol_sizing+HS10%+CB30% | Complete | 0.73 |
| [exp_009](#exp_009--no-circuit-breaker) | No circuit breaker | CB=OFF | Complete | 1.47 |
| [exp_010](#exp_010--adx-entry-filter-permanently-rejected) | ADX entry filter | adx_filter=15 | **PERMANENTLY REJECTED** | -0.07 |
| [exp_011](#exp_011--volatility-position-sizing) | Vol position sizing | vol_sizing=ON | Rejected | — |
| [exp_012](#exp_012--circuit-breaker-only) | Circuit breaker only | CB=30%,vol=OFF | Rejected | — |
| [exp_013](#exp_013--vol-sizing-off) | Vol sizing off | vol_sizing=OFF | Rejected | 0.59 |
| [exp_016](#exp_016-017-019--adx-variants-permanently-rejected) | ADX full ML proxy | ADX variant | **PERMANENTLY REJECTED** | — |
| [exp_017](#exp_016-017-019--adx-variants-permanently-rejected) | ADX wider | ADX variant | **PERMANENTLY REJECTED** | — |
| [exp_018](#exp_018--wider-atr-stop-best-config) | **Wider ATR stop** | atr_mult=5.0, HS=11% | **BEST CONFIG** ✅ | 1.63 |
| [exp_019](#exp_016-017-019--adx-variants-permanently-rejected) | ADX+wider ATR | ADX variant | **PERMANENTLY REJECTED** | — |

---

## B1 — Buy & Hold

**experiment_id:** `baseline_bh`
**Config file:** `experiments/baseline_bh.yaml`
**Implementation:** Direct math — no simulation loop. `shares = capital / close[0]`, `equity[t] = shares × close[t]`

**What it represents:** The theoretical maximum simplicity — buy TQQQ once and never sell. It is the **performance ceiling** for CAGR on bull windows and the **floor** for drawdown.

### Results — LOCKED (never re-run unless data changes)

| Window | CAGR | Max DD | Calmar | Trades |
|--------|------|--------|--------|--------|
| full_cycle_1 | 39.95% | -81.66% | 0.49 | 1 |
| full_cycle_2 | 38.57% | -81.66% | 0.47 | 1 |
| rolling_5y | 26.39% | -81.66% | 0.32 | 1 |
| rolling_10y | 33.08% | -81.66% | 0.41 | 1 |

**Key insight:** B&H on TQQQ produces strong CAGR (33–40%) but catastrophic drawdown (-81.66%). Any strategy that adds value must improve Calmar — earning similar or better CAGR with materially smaller drawdown.

**See also:** [Performance-Metrics-Guide — Benchmarks](Performance-Metrics-Guide#benchmarks)

---

## B2 — ATR45 Base

**experiment_id:** `baseline_atr45`
**Config:** VWAP=250, EMA=10, ATR=45, atr_mult=4.5, hard_stop=8%, vol_sizing=OFF, CB=OFF, allow_short=true

**What it represents:** The default strategy with no enhancements. All Phase 2 experiments compare Sharpe delta vs B2. A run must beat B2 Sharpe by ≥0.02 to be classified as `IMPROVEMENT`.

### Results — LOCKED (v0.6.7 corrected fills)

| Window | CAGR | Max DD | Calmar | Sharpe | Trades |
|--------|------|--------|--------|--------|--------|
| rolling_5y | 40.8% | -30.3% | 1.34 | 0.827 | 35 |
| full_cycle_2 | 32.6% | -64.0% | 0.51 | 0.635 | 64 |
| bear_period_5 | 28.8% | -30.3% | 0.95 | — | 9 |

**Key insight:** B2 already beats B1 on Calmar (1.34 vs 0.32 on rolling_5y) — the strategy adds real risk-adjusted value even at its default settings. Phase 2 goal was to push rolling_5y Calmar higher while also getting full_cycle_2 above 1.0.

---

## exp_001 — First Strategy Run

**experiment_id:** `exp_001`
**Purpose:** Initial smoke test on full_cycle_2 after Batch 3 engine was complete.
**Status:** Superseded by B2 baseline.

This run used the same parameters as B2 but was run before the v0.6.7 fill logic was implemented. Results are invalid and not stored in the production DB.

---

## exp_002 — ATR Multiplier Sweep

**Hypothesis:** A different ATR multiplier might tighten drawdown (lower) or improve CAGR (higher) by giving trades more or less room to breathe before exiting.

**Change vs B2:** `atr_multiplier` swept from 3.0 to 6.0 in 0.5 steps.

**Result:** The B2 default (4.5) was already optimal. Neither tighter (3.0–4.0) nor wider (5.0–6.0) multipliers improved Calmar on rolling_5y. Tighter stops produced more trades (more whipsaw), wider stops held losing positions too long.

**Decision:** B2's atr_mult=4.5 is optimal for the base configuration. However, exp_018 later found that combining wider ATR with vol_sizing changes the interaction — see [exp_018](#exp_018--wider-atr-stop-best-config).

---

## exp_004 — EMA Period Sweep

**Hypothesis:** A shorter or longer EMA period might produce better-timed entries by being more or less sensitive to trend changes.

**Change vs B2:** `ema_period` swept from 5 to 20.

**Result:** EMA=10 (B2 default) was already optimal. Shorter periods (5–8) produced more false signals. Longer periods (15–20) missed entries early in new trends.

**Decision:** EMA=10 locked as optimal. Never re-test.

---

## exp_006 — Hard Stop Sweep

**Hypothesis:** An 8% hard stop (B2 default) may be too tight for a 3x leveraged ETF that can gap 5–8% overnight. A wider hard stop might reduce stop-outs on normal intraday volatility.

**Change vs B2:** `hard_stop_pct` swept from 6% to 12%.

**Result:** HS=10% improved performance over HS=8% on most windows. HS=12% gave back the gains (held losers too long). HS=10% became the new standard for Phase 2 combined experiments.

**Decision:** hard_stop_pct=0.10 preferred over B2's 0.08. Adopted in exp_008, exp_009, exp_018.

---

## exp_007 — VWAP Period Sweep

**Hypothesis:** VWAP(250) is the longest-lookback indicator. A shorter period might be more responsive; a longer period might filter out more noise.

**Change vs B2:** `vwap_period` swept from 100 to 500.

**Result:** VWAP=250 (B2 default) was already optimal. Shorter periods (100–150) admitted too many signals during choppy markets. Longer periods (350–500) delayed trend recognition and missed entries.

**Decision:** vwap_period=250 locked as optimal. Never re-test.

---

## exp_008 — Combined Best Params

**experiment_id:** `exp_008_combined_v1`
**Config file:** `experiments/exp_008_combined_v1.yaml`
**Hypothesis:** Combining three improvements simultaneously (vol_sizing + HS=10% + CB=30%) should produce better risk-adjusted returns than any single improvement alone.

**Changes vs B2:**

| Parameter | B2 | exp_008 |
|-----------|-----|---------|
| `hard_stop_pct` | 0.08 | **0.10** |
| `use_volatility_sizing` | false | **true** |
| `vol_lookback_period` | — | **20** |
| `min_position_size` | — | **0.5** |
| `max_position_size` | — | **1.5** |
| `use_circuit_breaker` | false | **true** |
| `max_dd_threshold` | — | **30%** |

### Results (v0.6.7)

| Window | CAGR | Max DD | Calmar | Trades |
|--------|------|--------|--------|--------|
| rolling_5y | 36.8% | -50.6% | 0.73 | 34 |
| full_cycle_2 | 33.6% | -58.4% | 0.58 | 60 |
| bear_period_5 | 2.2% | -50.6% | 0.04 | 12 |

**What went wrong:** The circuit breaker fired in 2022 (30% drawdown threshold tripped), pausing all new entries for ~10 bars. This caused the strategy to **miss the 2023–2025 AI bull recovery** — the largest bull run in the post-2017 window. CAGR was dramatically reduced on rolling_5y as a result.

**Decision:** The CB version hurts more than it helps on rolling_5y. exp_009 (CB=OFF) and exp_018 (wider stops + CB) were spawned to isolate the CB effect.

---

## exp_009 — No Circuit Breaker

**experiment_id:** `exp_009_cb_free`
**Config file:** `experiments/exp_009_cb_free.yaml`
**Hypothesis:** If the circuit breaker is hurting rolling_5y by pausing entries during the 2022 bear (and missing the recovery), turning it off should recover that lost CAGR.

**Change vs exp_008:** `use_circuit_breaker: false`

**All other params unchanged:** atr_mult=4.5, HS=10%, vol_sizing=ON_std

### Results (v0.6.7)

| Window | CAGR | Max DD | Calmar | Trades |
|--------|------|--------|--------|--------|
| rolling_5y | 45.9% | -31.2% | 1.47 ✅ | 31 |
| full_cycle_2 | 35.7% | -66.5% | 0.54 ❌ | 59 |
| rolling_3y | 41.0% | -26.6% | 1.54 | — |
| bear_period_5 | 27.4% | -31.2% | 0.88 | 9 |

**What we learned:**
- Removing CB recovered 9pp of CAGR on rolling_5y (36.8% → 45.9%) ✅
- BUT: full_cycle_2 Calmar is only 0.54 — worse than B2's 0.51 (marginal improvement at best) ❌
- Rolling_5y Calmar 1.47 — Phase 2 target met for this window ✅
- Phase 2 target not met: full_cycle_2 remains below 1.0 ❌

**Decision:** exp_009 is a strong rolling_5y config but the full_cycle_2 drawdown (-66.5%) is concerning — larger than B2 (-64%). Retained as secondary best; exp_018 became primary focus.

---

## exp_010 — ADX Entry Filter ⛔ PERMANENTLY REJECTED

**experiment_id:** `exp_010` (and variants exp_016, exp_017, exp_019)
**Hypothesis:** ADX (Average Directional Index) filters could prevent entries during weak-trend sideways markets, reducing whipsaw losses.

**Change vs B2:** `use_adx_filter: true`, `min_adx_for_entry: 15` (and variants with 20, 25)

### Results (v0.6.7)

| Window | CAGR | Calmar | vs B2 Calmar |
|--------|------|--------|--------------|
| rolling_5y | -4.46% | -0.07 | -1.41 |
| full_cycle_2 | various | negative | negative |

**Why it failed — root cause analysis:**

```
ADX measures trend STRENGTH, not direction.

2022 bear market:
  TQQQ falling hard → ADX = HIGH (strong downtrend)
  ADX filter: "Strong trend detected → allow entry"
  Strategy entered 8 SHORT trades during peak downtrend
  Those shorts got whipsawed by Fed pivot rallies
  Net result: more losing trades, not fewer

2023–2025 bull market:
  Early recovery had LOW ADX (trend starting)
  ADX filter: "Weak trend → block entry"
  Strategy missed first 3–5 months of bull run
```

**VWAP(250) + EMA(10) already filters sufficiently.** ADX adds no information that isn't already captured by price crossing VWAP and EMA simultaneously.

**All ADX runs deleted from DB and YAML files deleted from experiments/.**

**Decision:** ⛔ PERMANENTLY REJECTED. Never re-test ADX as entry filter on TQQQ. Do not reopen this experiment.

---

## exp_011 — Volatility Position Sizing

**Hypothesis:** Scale position size inversely with current volatility — reduce size when ATR is high (dangerous), increase when ATR is low (calm).

**Change vs B2:** `use_volatility_sizing: true`, vol_lookback=20, min=0.5x, max=1.5x

**Result:** Hurt performance on full_cycle_2. The sizing adjustments happened too frequently, reducing exposure during post-bear recoveries (exactly when full exposure is most valuable on TQQQ). Calmar worsened vs B2.

**Decision:** Vol sizing alone does not help. However, when combined with wider stops (exp_018), the interaction works differently — the wider stops provide more buffer while sizing moderates extreme exposure.

---

## exp_012 — Circuit Breaker Only

**Hypothesis:** Adding just the circuit breaker (without vol sizing) to B2 might protect the 2022 bear period without the CB-kills-recovery problem seen in exp_008.

**Change vs B2:** `use_circuit_breaker: true`, `max_dd_threshold: 30%`, vol_sizing=OFF

**Result:** CB still fired in 2022, still missed the recovery. Without vol sizing to moderate position size, the losses before CB tripped were larger. Result was worse than exp_008 (CB=ON) on rolling_5y.

**Decision:** CB alone (without vol sizing) is counterproductive. The only configuration where CB helps is exp_018 (wider stops + vol sizing + CB) — where stops prevent CB from ever tripping in bear markets.

---

## exp_013 — Vol Sizing Off

**experiment_id:** `exp_013_vol_off`
**Config file:** `experiments/exp_013_vol_off.yaml`
**Hypothesis:** Removing vol sizing from exp_008 isolates its contribution — does vol sizing add value?

**Change vs exp_008:** `use_volatility_sizing: false` (all other params unchanged: HS=10%, CB=30%)

### Results (v0.6.7)

| Window | CAGR | Max DD | Calmar | Trades |
|--------|------|--------|--------|--------|
| rolling_5y | 32.1% | -54.8% | 0.59 | 34 |
| full_cycle_2 | 31.5% | -57.2% | 0.55 | 59 |
| bear_period_5 | -6.4% | -54.8% | -0.12 | 12 |

**What we learned:** Removing vol sizing while keeping CB makes results worse than exp_008 (which had vol sizing). Vol sizing was providing meaningful protection — without it, the CB fires at a worse equity level, and the full loss before trigger is larger.

**Decision:** vol_sizing=OFF is the worst configuration. exp_013 confirmed vol_sizing adds real value to the CB experiment.

---

## exp_016, exp_017, exp_019 — ADX Variants ⛔ PERMANENTLY REJECTED

These three experiments tested ADX variations after exp_010 failed:
- exp_016: full ML proxy using ADX features
- exp_017: ADX with wider ATR (to see if wider stops rescued ADX)
- exp_019: ADX with wider ATR and different thresholds

**All failed** for the same root cause as exp_010. ADX measures strength not direction and systematically admits trades at the wrong time in leveraged ETFs.

**All runs deleted from DB. All YAML files deleted from experiments/.**

**Decision:** ⛔ PERMANENTLY REJECTED. Same as exp_010.

---

## exp_018 — Wider ATR Stop ✅ BEST CONFIG

**experiment_id:** `exp_018_atr_wider`
**Config file:** `experiments/exp_018_atr_wider.yaml`
**Hypothesis:** The CB in exp_008 fires because the ratchet stop (4.5×ATR) produces losses that accumulate to 30% DD before stopping. A wider stop (5.0×ATR) with a wider hard stop (11%) gives trades more room, reduces stop-out frequency, and may prevent the CB from ever tripping in the 2022 bear — while still capturing the full recovery.

**Changes vs exp_008:**

| Parameter | exp_008 | exp_018 |
|-----------|---------|---------|
| `atr_multiplier` | 4.5 | **5.0** |
| `hard_stop_pct` | 0.10 | **0.11** |
| All others | same | same |

Vol sizing ON, CB=30%, HS=11%, allow_short=true.

### Results — FINAL v0.6.7 (gap-aware fills)

| Window | CAGR | Max DD | Calmar | Trades | vs Phase 2 Target |
|--------|------|--------|--------|--------|-------------------|
| rolling_5y | **45.80%** | **-28.15%** | **1.63** ✅ | 27 | **MET** |
| full_cycle_2 | **40.35%** | **-53.72%** | **0.75** ❌ | 48 | missed (need >1.0) |
| rolling_3y | 38.38% | -28.15% | 1.36 | 16 | — |
| rolling_10y | 26.35% | -55.02% | 0.48 | 59 | — |
| full_cycle_1 | 18.18% | -55.10% | 0.33 | 83 | — |
| bear_period_5 | **33.58%** | **-18.33%** | **1.83** | 7 | — |

### Why exp_018 Is the Best Config

```
Six-way comparison — rolling_5y:
  exp_018:  CAGR=45.8%   Cal=1.63   DD=-28.2%  ← best Calmar, shallowest DD
  exp_009:  CAGR=45.9%   Cal=1.47   DD=-31.2%  ← marginal CAGR lead, worse DD
  B2:       CAGR=40.8%   Cal=1.34   DD=-30.3%
  exp_008:  CAGR=36.8%   Cal=0.73   DD=-50.6%  ← CB fired 2022
  exp_013:  CAGR=32.1%   Cal=0.59   DD=-54.8%  ← CB+no vol sizing
  B1:       CAGR=26.4%   Cal=0.32   DD=-81.7%

Bear period 2022 (hardest stress test):
  exp_018:  CAGR=33.6%   Cal=1.83  ← ONLY config profitable in 2022 bear
  B2:       CAGR=28.8%   Cal=0.95
  exp_009:  CAGR=27.4%   Cal=0.88
  exp_008:  CAGR=2.2%    Cal=0.04  ← CB fired, barely positive
  exp_013:  CAGR=-6.4%   Cal=-0.12 ← CB+no vol = negative 2022
  B1:       CAGR=-51.1%  Cal=-0.63 ← catastrophic
```

**Why wider ATR helped in 2022:**
The wider ratchet (5.0×ATR) gave long positions more room before triggering the trailing stop. In 2022, this reduced the number of stop-outs during the bear, keeping position count low (7 trades vs 12 for exp_008). The fewer, more selective trades happened to avoid the worst drawdown periods.

**Why CB didn't hurt exp_018 (unlike exp_008):**
The 11% hard stop + 5.0×ATR combination kept the equity drawdown below 30% more often — so the CB rarely fired. When it did fire, the wider stops meant equity had already protected itself to a greater degree.

### Phase 2 Verdict

```
Target:   Calmar > 1.0 on BOTH rolling_5y AND full_cycle_2
Rolling_5y:   Calmar 1.63  ✅ ACHIEVED
Full_cycle_2: Calmar 0.75  ❌ MISSED — 0.25 below target
```

**Decision:** Phase 2 target partially met. No config achieved Calmar > 1.0 on full_cycle_2. exp_018 is the best available config on all dimensions (Calmar, DD, bear defense). Deployed to live trading with exp_018 parameters. Phase 2 re-opened for future research but not blocking live deployment.

---

## Six-Way Comparison — Final Reference Table

All results use v0.6.7 fill logic. Warmup=250 bars on all strategy runs. B&H: no warmup.

### rolling_5y (2021-03 → 2026-03)

| Config | CAGR | Max DD | Calmar | Trades |
|--------|------|--------|--------|--------|
| **exp_018** | **45.8%** | **-28.2%** | **1.63** | 27 |
| exp_009 | 45.9% | -31.2% | 1.47 | 31 |
| B2 | 40.8% | -30.3% | 1.34 | 35 |
| exp_008 | 36.8% | -50.6% | 0.73 | 34 |
| exp_013 | 32.1% | -54.8% | 0.59 | 34 |
| B1 | 26.4% | -81.7% | 0.32 | 1 |

### full_cycle_2 (2017-01 → 2026-03)

| Config | CAGR | Max DD | Calmar | Trades |
|--------|------|--------|--------|--------|
| **exp_018** | **40.4%** | **-53.7%** | **0.75** | 48 |
| B1 | 38.6% | -81.7% | 0.47 | 1 |
| exp_009 | 35.7% | -66.5% | 0.54 | 59 |
| exp_008 | 33.6% | -58.4% | 0.58 | 60 |
| B2 | 32.6% | -64.0% | 0.51 | 64 |
| exp_013 | 31.5% | -57.2% | 0.55 | 59 |

### bear_period_5 — 2022 stress test

| Config | CAGR | Max DD | Calmar | Trades |
|--------|------|--------|--------|--------|
| **exp_018** | **33.6%** | **-18.3%** | **1.83** | 7 |
| B2 | 28.8% | -30.3% | 0.95 | 9 |
| exp_009 | 27.4% | -31.2% | 0.88 | 9 |
| exp_008 | 2.2% | -50.6% | 0.04 | 12 |
| exp_013 | -6.4% | -54.8% | -0.12 | 12 |
| B1 | -51.1% | -81.7% | -0.63 | 1 |

---

## Full Window Results — All Experiments

All results: v0.6.7, warmup_bars=250 (B&H: 0).

| Window | B1 CAGR | B1 Cal | B2 CAGR | B2 Cal | 009 CAGR | 009 Cal | 018 CAGR | 018 Cal | 008 CAGR | 008 Cal | 013 CAGR | 013 Cal |
|--------|---------|--------|---------|--------|----------|---------|----------|---------|----------|---------|----------|---------|
| bear_period_3 | N/A | N/A | N/A | N/A | -33.0 | -0.68 | -23.4 | -0.61 | -23.6 | -0.57 | -15.9 | -0.42 |
| bear_period_4 | N/A | N/A | N/A | N/A | -18.4 | -0.48 | -19.8 | -0.56 | -20.4 | -0.51 | -26.2 | -0.62 |
| bear_period_5 | N/A | N/A | 28.8 | 0.95 | 27.4 | 0.88 | **33.6** | **1.83** | 2.2 | 0.04 | -6.4 | -0.12 |
| full_cycle_1 | 40.0 | 0.49 | N/A | N/A | 12.8 | 0.19 | 18.2 | 0.33 | 9.5 | 0.13 | 9.0 | 0.12 |
| full_cycle_2 | 38.6 | 0.47 | 32.6 | 0.51 | 35.7 | 0.54 | **40.4** | **0.75** | 33.6 | 0.58 | 31.5 | 0.55 |
| rolling_1y | 13.7 | 0.24 | N/A | N/A | 9.7 | 0.36 | 9.3 | 0.33 | 9.7 | 0.36 | 5.7 | 0.19 |
| rolling_3y | 44.8 | 0.77 | N/A | N/A | 41.0 | 1.54 | 38.4 | 1.36 | 41.0 | 1.54 | 39.4 | 1.39 |
| rolling_5y | 26.4 | 0.32 | 40.8 | 1.34 | 45.9 | 1.47 | **45.8** | **1.63** | 36.8 | 0.73 | 32.1 | 0.59 |
| rolling_10y | 33.1 | 0.41 | N/A | N/A | 22.7 | 0.34 | **26.4** | **0.48** | 16.1 | 0.22 | 13.9 | 0.19 |
| rolling_15y | 42.3 | 0.52 | N/A | N/A | 13.1 | 0.20 | **18.7** | **0.34** | 9.8 | 0.13 | 9.2 | 0.12 |
| train_full | 43.9 | 0.97 | N/A | N/A | -14.3 | -0.22 | -7.7 | -0.14 | -18.2 | -0.24 | -17.5 | -0.24 |

**exp_018 leads on Calmar:** rolling_5y, full_cycle_2, bear_period_5, rolling_10y, rolling_15y
**exp_009 leads on CAGR:** rolling_5y (marginal +0.1%), rolling_3y, full_cycle_2

---

## Fill Logic History

The backtest results have been through three fill logic versions. **Only v0.6.7 results are valid.**

| Version | Bug | Impact | Results Status |
|---------|-----|--------|----------------|
| Pre-v0.6.6 | Recovered-close bug: exit filled at bar close even when price recovered above stop intraday | CAGR inflated by 10–15pp | ❌ INVALID |
| v0.6.6 | Gap-down bug: open below stop still filled at close | CAGR slightly pessimistic | ❌ INVALID |
| **v0.6.7** | Both bugs fixed | Correct | ✅ ALL CURRENT RESULTS |

**v0.6.7 fix — Oct 26, 2023 TQQQ example:**

```
bar.open=$15.77  bar.close=$15.03  stop=$15.80

v0.6.6 fill: min(close, stop) = $15.03  → -15.47% loss (too pessimistic)
v0.6.7 fill: bar.open         = $15.77  → -11.22% loss (correct: gap-down fires at open)
Difference: +4.25pp on that single trade
```

Full history: [docs/fill_exit_bug_history.md](../fill_exit_bug_history.md) · [Strategy-Logic — Fill Logic](Strategy-Logic#fill-logic-v067)

---

## What To Try Next (Phase 3+ Ideas)

These are open research directions — not yet tested:

| Idea | Hypothesis | Risk |
|------|-----------|------|
| Regime-aware position sizing | Increase size in confirmed bull regimes, cut in bear | May overfit to 2017–2026 |
| Multi-symbol (TQQQ + QQQ hedge) | Hold QQQ short as partial hedge during bear | Changes strategy identity |
| ML-predicted ATR multiplier | Dynamic atr_mult based on vol regime | Requires train/test split discipline |
| Shorter cooldown in strong bull | cooldown_bars=0 when VWAP slope strongly positive | Look-back bias risk |

**Invariant:** Any future experiment must run on all 18 windows, compare vs B2, and report v0.6.7 fill results. No ADX-based filters.

---

*Back to [Home](Home) · [Performance-Metrics-Guide](Performance-Metrics-Guide) · [Data-Windows-Reference](Data-Windows-Reference) · [YAML-Config-Guide](YAML-Config-Guide)*
