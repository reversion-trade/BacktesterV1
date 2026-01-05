/**
 * Backtest Factory
 *
 * @module factory/backtest-factory
 * @description
 * Factory functions for creating backtest environment dependencies.
 * Wires together fake implementations for backtesting.
 *
 * @architecture
 * This factory creates the dependency injection container for backtest mode:
 * - FakeExecutor for simulated order execution
 * - FakeDatabase for in-memory state storage
 * - PreCalculatedFeed for pre-computed indicator signals
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Wire up dependencies for backtest environment
 */

import type { AlgoConfig, Candle } from "../core/types.ts";
import type { IExecutor } from "../interfaces/executor.ts";
import type { IDatabase } from "../interfaces/database.ts";
import type { IIndicatorFeed, IndicatorInfo } from "../interfaces/indicator-feed.ts";
import type { ConditionType } from "../events/types.ts";

import { FakeExecutor, FakeDatabase, PreCalculatedFeed } from "../simulation/fakes/index.ts";
import type { FakeExecutorConfig, SignalCache } from "../simulation/fakes/index.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for creating a backtest environment.
 */
export interface BacktestEnvironmentConfig {
    /** Algorithm configuration */
    algoConfig: AlgoConfig;
    /** Historical candle data */
    candles: Candle[];
    /** Pre-calculated signal cache (from Stage 2 & 3) */
    signalCache: SignalCache;
    /** Indicator metadata map */
    indicatorInfoMap: Map<string, IndicatorInfo>;
    /** Fee in basis points (default: 10 = 0.1%) */
    feeBps?: number;
    /** Slippage in basis points (default: 5 = 0.05%) */
    slippageBps?: number;
}

/**
 * Complete backtest environment with all dependencies.
 */
export interface BacktestEnvironment {
    /** Trade executor (fake) */
    executor: IExecutor;
    /** State database (fake) */
    database: IDatabase;
    /** Indicator feed (pre-calculated) */
    indicatorFeed: IIndicatorFeed;
    /** Algorithm configuration */
    algoConfig: AlgoConfig;
    /** Historical candle data */
    candles: Candle[];
}

/**
 * Extended environment with access to fake implementation internals.
 * Use this when you need backtest-specific functionality.
 */
