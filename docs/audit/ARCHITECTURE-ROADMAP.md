# Backtester-v2 Architecture Roadmap

**Date**: January 1, 2026
**Document Type**: Audit Trail

---

## Document Purpose

This document serves as the authoritative reference for the backtester-v2 architecture.
It contains:
- Complete phase definitions and requirements
- Implementation status and audit findings
- Design decisions and rationale
- Architectural requirements

---

# COMPLETED PHASES - AUDIT REPORTS

---

## Phase 2: Event System Refactoring ✅ COMPLETED

### Files Modified:
- `src/events/types.ts` - All event type definitions
- `src/events/collector.ts` - EventCollector class
- `src/events/index.ts` - Module exports
- `src/simulation/loop.ts` - Rewritten to emit events

### How It Works:

#### Two-Track Event Architecture:

**1. SwapEvents (Wallet Conversions)**
```
SwapEvent = {
  id, timestamp, barIndex,
  fromAsset, toAsset,        // "USD" ↔ "BTC"
  fromAmount, toAmount,
  price, feeUSD, slippageUSD
}
```
- "Dumb events" - no algo knowledge
- Paired into TradeEvents (entry + exit)

**2. AlgoEvents (Internal State Changes)**
```
IndicatorFlipEvent     → Individual indicator signal change
ConditionChangeEvent   → Full condition met/unmet transition
StateTransitionEvent   → Position state (FLAT ↔ LONG ↔ SHORT)
SpecialIndicatorEvent  → SL/TP/Trailing set or hit
```

#### Data Flow:
```
Indicator Signal Change
    ↓
EventCollector.updateIndicators()
    ↓
Detect flip → Emit IndicatorFlipEvent
    ↓
Check condition → Emit ConditionChangeEvent (if changed)
    ↓
Simulation checks condition → Entry/Exit decision
    ↓
Emit SwapEvent + StateTransitionEvent
```

#### The Distance Metric (Near-Miss Tracking):
```typescript
ConditionSnapshot = {
  requiredTrue, requiredTotal,    // e.g., 2/3 required indicators true
  optionalTrue, optionalTotal,    // e.g., 0/1 optional true
  conditionMet: boolean,
  distanceFromTrigger: number     // 0 = triggered, N = N more needed
}
```

### Audit Findings:

**Issues Identified:**
1. ⚠️ **TradeEvent Duplication Risk** - Both `emitExitSwap()` and `buildTradeEvents()` create TradeEvents. Currently mitigated (only `buildTradeEvents()` used).
2. ⚠️ **Dual State Tracking** - `prevConditionMet` in loop.ts vs `conditionState.previousMet` in collector. ✅ FIXED in Sprint 1
3. ⚠️ **No Indicator Registration Validation** - If signalCache has keys not in indicatorInfoMap, they won't be tracked. ✅ FIXED in Sprint 1

**Recommendations Applied:**
- ✅ Added `getPreviousConditionMet(type)` getter to EventCollector
- ✅ Added validation warning for unregistered indicators

---

## Phase 3: Expand Metrics System ✅ COMPLETED

### Files Modified:
- `src/output/swap-metrics.ts` - SwapMetrics calculation
- `src/output/algo-metrics.ts` - AlgoMetrics calculation
- `src/events/types.ts` - SwapMetrics and AlgoMetrics type definitions

### How It Works:

#### SwapMetrics (Traditional Trading Metrics)
Calculated from TradeEvents in `calculateSwapMetrics()`:
```
Input: TradeEvent[] + equityCurve
Output: {
  totalTrades, winningTrades, losingTrades, winRate,
  totalPnlUSD, grossProfitUSD, grossLossUSD,
  avgPnlUSD, avgWinUSD, avgLossUSD,
  largestWinUSD, largestLossUSD,
  profitFactor, sharpeRatio, sortinoRatio,
  maxDrawdownPct, maxDrawdownUSD, calmarRatio,
  longTrades, shortTrades, longWinRate, shortWinRate,
  longPnlUSD, shortPnlUSD,
  avgTradeDurationBars, totalFeesUSD, totalSlippageUSD
}
```

#### AlgoMetrics (Algorithm Diagnostics)
Calculated from AlgoEvents in `calculateAlgoMetrics()`:

**1. Indicator Analysis**:
- flipCount, avgDurationTrueBars, avgDurationFalseBars
- pctTimeTrue, triggeringFlipCount, blockingCount
- usefulnessScore (0-100)

**2. Near-Miss Analysis**:
- distanceHistogram, closestApproachWithoutTrigger
- approachSequences, triggerCount

**3. State Distribution**:
- pctTimeFlat, pctTimeLong, pctTimeShort

**4. Exit Reason Breakdown**:
- signal, stopLoss, takeProfit, trailingStop, endOfBacktest

### Audit Findings:

**Status**: ✅ Complete

**Issues Fixed in Sprint 1**:
- ✅ Extracted shared math utils to `src/utils/math.ts`

---

## Phase 4: Implement Special Indicators ✅ COMPLETED

