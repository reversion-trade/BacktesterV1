# Sprint History

**Project**: backtester-v2
**Document Type**: Audit Trail - Sprint Implementation Log

---

## Sprint 1: Foundation Cleanup ✅ COMPLETED

**Date**: 2026-01-01
**Duration**: ~1 day

### Objectives
1. Fix Phase 2 issues (dual state tracking, validation)
2. Extract shared math utils from metrics files
3. Verify special indicators integration

### Changes Made

#### 1. Fixed Dual State Tracking

**Problem**: `prevConditionMet` tracked in loop.ts AND `conditionState.previousMet` in EventCollector.

**Solution**:
- Added `getPreviousConditionMet(type)` getter to EventCollector
- Updated loop.ts to use collector as single source of truth

**File**: `src/events/collector.ts`
```typescript
getPreviousConditionMet(conditionType: ConditionType): boolean {
  const condState = this.conditionStates.get(conditionType);
  return condState?.previousMet ?? false;
}
```

**File**: `src/simulation/loop.ts`
- Removed local `prevConditionMet` record
- All condition checks now use `collector.getPreviousConditionMet()`

#### 2. Added Indicator Registration Validation

**Problem**: If signalCache has keys not in indicatorInfoMap, they are silently ignored.

**Solution**: Added validation warning on first bar.

**File**: `src/events/collector.ts`
```typescript
// In updateIndicators():
if (barIndex === 0) {
  for (const key of states.keys()) {
    if (!indicatorInfoMap.has(key)) {
      console.warn(
        `[EventCollector] Indicator key "${key}" in signalCache but not registered.`
      );
    }
  }
}
```

#### 3. Extracted Shared Math Utilities

**Problem**: `sum()` and `mean()` duplicated in swap-metrics.ts, algo-metrics.ts, metrics.ts.

**Solution**: Created shared utilities module.

**File Created**: `src/utils/math.ts`
```typescript
export function sum(values: number[]): number { ... }
export function mean(values: number[]): number { ... }
export function stddevPopulation(values: number[]): number { ... }
export function stddevSample(values: number[]): number { ... }
export function min(values: number[]): number { ... }
export function max(values: number[]): number { ... }
```

**Files Updated**:
- `src/output/swap-metrics.ts` - Import from utils/math.ts
- `src/output/algo-metrics.ts` - Import from utils/math.ts
- `src/output/metrics.ts` - Import from utils/math.ts

#### 4. Verified Special Indicators Integration

**Finding**: Special indicators were already integrated in loop.ts.
- StopLossIndicator, TakeProfitIndicator, TrailingStopIndicator, BalanceIndicator
- All used in position entry/exit logic

---

## Sprint 2: Modularize Architecture ✅ COMPLETED

**Date**: 2026-01-01
**Duration**: ~1 day

### Objectives
1. Create src/simulation/stages/ directory
2. Extract resampling as separate stage (high priority)
3. Formalize all 6 stages with clear interfaces
4. Create pipeline orchestrator

### Files Created

| File | Stage | Purpose |
|------|-------|---------|
| `src/simulation/stages/data-loading.ts` | 1 | Config validation, candle filtering |
| `src/simulation/stages/indicator-calculation.ts` | 2 | Indicator pre-calculation wrapper |
| `src/simulation/stages/resampling.ts` | 3 | Signal resampling (CRITICAL) |
| `src/simulation/stages/initialization.ts` | 4 | Algo state setup |
| `src/simulation/stages/output.ts` | 6 | Metrics and output assembly |
| `src/simulation/stages/index.ts` | - | Module exports + orchestrator |

### Stage Details

#### Stage 1: Data Loading
- `executeDataLoading(candles, input)` → DataLoadingResult
- `filterCandlesToRange()` - Filter candles to time range
- `extractDataRequirements()` - Extract data requirements

#### Stage 2: Indicator Pre-Calculation
- `executeIndicatorCalculation(input)` → IndicatorCalculationResult
- Wraps existing calculator.ts
- Adds validation and metadata

