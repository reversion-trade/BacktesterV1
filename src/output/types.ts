/**
 * Output Types for Backtester-v2
 *
 * Organized into two main output formats:
 * 1. BacktestResult - Legacy format with summary metrics (backwards compatible)
 * 2. BacktestOutput - New event-based format with full event logs and algo analytics
 *
 * Both formats are supported for migration purposes.
 */

import type { Direction, AlgoParams, AlgoConfig, RunSettings } from "../core/types.ts";

// Re-export event types from events module for convenience
export type {
    SwapEvent,
    TradeEvent,
    AlgoEvent,
    IndicatorFlipEvent,
    ConditionChangeEvent,
    StateTransitionEvent,
    SpecialIndicatorEvent,
    ConditionType,
    TransitionReason,
    ConditionSnapshot,
    SwapMetrics,
    AlgoMetrics,
    IndicatorAnalysis,
    NearMissAnalysis,
    ApproachSequence,
    BacktestOutput,
} from "../events/types.ts";

// =============================================================================
// TRADE RECORDS (Legacy Format - Category 3: List of Trades)
// =============================================================================

/**
 * Why did we exit a trade?
 */
export type ExitReason =
    | "SIGNAL" // Exit indicator condition was met
    | "STOP_LOSS" // Price hit stop loss
    | "TAKE_PROFIT" // Price hit take profit target
    | "TRAILING_STOP" // Trailing stop was triggered
    | "END_OF_BACKTEST"; // Forced close at end of data

/**
 * A complete record of one trade (entry → exit).
 * This is one row in the "List of Trades" table.
 */
export interface TradeRecord {
    // Identification
    tradeId: number;
    direction: Direction; // "LONG" or "SHORT"

    // Entry details
    entryTime: number; // Unix timestamp (seconds)
    entryPrice: number;

    // Exit details
    exitTime: number;
    exitPrice: number;

    // Position sizing
    qty: number; // Size in base currency (e.g., 0.5 BTC)

    // P&L
    pnlUSD: number; // Net profit/loss in USD
    pnlPct: number; // Percentage return (e.g., 0.05 = 5%)

    // Intra-trade extremes
    runUpUSD: number; // Peak unrealized profit during trade
    runUpPct: number; // Peak unrealized profit as percentage
    drawdownUSD: number; // Worst unrealized loss during trade (positive number)
    drawdownPct: number; // Worst unrealized loss as percentage

    // Duration
    durationSeconds: number; // How long trade was open
    durationBars: number; // How many candles trade was open

    // Running totals (for cumulative analysis)
    cumulativePnlUSD: number; // Total P&L up to and including this trade
    equityAfterTrade: number; // Portfolio value after this trade closed

    // Exit info
    exitReason: ExitReason;

    // Risk management (what was set, not what triggered)
    stopLossPrice?: number;
    takeProfitPrice?: number;
}

// =============================================================================
// EQUITY TRACKING
// =============================================================================

/**
 * A point on the equity curve.
 * Tracks portfolio value over time.
 */
export interface EquityPoint {
    time: number; // Unix timestamp
    equity: number; // Portfolio value in USD
    drawdownPct: number; // Current drawdown from peak (as decimal, e.g., 0.05 = 5%)
    runupPct: number; // Current runup from trough (as decimal)
}

// =============================================================================
// CATEGORY 1: SUMMARY
// =============================================================================

/**
 * High-level metrics shown at the top of backtest results.
 * Quick snapshot of strategy performance.
 */
export interface SummaryMetrics {
    totalPnlUSD: number; // Total profit/loss
    maxEquityDrawdownPct: number; // Largest peak-to-trough decline
    maxEquityRunupPct: number; // Largest trough-to-peak rise
    numberOfTrades: number; // Total completed trades
    winRate: number; // Winners / total (e.g., 0.55 = 55%)
    sharpeRatio: number; // Risk-adjusted return (higher = better)
    sortinoRatio: number; // Like Sharpe but only penalizes downside
    largestWinUSD: number; // Best single trade
    largestLossUSD: number; // Worst single trade (positive number)
}

// =============================================================================
// CATEGORY 2: PERFORMANCE
// =============================================================================

/**
 * Breakdown of a metric by direction (total, long, short).
 */
export interface ByDirection {
    total: number;
    long: number;
    short: number;
}

/**
 * P&L breakdown by direction.
 * Shows where profits/losses came from.
 */
export interface PerformanceMetrics {
    netProfit: ByDirection; // Profit after fees
    grossProfit: ByDirection; // Sum of all winning trades
    grossLoss: ByDirection; // Sum of all losing trades (positive number)
}