### Files Created:
- `src/simulation/special-indicators/base.ts` - BaseSpecialIndicator abstract class
- `src/simulation/special-indicators/stop-loss.ts` - StopLossIndicator
- `src/simulation/special-indicators/take-profit.ts` - TakeProfitIndicator
- `src/simulation/special-indicators/trailing-stop.ts` - TrailingStopIndicator
- `src/simulation/special-indicators/balance.ts` - BalanceIndicator
- `src/simulation/special-indicators/operators.ts` - Expanding window operators
- `src/simulation/special-indicators/index.ts` - Module exports

### Audit Findings:

**Status**: ✅ Fully implemented following the BaseIndicator pattern

**Integration**: Already integrated into simulation loop (loop.ts)

---

## Phase 5: Modularize Backtester Architecture ✅ COMPLETED

### Implementation Date: 2026-01-01 (Sprint 2)

### Files Created:
- `src/simulation/stages/data-loading.ts` - Stage 1: Data Loading
- `src/simulation/stages/indicator-calculation.ts` - Stage 2: Indicator Pre-Calculation
- `src/simulation/stages/resampling.ts` - Stage 3: Resampling (CRITICAL)
- `src/simulation/stages/initialization.ts` - Stage 4: Algo State Initialization
- `src/simulation/stages/output.ts` - Stage 6: Output Generation
- `src/simulation/stages/index.ts` - Module exports and pipeline orchestrator

### Architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 1: Data Loading                                          │
│  executeDataLoading(candles, input) → DataLoadingResult         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Stage 2: Indicator Pre-Calculation                             │
│  executeIndicatorCalculation(input) → IndicatorCalculationResult│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Stage 3: Resampling (CRITICAL)                                 │
│  executeResampling(input) → ResamplingResult                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Stage 4: Algo State Initialization                             │
│  executeInitialization(input) → InitializationResult            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Stage 5: Simulation Loop                                       │
│  runSimulation(config) → SimulationResult                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Stage 6: Output Generation                                     │
│  executeOutputGeneration(input) → BacktestOutput                │
└─────────────────────────────────────────────────────────────────┘
```

### Audit Findings:

**Status**: ✅ Implementation Complete (with critical fix applied 2026-01-01)

**Critical Fix Applied**:
- 🔴 **Pipeline wiring bug**: Stage 3 output was being discarded
- Fixed: `runBacktestPipeline()` now correctly passes `resampledSignals` to Stage 5
- Fixed: `loop.ts` now accepts `SignalCache | ResampledSignalCache` union type

**Strengths**:
- All 6 stages implemented with explicit interfaces and types
- Full JSDoc documentation with @audit-trail annotations
- Each stage includes validation utilities for debugging
- Resampling is properly separated per the architectural requirement
- Pipeline orchestrator provides clean, single entry point
- Backward compatible (original loop.ts still works)

**Design Decisions**:
1. Each stage is a separate file with clear exports
2. All stages have explicit input/output interfaces
3. Each stage has a `validate*Result()` function
4. Stage-chaining helpers (`create*Input()`) provided
5. All files include @audit-trail JSDoc annotations

---

## Phase 6: Implement Dependency Injection ✅ COMPLETED

### Implementation Date: 2026-01-01 (Sprint 3)

**Core Concept**: "Faking the Executor" - Same Code for Live and Backtest

> "The algo class should have NO conditional logic like 'if is_backtesting: do X else do Y'"

### Files Created:

#### Interfaces (`src/interfaces/`)
- `executor.ts` - IExecutor interface for trade execution
- `database.ts` - IDatabase interface for state persistence
- `indicator-feed.ts` - IIndicatorFeed interface for signal access
- `index.ts` - Module exports

#### Fake Implementations (`src/simulation/fakes/`)
- `fake-executor.ts` - FakeExecutor simulates order execution
- `fake-database.ts` - FakeDatabase stores events in memory
- `pre-calculated-feed.ts` - PreCalculatedFeed wraps signal arrays
- `index.ts` - Module exports

#### Factory Functions (`src/factory/`)
- `backtest-factory.ts` - createBacktestEnvironment() and helpers
- `live-factory.ts` - Placeholder for live trading (requires SDK)
- `index.ts` - Module exports

### Architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        AlgoClass                                 │
│  ────────────────────────────────                               │
│  - Receives indicator signals                                    │
│  - Makes trading decisions                                       │
│  - Calls executor.placeOrder() / database.logEvent()            │
│  - NO knowledge of live vs backtest                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
         ┌────────────────────┴────────────────────┐
         ↓                                         ↓
┌─────────────────────┐                 ┌─────────────────────┐
│   LIVE ENVIRONMENT  │                 │ BACKTEST ENVIRONMENT│
├─────────────────────┤                 ├─────────────────────┤
│ RealExecutor        │                 │ FakeExecutor        │
│  → Exchange API     │                 │  → SwapEvent array  │
│                     │                 │                     │
│ RealDatabase        │                 │ FakeDatabase        │
│  → PostgreSQL/etc   │                 │  → In-memory array  │
│                     │                 │                     │
│ RealTimeFeed        │                 │ PreCalculatedFeed   │
│  → Real-time data   │                 │  → Historical batch │
└─────────────────────┘                 └─────────────────────┘
```

