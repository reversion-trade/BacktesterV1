# File Structure Diagram

How files relate to each other in the backtester.

## Directory Overview

```
src/
├── index.ts                    # Public API entry point
├── core/                       # Type definitions and config schemas
│   ├── types.ts               # Core types (Candle, AlgoParams, Direction, etc.)
│   ├── config.ts              # Zod schemas and BacktestInput type
│   └── constants.ts           # Global constants
├── events/                     # Event system
│   ├── types.ts               # Event types (SwapEvent, TradeEvent, AlgoEvent)
│   ├── collector.ts           # EventCollector class
│   └── index.ts               # Event exports
├── indicators/                 # Indicator calculation
│   ├── calculator.ts          # Core indicator calculation logic
│   ├── evaluator.ts           # Signal evaluation
│   └── resampler.ts           # Signal resampling utilities
├── output/                     # Output generation
│   ├── types.ts               # Output types (EquityPoint, SimulationResult)
│   ├── swap-metrics.ts        # Calculate SwapMetrics from trades
│   ├── algo-metrics.ts        # Calculate AlgoMetrics from events
│   └── equity-curve.ts        # Equity curve utilities
├── simulation/                 # Simulation engine
│   ├── stages/                # Pipeline stages (see below)
│   ├── event-driven/          # Event-driven simulation engine
│   ├── special-indicators/    # SL/TP/Trailing indicators
│   ├── mipmap/                # Multi-resolution candle cache
│   └── fakes/                 # Test doubles
└── utils/                      # Utilities
    ├── math.ts                # Math helpers
    ├── financial-math.ts      # P&L, fees, slippage
    └── downsampling.ts        # Data downsampling
```

---