export interface BacktestEnvironmentInternal extends BacktestEnvironment {
    /** Access to FakeExecutor methods */
    fakeExecutor: FakeExecutor;
    /** Access to FakeDatabase methods */
    fakeDatabase: FakeDatabase;
    /** Access to PreCalculatedFeed methods */
    preCalculatedFeed: PreCalculatedFeed;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a complete backtest environment.
 *
 * This is the main factory function that wires up all dependencies
 * for running a backtest. The returned environment provides interface
 * types that can be passed to the algo class.
 *
 * @example
 * ```typescript
 * // After Stage 2 & 3: indicator calculation and resampling
 * const signalCache = new Map<string, boolean[]>();
 * const indicatorInfoMap = new Map<string, IndicatorInfo>();
 *
 * const env = createBacktestEnvironment({
 *   algoConfig,
 *   candles,
 *   signalCache,
 *   indicatorInfoMap,
 *   feeBps: 10,
 *   slippageBps: 5,
 * });
 *
 * // Run the algo
 * const algo = new AlgoClass(
 *   env.executor,
 *   env.database,
 *   env.indicatorFeed,
 *   env.algoConfig
 * );
 * ```
 */
export function createBacktestEnvironment(config: BacktestEnvironmentConfig): BacktestEnvironment {
    const { algoConfig, candles, signalCache, indicatorInfoMap, feeBps = 10, slippageBps = 5 } = config;

    // Extract symbol from config
    const symbol = algoConfig.params.coinSymbol || "UNKNOWN";

    // Create executor config
    const executorConfig: FakeExecutorConfig = {
        initialCapitalUSD: algoConfig.params.startingCapitalUSD,
        feeBps,
        slippageBps,
        symbol,
    };

    // Create fake implementations
    const fakeExecutor = new FakeExecutor(executorConfig);
    const fakeDatabase = new FakeDatabase();
    const preCalculatedFeed = new PreCalculatedFeed(signalCache, indicatorInfoMap);

    return {
        executor: fakeExecutor,
        database: fakeDatabase,
        indicatorFeed: preCalculatedFeed,
        algoConfig,
        candles,
    };
}

/**
 * Create a backtest environment with internal access.
 *
 * This is useful when you need to access backtest-specific
 * functionality like retrieving swap events or resetting state.
 *
 * @example
 * ```typescript
 * const env = createBacktestEnvironmentInternal({...});
 *
 * // Run backtest...
 *
 * // Access internal data
 * const swaps = env.fakeExecutor.getSwapEvents();
 * const events = env.fakeDatabase.getAllAlgoEventsSync();
 * ```
 */
export function createBacktestEnvironmentInternal(config: BacktestEnvironmentConfig): BacktestEnvironmentInternal {
    const { algoConfig, candles, signalCache, indicatorInfoMap, feeBps = 10, slippageBps = 5 } = config;

    const symbol = algoConfig.params.coinSymbol || "UNKNOWN";

    const executorConfig: FakeExecutorConfig = {
        initialCapitalUSD: algoConfig.params.startingCapitalUSD,
        feeBps,
        slippageBps,
        symbol,
    };

    const fakeExecutor = new FakeExecutor(executorConfig);
    const fakeDatabase = new FakeDatabase();
    const preCalculatedFeed = new PreCalculatedFeed(signalCache, indicatorInfoMap);

    return {
        executor: fakeExecutor,
        database: fakeDatabase,
        indicatorFeed: preCalculatedFeed,
        algoConfig,
        candles,
        // Internal access
        fakeExecutor,
        fakeDatabase,
        preCalculatedFeed,
    };
}

/**
 * Build indicator info map from algo config.
 *
 * Extracts indicator metadata from entry/exit conditions
 * and creates a map suitable for the PreCalculatedFeed.
 *
 * @param config - Algorithm configuration
 * @param getIndicatorKey - Function to generate indicator key from config
 */
export function buildIndicatorInfoMapFromConfig(
    algoConfig: AlgoConfig,
    getIndicatorKey: (indicatorConfig: unknown) => string
): Map<string, IndicatorInfo> {
    const infoMap = new Map<string, IndicatorInfo>();
    const params = algoConfig.params;

    const addIndicators = (indicators: unknown[] | undefined, conditionType: ConditionType, isRequired: boolean) => {
        if (!indicators) return;

        for (const ind of indicators) {
            const key = getIndicatorKey(ind);
            const config = ind as { type?: string };
            infoMap.set(key, {
                key,
                type: config.type || "UNKNOWN",
                conditionType,
                isRequired,
            });
        }
    };

    // Long entry indicators
    if (params.longEntry) {
        addIndicators(params.longEntry.required, "LONG_ENTRY", true);
        addIndicators(params.longEntry.optional, "LONG_ENTRY", false);
    }

    // Long exit indicators
    if (params.longExit) {
        addIndicators(params.longExit.required, "LONG_EXIT", true);
        addIndicators(params.longExit.optional, "LONG_EXIT", false);
    }

    // Short entry indicators
    if (params.shortEntry) {
        addIndicators(params.shortEntry.required, "SHORT_ENTRY", true);
        addIndicators(params.shortEntry.optional, "SHORT_ENTRY", false);
    }

    // Short exit indicators
    if (params.shortExit) {
        addIndicators(params.shortExit.required, "SHORT_EXIT", true);
        addIndicators(params.shortExit.optional, "SHORT_EXIT", false);
    }

    return infoMap;
}

/**
 * Reset all components in a backtest environment.
 *
 * Call this between backtest runs to clear state.
 */
export async function resetBacktestEnvironment(env: BacktestEnvironmentInternal): Promise<void> {
    env.fakeExecutor.reset();
    env.preCalculatedFeed.reset();
    await env.fakeDatabase.clear();
}
