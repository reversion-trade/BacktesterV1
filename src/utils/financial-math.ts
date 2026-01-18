/**
 * Financial Math Utilities
 *
 * Shared financial mathematics functions for risk-adjusted return calculations.
 * Used by both metrics.ts (legacy format) and swap-metrics.ts (events format).
 *
 * @audit-trail
 * - Created: 2026-01-05 (Refactoring: Extract shared math from metrics files)
 * - TRADING_DAYS_PER_YEAR = 365 for crypto (24/7 markets)
 * - DEFAULT_RISK_FREE_RATE = 0 (TradingView standard)
 */

import { mean, stddevPopulation } from "./math.ts";

// =============================================================================
// CONSTANTS
// =============================================================================

export const TRADING_DAYS_PER_YEAR = 365;

//risk free rate for sharpe ratio
export const DEFAULT_RISK_FREE_RATE = 0;

/**
 * Seconds in a day for daily aggregation.
 */
export const SECONDS_PER_DAY = 24 * 60 * 60;

// =============================================================================
// RATE CONVERSION
// =============================================================================

/**
 * Convert annual rate to per-period rate.
 *
 * @param annualRate - Annual rate (e.g., 0.05 for 5%)
 * @param periodsPerYear - Number of periods per year (e.g., 365 for daily)
 * @returns Per-period rate
 */
export function annualToPeriodRate(annualRate: number, periodsPerYear: number): number {
    if (periodsPerYear <= 0) return 0;
    return Math.pow(1 + annualRate, 1 / periodsPerYear) - 1;
}

// =============================================================================
// DAILY RETURNS AGGREGATION
// =============================================================================

/**
 * Equity point with timestamp for daily returns calculation.
 * Accepts either 'time' or 'timestamp' property for compatibility.
 */
export interface EquityPointForReturns {
    equity: number;
    time?: number;
    timestamp?: number;
}

/**
 * Aggregate equity curve to daily returns.
 *
 * @param equityCurve - Array of equity points with time/timestamp and equity
 * @returns Array of daily returns as decimals (0.02 = +2%)
 */
export function aggregateToDailyReturns(equityCurve: EquityPointForReturns[]): number[] {
    if (equityCurve.length < 2) return [];

    const dailyReturns: number[] = [];

    // Get timestamp from either 'time' or 'timestamp' property
    const getTimestamp = (point: EquityPointForReturns): number => point.timestamp ?? point.time ?? 0;

    let dayStart = Math.floor(getTimestamp(equityCurve[0]!) / SECONDS_PER_DAY);
    let dayStartEquity = equityCurve[0]!.equity;
    let lastEquity = equityCurve[0]!.equity;

    for (let i = 1; i < equityCurve.length; i++) {
        const point = equityCurve[i]!;
        const currentDay = Math.floor(getTimestamp(point) / SECONDS_PER_DAY);

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

// =============================================================================
// RISK-ADJUSTED RETURN RATIOS
// =============================================================================

/**
 * Calculate Sharpe Ratio from daily returns.
 *
 * Sharpe = (Mean Excess Return) / (Std Dev of Excess Return)
 *
 * @param dailyReturns - Array of daily returns as decimals (0.02 = +2%)
 * @param riskFreeAnnual - Annual risk-free rate (default 0 per TradingView)
 * @param annualize - Whether to annualize the result (default true)
 * @returns Sharpe ratio (annualized if specified)
 */
export function calculateSharpeRatio(
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
 *
 * Sortino = (Mean Excess Return) / (Downside Deviation)
 * - Downside deviation only considers returns below the target
 * - Uses ALL periods in denominator (N), where positive periods contribute 0
 *
 * @param dailyReturns - Array of daily returns as decimals
 * @param riskFreeAnnual - Annual risk-free rate (default 0 per TradingView)
 * @param targetAnnual - Annual target/MAR rate (default 0)
 * @param annualize - Whether to annualize the result (default true)
 * @returns Sortino ratio (annualized if specified)
 */
export function calculateSortinoRatio(
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
 *
 * Calmar = CAGR / Max Drawdown
 *
 * @param cagr - Compound Annual Growth Rate as decimal
 * @param maxDrawdown - Maximum drawdown as decimal (positive value, e.g., 0.20 for 20%)
 * @returns Calmar ratio
 */
export function calculateCalmarRatio(cagr: number, maxDrawdown: number): number {
    const mdd = Math.abs(maxDrawdown);
    if (mdd === 0) return cagr > 0 ? Infinity : 0;
    return cagr / mdd;
}

/**
 * Calculate CAGR from equity curve.
 *
 * CAGR = (EndValue / StartValue)^(1/years) - 1
 *
 * @param startEquity - Starting equity value
 * @param endEquity - Ending equity value
 * @param totalDays - Total number of days
 * @returns CAGR as decimal
 */
export function calculateCAGR(startEquity: number, endEquity: number, totalDays: number): number {
    const totalYears = totalDays / 365;
    if (totalYears <= 0 || startEquity <= 0 || endEquity <= 0) return 0;
    return Math.pow(endEquity / startEquity, 1 / totalYears) - 1;
}

/**
 * Calculate Calmar Ratio from equity curve.
 * Convenience function that calculates CAGR internally.
 *
 * @param equityCurve - Array of equity points with timestamp and equity
 * @param maxDrawdownPct - Maximum drawdown percentage as decimal
 * @returns Calmar ratio
 */
export function calculateCalmarRatioFromEquity(equityCurve: EquityPointForReturns[], maxDrawdownPct: number): number {
    if (equityCurve.length < 2) return 0;

    const getTimestamp = (point: EquityPointForReturns): number => point.timestamp ?? point.time ?? 0;

    const firstEquity = equityCurve[0]!.equity;
    const lastEquity = equityCurve[equityCurve.length - 1]!.equity;
    const totalDays =
        (getTimestamp(equityCurve[equityCurve.length - 1]!) - getTimestamp(equityCurve[0]!)) / SECONDS_PER_DAY;

    const cagr = calculateCAGR(firstEquity, lastEquity, totalDays);
    return calculateCalmarRatio(cagr, maxDrawdownPct);
}
