# Audit Fixes Review Document

**Project**: backtester-v2
**Date**: 2026-01-01
**Document Type**: Audit Fix Verification Checklist
**Prepared For**: External Auditor Review

---

## Executive Summary

Two critical audit findings were identified and fixed:

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Trading Days & Risk-Free Rate Misconfiguration | Medium | ✅ Fixed |
| 2 | Stage 3 Resampling Wiring Bug | 🔴 Critical | ✅ Fixed |

---

## Fix #1: Trading Days & Risk-Free Rate

### Original Finding

> "Trading Days: I found that TRADING_DAYS_PER_YEAR is hardcoded to 252 in both swap-metrics.ts and metrics.ts. Crypto trades 24/7, so this should be 365. The risk-free rate should be 0 like TradingView's."

### Root Cause

- `TRADING_DAYS_PER_YEAR = 252` was stock market convention (weekdays only)
- Default `riskFreeAnnual = 0.02` (2%) was traditional finance assumption
- Crypto markets trade 24/7/365, requiring different constants

### Impact Before Fix

| Metric | Effect |
|--------|--------|
| Sharpe Ratio | Understated by ~20% (sqrt(365/252) ≈ 1.20) |
| Sortino Ratio | Understated by ~20% |
| Annualized Volatility | Understated by ~20% |
| Risk-adjusted returns | Artificially reduced by 2% risk-free assumption |

### Files Modified

#### File 1: `src/output/swap-metrics.ts`

**Location**: Lines 25-31 (new constants added)

```typescript
// BEFORE: Constants were inline, used 252 and 0.02

// AFTER: Centralized constants
const TRADING_DAYS_PER_YEAR = 365;
const DEFAULT_RISK_FREE_RATE = 0;
```

**Verification Points**:
- [ ] Line 25: `TRADING_DAYS_PER_YEAR = 365`
- [ ] Line 31: `DEFAULT_RISK_FREE_RATE = 0`
- [ ] Line 47: `calculateSwapMetrics()` uses `DEFAULT_RISK_FREE_RATE`
- [ ] Line 258: `calculateSharpeRatio()` uses module constant
- [ ] Line 267: Annualization uses `Math.sqrt(TRADING_DAYS_PER_YEAR)`
- [ ] Line 281: `calculateSortinoRatio()` uses module constant
- [ ] Line 298: Annualization uses `Math.sqrt(TRADING_DAYS_PER_YEAR)`

#### File 2: `src/output/metrics.ts`

**Location**: Lines 37-43 (new constants added)

```typescript
// BEFORE: Local constants in functions, used 252 and 0.02

// AFTER: Centralized constants
const TRADING_DAYS_PER_YEAR = 365;
const DEFAULT_RISK_FREE_RATE = 0;
```

**Verification Points**:
- [ ] Line 37: `TRADING_DAYS_PER_YEAR = 365`
- [ ] Line 43: `DEFAULT_RISK_FREE_RATE = 0`
- [ ] Line 59: `calculateSummaryMetrics()` default is `DEFAULT_RISK_FREE_RATE`
- [ ] Line 296: `calculateAdditionalMetrics()` default is `DEFAULT_RISK_FREE_RATE`
- [ ] Line 316: `annualizedVolatility` uses `Math.sqrt(TRADING_DAYS_PER_YEAR)`
- [ ] Line 447: `calculateSharpeRatio()` default is `DEFAULT_RISK_FREE_RATE`
- [ ] Line 453: Uses module-level `TRADING_DAYS_PER_YEAR` (no local override)
- [ ] Line 463: Annualization uses `Math.sqrt(TRADING_DAYS_PER_YEAR)`
- [ ] Line 481: `calculateSortinoRatio()` default is `DEFAULT_RISK_FREE_RATE`
- [ ] Line 488: Uses module-level `TRADING_DAYS_PER_YEAR` (no local override)
- [ ] Line 508: Annualization uses `Math.sqrt(TRADING_DAYS_PER_YEAR)`
- [ ] Line 564: `calculateAllMetrics()` default is `DEFAULT_RISK_FREE_RATE`

### Audit Trail

Both files have updated `@audit-trail` JSDoc annotations at file header:
```typescript
/**
 * @audit-trail
 * - Updated: 2026-01-01 (Audit Fix)
 * - Changed TRADING_DAYS_PER_YEAR from 252 to 365 for crypto (24/7 trading)
 * - Changed default risk-free rate from 0.02 to 0 (TradingView standard)
 */
```

---

