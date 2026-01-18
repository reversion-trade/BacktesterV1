# Backtester Documentation

Event-driven trading backtester with single forward-pass architecture.

## Quick Start

```typescript
import { runBacktestPipeline } from "./src/simulation/stages/index.ts";

const result = runBacktestPipeline(candles, {
  algoConfig: {
    userID: "user1",
    algoID: "ema-cross",
    algoName: "EMA Crossover",
    version: 1,
    params: {
      type: "LONG",
      longEntry: {
        required: [{ type: "EMACross", params: { source: "1_close", firstPeriod: 600, secondPeriod: 1380, signal: "value_above_threshold" }}],
        optional: []
      },
      longExit: {
        required: [{ type: "EMACross", params: { source: "1_close", firstPeriod: 600, secondPeriod: 1380, signal: "value_below_threshold" }}],
        optional: [],
        stopLoss: { type: "REL", value: 0.02 },   // 2% stop loss
        takeProfit: { type: "REL", value: 0.05 }  // 5% take profit
      },
      positionSize: { type: "ABS", value: 1000 }, // $1000 per trade
      orderType: "MARKET",
      startingCapitalUSD: 10000,
      timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 }
    }
  },
  runSettings: {
    userID: "user1",
    algoID: "ema-cross",
    version: "1",
    runID: "backtest-1",
    isBacktest: true,
    coinSymbol: "BTCUSD",
    capitalScaler: 1,
    startTime: 1727740800,  // Oct 1, 2025
    endTime: 1730419200,    // Nov 1, 2025
    closePositionOnExit: true,
    launchTime: Date.now(),
    status: "NEW",
    exchangeID: "deribit"
  }
});

console.log(`Trades: ${result.trades.length}`);
console.log(`P&L: $${result.algoMetrics.totalPnlUSD.toFixed(2)}`);
```

---

## Pipeline Stages

```
Candles + Config
      │
      ▼
┌─────────────────────────────────────────────────────┐
│ 1. INITIALIZATION                                   │
│    Validate config, extract indicator configs       │
├─────────────────────────────────────────────────────┤
│ 2. DATA LOADING                                     │
│    Filter candles to time range + pre-warming       │
├─────────────────────────────────────────────────────┤
│ 3. MIPMAP BUILDING                                  │
│    Build multi-resolution candle cache              │
├─────────────────────────────────────────────────────┤
│ 4. INDICATOR CALCULATION                            │
│    Run indicators → boolean signal arrays           │
├─────────────────────────────────────────────────────┤
│ 5. RESAMPLING                                       │
│    Align signals to simulation timeframe            │
├─────────────────────────────────────────────────────┤
│ 6. EVENT EXTRACTION                                 │
│    Convert signal transitions → simulation events   │
├─────────────────────────────────────────────────────┤
│ 7. SIMULATION                                       │
│    Process events, manage positions, track P&L      │
├─────────────────────────────────────────────────────┤
│ 8. OUTPUT                                           │
│    Generate trades, equity curve, metrics           │
└─────────────────────────────────────────────────────┘
      │
      ▼
  BacktestOutput
```

---

## Core Concepts

### Position States
- **FLAT**: No open position, waiting for entry
- **LONG**: Bought asset, profit when price rises
- **SHORT**: Sold borrowed asset, profit when price falls

### Value Types
- **ABS**: Absolute USD amount (e.g., `$1000`)
- **REL**: Relative/percentage (e.g., `0.02` = 2%)

### Entry/Exit Logic
```
Entry triggers when:
  ALL required indicators = true
  AND (no optionals OR ANY optional = true)

Exit triggers when:
  Signal condition met
  OR Stop Loss hit
  OR Take Profit hit
  OR End of backtest
```

### Exit Priority
When multiple exit conditions trigger on same bar:
```
TRAILING_STOP > STOP_LOSS > TAKE_PROFIT > SIGNAL > END_OF_BACKTEST
```

---

## Chart Point Sources

16 data sources available for indicators:

**Scalar (1-minute):**
| Source | Value |
|--------|-------|
| `1_open` | Candle open price |
| `1_high` | Candle high price |
| `1_low` | Candle low price |
| `1_close` | Candle close price |
| `1_volume` | Candle volume |
| `1_average` | (O+H+L+C)/4 |
| `1_middle` | (H+L)/2 |
| `1_typical` | (H+L+C)/3 |

**Double (2-minute with volume):**
| Source | Value |
|--------|-------|
| `2_open` | open + volume |
| `2_high` | high + volume |
| `2_low` | low + volume |
| `2_close` | close + volume |
| `2_average` | ohlc4 + volume |
| `2_middle` | hl2 + volume |
| `2_typical` | hlc3 + volume |
| `2_interpolated_x4` | OHLC path interpolation |

---

## Special Indicators

Per-trade indicators with expanding windows (vs. fixed sliding windows):

| Indicator | Purpose | Triggers When |
|-----------|---------|---------------|
| **StopLoss** | Fixed loss limit | Price moves against position by X% |
| **TakeProfit** | Fixed profit target | Price moves in favor by X% |
| **TrailingStop** | Dynamic stop that ratchets | Price retraces from extreme |
| **Balance** | Tracks unrealized P&L | N/A (informational) |

---

## File Structure

```
src/
├── core/           # Types, config schemas
├── events/         # Event system
├── indicators/     # Indicator calculation
├── simulation/
│   ├── stages/     # Pipeline stages
│   ├── special-indicators/  # SL/TP/Trailing
│   ├── mipmap/     # Multi-resolution cache
│   └── fakes/      # Test doubles
├── output/         # Metrics, equity curves
└── utils/          # Math helpers
```
