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

  const largestWinUSD =
    winners.length > 0 ? Math.max(...winners.map((t) => t.pnlUSD)) : 0;
  const largestLossUSD =
    losers.length > 0 ? Math.abs(Math.min(...losers.map((t) => t.pnlUSD))) : 0;

  // Calculate max drawdown and runup from equity curve
  const maxEquityDrawdownPct =
    equityCurve.length > 0
      ? Math.max(...equityCurve.map((p) => p.drawdownPct))
      : 0;
  const maxEquityRunupPct =
    equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.runupPct)) : 0;

  // Calculate Sharpe and Sortino ratios from daily equity returns
  // (TradingView-style: periodic returns, not per-trade returns)
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
export function calculatePerformanceMetrics(
  trades: TradeRecord[]
): PerformanceMetrics {
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
export function calculateTradeStatistics(
  trades: TradeRecord[]
): TradeStatistics {
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
      short:
        shortTrades.length > 0 ? shortWinners.length / shortTrades.length : 0,
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
export function calculateDurationAnalysis(
  trades: TradeRecord[]
): DurationAnalysis {
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
export function calculateTradesAnalysis(
  trades: TradeRecord[]
): TradesAnalysis {
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

  // Performance calculations
  const performance = calculatePerformanceMetrics(trades);
  const profitFactor =
    performance.grossLoss.total > 0
      ? performance.grossProfit.total / performance.grossLoss.total
      : performance.grossProfit.total > 0
        ? Infinity
        : 0;

  const expectancy = trades.length > 0 ? totalPnl / trades.length : 0;

  // Volatility from daily returns (proper calculation)
  const dailyReturns = aggregateToDailyReturns(equityCurve);
  const dailyVolatility = stddevPopulation(dailyReturns);
  const annualizedVolatility = dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Drawdown calculations
  const maxDrawdownPct =
    equityCurve.length > 0
      ? Math.max(...equityCurve.map((p) => p.drawdownPct))
      : 0;
  const maxDrawdownUSD = maxDrawdownPct * initialCapital;

  // Max drawdown duration
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

  // CAGR calculation (Compound Annual Growth Rate)
  const totalYears = totalDays / 365;
  let cagr = 0;
  if (totalYears > 0 && initialCapital > 0 && finalEquity > 0) {
    cagr = Math.pow(finalEquity / initialCapital, 1 / totalYears) - 1;
  }

  // Annualized return (simple, for backwards compatibility)
  const totalReturnPct = initialCapital > 0 ? totalPnl / initialCapital : 0;
  const annualizedReturnPct = totalDays > 0 ? totalReturnPct * (365 / totalDays) : 0;

  // Calmar ratio: CAGR / Max Drawdown
  const calmarRatio = calculateCalmarRatio(cagr, maxDrawdownPct);

  // Exit breakdown
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

// Note: mean() and stddevPopulation() imported from ../utils/math.ts

/**
 * Convert annual rate to per-period rate using geometric method.
 */
function annualToPeriodRate(
  annualRate: number,
  periodsPerYear: number
): number {
  if (periodsPerYear <= 0) return 0;
  return Math.pow(1 + annualRate, 1 / periodsPerYear) - 1;
}

/**
 * Aggregate equity curve to daily returns.
 * Groups equity points by day and calculates return for each day.
 */
function aggregateToDailyReturns(equityCurve: EquityPoint[]): number[] {
  if (equityCurve.length < 2) return [];

  const SECONDS_PER_DAY = 24 * 60 * 60;
  const dailyReturns: number[] = [];

  let dayStart = Math.floor(equityCurve[0]!.time / SECONDS_PER_DAY);
  let dayStartEquity = equityCurve[0]!.equity;
  let lastEquity = equityCurve[0]!.equity;

  for (let i = 1; i < equityCurve.length; i++) {
    const point = equityCurve[i]!;
    const currentDay = Math.floor(point.time / SECONDS_PER_DAY);

    if (currentDay > dayStart) {
      // New day - calculate return for previous day
      if (dayStartEquity > 0) {
        const dailyReturn = (lastEquity - dayStartEquity) / dayStartEquity;
        dailyReturns.push(dailyReturn);
      }
      dayStart = currentDay;
      dayStartEquity = lastEquity;
    }

    lastEquity = point.equity;
  }

  // Don't forget the last day
  if (dayStartEquity > 0 && lastEquity !== dayStartEquity) {
    const dailyReturn = (lastEquity - dayStartEquity) / dayStartEquity;
    dailyReturns.push(dailyReturn);
  }

  return dailyReturns;
}

/**
 * TradingView-style Sharpe Ratio on daily returns.
 *
 * SR = (MR - RFR) / SD
 * - MR = mean daily return
 * - RFR = daily risk-free rate (converted from annual)
 * - SD = population stddev of excess returns
 *
 * Annualized by multiplying by sqrt(TRADING_DAYS_PER_YEAR) for crypto (365 days).
 *
 * @param dailyReturns - Array of daily returns as decimals (0.02 = +2%)
 * @param riskFreeAnnual - Annual risk-free rate (default 0 per TradingView)
 * @param annualize - Whether to annualize the result (default true)
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
 * TradingView-style Sortino Ratio on daily returns.
 *
 * SR = (MR - RFR) / DD
 * - DD = sqrt(sum(min(0, Xi - T))^2 / N) - downside deviation
 * - T = target return (MAR) per period
 *
 * Uses ALL periods in denominator (N), where positive periods contribute 0.
 *
 * @param dailyReturns - Array of daily returns as decimals
 * @param riskFreeAnnual - Annual risk-free rate (default 0 per TradingView)
 * @param targetAnnual - Annual target/MAR rate (default 0)
 * @param annualize - Whether to annualize the result (default true)
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

  // Numerator: mean excess vs risk-free
  const excessReturns = dailyReturns.map((r) => r - rfr);
  const m = mean(excessReturns);

  // Downside deviation: sqrt(sum(min(0, Xi - T))^2 / N)
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
 * CAGR / Max Drawdown
 */
function calculateCalmarRatio(cagr: number, maxDrawdown: number): number {
  const mdd = Math.abs(maxDrawdown);
  if (mdd === 0) return cagr > 0 ? Infinity : 0;
  return cagr / mdd;
}

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
    additional: calculateAdditionalMetrics(
      trades,
      equityCurve,
      startTime,
      endTime,
      initialCapital,
      riskFreeAnnual
    ),
  };
}
