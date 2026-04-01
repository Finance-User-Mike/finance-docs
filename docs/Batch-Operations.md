# Batch Operations

> **Audience:** Developers / researchers — how to run experiments, sweep parameters, and manage bulk backtest operations.
> **Related:** [Backtest-Engine](Backtest-Engine) · [Data-Windows-Reference](Data-Windows-Reference) · [Experiment-Results](Experiment-Results) · [YAML-Config-Guide](YAML-Config-Guide)

---

## Overview

The system has two tiers of backtest runners:

| Script | Purpose | When to use |
|--------|---------|-------------|
| `backtest/run.py` | Single run — one experiment, one window | Developing or debugging a single config |
| `scripts/run_all_windows.py` | One experiment × multiple windows | Full window evaluation after config is finalised |
| `scripts/run_phase2.py` | Parameter sweep × multiple windows | Systematic Phase 2 parameter exploration |
| `scripts/rerun_all_with_warmup.py` | Re-run all existing DB runs with corrected logic | One-time fix after engine changes |
| `scripts/backfill_equity_curves.py` | Backfill missing equity_curve column in old runs | DB migration for old run records |

**Working directory:** All scripts must be run from `01-Backtest/` as the working directory.

```bash
cd E:\Trading\tqqq-dev\01-Backtest
python backtest/run.py --config experiments/exp_018_atr_wider.yaml
```

---

## backtest/run.py — Single Run CLI

The main CLI entry point for running a single backtest or querying the DB.

### Safety Gate

**Every backtest run goes through `run_tests_first()` first.** This runs `pytest tests/unit/ -q --tb=short` and aborts if any test fails. You cannot run a backtest on broken code.

```
Tests: all green          ← you will see this before every run
Running backtest for ['TQQQ'] ...
```

If tests fail, the error is printed and the process exits with code 1. Fix the tests before running.

### Backtest Mode

```bash
# Run a single experiment on the window defined in the config file
python backtest/run.py --config experiments/exp_018_atr_wider.yaml --experiment exp_018_atr_wider

# With notes attached to the run record
python backtest/run.py --config experiments/exp_018_atr_wider.yaml \
    --experiment exp_018_atr_wider \
    --notes "Phase 2 best config — wider ATR"

# Mark this run as the atr_default (B2) baseline for its window
python backtest/run.py --config config.yaml \
    --experiment baseline_atr45 \
    --set-baseline
```

**What happens on a backtest run:**

```
1. run_tests_first()            ← pytest gate
2. load_config(--config)        ← parse YAML
3. run(config, db_path)         ← bar-by-bar simulation
4. compute_all(trades, curve)   ← all metrics
5. buy_and_hold(bars)           ← B1 baseline (stored if new)
6. save_experiment(...)         ← upsert experiment.yaml metadata
7. save_run(...)                ← persist run to runs table
8. save_trades(...)             ← persist individual trades
9. print_results(...)           ← formatted output + verdict
10. log saved to logs/{symbol}_{timestamp}.log
```

**Output format:**

```
============================================================
  RUN: run_0078  |  TQQQ  |  rolling_5y
============================================================

  THIS RUN
    CAGR:          45.80%
    Max DD:        -28.15%
    Sharpe:         0.923
    Calmar:         1.630
    Win rate:       55.6%
    Trades:            27
    Net P&L:    $34,425.00

  vs BUY-AND-HOLD  (CAGR 26.39%  DD -81.66%)
    dCAGR:         +19.41%
    dDD:           +53.51%

  vs ATR DEFAULT   (CAGR 40.83%  DD -30.28%)
    dCAGR:          +4.97%
    dDD:            +2.13%

  VERDICT: PROMISING  (Calmar=1.63)

  Suggested commit:
    v0.x.x | experiment(exp_018): TQQQ CAGR 45.80% DD -28.15%
============================================================
```

### Utility Modes (no backtest)

These modes skip the safety gate — they only read from or write to the DB.

**Diff two runs:**

```bash
python backtest/run.py --diff run_0050 run_0078
```

