/**
 * Swap Metrics Calculation
 *
 * Calculates SwapMetrics from TradeEvents.
 * These are traditional trading performance metrics derived from swap/trade data.
 *
 * @audit-trail
 * - Updated: 2026-01-01 (Audit Fix)
 * - Changed TRADING_DAYS_PER_YEAR from 252 to 365 for crypto (24/7 trading)
 * - Changed default risk-free rate from 0.02 to 0 (TradingView standard)
 */

import type { TradeEvent, SwapEvent, SwapMetrics } from "../events/types.ts";
import { sum, mean } from "../utils/math.ts";
import {
    TRADING_DAYS_PER_YEAR,
    DEFAULT_RISK_FREE_RATE,
    aggregateToDailyReturns,
    calculateSharpeRatio,
    calculateSortinoRatio,
    calculateCalmarRatioFromEquity,
} from "../utils/financial-math.ts";

// =============================================================================
// MAIN CALCULATION
// =============================================================================

/**
 * Calculate swap-based metrics from trade events.
 *
 * @param trades - Completed trade events
 * @param equityCurve - Equity curve for drawdown calculations
 * @param riskFreeAnnual - Annual risk-free rate (default 0 per TradingView)
 */
export function calculateSwapMetrics(
    trades: TradeEvent[],
    equityCurve: Array<{ timestamp: number; equity: number; drawdownPct: number }>,
    riskFreeAnnual: number = DEFAULT_RISK_FREE_RATE
): SwapMetrics {
    if (trades.length === 0) {
        return createEmptySwapMetrics();
    }

    const winners = trades.filter((t) => t.pnlUSD > 0);
    const losers = trades.filter((t) => t.pnlUSD < 0);
    const longTrades = trades.filter((t) => t.direction === "LONG");
    const shortTrades = trades.filter((t) => t.direction === "SHORT");

    const totalPnlUSD = sum(trades.map((t) => t.pnlUSD));
    const grossProfitUSD = sum(winners.map((t) => t.pnlUSD));
    const grossLossUSD = Math.abs(sum(losers.map((t) => t.pnlUSD)));

    const winRate = trades.length > 0 ? winners.length / trades.length : 0;

    const avgPnlUSD = mean(trades.map((t) => t.pnlUSD));
    const avgWinUSD = mean(winners.map((t) => t.pnlUSD));
    const avgLossUSD = Math.abs(mean(losers.map((t) => t.pnlUSD)));

    const largestWinUSD = winners.length > 0 ? Math.max(...winners.map((t) => t.pnlUSD)) : 0;
    const largestLossUSD = losers.length > 0 ? Math.abs(Math.min(...losers.map((t) => t.pnlUSD))) : 0;

    const profitFactor = grossLossUSD > 0 ? grossProfitUSD / grossLossUSD : grossProfitUSD > 0 ? Infinity : 0;

    const dailyReturns = aggregateToDailyReturns(equityCurve);
    const sharpeRatio = calculateSharpeRatio(dailyReturns, riskFreeAnnual);
    const sortinoRatio = calculateSortinoRatio(dailyReturns, riskFreeAnnual);

    const maxDrawdownPct = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.drawdownPct)) : 0;
    const maxDrawdownUSD =
        equityCurve.length > 0
            ? Math.max(
                  ...equityCurve.map((p, i) => {
                      if (i === 0) return 0;
                      const peak = Math.max(...equityCurve.slice(0, i + 1).map((e) => e.equity));
                      return peak - p.equity;
                  })
              )
            : 0;

    const calmarRatio = trades.length === 0 ? 0 : calculateCalmarRatioFromEquity(equityCurve, maxDrawdownPct);

    const longWinners = longTrades.filter((t) => t.pnlUSD > 0);
    const shortWinners = shortTrades.filter((t) => t.pnlUSD > 0);
    const longWinRate = longTrades.length > 0 ? longWinners.length / longTrades.length : 0;
    const shortWinRate = shortTrades.length > 0 ? shortWinners.length / shortTrades.length : 0;
    const longPnlUSD = sum(longTrades.map((t) => t.pnlUSD));
    const shortPnlUSD = sum(shortTrades.map((t) => t.pnlUSD));

    const avgTradeDurationBars = mean(trades.map((t) => t.durationBars));
    const avgTradeDurationSeconds = mean(trades.map((t) => t.durationSeconds));
    const avgWinDurationBars = mean(winners.map((t) => t.durationBars));
    const avgLossDurationBars = mean(losers.map((t) => t.durationBars));

    const allSwaps = trades.flatMap((t) => [t.entrySwap, t.exitSwap]);
    const totalFeesUSD = sum(allSwaps.map((s) => s.feeUSD));
    const totalSlippageUSD = sum(allSwaps.map((s) => s.slippageUSD));

    return {
        totalTrades: trades.length,
        winningTrades: winners.length,
        losingTrades: losers.length,
        winRate,
        totalPnlUSD,
        grossProfitUSD,
        grossLossUSD,
        avgPnlUSD,
        avgWinUSD,
        avgLossUSD,
        largestWinUSD,
        largestLossUSD,
        profitFactor,
        sharpeRatio,
        sortinoRatio,
        maxDrawdownPct,
        maxDrawdownUSD,
        calmarRatio,
        longTrades: longTrades.length,
        shortTrades: shortTrades.length,
        longWinRate,
        shortWinRate,
        longPnlUSD,
        shortPnlUSD,
        avgTradeDurationBars,
        avgTradeDurationSeconds,
        avgWinDurationBars,
        avgLossDurationBars,
        totalFeesUSD,
        totalSlippageUSD,
    };
}

/**
 * Create empty swap metrics (for zero trades case).
 */
function createEmptySwapMetrics(): SwapMetrics {
    return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnlUSD: 0,
        grossProfitUSD: 0,
        grossLossUSD: 0,
        avgPnlUSD: 0,
        avgWinUSD: 0,
        avgLossUSD: 0,
        largestWinUSD: 0,
        largestLossUSD: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        maxDrawdownPct: 0,
        maxDrawdownUSD: 0,
        calmarRatio: 0,
        longTrades: 0,
        shortTrades: 0,
        longWinRate: 0,
        shortWinRate: 0,
        longPnlUSD: 0,
        shortPnlUSD: 0,
        avgTradeDurationBars: 0,
        avgTradeDurationSeconds: 0,
        avgWinDurationBars: 0,
        avgLossDurationBars: 0,
        totalFeesUSD: 0,
        totalSlippageUSD: 0,
    };
}

// =============================================================================
// SWAP EVENT UTILITIES
// =============================================================================

/**
 * Calculate total fees from swap events.
 */
export function calculateTotalFees(swaps: SwapEvent[]): number {
    return sum(swaps.map((s) => s.feeUSD));
}

/**
 * Calculate total slippage from swap events.
 */
export function calculateTotalSlippage(swaps: SwapEvent[]): number {
    return sum(swaps.map((s) => s.slippageUSD));
}

/**
 * Get volume statistics from swap events.
 */
export function getSwapVolumeStats(swaps: SwapEvent[]): {
    totalVolumeUSD: number;
    avgSwapSizeUSD: number;
    swapCount: number;
} {
    const volumes = swaps.map((s) => (s.fromAsset === "USD" ? s.fromAmount : s.toAmount));
    return {
        totalVolumeUSD: sum(volumes),
        avgSwapSizeUSD: mean(volumes),
        swapCount: swaps.length,
    };
}
