# Backtester-v2 Codebase Guide

> A comprehensive walkthrough with tree structure, file summaries, and key line references.

---

## 📁 Directory Tree

```
src/
├── index.ts                          # 🚀 Main entry point & public API
├── algo.ts                           # Algorithm state serialization
│
├── core/                             # 🧱 Foundation types & constants
│   ├── types.ts                      # All TypeScript interfaces
│   ├── config.ts                     # Configuration schemas (Zod)
│   └── constants.ts                  # Magic numbers & defaults
│
├── config/                           # ⚙️ Configuration management
│   ├── index.ts                      # Config exports
│   ├── types.ts                      # Config-specific types
│   ├── validation.ts                 # Input validation
│   ├── version-manager.ts            # Algo versioning
│   ├── run-manager.ts                # Run tracking
│   └── comparison.ts                 # Config diffing
│
├── interfaces/                       # 🔌 Dependency Injection contracts
│   ├── index.ts                      # Interface exports
│   ├── executor.ts                   # IExecutor interface
│   ├── database.ts                   # IDatabase interface
│   └── indicator-feed.ts             # IIndicatorFeed interface
│
├── factory/                          # 🏭 Implementation factories
│   ├── index.ts                      # Factory exports
│   ├── backtest-factory.ts           # Creates fake implementations
│   └── live-factory.ts               # Creates real implementations
│
├── indicators/                       # 📊 Indicator pre-calculation
│   ├── calculator.ts                 # Signal pre-computation
│   ├── evaluator.ts                  # Condition evaluation
│   └── resampler.ts                  # Multi-resolution alignment
│
├── events/                           # 📡 Event system
│   ├── index.ts                      # Event exports
│   ├── types.ts                      # Event type definitions
│   └── collector.ts                  # Event aggregation
│
├── simulation/                       # 🎮 Core simulation engine
│   ├── algo-runner.ts                # Main simulation loop
│   ├── state-machine.ts              # Position state (FLAT/LONG/SHORT)
│   ├── loop.ts                       # Legacy loop (deprecated)
│   │
│   ├── stages/                       # 📦 6-Stage Pipeline
│   │   ├── index.ts                  # Pipeline orchestrator
│   │   ├── data-loading.ts           # Stage 1: Load & filter candles
│   │   ├── indicator-calculation.ts  # Stage 2: Pre-compute signals
│   │   ├── resampling.ts             # Stage 3: Align to sim resolution
│   │   ├── initialization.ts         # Stage 4: Create DI environment
│   │   └── output.ts                 # Stage 6: Generate results
│   │
│   ├── fakes/                        # 🎭 Backtest implementations
│   │   ├── index.ts                  # Fake exports
│   │   ├── fake-executor.ts          # Simulates order execution
│   │   ├── fake-database.ts          # In-memory event storage
│   │   └── pre-calculated-feed.ts    # Serves pre-computed signals
│   │
│   └── special-indicators/           # 🎯 Per-trade indicators
│       ├── index.ts                  # Special indicator exports
│       ├── types.ts                  # Type definitions
│       ├── base.ts                   # Base class
│       ├── registry.ts               # Indicator registry
│       ├── operators.ts              # Condition operators
│       ├── stop-loss.ts              # Fixed stop loss
│       ├── take-profit.ts            # Fixed take profit
│       ├── trailing-stop.ts          # Trailing stop
│       └── balance.ts                # P&L tracking
│
├── output/                           # 📈 Results & metrics
│   ├── types.ts                      # Output type definitions
│   ├── metrics.ts                    # Portfolio metrics (Sharpe, etc)
│   ├── swap-metrics.ts               # Trade statistics
│   ├── algo-metrics.ts               # Algorithm analytics
│   ├── equity-curve.ts               # Equity curve generation
│   └── trade-recorder.ts             # Trade event pairing
│
└── utils/                            # 🔧 Utilities
    ├── math.ts                       # Math helpers
    ├── financial-math.ts             # Financial calculations
    └── downsampling.ts               # Data downsampling
```

---

## 🚀 Entry Point

### `src/index.ts` - Main API

The public interface to the backtester.

| Lines | Function | Description |
|-------|----------|-------------|
| **47-51** | `runBacktestWithEvents()` | Main entry point - runs full backtest |
| **117-119** | Indicator pre-calc | Where signals are computed upfront |
| **487-488** | Modern exports | DI-based architecture exports |