Shows config changes and metric deltas side-by-side. Useful for understanding what changed between B2 and exp_018.

**Live-trading readiness check:**

```bash
python backtest/run.py --readiness momentum_vwap_ema_atr_v1
```

Evaluates 8 criteria. Exits with code 0 if all pass, code 1 if any fail. See [Ref-Data-Backtest — readiness_check()](Ref-Data-Backtest#readiness_check).

**Restore config from a run:**

```bash
python backtest/run.py --restore run_0078 --output config_restored.yaml
```

Extracts the `config_snapshot` from a DB run and writes it back to a YAML file. Prints the git commit SHA so the exact code version can be reproduced.

**Export all runs to CSV:**

```bash
python backtest/run.py --export results/all_runs_2026_03.csv
```

Exports every row from the `runs` table to CSV. No length limit.

### Full CLI Reference

```
python backtest/run.py [OPTIONS]

--config PATH         Path to config YAML (default: config.yaml)
--experiment ID       Experiment ID for this run (default: exp_001)
--notes TEXT          Notes to attach to the run record
--db PATH             SQLite database path (default: trading.db)
--diff RUN_A RUN_B    Diff two runs — no backtest
--readiness STRATEGY  Check live-trading readiness — no backtest
--restore RUN_ID      Restore config from a run record
--set-baseline        Mark this run as the atr_default (B2) baseline
--export PATH         Export all runs to CSV — no backtest
```

---

## scripts/run_all_windows.py — Multi-Window Runner

Runs one experiment across multiple windows and persists all results. The primary tool for full experiment evaluation.

**Does NOT run the pytest safety gate** — intended for bulk runs after code is known-good. Run `pytest tests/unit/` manually before using this script.

### Basic Usage

```bash
# Run exp_018 on all 13 windows (default)
python scripts/run_all_windows.py --experiment exp_018_atr_wider

# Run on rolling_5y and full_cycle_2 only (fastest full evaluation)
python scripts/run_all_windows.py \
    --experiment exp_018_atr_wider \
    --window-id rolling_5y full_cycle_2

# Run on bear windows only
python scripts/run_all_windows.py \
    --experiment exp_018_atr_wider \
    --windows standard

# Run baseline_bh (uses special B&H math, not simulation)
python scripts/run_all_windows.py --experiment baseline_bh
```

### Window Sets

| `--windows` value | Windows included | Count |
|-------------------|-----------------|-------|
| `all` (default) | All 13 registered windows | 13 |
| `standard` | 6 bear period windows | 6 |
| `--window-id ID ...` | Explicit list | As specified |

**`standard` windows:**
```
bear_period_3, bear_period_4, bear_period_5
bear_period_3_new, bear_period_4_new, bear_period_5_new
```

**`all` windows:**
```
All 6 bear + full_cycle_1, full_cycle_2 + rolling_1y/3y/5y/10y/15y + train_full
```

### Config Resolution

The script automatically finds the experiment YAML:

```
experiments/{experiment_id}.yaml exists?
    YES → load that YAML (experiment-specific params)
    NO  → fall back to config.yaml (base config)
```

This means you can run `--experiment exp_018_atr_wider` and the script automatically loads `experiments/exp_018_atr_wider.yaml` without specifying `--config`.

### Progress Log

All runs append to `01-Backtest/results/phase2_progress.log`:

```
[2026-03-19 23:32:41] =============================================================================
[2026-03-19 23:32:41] run_all_windows START — experiment=exp_018_atr_wider | all (13 windows)
[2026-03-19 23:32:41] =============================================================================
[2026-03-19 23:33:12] exp_018_atr_wider              | rolling_5y            | CAGR=  45.80% DD= -28.15% Calmar= 1.63 Trades= 27 | run_0078
[2026-03-19 23:34:05] exp_018_atr_wider              | full_cycle_2          | CAGR=  40.35% DD= -53.72% Calmar= 0.75 Trades= 48 | run_0079
...
[2026-03-19 23:45:22] run_all_windows COMPLETE — 13/13 windows saved
```

Dashboard Screen 5 (Run Progress) reads and tails this log via SSE. You can watch runs in real time on the dashboard while they execute.

### Special Case: baseline_bh

When `--experiment baseline_bh`, the script calls `run_bh_window()` instead of `run_window()`. This uses pure math (no simulation loop):

```python
shares = initial_capital / closes[0]
equity_curve = [shares × price for price in closes]
```

The result is saved to the `runs` table with `experiment_id='baseline_bh'` and `total_trades=1` so Dashboard Screen 3 can plot it alongside strategy runs.

### Full CLI Reference

```
python scripts/run_all_windows.py [OPTIONS]

--experiment ID           Experiment ID (used to find YAML and tag runs)
--windows {standard|all}  Window set (default: all)
--window-id ID [ID ...]   Explicit window IDs (space-separated, overrides --windows)
```

---

## scripts/run_phase2.py — Parameter Sweep

Runs systematic Phase 2 parameter sweeps across multiple experiments and windows. Generates a summary report on completion.

### Usage

```bash
# Run all Phase 2 experiments on default windows (rolling_5y, full_cycle_2)
python scripts/run_phase2.py

# Skip experiments that are already done
python scripts/run_phase2.py --skip exp_010

# Run multiple experiments on specific windows
python scripts/run_phase2.py --skip exp_010,exp_008 --windows rolling_5y,full_cycle_2

# Run only bear windows
python scripts/run_phase2.py --windows bear_period_5,bear_period_3
```

### Experiments Defined

| Experiment | What it sweeps |
|-----------|---------------|
| `exp_002` | `atr_multiplier`: [3.0, 3.5, 4.0, 4.5, 5.0] |
| `exp_004` | `ema_period`: [5, 8, 10, 15, 20] |
| `exp_006` | `hard_stop_pct`: [5%, 6%, 8%, 10%, 12%] |
| `exp_007` | `vwap_period`: [100, 150, 200, 250, 300] |
| `exp_008` | Combined best params (single run) |
| `exp_009` | Walk-forward on 3 OOS sub-windows |
| `exp_011` | `use_volatility_sizing`: [OFF, ON] |
| `exp_012` | `use_circuit_breaker`: [OFF, ON, various thresholds] |

### Report Generation

On completion, writes `01-Backtest/results/phase2_report.txt`:

```
Phase 2 Report — 2026-03-19 23:45
====================================
Top 5 runs by Sharpe ratio:
  1. run_0078  exp_018  rolling_5y    Sharpe=0.923  Calmar=1.63  CAGR=45.80%
  2. run_0060  exp_009  rolling_5y    Sharpe=0.900  Calmar=1.47  CAGR=45.93%
  3. run_0050  B2       rolling_5y    Sharpe=0.827  Calmar=1.34  CAGR=40.83%
  ...
```

### Progress and SSE

Same progress log as run_all_windows.py: `01-Backtest/results/phase2_progress.log`. Dashboard Screen 5 tails it in real time.

### Full CLI Reference

```
python scripts/run_phase2.py [OPTIONS]

--skip EXP1,EXP2,...   Comma-separated experiment IDs to skip
--windows W1,W2,...    Comma-separated window IDs to run (default: rolling_5y,full_cycle_2)
```

---

## scripts/rerun_all_with_warmup.py — DB Rerun

Re-runs all existing DB experiments with corrected logic. Used after engine bugs are fixed when all historical results need to be regenerated.

**When this was used:** After the v0.6.7 gap-down fix (2026-03-19), this script re-ran all 78 existing runs with the corrected `fill_exit()` logic. Old results were replaced with correct ones.

### Usage

```bash
# Dry run — show what would be re-run without executing
python scripts/rerun_all_with_warmup.py --dry-run

# Re-run all experiments, skip already-done ones
python scripts/rerun_all_with_warmup.py --resume

# Clear old runs first, then re-run everything fresh
python scripts/rerun_all_with_warmup.py --clear-old

# Use a specific DB
python scripts/rerun_all_with_warmup.py --db trading_backup.db
```

### What It Does

```
1. Reads all unique (experiment_id, window_label) combinations from runs table
2. For each combination:
   a. Extracts the original config_snapshot from the stored run
   b. Reconstructs a Config object
   c. Re-runs the backtest with current engine code
   d. Saves new run to DB (new run_id)
   e. Optionally deletes the old run
3. Runs pytest safety gate first
```

**Safety:** Creates a DB backup before processing when `--clear-old` is used. Never modifies the original runs without a backup. The backup path is printed at start.

### Full CLI Reference

```
python scripts/rerun_all_with_warmup.py [OPTIONS]

--dry-run         Show what would be re-run, no execution
--resume          Skip (experiment_id, window_label) pairs already in new DB
--clear-old       Delete old run records after successful re-run
--db PATH         Database path (default: trading.db)
--config PATH     Base config path (default: config.yaml)
```

---

## scripts/backfill_equity_curves.py — DB Backfill

Backfills the `equity_curve` JSON column for old runs that were stored before the column was added to the schema.

**When used:** After `init_db()` added the `equity_curve` column, old runs had NULL in that column. This script reconstructed and stored the equity curves so Dashboard Screen 3 could plot them.

### Usage

```bash
# Show what would be done without committing
python scripts/backfill_equity_curves.py --dry-run

# Backfill first 20 runs only
python scripts/backfill_equity_curves.py --limit 20

# Backfill all
python scripts/backfill_equity_curves.py
```

### Full CLI Reference

```
python scripts/backfill_equity_curves.py [OPTIONS]

--dry-run         Show runs that would be updated, no DB writes
--limit N         Process only the first N runs
```

---

## Workflow Diagrams

### Single Experiment Evaluation

```
New experiment idea
       │
       ▼
Create experiments/{id}.yaml
       │
       ▼
python backtest/run.py                      ← quick check on one window
  --config experiments/{id}.yaml
  --experiment {id}
       │
       ▼
Review results printed to terminal
       │
       ├── looks bad → adjust YAML → repeat
       │
       └── looks promising ─────────────────────────────────────────┐
                                                                     │
python scripts/run_all_windows.py           ← full window evaluation │
  --experiment {id}                                                   │
       │                                                             │
       ▼                                                             │
Review window grid in Dashboard Screen 2                             │
       │                                                             │
       ├── Calmar < 1.0 across board → reject experiment ◄──────────┘
       │
       └── Calmar > 1.0 on rolling_5y → commit
                conclude_experiment(conn, {id}, "conclusion", "positive", run_id)
```

### Full Phase 2 Parameter Sweep

```
pytest tests/unit/ -q                      ← always first

python scripts/run_phase2.py               ← sweep all params, all windows

tail -f 01-Backtest/results/phase2_progress.log   ← watch progress
  OR open Dashboard Screen 5                       ← SSE live view

python backtest/run.py --diff run_XXXX run_YYYY   ← compare top results

Update CLAUDE.md with best config results
Commit: v0.x.x | experiment(phase2): best Calmar X.XX on rolling_5y
```

### Full DB Rerun After Engine Fix

```
Engine bug fixed and v0.6.7 committed
       │
       ▼
python scripts/rerun_all_with_warmup.py --dry-run   ← verify scope

python scripts/rerun_all_with_warmup.py \           ← rerun all
  --resume \
  --clear-old
       │
       ▼
Verify results match expected:
  python backtest/run.py --diff old_run_id new_run_id

Update CLAUDE.md results tables with corrected numbers
Update wiki Experiment-Results.md
```

---

## Experiment YAML Files

Each experiment has a YAML file in `01-Backtest/experiments/`. The YAML inherits all defaults from the engine config but overrides specific parameters.

**Naming convention:**
- `baseline_bh.yaml` — B1 buy-and-hold baseline
- `baseline_atr45.yaml` — B2 ATR45 strategy baseline
- `exp_XXX_{name}.yaml` — numbered experiment with descriptive name

**YAML resolution order:**
```
experiments/{id}.yaml       (experiment-specific overrides)
    ↓ overrides
config.yaml                 (base defaults)
    ↓ overrides
engine/config.py defaults   (dataclass defaults)
```

See [YAML-Config-Guide](YAML-Config-Guide) for full YAML reference.

**Active experiment files:**

| File | experiment_id | Purpose |
|------|--------------|---------|
| `baseline_bh.yaml` | `baseline_bh` | Buy-and-hold B1 |
| `exp_001_baseline.yaml` | `exp_001` | Initial smoke test |
| `exp_008_combined_v1.yaml` | `exp_008_combined_v1` | Combined params |
| `exp_009_cb_free.yaml` | `exp_009_cb_free` | No circuit breaker |
| `exp_013_vol_off.yaml` | `exp_013_vol_off` | Vol sizing off |
| `exp_018_atr_wider.yaml` | `exp_018_atr_wider` | **Best config** |

**Deleted experiment files** (permanently rejected — do not recreate):
- `exp_010_adx_filter.yaml` — ADX filter (permanently rejected)
- `exp_016_full_ml_proxy.yaml` — ADX ML proxy (permanently rejected)
- `exp_017_adx_filter.yaml` — ADX variant (permanently rejected)
- `exp_019_adx_wider_atr.yaml` — ADX variant (permanently rejected)

---

## Logs and Output Files

| File | Location | Contents |
|------|---------|---------|
| Backtest log | `01-Backtest/logs/{symbol}_{timestamp}.log` | Per-run stdout mirror (backtest/run.py) |
| Progress log | `01-Backtest/results/phase2_progress.log` | All window run results, appended |
| Phase 2 report | `01-Backtest/results/phase2_report.txt` | Top-N summary after run_phase2.py |

**Progress log format:**
```
[2026-03-19 23:32:41] experiment_id              | window_id             | CAGR=XX.XX% DD=-XX.XX% Calmar=X.XX Trades=XX | run_XXXX
```

**Tailing the progress log:**
```bash
# Terminal — watch live progress
tail -f 01-Backtest/results/phase2_progress.log

# Dashboard — Screen 5 shows last 50 lines with auto-scroll (SSE stream)
```

---

## Common Recipes

**Run a new experiment on the two primary windows:**

```bash
cd E:\Trading\tqqq-dev\01-Backtest
python scripts/run_all_windows.py \
    --experiment exp_018_atr_wider \
    --window-id rolling_5y full_cycle_2
```

**Compare two experiments side by side:**

```bash
python backtest/run.py --diff run_0050 run_0078
```

**Check if strategy is ready for live trading:**

```bash
python backtest/run.py --readiness momentum_vwap_ema_atr_v1
```

**Export all runs for Excel analysis:**

```bash
python backtest/run.py --export results/export_2026_03.csv
```

**Restore config from the best run and re-run it:**

```bash
python backtest/run.py --restore run_0078 --output config_restored.yaml
python backtest/run.py --config config_restored.yaml --experiment exp_018_verification
```

**Run bear stress tests only after a config change:**

```bash
python scripts/run_all_windows.py \
    --experiment exp_018_atr_wider \
    --windows standard
```

---

## Commit Triggers

Per [CLAUDE.md commit rules](CLAUDE.md#commit-format), batch operations have these valid commit triggers:

| Trigger | Example commit message |
|---------|----------------------|
| All windows complete + tests green | `v0.3.1 \| experiment(exp_018): rolling_5y Cal=1.63 DD=-28.2%` |
| Phase milestone achieved | `v0.2.0 \| milestone(phase2): Phase 2 complete — best config exp_018` |
| Full DB rerun after bug fix | `v0.6.7 \| fix(fill_exit): gap-down fill corrected — full rerun 78 runs` |

**Never commit:**
- After a single window run mid-experiment
- With failing tests
- Using the same version number twice

---

*Back to [Home](Home) · [Backtest-Engine](Backtest-Engine) · [Experiment-Results](Experiment-Results) · [YAML-Config-Guide](YAML-Config-Guide) · [Data-Windows-Reference](Data-Windows-Reference)*
