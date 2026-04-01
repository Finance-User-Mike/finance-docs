# Setup & Deployment

> **Plain English:** This page walks a brand-new team member through getting the entire system running from scratch — from cloning the repo to running a first backtest to starting paper trading. Follow the steps in order; each section builds on the previous.

**Related pages:** [System Architecture](System-Architecture) · [Config Reference](Config-Reference) · [IB Control & Operations](IB-Control-Operations) · [Troubleshooting Playbook](Troubleshooting-Playbook)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Clone & Directory Structure](#clone-and-directory-structure)
3. [Python Environment Setup](#python-environment-setup)
4. [Configuration Setup](#configuration-setup)
5. [Database Initialisation](#database-initialisation)
6. [Verify with Tests](#verify-with-tests)
7. [Run Your First Backtest](#run-your-first-backtest)
8. [Start the Dashboard](#start-the-dashboard)
9. [Setup for Paper Trading](#setup-for-paper-trading)
10. [Setup for Live Trading](#setup-for-live-trading)
11. [Google Drive Sync Setup](#google-drive-sync-setup)
12. [New Machine Checklist](#new-machine-checklist)

---

## Prerequisites

Before starting, ensure you have:

| Requirement | Version | Check command | Install |
|-------------|---------|--------------|---------|
| Python | 3.9 or higher | `python --version` | [python.org](https://python.org) |
| Git | Any recent | `git --version` | [git-scm.com](https://git-scm.com) |
| Node.js | 16+ (dashboard only) | `node --version` | [nodejs.org](https://nodejs.org) |
| IB Gateway | Any | — | See [IB Control & Operations](IB-Control-Operations#installing-ib-gateway) |
| Google Drive | Desktop app (backup only) | — | Optional |

> **Windows note:** All commands below use bash syntax (as used in Git Bash or WSL). The project runs natively on Windows — use forward slashes in paths.

---

## Clone and Directory Structure

```bash
# Clone the repository
git clone <repo-url> tqqq-dev
cd tqqq-dev

# Verify you're on the dev branch
git branch
# Should show: * dev
```

Expected root structure after clone:

```
tqqq-dev/
├── 01-Backtest/        ← Historical research
├── 02-Common/          ← Shared strategy engine
├── 03-Live/            ← Live trading
├── config.yaml.example ← Template (copy this to config.yaml)
├── .env.example        ← Template (create .env from this)
├── requirements.txt
├── pytest.ini
└── conftest.py
```

> **Note:** `config.yaml`, `.env`, and `trading.db` are NOT in the repo (gitignored). You must create them. See [Configuration Setup](#configuration-setup).

---

## Python Environment Setup

### Step 1 — Create virtual environment

```bash
# In the project root (tqqq-dev/)
python -m venv .venv
```

### Step 2 — Activate virtual environment

```bash
# Windows (Git Bash / PowerShell)
source .venv/Scripts/activate

# Windows (Command Prompt)
.venv\Scripts\activate.bat

# macOS / Linux
source .venv/bin/activate
```

After activation, your prompt shows `(.venv)` prefix.

### Step 3 — Install dependencies

```bash
pip install -r requirements.txt
```

**What gets installed (13 packages):**

| Package | Version | Purpose |
|---------|---------|---------|
| pandas | 2.2.3 | DataFrame operations |
| numpy | 1.26.4 | Numerical calculations |
| pyyaml | 6.0.1 | YAML config parsing |
| yfinance | 0.2.31 | Yahoo Finance data download |
| ib_insync | 0.9.86 | Interactive Brokers API |
| flask | 3.0.0 | Dashboard web backend |
| flask-cors | — | CORS headers for React |
| waitress | — | Production WSGI server |
| scikit-learn | 1.3.2 | ML (reserved for Phase 4) |
| xgboost | 2.0.3 | ML (reserved for Phase 4) |
| pandas_market_calendars | 5.3.1.2 | NYSE holiday/weekend detection |
| pytest | 7.4.3 | Test runner |
| pytest-cov | 4.1.0 | Code coverage |

### Step 4 — Verify installation

```bash
python -c "import pandas, numpy, yaml, ib_insync, flask; print('All imports OK')"
# Expected: All imports OK
```

---

## Configuration Setup

Two files must be created from their templates.

### config.yaml — strategy parameters

```bash
# Copy the example template
cp config.yaml.example config.yaml
```

Then edit `config.yaml` for your environment. Minimum changes required:

```yaml
# config.yaml — minimum required changes

symbols:
  - symbol: TQQQ
    data_file: 02-Common/data/TQQQ_1d.csv    # ← verify this path exists
    atr_multiplier: 5.0                        # exp_018 best config
    hard_stop_pct: 0.11

live:
  mode: paper                                  # ← start with paper, NEVER live
  ibkr_port: 4002                              # ← 4002 = paper, 4001 = live
  dry_run: true                                # ← true = log signals, no orders
  session_capital: 100000                      # ← allocated capital

backtest:
  date_from: "2017-01-01"
  date_to: "2026-03-16"
  initial_capital: 20000
```

Full parameter reference: [Config Reference](Config-Reference)

### .env — environment variables

```bash
# Create .env file manually (no template exists as .env is committed in this repo)
```

Minimum `.env` content:

```
ENV=dev
IB_PORT=4002
IB_CLIENT_ID=1
MACHINE_ID=your-machine-name
WORKING_DIR=E:/Trading/tqqq-dev
APP_PORT=5000
ALLOW_LIVE_PORT=false
DB_FILE=trading.db
LOCK_FILE=trading.lock
LOG_DIR=logs/
```

> ⚠️ **Security:** Never set `ALLOW_LIVE_PORT=true` unless you are intentionally connecting to real-money IB Gateway on port 4001. This is the safety gate that prevents accidental live trading.

---

## Database Initialisation

The database is created automatically on first backtest run. However, you can also initialise it manually:

```bash
# Initialise backtest tables (runs, trades, experiments, data_windows, baselines)
python -c "
import sys; sys.path.insert(0, '01-Backtest'); sys.path.insert(0, '02-Common')
from backtest.recorder import init_db
init_db('trading.db')
print('Backtest DB tables created')
"

# Initialise live trading tables (TQQQ_1h, orders_live, trades_live, etc.)
python -c "
import sys; sys.path.insert(0, '03-Live')
from live.db_setup import create_tables
create_tables('trading.db')
print('Live DB tables created')
"
```

Verify the database:

```bash
# List all tables
python -c "
import sqlite3
conn = sqlite3.connect('trading.db')
tables = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()
print([t[0] for t in tables])
"
```

Expected output includes: `runs`, `trades`, `baselines`, `data_windows`, `TQQQ_1h`, `orders_live`, `trades_live`, `signals_live`, `Events_log_live`

---

## Verify with Tests

Run the full test suite to verify the environment is set up correctly:

```bash
# Run all tests from project root
pytest

# Expected output:
# 02-Common/tests/unit/   — ~50 tests
# 01-Backtest/tests/      — ~60 tests
# 03-Live/tests/          — ~45 tests
# Total: ~155+ tests passing, 0 failures
```

If tests fail, see [Troubleshooting — Test Failures](Troubleshooting-Playbook#test-failures).

### Run specific test subsets

```bash
# Unit tests only (fast — run frequently during development)
pytest 02-Common/tests/unit/ -v

# Backtest integration tests
pytest 01-Backtest/tests/integration/ -v

# Live trading tests (no IB Gateway required)
pytest 03-Live/tests/ -v

# With coverage report
pytest --cov=02-Common/engine --cov-report=term-missing
```

---

## Run Your First Backtest

### Step 1 — Verify data file exists

```bash
ls 02-Common/data/TQQQ_1d.csv
# Should show the file. If missing, see Data Management — Download Data
```

If the file is missing:

```bash
python -c "
import sys; sys.path.insert(0, '02-Common')
from data.loader import download_yahoo
download_yahoo('TQQQ', '2010-02-11', '2026-03-16', '02-Common/data/TQQQ_1d.csv')
print('Data downloaded')
"
```

### Step 2 — Run backtest

```bash
python 01-Backtest/backtest/run.py
```

**What happens:**
1. `run_tests_first()` — runs all unit tests as a safety gate (aborts if any fail)
2. Loads `config.yaml`
3. Loads `TQQQ_1d.csv` and applies split/dividend adjustment
4. Runs bar-by-bar simulation over the configured date range
5. Computes all metrics (CAGR, Sharpe, Calmar, max_dd, etc.)
6. Saves results to `trading.db`
7. Prints a results summary

**Expected output:**

```
Running tests first...
....................................................... 155 passed
Running backtest: TQQQ (2017-01-01 to 2026-03-16)
Loading data: 2,320 bars (250 warmup + 2,070 measurement)
Running simulation...
  Trades: 48
  Win rate: 58.3%

Results:
  CAGR:         40.35%    (+1.78pp vs buy-and-hold)
  Max DD:       -53.72%   (+28.0pp vs buy-and-hold -81.66%)
  Calmar:       0.75
  Sharpe:       0.71
  Trades:       48

Saved to trading.db as run_20260330_143022_exp018
```

### Step 3 — Run all windows

```bash
# Run exp_018 on all 18 windows
python 01-Backtest/scripts/run_all_windows.py \
  --experiment exp_018_atr_wider \
  --windows all
```

Full script reference: [Batch Operations — run_all_windows.py](Batch-Operations#run_all_windows)

---

## Start the Dashboard

The dashboard requires two processes: Flask backend + React frontend.

### Terminal 1 — Flask backend

```bash
cd 03-Live/gui
python app.py
# Flask starts on http://localhost:5000
```

### Terminal 2 — React frontend

```bash
# First time only: install Node dependencies
cd 03-Live/gui/frontend
npm install

# Start React dev server
npm start
# Opens http://localhost:3000 in browser
```

### Verify dashboard is working

Open `http://localhost:3000` in your browser. You should see:

- Left sidebar with navigation (Foundation / Backtest / Live sections)
- "All Experiments" screen showing any completed backtest runs
- Green status indicator (DB connected)

If the dashboard shows "DB Error" or empty results, see [Troubleshooting — Dashboard Issues](Troubleshooting-Playbook#dashboard-issues).

> **Alternative:** For production use, run Flask with waitress: `waitress-serve --host=0.0.0.0 --port=5000 app:app`

---

## Setup for Paper Trading

Paper trading uses IB Gateway in simulated-fills mode. No real money changes hands but the system behaves identically to live trading.

### Step 1 — Install and configure IB Gateway

Detailed steps: [IB Control & Operations — Installing IB Gateway](IB-Control-Operations#installing-ib-gateway)

Quick summary:
1. Download IB Gateway from Interactive Brokers website
2. Log in with your paper trading account credentials (separate from live account)
3. Configure: API → Settings → Enable ActiveX and Socket Clients → Socket port: **4002**
4. Configure: API → Settings → Read-Only API: **unchecked** (must allow order submission)

### Step 2 — Update configuration

```yaml
# config.yaml
live:
  mode: paper
  ibkr_port: 4002
  dry_run: false          # set to false to actually place paper orders
  session_capital: 100000
```

```
# .env
ENV=dev
IB_PORT=4002
ALLOW_LIVE_PORT=false    # keep false — this is paper mode
```

### Step 3 — Run readiness check

```bash
# With IB Gateway running on port 4002:
python -c "
import sys; sys.path.insert(0, '03-Live'); sys.path.insert(0, '02-Common')
from live.validate import run_readiness_check
from engine.config import load_config
config = load_config('config.yaml')
result = run_readiness_check(config, 'trading.db')
print('PASS' if result else 'FAIL')
"
```

**All 5 checks must pass:**

```
✅ CHECK 1: IB Gateway reachable on 127.0.0.1:4002
✅ CHECK 2: Config valid (mode=paper, port=4002)
✅ CHECK 3: DB writable (test insert/delete succeeded)
✅ CHECK 4: Hourly data fresh (last bar within 72 hours)
✅ CHECK 5: Paper mode — auto-confirmed
```

If any check fails: [IB Control — Readiness Check Failures](IB-Control-Operations#readiness-check-failures)

### Step 4 — Backfill hourly data

The live loop requires `TQQQ_1h` (hourly bars) to be populated. On first setup:

```bash
python -c "
import sys; sys.path.insert(0, '03-Live'); sys.path.insert(0, '02-Common')
from live.data import backfill_hourly_db, connect_ibkr
from engine.config import load_config
config = load_config('config.yaml')
ib = connect_ibkr(config)
backfill_hourly_db(ib, 'trading.db', years=5)
print('Backfill complete')
"
```

> ⚠️ This takes 10–15 minutes. It fetches 5 years of hourly bars in 30-day chunks with 10-second pauses between chunks (IB rate limiting).

### Step 5 — Start paper trading session

```bash
python 03-Live/live/main.py
```

Monitor the session:
- **Terminal:** real-time INFO/WARNING/ERROR log output
- **Dashboard:** Session Analysis screen at `http://localhost:3000` → Session tab
- **Database:** `SELECT * FROM Events_log_live ORDER BY timestamp DESC LIMIT 20`

---

## Setup for Live Trading

> ⚠️ **WARNING:** This section enables real-money trading. Only proceed after extensive paper trading and thorough testing. Mistakes can result in real financial losses.

### Differences from paper trading

| Setting | Paper | Live |
|---------|-------|------|
| IB Gateway port | 4002 | **4001** |
| Account type | DU (paper) | U (live) |
| `.env ALLOW_LIVE_PORT` | false | **true** |
| `config.yaml live.mode` | paper | **live** |
| Readiness check #5 | Auto-pass | **Requires typed confirmation** |

### Step 1 — Update all settings

```yaml
# config.yaml
live:
  mode: live              # ← change from paper
  ibkr_port: 4001         # ← change from 4002
  dry_run: false
```

```
# .env
ENV=live
IB_PORT=4001              # ← change from 4002
ALLOW_LIVE_PORT=true      # ← change from false
```

### Step 2 — Run live readiness check

```bash
python -c "
import sys; sys.path.insert(0, '03-Live'); sys.path.insert(0, '02-Common')
from live.validate import run_readiness_check
from engine.config import load_config
config = load_config('config.yaml')
result = run_readiness_check(config, 'trading.db')
"
```

Check 5 will prompt:

```
⚠️  LIVE TRADING MODE DETECTED
You are about to start REAL MONEY trading.
Type exactly: I CONFIRM LIVE TRADING
> _
```

### Step 3 — Start live session

```bash
python 03-Live/live/main.py
```

Monitor closely for the first few sessions. See [System Monitoring Guide](System-Monitoring-Guide) for what to watch.

---

## Google Drive Sync Setup

The backup system saves ZIP snapshots to Google Drive. Setup:

### Step 1 — Install Google Drive desktop app

Ensure Google Drive desktop app is installed and syncing `My Drive`.

### Step 2 — Verify backup path

Default backup location: `C:\Users\Admin\Google Drive\My Drive\trading-sync\tqqq_momentum\backups\`

Check the path is accessible:

```bash
ls "C:/Users/Admin/Google Drive/My Drive/trading-sync/tqqq_momentum/"
# Should show: backups/
```

If path is different, set the environment variable:

```
# In .env
TRADING_SYNC_DIR=C:/path/to/your/google/drive/trading-sync/tqqq_momentum
```

### Step 3 — Create first milestone backup

```bash
python backup.py initial_setup
```

Expected output:

```
Creating backup: initial_setup
Adding engine/ ... done
Adding backtest/ ... done
Adding trading.db ... done
Backup saved: .../backups/TQQQ_momentum_initial_setup_20260330_1430.zip
```

Full backup guide: [Backup & Recovery](Backup-Recovery)

---

## New Machine Checklist

Use this checklist when setting up on a new machine or after a fresh OS install:

```
PRE-REQUISITES
  [ ] Python 3.9+ installed — python --version
  [ ] Git installed — git --version
  [ ] Node.js 16+ installed (dashboard only) — node --version
  [ ] IB Gateway installed (paper trading only initially)
  [ ] Google Drive desktop app installed (backup)

REPOSITORY
  [ ] Repo cloned to correct path (e.g., E:\Trading\tqqq-dev)
  [ ] On correct branch: git branch → * dev

PYTHON ENVIRONMENT
  [ ] .venv created: python -m venv .venv
  [ ] .venv activated: source .venv/Scripts/activate
  [ ] Dependencies installed: pip install -r requirements.txt
  [ ] Import test passes: python -c "import pandas, flask, ib_insync; print('OK')"

CONFIGURATION
  [ ] config.yaml created from config.yaml.example
  [ ] config.yaml: data_file path points to existing TQQQ_1d.csv
  [ ] config.yaml: live.mode = paper (NEVER live on first setup)
  [ ] config.yaml: live.ibkr_port = 4002
  [ ] .env created with ENV=dev, IB_PORT=4002, ALLOW_LIVE_PORT=false
  [ ] .env: WORKING_DIR set to correct path
  [ ] .env: MACHINE_ID set to identify this machine

DATA
  [ ] 02-Common/data/TQQQ_1d.csv exists (copy from backup or download)
  [ ] If missing: python -c "from data.loader import download_yahoo; download_yahoo(...)"

DATABASE
  [ ] trading.db in project root (copy from backup or let first run create it)
  [ ] If new DB: backtest tables auto-created on first run

TESTS
  [ ] All tests pass: pytest
  [ ] Expected: ~155+ tests, 0 failures

FIRST BACKTEST
  [ ] python 01-Backtest/backtest/run.py
  [ ] Results appear in terminal
  [ ] Results appear in trading.db

DASHBOARD
  [ ] Flask backend starts: cd 03-Live/gui && python app.py
  [ ] React frontend starts: cd 03-Live/gui/frontend && npm install && npm start
  [ ] http://localhost:3000 loads and shows backtest results

PAPER TRADING (after above complete)
  [ ] IB Gateway running on port 4002
  [ ] Readiness check passes (all 5 checks green)
  [ ] TQQQ_1h backfilled (backfill_hourly_db called)
  [ ] python 03-Live/live/main.py starts without errors
  [ ] Events_log_live shows STARTUP event

BACKUP
  [ ] Google Drive desktop app syncing
  [ ] python backup.py initial_setup completes
  [ ] ZIP file visible in Google Drive
```

---

## Common Setup Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ModuleNotFoundError: No module named 'engine'` | Wrong working directory or venv not activated | `cd tqqq-dev` and `source .venv/Scripts/activate` |
| `FileNotFoundError: TQQQ_1d.csv` | Data file missing | Copy from backup or run `download_yahoo()` |
| `sqlite3.OperationalError: no such table` | DB not initialised | Run `init_db()` or let first backtest create it |
| `ConnectionRefusedError: [Errno 111]` | IB Gateway not running | Start IB Gateway first, check port 4002 |
| `RuntimeError: SAFETY: config says paper but connected to live account` | IB Gateway logged in with live credentials | Use paper account credentials in IB Gateway |
| `pytest: 5 failed` | Stale fixtures or wrong Python version | Run `pytest --tb=short` to see specific failures |
| React shows "API Error: Failed to fetch" | Flask backend not running | Start `python app.py` in `03-Live/gui/` |

Full troubleshooting: [Troubleshooting Playbook](Troubleshooting-Playbook)
