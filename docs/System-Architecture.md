# System Architecture

> **Plain English:** The system is split into three physically separate folders. The middle layer (engine) contains all trading logic and is shared by both the backtest and the live trading systems. Neither the backtest nor the live system ever imports from each other — they share only the engine. The dashboard never writes to the database; it only reads.

**Related pages:** [Strategy Logic](Strategy-Logic) · [Ref-Engine-Core](Ref-Engine-Core) · [Database Schema](Database-Schema) · [Setup & Deployment](Setup-Deployment)

---

## Table of Contents

1. [Three-Tier Module Map](#three-tier-module-map)
2. [The Import Wall — What Can Import What](#the-import-wall)
3. [Directory Structure](#directory-structure)
4. [Backtest Data Flow](#backtest-data-flow)
5. [Live Trading Data Flow](#live-trading-data-flow)
6. [Deployment Modes](#deployment-modes)
7. [Technology Stack](#technology-stack)
8. [Database Overview](#database-overview)

---

## Three-Tier Module Map

> **How to read:** Each box is a module folder. Solid arrows show allowed data/import direction. The engine layer (centre) has no arrows coming back from backtest or live — it knows nothing about them. This is intentional: the engine can be tested, swapped, or improved without touching either execution path.

```mermaid
graph TD
    subgraph DATA["📁 Data Sources"]
        CSV["TQQQ_1d.csv\nDaily OHLCV — Yahoo Finance\n~3,800 bars from 2010"]
        H1["IB Gateway\nHourly OHLCV\nLive mode only"]
    end

    subgraph COMMON["⚙️ 02-Common — Shared Strategy Engine"]
        subgraph ENG["engine/  ← ZERO project imports"]
            CFG["config.py\nAll parameters as typed dataclasses\nSingle source of truth"]
            IND["indicators.py\nVWAP(250) · EMA(10) · ATR(45) · TR · ADX"]
            SIG["signals.py\nEntry/exit evaluation → SignalResult"]
            RSK["risk.py\nPosition sizing · Ratchet stop · Hard stop"]
        end
        LDR["data/loader.py\nLoad · Adjust · Validate · Slice\nZERO project imports"]
        CFG --> IND
        CFG --> SIG
        CFG --> RSK
        IND --> SIG
        SIG --> RSK
    end

    subgraph BT["📊 01-Backtest — Historical Research"]
        RUN["backtest/runner.py\nBar-by-bar simulation loop"]
        SIM["backtest/simulator.py\nfill_entry · fill_exit · calc_pnl"]
        MET["backtest/metrics.py\nCAGR · Sharpe · Calmar · max_dd · expectancy"]
        REC["backtest/recorder.py\nPersist runs · trades · equity curves"]
        CLI["backtest/run.py\nCLI · run_tests_first() gate"]
    end

    subgraph LV["📈 03-Live — Real-time Trading"]
        MAIN["live/main.py\nMain loop · 15:00 ET signal · commands"]
        EXEC["live/executor.py\nact() · monitor_stops()"]
        BRK["live/broker.py\nIB Gateway API · safety checks"]
        CB["live/circuit_breaker.py\n4-level drawdown alerts"]
        LOG["live/logger.py\nFile · terminal · DB handler"]
        STR["live/strategy.py\nPure signal logic (hourly bars)"]
    end

    subgraph STORE["💾 Storage"]
        DB[("trading.db\nSQLite · WAL mode\nBacktest + Live tables")]
    end

    subgraph UI["🖥️ Dashboard"]
        FLASK["gui/app.py\nFlask · 40+ API endpoints\nRead-only"]
        REACT["React 18 + Recharts\nlocalhost:3000\n6 screens"]
    end

    CSV --> LDR
    H1 --> MAIN
    LDR --> RUN
    RSK --> RUN
    RSK --> EXEC
    RUN --> SIM --> MET --> REC --> DB
    EXEC --> BRK --> H1
    CB --> MAIN
    LOG --> DB
    MAIN --> EXEC
    DB --> FLASK --> REACT
```

---

## The Import Wall

> **How to read:** Green arrows = allowed imports. Red dashed lines with ❌ = permanently forbidden. The engine folder is a self-contained island — if it imported from backtest or live, a circular dependency would exist and the shared code model would break. Verified after every batch with `grep -r "from backtest" engine/`.

```mermaid
graph LR
    subgraph CORE["Zero-import modules (foundation)"]
        E["engine/\n🔒 Imports nothing\nfrom this project"]
        D["data/loader.py\n🔒 Imports nothing\nfrom this project"]
    end

    subgraph CONSUMERS["Allowed consumers"]
        B["backtest/\n✅ imports engine/\n✅ imports data/"]
        L["live/\n✅ imports engine/\n✅ imports data/"]
        T["tests/\n✅ imports engine/\n✅ imports backtest/"]
    end

    subgraph READONLY["Read-only consumer"]
        G["gui/app.py\n📖 reads trading.db only\n❌ imports nothing"]
    end

    E -->|"✅ allowed"| B
    E -->|"✅ allowed"| L
    E -->|"✅ allowed"| T
    D -->|"✅ allowed"| B
    D -->|"✅ allowed"| L
    B -->|"✅ allowed"| T

    B -. "❌ NEVER" .-> L
    L -. "❌ NEVER" .-> B
    B -. "❌ NEVER import back" .-> E
    L -. "❌ NEVER import back" .-> E
    G -. "❌ NEVER import" .-> B
    G -. "❌ NEVER import" .-> L
    G -. "❌ NEVER import" .-> E
```

**Verification commands — run after every change to import structure:**

```bash
grep -r "from backtest" engine/   # must return nothing
grep -r "from live" engine/       # must return nothing
grep -r "from backtest" live/     # must return nothing
grep -r "from live" backtest/     # must return nothing
```

---

## Directory Structure

```
e:\Trading\tqqq-dev\
│
├── 01-Backtest/                      ← Historical research & optimisation
│   ├── backtest/
│   │   ├── run.py                    ← CLI entry point (run_tests_first gate)
│   │   ├── runner.py                 ← Bar-by-bar simulation loop
│   │   ├── simulator.py              ← fill_entry, fill_exit, calc_pnl
│   │   ├── metrics.py                ← CAGR, Sharpe, Calmar, max_dd
│   │   └── recorder.py               ← Persist to trading.db
│   ├── scripts/
│   │   ├── run_all_windows.py        ← Run one experiment on all windows
│   │   ├── run_phase2.py             ← Phase 2 parameter sweep runner
│   │   ├── backfill_equity_curves.py ← Recompute missing equity curves
│   │   └── rerun_all_with_warmup.py  ← Force rerun with new warmup params
│   ├── experiments/                  ← YAML configs for each experiment
│   │   ├── baseline_bh.yaml          ← B1: Buy & hold baseline
│   │   ├── baseline_atr45.yaml       ← B2: Default strategy baseline
│   │   ├── exp_018_atr_wider.yaml    ← Best config (Calmar leader)
│   │   └── *.yaml                    ← All other experiment configs
│   └── tests/
│       ├── integration/test_backtest.py
│       ├── regression/test_regression.py
│       ├── stress/test_stress.py
│       └── unit/test_metrics.py
│
├── 02-Common/                        ← Shared engine (used by backtest AND live)
│   ├── engine/
│   │   ├── config.py                 ← All dataclasses + load_config()
│   │   ├── indicators.py             ← vwap_rolling, ema, atr, true_range, adx
│   │   ├── signals.py                ← evaluate() → SignalResult
│   │   ├── risk.py                   ← calc_position_size, calc_ratchet_stop
│   │   └── ml/                       ← Placeholder (Phase 4)
│   ├── data/
│   │   └── loader.py                 ← load_csv, apply_adjustment, validate_data
│   └── tests/unit/
│       ├── test_config.py
│       ├── test_indicators.py
│       ├── test_signals.py
│       ├── test_risk.py
│       ├── test_data.py
│       └── test_verdict.py
│
├── 03-Live/                          ← Paper and live trading
│   ├── live/
│   │   ├── main.py                   ← Main loop (1,383 lines)
│   │   ├── executor.py               ← act(), monitor_stops()
│   │   ├── broker.py                 ← IB Gateway wrapper (653 lines)
│   │   ├── strategy.py               ← Pure signal logic for hourly bars
│   │   ├── circuit_breaker.py        ← 4-level drawdown alerts
│   │   ├── logger.py                 ← 3-tier logging (file/terminal/DB)
│   │   ├── db.py                     ← All DB reads/writes
│   │   ├── db_setup.py               ← Schema creation (13 tables)
│   │   ├── data.py                   ← Fetch hourly bars from IBKR
│   │   ├── validate.py               ← run_readiness_check() — 5 checks
│   │   ├── config.py                 ← .env loader
│   │   ├── lock_manager.py           ← PID lock + emergency lock
│   │   └── process_manager.py        ← Start/stop/kill main.py
│   ├── gui/
│   │   ├── app.py                    ← Flask backend (2,900 lines, 40+ routes)
│   │   ├── frontend/src/             ← React 18 UI
│   │   │   ├── App.js                ← Router (6 screens)
│   │   │   ├── screens/              ← ExperimentsScreen, EquityScreen, etc.
│   │   │   ├── components/           ← Shared UI components
│   │   │   ├── styles/theme.js       ← Colour tokens (LOCKED)
│   │   │   └── styles/format.js      ← Number/date formatters (LOCKED)
│   │   └── templates/                ← Jinja2 HTML (IB control panel, session)
│   └── tests/
│       ├── test_phase3_batch1.py     ← DB, data, executor, logger, validate
│       └── test_phase3_batch2.py     ← Broker, executor, main, signal match
│
├── experiments/                      ← Root-level experiment runners
│   ├── run_baseline_hourly_all_windows.py
│   ├── run_exp_hourly_all_windows.py
│   └── compare_daily_vs_hourly.py
│
├── docs/                             ← Internal reference docs
│   ├── wiki/                         ← This wiki (copy to GitHub Wiki)
│   ├── fill_exit_bug_history.md      ← v0.6.6/v0.6.7 bug history
│   └── ib_gateway_process.md         ← IB Gateway process architecture
│
├── config.yaml                       ← Active strategy config (DO NOT COMMIT)
├── config.yaml.example               ← Template for new machines
├── trading.db                        ← SQLite database (DO NOT COMMIT)
├── .env                              ← Environment variables (DO NOT COMMIT)
├── backup.py                         ← Milestone backup to Google Drive
├── conftest.py                       ← pytest path setup (adds all sub-roots)
├── pytest.ini                        ← Test discovery config
└── requirements.txt                  ← 13 pinned Python dependencies
```

---

## Backtest Data Flow

> **How to read:** Each numbered step is a function call. The warmup bars (250) run through the loop to initialise indicators but are excluded from metrics. The `iloc[:bar_idx+1]` slice at step 4 is the lookahead prevention mechanism — the signal sees only the past, never the future.

```mermaid
graph TD
    A["1️⃣ load_csv()\nRead TQQQ_1d.csv\nparse dates · set index"] --> B

    B["2️⃣ apply_adjustment()\nfactor = adj_close / close\nAdj_Open = Open × factor\nAdj_High = High × factor\nAdj_Low = Low × factor"] --> C

    C["3️⃣ slice_window()\nExtract warmup_from → date_to\nIncludes 250 warmup bars\nbefore the measurement period"] --> D

    D["4️⃣ FOR each bar_idx in range(len(bars)):\nbars_slice = bars.iloc[:bar_idx+1]\n⚠️ No lookahead — signal sees only history"] --> E

    E["5️⃣ indicators.py calculates on bars_slice:\nvwap = vwap_rolling(close, volume, 250)\nema  = ema(close, 10)\natr  = atr(high, low, close, 45)"] --> F

    F["6️⃣ signals.evaluate(bars_slice, config)\nCheck: close > vwap AND close > ema?\nReturn SignalResult(action, stop_price, ...)"] --> G

    G{"7️⃣ Action?"}
    G -->|BUY| H["8a️⃣ fill_entry(bar, 'long', config)\nfill = close + slippage\ncalc_position_size() → shares\nOpen position"]
    G -->|SELL| I["8b️⃣ fill_exit(bar, direction, stop, config)\nGap check: open ≤ stop? → fill at open\nIntraday: fill at min(close, stop)\nCalc PnL → close position"]
    G -->|HOLD| J["8c️⃣ calc_ratchet_stop()\nUpdate stop if in position\nNever moves against trade"]

    H --> K["9️⃣ compute_all(trades, equity_curve)\nCAGR · Sharpe · Calmar\nmax_dd · win_rate · r_multiple"]
    I --> K
    J --> K

    K --> L["🔟 save_run(run_id, config, metrics)\nrecorder.py → trading.db\nruns · trades · equity_curve tables"]
```

**Lookahead prevention — critical detail:**

```python
# WRONG — uses future data
signal = evaluate(bars, config, symbol)

# CORRECT — only data up to current bar
signal = evaluate(bars.iloc[:bar_idx + 1], config, symbol)
#                         ^^^^^^^^^^^^^^^^
#                 Nine characters that determine result validity
```

---

## Live Trading Data Flow

> **How to read:** The live loop runs continuously. At 15:00 ET each day, the signal path fires once. Every other minute, the stop monitoring path checks if the position should be closed. Both paths write to `trading.db`, which the dashboard reads.

```mermaid
sequenceDiagram
    participant IB as IB Gateway
    participant MAIN as main.py
    participant DATA as data.py
    participant ENG as engine/
    participant EXEC as executor.py
    participant BRK as broker.py
    participant DB as trading.db

    Note over MAIN: Startup sequence
    MAIN->>IB: connect() — port 4002 (paper)
    MAIN->>IB: reconcile_positions()
    IB-->>MAIN: current open position
    MAIN->>DB: Write startup event

    loop Every 60 minutes
        MAIN->>DATA: sync_hourly_db()
        DATA->>IB: reqHistoricalData(TQQQ, 1h)
        IB-->>DATA: hourly bars
        DATA->>DB: INSERT OR IGNORE TQQQ_1h

        MAIN->>DB: load_daily_bars_db()
        DB-->>MAIN: adjusted daily bars

        MAIN->>ENG: calc_ratchet_stop()
        Note over ENG: Update stop — NEVER moves down (long)
        MAIN->>DB: Write stop_update event

        MAIN->>EXEC: monitor_stops()
        EXEC->>DB: get last hourly bar
        alt bar_low ≤ ratchet_stop
            EXEC->>BRK: place_market_order(SELL)
            BRK->>IB: Submit market order
            IB-->>BRK: fill_price
            EXEC->>DB: Close trades_live row
        end
    end

    Note over MAIN: At 15:00 ET — once per calendar day
    MAIN->>ENG: evaluate(daily_bars, config)
    ENG-->>MAIN: SignalResult(action, stop_price, indicators)
    MAIN->>EXEC: act(signal, position)

    alt action = BUY (no position)
        EXEC->>BRK: place_limit_order(BUY, proxy_close + 0.05)
        BRK->>IB: Submit limit order
        BRK->>DB: INSERT orders_live (pending)
        IB-->>BRK: fill confirmed
        BRK->>DB: UPDATE orders_live (filled)
        EXEC->>DB: INSERT trades_live (open)
    else action = SELL (has position)
        EXEC->>BRK: place_market_order(SELL)
        BRK->>IB: Submit market order
        IB-->>BRK: fill confirmed
        EXEC->>DB: UPDATE trades_live (closed)
    else action = HOLD
        EXEC->>DB: INSERT signals_live (no order)
    end
```

---

## Deployment Modes

```mermaid
graph LR
    subgraph BACK["📊 Backtest Mode"]
        B1["config.yaml\nexecution.mode = backtest"]
        B2["python backtest/run.py"]
        B3["TQQQ_1d.csv\n(local file)"]
        B4["trading.db\n(results stored)"]
        B1 --> B2
        B3 --> B2
        B2 --> B4
    end

    subgraph PAPER["🧪 Paper Mode"]
        P1["config.yaml\nlive.mode = paper\nlive.ibkr_port = 4002"]
        P2[".env\nENV=dev\nIB_PORT=4002"]
        P3["IB Gateway\nPort 4002\nSimulated fills"]
        P4["python live/main.py"]
        P5["trading.db\n(live events)"]
        P1 --> P4
        P2 --> P4
        P3 --> P4
        P4 --> P5
    end

    subgraph LIVE["🔴 Live Mode"]
        L1["config.yaml\nlive.mode = live\nlive.ibkr_port = 4001"]
        L2[".env\nENV=live\nIB_PORT=4001\nALLOW_LIVE_PORT=true"]
        L3["IB Gateway\nPort 4001\nReal money orders"]
        L4["python live/main.py"]
        L5["trading.db\n(live events)"]
        L1 --> L4
        L2 --> L4
        L3 --> L4
        L4 --> L5
    end
```

**Critical safety rule:** Port 4002 (paper) and port 4001 (live) are enforced in [`broker.py:_safety_check()`](Ref-IB-Broker#_safety_check). Any mismatch raises `RuntimeError` before any order is placed. See [IB Gateway Integration](IB-Gateway-Integration#safety-checks) for full details.

| Attribute | Backtest | Paper | Live |
|-----------|---------|-------|------|
| IB Gateway required | No | Yes | Yes |
| Real money | No | No | **Yes** |
| Port | — | 4002 | 4001 |
| `dry_run` flag | n/a | `true` recommended | `false` |
| DB tables used | `runs`, `trades`, `baselines` | `*_live` tables | `*_live` tables |
| Fills | Simulated (close/stop/open) | IB simulated | IB real |

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Language | Python | 3.9+ | All backend code |
| Data | pandas | 2.2.3 | DataFrame operations |
| Data | numpy | 1.26.4 | Numerical calculations |
| Config | pyyaml | 6.0.1 | YAML config loading |
| Data source | yfinance | 0.2.31 | Yahoo Finance download |
| IB API | ib_insync | 0.9.86 | Interactive Brokers wrapper |
| Web backend | Flask | 3.0.0 | Dashboard API server |
| Web server | waitress | — | Production WSGI |
| Web frontend | React 18 | — | Dashboard UI |
| Charts | Recharts | — | Equity curves, grids |
| Styling | Tailwind CSS | — | UI styling |
| Database | SQLite | — | WAL mode, no server needed |
| ML (future) | scikit-learn | 1.3.2 | Phase 4 ML features |
| ML (future) | xgboost | 2.0.3 | Phase 4 ML model |
| Market calendar | pandas_market_calendars | 5.3.1.2 | NYSE holiday detection |
| Testing | pytest | 7.4.3 | Test runner |
| Coverage | pytest-cov | 4.1.0 | Code coverage reports |

---

## Database Overview

`trading.db` is a single SQLite file used by both backtest and live systems. The two sections never conflict — they use completely separate tables.

```mermaid
erDiagram
    runs ||--o{ trades : "has many"
    runs ||--o{ baselines : "compared against"
    runs }o--|| data_windows : "belongs to"
    runs }o--|| experiments : "tagged as"

    trades_live ||--o{ orders_live : "creates"
    signals_live ||--o{ trades_live : "triggers"
    Events_log_live ||--o{ session_events_live : "summarised in"
    config_log_live ||--o{ Events_log_live : "session groups"

    runs {
        TEXT run_id PK
        TEXT experiment_id
        TEXT window_label
        REAL cagr_annual_pct
        REAL calmar_ratio
        REAL max_drawdown_pct
        TEXT equity_curve "JSON array"
        TEXT config_snapshot "JSON blob"
    }

    trades_live {
        TEXT trade_id PK
        TEXT symbol
        TEXT direction "long or short"
        REAL entry_price
        REAL exit_price
        REAL stop_price
        REAL pnl_dollar
        TEXT exit_reason
    }

    Events_log_live {
        INT event_id PK
        TEXT session_id
        TEXT level "INFO/WARN/ERROR/CRITICAL"
        TEXT event_type
        TEXT details "JSON blob"
    }
```

**Backtest tables** (populated by `recorder.py`): `runs`, `trades`, `baselines`, `data_windows`, `experiments`

**Live tables** (populated by `db.py` / `db_setup.py`): `TQQQ_1h`, `orders_live`, `trades_live`, `signals_live`, `Events_log_live`, `Events_log_live_archive`, `config_log_live`, `circuit_breaker_live`, `daily_equity_live`, `hourly_snapshot_live`, `session_events_live`, `nav_snapshots`, `process_heartbeat`

> Full schema with all columns and sample queries: [Database Schema](Database-Schema)

---

## Key Architectural Decisions

| Decision | What | Why |
|----------|------|-----|
| **Engine isolation** | `engine/` has zero project imports | Enables unit testing without any I/O; reusable across strategies |
| **SQLite WAL mode** | Write-Ahead Logging enabled | Allows concurrent reads while live loop writes |
| **Flat config** | Single `config.yaml` → `Config` dataclass | One source of truth; config snapshots stored in DB for reproducibility |
| **No auto-correct** | Position mismatch aborts startup | Prevents data loss from wrong assumption about which source is authoritative |
| **Manual EMA loop** | `ema()` uses manual loop, not `pandas.ewm()` | Exact control over seeding; `ewm()` produces different results at boundary |
| **Gap-aware fill** | `fill_exit()` checks open vs stop | Prevents unrealistic fills when stock gaps through stop overnight |
| **Warmup = VWAP period** | `warmup_bars = 250` | Matches longest indicator (VWAP); shorter warmup → NaN signals |

> Impact of changing any of these: [Impact Matrix](Impact-Matrix)
> Full function signatures: [Ref-Engine-Core](Ref-Engine-Core)