## Fix #2: Stage 3 Resampling Wiring Bug (CRITICAL)

### Original Finding

> "The pipeline orchestrator (index.ts) effectively disables the critical fix for signal alignment. Stage 3 (Resampling) is Bypassed: The runBacktestPipeline function executes Stage 3 correctly (it creates the resamplingResult), but then throws it away."

### Root Cause

In `src/simulation/stages/index.ts`, the `runBacktestPipeline()` function:
1. Correctly executed Stage 3: `const resamplingResult = executeResampling(...)`
2. But passed the **wrong** signals to Stage 5: `signalCache: indicatorResult.signalCache`

This meant:
- Stage 3's resampled, aligned signals were discarded
- Stage 5 received raw, unaligned signals from Stage 2
- The critical architecture requirement was bypassed

### Impact Before Fix

| Issue | Consequence |
|-------|-------------|
| Multi-resolution indicators | NOT properly forward-filled |
| Signal alignment | Indicators at different resolutions misaligned |
| Architecture compliance | The "separate resampling stage" requirement violated |
| Backtest accuracy | Potentially incorrect signal timing |

### Files Modified

#### File 1: `src/simulation/loop.ts`

**Change 1**: Added import (Line 23)

```typescript
// BEFORE:
import type { SignalCache } from "../indicators/calculator.ts";

// AFTER:
import type { SignalCache } from "../indicators/calculator.ts";
import type { ResampledSignalCache } from "../indicators/resampler.ts";
```

**Verification Points**:
- [ ] Line 23: Import for `ResampledSignalCache` exists

**Change 2**: Updated SimulationConfig interface (Lines 51-56)

```typescript
// BEFORE:
signalCache: SignalCache;

// AFTER:
/**
 * Pre-calculated indicator signals.
 * Accepts either raw SignalCache (from Stage 2) or ResampledSignalCache (from Stage 3).
 * For proper multi-resolution support, use ResampledSignalCache from Stage 3.
 */
signalCache: SignalCache | ResampledSignalCache;
```

**Verification Points**:
- [ ] Lines 51-56: `signalCache` type is `SignalCache | ResampledSignalCache`
- [ ] JSDoc explains both types are accepted

**Change 3**: Updated getIndicatorStates function (Lines 170-174)

```typescript
// BEFORE:
function getIndicatorStates(
  barIndex: number,
  signalCache: SignalCache,
  indicatorKeys: string[]
): Map<string, boolean>

// AFTER:
function getIndicatorStates(
  barIndex: number,
  signalCache: SignalCache | ResampledSignalCache,
  indicatorKeys: string[]
): Map<string, boolean>
```

**Verification Points**:
- [ ] Line 172: Function parameter accepts union type

#### File 2: `src/simulation/stages/index.ts`

**Change**: Pipeline now passes correct signals (Lines 221-236)

```typescript
// BEFORE (BROKEN):
const simResult = runSimulation({
  candles: dataResult.filteredCandles,
  signalCache: indicatorResult.signalCache,      // ❌ Wrong!
  // ...
  warmupCandles: indicatorResult.warmupCandles,  // ❌ Wrong!
  // ...
});

// AFTER (FIXED):
// Stage 5: Simulation Loop
// CRITICAL: Use resampled signals from Stage 3 (not raw signals from Stage 2)
// This ensures proper multi-resolution indicator alignment via forward-fill.
const simResult = runSimulation({
  candles: dataResult.filteredCandles,
  signalCache: resamplingResult.resampledSignals,  // ✅ Correct!
  // ...
  warmupCandles: resamplingResult.warmupBars,      // ✅ Correct!
  // ...
});
```

**Verification Points**:
- [ ] Line 222-223: Comment explains CRITICAL nature of fix
- [ ] Line 226: `signalCache: resamplingResult.resampledSignals`
- [ ] Line 232: `warmupCandles: resamplingResult.warmupBars`

**Change**: Updated audit trail (Lines 56-61)

```typescript
// AFTER:
* @audit-trail
* - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
* - Updated: 2026-01-01 (Audit Fix - Stage 3 wiring)
* - Purpose: Central export point for all pipeline stages
* - Follows architecture principle: "Stages should be separate and explicit"
* - CRITICAL FIX: Pipeline now correctly passes resampledSignals to Stage 5
```

**Verification Points**:
- [ ] Line 58: `Updated: 2026-01-01 (Audit Fix - Stage 3 wiring)` exists
- [ ] Line 61: `CRITICAL FIX` note exists

