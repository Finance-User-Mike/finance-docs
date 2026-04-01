# Backup and Recovery

When to back up, what is included, how to restore, and data files that are never committed.

Source: [backup.py](../../backup.py), [CLAUDE.md](../../CLAUDE.md) — Backup Rules section

---

## Three-Layer Backup Strategy

| Layer | Mechanism | Trigger | Location |
|-------|-----------|---------|----------|
| 1 — Git | `git push origin dev` | Every completed batch (all tests green) | GitHub |
| 2 — Milestone ZIP | `python backup.py <label>` | Every major milestone | Google Drive |
| 3 — Template push | Push `engine/` to template repo | End of every phase | GitHub (separate repo) |

**Layer 1 is continuous.** Layer 2 creates point-in-time snapshots of everything including `trading.db` and price data. Layer 3 preserves the strategy-agnostic engine for reuse on other symbols.

---

## Layer 1 — Git Backup

`trading.db`, `data/TQQQ_1d.csv`, and `config.yaml` are committed to git (marked binary in `.gitattributes` — no diff, no merge conflicts). All source files are tracked normally.

```bash
# Standard commit workflow
git add -A
git commit -m "v0.7.16 | feat(live): description"
git push origin dev
```

**What git does NOT store:**
- `.env` — credentials, never committed
- `live/emergency.lock` — runtime state, not tracked

**Restoring from git:**
```bash
git clone <repo-url> trading_tqqq_momentum
cd trading_tqqq_momentum
pip install -r requirements.txt

# Copy credentials from secure storage
cp /path/to/.env .env
```

---

## Layer 2 — Milestone ZIP Backup

### When to run

| Trigger | Command |
|---------|---------|
| Phase 1 complete | `python backup.py phase1_complete` |
| All 18 windows run | `python backup.py windows_complete` |
| Phase 2 complete | `python backup.py phase2_complete` |
| Before ATR sweep experiment | `python backup.py pre_exp_002` |
| Before ML training | `python backup.py pre_ml_training` |
| Before live trading (MANDATORY) | `python backup.py pre_live_trading` |
| First day of every month | `python backup.py monthly_202604` |
| Ad hoc / manual | `python backup.py manual` |

**Run from the project root:**
```bash
cd E:\Trading\tqqq-dev
python backup.py pre_live_trading
```

### What is included

```
engine/              indicator, signal, risk, config code
backtest/            runner, simulator, metrics, recorder
data/                loader.py + TQQQ_1d.csv
tests/               all unit, integration, regression, stress tests
experiments/         all experiment YAML configs
docs/                all documentation
trading.db           backtest results + live tables (full DB state)
CLAUDE.md            project memory
requirements.txt
pytest.ini
config.yaml.example
run_all_windows.py
backup.py
```

### What is NOT included

```
.env                 credentials — never back up to cloud storage
config.yaml          may contain real API keys
live/emergency.lock  runtime state
logs/                log rotation files (regenerated on restart)
__pycache__/         Python bytecode
.pytest_cache/
*.pyc
```

### Backup location

```
C:\Users\Admin\Google Drive\My Drive\trading-sync\tqqq_momentum\backups\
TQQQ_momentum_{label}_{YYYYMMDD_HHMM}.zip
```

Example: `TQQQ_momentum_pre_live_trading_20260330_1423.zip`

The `TRADING_SYNC_DIR` environment variable overrides the default Google Drive path:
```bash
TRADING_SYNC_DIR="D:\Backups\trading" python backup.py monthly_202604
```

### Backup output

```
Creating backup: pre_live_trading

  + engine/config.py
  + engine/indicators.py
  + ...
  + data/TQQQ_1d.csv
  + trading.db

Backup complete: TQQQ_momentum_pre_live_trading_20260330_1423.zip
Location:        C:\Users\...\backups\TQQQ_momentum_pre_live_trading_20260330_1423.zip
Size:            47.3 MB
```

---

## Layer 3 — Strategy Template (GitHub)

At the end of every phase, push a clean engine-only snapshot to `momentum_engine_template`.

### When to push

| Phase complete | Tag |
|---------------|-----|
| Phase 1 | `v1.0-engine-foundation` |
| Phase 2 | `v1.1-engine-indicators` |
| Phase 4 (ML) | `v1.2-engine-ml` |
| Phase 6 (live) | `v2.0-engine-live` |

### What goes in the template

```
engine/              ALL indicator, signal, risk, config code
data/loader.py       data loading functions only
tests/unit/          unit tests for engine functions
requirements.txt     pinned dependencies
pytest.ini
CLAUDE.md            cleaned — no TQQQ-specific decisions
config.yaml.example  generic template
.gitignore
```

### What never goes in the template

```
trading.db           TQQQ-specific experiment history
data/TQQQ_1d.csv     symbol-specific price data
experiments/         TQQQ YAML configs
backtest/run.py      TQQQ-specific CLI flags
.env                 credentials
config.yaml          active config with real values
```

---

## Data Files Reference

Three files are **always committed to git** and **always included in ZIP backups** because new-machine setup requires all three:

| File | Purpose | Committed? | In ZIP? |
|------|---------|-----------|---------|
| `trading.db` | All backtest results + live tables | Yes (binary) | Yes |
| `data/TQQQ_1d.csv` | TQQQ daily price history since 2010 | Yes (binary) | Yes |
| `config.yaml` | Dev configuration | Yes (binary) | No (use .example) |
| `config.yaml.example` | Template with all parameters | Yes | Yes |
| `.env` | Credentials and port settings | Never | Never |
| `.env.example` | Template for new machine setup | Yes | Yes |

