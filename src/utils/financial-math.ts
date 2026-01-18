/** Financial Math Utilities - Risk-adjusted return calculations. TRADING_DAYS=365 (crypto 24/7). */

import { mean, stddevPopulation } from "./math.ts";

const TRADING_DAYS_PER_YEAR = 365;                                              // Crypto markets 24/7
const SECONDS_PER_DAY = 24 * 60 * 60;                                           // For daily aggregation
export const DEFAULT_RISK_FREE_RATE = 0;                                        // TradingView standard

interface EquityPointForReturns { equity: number; time?: number; timestamp?: number; }

function annualToPeriodRate(annualRate: number, periodsPerYear: number): number {
    if (periodsPerYear <= 0) return 0;
    return Math.pow(1 + annualRate, 1 / periodsPerYear) - 1;
}

/** Aggregate equity curve to daily returns. Returns decimals (0.02 = +2%). */
export function aggregateToDailyReturns(equityCurve: EquityPointForReturns[]): number[] {
    if (equityCurve.length < 2) return [];
    const dailyReturns: number[] = [];
    const getTimestamp = (point: EquityPointForReturns): number => point.timestamp ?? point.time ?? 0;

    let dayStart = Math.floor(getTimestamp(equityCurve[0]!) / SECONDS_PER_DAY);
    let dayStartEquity = equityCurve[0]!.equity;
    let lastEquity = equityCurve[0]!.equity;

    for (let i = 1; i < equityCurve.length; i++) {
        const point = equityCurve[i]!;
        const currentDay = Math.floor(getTimestamp(point) / SECONDS_PER_DAY);
        if (currentDay > dayStart) {                                            // New day - calculate return
            if (dayStartEquity > 0) dailyReturns.push((lastEquity - dayStartEquity) / dayStartEquity);
            dayStart = currentDay;
            dayStartEquity = lastEquity;
        }
        lastEquity = point.equity;
    }
    if (dayStartEquity > 0 && lastEquity !== dayStartEquity) {                  // Final day
        dailyReturns.push((lastEquity - dayStartEquity) / dayStartEquity);
    }
    return dailyReturns;
}

/** Sharpe Ratio = (Mean Excess Return) / (Std Dev). Annualized by default. */
export function calculateSharpeRatio(dailyReturns: number[], riskFreeAnnual = DEFAULT_RISK_FREE_RATE, annualize = true): number {
    if (dailyReturns.length < 2) return 0;
    const rfr = annualToPeriodRate(riskFreeAnnual, TRADING_DAYS_PER_YEAR);
    const excessReturns = dailyReturns.map((r) => r - rfr);
    const m = mean(excessReturns);
    const sd = stddevPopulation(excessReturns);
    if (sd === 0) return m > 0 ? Infinity : 0;
    const sr = m / sd;
    return annualize ? sr * Math.sqrt(TRADING_DAYS_PER_YEAR) : sr;
}

/** Sortino Ratio = (Mean Excess Return) / (Downside Deviation). Only negative returns in denominator. */
export function calculateSortinoRatio(dailyReturns: number[], riskFreeAnnual = DEFAULT_RISK_FREE_RATE, targetAnnual = 0, annualize = true): number {
    if (dailyReturns.length < 2) return 0;
    const rfr = annualToPeriodRate(riskFreeAnnual, TRADING_DAYS_PER_YEAR);
    const target = annualToPeriodRate(targetAnnual, TRADING_DAYS_PER_YEAR);
    const excessReturns = dailyReturns.map((r) => r - rfr);
    const m = mean(excessReturns);
    let sumSq = 0;                                                              // Downside deviation: sqrt(sum(min(0, Xi - T))^2 / N)
    for (const r of dailyReturns) { const shortfall = Math.min(0, r - target); sumSq += shortfall * shortfall; }
    const dd = Math.sqrt(sumSq / dailyReturns.length);
    if (dd === 0) return m > 0 ? Infinity : 0;
    const sr = m / dd;
    return annualize ? sr * Math.sqrt(TRADING_DAYS_PER_YEAR) : sr;
}

function calculateCAGR(startEquity: number, endEquity: number, totalDays: number): number {
    const totalYears = totalDays / 365;                                         // CAGR = (End/Start)^(1/years) - 1
    if (totalYears <= 0 || startEquity <= 0 || endEquity <= 0) return 0;
    return Math.pow(endEquity / startEquity, 1 / totalYears) - 1;
}

function calculateCalmarRatio(cagr: number, maxDrawdown: number): number {
    const mdd = Math.abs(maxDrawdown);                                          // Calmar = CAGR / Max Drawdown
    if (mdd === 0) return cagr > 0 ? Infinity : 0;
    return cagr / mdd;
}

/** Calmar Ratio from equity curve. Calculates CAGR internally. */
export function calculateCalmarRatioFromEquity(equityCurve: EquityPointForReturns[], maxDrawdownPct: number): number {
    if (equityCurve.length < 2) return 0;
    const getTimestamp = (point: EquityPointForReturns): number => point.timestamp ?? point.time ?? 0;
    const firstEquity = equityCurve[0]!.equity;
    const lastEquity = equityCurve[equityCurve.length - 1]!.equity;
    const totalDays = (getTimestamp(equityCurve[equityCurve.length - 1]!) - getTimestamp(equityCurve[0]!)) / SECONDS_PER_DAY;
    return calculateCalmarRatio(calculateCAGR(firstEquity, lastEquity, totalDays), maxDrawdownPct);
}
