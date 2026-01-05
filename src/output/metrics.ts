/**
 * Performance Metrics Calculation
 *
 * Calculate all backtest performance metrics from trades and equity curves.
 *
 * @audit-trail
 * - Updated: 2026-01-01 (Audit Fix)
 * - Changed TRADING_DAYS_PER_YEAR from 252 to 365 for crypto (24/7 trading)
 * - Changed default risk-free rate from 0.02 to 0 (TradingView standard)
 */

import type {
    TradeRecord,
    EquityPoint,
    SummaryMetrics,
    PerformanceMetrics,
    TradesAnalysis,
    TradeStatistics,
    PnLAnalysis,
    DurationAnalysis,
    AdditionalMetrics,
    LongShortBreakdown,
    ByDirection,
    ExitReason,
} from "./types.ts";
import { mean, stddevPopulation } from "../utils/math.ts";
import {
    TRADING_DAYS_PER_YEAR,
    DEFAULT_RISK_FREE_RATE,
    aggregateToDailyReturns,
    calculateSharpeRatio,
    calculateSortinoRatio,
    calculateCalmarRatio,
} from "../utils/financial-math.ts";

// =============================================================================
// SUMMARY METRICS (Category 1)
// =============================================================================

/**
 * Calculate summary metrics for the backtest.
 *
 * @param trades - Completed trades
 * @param equityCurve - Equity curve points
 * @param riskFreeAnnual - Annual risk-free rate (default 0 per TradingView)
 */
export function calculateSummaryMetrics(
    trades: TradeRecord[],
    equityCurve: EquityPoint[],
    riskFreeAnnual: number = DEFAULT_RISK_FREE_RATE
): SummaryMetrics {
    if (trades.length === 0) {
        return {
            totalPnlUSD: 0,
            maxEquityDrawdownPct: 0,
            maxEquityRunupPct: 0,
            numberOfTrades: 0,
            winRate: 0,
            sharpeRatio: 0,
            sortinoRatio: 0,
            largestWinUSD: 0,
            largestLossUSD: 0,
        };
    }

    const totalPnlUSD = trades.reduce((sum, t) => sum + t.pnlUSD, 0);
    const winners = trades.filter((t) => t.pnlUSD > 0);
    const losers = trades.filter((t) => t.pnlUSD < 0);

    const winRate = trades.length > 0 ? winners.length / trades.length : 0;

    const largestWinUSD = winners.length > 0 ? Math.max(...winners.map((t) => t.pnlUSD)) : 0;
    const largestLossUSD = losers.length > 0 ? Math.abs(Math.min(...losers.map((t) => t.pnlUSD))) : 0;

    const maxEquityDrawdownPct = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.drawdownPct)) : 0;
    const maxEquityRunupPct = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.runupPct)) : 0;

    // TradingView-style: uses periodic returns, not per-trade returns
    const dailyReturns = aggregateToDailyReturns(equityCurve);
    const sharpeRatio = calculateSharpeRatio(dailyReturns, riskFreeAnnual);
    const sortinoRatio = calculateSortinoRatio(dailyReturns, riskFreeAnnual);

    return {
        totalPnlUSD,
        maxEquityDrawdownPct,
        maxEquityRunupPct,
        numberOfTrades: trades.length,
        winRate,
        sharpeRatio,
        sortinoRatio,
        largestWinUSD,
        largestLossUSD,
    };
}

// =============================================================================
// PERFORMANCE METRICS (Category 2)
// =============================================================================

/**
 * Calculate performance metrics by direction.
 */
export function calculatePerformanceMetrics(trades: TradeRecord[]): PerformanceMetrics {
    const longTrades = trades.filter((t) => t.direction === "LONG");
    const shortTrades = trades.filter((t) => t.direction === "SHORT");

    const netProfit: ByDirection = {
        total: trades.reduce((sum, t) => sum + t.pnlUSD, 0),
        long: longTrades.reduce((sum, t) => sum + t.pnlUSD, 0),
        short: shortTrades.reduce((sum, t) => sum + t.pnlUSD, 0),
    };

    const winners = trades.filter((t) => t.pnlUSD > 0);
    const longWinners = longTrades.filter((t) => t.pnlUSD > 0);
    const shortWinners = shortTrades.filter((t) => t.pnlUSD > 0);

    const grossProfit: ByDirection = {
        total: winners.reduce((sum, t) => sum + t.pnlUSD, 0),
        long: longWinners.reduce((sum, t) => sum + t.pnlUSD, 0),
        short: shortWinners.reduce((sum, t) => sum + t.pnlUSD, 0),
    };

    const losers = trades.filter((t) => t.pnlUSD < 0);
    const longLosers = longTrades.filter((t) => t.pnlUSD < 0);
    const shortLosers = shortTrades.filter((t) => t.pnlUSD < 0);

    const grossLoss: ByDirection = {
        total: Math.abs(losers.reduce((sum, t) => sum + t.pnlUSD, 0)),
        long: Math.abs(longLosers.reduce((sum, t) => sum + t.pnlUSD, 0)),
        short: Math.abs(shortLosers.reduce((sum, t) => sum + t.pnlUSD, 0)),
    };

    return {
        netProfit,
        grossProfit,
        grossLoss,
    };
}

