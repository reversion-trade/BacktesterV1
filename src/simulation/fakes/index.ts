/**
 * Fakes Module
 *
 * @module simulation/fakes
 * @description
 * Central export point for all fake (backtest) implementations
 * of the dependency injection interfaces.
 *
 * @architecture
 * These fakes enable the algo class to run in backtest mode
 * without any conditional logic. The algo code uses the same
 * interfaces regardless of environment.
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Provide clean exports for fake implementations
 */

// =============================================================================
// FAKE EXECUTOR
// =============================================================================

export { FakeExecutor } from "./fake-executor.ts";
export type { FakeExecutorConfig } from "./fake-executor.ts";

// =============================================================================
// FAKE DATABASE
// =============================================================================

export { FakeDatabase } from "./fake-database.ts";

// =============================================================================
// PRE-CALCULATED FEED
// =============================================================================

export { PreCalculatedFeed } from "./pre-calculated-feed.ts";
export type { SignalCache, RawValueCache } from "./pre-calculated-feed.ts";