## Import Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             EXTERNAL                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  @indicators/common.ts        @indicators/factory.ts                        │
│  └── Candle, ChartPoint       └── IndicatorConfig, makeIndicator()          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CORE LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   core/types.ts ◄────────────────────────────────────────────────────┐     │
│   ├── re-exports Candle, ChartPoint, IndicatorConfig                 │     │
│   └── defines: AlgoParams, Direction, PositionState, ValueConfig...  │     │
│                │                                                     │     │
│                ▼                                                     │     │
│   core/config.ts                                                     │     │
│   ├── imports: AlgoParams, Direction from types.ts                   │     │
│   └── defines: BacktestInput, AlgoConfig, RunSettings (Zod schemas)  │     │
│                                                                      │     │
│   core/constants.ts ─────────────────────────────────────────────────┘     │
│   └── DEFAULT_SLIPPAGE_BPS, DEFAULT_FEE_BPS, etc.                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EVENTS LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   events/types.ts                                                           │
│   ├── imports: Direction, PositionState from core/types.ts                  │
│   └── defines: SwapEvent, TradeEvent, AlgoEvent, SwapMetrics...            │
│                │                                                            │
│                ▼                                                            │
│   events/collector.ts                                                       │
│   └── EventCollector class for tracking events during simulation           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          OUTPUT LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   output/types.ts                                                           │
│   ├── re-exports: all types from events/types.ts                           │
│   └── defines: EquityPoint, SimulationResult                               │
│                │                                                            │
│   ┌────────────┼────────────┐                                              │
│   ▼            ▼            ▼                                              │
│   swap-metrics.ts    algo-metrics.ts    equity-curve.ts                    │
│   │                  │                  │                                  │
│   └── calculateSwapMetrics()  └── calculateAlgoMetrics()  └── utilities   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SIMULATION LAYER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   simulation/stages/index.ts ◄─── MAIN ORCHESTRATOR                        │
│   └── runBacktestPipeline() - coordinates all stages                       │
│                │                                                            │
│   ┌────────────┴────────────────────────────────────────────┐              │
│   ▼            ▼            ▼            ▼            ▼     ▼              │
│   Stage 1      Stage 1.1    Stage 1.5    Stage 1.6    Stage 2    ...       │
│   data-        mipmap-      subbar-      valuefactor- indicator-           │
│   loading.ts   building.ts  loading.ts   loading.ts   calculation.ts       │
│                                                                             │
│   Stage 3           Stage 4              Stage 5          Stage 6          │
│   resampling.ts     initialization.ts    (event-driven)   output.ts        │
│                                                                             │
│   ────────────────────────────────────────────────────────────────         │
│                                                                             │
│   simulation/event-driven/index.ts                                         │
│   ├── mergeIntoHeap() - build priority queue                               │
│   ├── extractSimulationEvents() - convert signals to events                │
│   └── runEventDrivenSimulation() - process events                          │
│                                                                             │
│   ────────────────────────────────────────────────────────────────         │
│                                                                             │
│   simulation/special-indicators/                                           │
│   ├── base.ts ──────────────► SpecialIndicator abstract class             │
│   ├── stop-loss.ts ─────────► StopLossIndicator                           │
│   ├── take-profit.ts ───────► TakeProfitIndicator                         │
│   ├── trailing-stop.ts ─────► TrailingStopIndicator                       │
│   └── balance.ts ───────────► BalanceIndicator                            │
│                                                                             │
│   ────────────────────────────────────────────────────────────────         │
│                                                                             │
│   simulation/mipmap/                                                        │
│   ├── types.ts ─────────────► MipMapCache, CandleResolution               │
│   ├── builder.ts ───────────► buildMipMap() function                       │
│   └── aggregation.ts ───────► aggregateCandles() utilities                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PUBLIC API (src/index.ts)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   EXPORTS:                                                                  │
│   ├── runBacktestWithEvents() ─────► Main function (validates + runs)      │
│   ├── runBacktestPipeline() ───────► Direct pipeline access                │
│   │                                                                         │
│   ├── Types from core/types.ts ────► Candle, AlgoParams, Direction...      │
│   ├── Types from events/types.ts ──► SwapEvent, TradeEvent, AlgoEvent...   │
│   ├── Types from output/types.ts ──► BacktestOutput, EquityPoint...        │
│   │                                                                         │
│   ├── Schemas from core/config.ts ─► BacktestInputSchema, etc.             │
│   ├── EventCollector ──────────────► For custom event tracking             │
│   ├── calculateSwapMetrics() ──────► Standalone metrics calculation        │
│   ├── calculateAlgoMetrics() ──────► Standalone algo metrics               │
│   └── Special indicators ──────────► StopLossIndicator, etc.               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline Stage Dependencies

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE DATA FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Candle[] + BacktestInput                                                  │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────┐                                  │
│   │ Stage 1: data-loading.ts            │                                  │
│   │ ─────────────────────────           │                                  │
│   │ In:  Candle[], BacktestInput        │                                  │
│   │ Out: DataLoadingResult              │                                  │
│   │      ├── filteredCandles            │                                  │
│   │      ├── validatedInput             │                                  │
│   │      └── tradingStartIndex          │                                  │
│   └─────────────────────────────────────┘                                  │
│         │                                                                   │
│         ├───────────────────────────────┬───────────────────────────────┐  │
│         ▼                               ▼                               │  │
│   ┌─────────────────────────┐   ┌─────────────────────────┐            │  │
│   │ Stage 1.1: mipmap-      │   │ Stage 1.5: subbar-      │            │  │
│   │ building.ts             │   │ loading.ts              │            │  │
│   │ ─────────────────────   │   │ ─────────────────────   │            │  │
│   │ In:  filteredCandles    │   │ In:  filteredCandles    │            │  │
│   │ Out: MipMapBuildingResult│   │ Out: SubBarLoadingResult│            │  │
│   │      └── mipMapCache    │   │      └── subBarCandlesMap│           │  │
│   └─────────────────────────┘   └─────────────────────────┘            │  │
│         │                               │                               │  │
│         │                               ▼                               │  │
│         │                       ┌─────────────────────────┐            │  │
│         │                       │ Stage 1.6: valuefactor- │            │  │
│         │                       │ loading.ts              │            │  │
│         │                       │ ─────────────────────── │            │  │
│         │                       │ In:  SubBarLoadingResult│            │  │
│         │                       │ Out: ValueFactorResult  │            │  │
│         │                       │      └── factor lookups │            │  │
│         │                       └─────────────────────────┘            │  │
│         ▼                               │                               │  │
│   ┌─────────────────────────────────────┘                              │  │
│   │                                                                     │  │
│   ▼                                                                     │  │
│   ┌─────────────────────────────────────┐                              │  │
│   │ Stage 2: indicator-calculation.ts   │◄─────────────────────────────┘  │
│   │ ─────────────────────────────────   │                                  │
│   │ In:  MipMapBuildingResult, AlgoParams                                 │
│   │ Out: IndicatorCalculationResult     │                                  │
│   │      └── signals (Map<string, boolean[]>)                             │
│   └─────────────────────────────────────┘                                  │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────┐                                  │
│   │ Stage 3: resampling.ts              │                                  │
│   │ ──────────────────────              │                                  │
│   │ In:  filteredCandles, signals       │                                  │
│   │ Out: ResamplingResult               │                                  │
│   │      └── resampledSignals           │                                  │
│   └─────────────────────────────────────┘                                  │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────┐                                  │
│   │ Stage 4: initialization.ts          │                                  │
│   │ ─────────────────────────           │                                  │
│   │ In:  DataLoadingResult, ResamplingResult                              │
│   │ Out: InitializationResult           │                                  │
│   │      ├── indicatorInfoMap           │                                  │
│   │      └── initial state params       │                                  │
│   └─────────────────────────────────────┘                                  │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────┐                                  │
│   │ Stage 5: event-driven/index.ts      │                                  │
│   │ ───────────────────────────         │                                  │
│   │ In:  event heap, candles, config    │                                  │
│   │ Out: EventSimulatorResult           │                                  │
│   │      ├── swapEvents                 │                                  │
│   │      ├── trades                     │                                  │
│   │      └── equityCurve                │                                  │
│   └─────────────────────────────────────┘                                  │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────┐                                  │
│   │ Stage 6: output.ts                  │                                  │
│   │ ────────────────                    │                                  │
│   │ In:  SimulationResult, DataResult   │                                  │
│   │ Out: BacktestOutput                 │                                  │
│   │      ├── config                     │                                  │
│   │      ├── events (swap + algo)       │                                  │
│   │      ├── trades                     │                                  │
│   │      ├── equityCurve                │                                  │
│   │      ├── swapMetrics                │                                  │
│   │      └── algoMetrics                │                                  │
│   └─────────────────────────────────────┘                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Purpose Quick Reference

