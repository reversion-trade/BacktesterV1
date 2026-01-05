/**
 * Core Types for Backtester-v2
 *
 * We import existing types from the indicators library and frontend
 * to stay consistent with the rest of the codebase.
 */

// =============================================================================
// IMPORTS FROM INDICATORS LIBRARY
// =============================================================================

// Candle: { bucket, open, high, low, close, volume }
// ChartPoint: { time, value, values? }
export type { Candle, ChartPoint } from "@indicators/common.ts";

// IndicatorConfig: { type: "RSI" | "MACD" | ..., params: {...} }
import type { IndicatorConfig as _IndicatorConfig } from "@indicators/factory.ts";
export type { IndicatorConfig } from "@indicators/factory.ts";

// Re-declare for internal use
type IndicatorConfig = _IndicatorConfig;

// =============================================================================
// POSITION STATES
// =============================================================================

/**
 * The three possible states during a backtest:
 * - FLAT: No open position (waiting for entry signal)
 * - LONG: Bought asset, profit when price goes UP
 * - SHORT: Sold borrowed asset, profit when price goes DOWN
 */
export type PositionState = "FLAT" | "LONG" | "SHORT";

/**
 * Direction of a trade (excludes FLAT since that's "no trade")
 */
export type Direction = "LONG" | "SHORT";

/**
 * Algorithm type - what directions can it trade?
 */
export type AlgoType = "LONG" | "SHORT" | "BOTH";

/**
 * Run status for tracking algo/backtest lifecycle
 */
export type RunStatus = "NEW" | "RUNNING" | "DONE";

/**
 * Order execution type - speed vs fill rate/probability trade-off
 */
export type OrderType = "MARKET" | "TWAP" | "SMART" | "LIMIT";

// =============================================================================
// LADDER PARAMETERS
// =============================================================================

/**
 * Parameters for ladder-based position sizing or entry/exit levels.
 * Used to create multiple levels at different price offsets.
 */
export interface LadderParams {
    /** Map of <offset, weight> in percent */
    levels: Record<number, number>;
    /** Expected offset sign(s) */
    direction: "UP" | "DOWN" | "CENTER";
    /** Whether to remove levels beyond limit (CLAMP) or scale proportionally (SCALE) */
    method: "CLAMP" | "SCALE";
    /** Whether to require all weights to be normalized (false for pyramiding) */
    normalize: boolean;
}

// =============================================================================
// VALUE CONFIGURATION
// =============================================================================

/**
 * How to interpret a numeric value:
 * - ABS: Absolute value in USD (e.g., $100 stop loss)
 * - REL: Relative/percentage (e.g., 2% stop loss stored as 0.02)
 * - DYN: Dynamic - modulated by indicator's value (0-100 range)
 */
export type ValueType = "ABS" | "REL" | "DYN";

/**
 * A value that can be absolute, relative, or dynamic.
 * Used for: position size, stop loss, take profit
 *
 * Examples:
 *   { type: "ABS", value: 100 }   → $100
 *   { type: "REL", value: 0.02 }  → 2%
 *   { type: "DYN", value: 0.05, valueFactor: {...} } → 5% modulated by indicator
 */
export interface ValueConfig {
    /** Applicable to both price levels and position sizes */
    type: ValueType;
    /** USD price or amount if type=ABS, percent otherwise */
    value: number;
    /** Single-use value-modulating indicator (if type=DYN) */
    valueFactor?: IndicatorConfig;
    /** Scale up (position size) or down (stop loss) based on indicator's value */
    inverted?: boolean;
    /** Persistent set of levels generated after value * valueFactor evaluation */
    ladder?: LadderParams;
}

// =============================================================================
// ENTRY & EXIT CONDITIONS
// =============================================================================

/**
 * Conditions to ENTER a trade.
 *
 * Logic: ALL required indicators must signal (AND)
 *        + at least ONE optional indicator must signal (OR)
 *        + if optional is empty, required alone is sufficient
 */
export interface EntryCondition {
    /** All required indicators must be true for condition to be true */
    required: IndicatorConfig[];
    /** At least one optional indicator must be true for condition to be true */
    optional: IndicatorConfig[];
}

/**
 * Conditions to EXIT a trade.
 *
 * Can exit via:
 * 1. Indicator signals (same AND/OR logic as entry)
 * 2. Stop loss (price moves against you)
 * 3. Take profit (price hits target)
 * 4. Trailing stop (price drops from peak)
 */