```typescript
// Line 47-51: The main function users call
export async function runBacktestWithEvents(
  candles: Candle[],
  algoParams: AlgoParams,
  runSettings: RunSettings
): Promise<BacktestResult>
```

---

## 🧱 Core Module

### `src/core/types.ts` - Type Definitions

All TypeScript interfaces live here.

| Lines | Type | Description |
|-------|------|-------------|
| **15-25** | `Candle` | OHLCV data structure |
| **45-60** | `AlgoParams` | Algorithm configuration |
| **80-95** | `RunSettings` | Backtest settings |
| **120-140** | `Direction` | `"LONG" \| "SHORT"` |
| **160-180** | `ValueConfig` | `ABS \| REL \| DYN` value types |

### `src/core/config.ts` - Zod Schemas

Runtime validation schemas for all configs.

| Lines | Schema | Description |
|-------|--------|-------------|
| **20-40** | `CandleSchema` | Validates candle data |
| **50-80** | `AlgoParamsSchema` | Validates algo config |
| **90-120** | `RunSettingsSchema` | Validates run settings |

---

## 📦 Pipeline Stages

### `src/simulation/stages/index.ts` - Pipeline Orchestrator

The heart of the backtester - orchestrates all 6 stages.

| Lines | Section | Description |
|-------|---------|-------------|
| **1-77** | ASCII Diagram | Visual pipeline documentation |
| **209-315** | `runBacktestPipeline()` | Main orchestration function |

```
Pipeline Flow:
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: Data Loading                                      │
│  ├─ Filter candles by date range                           │
│  └─ Validate data integrity                                │
├─────────────────────────────────────────────────────────────┤
│  Stage 2: Indicator Pre-Calculation                         │
│  ├─ Compute ALL indicator signals upfront                  │
│  └─ Calculate warmup requirements                          │
├─────────────────────────────────────────────────────────────┤
│  Stage 3: Signal Resampling                                 │
│  ├─ Align signals to simulation resolution                 │
│  └─ Convert warmup candles → warmup bars                   │
├─────────────────────────────────────────────────────────────┤
│  Stage 4: Initialization                                    │
│  ├─ Create DI environment (fakes for backtest)             │
│  └─ Initialize AlgoRunner with injected dependencies       │
├─────────────────────────────────────────────────────────────┤
│  Stage 5: Simulation Loop                                   │
│  ├─ Process each bar through AlgoRunner.onBar()            │
│  ├─ State machine handles position transitions             │
│  └─ FakeExecutor records SwapEvents                        │
├─────────────────────────────────────────────────────────────┤
│  Stage 6: Output Generation                                 │
│  ├─ Pair SwapEvents into TradeEvents                       │
│  ├─ Calculate metrics (Sharpe, drawdown, etc)              │
│  └─ Build equity curve                                     │
└─────────────────────────────────────────────────────────────┘
```

---

### `src/simulation/stages/data-loading.ts` - Stage 1

Loads and filters candle data.

| Lines | Function | Description |
|-------|----------|-------------|
| **96-120** | `executeDataLoading()` | Main stage function |
| **45-60** | Date filtering | Filters by start/end date |
| **70-85** | Validation | Checks data integrity |

---

### `src/indicators/calculator.ts` - Stage 2

Pre-computes ALL indicator signals before simulation.

| Lines | Function | Description |
|-------|----------|-------------|
| **67-124** | `calculateIndicators()` | Main calculation function |
| **87-88** | Warmup calculation | Determines warmup from indicator requirements |
| **100-108** | Signal padding | Pads results with `false` for warmup period |

```typescript
// Lines 87-88: Warmup calculation
const requirements = indicator.getPointRequirements();
maxWarmup = Math.max(maxWarmup, requirements.count);
```

**Key Insight**: Signals are computed ONCE here, not per-bar during simulation.

---

### `src/simulation/stages/resampling.ts` - Stage 3

Aligns multi-resolution indicators to a common timeframe.

| Lines | Function | Description |
|-------|----------|-------------|
| **163-267** | `executeResampling()` | Main resampling function |
| **255** | Warmup conversion | `warmupCandles → warmupBars` |
| **204-227** | Forward-fill | Sample-and-hold signal alignment |

```typescript
// Line 255: Warmup conversion formula
const warmupBars = Math.ceil((warmupCandles * MIN_SIMULATION_RESOLUTION) / simulationResolution);
```

---

### `src/simulation/stages/initialization.ts` - Stage 4

Creates the DI environment with fake implementations.

