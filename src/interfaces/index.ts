/**
 * Interfaces Module
 *
 * @module interfaces
 * @description
 * Central export point for all dependency injection interfaces.
 * These interfaces enable the algo class to work identically
 * in backtest and live environments.
 *
 * @architecture
 * The three core interfaces abstract the environment-specific details:
 * - IExecutor: Trade execution (FakeExecutor vs RealExecutor)
 * - IDatabase: State persistence (FakeDatabase vs RealDatabase)
 * - IIndicatorFeed: Signal access (PreCalculatedFeed vs RealTimeFeed)
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Provide clean interface exports for DI pattern
 */

// =============================================================================
// EXECUTOR INTERFACE
// =============================================================================

export type {
    // Order types
    OrderRequest,
    OrderResult,
    OpenOrder,
    Position,
    // Main interface
    IExecutor,
} from "./executor.ts";

// =============================================================================
// DATABASE INTERFACE
// =============================================================================

export type {
    // State types
    AlgoState,
    IndicatorStateSnapshot,
    EventQueryOptions,
    // Main interface
    IDatabase,
} from "./database.ts";

// =============================================================================
// INDICATOR FEED INTERFACE
// =============================================================================

export type {
    // Info types
    IndicatorInfo,
    IndicatorState,
    ConditionEvaluation,
    // Main interface
    IIndicatorFeed,
} from "./indicator-feed.ts";