// =============================================================================
// TRADES ANALYSIS (Category 4)
// =============================================================================

/**
 * Calculate trade statistics by direction.
 */
export function calculateTradeStatistics(trades: TradeRecord[]): TradeStatistics {
    const longTrades = trades.filter((t) => t.direction === "LONG");
    const shortTrades = trades.filter((t) => t.direction === "SHORT");

    const longWinners = longTrades.filter((t) => t.pnlUSD > 0);
    const shortWinners = shortTrades.filter((t) => t.pnlUSD > 0);
    const longLosers = longTrades.filter((t) => t.pnlUSD < 0);
    const shortLosers = shortTrades.filter((t) => t.pnlUSD < 0);

    return {
        totalTrades: trades.length,
        winningTradesCount: {
            long: longWinners.length,
            short: shortWinners.length,
        },
        losingTradesCount: {
            long: longLosers.length,
            short: shortLosers.length,
        },
        percentProfitable: {
            long: longTrades.length > 0 ? longWinners.length / longTrades.length : 0,
            short: shortTrades.length > 0 ? shortWinners.length / shortTrades.length : 0,
        },
    };
}

/**
 * Calculate P&L analysis by direction.
 */
export function calculatePnLAnalysis(trades: TradeRecord[]): PnLAnalysis {
    const longTrades = trades.filter((t) => t.direction === "LONG");
    const shortTrades = trades.filter((t) => t.direction === "SHORT");

    const avgPnl: LongShortBreakdown = {
        long: mean(longTrades.map((t) => t.pnlUSD)),
        short: mean(shortTrades.map((t) => t.pnlUSD)),
    };

    const longWinners = longTrades.filter((t) => t.pnlUSD > 0);
    const shortWinners = shortTrades.filter((t) => t.pnlUSD > 0);
    const longLosers = longTrades.filter((t) => t.pnlUSD < 0);
    const shortLosers = shortTrades.filter((t) => t.pnlUSD < 0);

    return {
        avgPnl,
        avgWinningTrade: {
            long: mean(longWinners.map((t) => t.pnlUSD)),
            short: mean(shortWinners.map((t) => t.pnlUSD)),
        },
        avgLosingTrade: {
            long: Math.abs(mean(longLosers.map((t) => t.pnlUSD))),
            short: Math.abs(mean(shortLosers.map((t) => t.pnlUSD))),
        },
        largestWinningTrade: {
            long: longWinners.length > 0 ? Math.max(...longWinners.map((t) => t.pnlUSD)) : 0,
            short: shortWinners.length > 0 ? Math.max(...shortWinners.map((t) => t.pnlUSD)) : 0,
        },
        largestLosingTrade: {
            long: longLosers.length > 0 ? Math.abs(Math.min(...longLosers.map((t) => t.pnlUSD))) : 0,
            short: shortLosers.length > 0 ? Math.abs(Math.min(...shortLosers.map((t) => t.pnlUSD))) : 0,
        },
    };
}

/**
 * Calculate duration analysis by direction.
 */
export function calculateDurationAnalysis(trades: TradeRecord[]): DurationAnalysis {
    const longTrades = trades.filter((t) => t.direction === "LONG");
    const shortTrades = trades.filter((t) => t.direction === "SHORT");

    const longWinners = longTrades.filter((t) => t.pnlUSD > 0);
    const shortWinners = shortTrades.filter((t) => t.pnlUSD > 0);
    const longLosers = longTrades.filter((t) => t.pnlUSD < 0);
    const shortLosers = shortTrades.filter((t) => t.pnlUSD < 0);

    return {
        avgTradeDurationBars: {
            long: mean(longTrades.map((t) => t.durationBars)),
            short: mean(shortTrades.map((t) => t.durationBars)),
        },
        avgWinningTradeDurationBars: {
            long: mean(longWinners.map((t) => t.durationBars)),
            short: mean(shortWinners.map((t) => t.durationBars)),
        },
        avgLosingTradeDurationBars: {
            long: mean(longLosers.map((t) => t.durationBars)),
            short: mean(shortLosers.map((t) => t.durationBars)),
        },
    };
}

/**
 * Calculate complete trades analysis.
 */
export function calculateTradesAnalysis(trades: TradeRecord[]): TradesAnalysis {
    return {
        statistics: calculateTradeStatistics(trades),
        profitLoss: calculatePnLAnalysis(trades),
        duration: calculateDurationAnalysis(trades),
    };
}

