# Backtester V2: Codebase Audit & Modularity Review

**Date**: January 5, 2026
**Repository**: `backtester-v2`

---

## 1. Recent Audit: Statistics & Correctness
**Status**: ✅ FIXED & VERIFIED

Critical bugs were identified in the statistics calculation engine and have been resolved.

### Key Fixes
1.  **Equity Calculation**: `FakeExecutor.getBalance()` now correctly uses Mark-to-Market valuation for both LONG and SHORT positions (previously led to unrealistic Sharpe/Sortino ratios).
2.  **Signal Flip Detection**: `PreCalculatedFeed` and `AlgoRunner` now correctly track `INDICATOR_FLIP` events (previously populated `indicatorAnalysis` with empty data).
3.  **Crypto Market Norms**:
    - `TRADING_DAYS_PER_YEAR` updated to **365** (was 252).
    - `RISK_FREE_RATE` default updated to **0%** (matches TradingView standard).

---

## 2. Modularity Evaluation: Technical Debt & Bloat
**Status**: ⚠️ SIGNIFICANT REDUNDANCY FOUND

A systematic review of the codebase revealed three major areas of architectural duplication and bloat.

### A. Dual Simulation Engines (High Priority)
The codebase currently maintains two parallel backtesting engines. This is the primary source of checking "clunkiness".

*   **Legacy Engine**: `src/simulation/loop.ts`
    *   Used by `src/index.ts` (the main library entry point).
    *   Monolithic, hardcoded event logic.
*   **Modern Engine**: `src/simulation/algo-runner.ts`
    *   Used by the new pipeline (`src/simulation/stages/index.ts`).
    *   Dependency Injection based (`IExecutor`, `IDatabase`), environment-agnostic.

**Risk**: Features fixed in one engine (like the recent stats bugs) must be manually duplicated in the other.
**Recommendation**: Deprecate `loop.ts` immediately and switch `index.ts` to use the `AlgoRunner` pipeline.

### B. Duplicated Financial Math
Complex financial formulas are copy-pasted between two files:
1.  `src/output/metrics.ts` (Legacy)
2.  `src/output/swap-metrics.ts` (New Events System)

**Code Duplication**:
- `calculateSharpeRatio`
- `calculateSortinoRatio`
- `calculateCalmarRatio`
- `aggregateToDailyReturns`

**Recommendation**: Extract these into a single `src/utils/financial-math.ts` utility.

### C. "Dead" Pipeline Stages
The `src/simulation/stages/` folder implies a modular pipeline exists, but the default entry point (`src/index.ts`) mostly bypasses it to call the legacy loop directly. This makes the architecture confusing for new developers.

---

## 3. Proposed Refactoring Plan

1.  **Extract Shared Math**: Create `src/utils/financial-math.ts` and refactor both metrics files to use it.
2.  **Unify Engines**: Update `src/index.ts` to use `runBacktestPipeline` (Modern) exclusively.
3.  **Deprecate Legacy**: Add `@deprecated` tags to `src/simulation/loop.ts` and eventually remove it.

This refactor will remove ~600-800 lines of redundant code and ensure single-source-of-truth for all backtest calculations.
