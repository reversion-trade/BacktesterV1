/**
 * Factory Module
 *
 * @module factory
 * @description
 * Central export point for environment factory functions.
 * Provides clean separation between backtest and live environments.
 *
 * @architecture
 * The factory pattern enables switching between environments
 * at configuration time, not runtime:
 *
 * - Backtest: createBacktestEnvironment() with fake implementations
 * - Live: createLiveEnvironment() with real implementations
 *
 * The algo class receives the same interface types regardless
 * of which factory created them.
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Provide clean factory exports
 */

// =============================================================================
// BACKTEST FACTORY
// =============================================================================

export {
    createBacktestEnvironment,
    createBacktestEnvironmentInternal,
    buildIndicatorInfoMapFromConfig,
    resetBacktestEnvironment,
} from "./backtest-factory.ts";

export type {
    BacktestEnvironmentConfig,
    BacktestEnvironment,
    BacktestEnvironmentInternal,
} from "./backtest-factory.ts";

// =============================================================================
// LIVE FACTORY
// =============================================================================

export { createLiveEnvironment, validateExchangeConnection, validateDatabaseConnection } from "./live-factory.ts";

export type {
    ExchangeConfig,
    DatabaseConfig,
    RealTimeFeedConfig,
    LiveEnvironmentConfig,
    LiveEnvironment,
    RealExecutorOptions,
    RealDatabaseOptions,
    RealTimeFeedOptions,
    ExchangeSDK,
    DatabaseDriver,
} from "./live-factory.ts";