### Google Drive Sync

The `trading-sync` folder in Google Drive keeps a live mirror:

```
Google Drive/My Drive/trading-sync/tqqq_momentum/
  config.yaml       ← live config (never in git)
  .env              ← credentials (never in git)
  trading.db        ← DB mirror (also in git)
  data/             ← price data mirror
  models/           ← ML model files (future)
  backups/          ← ZIP milestone backups
```

**Never run backtests on two machines simultaneously** — SQLite does not support concurrent writes. Running on two machines at once causes data corruption.

---

## Recovery Procedures

### Restore from ZIP backup

```bash
# 1. Choose a backup
ls "C:\Users\Admin\Google Drive\My Drive\trading-sync\tqqq_momentum\backups\"

# 2. Extract to a clean directory
cd C:\Projects
python -c "
import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall('trading_tqqq_restored')
" "C:\...\backups\TQQQ_momentum_pre_live_trading_20260330_1423.zip"

cd trading_tqqq_restored

# 3. Restore credentials (never in backup)
cp "Google Drive/My Drive/trading-sync/tqqq_momentum/.env" .env
cp "Google Drive/My Drive/trading-sync/tqqq_momentum/config.yaml" config.yaml

# 4. Install dependencies
pip install -r requirements.txt

# 5. Verify DB
sqlite3 trading.db "SELECT COUNT(*) FROM runs;"
sqlite3 trading.db "SELECT MAX(timestamp) FROM TQQQ_1h;"
```

---

### Restore `trading.db` only (keep code)

When you need to roll back to a previous DB state (e.g., after a bad experiment run):

```bash
# Stop all processes that might be using trading.db

# 1. Back up current DB first
cp trading.db trading.db.before_restore

# 2. Extract just the DB from a ZIP backup
python -c "
import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extract('trading.db', '.')
print('trading.db restored')
" "C:\...\backups\TQQQ_momentum_windows_complete_20260319_2332.zip"

# 3. Verify
sqlite3 trading.db "PRAGMA integrity_check;"
sqlite3 trading.db "SELECT COUNT(*) FROM runs;"
```

---

### Restore `TQQQ_1d.csv` only

If the price data file is corrupted or accidentally deleted:

```bash
# Option 1 — restore from ZIP backup
python -c "
import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extract('data/TQQQ_1d.csv', '.')
" "C:\...\backups\TQQQ_momentum_windows_complete_20260319_2332.zip"

# Option 2 — re-download from Yahoo Finance
cd E:\Trading\tqqq-dev
python -c "
from data.loader import download_yahoo
download_yahoo('TQQQ', '2010-02-11', '2026-03-30', 'data/TQQQ_1d.csv')
"

# Option 3 — copy from Google Drive mirror
cp "Google Drive/My Drive/trading-sync/tqqq_momentum/data/TQQQ_1d.csv" data/
```

---

### New Machine Setup

Full setup from scratch using git + credentials from secure storage:

```bash
# 1. Clone the repo
git clone <repo-url> trading_tqqq_momentum
cd trading_tqqq_momentum

# 2. Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate      # Windows
source .venv/bin/activate   # Mac/Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy credentials from secure storage
#    .env and config.yaml are never in git — get from Google Drive sync folder
copy "Google Drive\My Drive\trading-sync\tqqq_momentum\.env" .env
copy "Google Drive\My Drive\trading-sync\tqqq_momentum\config.yaml" config.yaml

# 5. Verify trading.db (included in git as binary)
sqlite3 trading.db "SELECT COUNT(*) FROM runs;"

# 6. Verify price data
sqlite3 trading.db "SELECT MIN(date), MAX(date) FROM TQQQ_daily;" 2>/dev/null
# OR check CSV
python -c "import pandas as pd; df=pd.read_csv('data/TQQQ_1d.csv'); print(df.head(2))"

# 7. Run tests to verify everything works
pytest tests/ -q

# 8. For live trading — also run the readiness check
cd 03-Live
python -m live.main  # will run readiness check before connecting
```

---

## Phase Completion Checklist

Before marking any phase complete:

```
[ ] All tests passing: pytest tests/ -q
[ ] Milestone ZIP backup created: python backup.py phase{N}_complete
[ ] Template repo updated: push engine/ to momentum_engine_template
[ ] CLAUDE.md updated with new results and current status
[ ] commit + push: git push origin dev
```

---

## Verifying Backup Integrity

After creating a backup, spot-check it:

```python
import zipfile
import os

backup_path = r"C:\...\backups\TQQQ_momentum_pre_live_trading_20260330_1423.zip"

with zipfile.ZipFile(backup_path) as zf:
    names = zf.namelist()

    # Check critical files are present
    critical = ['trading.db', 'data/TQQQ_1d.csv', 'CLAUDE.md',
                'engine/config.py', 'engine/indicators.py']
    for f in critical:
        status = "✓" if f in names else "✗ MISSING"
        print(f"  {status}  {f}")

    # Check .env is NOT present (should never be in backup)
    if '.env' in names or 'config.yaml' in names:
        print("  ✗ WARNING: credentials file found in backup!")
    else:
        print("  ✓  No credentials in backup")

    print(f"\n  Total files: {len(names)}")
    print(f"  DB size:     {zf.getinfo('trading.db').file_size / 1024 / 1024:.1f} MB")
```

---

## Related Pages

- [CLAUDE.md](../../CLAUDE.md) — Backup Rules section (mandatory triggers and procedures)
- [Database Schema](Database-Schema.md) — tables included in `trading.db` backups
- [Troubleshooting-Playbook](Troubleshooting-Playbook.md) — restoring from backup after data corruption