---

## Verification Commands

### 1. Check Trading Days Constant

```bash
# Should return lines with "365" for TRADING_DAYS_PER_YEAR
grep -n "TRADING_DAYS_PER_YEAR = " src/output/swap-metrics.ts src/output/metrics.ts
```

**Expected Output**:
```
src/output/swap-metrics.ts:25:const TRADING_DAYS_PER_YEAR = 365;
src/output/metrics.ts:37:const TRADING_DAYS_PER_YEAR = 365;
```

### 2. Check Risk-Free Rate Constant

```bash
# Should return lines with "0" for DEFAULT_RISK_FREE_RATE
grep -n "DEFAULT_RISK_FREE_RATE = " src/output/swap-metrics.ts src/output/metrics.ts
```

**Expected Output**:
```
src/output/swap-metrics.ts:31:const DEFAULT_RISK_FREE_RATE = 0;
src/output/metrics.ts:43:const DEFAULT_RISK_FREE_RATE = 0;
```

### 3. Check No Remaining 252 References

```bash
# Should return NO lines with "252" in metrics files
grep -n "252" src/output/swap-metrics.ts src/output/metrics.ts
```

**Expected Output**: (empty - no matches)

### 4. Check Pipeline Wiring

```bash
# Should show resampledSignals being passed
grep -n "resamplingResult.resampledSignals" src/simulation/stages/index.ts
```

**Expected Output**:
```
src/simulation/stages/index.ts:226:    signalCache: resamplingResult.resampledSignals,
```

### 5. Check Union Type in loop.ts

```bash
# Should show union type for signalCache
grep -n "SignalCache | ResampledSignalCache" src/simulation/loop.ts
```

**Expected Output**:
```
src/simulation/loop.ts:56:  signalCache: SignalCache | ResampledSignalCache;
src/simulation/loop.ts:172:  signalCache: SignalCache | ResampledSignalCache,
```

---

## Data Flow Verification

### Before Fix (Broken)

```
Stage 2: Indicator Calculation
    ↓
    indicatorResult.signalCache (raw signals)
    ↓
Stage 3: Resampling
    ↓
    resamplingResult.resampledSignals (DISCARDED! ❌)
    ↓
Stage 5: Simulation Loop
    ↓
    Receives: indicatorResult.signalCache (WRONG! ❌)
```

### After Fix (Correct)

```
Stage 2: Indicator Calculation
    ↓
    indicatorResult.signalCache (raw signals)
    ↓
Stage 3: Resampling
    ↓
    resamplingResult.resampledSignals (aligned signals)
    ↓
Stage 5: Simulation Loop
    ↓
    Receives: resamplingResult.resampledSignals (CORRECT! ✅)
```

---

## Related Documentation Updated

| Document | Section Updated |
|----------|-----------------|
| `docs/audit/SPRINT-HISTORY.md` | Added "Audit Fix: Crypto Trading Days & Risk-Free Rate" section |
| `docs/audit/SPRINT-HISTORY.md` | Added "Audit Fix: Stage 3 Resampling Wiring" section |
| `docs/audit/ARCHITECTURE-ROADMAP.md` | Updated Phase 5 audit findings with critical fix |
| `docs/audit/ARCHITECTURE-ROADMAP.md` | Updated Audit Summary table |
| `docs/audit/ARCHITECTURE-ROADMAP.md` | Added "Post-Sprint Audit Fixes Applied" section |
| `docs/audit/README.md` | No changes needed (index file) |

---

## Sign-Off Checklist

### Fix #1: Trading Days & Risk-Free Rate

- [ ] `TRADING_DAYS_PER_YEAR = 365` in swap-metrics.ts
- [ ] `TRADING_DAYS_PER_YEAR = 365` in metrics.ts
- [ ] `DEFAULT_RISK_FREE_RATE = 0` in swap-metrics.ts
- [ ] `DEFAULT_RISK_FREE_RATE = 0` in metrics.ts
- [ ] No remaining `252` references in metrics files
- [ ] No remaining `0.02` defaults for risk-free rate
- [ ] `@audit-trail` annotations updated in both files

### Fix #2: Stage 3 Wiring

- [ ] `ResampledSignalCache` import added to loop.ts
- [ ] Union type `SignalCache | ResampledSignalCache` in SimulationConfig
- [ ] Union type in `getIndicatorStates()` function
- [ ] `resamplingResult.resampledSignals` passed to runSimulation
- [ ] `resamplingResult.warmupBars` passed to runSimulation
- [ ] `@audit-trail` annotation updated in index.ts
- [ ] Comment explaining CRITICAL nature of fix