| Lines | Function | Description |
|-------|----------|-------------|
| **80-150** | `executeInitialization()` | Creates DI environment |
| **95-100** | FakeExecutor creation | Simulates order execution |
| **105-110** | FakeDatabase creation | In-memory event storage |
| **115-120** | PreCalculatedFeed creation | Serves pre-computed signals |

---

### `src/simulation/stages/output.ts` - Stage 6

Generates final results from collected events.

| Lines | Function | Description |
|-------|----------|-------------|
| **50-120** | `executeOutput()` | Main output generation |
| **70-80** | Trade pairing | Pairs SwapEvents → TradeEvents |
| **90-100** | Metrics calculation | Sharpe, Sortino, drawdown |
| **105-115** | Equity curve | Builds equity over time |

---

## 🎮 Simulation Engine

### `src/simulation/algo-runner.ts` - Stage 5 Core

The main simulation loop that processes each bar.

| Lines | Function | Description |
|-------|----------|-------------|
| **165-203** | `onBar()` | Main per-bar processing |
| **174** | Warmup check | `if (barIndex < this.warmupBars)` |
| **186** | Entry blocking | Skips entries during warmup |
| **355-364** | `checkConditionTrigger()` | Edge detection logic |

```typescript
// Lines 355-364: Edge detection
private checkConditionTrigger(conditionType: ConditionType): boolean {
    const snapshot = this.indicatorFeed.getConditionSnapshot(conditionType);
    const previousMet = this.indicatorFeed.getPreviousConditionMet(conditionType);

    if (this.config.assumePositionImmediately) {
        return snapshot.conditionMet;           // Enter whenever TRUE
    } else {
        return !previousMet && snapshot.conditionMet;  // Edge: false→true only
    }
}
```

**Key Insight**: Edge detection prevents re-entry when signal stays true.

---

### `src/simulation/state-machine.ts` - Position State

Manages position state transitions.

| Lines | Function | Description |
|-------|----------|-------------|
| **72-79** | State enum | `FLAT`, `LONG`, `SHORT` |
| **123-141** | Guard methods | `canEnterLong()`, `canEnterShort()`, `canExit()` |
| **153-190** | Transitions | `enterLong()`, `enterShort()`, `exit()` |

```
State Diagram:
         enterLong()
    ┌────────────────────┐
    │                    ▼
  FLAT ◄──────────────► LONG
    │      exit()
    │
    │      exit()
    ▼
  SHORT ◄────────────────┘
         enterShort()

Note: No direct LONG ↔ SHORT transition
      Must go through FLAT first
```

---

## 🎭 Fake Implementations (DI)

### `src/simulation/fakes/fake-executor.ts` - Order Simulation

Simulates order execution for backtesting.

| Lines | Function | Description |
|-------|----------|-------------|
| **144-298** | `placeOrder()` | Simulates order with slippage/fees |
| **200-220** | Slippage calc | `price * (1 ± slippageBps/10000)` |
| **250-280** | Fee calc | `notional * feeBps/10000` |
| **364-390** | SwapEvent creation | Records each order as event |

```typescript
// Lines 200-220: Slippage application
const slippageMultiplier = direction === "LONG"
    ? 1 + slippageBps / 10000   // Pay more when buying
    : 1 - slippageBps / 10000;  // Receive less when selling
const executedPrice = price * slippageMultiplier;
```

---

### `src/simulation/fakes/pre-calculated-feed.ts` - Signal Server

Serves pre-computed signals to AlgoRunner.

| Lines | Function | Description |
|-------|----------|-------------|
| **50-80** | `setBarIndex()` | Updates current bar position |
| **90-120** | `getCurrentSignals()` | Returns signals for current bar |
| **130-160** | `getConditionSnapshot()` | Evaluates condition at bar |
| **170-190** | `getPreviousConditionMet()` | For edge detection |

---

### `src/simulation/fakes/fake-database.ts` - Event Storage

In-memory storage for backtest events.

| Lines | Function | Description |
|-------|----------|-------------|
| **30-50** | `logSwapEvent()` | Stores swap events |
| **60-80** | `logAlgoEvent()` | Stores algorithm events |
| **90-110** | `getSwapEvents()` | Retrieves all swaps |

---

## 🎯 Special Indicators

Created per-trade, destroyed on exit. Unlike regular indicators (pre-computed), these maintain state during a position.

### `src/simulation/special-indicators/base.ts` - Base Class

| Lines | Function | Description |
|-------|----------|-------------|
| **30-50** | `reset()` | Called on trade entry |
| **60-80** | `calculate()` | Process price batch |
| **90-100** | `isTriggered()` | Check if exit triggered |

