/**
 * Factory Module
 *
 * Central export point for environment factory functions.
 * Provides backtest environment with dependency injection.
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
