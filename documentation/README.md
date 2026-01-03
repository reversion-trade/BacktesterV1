# Backtester-v2 Documentation

## Overview

Backtester-v2 is an event-driven trading backtester with a single forward-pass architecture. It simulates trading strategies using historical price data and calculates comprehensive performance metrics.

## Key Design Principles

1. **Single Forward Pass**: No backtracking through data. TP/SL calculated in parallel with exit conditions.
2. **Special Indicators**: TP, SL, Trailing Stop, and Balance are stateful objects created per-trade and destroyed at exit.
3. **Batch Processing**: Efficient processing of price data through special indicators.
4. **Resolution Hierarchy**: Indicators compute at natural resolutions, simulation runs at finest resolution.

---

## Documentation Index

| Document | Description |
|----------|-------------|
| [CORE.md](./CORE.md) | Core types, configuration, and constants |
| [INDICATORS.md](./INDICATORS.md) | Indicator calculation and signal evaluation |
| [SIMULATION.md](./SIMULATION.md) | State machine, simulation loop, special indicators |
| [SPECIAL_INDICATORS_ARCHITECTURE.md](./SPECIAL_INDICATORS_ARCHITECTURE.md) | Modular architecture aligned with indicators library patterns |
| [OUTPUT.md](./OUTPUT.md) | Trade recording, equity curves, metrics |
| [INTRA_CANDLE_SIMULATION.md](./INTRA_CANDLE_SIMULATION.md) | How intra-candle price paths are simulated |
| [RESOLUTION_STRATEGY.md](./RESOLUTION_STRATEGY.md) | Multi-resolution handling and signal resampling |

---

## File Structure

```
src/
├── index.ts                         # Main runBacktest() entry point
├── core/
│   ├── types.ts                     # Core type definitions
│   ├── config.ts                    # BacktestConfig with Zod validation
│   └── constants.ts                 # Fee/slippage constants in BPS
├── indicators/
│   ├── calculator.ts                # Pre-calculates indicator signals
│   ├── evaluator.ts                 # Evaluates entry/exit conditions
│   └── resampler.ts                 # Resolution management and resampling
├── simulation/
│   ├── state-machine.ts             # FLAT/LONG/SHORT state management
│   ├── loop.ts                      # Main forward-pass simulation engine
│   └── special-indicators/
│       ├── index.ts                 # Barrel exports
│       ├── types.ts                 # Special indicator interfaces
│       ├── base.ts                  # BaseSpecialIndicator + Zod schemas
│       ├── operators.ts             # Expanding window operators
│       ├── registry.ts              # SpecialIndicatorRegistry
│       ├── stop-loss.ts             # Fixed stop loss indicator
│       ├── take-profit.ts           # Fixed take profit indicator
│       ├── trailing-stop.ts         # Dynamic trailing stop indicator
│       └── balance.ts               # Equity/P&L tracking indicator
├── output/
│   ├── types.ts                     # Output type definitions
│   ├── trade-recorder.ts            # Trade open/close helpers
│   ├── equity-curve.ts              # Equity curve processing
│   └── metrics.ts                   # Performance metrics calculation
└── utils/
    └── downsampling.ts              # Data reduction for storage
```

---

## Quick Start

```typescript
import { runBacktest } from "./src/index.ts";

const result = runBacktest(candles, {
  coinSymbol: "BTC",
  startTime: 1704067200,
  endTime: 1735689600,
  startingCapitalUSD: 10000,
  feeBps: 10,
  slippageBps: 10,
  algoParams: {
    type: "LONG",
    longEntry: { required: [...], optional: [], limitLevel: 0 },
    longExit: {
      required: [...],
      optional: [],
      stopLoss: { type: "REL", value: 0.02 },
      takeProfit: { type: "REL", value: 0.05 }
    },
    positionSize: { type: "REL", value: 1.0 },
    assumePositionImmediately: false,
    closePositionOnExit: true,
  }
});

console.log(`Total P&L: $${result.summary.totalPnlUSD}`);
console.log(`Win rate: ${(result.summary.winRate * 100).toFixed(1)}%`);
console.log(`Sharpe ratio: ${result.summary.sharpeRatio.toFixed(2)}`);
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         runBacktest()                                │
├─────────────────────────────────────────────────────────────────────┤
│  1. Validate config (Zod)                                           │
│  2. Filter candles to time range                                    │
│  3. Calculate indicator signals (calculateIndicators)               │
│  4. Run simulation loop (runSimulation)                             │
│  5. Process equity curve (downsample)                               │
│  6. Calculate metrics                                               │
│  7. Return BacktestResult                                           │
└─────────────────────────────────────────────────────────────────────┘
```
