# Backtester-v2 Requirements

## Quick Reference

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design documentation.

---

## Core Requirements

### Input
- Historical price data (1m candles minimum)
- Algorithm config (`AlgoParams` with entry/exit conditions)
- Backtest config (capital, fees, slippage, time range)

### Output
- Summary metrics (total P&L, Sharpe, Sortino, win rate, max drawdown)
- Performance breakdown by direction (long/short)
- List of all trades with full details
- Trades analysis (statistics, P&L, duration)
- Equity curve (downsampled for storage)
- Drawdown curve (downsampled for storage)

---

## Key Design Decisions

1. **Single Forward Pass**: No backtracking. TP/SL calculated in parallel with exit conditions.

2. **Special Indicators**: TP, SL, Trailing Stop, Balance are stateful objects created per-trade.

3. **Batch Processing**: Feed 1000+ candles to special indicators at once.

4. **Resolution Hierarchy**:
   - Indicators compute at natural resolutions
   - Resample to common simulation resolution
   - Simulation resolution = max(1m, next_lower_bucket(min_indicator_resolution))

5. **Post-Processing**: Equity/drawdown denoised and downsampled before storage.

---

## Implementation Status

### Done ✅
- Core types and interfaces
- Backtest config with Zod validation
- Indicator precomputation (`calculateIndicators`)
- Condition evaluation (`evaluateCondition`, `detectConditionEdge`)
- Output type definitions
- Resolution resampling (`src/indicators/resampler.ts`)
- State machine (`src/simulation/state-machine.ts`)
- Special indicators:
  - StopLossIndicator (`src/simulation/special-indicators/stop-loss.ts`)
  - TakeProfitIndicator (`src/simulation/special-indicators/take-profit.ts`)
  - TrailingStopIndicator (`src/simulation/special-indicators/trailing-stop.ts`)
  - BalanceIndicator (`src/simulation/special-indicators/balance.ts`)
- Simulation loop (`src/simulation/loop.ts`)
- Trade recording (`src/output/trade-recorder.ts`)
- Metrics calculation (`src/output/metrics.ts`)
- Equity curve processing (`src/output/equity-curve.ts`)
- Downsampling utilities (`src/utils/downsampling.ts`)
- Main `runBacktest()` function (`src/index.ts`)

### TODO 📋
- Unit tests
- Integration tests
- Error handling improvements

---

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Validation**: Zod
- **Dependencies**: `@indicators` library (path alias)

---

## Performance Targets

- Backtest 1 year of 1m data in < 1 second
- Memory efficient (batch processing, no full array copies)
- Future: Zig migration for 5-10x speedup