#### Stage 3: Resampling (CRITICAL)
- `executeResampling(input)` → ResamplingResult
- Forward-fill signals to simulation timeframe
- **Separate stage per the architectural requirement**
- Includes ResamplingStats for audit

#### Stage 4: Initialization
- `executeInitialization(input)` → InitializationResult
- `buildIndicatorInfoMap()` - Build indicator metadata
- Handles `assumePositionImmediately` flag

#### Stage 5: Simulation Loop
- Existing `runSimulation()` in loop.ts
- No changes required

#### Stage 6: Output Generation
- `executeOutputGeneration(input)` → BacktestOutput
- `calculateMetrics()` - Calculate all metrics
- `createEmptyBacktestOutput()` - Handle empty case

### Pipeline Orchestrator
- `runBacktestPipeline(candles, input)` → BacktestOutput
- Chains all 6 stages
- New recommended entry point

### Audit Documentation
- All files include `@audit-trail` JSDoc annotations
- Each stage has `validate*Result()` function
- Convenience helpers: `create*Input()` functions

### TypeScript Compilation
- Verified: No errors in new stage files
- Pre-existing errors in other files (algo.ts, special-indicators tests) unrelated

---

## Sprint 3: Dependency Injection ✅ COMPLETED

**Date**: 2026-01-01
**Duration**: ~1 day

### Objectives
1. Define IExecutor, IDatabase, IIndicatorFeed interfaces
2. Create fake implementations for backtest
3. Create factory functions for environment creation

### Core Concept

> "The algo class should have NO conditional logic like 'if is_backtesting: do X else do Y'"

The dependency injection pattern ensures the same algo code runs identically in backtest and live environments.

### Files Created

#### Interfaces (`src/interfaces/`)

| File | Purpose |
|------|---------|
| `executor.ts` | IExecutor interface for trade execution |
| `database.ts` | IDatabase interface for state persistence |
| `indicator-feed.ts` | IIndicatorFeed interface for signal access |
| `index.ts` | Module exports |

#### Fake Implementations (`src/simulation/fakes/`)

| File | Purpose |
|------|---------|
| `fake-executor.ts` | Simulates order execution with slippage/fees |
| `fake-database.ts` | In-memory event and state storage |
| `pre-calculated-feed.ts` | Wraps pre-calculated signal arrays |
| `index.ts` | Module exports |

#### Factory Functions (`src/factory/`)

| File | Purpose |
|------|---------|
| `backtest-factory.ts` | Creates backtest environment with fake implementations |
| `live-factory.ts` | Defines structure for live trading (placeholder) |
| `index.ts` | Module exports |

### Interface Details

#### IExecutor
```typescript
interface IExecutor {
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOpenOrders(symbol?: string): Promise<OpenOrder[]>;
  getPosition(symbol: string): Promise<Position | null>;
  getCurrentPrice(symbol: string): Promise<number>;
  getBalance(): Promise<number>;
}
```

#### IDatabase
```typescript
interface IDatabase {
  logAlgoEvent(event: AlgoEvent): Promise<void>;
  logSwapEvent(swap: SwapEvent): Promise<void>;
  getAlgoEvents(options?: EventQueryOptions): Promise<AlgoEvent[]>;
  getSwapEvents(options?: EventQueryOptions): Promise<SwapEvent[]>;
  saveState(state: AlgoState): Promise<void>;
  getState(): Promise<AlgoState | null>;
  saveIndicatorSnapshot(snapshot: IndicatorStateSnapshot): Promise<void>;
  getIndicatorSnapshotAtBar(barIndex: number): Promise<IndicatorStateSnapshot | null>;
  clear(): Promise<void>;
}
```

#### IIndicatorFeed
```typescript
interface IIndicatorFeed {
  setCurrentBar(barIndex: number, timestamp: number): void;
  getCurrentBarIndex(): number;
  getCurrentSignals(): Map<string, boolean>;
  getSignal(indicatorKey: string): boolean | undefined;
  getRawValue(indicatorKey: string): number | undefined;
  evaluateCondition(conditionType: ConditionType): ConditionEvaluation;
  getConditionSnapshot(conditionType: ConditionType): ConditionSnapshot;
  getIndicatorInfo(): Map<string, IndicatorInfo>;
  getIndicatorsForCondition(conditionType: ConditionType): IndicatorInfo[];
  getPreviousConditionMet(conditionType: ConditionType): boolean;
  getTotalBars(): number;
}
```