// =============================================================================
// ADDITIONAL METRICS
// =============================================================================

/**
 * Calculate additional metrics.
 *
 * @param trades - Completed trades
 * @param equityCurve - Equity curve points
 * @param startTime - Backtest start timestamp
 * @param endTime - Backtest end timestamp
 * @param initialCapital - Starting capital
 * @param riskFreeAnnual - Annual risk-free rate (default 0.02 = 2%)
 */
export function calculateAdditionalMetrics(
    trades: TradeRecord[],
    equityCurve: EquityPoint[],
    startTime: number,
    endTime: number,
    initialCapital: number,
    _riskFreeAnnual: number = DEFAULT_RISK_FREE_RATE // Reserved for future use (Calmar uses CAGR, not risk-free)
): AdditionalMetrics {
    const totalDays = (endTime - startTime) / (24 * 60 * 60);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnlUSD, 0);
    const finalEquity = initialCapital + totalPnl;

    const performance = calculatePerformanceMetrics(trades);
    const profitFactor =
        performance.grossLoss.total > 0
            ? performance.grossProfit.total / performance.grossLoss.total
            : performance.grossProfit.total > 0
              ? Infinity
              : 0;

    const expectancy = trades.length > 0 ? totalPnl / trades.length : 0;

    const dailyReturns = aggregateToDailyReturns(equityCurve);
    const dailyVolatility = stddevPopulation(dailyReturns);
    const annualizedVolatility = dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

    const maxDrawdownPct = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.drawdownPct)) : 0;
    const maxDrawdownUSD = maxDrawdownPct * initialCapital;

    let maxDrawdownDuration = 0;
    let currentDrawdownStart = -1;

    for (let i = 0; i < equityCurve.length; i++) {
        if (equityCurve[i]!.drawdownPct > 0) {
            if (currentDrawdownStart === -1) {
                currentDrawdownStart = i > 0 ? equityCurve[i - 1]!.time : equityCurve[i]!.time;
            }
        } else if (currentDrawdownStart !== -1) {
            const duration = equityCurve[i]!.time - currentDrawdownStart;
            if (duration > maxDrawdownDuration) {
                maxDrawdownDuration = duration;
            }
            currentDrawdownStart = -1;
        }
    }

    const totalYears = totalDays / 365;
    let cagr = 0;
    if (totalYears > 0 && initialCapital > 0 && finalEquity > 0) {
        cagr = Math.pow(finalEquity / initialCapital, 1 / totalYears) - 1;
    }

    const totalReturnPct = initialCapital > 0 ? totalPnl / initialCapital : 0;
    const annualizedReturnPct = totalDays > 0 ? totalReturnPct * (365 / totalDays) : 0;

    const calmarRatio = calculateCalmarRatio(cagr, maxDrawdownPct);

    const exitsByReason = countExitsByReason(trades);

    return {
        calmarRatio,
        profitFactor,
        expectancy,
        dailyVolatility,
        annualizedVolatility,
        maxDrawdownUSD,
        maxDrawdownDurationSeconds: maxDrawdownDuration,
        tradesPerDay: totalDays > 0 ? trades.length / totalDays : 0,
        annualizedReturnPct,
        exitsByReason,
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Count exits by reason.
 */
function countExitsByReason(trades: TradeRecord[]): {
    SIGNAL: number;
    STOP_LOSS: number;
    TAKE_PROFIT: number;
    TRAILING_STOP: number;
    END_OF_BACKTEST: number;
} {
    const counts = {
        SIGNAL: 0,
        STOP_LOSS: 0,
        TAKE_PROFIT: 0,
        TRAILING_STOP: 0,
        END_OF_BACKTEST: 0,
    };

    for (const trade of trades) {
        counts[trade.exitReason]++;
    }

    return counts;
}

// =============================================================================
// ALL METRICS COMBINED
// =============================================================================

/**
 * Calculate all metrics at once.
 *
 * @param trades - Completed trades
 * @param equityCurve - Equity curve points
 * @param startTime - Backtest start timestamp
 * @param endTime - Backtest end timestamp
 * @param initialCapital - Starting capital
 * @param riskFreeAnnual - Annual risk-free rate (default 0 per TradingView)
 */
export function calculateAllMetrics(
    trades: TradeRecord[],
    equityCurve: EquityPoint[],
    startTime: number,
    endTime: number,
    initialCapital: number,
    riskFreeAnnual: number = DEFAULT_RISK_FREE_RATE
): {
    summary: SummaryMetrics;
    performance: PerformanceMetrics;
    analysis: TradesAnalysis;
    additional: AdditionalMetrics;
} {
    return {
        summary: calculateSummaryMetrics(trades, equityCurve, riskFreeAnnual),
        performance: calculatePerformanceMetrics(trades),
        analysis: calculateTradesAnalysis(trades),
        additional: calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital, riskFreeAnnual),
    };
}
