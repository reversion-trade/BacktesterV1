/**
 * Live Factory
 *
 * @module factory/live-factory
 * @description
 * Factory functions for creating live trading environment dependencies.
 * Wires together real implementations for live trading.
 *
 * @architecture
 * This factory creates the dependency injection container for live mode:
 * - RealExecutor for actual exchange order execution
 * - RealDatabase for persistent state storage
 * - RealTimeFeed for live indicator computation
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * **NOTE**: This file defines interfaces and types for live trading.
 * Actual implementations require exchange SDK integration.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Define structure for live trading environment
 */

import type { AlgoConfig } from "../core/types.ts";
import type { IExecutor } from "../interfaces/executor.ts";
import type { IDatabase } from "../interfaces/database.ts";
import type { IIndicatorFeed } from "../interfaces/indicator-feed.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Exchange connection configuration.
 */
export interface ExchangeConfig {
    /** Exchange identifier (e.g., "hyperliquid", "kucoin") */
    exchangeId: string;
    /** API key for authentication */
    apiKey: string;
    /** API secret for signing requests */
    apiSecret: string;
    /** API passphrase (if required) */
    passphrase?: string;
    /** Whether to use testnet/sandbox */
    testnet?: boolean;
    /** Custom API endpoint */
    endpoint?: string;
}

/**
 * Database connection configuration.
 */
export interface DatabaseConfig {
    /** Database type (e.g., "postgres", "mongodb") */
    type: string;
    /** Connection string or host */
    host: string;
    /** Database port */
    port: number;
    /** Database name */
    database: string;
    /** Database user */
    user: string;
    /** Database password */
    password: string;
    /** Additional connection options */
    options?: Record<string, unknown>;
}

/**
 * Configuration for real-time indicator feed.
 */
export interface RealTimeFeedConfig {
    /** Data source for candles */
    dataSource: "exchange" | "external";
    /** Update interval in milliseconds */
    updateIntervalMs: number;
    /** Lookback period for indicator calculation */
    lookbackBars: number;
}

/**
 * Configuration for creating a live trading environment.
 */
export interface LiveEnvironmentConfig {
    /** Algorithm configuration */
    algoConfig: AlgoConfig;
    /** Exchange connection config */
    exchange: ExchangeConfig;
    /** Database connection config */
    database: DatabaseConfig;
    /** Real-time feed config */
    feed: RealTimeFeedConfig;
}

/**
 * Complete live trading environment with all dependencies.
 */
export interface LiveEnvironment {
    /** Trade executor (real) */
    executor: IExecutor;
    /** State database (real) */
    database: IDatabase;
    /** Indicator feed (real-time) */
    indicatorFeed: IIndicatorFeed;
    /** Algorithm configuration */
    algoConfig: AlgoConfig;
}

// =============================================================================
// PLACEHOLDER IMPLEMENTATIONS
// =============================================================================

/**
 * Placeholder for RealExecutor.
 *
 * This would be implemented with exchange-specific SDK integration.
 * For example: Hyperliquid SDK, KuCoin SDK, etc.
 */
export interface RealExecutorOptions {
    exchange: ExchangeConfig;
    algoConfig: AlgoConfig;
}

/**
 * Placeholder for RealDatabase.
 *
 * This would be implemented with database-specific driver.
 * For example: PostgreSQL with pg, MongoDB with mongoose, etc.
 */
export interface RealDatabaseOptions {
    database: DatabaseConfig;
    algoId: string;
    runId: string;
}

/**
 * Placeholder for RealTimeFeed.
 *
 * This would be implemented with real-time data streaming.
 * For example: WebSocket connections to exchange or data provider.
 */
export interface RealTimeFeedOptions {
    feed: RealTimeFeedConfig;
    algoConfig: AlgoConfig;
    exchange: ExchangeConfig;
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a live trading environment.
 *
 * **NOTE**: This is a stub implementation. Real implementations
 * would require exchange SDK integration and database drivers.
 *
 * @example
 * ```typescript
 * const env = await createLiveEnvironment({
 *   algoConfig,
 *   exchange: {
 *     exchangeId: "hyperliquid",
 *     apiKey: process.env.API_KEY,
 *     apiSecret: process.env.API_SECRET,
 *   },
 *   database: {
 *     type: "postgres",
 *     host: "localhost",
 *     port: 5432,
 *     database: "algo_trading",
 *     user: "algo",
 *     password: process.env.DB_PASSWORD,
 *   },
 *   feed: {
 *     dataSource: "exchange",
 *     updateIntervalMs: 1000,
 *     lookbackBars: 500,
 *   },
 * });
 *
 * // Run the algo (same code as backtest!)
 * const algo = new AlgoClass(
 *   env.executor,
 *   env.database,
 *   env.indicatorFeed,
 *   env.algoConfig
 * );
 * ```
 *
 * @throws Error - Always throws as implementations are not yet available
 */
export async function createLiveEnvironment(_config: LiveEnvironmentConfig): Promise<LiveEnvironment> {
    // This is a placeholder - real implementations would:
    // 1. Connect to the exchange via SDK
    // 2. Connect to the database
    // 3. Initialize real-time data feed
    // 4. Return wired-up environment

    throw new Error(
        "Live trading environment not yet implemented. " +
            "This requires exchange SDK integration (Hyperliquid, KuCoin, etc.) " +
            "and database drivers (PostgreSQL, MongoDB, etc.)."
    );
}

/**
 * Validate exchange connection.
 *
 * Tests the exchange API connection before running the algo.
 */
export async function validateExchangeConnection(_config: ExchangeConfig): Promise<boolean> {
    throw new Error("Exchange validation not yet implemented. " + "Requires exchange SDK integration.");
}

/**
 * Validate database connection.
 *
 * Tests the database connection before running the algo.
 */
export async function validateDatabaseConnection(_config: DatabaseConfig): Promise<boolean> {
    throw new Error("Database validation not yet implemented. " + "Requires database driver integration.");
}

// =============================================================================
// UTILITY TYPES FOR FUTURE IMPLEMENTATION
// =============================================================================

/**
 * Exchange SDK interface that real executors would implement.
 * This is a guide for future implementation.
 */
export interface ExchangeSDK {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    placeMarketOrder(params: { symbol: string; side: "BUY" | "SELL"; amount: number }): Promise<{
        orderId: string;
        filledAmount: number;
        avgPrice: number;
        fee: number;
    }>;
    getPosition(symbol: string): Promise<{
        size: number;
        entryPrice: number;
        unrealizedPnl: number;
    } | null>;
    getBalance(): Promise<number>;
    subscribeToTrades(callback: (trade: unknown) => void): void;
    subscribeToCandles(symbol: string, callback: (candle: unknown) => void): void;
}

/**
 * Database driver interface that real databases would implement.
 * This is a guide for future implementation.
 */
export interface DatabaseDriver {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    insert(collection: string, document: unknown): Promise<string>;
    find<T>(collection: string, query: unknown): Promise<T[]>;
    update(collection: string, query: unknown, update: unknown): Promise<number>;
    delete(collection: string, query: unknown): Promise<number>;
}
