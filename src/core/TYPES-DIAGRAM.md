# Types Diagram - Backtester V2

This document shows how the types in `src/core/types.ts` and `src/core/config.ts` relate to each other.


## Top-Level: BacktestInput (from config.ts)

This is what users pass to `runBacktestWithEvents()`. Validated by `BacktestInputSchema`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BacktestInput                                     │
│                    "The complete backtest request"                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   algoConfig ─────────────► AlgoConfig (the strategy)                       │
│   runSettings ────────────► RunSettings (execution params)                  │
│   feeBps ─────────────────► number (trading fees, default provided)         │
│   slippageBps ────────────► number (slippage, default provided)             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKTEST INPUT                                   │
│                                                                             │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────┐    │
│  │        AlgoConfig           │    │          RunSettings            │    │
│  │  "WHAT to trade"            │    │  "HOW/WHEN to run it"           │    │
│  ├─────────────────────────────┤    ├─────────────────────────────────┤    │
│  │ userID                      │    │ userID, algoID, version, runID  │    │
│  │ algoID                      │    │ coinSymbol                      │    │
│  │ algoName                    │    │ capitalScaler                   │    │
│  │ version                     │    │ startTime, endTime              │    │
│  │ params ──────────┐          │    │ tradesLimit                     │    │
│  └──────────────────│──────────┘    │ closePositionOnExit             │    │
│                     │               │ isBacktest, status, exchangeID  │    │
│                     ▼               └─────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          AlgoParams                                 │   │
│  │                    "The Strategy Blueprint"                         │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ type: AlgoType ──────────────────────► "LONG" | "SHORT" | "BOTH"    │   │
│  │ orderType: OrderType ────────────────► "MARKET" | "LIMIT" | ...     │   │
│  │ startingCapitalUSD: number                                          │   │
│  │ coinSymbol?: string                                                 │   │
│  │                                                                     │   │
│  │ positionSize ─────┐                                                 │   │
│  │ longEntry ────────┼──┐                                              │   │
│  │ longExit ─────────┼──┼──┐                                           │   │
│  │ shortEntry ───────┼──┼──┼──┐                                        │   │
│  │ shortExit ────────┼──┼──┼──┼──┐                                     │   │
│  │ timeout ──────────┼──┼──┼──┼──┼──┐                                  │   │
│  └───────────────────┼──┼──┼──┼──┼──┼──────────────────────────────────┘   │
└──────────────────────┼──┼──┼──┼──┼──┼───────────────────────────────────────┘
                       │  │  │  │  │  │
       ┌───────────────┘  │  │  │  │  └───────────────────────┐
       ▼                  │  │  │  │                          ▼
┌─────────────────┐       │  │  │  │              ┌─────────────────────┐
│   ValueConfig   │       │  │  │  │              │    TimeoutConfig    │
│ "How much $"    │       │  │  │  │              │ "Cooldown rules"    │
├─────────────────┤       │  │  │  │              ├─────────────────────┤
│ type: ValueType │       │  │  │  │              │ mode: TimeoutMode   │
│  ├─ ABS ($100)  │       │  │  │  │              │  ├─ COOLDOWN_ONLY   │
│  ├─ REL (2%)    │       │  │  │  │              │  ├─ REGULAR         │
│  └─ DYN (dynamic)│      │  │  │  │              │  └─ STRICT          │
│ value: number   │       │  │  │  │              │ cooldownBars: number│
│ valueFactor?    │       │  │  │  │              └─────────────────────┘
│ inverted?       │       │  │  │  │
│ ladder? ────────┼───┐   │  │  │  │
└─────────────────┘   │   │  │  │  │
                      │   │  │  │  │
       ┌──────────────┘   │  │  │  │
       ▼                  │  │  │  │
┌─────────────────┐       │  │  │  │
│  LadderParams   │       │  │  │  │
│ "Scale in/out"  │       │  │  │  │
├─────────────────┤       │  │  │  │
│ levels: {...}   │       │  │  │  │
│ direction       │       │  │  │  │
│ method          │       │  │  │  │
│ normalize       │       │  │  │  │
└─────────────────┘       │  │  │  │
                          │  │  │  │
          ┌───────────────┘  │  │  └───────────────┐
          ▼                  │  │                  ▼
   ┌─────────────────┐       │  │         ┌─────────────────┐
   │ EntryCondition  │       │  │         │ EntryCondition  │
   │ "When to OPEN"  │       │  │         │ (for shorts)    │
   ├─────────────────┤       │  │         └─────────────────┘
   │ required: [...] │──AND  │  │
   │ optional: [...] │──OR   │  │
   └─────────────────┘       │  │
                             ▼  ▼
                  ┌─────────────────────┐
                  │    ExitCondition    │
                  │  "When to CLOSE"    │
                  ├─────────────────────┤
                  │ required: [...]     │──AND
                  │ optional: [...]     │──OR
                  │ stopLoss? ──────────┼───► ValueConfig
                  │ takeProfit? ────────┼───► ValueConfig
                  │ trailingSL?: bool   │
                  └─────────────────────┘