// =============================================================================
// CATEGORY 4: TRADES ANALYSIS
// =============================================================================

/**
 * A metric broken down by direction for longs and shorts.
 */
export interface LongShortBreakdown {
    long: number;
    short: number;
}

/**
 * Trade Statistics Subcategory
 */
export interface TradeStatistics {
    totalTrades: number;
    winningTradesCount: LongShortBreakdown;
    losingTradesCount: LongShortBreakdown;
    percentProfitable: LongShortBreakdown; // Win rate by direction (e.g., 0.55 = 55%)
}

/**
 * Profit & Loss Subcategory
 */
export interface PnLAnalysis {
    avgPnl: LongShortBreakdown; // Average P&L per trade
    avgWinningTrade: LongShortBreakdown; // Average profit on winners
    avgLosingTrade: LongShortBreakdown; // Average loss on losers (positive number)
    largestWinningTrade: LongShortBreakdown; // Best trade
    largestLosingTrade: LongShortBreakdown; // Worst trade (positive number)
}

/**
 * Trade Duration Subcategory
 */
export interface DurationAnalysis {
    avgTradeDurationBars: LongShortBreakdown; // Average holding period
    avgWinningTradeDurationBars: LongShortBreakdown; // Winners held longer or shorter?
    avgLosingTradeDurationBars: LongShortBreakdown; // Losers held longer or shorter?
}

/**
 * Complete trades analysis (Category 4).
 */
export interface TradesAnalysis {
    statistics: TradeStatistics;
    profitLoss: PnLAnalysis;
    duration: DurationAnalysis;
}

// =============================================================================
// ADDITIONAL METRICS (for internal calculations)
// =============================================================================

/**
 * Extra metrics useful for analysis but not in the 4 main categories.
 */
export interface AdditionalMetrics {
    // Risk metrics
    calmarRatio: number; // Annual return / max drawdown
    profitFactor: number; // Gross profit / gross loss
    expectancy: number; // Average expected profit per trade

    // Volatility
    dailyVolatility: number; // Standard deviation of daily returns
    annualizedVolatility: number; // Daily vol * sqrt(365)

    // Drawdown details
    maxDrawdownUSD: number; // Largest decline in USD
    maxDrawdownDurationSeconds: number; // Longest time in drawdown

    // Activity
    tradesPerDay: number; // Trading frequency
    annualizedReturnPct: number; // Return scaled to 1 year

    // Exit breakdown
    exitsByReason: {
        SIGNAL: number;
        STOP_LOSS: number;
        TAKE_PROFIT: number;
        TRAILING_STOP: number;
        END_OF_BACKTEST: number;
    };
}

// =============================================================================
// BACKTEST CONFIGURATION (Legacy)
// =============================================================================

/**
 * Settings used to run the backtest (legacy format).
 * Stored in results so you know what parameters produced these metrics.
 */
export interface BacktestConfig {
    coinSymbol: string; // e.g., "BTC", "ETH"
    startTime: number; // Backtest start (Unix timestamp)
    endTime: number; // Backtest end (Unix timestamp)
    startingCapitalUSD: number; // Initial portfolio value
    feeBps: number; // Trading fee in basis points
    slippageBps: number; // Slippage in basis points
    algoParams: AlgoParams; // The algorithm being tested
}

// =============================================================================
// FINAL BACKTEST RESULT (Legacy Format)
// =============================================================================

/**
 * The complete output of a backtest run (legacy format).
 * Organized into 4 categories plus supporting data.
 */
export interface BacktestResult {
    // What was tested
    config: BacktestConfig;

    // Category 1: Summary
    summary: SummaryMetrics;

    // Category 2: Performance
    performance: PerformanceMetrics;

    // Category 3: List of Trades
    trades: TradeRecord[];

    // Category 4: Trades Analysis
    analysis: TradesAnalysis;

    // Supporting data
    additional: AdditionalMetrics;
    equityCurve: EquityPoint[];

    // Meta
    completedAt: number; // When backtest finished (Unix timestamp)
    durationMs: number; // How long the backtest took to run
}

// =============================================================================
// NEW EVENT-BASED CONFIG
// =============================================================================

/**
 * Configuration for new event-based backtest output.
 */
export interface BacktestOutputConfig {
    algoId: string;
    algoName: string;
    version: number;
    symbol: string;
    startTime: number;
    endTime: number;
    startingCapitalUSD: number;
    feeBps: number;
    slippageBps: number;
    algoConfig?: AlgoConfig;
    runSettings?: RunSettings;
}