### Factory Usage

```typescript
// Create backtest environment
const env = createBacktestEnvironment({
  algoConfig,
  candles,
  signalCache,      // From Stage 2 & 3
  indicatorInfoMap,
  feeBps: 10,
  slippageBps: 5,
});

// Same algo code works with both environments
const algo = new AlgoClass(
  env.executor,
  env.database,
  env.indicatorFeed,
  env.algoConfig
);
```

### TypeScript Compilation
- Verified: No errors in Sprint 3 files
- All interfaces and implementations type-safe

### Audit Documentation
- All files include `@audit-trail` JSDoc annotations
- Architecture requirement documented in all relevant files
- Clear separation of interface vs implementation

---

## Sprint 4: Versioned Configuration ✅ COMPLETED

**Date**: 2026-01-01
**Duration**: ~1 day

### Objectives
1. Finalize AlgoParams, AlgoConfig, RunSettings types
2. Create version manager
3. Create validation utilities
4. Add comparison capabilities
5. Create run manager

### Core Concept

Three-Level Configuration:
1. **AlgoParams** - Pure algorithm definition (immutable)
2. **AlgoConfig** - AlgoParams + metadata (versioned, immutable once created)
3. **RunSettings** - Runtime configuration (per-run, mutable status)

### Files Created (`src/config/`)

| File | Purpose |
|------|---------|
| `types.ts` | Enhanced types with versioning, timestamps, change tracking |
| `version-manager.ts` | VersionManager class for config versioning |
| `validation.ts` | Validation utilities for configs and run settings |
| `comparison.ts` | Compare versions, generate diffs |
| `run-manager.ts` | RunManager class for tracking runs |
| `index.ts` | Module exports |

### Key Features

#### Version Manager
```typescript
const manager = new VersionManager();

// Create initial version
const v1 = manager.createConfig({
  userID: "user123",
  algoName: "My RSI Strategy",
  params: { ... },
});

// Update creates new immutable version
const v2 = manager.updateConfig({
  existingConfig: v1,
  newParams: { ...v1.params, startingCapitalUSD: 20000 },
  changeNotes: "Increased capital",
});

// Get version history
const history = manager.getVersionHistory(v1.algoID);
```

#### Validation
```typescript
// Validate config
const result = validateAlgoConfig(config);
if (!result.isValid) {
  console.log(result.issues);
}

// Validate backtest setup
const setup = validateBacktestSetup(config, runSettings);
```

#### Comparison
```typescript
// Compare two versions
const comparison = compareConfigs(v1, v2);
console.log(comparison.differences);

// Get human-readable summary
const summary = getChangeSummary(comparison);
```

#### Run Manager
```typescript
const runManager = new RunManager();

// Create and track runs
const run = runManager.createRun({
  algoID: "algo_123",
  version: 1,
  isBacktest: true,
  // ...
});

// Update status
runManager.updateStatus(run.runID, "RUNNING");
runManager.completeRun(run.runID, "output_ref");
```

### Enhanced Types

#### VersionedAlgoConfig
- `createdAt`: Timestamp of version creation
- `changeNotes`: Description of changes
- `parentVersion`: Link to previous version
- `paramsHash`: Quick equality check

#### TrackedRunSettings
- `createdAt`, `startedAt`, `completedAt`: Timestamps
- `errorMessage`: Error details if failed
- `outputRef`: Reference to backtest output

### TypeScript Compilation
- Verified: No errors in Sprint 4 files

### Audit Documentation
- All files include `@audit-trail` JSDoc annotations
- Three-level configuration clearly documented

---

## Audit Fix: Crypto Trading Days & Risk-Free Rate ✅ COMPLETED

**Date**: 2026-01-01
**Type**: Post-Sprint Audit Fix

### Issue Identified

External audit found that annualized metrics were misconfigured:

