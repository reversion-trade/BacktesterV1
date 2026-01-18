# Type System Diagram

How types relate to each other in the backtester.

## Core Type Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL (indicators lib)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Candle              ChartPoint           IndicatorConfig                   │
│  ├── bucket          ├── time             ├── type: string                  │
│  ├── open            ├── value            └── params: object                │
│  ├── high            └── values[]                                           │
│  ├── low                                                                    │
│  ├── close                                                                  │
│  └── volume                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INPUT TYPES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BacktestInput ─────────────────────────────────────────────────────────    │
│  ├── algoConfig: AlgoConfig                                                 │
│  ├── runSettings: RunSettings                                               │
│  ├── feeBps: number                                                         │
│  └── slippageBps: number                                                    │
│                                                                             │
│       ┌──────────────────┐              ┌──────────────────┐                │
│       │   AlgoConfig     │              │   RunSettings    │                │
│       ├──────────────────┤              ├──────────────────┤                │
│       │ userID           │              │ userID           │                │
│       │ algoID           │              │ algoID           │                │
│       │ algoName         │              │ version          │                │
│       │ version          │              │ runID            │                │
│       │ params ──────────┼───┐          │ isBacktest       │                │
│       └──────────────────┘   │          │ coinSymbol       │                │
│                              │          │ capitalScaler    │                │
│                              │          │ startTime        │                │
│                              │          │ endTime          │                │
│                              ▼          └──────────────────┘                │
│                    ┌──────────────────┐                                     │
│                    │   AlgoParams     │                                     │
│                    ├──────────────────┤                                     │
│                    │ type: AlgoType   │◄── "LONG" | "SHORT" | "BOTH"        │
│                    │ longEntry ───────┼──┐                                  │
│                    │ longExit ────────┼──┼─┐                                │
│                    │ shortEntry       │  │ │                                │
│                    │ shortExit        │  │ │                                │
│                    │ positionSize ────┼──┼─┼─┐                              │
│                    │ orderType        │  │ │ │                              │
│                    │ startingCapital  │  │ │ │                              │
│                    │ timeout ─────────┼──┼─┼─┼─┐                            │
│                    └──────────────────┘  │ │ │ │                            │
│                                          │ │ │ │                            │
│  ┌───────────────────────────────────────┘ │ │ │                            │
│  │  ┌──────────────────────────────────────┘ │ │                            │
│  │  │  ┌─────────────────────────────────────┘ │                            │
│  │  │  │  ┌──────────────────────────────────────┘                          │
│  ▼  ▼  ▼  ▼                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │ EntryCondition │  │ ExitCondition  │  │  ValueConfig   │                 │
│  ├────────────────┤  ├────────────────┤  ├────────────────┤                 │
│  │ required[]─────┼─►│ required[]     │  │ type ──────────┼─► ABS|REL|DYN  │
│  │ optional[]     │  │ optional[]     │  │ value          │                 │
│  └────────────────┘  │ stopLoss ──────┼─►│ valueFactor?   │                 │
│         │            │ takeProfit     │  │ ladder?        │                 │
│         │            │ trailingSL?    │  └────────────────┘                 │
│         ▼            └────────────────┘         │                           │
│  IndicatorConfig[]                              ▼                           │
│                                          ┌────────────────┐                 │
│                                          │ TimeoutConfig  │                 │
│                                          ├────────────────┤                 │
│                                          │ mode ──────────┼─► COOLDOWN_ONLY│
│                                          │ cooldownBars   │   REGULAR      │
│                                          └────────────────┘   STRICT       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Event Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SIMULATION EVENTS                                 │
│                    (Internal - drive the simulation)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SimulationEvent (base)                                                     │
│  ├── id: string                                                             │
│  ├── timestamp: number                                                      │
│  ├── barIndex: number                                                       │
│  ├── eventType: SimulationEventType                                         │
│  └── isDead: boolean                                                        │
│                                                                             │
│       ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│       │SignalCrossing   │  │ConditionMet     │  │ SL/TP Trigger   │         │
│       ├─────────────────┤  ├─────────────────┤  ├─────────────────┤         │
│       │ indicatorKey    │  │ conditionType   │  │ direction       │         │
│       │ conditionType   │  │ triggeringKey   │  │ triggerPrice    │         │
│       │ previousValue   │  └─────────────────┘  │ tradeId         │         │
│       │ newValue        │                       └─────────────────┘         │
│       └─────────────────┘                                                   │
│                                                                             │
│  SimulationEventType = "SIGNAL_CROSSING" | "CONDITION_MET" |                │
│                        "CONDITION_UNMET" | "SL_TRIGGER" |                   │
│                        "TP_TRIGGER" | "TRAILING_TRIGGER"                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             OUTPUT EVENTS                                   │
│                      (External - for metrics/analysis)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  SwapEvent ──────────────────────────────────────────────────────────       │
│  ├── id, timestamp, barIndex                                                │
│  ├── fromAsset, toAsset           "USD" ↔ "BTC"                             │
│  ├── fromAmount, toAmount                                                   │
│  ├── price, feeUSD, slippageUSD                                             │
│  └── isEntry?, tradeDirection?                                              │
│                     │                                                       │
│                     ▼                                                       │
│  TradeEvent ─────────────────────────────────────────────────────────       │
│  ├── tradeId                                                                │
│  ├── direction: Direction         "LONG" | "SHORT"                          │
│  ├── entrySwap: SwapEvent                                                   │
│  ├── exitSwap: SwapEvent                                                    │
│  ├── pnlUSD, pnlPct                                                         │
│  └── durationBars, durationSeconds                                          │
│                                                                             │
│  AlgoEvent = IndicatorFlipEvent | ConditionChangeEvent |                    │
│              StateTransitionEvent | SpecialIndicatorEvent                   │
│                                                                             │
│       ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│       │IndicatorFlip    │  │ConditionChange  │  │StateTransition  │         │
│       ├─────────────────┤  ├─────────────────┤  ├─────────────────┤         │
│       │ indicatorKey    │  │ conditionType   │  │ fromState       │         │
│       │ previousValue   │  │ previousState   │  │ toState         │         │
│       │ newValue        │  │ newState        │  │ reason          │         │
│       │ conditionType   │  │ snapshot        │  │ tradeId?        │         │
│       └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Output Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKTEST OUTPUT                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  BacktestOutput                                                             │
│  ├── config ─────────────────► { algoId, version, symbol, startTime, ... } │
│  ├── events                                                                 │
│  │   ├── swapEvents: SwapEvent[]                                            │
│  │   └── algoEvents: AlgoEvent[]                                            │
│  ├── trades: TradeEvent[]                                                   │
│  ├── equityCurve: EquityPoint[]                                             │
│  ├── swapMetrics: SwapMetrics                                               │
│  ├── algoMetrics: AlgoMetrics                                               │
│  └── meta: { completedAt, durationMs, totalBarsProcessed }                  │
│                                                                             │
│       ┌─────────────────────────┐      ┌─────────────────────────┐          │
│       │     SwapMetrics         │      │     AlgoMetrics         │          │
│       ├─────────────────────────┤      ├─────────────────────────┤          │
│       │ totalTrades             │      │ indicatorAnalysis[]     │          │
│       │ winRate                 │      │ nearMissAnalysis[]      │          │
│       │ totalPnlUSD             │      │ stateDistribution       │          │
│       │ sharpeRatio             │      │ exitReasonBreakdown     │          │
│       │ sortinoRatio            │      │ conditionTriggerCounts  │          │
│       │ maxDrawdownPct          │      │ eventCounts             │          │
│       │ profitFactor            │      └─────────────────────────┘          │
│       │ longWinRate/shortWinRate│                                           │
│       │ avgTradeDuration        │                                           │
│       └─────────────────────────┘                                           │
│                                                                             │
│       ┌─────────────────────────┐                                           │
│       │     EquityPoint         │                                           │
│       ├─────────────────────────┤                                           │
│       │ time                    │                                           │
│       │ equity                  │                                           │
│       │ drawdownPct             │                                           │
│       │ runupPct                │                                           │
│       └─────────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## State Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            STATE MACHINE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PositionState = "CASH" | "LONG" | "SHORT" | "TIMEOUT"                      │
│                                                                             │
│                    ┌──────────────────────────────┐                         │
│                    │            CASH              │                         │
│                    │       (no position)          │                         │
│                    └──────────────────────────────┘                         │
│                         │                 │                                 │
│            long entry   │                 │   short entry                   │
│                         ▼                 ▼                                 │
│             ┌────────────────┐   ┌────────────────┐                         │
│             │      LONG      │   │     SHORT      │                         │
│             │  (bought BTC)  │   │  (sold BTC)    │                         │
│             └────────────────┘   └────────────────┘                         │
│                         │                 │                                 │
│              exit       │                 │   exit                          │
│              (SL/TP/    │                 │   (SL/TP/                       │
│               signal)   ▼                 ▼    signal)                      │
│                    ┌──────────────────────────────┐                         │
│                    │          TIMEOUT             │                         │
│                    │   (cooldown after trade)     │                         │
│                    └──────────────────────────────┘                         │
│                                   │                                         │
│                    cooldown done  │                                         │
│                                   ▼                                         │
│                              back to CASH                                   │
│                                                                             │
│  Direction = "LONG" | "SHORT"                                               │
│  AlgoType = "LONG" | "SHORT" | "BOTH"                                       │
│  ConditionType = "LONG_ENTRY" | "LONG_EXIT" | "SHORT_ENTRY" | "SHORT_EXIT"  │
│                                                                             │
│  TransitionReason = "ENTRY_SIGNAL" | "EXIT_SIGNAL" | "STOP_LOSS" |          │
│                     "TAKE_PROFIT" | "TRAILING_STOP" | "END_OF_BACKTEST"     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Type Flow Summary

```
Candle[] + BacktestInput
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  IndicatorConfig │────►│   boolean[]     │  (signals)
└─────────────────┘     └─────────────────┘
                                │
                                ▼
                        SimulationEvent[]
                                │
                                ▼
                    ┌───────────────────────┐
                    │   State Machine       │
                    │   CASH↔LONG↔TIMEOUT   │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ SwapEvent + AlgoEvent │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   BacktestOutput      │
                    │   (trades, metrics)   │
                    └───────────────────────┘
```
