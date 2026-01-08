# Backtester-v2 Codebase Understanding & Statistics Verification Plan

## Current State

**510 tests passing**, but statistics accuracy is unverified.

### Known Issues from Quick Check:
| Metric | Value | Issue |
|--------|-------|-------|
| maxDrawdownPct | 1.0 (100%) | Wrong - didn't lose all capital |
| maxDrawdownUSD | $10,000 | Wrong - same issue |
| calmarRatio | 1.79e+31 | Division by zero |
| sharpeRatio | 13.35 | Suspiciously high |
| sortinoRatio | 1500 | Unrealistically high |
| indicatorAnalysis | [] | Empty - not populated |
| nearMissAnalysis | [] | Empty - not populated |

---

## Phase 1: Codebase Architecture Understanding

### 1.1 Core Module Map
```
src/
├── core/           # Types, config, constants
├── events/         # Event types, collector
├── indicators/     # Indicator factory, implementations
├── interfaces/     # DI interfaces (IExecutor, IDatabase, IIndicatorFeed)
├── simulation/     # Main engine
│   ├── stages/     # 6-stage pipeline
│   ├── fakes/      # Backtest implementations
│   └── special-indicators/  # SL/TP/Trailing
├── factory/        # BacktestEnvironment factory
└── output/         # Metrics calculation
```

### 1.2 Key Files to Understand
- [ ] `src/core/types.ts` - Core type definitions
- [ ] `src/core/config.ts` - Configuration schemas
- [ ] `src/events/types.ts` - Event types (SwapMetrics, AlgoMetrics)
- [ ] `src/simulation/stages/index.ts` - Pipeline orchestrator
- [ ] `src/simulation/algo-runner.ts` - Main trading logic
- [ ] `src/output/metrics.ts` - Statistics calculation

### 1.3 Data Flow
```
Candles → Stage 1 (Load) → Stage 2 (Indicators) → Stage 3 (Resample)
       → Stage 4 (Init) → Stage 5 (Simulate) → Stage 6 (Output)
```

---

## Phase 2: Statistics Verification Tests

### 2.1 SwapMetrics - Trade Statistics
| Metric | Formula | Test Strategy |
|--------|---------|---------------|
| totalTrades | count(trades) | Manual count |
| winRate | wins / total | Manual verify |
| totalPnlUSD | sum(trade.pnlUSD) | Sum verification |
| grossProfitUSD | sum(winning trades) | Filter & sum |
| grossLossUSD | sum(losing trades) | Filter & sum |
| avgWinUSD | grossProfit / wins | Division check |
| avgLossUSD | grossLoss / losses | Division check |
| profitFactor | grossProfit / grossLoss | Division check |

### 2.2 SwapMetrics - Risk Metrics (PRIORITY - Known Issues)
| Metric | Formula | Test Strategy |
|--------|---------|---------------|
| maxDrawdownPct | max((peak - equity) / peak) | Manual equity curve check |
| maxDrawdownUSD | max(peak - equity) | Same |
| sharpeRatio | (avgReturn - rf) / stdReturn | Manual calculation |
| sortinoRatio | (avgReturn - rf) / downsideStd | Manual calculation |
| calmarRatio | annualReturn / maxDD | Edge case handling |

### 2.3 AlgoMetrics - Algo Analysis
| Metric | Source | Test Strategy |
|--------|--------|---------------|
| indicatorAnalysis | Indicator flips | Verify populated |
| nearMissAnalysis | Condition distance | Verify populated |
| stateDistribution | Time in each state | Sum to 100% |
| exitReasonBreakdown | Exit events | Sum to totalTrades |
| conditionTriggerCounts | Condition events | Cross-reference |

---

## Phase 3: Test Implementation

### 3.1 Create Golden Test Dataset
```typescript
// 10 trades with known outcomes
const goldenTrades = [
  { entry: 100, exit: 102, pnl: 2 },   // +2% win
  { entry: 100, exit: 98, pnl: -2 },   // -2% loss
  // ... 8 more with calculated stats
];
```

### 3.2 Test Files to Create
- [ ] `src/output/__tests__/swap-metrics.test.ts` - Trade stats accuracy
- [ ] `src/output/__tests__/risk-metrics.test.ts` - Drawdown, Sharpe, etc.
- [ ] `src/output/__tests__/algo-metrics.test.ts` - Indicator analysis

### 3.3 Edge Cases to Test
- [ ] Zero trades
- [ ] All wins
- [ ] All losses
- [ ] Single trade
- [ ] Zero volatility (Sharpe edge case)
- [ ] Zero drawdown (Calmar edge case)

---

## Phase 4: Fix Identified Issues

### 4.1 Drawdown Calculation
- Location: `src/output/metrics.ts` or `src/simulation/stages/output.ts`
- Issue: Likely calculating from wrong equity values
- Fix: Use equity curve from simulation

### 4.2 Sharpe/Sortino Calculation
- Issue: Likely using trade P&L instead of periodic returns
- Fix: Use proper return series calculation

### 4.3 Calmar Ratio
- Issue: Division by zero when maxDD = 0
- Fix: Return 0 or Infinity with proper handling

### 4.4 Indicator/NearMiss Analysis
- Issue: Not being populated
- Location: EventCollector or output stage
- Fix: Wire up the analysis functions

---

## Phase 5: Validation Against External Tools

### 5.1 Cross-Validate with TradingView
- Export same trades to TV format
- Compare key metrics

### 5.2 Cross-Validate with Python
```python
# Independent calculation
import pandas as pd
trades_df = pd.read_json('trades.json')
print(f"Win Rate: {(trades_df.pnl > 0).mean()}")
print(f"Sharpe: {trades_df.pnl.mean() / trades_df.pnl.std()}")
```

---

## Execution Order

1. **Today**: Map the codebase structure
2. **Next**: Locate metrics calculation code
3. **Then**: Write golden dataset tests
4. **Finally**: Fix issues and verify

---

## Commands

```bash
# Run all tests
bun test

# Run specific test file
bun test src/output/__tests__/metrics.test.ts

# Run with coverage
bun test --coverage
```