### Audit Findings:

**Status**: ✅ Implementation Complete (with integration fix 2026-01-02)

**Critical Fix Applied**:
- 🟡 **Original finding**: Infrastructure existed but was "dead code"
- ✅ **Fix 1**: Created `AlgoRunner` class that uses interfaces
- ✅ **Fix 2**: Refactored `runBacktestPipeline()` to use DI as MAIN execution path
- ✅ **Verification**: AlgoRunner has ZERO backtest/live conditional logic
- ✅ **Verification**: Main pipeline now uses BacktestEnvironment + AlgoRunner

**Strengths**:
- All three interfaces defined with comprehensive methods
- FakeExecutor simulates slippage, fees, and position tracking
- FakeDatabase provides efficient in-memory storage with querying
- PreCalculatedFeed wraps signal cache from Stage 2 & 3
- Factory functions wire up dependencies cleanly
- **AlgoRunner** - Environment-agnostic trading algorithm
- **runBacktestPipeline** - Main entry point now uses DI (no longer "dead code")
- All files include @audit-trail JSDoc annotations

**Design Decisions**:
1. **Async by Default**: All interface methods return Promise for live compatibility
2. **Backtest-Specific Methods**: Fake implementations expose reset() and sync accessors
3. **Factory Pattern**: createBacktestEnvironment() returns interface types only
4. **Live Placeholder**: live-factory.ts defines structure for future implementation
5. **AlgoRunner Pattern**: Single class for all environments, dependencies injected

---

## Phase 7: Implement Versioned Algo Configuration ✅ COMPLETED

### Implementation Date: 2026-01-01 (Sprint 4)

Three-Level Configuration:
1. **AlgoParams** - Pure algorithm definition (immutable)
2. **AlgoConfig** - AlgoParams + metadata (versioned)
3. **RunSettings** - Runtime configuration (per-run)

### Files Created (`src/config/`)

| File | Purpose |
|------|---------|
| `types.ts` | Enhanced types with versioning, timestamps, change tracking |
| `version-manager.ts` | VersionManager class for immutable config versioning |
| `validation.ts` | Validation utilities for configs and run settings |
| `comparison.ts` | Compare versions, generate diffs, track changes |
| `run-manager.ts` | RunManager class for tracking backtest/live runs |
| `index.ts` | Module exports |

### Key Features

#### VersionManager
- Create immutable config versions
- Auto-increment version numbers
- Track parent versions for history
- Hash params for quick equality checks
- Get version history and summaries

#### Validation
- Validate AlgoParams (entry/exit conditions, position sizing)
- Validate AlgoConfig (metadata + params)
- Validate RunSettings (backtest requirements, time ranges)
- Combined validation for backtest setup

#### Comparison
- Deep diff between config versions
- Human-readable change summaries
- Key parameter change detection
- Indicator comparison between versions

#### RunManager
- Create and track runs
- Update run status (NEW → RUNNING → DONE)
- Track timing (created, started, completed)
- Store output references
- Compare run metrics

### Audit Findings

**Status**: ✅ Implementation Complete

**Strengths**:
- Complete version management with immutability
- Comprehensive validation with severity levels
- Deep comparison with detailed diffs
- Run tracking with metrics comparison
- All files include @audit-trail JSDoc annotations

---

## Audit Summary

| Phase | Status | Completion Date | Notes |
|-------|--------|-----------------|-------|
| 2. Event System | ✅ Done | Pre-Sprint 1 | Issues fixed in Sprint 1 |
| 3. Metrics | ✅ Done | Pre-Sprint 1 | Math utils extracted; trading days/RFR audit fix |
| 4. Special Indicators | ✅ Done | Pre-Sprint 1 | Integrated in loop.ts |
| 5. Modular Architecture | ✅ Done | 2026-01-01 | Sprint 2 + critical wiring fix |
| 6. Dependency Injection | ✅ Done | 2026-01-02 | Sprint 3 + AlgoRunner integration fix |
| 7. Versioned Config | ✅ Done | 2026-01-01 | Sprint 4 complete |

**All planned phases complete!**

### Post-Sprint Audit Fixes Applied

1. **Trading Days & Risk-Free Rate** (2026-01-01): Changed `TRADING_DAYS_PER_YEAR` from 252 to 365, default risk-free rate from 0.02 to 0 (TradingView standard)
2. **Stage 3 Wiring** (2026-01-01): 🔴 CRITICAL - Pipeline now correctly passes resampled signals to Stage 5
3. **Phase 6 Integration** (2026-01-02): 🟡 PARTIAL → ✅ COMPLETE
   - Created `AlgoRunner` class with environment-agnostic trading logic
   - Refactored `runBacktestPipeline()` to use BacktestEnvironment + AlgoRunner
   - DI is now the MAIN execution path, not a parallel "dead code" path

---

## Architectural Principles

> "Resampling and simulation should be separate stages, not combined."

> "The algo class should have NO conditional logic like 'if is_backtesting: do X else do Y'"

> "Backtester must be capable of everything the live algo can do, but not more."
