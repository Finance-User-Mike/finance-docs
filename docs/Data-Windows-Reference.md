# Data Windows Reference

> **Audience:** Everyone — what windows exist, why they exist, and how to use them.
> **Related:** [Experiment-Results](Experiment-Results) · [Backtest-Engine](Backtest-Engine) · [Batch-Operations](Batch-Operations) · [Ref-Data-Backtest](Ref-Data-Backtest#slice_window)

---

## What Is a Data Window?

A data window is a named date range used for backtesting. Instead of "run the backtest from 2021-01-01 to 2026-01-01", you say "run on `rolling_5y`". The window registry in `trading.db` stores each window's dates, type, regime, and TQQQ return so results from every experiment are directly comparable.

**Why named windows matter:**
- Every experiment run is tagged with its `window_label`
- Dashboard Screen 2 shows a grid of all experiments × all windows
- Comparing `exp_018 rolling_5y` vs `exp_009 rolling_5y` is only valid because both use identical dates

---

## Window Types

| Type | Purpose | Example |
|------|---------|---------|
| `bear` | Sustained decline periods — stress tests | bear_period_5 (2022 bear) |
| `bull` | Sustained rally periods — upside capture | bull_period_5 (AI bull) |
| `full` | Multi-year complete cycles — broad validity | full_cycle_2 (2017–2026) |
| `rolling` | Fixed-length lookback windows — investor views | rolling_5y |
| `ml_train` | ML training dataset only — never use in backtest | train_full |

---

## The ML Train/Test Split — Permanent Rule

```
Training:  train_full    2010-02-11 → 2016-12-31  (~1,760 bars)
Backtest:  all others    2017-01-01 → 2026-03-16  (~2,320 bars)

Zero overlap. Zero data leakage. PERMANENT — never change.
```

**train_full data NEVER used in backtest experiments.**
**Backtest data NEVER used in ML training.**

Any ML feature trained on `train_full` is evaluated on the post-2017 windows. The model has never seen those bars during training — this is a true out-of-sample test.

---

## Warmup Rule — Permanent

**All strategy windows prepend 250 warmup bars** before `measure_from`.

```
reason:  VWAP(250) requires 250 bars to fully initialise
         EMA(10) and ATR(45) warm up faster, but 250 covers the worst case

warmup_bars = config.indicators.vwap_period = 250 (LOCKED)
```

B&H (baseline_bh) uses `warmup_bars=0` — it doesn't need indicator warmup.

The warmup bars run through the simulation loop but are **stripped from results** — equity_curve and trades are trimmed to the measurement period only. See [run_symbol() — warmup handling](Ref-Data-Backtest#run_symbol).

---

## All 18 Windows

### Bear Periods — Stress Test Windows

Bear windows test the strategy's ability to protect capital and profit from short positions during sustained downturns. These are the hardest windows. Any config with positive Calmar in a bear window is exceptional.

---

#### bear_period_3

| Field | Value |
|-------|-------|
| **window_id** | `bear_period_3` |
| **Type** | bear |
| **Label** | Fed Rate Hike Bear |
| **measure_from** | 2018-06-01 |
| **measure_to** | 2019-07-30 |
| **warmup_from** | 2017-06-01 (250 bars before) |
| **TQQQ return** | approx. -63% |
| **Regime** | bear |
| **Notes** | 2018 Fed rate tightening cycle |

**What happened:** The Fed raised rates 4 times in 2018. Tech stocks sold off hard from Oct 2018. TQQQ fell ~63% peak-to-trough.

**Strategy challenge:** Entering short positions timely during a choppy, multi-phase decline with multiple dead-cat bounces.

**exp_018 result:** CAGR -23.4%, Calmar -0.61 — strategy lost money (all tested configs lost on this window except exp_013 which lost less badly at -15.9% CAGR).

---

#### bear_period_4

| Field | Value |
|-------|-------|
| **window_id** | `bear_period_4` |
| **Type** | bear |
| **Label** | COVID Crash |
| **measure_from** | 2019-10-01 |
| **measure_to** | 2020-09-30 |
| **warmup_from** | 2018-10-01 |
| **TQQQ return** | approx. -83% (peak-to-trough) |
| **Regime** | bear |
| **Notes** | COVID crash Feb–Mar 2020, then full recovery |

**What happened:** TQQQ fell 83% in 6 weeks (Feb–Mar 2020) — the fastest crash in modern market history. Then recovered fully by Sep 2020.

**Strategy challenge:** The crash was so fast (6 weeks) that short trades needed immediate entry. The recovery was equally fast — short positions opened during the decline would get whipsawed by the recovery. This window has both a crash AND a strong recovery, making it particularly difficult.

**exp_018 result:** CAGR -19.8%, Calmar -0.56.

---

#### bear_period_5

| Field | Value |
|-------|-------|
| **window_id** | `bear_period_5` |
| **Type** | bear |
| **Label** | Rate Hike Bear 2022 |
| **measure_from** | 2021-07-01 |
| **measure_to** | 2023-07-30 |
| **warmup_from** | 2020-07-01 |
| **TQQQ return** | approx. -81% |
| **Regime** | bear |
| **Notes** | Fed QT + rate hike cycle 2022 |

**What happened:** 2022 was the worst year for TQQQ since 2008. The Fed raised rates 11 times and ran quantitative tightening. TQQQ fell 81%. The window includes the partial recovery in 2023.

**This is the hardest stress test in the registry.** Only exp_018 produced positive Calmar (1.83) on this window — all other configs lost money or barely broke even.

**exp_018 result:** CAGR 33.6%, Calmar 1.83, Trades=7 ← ONLY profitable config. This is why exp_018 was chosen as the live config.

---

#### bear_period_3_new, bear_period_4_new, bear_period_5_new

These are the **canonical updated versions** of the three bear periods added 2026-03-27. Same windows as their counterparts but with slightly adjusted dates to better capture the full bear+recovery cycle:

| ID | Label | measure_from | measure_to |
|----|-------|-------------|-----------|
| `bear_period_3_new` | Rate Hike 2018 | 2018-06-01 | 2019-07-30 |
| `bear_period_4_new` | Covid Crash 2020 | 2019-11-01 | 2020-07-30 |
| `bear_period_5_new` | Bear Market 2022 | 2021-11-01 | 2023-07-30 |

The `_new` variants are the preferred canonical bear windows for future experiments. The original `bear_period_3/4/5` are retained for backward comparison with existing DB runs.

---

### Bull Periods — Upside Capture Windows

Bull windows test whether the strategy keeps pace with TQQQ's strong bull runs. A strategy that misses bull runs is not worth running.

---

#### bull_period_1

| Field | Value |
|-------|-------|
| **window_id** | `bull_period_1` |
| **Type** | bull |
| **Label** | Post-Debt Recovery |
| **measure_from** | 2011-10-04 (approx — needs pre-2017 data) |
| **measure_to** | 2012-12-31 |
| **TQQQ return** | approx. +200% |
| **Data available** | Requires pre-2017 download |

**What happened:** Recovery from the 2011 US debt ceiling crisis. Strong tech bull run through end of 2012.

**Data note:** Pre-2017 TQQQ data requires running `download_yahoo("TQQQ", "2010-02-11", "2016-12-31")` and merging into `TQQQ_1d.csv`. See [Data-Management](Data-Management).

---

#### bull_period_2

| Field | Value |
|-------|-------|
| **window_id** | `bull_period_2` |
| **Type** | bull |
| **Label** | Long Bull Run |
| **measure_from** | 2016-02-11 (approx — needs pre-2017 data) |
| **measure_to** | 2018-09-30 |
| **TQQQ return** | approx. +350% |
| **Data available** | Requires pre-2017 download |

**What happened:** Sustained 2.5-year bull run following the 2015–16 China-induced correction. One of the cleanest trend periods in TQQQ history.

---

#### bull_period_3

| Field | Value |
|-------|-------|
| **window_id** | `bull_period_3` |
| **Type** | bull |
| **Label** | COVID Recovery |
| **measure_from** | 2020-03-23 |
| **measure_to** | 2020-12-31 |
| **TQQQ return** | approx. +348% |
| **Data available** | ✅ Yes (post-2017) |

**What happened:** TQQQ bottomed on March 23, 2020 and then recovered +348% through end of year. The fastest bull recovery in TQQQ history. The strategy must capture long entries at the start of this recovery.

---

#### bull_period_4

| Field | Value |
|-------|-------|
| **window_id** | `bull_period_4` |
| **Type** | bull |
| **Label** | Post-COVID Bull |
| **measure_from** | 2021-01-01 |
| **measure_to** | 2021-11-19 |
| **TQQQ return** | approx. +150% |
| **Data available** | ✅ Yes |

**What happened:** Strong momentum-driven bull run through Nov 2021 peak. Clean uptrend with few interruptions — ideal VWAP+EMA momentum conditions.

---

#### bull_period_5

| Field | Value |
|-------|-------|
| **window_id** | `bull_period_5` |
| **Type** | bull |
| **Label** | AI Recovery Bull |
| **measure_from** | 2023-01-01 |
| **measure_to** | 2026-03-16 |
| **TQQQ return** | approx. +300% |
| **Data available** | ✅ Yes |

**What happened:** AI-driven tech rally following the 2022 bear. Led by NVIDIA, Microsoft, and mega-cap tech. One of the strongest sustained bull periods in TQQQ history.

**Important:** This window is partially **out-of-sample** — it overlaps with the end of the backtest development period. Results here are closer to true forward performance than earlier windows.

---

### Full Cycle Windows — Primary Research Windows

Full cycle windows span multiple bear and bull periods. They test whether the strategy works across complete market cycles, not just in favourable regimes.

---

#### full_cycle_1

| Field | Value |
|-------|-------|
| **window_id** | `full_cycle_1` |
| **Type** | full |
| **Label** | Full TQQQ History |
| **measure_from** | 2010-02-11 |
| **measure_to** | 2026-03-16 |
| **warmup_from** | 2010-02-11 (start of TQQQ history) |
| **TQQQ return** | huge — TQQQ × 16y |
| **Data available** | Requires pre-2017 download for full window |

**What it tests:** Everything — all crashes, all bulls, 2008 recovery, COVID, 2022 bear, AI bull. The most comprehensive test. Results here have highest variance but most statistical power.

**Limitation:** full_cycle_1 overlaps with `train_full`. Any ML model trained on `train_full` must never be evaluated on `full_cycle_1` — only on `full_cycle_2` or rolling windows.

---

#### full_cycle_2

| Field | Value |
|-------|-------|
| **window_id** | `full_cycle_2` |
| **Type** | full |
| **Label** | Development Window |
| **measure_from** | 2017-01-01 |
| **measure_to** | 2026-03-16 |
| **warmup_from** | 2016-07-01 |
| **TQQQ return** | very large |
| **Data available** | ✅ Yes (all post-2017) |
| **Phase 2 Calmar target** | > 1.0 ❌ not yet achieved |

**The primary development window.** All Phase 2 experiments were evaluated primarily on this window alongside rolling_5y. Contains: 2018 correction, 2020 COVID crash and recovery, 2021 bull, 2022 bear, 2023–2026 AI bull. A complete market cycle.

**Why Calmar < 1.0 here is hard:** The 2022 bear (-81% TQQQ) dominates the drawdown calculation. Any strategy that holds positions through 2022 will have a large max_dd. Only very selective or hedged approaches can escape this.

---

### Rolling Windows — Investor-View Windows

Rolling windows show performance over fixed time periods ending "now" (2026-03-16). They answer: "how did this do over the last N years from the perspective of someone who invested N years ago?"

---

#### rolling_1y

| Field | Value |
|-------|-------|
| **window_id** | `rolling_1y` |
| **Label** | 1 Year Rolling |
| **measure_from** | 2025-03-16 |
| **measure_to** | 2026-03-16 |
| **Data available** | ✅ Yes |

**What it shows:** The most recent year. High variance — a single good or bad trade dominates. Not reliable for strategy selection, but important for monitoring live deployment.

---

#### rolling_3y

| Field | Value |
|-------|-------|
| **window_id** | `rolling_3y` |
| **Label** | 3 Year Rolling |
| **measure_from** | 2023-03-16 |
| **measure_to** | 2026-03-16 |
| **Data available** | ✅ Yes |

**What it shows:** The 2023–2026 AI bull run. Mostly favourable for longs. Calmar is typically high here because the period had strong uptrend with limited drawdown. Not a good stress test — use bear windows for that.

---

#### rolling_5y

| Field | Value |
|-------|-------|
| **window_id** | `rolling_5y` |
| **Label** | Mid-term 5 Years |
| **measure_from** | 2021-03-16 |
| **measure_to** | 2026-03-16 |
| **Data available** | ✅ Yes |
| **Phase 2 Calmar target** | > 1.0 ✅ ACHIEVED (exp_018: 1.63) |

**The primary evaluation window for Phase 2.** Contains both the 2022 bear AND the 2023–2026 bull — a complete mini-cycle. A strategy that does well here has proven it can navigate bear markets and still capture bull runs.

**Why this window matters:** 5 years is a realistic investor time horizon. Someone who invested in 2021 experienced the 2022 crash and recovery. If the strategy earned Calmar > 1.0 over this period, it added meaningful risk-adjusted value vs buy-and-hold.

---

#### rolling_10y

| Field | Value |
|-------|-------|
| **window_id** | `rolling_10y` |
| **Label** | 10 Year Rolling |
| **measure_from** | 2016-03-16 |
| **measure_to** | 2026-03-16 |
| **Data available** | ✅ Yes |

**What it shows:** 10-year investor view including 2018, 2020, 2022, and 2023–2026 bull. Contains multiple full market cycles. Results here converge towards the "long run" average behaviour of the strategy.

---

#### rolling_15y

| Field | Value |
|-------|-------|
| **window_id** | `rolling_15y` |
| **Label** | Near Full History |
| **measure_from** | 2011-03-16 |
| **measure_to** | 2026-03-16 |
| **Data available** | Requires pre-2017 download for full warmup |

**What it shows:** 15-year investor view — nearly the full TQQQ history from 2011 onwards.

---

### train_full — ML Training Dataset

| Field | Value |
|-------|-------|
| **window_id** | `train_full` |
| **Type** | ml_train |
| **Label** | ML Training Dataset |
| **measure_from** | 2010-02-11 |
| **measure_to** | 2016-12-31 |
| **Data available** | Requires pre-2017 download |

**⚠️ NEVER use for backtest evaluation. ONLY for ML training.**

This window contains pre-2017 TQQQ data — the time period before the main research window (`full_cycle_2` starts 2017). ML features trained on this period can be evaluated on any post-2017 window without look-ahead bias.

---

## Window Registry — DB Table

All 18 windows are stored in the `data_windows` table in `trading.db`.

```sql
SELECT window_id, label, measure_from, measure_to, regime, data_available
FROM data_windows
ORDER BY measure_from;
```

**Schema:**

| Column | Type | Description |
|--------|------|-------------|
| `window_id` | TEXT PK | Matches `window_label` in runs table |
| `window_type` | TEXT | bear / bull / full / rolling / ml_train |
| `label` | TEXT | Human-readable name |
| `symbol` | TEXT | TQQQ |
| `warmup_from` | TEXT | 250 bars before measure_from |
| `measure_from` | TEXT | Actual measurement start |
| `measure_to` | TEXT | Measurement end |
| `warmup_bars` | INTEGER | Always 250 (except B&H: 0) |
| `tqqq_return_pct` | REAL | Approximate TQQQ return over window |
| `regime` | TEXT | bear / bull / mixed |
| `data_available` | INTEGER | 1 if data exists, 0 if pre-2017 download needed |
| `notes` | TEXT | Context notes |

**Populate on fresh DB:**

```python
from backtest.recorder import init_db, populate_data_windows
conn = init_db("trading.db")
n = populate_data_windows(conn)
print(f"Inserted {n} windows")
conn.close()
```

---

## Window Quick-Reference Card

```
REGIME     WINDOW ID           DATES                NOTES
────────────────────────────────────────────────────────────────
BEAR       bear_period_3       2018-06-01→2019-07-30  Fed hike
           bear_period_4       2019-10-01→2020-09-30  COVID
           bear_period_5       2021-07-01→2023-07-30  Rate hike 2022 ← KEY
           bear_period_3_new   2018-06-01→2019-07-30  canonical
           bear_period_4_new   2019-11-01→2020-07-30  canonical
           bear_period_5_new   2021-11-01→2023-07-30  canonical

BULL       bull_period_3       2020-03-23→2020-12-31  COVID recovery +348%
           bull_period_4       2021-01-01→2021-11-19  Post-COVID +150%
           bull_period_5       2023-01-01→2026-03-16  AI bull +300%

FULL       full_cycle_2        2017-01-01→2026-03-16  PRIMARY ← Phase 2 target
           full_cycle_1        2010-02-11→2026-03-16  All history (pre-2017 needed)

ROLLING    rolling_1y          2025-03-16→2026-03-16  Recent performance
           rolling_3y          2023-03-16→2026-03-16  AI bull period
           rolling_5y          2021-03-16→2026-03-16  BEAR+BULL ← Phase 2 target
           rolling_10y         2016-03-16→2026-03-16  Multi-cycle
           rolling_15y         2011-03-16→2026-03-16  Near full history

ML ONLY    train_full          2010-02-11→2016-12-31  ⚠️ NEVER backtest
```

---

## Which Windows to Use When

**Quick experiment validation:**
```
python scripts/run_all_windows.py --experiment exp_XXX --window-id rolling_5y full_cycle_2
```
These two windows together give a complete picture: rolling_5y (bear+bull) and full_cycle_2 (full development window).

**Full Phase 2 evaluation:**
```
python scripts/run_all_windows.py --experiment exp_XXX --windows all
```
Runs all 13 non-ML windows. Takes ~20 minutes.

**Bear stress test only:**
```
python scripts/run_all_windows.py --experiment exp_XXX --windows standard
```
Runs the 6 bear windows only.

**Reproducing a specific result:**
Find the `window_label` in the DB run, then set `date_from`/`date_to` in config.yaml to match the window's `measure_from`/`measure_to`.

---

## Data Availability Map

```
2010   2011   2012   2013   2014   2015   2016   2017   2018 → 2026
  ├──── train_full ──────────────────────┤
  │                                      ├───── full_cycle_2 ──────────────┤
  ├────────────────── full_cycle_1 ───────────────────────────────────────┤
                             ├── rolling_15y ────────────────────────────┤
                                          ├── rolling_10y ───────────────┤
                                                   ├── rolling_5y ───────┤
                                                            ├── rolling_3y┤
                                                                    ├─ 1y ┤

Bear and bull sub-periods are sub-ranges within full_cycle_2 (post-2017).
Pre-2017 windows (full_cycle_1, rolling_15y, train_full) need download_yahoo().
```

**Pre-2017 data download (run once):**

```python
from data.loader import download_yahoo
# Download full TQQQ history from inception
path = download_yahoo("TQQQ", "2010-02-11", "2016-12-31", output_dir="02-Common/data")
# Then merge with existing TQQQ_1d.csv — see Data-Management
```

---

*Back to [Home](Home) · [Experiment-Results](Experiment-Results) · [Backtest-Engine](Backtest-Engine) · [Batch-Operations](Batch-Operations)*