1. **Trading Days**: `TRADING_DAYS_PER_YEAR` hardcoded to 252 (stock market convention)
   - Crypto trades 24/7, should be 365 days
   - Affected: Sharpe Ratio, Sortino Ratio, Annualized Volatility

2. **Risk-Free Rate**: Default was 0.02 (2%)
   - TradingView uses 0 as default for crypto
   - Affected: All Sharpe/Sortino calculations

### Files Modified

#### `src/output/swap-metrics.ts`
- Added file-level constants:
  ```typescript
  const TRADING_DAYS_PER_YEAR = 365;
  const DEFAULT_RISK_FREE_RATE = 0;
  ```
- Updated `calculateSwapMetrics()` default to `DEFAULT_RISK_FREE_RATE`
- Updated `calculateSharpeRatio()` to use constants
- Updated `calculateSortinoRatio()` to use constants

#### `src/output/metrics.ts`
- Added file-level constants (same as above)
- Updated `calculateSummaryMetrics()` default to `DEFAULT_RISK_FREE_RATE`
- Updated `calculateAdditionalMetrics()` default to `DEFAULT_RISK_FREE_RATE`
- Updated `calculateAllMetrics()` default to `DEFAULT_RISK_FREE_RATE`
- Updated `calculateSharpeRatio()`:
  - Removed local `TRADING_DAYS_PER_YEAR = 252`
  - Changed default from `0.02` to `DEFAULT_RISK_FREE_RATE`
- Updated `calculateSortinoRatio()`:
  - Removed local `TRADING_DAYS_PER_YEAR = 252`
  - Changed default from `0.02` to `DEFAULT_RISK_FREE_RATE`
- Updated annualized volatility calculation:
  - Changed `Math.sqrt(252)` to `Math.sqrt(TRADING_DAYS_PER_YEAR)`

### Impact

**Before Fix**:
- Annualized metrics understated by factor of ~sqrt(365/252) ≈ 1.2
- Sharpe/Sortino ratios artificially reduced by 2% risk-free rate assumption

**After Fix**:
- Metrics correctly use 365-day annualization for 24/7 crypto markets
- Metrics match TradingView's default behavior (0 risk-free rate)
- All annualized metrics now properly comparable to industry standards

### Audit Trail
- `@audit-trail` annotations added to both files documenting the fix
- Constants centralized at module level for consistency
- All JSDoc comments updated to reflect new defaults

---

## Audit Fix: Stage 3 Resampling Wiring ✅ COMPLETED (CRITICAL)

**Date**: 2026-01-01
**Type**: Post-Sprint Audit Fix
**Severity**: 🔴 CRITICAL

### Issue Identified

External audit found that the pipeline orchestrator was **bypassing Stage 3 (Resampling)**:

**Problem**: In `src/simulation/stages/index.ts`, the `runBacktestPipeline()` function:
1. Correctly executed Stage 3 (created `resamplingResult`)
2. But then **threw it away** and passed the old, unaligned signals to Stage 5

```typescript
// BEFORE (BROKEN):
signalCache: indicatorResult.signalCache,  // ❌ Old unaligned signals
warmupCandles: indicatorResult.warmupCandles,
```

**Result**: The backtester was running with the "Signal Alignment Bug" active, meaning:
- Multi-resolution indicators were NOT properly aligned
- Forward-fill behavior was NOT applied
- The resampling architecture was NOT being used

### Files Modified

#### `src/simulation/loop.ts`
- Added import for `ResampledSignalCache` from resampler.ts
- Updated `SimulationConfig.signalCache` type to accept `SignalCache | ResampledSignalCache`
- Updated `getIndicatorStates()` function signature to match
- Added JSDoc documenting the union type support

```typescript
// NEW: Accepts either type
signalCache: SignalCache | ResampledSignalCache;
```

#### `src/simulation/stages/index.ts`
- **CRITICAL FIX**: Now passes `resamplingResult.resampledSignals` to Stage 5
- Also passes `resamplingResult.warmupBars` (aligned to simulation resolution)
- Updated `@audit-trail` annotation documenting the fix

