/**
 * Swap Metrics Calculation - Traditional trading performance metrics from TradeEvents.
 * Uses 365 trading days/year (crypto 24/7) and 0 risk-free rate (TradingView standard).
 */

import type { TradeEvent, SwapEvent, SwapMetrics } from "../events/types.ts";
import { sum, mean } from "../utils/math.ts";
import { DEFAULT_RISK_FREE_RATE, aggregateToDailyReturns, calculateSharpeRatio, calculateSortinoRatio, calculateCalmarRatioFromEquity } from "../utils/financial-math.ts";

// MAIN CALCULATION

export function calculateSwapMetrics(trades: TradeEvent[], equityCurve: Array<{ timestamp: number; equity: number; drawdownPct: number }>, riskFreeAnnual: number = DEFAULT_RISK_FREE_RATE): SwapMetrics {
    if (trades.length === 0) return createEmptySwapMetrics();

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
    const maxDrawdownPct = equityCurve.reduce((max, p) => Math.max(max, p.drawdownPct), 0); // Use reduce to avoid stack overflow on large arrays

    let maxDrawdownUSD = 0, peakEquity = 0; // Single pass O(n) algorithm
    for (const point of equityCurve) {
        peakEquity = Math.max(peakEquity, point.equity);
        maxDrawdownUSD = Math.max(maxDrawdownUSD, peakEquity - point.equity);
    }

    const calmarRatio = calculateCalmarRatioFromEquity(equityCurve, maxDrawdownPct);
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
        totalTrades: trades.length, winningTrades: winners.length, losingTrades: losers.length, winRate,
        totalPnlUSD, grossProfitUSD, grossLossUSD, avgPnlUSD, avgWinUSD, avgLossUSD, largestWinUSD, largestLossUSD,
        profitFactor, sharpeRatio, sortinoRatio, maxDrawdownPct, maxDrawdownUSD, calmarRatio,
        longTrades: longTrades.length, shortTrades: shortTrades.length, longWinRate, shortWinRate, longPnlUSD, shortPnlUSD,
        avgTradeDurationBars, avgTradeDurationSeconds, avgWinDurationBars, avgLossDurationBars, totalFeesUSD, totalSlippageUSD,
    };
}

function createEmptySwapMetrics(): SwapMetrics { // Zero trades case
    return {
        totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
        totalPnlUSD: 0, grossProfitUSD: 0, grossLossUSD: 0, avgPnlUSD: 0, avgWinUSD: 0, avgLossUSD: 0, largestWinUSD: 0, largestLossUSD: 0,
        profitFactor: 0, sharpeRatio: 0, sortinoRatio: 0, maxDrawdownPct: 0, maxDrawdownUSD: 0, calmarRatio: 0,
        longTrades: 0, shortTrades: 0, longWinRate: 0, shortWinRate: 0, longPnlUSD: 0, shortPnlUSD: 0,
        avgTradeDurationBars: 0, avgTradeDurationSeconds: 0, avgWinDurationBars: 0, avgLossDurationBars: 0, totalFeesUSD: 0, totalSlippageUSD: 0,
    };
}

// SWAP EVENT UTILITIES

export function calculateTotalFees(swaps: SwapEvent[]): number { return sum(swaps.map((s) => s.feeUSD)); }
export function calculateTotalSlippage(swaps: SwapEvent[]): number { return sum(swaps.map((s) => s.slippageUSD)); }

export function getSwapVolumeStats(swaps: SwapEvent[]): { totalVolumeUSD: number; avgSwapSizeUSD: number; swapCount: number } {
    const volumes = swaps.map((s) => (s.fromAsset === "USD" ? s.fromAmount : s.toAmount));
    return { totalVolumeUSD: sum(volumes), avgSwapSizeUSD: mean(volumes), swapCount: swaps.length };
}