export interface ExitCondition {
    /** All required indicators must be true for condition to be true */
    required: IndicatorConfig[];
    /** At least one optional indicator must be true for condition to be true */
    optional: IndicatorConfig[];
    /** Relative to entry price if type=REL/DYN */
    stopLoss?: ValueConfig;
    /** Relative to entry price if type=REL/DYN */
    takeProfit?: ValueConfig;
    /** Available only when stopLoss is set */
    trailingSL?: boolean;
}

// =============================================================================
// ALGORITHM PARAMETERS
// =============================================================================

/**
 * Complete algorithm definition.
 * Defines entry/exit conditions for long and/or short trades.
 *
 * Note: Run-specific settings (assumePositionImmediately, closePositionOnExit)
 * have moved to RunSettings to separate algo definition from execution config.
 */
export interface AlgoParams {
    /** What directions can this algo trade? */
    type: AlgoType;
    /** Entry conditions for long trades */
    longEntry?: EntryCondition;
    /** Exit conditions for long trades */
    longExit?: ExitCondition;
    /** Entry conditions for short trades */
    shortEntry?: EntryCondition;
    /** Exit conditions for short trades */
    shortExit?: ExitCondition;
    /** Becomes mandatory if stopLoss/takeProfit.type=ABS */
    coinSymbol?: string;
    /** Relative to currentCapitalUSD if type=REL/DYN (starts with startingCapitalUSD) */
    positionSize: ValueConfig;
    /** Speed vs fill rate/probability trade-off */
    orderType: OrderType;
    /** Initial capital for REL/DYN position sizing, or minimum capital for ABS sizing */
    startingCapitalUSD: number;
}

// =============================================================================
// ALGORITHM CONFIGURATION
// =============================================================================

/**
 * Wraps AlgoParams with identification and versioning.
 * AlgoParams are read-only - new versions must be created for changes.
 */
export interface AlgoConfig {
    userID: string;
    algoID: string;
    algoName: string;
    /** AlgoParams are read-only, new versions needed to record changes */
    version: number;
    /** All risk/win rate defining parameters */
    params: AlgoParams;
}

// =============================================================================
// RUN SETTINGS
// =============================================================================

/**
 * Configuration for a specific run (backtest or live trading).
 * Separates execution config from algorithm definition.
 */
export interface RunSettings {
    userID: string;
    /** A pair of algoID + version reference a unique read-only AlgoConfig */
    algoID: string;
    version: string;
    runID: string;
    /** Whether this is a live trading algo or a backtest simulation */
    isBacktest: boolean;
    /** Autofilled with AlgoParams.coinSymbol if set there (cannot be overridden) */
    coinSymbol: string;
    /** Scales AlgoParams.startingCapitalUSD (and positionSize if type=ABS). Defaults to 1 */
    capitalScaler: number;
    /** Unix timestamp (seconds) - required if isBacktest=true or assumePositionImmediately=false */
    startTime?: number;
    /** Unix timestamp (seconds) - required if isBacktest=true or closePositionOnExit=true */
    endTime?: number;
    /** Auto-stop after reaching certain number of trades */
    tradesLimit?: number;
    /** Enter on first signal without waiting (NEW -> RUNNING transition) */
    assumePositionImmediately: boolean;
    /** Force close when algo stops (RUNNING -> DONE transition) */
    closePositionOnExit: boolean;
    /** Unix timestamp (seconds) of when the run was submitted */
    launchTime: number;
    /** Algo/Backtesting services are responsible for progressing the status */
    status: RunStatus;
    /** Exchange identifier (Hyperliquid, KuCoin, etc.) */
    exchangeID: string;
}

// =============================================================================
// RE-EXPORT OUTPUT TYPES
// =============================================================================

// Trade records, equity tracking, and metrics are in src/output/types.ts
// Re-export them here for convenience
export type {
    // Trade records
    ExitReason,
    TradeRecord,
    EquityPoint,
    // Category 1: Summary
    SummaryMetrics,
    // Category 2: Performance
    ByDirection,
    PerformanceMetrics,
    // Category 4: Trades Analysis
    LongShortBreakdown,
    TradeStatistics,
    PnLAnalysis,
    DurationAnalysis,
    TradesAnalysis,
    // Additional
    AdditionalMetrics,
    // Final result
    BacktestConfig as OutputBacktestConfig,
    BacktestResult,
} from "../output/types.ts";