### `src/simulation/special-indicators/stop-loss.ts`

| Lines | Function | Description |
|-------|----------|-------------|
| **57-68** | `onReset()` | Calculates SL price level |
| **78-109** | `calculate()` | Checks if SL hit |

```typescript
// Lines 61-67: Stop loss calculation
if (this.config.direction === "LONG") {
    this.stopLossPrice = this.entryPrice - offset;  // Below entry
} else {
    this.stopLossPrice = this.entryPrice + offset;  // Above entry
}
```

### `src/simulation/special-indicators/take-profit.ts`

| Lines | Function | Description |
|-------|----------|-------------|
| **57-68** | `onReset()` | Calculates TP price level |
| **78-109** | `calculate()` | Checks if TP hit |

### `src/simulation/special-indicators/trailing-stop.ts`

| Lines | Function | Description |
|-------|----------|-------------|
| **60-75** | `onReset()` | Initializes trailing state |
| **85-130** | `calculate()` | Updates trailing level, checks hit |

```typescript
// Trailing stop logic:
// LONG: Track highest price, SL trails below it
// SHORT: Track lowest price, SL trails above it
```

---

## 📈 Output Module

### `src/output/metrics.ts` - Portfolio Metrics

| Lines | Function | Description |
|-------|----------|-------------|
| **30-50** | `calculateSharpeRatio()` | Risk-adjusted returns |
| **60-80** | `calculateSortinoRatio()` | Downside-only volatility |
| **90-110** | `calculateMaxDrawdown()` | Worst peak-to-trough |
| **120-140** | `calculateCalmarRatio()` | Return / max drawdown |

### `src/output/swap-metrics.ts` - Trade Statistics

| Lines | Function | Description |
|-------|----------|-------------|
| **40-100** | `calculateSwapMetrics()` | Win rate, profit factor, etc |
| **60-70** | Long/short separation | Separate stats by direction |

### `src/output/trade-recorder.ts` - Event Pairing

| Lines | Function | Description |
|-------|----------|-------------|
| **30-80** | `buildTradeEvents()` | Pairs entry/exit SwapEvents |
| **50-60** | P&L calculation | Computes per-trade profit |

---

## 🔌 Interfaces (DI Contracts)

### `src/interfaces/executor.ts`

```typescript
interface IExecutor {
    placeOrder(direction: Direction, size: number, price: number): SwapEvent;
    getPosition(): Position;
    closePosition(price: number): SwapEvent;
}
```

### `src/interfaces/database.ts`

```typescript
interface IDatabase {
    logSwapEvent(event: SwapEvent): void;
    logAlgoEvent(event: AlgoEvent): void;
    getSwapEvents(): SwapEvent[];
    getAlgoEvents(): AlgoEvent[];
}
```

### `src/interfaces/indicator-feed.ts`

```typescript
interface IIndicatorFeed {
    setBarIndex(index: number): void;
    getCurrentSignals(key: string): boolean;
    getConditionSnapshot(type: ConditionType): ConditionSnapshot;
    getPreviousConditionMet(type: ConditionType): boolean;
}
```

---

## 🔑 Key Concepts Summary

### 1. Pre-Calculation (Not Per-Bar)
```
❌ Wrong: Calculate EMA at each bar during simulation
✅ Right: Calculate ALL EMAs upfront in Stage 2, lookup during Stage 5
```

### 2. Dependency Injection Pattern
```
Backtest:  AlgoRunner ← FakeExecutor, FakeDatabase, PreCalculatedFeed
Live:      AlgoRunner ← RealExecutor, RealDatabase, LiveIndicatorFeed
```

### 3. Edge Detection
```
assumePositionImmediately = false (default):
  Enter only on FALSE → TRUE transition

assumePositionImmediately = true:
  Enter whenever signal is TRUE
```

### 4. Warmup Flow
```
Stage 2: warmupCandles = max(indicator requirements)
Stage 3: warmupBars = ceil(warmupCandles * 60 / simResolution)
Stage 5: if (barIndex < warmupBars) skip entry
```

### 5. State Machine
```
FLAT → LONG → FLAT → SHORT → FLAT
     ↑____________________________|

No direct LONG ↔ SHORT (must exit first)
```

---

## 📊 Codebase Metrics

| Metric | Value |
|--------|-------|
| Production Lines | ~15,000 |
| Test Lines | ~9,600 |
| Total Tests | 510 |
| Test-to-Code Ratio | 64% |
| Core Modules | 8 |
| Pipeline Stages | 6 |

