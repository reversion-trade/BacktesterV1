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
import { sum, mean, stddevPopulation } from "../utils/math.ts";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Trading days per year for annualization.
 * Crypto markets trade 24/7, so we use 365 days.
 * (Traditional markets use 252 trading days)
 */
const TRADING_DAYS_PER_YEAR = 365;

/**
 * Default annual risk-free rate.
 * Set to 0 to match TradingView's default behavior.
 */
const DEFAULT_RISK_FREE_RATE = 0;

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

  // Basic counts
  const winners = trades.filter((t) => t.pnlUSD > 0);
  const losers = trades.filter((t) => t.pnlUSD < 0);
  const longTrades = trades.filter((t) => t.direction === "LONG");
  const shortTrades = trades.filter((t) => t.direction === "SHORT");

  // P&L calculations
  const totalPnlUSD = sum(trades.map((t) => t.pnlUSD));
  const grossProfitUSD = sum(winners.map((t) => t.pnlUSD));
  const grossLossUSD = Math.abs(sum(losers.map((t) => t.pnlUSD)));

  // Win rate
  const winRate = trades.length > 0 ? winners.length / trades.length : 0;

  // Averages
  const avgPnlUSD = mean(trades.map((t) => t.pnlUSD));
  const avgWinUSD = mean(winners.map((t) => t.pnlUSD));
  const avgLossUSD = Math.abs(mean(losers.map((t) => t.pnlUSD)));

  // Extremes
  const largestWinUSD = winners.length > 0 ? Math.max(...winners.map((t) => t.pnlUSD)) : 0;
  const largestLossUSD = losers.length > 0 ? Math.abs(Math.min(...losers.map((t) => t.pnlUSD))) : 0;

  // Risk metrics
  const profitFactor = grossLossUSD > 0 ? grossProfitUSD / grossLossUSD : grossProfitUSD > 0 ? Infinity : 0;

  // Calculate Sharpe and Sortino from daily equity returns
  const dailyReturns = aggregateToDailyReturns(equityCurve);
  const sharpeRatio = calculateSharpeRatio(dailyReturns, riskFreeAnnual);
  const sortinoRatio = calculateSortinoRatio(dailyReturns, riskFreeAnnual);

  // Drawdown
  const maxDrawdownPct = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.drawdownPct)) : 0;
  const maxDrawdownUSD = equityCurve.length > 0
    ? Math.max(...equityCurve.map((p, i) => {
        if (i === 0) return 0;
        const peak = Math.max(...equityCurve.slice(0, i + 1).map((e) => e.equity));
        return peak - p.equity;
      }))
    : 0;

  // Calmar ratio
  const calmarRatio = calculateCalmarRatio(trades, equityCurve, maxDrawdownPct);

  // Direction breakdown
  const longWinners = longTrades.filter((t) => t.pnlUSD > 0);
  const shortWinners = shortTrades.filter((t) => t.pnlUSD > 0);
  const longWinRate = longTrades.length > 0 ? longWinners.length / longTrades.length : 0;
  const shortWinRate = shortTrades.length > 0 ? shortWinners.length / shortTrades.length : 0;
  const longPnlUSD = sum(longTrades.map((t) => t.pnlUSD));
  const shortPnlUSD = sum(shortTrades.map((t) => t.pnlUSD));

  // Duration
  const avgTradeDurationBars = mean(trades.map((t) => t.durationBars));
  const avgTradeDurationSeconds = mean(trades.map((t) => t.durationSeconds));
  const avgWinDurationBars = mean(winners.map((t) => t.durationBars));
  const avgLossDurationBars = mean(losers.map((t) => t.durationBars));

  // Fees and slippage
  const allSwaps = trades.flatMap((t) => [t.entrySwap, t.exitSwap]);
  const totalFeesUSD = sum(allSwaps.map((s) => s.feeUSD));
  const totalSlippageUSD = sum(allSwaps.map((s) => s.slippageUSD));

  return {
    // Summary
    totalTrades: trades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate,

    // P&L
    totalPnlUSD,
    grossProfitUSD,
    grossLossUSD,
    avgPnlUSD,
    avgWinUSD,
    avgLossUSD,
    largestWinUSD,
    largestLossUSD,

    // Risk metrics
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    maxDrawdownPct,
    maxDrawdownUSD,
    calmarRatio,

    // By direction
    longTrades: longTrades.length,
    shortTrades: shortTrades.length,
    longWinRate,
    shortWinRate,
    longPnlUSD,
    shortPnlUSD,

    // Duration
    avgTradeDurationBars,
    avgTradeDurationSeconds,
    avgWinDurationBars,
    avgLossDurationBars,

    // Fees
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
// HELPER FUNCTIONS
// =============================================================================

function annualToPeriodRate(annualRate: number, periodsPerYear: number): number {
  if (periodsPerYear <= 0) return 0;
  return Math.pow(1 + annualRate, 1 / periodsPerYear) - 1;
}

/**
 * Aggregate equity curve to daily returns.
 */
function aggregateToDailyReturns(
  equityCurve: Array<{ timestamp: number; equity: number }>
): number[] {
  if (equityCurve.length < 2) return [];

  const SECONDS_PER_DAY = 24 * 60 * 60;
  const dailyReturns: number[] = [];

  let dayStart = Math.floor(equityCurve[0]!.timestamp / SECONDS_PER_DAY);
  let dayStartEquity = equityCurve[0]!.equity;
  let lastEquity = equityCurve[0]!.equity;

  for (let i = 1; i < equityCurve.length; i++) {
    const point = equityCurve[i]!;
    const currentDay = Math.floor(point.timestamp / SECONDS_PER_DAY);

    if (currentDay > dayStart) {
      if (dayStartEquity > 0) {
        const dailyReturn = (lastEquity - dayStartEquity) / dayStartEquity;
        dailyReturns.push(dailyReturn);
      }
      dayStart = currentDay;
      dayStartEquity = lastEquity;
    }

    lastEquity = point.equity;
  }

  // Last day
  if (dayStartEquity > 0 && lastEquity !== dayStartEquity) {
    const dailyReturn = (lastEquity - dayStartEquity) / dayStartEquity;
    dailyReturns.push(dailyReturn);
  }

  return dailyReturns;
}

/**
 * Calculate Sharpe Ratio from daily returns.
 */
function calculateSharpeRatio(
  dailyReturns: number[],
  riskFreeAnnual: number = DEFAULT_RISK_FREE_RATE,
  annualize: boolean = true
): number {
  if (dailyReturns.length < 2) return 0;

  const rfr = annualToPeriodRate(riskFreeAnnual, TRADING_DAYS_PER_YEAR);
  const excessReturns = dailyReturns.map((r) => r - rfr);

  const m = mean(excessReturns);
  const sd = stddevPopulation(excessReturns);

  if (sd === 0) return m > 0 ? Infinity : 0;

  const sr = m / sd;
  return annualize ? sr * Math.sqrt(TRADING_DAYS_PER_YEAR) : sr;
}

/**
 * Calculate Sortino Ratio from daily returns.
 */
function calculateSortinoRatio(
  dailyReturns: number[],
  riskFreeAnnual: number = DEFAULT_RISK_FREE_RATE,
  targetAnnual: number = 0,
  annualize: boolean = true
): number {
  if (dailyReturns.length < 2) return 0;

  const rfr = annualToPeriodRate(riskFreeAnnual, TRADING_DAYS_PER_YEAR);
  const target = annualToPeriodRate(targetAnnual, TRADING_DAYS_PER_YEAR);

  const excessReturns = dailyReturns.map((r) => r - rfr);
  const m = mean(excessReturns);

  // Downside deviation
  let sumSq = 0;
  for (const r of dailyReturns) {
    const shortfall = Math.min(0, r - target);
    sumSq += shortfall * shortfall;
  }
  const dd = Math.sqrt(sumSq / dailyReturns.length);

  if (dd === 0) return m > 0 ? Infinity : 0;

  const sr = m / dd;
  return annualize ? sr * Math.sqrt(TRADING_DAYS_PER_YEAR) : sr;
}

/**
 * Calculate Calmar Ratio.
 */
function calculateCalmarRatio(
  trades: TradeEvent[],
  equityCurve: Array<{ timestamp: number; equity: number }>,
  maxDrawdownPct: number
): number {
  if (trades.length === 0 || equityCurve.length < 2) return 0;

  const firstEquity = equityCurve[0]!.equity;
  const lastEquity = equityCurve[equityCurve.length - 1]!.equity;
  const totalDays = (equityCurve[equityCurve.length - 1]!.timestamp - equityCurve[0]!.timestamp) / (24 * 60 * 60);
  const totalYears = totalDays / 365;

  if (totalYears <= 0 || firstEquity <= 0 || lastEquity <= 0) return 0;

  // CAGR
  const cagr = Math.pow(lastEquity / firstEquity, 1 / totalYears) - 1;

  const mdd = Math.abs(maxDrawdownPct);
  if (mdd === 0) return cagr > 0 ? Infinity : 0;

  return cagr / mdd;
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