| File | Purpose |
|------|---------|
| **core/types.ts** | All shared type definitions |
| **core/config.ts** | Zod validation schemas |
| **events/types.ts** | Event and metrics type definitions |
| **events/collector.ts** | Event tracking during simulation |
| **indicators/calculator.ts** | Run indicators, get boolean signals |
| **output/swap-metrics.ts** | Calculate P&L, win rate, Sharpe, etc. |
| **output/algo-metrics.ts** | Calculate indicator analysis |
| **simulation/stages/index.ts** | Pipeline orchestrator |
| **simulation/stages/data-loading.ts** | Filter candles, handle pre-warming |
| **simulation/stages/indicator-calculation.ts** | Run all indicators |
| **simulation/stages/resampling.ts** | Align signals to candles |
| **simulation/stages/output.ts** | Generate final BacktestOutput |
| **simulation/event-driven/index.ts** | Heap-based event processing |
| **simulation/special-indicators/\*.ts** | SL/TP/Trailing indicators |
| **simulation/mipmap/\*.ts** | Multi-resolution candle cache |

---

## Key Import Chains

### Running a backtest:
```
User code
    └── src/index.ts
            └── simulation/stages/index.ts (runBacktestPipeline)
                    ├── stages/data-loading.ts
                    ├── stages/mipmap-building.ts
                    ├── stages/indicator-calculation.ts
                    │       └── indicators/calculator.ts
                    │               └── @indicators (external)
                    ├── stages/resampling.ts
                    ├── stages/initialization.ts
                    ├── event-driven/index.ts
                    │       └── event-heap.ts, event-extractor.ts
                    └── stages/output.ts
                            ├── output/swap-metrics.ts
                            └── output/algo-metrics.ts
```

### Type resolution:
```
BacktestInput (config.ts)
    └── AlgoConfig
            └── AlgoParams (types.ts)
                    ├── EntryCondition
                    │       └── IndicatorConfig (@indicators)
                    ├── ExitCondition
                    │       └── ValueConfig
                    └── TimeoutConfig

BacktestOutput (events/types.ts)
    ├── SwapEvent, TradeEvent
    ├── AlgoEvent (union type)
    ├── SwapMetrics, AlgoMetrics
    └── EquityPoint (output/types.ts)
```