### General

- [ ] TypeScript compilation: No new errors introduced
- [ ] Audit documentation updated in SPRINT-HISTORY.md
- [ ] Audit documentation updated in ARCHITECTURE-ROADMAP.md

---

---

## Fix #3: Phase 6 Dependency Injection Integration

### Original Finding

> "Infrastructure Exists... Integration Missing... The core simulation loop (src/simulation/loop.ts) ignores this new infrastructure... Verdict: 🟡 Partial Pass. The code is there, but it's 'dead code' in the current execution path."

### Root Cause

Phase 6 created the DI infrastructure (interfaces, fakes, factories) but never integrated it:
- `IExecutor`, `IDatabase`, `IIndicatorFeed` interfaces existed
- `FakeExecutor`, `FakeDatabase`, `PreCalculatedFeed` implementations existed
- `createBacktestEnvironment()` factory existed
- BUT: `runSimulation()` in loop.ts didn't use any of them

### Files Created

#### `src/simulation/algo-runner.ts` (NEW)
The core environment-agnostic trading algorithm:

```typescript
export class AlgoRunner {
  constructor(
    executor: IExecutor,      // Injected!
    database: IDatabase,      // Injected!
    indicatorFeed: IIndicatorFeed,  // Injected!
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
  closePositionOnExit: boolean
): Promise<AlgoRunnerBacktestResult>
```

**Verification Points**:
- [ ] AlgoRunner constructor accepts IExecutor, IDatabase, IIndicatorFeed
- [ ] NO conditional logic for backtest vs live
- [ ] Uses executor.placeOrder() for trades
- [ ] Uses database.logAlgoEvent() for events
- [ ] Uses indicatorFeed.getConditionSnapshot() for signals

#### `src/simulation/stages/index.ts` (UPDATED - MAIN PIPELINE NOW USES DI)
Refactored main `runBacktestPipeline()` to use DI infrastructure:

```typescript
export async function runBacktestPipeline(
  candles: Candle[],
  input: BacktestInput
): Promise<BacktestOutput>
// Stage 5 now uses:
// - createBacktestEnvironment() to wire dependencies
// - runBacktestWithAlgoRunner() with injected interfaces
// - This is the MAIN execution path, not a separate function
```

**Verification Points**:
- [ ] `runBacktestPipeline` is now async (returns Promise<BacktestOutput>)
- [ ] Creates BacktestEnvironment using `createBacktestEnvironment()`
- [ ] Passes `env.executor`, `env.database`, `env.indicatorFeed` to AlgoRunner
- [ ] Builds TradeEvents from FakeDatabase swap events
- [ ] Builds equity curve from AlgoRunner bar results

### Verification Commands

```bash
# Check AlgoRunner uses interfaces
grep -n "IExecutor\|IDatabase\|IIndicatorFeed" src/simulation/algo-runner.ts

# Check main pipeline uses createBacktestEnvironment
grep -n "createBacktestEnvironment" src/simulation/stages/index.ts

# Check main pipeline uses runBacktestWithAlgoRunner
grep -n "runBacktestWithAlgoRunner" src/simulation/stages/index.ts

# Confirm main pipeline is async
grep -n "async function runBacktestPipeline" src/simulation/stages/index.ts
```

### Architecture Compliance

**Architectural Requirement**:
> "The algo class should have NO conditional logic like 'if is_backtesting: do X else do Y'"

**Verification**:
```bash
# Should return NO matches in algo-runner.ts
grep -n "isBacktest\|is_backtest\|backtest\?" src/simulation/algo-runner.ts
```

### Sign-Off Checklist

#### Phase 6 Integration

- [ ] `AlgoRunner` class created with DI constructor
- [ ] `runBacktestWithAlgoRunner` function created
- [ ] `runBacktestPipeline` refactored to use DI as MAIN execution path
- [ ] `createBacktestEnvironment` used to wire dependencies
- [ ] AlgoRunner has NO backtest/live conditional logic
- [ ] FakeDatabase events accessible after run (via buildTradeEventsFromSwaps)
- [ ] Equity curve built from AlgoRunner bar results (via buildEquityCurve)
- [ ] `@audit-trail` annotations in all modified files

---

**Auditor Notes**:

_Space for auditor to add verification notes_

---

**Reviewed By**: _________________
**Date**: _________________
**Status**: [ ] Approved / [ ] Requires Changes