```

---

## State Machine Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STATE MACHINE TYPES                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   PositionState                    Direction                                │
│   ┌────────┐                       ┌────────┐                               │
│   │  CASH  │◄─── no position       │  LONG  │                               │
│   │  LONG  │◄─── holding long      │  SHORT │                               │
│   │  SHORT │◄─── holding short     └────────┘                               │
│   │TIMEOUT │◄─── cooling down                                               │
│   └────────┘                                                                │
│        │                                                                    │
│        └──── TimeoutReason: "POST_TRADE" | "AMBIGUITY"                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Output Type

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OUTPUT TYPE (from output/types.ts)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   EquityPoint                                                               │
│   ┌─────────────────────┐                                                   │
│   │ time: number        │  Unix timestamp                                   │
│   │ equity: number      │  Portfolio value ($)                              │
│   │ drawdownPct: number │  % below peak                                     │
│   │ runupPct: number    │  % above low                                      │
│   └─────────────────────┘                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference Table

| Type | Purpose | Used By |
|------|---------|---------|
| `BacktestInput` | Top-level input (validated by Zod) | `runBacktestWithEvents()` |
| `AlgoConfig` | Wraps strategy with ID/version | BacktestInput.algoConfig |
| `AlgoParams` | The actual strategy definition | AlgoConfig.params |
| `RunSettings` | Execution parameters (when/how) | BacktestInput.runSettings |
| `EntryCondition` | When to open a trade | AlgoParams.longEntry/shortEntry |
| `ExitCondition` | When to close a trade | AlgoParams.longExit/shortExit |
| `ValueConfig` | Flexible amount (ABS/REL/DYN) | positionSize, stopLoss, takeProfit |
| `TimeoutConfig` | Cooldown after trades | AlgoParams.timeout |
| `LadderParams` | Scale in/out levels | ValueConfig.ladder (not implemented) |
| `PositionState` | Current state machine state | State machine |
| `Direction` | LONG or SHORT | Trade tracking |
| `EquityPoint` | Point on equity curve | Output/charts |

---

## Type Hierarchy

```
BacktestInput (from config.ts - validated by BacktestInputSchema)
├── algoConfig: AlgoConfig
│   ├── userID: string
│   ├── algoID: string
│   ├── algoName: string
│   ├── version: number
│   └── params: AlgoParams
│       ├── type: AlgoType
│       ├── longEntry?: EntryCondition
│       │   ├── required: IndicatorConfig[]
│       │   └── optional: IndicatorConfig[]
│       ├── longExit?: ExitCondition
│       │   ├── required: IndicatorConfig[]
│       │   ├── optional: IndicatorConfig[]
│       │   ├── stopLoss?: ValueConfig
│       │   ├── takeProfit?: ValueConfig
│       │   └── trailingSL?: boolean
│       ├── shortEntry?: EntryCondition
│       ├── shortExit?: ExitCondition
│       ├── positionSize: ValueConfig
│       │   ├── type: ValueType
│       │   ├── value: number
│       │   ├── valueFactor?: IndicatorConfig
│       │   ├── inverted?: boolean
│       │   └── ladder?: LadderParams
│       ├── orderType: OrderType
│       ├── startingCapitalUSD: number
│       ├── coinSymbol?: string
│       └── timeout: TimeoutConfig
│           ├── mode: TimeoutMode
│           └── cooldownBars: number
│
├── runSettings: RunSettings
│   ├── userID: string
│   ├── algoID: string
│   ├── version: string
│   ├── runID: string
│   ├── isBacktest: boolean (must be true for backtester)
│   ├── coinSymbol: string
│   ├── capitalScaler: number
│   ├── startTime?: number
│   ├── endTime?: number
│   ├── tradesLimit?: number
│   ├── closePositionOnExit: boolean
│   ├── launchTime: number
│   ├── status: RunStatus
│   └── exchangeID: string
│
├── feeBps: number (trading fees in basis points, has default)
└── slippageBps: number (slippage in basis points, has default)
```

---

## Analogy Summary

| Type | Analogy |
|------|---------|
| `BacktestInput` | The complete order form (strategy + settings + costs) |
| `AlgoConfig` | The recipe card (versioned, immutable) |
| `AlgoParams` | The recipe itself (ingredients + steps) |
| `RunSettings` | The order ticket (when, how much, where) |
| `EntryCondition` | "Start cooking when..." |
| `ExitCondition` | "Stop cooking when..." |
| `ValueConfig` | "Use this much..." (flexible units) |
| `TimeoutConfig` | "Rest between batches" |
| `PositionState` | Current kitchen status (idle, cooking, resting) |