```typescript
// AFTER (FIXED):
signalCache: resamplingResult.resampledSignals,  // ✅ Resampled aligned signals
warmupCandles: resamplingResult.warmupBars,
```

### Impact

**Before Fix**:
- Stage 3 output was discarded
- Multi-resolution indicators NOT properly forward-filled
- Signal alignment bug remained active

**After Fix**:
- Stage 3 output correctly wired to Stage 5
- Multi-resolution indicators properly aligned via forward-fill
- The architecture requirement ("Resampling separate from simulation") now functional

### Verification

- TypeScript compilation: No new errors introduced
- Union type `SignalCache | ResampledSignalCache` allows backward compatibility
- `ResampledSignalCache` has compatible interface (`.get()`, `.has()`, `.keys()`)

---

## Audit Fix: Phase 6 Dependency Injection Integration ✅ COMPLETED

**Date**: 2026-01-02
**Type**: Post-Sprint Audit Fix
**Severity**: 🟡 Partial Pass → ✅ Complete

### Issue Identified

External audit found that Phase 6 Dependency Injection was incomplete:

**Problem**: Infrastructure existed but wasn't integrated:
- Interfaces (IExecutor, IDatabase, IIndicatorFeed) existed
- Fake implementations existed
- Factory functions existed
- BUT: `runSimulation()` in loop.ts didn't use any of them

**Result**: The DI infrastructure was "dead code" in the execution path.

### Files Created/Modified

#### `src/simulation/algo-runner.ts` (NEW)
Environment-agnostic trading algorithm using dependency injection:

```typescript
export class AlgoRunner {
  constructor(
    executor: IExecutor,
    database: IDatabase,
    indicatorFeed: IIndicatorFeed,
    config: AlgoRunnerConfig
  )

  async onBar(candle: Candle, barIndex: number): Promise<BarResult>
  async closePosition(candle, barIndex, reason): Promise<boolean>
}

export async function runBacktestWithAlgoRunner(
  executor: IExecutor,
  database: IDatabase,
  indicatorFeed: IIndicatorFeed,
  candles: Candle[],
  config: AlgoRunnerConfig,
  closePositionOnExit: boolean = true
): Promise<AlgoRunnerBacktestResult>
```

**Key Design Decisions**:
- AlgoRunner has NO knowledge of backtest vs live
- All trade execution through IExecutor interface
- All event logging through IDatabase interface
- All signal access through IIndicatorFeed interface
- Fulfills the architectural requirement: No conditional logic for environment

#### `src/simulation/stages/index.ts` (UPDATED)
Added interface-based pipeline orchestrator:

```typescript
export async function runBacktestPipelineWithDI(
  candles: Candle[],
  input: BacktestInput
): Promise<DIBacktestResult>
```

**Integration Steps**:
1. Execute Stages 1-4 (Data, Indicators, Resampling, Init)
2. Convert ResampledSignalCache to SignalCache format
3. Convert IndicatorInfo to interface-compatible format
4. Create BacktestEnvironment via `createBacktestEnvironment()`
5. Run AlgoRunner with injected dependencies
6. Extract events from FakeDatabase

### Impact

**Before Fix**:
- DI infrastructure was unused
- Simulation used direct function calls instead of interfaces
- No path to live trading with same code

**After Fix**:
- AlgoRunner uses injected interfaces
- `runBacktestPipelineWithDI` demonstrates full DI integration
- Same AlgoRunner code can be used for live trading
- The architecture requirement fully satisfied

### Architecture Compliance

**Architectural Requirement**:
> "The algo class should have NO conditional logic like 'if is_backtesting: do X else do Y'"

**Verification**: AlgoRunner contains zero references to backtest/live mode detection.

### Verification Commands

```bash
# Check AlgoRunner uses interfaces
grep -n "IExecutor\|IDatabase\|IIndicatorFeed" src/simulation/algo-runner.ts

# Verify no backtest conditional logic
grep -n "isBacktest\|is_backtest" src/simulation/algo-runner.ts  # Should return empty

# Check pipeline integration
grep -n "createBacktestEnvironment\|runBacktestWithAlgoRunner" src/simulation/stages/index.ts
```
