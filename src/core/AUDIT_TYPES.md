# Audit Report: src/core/types.ts

## Execution Summary
Audited `src/core/types.ts` to verify type usage, consistency, and clean up opportunities.

## Findings

### 1. Legacy/Shared Types
**Status:** INFORMATIONAL
**Types:** `RunStatus`, `OrderType`
**Observation:**
- `RunStatus` values ("NEW", "RUNNING", "DONE") are defined but unused in the backtester logic. The comment explicitly notes this is for consistency with the live trading system.
- `OrderType` defines "MARKET", "TWAP", "SMART", "LIMIT", but comments note the algorunner is hardcoded to MARKET.
**Recommendation:** Keep as-is if the goal is to maintain compatibility with a live trading schema. If the backtester is a standalone project, these could be simplified.

### 2. Type Usages
**Status:** HEALTHY
- `TimeoutMode` ("COOLDOWN_ONLY", "REGULAR", "STRICT") is actively used in `event-simulator.ts`.
- `AlgoParams` and `ValueConfig` are deeply integrated into the configuration and simulation logic.

### 3. Separation of Concerns
**Status:** GOOD
- `src/core/types.ts` correctly handles Domain/Configuration types (`AlgoParams`, `PositionState`).
- `src/events/types.ts` correctly handles Event/Metric types (`SwapEvent`, `AlgoMetrics`).
- No circular dependencies or overlaps detected between these two core type files.

## Conclusion
The file `src/core/types.ts` is in good health. It contains some unused types that are intentionally kept for schematic consistency with external systems. No immediate refactoring is required.