---

## 🎯 Quick Navigation

| To Understand... | Read This File | Key Lines |
|-----------------|----------------|-----------|
| Main API | `src/index.ts` | 47-51 |
| Pipeline flow | `src/simulation/stages/index.ts` | 1-77, 209-315 |
| Indicator pre-calc | `src/indicators/calculator.ts` | 67-124 |
| Signal resampling | `src/simulation/stages/resampling.ts` | 163-267 |
| Per-bar processing | `src/simulation/algo-runner.ts` | 165-203 |
| Edge detection | `src/simulation/algo-runner.ts` | 355-364 |
| State machine | `src/simulation/state-machine.ts` | 72-79, 153-190 |
| Order simulation | `src/simulation/fakes/fake-executor.ts` | 144-298 |
| Warmup handling | Multiple files | See "Warmup Flow" above |

---

## 🔄 Data Flow Visualization

```
User Input
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Candles[]  +  AlgoParams  +  RunSettings                       │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 1: Data Loading                                          │
│  ───────────────────                                            │
│  Input:  Raw candles, date range                                │
│  Output: Filtered candles                                       │
│  File:   src/simulation/stages/data-loading.ts                  │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 2: Indicator Pre-Calculation                             │
│  ──────────────────────────────────                             │
│  Input:  Filtered candles, indicator configs                    │
│  Output: SignalCache (boolean[] per indicator), warmupCandles   │
│  File:   src/indicators/calculator.ts                           │
│                                                                 │
│  KEY: All signals computed ONCE here, not per-bar later!        │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 3: Signal Resampling                                     │
│  ─────────────────────────                                      │
│  Input:  SignalCache at various resolutions                     │
│  Output: ResampledSignalCache at simulation resolution          │
│  File:   src/simulation/stages/resampling.ts                    │
│                                                                 │
│  KEY: Forward-fills (sample-and-hold) for alignment             │
│  KEY: warmupCandles → warmupBars conversion                     │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 4: Initialization                                        │
│  ───────────────────────                                        │
│  Creates DI environment:                                        │
│  • FakeExecutor     → simulates orders                          │
│  • FakeDatabase     → stores events in memory                   │
│  • PreCalculatedFeed → serves pre-computed signals              │
│  File:   src/simulation/stages/initialization.ts                │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 5: Simulation Loop                                       │
│  ───────────────────────                                        │
│  for each bar:                                                  │
│    1. Skip if warmup period                                     │
│    2. Check exit conditions (if in position)                    │
│    3. Check entry conditions (if flat)                          │
│    4. Execute orders via FakeExecutor → SwapEvents              │
│                                                                 │
│  File:   src/simulation/algo-runner.ts                          │
│                                                                 │
│  State Machine: FLAT ↔ LONG, FLAT ↔ SHORT                       │
│  Edge Detection: Enter only on false→true transition            │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 6: Output Generation                                     │
│  ─────────────────────────                                      │
│  1. Pair SwapEvents → TradeEvents                               │
│  2. Calculate metrics (Sharpe, Sortino, etc)                    │
│  3. Build equity curve                                          │
│  File:   src/simulation/stages/output.ts                        │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  BacktestResult                                                 │
│  ─────────────────────────────────────────────────              │
│  • trades: TradeEvent[]                                         │
│  • metrics: { sharpe, sortino, maxDrawdown, winRate, ... }      │
│  • equityCurve: EquityPoint[]                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🧪 Test Coverage

```
src/__tests__/
├── test-utils.ts                     # Mock factories
├── fixtures/
│   └── load-candles.ts               # Sample data loader
└── integration/
    ├── ema-crossover-backtest.test.ts
    ├── debug-pipeline.test.ts
    └── debug-signals.test.ts

src/simulation/__tests__/
├── algo-runner.test.ts               # AlgoRunner unit tests
├── loop.test.ts                      # Loop tests
├── operators.test.ts                 # Operator tests
├── special-indicators.test.ts        # SL/TP/Trailing tests
└── state-machine.test.ts             # State machine tests

src/simulation/stages/__tests__/
├── data-loading.test.ts
├── indicator-calculation.test.ts
├── initialization.test.ts
├── output.test.ts
└── resampling.test.ts

src/output/__tests__/
├── metrics.test.ts
└── swap-metrics.test.ts

src/events/__tests__/
└── collector.test.ts

Total: 510 tests
```
