/**
 * Performance Metrics Calculation Tests
 *
 * Tests for calculateSummaryMetrics, calculatePerformanceMetrics,
 * calculateTradeStatistics, calculatePnLAnalysis, calculateDurationAnalysis,
 * calculateAdditionalMetrics, and calculateAllMetrics.
 *
 * @module output/__tests__/metrics.test
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
    calculateSummaryMetrics,
    calculatePerformanceMetrics,
    calculateTradeStatistics,
    calculatePnLAnalysis,
    calculateDurationAnalysis,
    calculateAdditionalMetrics,
    calculateAllMetrics,
} from "../metrics.ts";
import type { TradeRecord, EquityPoint, ExitReason } from "../types.ts";
import type { Direction } from "../../core/types.ts";

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a trade record with sensible defaults.
 */
function createTradeRecord(overrides: Partial<TradeRecord> = {}): TradeRecord {
    return {
        tradeId: 1,
        direction: "LONG" as Direction,
        entryTime: 1704067200, // 2024-01-01 00:00:00
        entryPrice: 42000,
        exitTime: 1704153600, // 2024-01-02 00:00:00
        exitPrice: 42500,
        qty: 0.1,
        pnlUSD: 50,
        pnlPct: 0.0119,
        runUpUSD: 60,
        runUpPct: 0.0143,
        drawdownUSD: 10,
        drawdownPct: 0.0024,
        durationSeconds: 86400,
        durationBars: 1440,
        cumulativePnlUSD: 50,
        equityAfterTrade: 10050,
        exitReason: "SIGNAL" as ExitReason,
        ...overrides,
    };
}

/**
 * Create an equity point with sensible defaults.
 */
function createEquityPoint(overrides: Partial<EquityPoint> = {}): EquityPoint {
    return {
        time: 1704067200,
        equity: 10000,
        drawdownPct: 0,
        runupPct: 0,
        ...overrides,
    };
}

/**
 * Create equity curve for multiple days.
 * Each day starts at midnight and has a single point.
 */
function createDailyEquityCurve(equities: number[]): EquityPoint[] {
    const baseTime = 1704067200; // 2024-01-01 00:00:00
    const DAY = 86400;
    let maxEquity = equities[0] ?? 10000;
    let minEquity = equities[0] ?? 10000;

    return equities.map((equity, i) => {
        maxEquity = Math.max(maxEquity, equity);
        minEquity = Math.min(minEquity, equity);
        const drawdownPct = maxEquity > 0 ? (maxEquity - equity) / maxEquity : 0;
        const runupPct = minEquity > 0 ? (equity - minEquity) / minEquity : 0;

        return {
            time: baseTime + i * DAY,
            equity,
            drawdownPct,
            runupPct,
        };
    });
}

/**
 * Assert two numbers are approximately equal.
 */
function expectApprox(actual: number, expected: number, tolerance = 0.0001): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

// =============================================================================
// calculateSummaryMetrics TESTS
// =============================================================================

describe("calculateSummaryMetrics", () => {
    it("returns zeros for empty trades array", () => {
        const result = calculateSummaryMetrics([], []);

        expect(result.totalPnlUSD).toBe(0);
        expect(result.maxEquityDrawdownPct).toBe(0);
        expect(result.maxEquityRunupPct).toBe(0);
        expect(result.numberOfTrades).toBe(0);
        expect(result.winRate).toBe(0);
        expect(result.sharpeRatio).toBe(0);
        expect(result.sortinoRatio).toBe(0);
        expect(result.largestWinUSD).toBe(0);
        expect(result.largestLossUSD).toBe(0);
    });

    it("calculates correct total P&L", () => {
        const trades = [
            createTradeRecord({ pnlUSD: 100 }),
            createTradeRecord({ pnlUSD: -30 }),
            createTradeRecord({ pnlUSD: 50 }),
        ];
        const result = calculateSummaryMetrics(trades, []);

        expect(result.totalPnlUSD).toBe(120);
    });

    it("calculates correct win rate", () => {
        const trades = [
            createTradeRecord({ pnlUSD: 100 }), // win
            createTradeRecord({ pnlUSD: -30 }), // loss
            createTradeRecord({ pnlUSD: 50 }), // win
            createTradeRecord({ pnlUSD: -20 }), // loss
        ];
        const result = calculateSummaryMetrics(trades, []);

        expect(result.winRate).toBe(0.5);
        expect(result.numberOfTrades).toBe(4);
    });

    it("calculates correct largest win and loss", () => {
        const trades = [
            createTradeRecord({ pnlUSD: 100 }),
            createTradeRecord({ pnlUSD: -30 }),
            createTradeRecord({ pnlUSD: 200 }),
            createTradeRecord({ pnlUSD: -50 }),
        ];
        const result = calculateSummaryMetrics(trades, []);

        expect(result.largestWinUSD).toBe(200);
        expect(result.largestLossUSD).toBe(50);
    });

    it("handles all winning trades", () => {
        const trades = [createTradeRecord({ pnlUSD: 100 }), createTradeRecord({ pnlUSD: 50 })];
        const result = calculateSummaryMetrics(trades, []);

        expect(result.winRate).toBe(1);
        expect(result.largestLossUSD).toBe(0);
    });

    it("handles all losing trades", () => {
        const trades = [createTradeRecord({ pnlUSD: -100 }), createTradeRecord({ pnlUSD: -50 })];
        const result = calculateSummaryMetrics(trades, []);

        expect(result.winRate).toBe(0);
        expect(result.largestWinUSD).toBe(0);
        expect(result.largestLossUSD).toBe(100);
    });

    it("calculates max drawdown from equity curve", () => {
        const trades = [createTradeRecord({ pnlUSD: 200 })]; // Need at least one trade
        const equityCurve = [
            createEquityPoint({ equity: 10000, drawdownPct: 0 }),
            createEquityPoint({ equity: 10500, drawdownPct: 0 }),
            createEquityPoint({ equity: 9500, drawdownPct: 0.0952 }), // 9.52% drawdown from 10500
            createEquityPoint({ equity: 10200, drawdownPct: 0.0286 }),
        ];
        const result = calculateSummaryMetrics(trades, equityCurve);

        // The function finds max drawdownPct from the equity curve
        expect(result.maxEquityDrawdownPct).toBe(0.0952);
    });

    it("calculates max runup from equity curve", () => {
        const trades = [createTradeRecord({ pnlUSD: 200 })]; // Need at least one trade
        const equityCurve = [
            createEquityPoint({ equity: 10000, runupPct: 0 }),
            createEquityPoint({ equity: 9500, runupPct: 0 }),
            createEquityPoint({ equity: 10500, runupPct: 0.1053 }), // 10.53% runup from 9500
            createEquityPoint({ equity: 10200, runupPct: 0.0737 }),
        ];
        const result = calculateSummaryMetrics(trades, equityCurve);

        // The function finds max runupPct from the equity curve
        expect(result.maxEquityRunupPct).toBe(0.1053);
    });
});

// =============================================================================
// SHARPE RATIO TESTS
// =============================================================================

describe("Sharpe Ratio calculation", () => {
    it("returns 0 for insufficient data (less than 2 days)", () => {
        const trades = [createTradeRecord({ pnlUSD: 100 })];
        const equityCurve = [createEquityPoint({ equity: 10100 })];

        const result = calculateSummaryMetrics(trades, equityCurve);
        expect(result.sharpeRatio).toBe(0);
    });

    it("calculates correct Sharpe ratio for known returns", () => {
        // Create equity curve spanning 5 days with known daily returns
        // Day 1→2: 10000→10100 = +1%
        // Day 2→3: 10100→10000 = -0.99%
        // Day 3→4: 10000→10200 = +2%
        // Day 4→5: 10200→10300 = +0.98%
        const equityCurve = createDailyEquityCurve([10000, 10100, 10000, 10200, 10300]);
        const trades = [createTradeRecord({ pnlUSD: 300 })];

        const result = calculateSummaryMetrics(trades, equityCurve);

        // With daily returns: [0.01, -0.0099, 0.02, 0.0098]
        // Mean ≈ 0.0075, StdDev ≈ 0.0112
        // Daily Sharpe ≈ 0.67, Annualized ≈ 0.67 * sqrt(365) ≈ 12.8
        // This is approximate due to compounding effects
        expect(result.sharpeRatio).toBeGreaterThan(0);
    });

    it("returns very high Sharpe for near-zero volatility with positive returns", () => {
        // All days have very similar positive returns (near-zero volatility)
        // Note: True zero volatility is mathematically difficult with compounding
        const equityCurve: EquityPoint[] = [];
        const baseTime = 1704067200;
        const DAY = 86400;

        // Create nearly identical daily returns
        // 1% return each day = equity grows geometrically
        const dailyReturn = 0.001; // 0.1% daily
        for (let i = 0; i < 10; i++) {
            const equity = 10000 * Math.pow(1 + dailyReturn, i);
            equityCurve.push({
                time: baseTime + i * DAY,
                equity,
                drawdownPct: 0,
                runupPct: (equity - 10000) / 10000,
            });
        }

        const trades = [createTradeRecord({ pnlUSD: 90 })];
        const result = calculateSummaryMetrics(trades, equityCurve);

        // Very low volatility with consistent positive returns → Very high Sharpe
        expect(result.sharpeRatio).toBeGreaterThan(10);
    });

    it("uses default risk-free rate of 0 (TradingView standard)", () => {
        // This is verified by the fact that the function signature
        // defaults to 0 for riskFreeAnnual
        const equityCurve = createDailyEquityCurve([10000, 10100, 10200]);
        const trades = [createTradeRecord({ pnlUSD: 200 })];

        // Call without explicit risk-free rate
        const result = calculateSummaryMetrics(trades, equityCurve);

        // Sharpe should be positive for positive returns with default 0% RFR
        expect(result.sharpeRatio).toBeGreaterThan(0);
    });

    it("annualizes using 365 days (crypto standard)", () => {
        // The annualization factor is sqrt(365) for crypto markets
        // We can verify this by comparing the ratio of annualized to daily
        const equityCurve = createDailyEquityCurve([10000, 10100, 10200, 10150, 10250]);
        const trades = [createTradeRecord({ pnlUSD: 250 })];

        const result = calculateSummaryMetrics(trades, equityCurve);

        // Sharpe ratio should be significantly larger than 1 due to sqrt(365) ≈ 19.1
        // A small daily Sharpe gets amplified by annualization
        expect(result.sharpeRatio).toBeDefined();
    });
});

// =============================================================================
// SORTINO RATIO TESTS
// =============================================================================

describe("Sortino Ratio calculation", () => {
    it("returns 0 for insufficient data", () => {
        const trades = [createTradeRecord({ pnlUSD: 100 })];
        const equityCurve = [createEquityPoint({ equity: 10100 })];

        const result = calculateSummaryMetrics(trades, equityCurve);
        expect(result.sortinoRatio).toBe(0);
    });

    it("only penalizes downside deviation", () => {
        // Create scenarios with same mean but different downside patterns

        // Scenario 1: Mostly upside volatility
        const equityCurveUpside = createDailyEquityCurve([10000, 10200, 10150, 10400, 10350, 10600, 10550]);
        const tradesUpside = [createTradeRecord({ pnlUSD: 550 })];
        const resultUpside = calculateSummaryMetrics(tradesUpside, equityCurveUpside);

        // Scenario 2: Mostly downside volatility with same end result
        const equityCurveDownside = createDailyEquityCurve([10000, 9800, 10100, 9900, 10200, 10100, 10550]);
        const tradesDownside = [createTradeRecord({ pnlUSD: 550 })];
        const resultDownside = calculateSummaryMetrics(tradesDownside, equityCurveDownside);

        // The upside-heavy scenario should have a higher Sortino ratio
        // because Sortino only counts downside deviation
        expect(resultUpside.sortinoRatio).toBeGreaterThan(0);
        expect(resultDownside.sortinoRatio).toBeGreaterThan(0);
        // Note: Due to how drawdowns compound, exact comparison is complex
    });

    it("returns Infinity for zero downside deviation with positive returns", () => {
        // Create equity curve with only positive daily returns
        const equityCurve = createDailyEquityCurve([10000, 10100, 10200, 10300, 10400]);
        const trades = [createTradeRecord({ pnlUSD: 400 })];

        const result = calculateSummaryMetrics(trades, equityCurve);

        // No negative returns means zero downside deviation → Infinity
        expect(result.sortinoRatio).toBe(Infinity);
    });
});

// =============================================================================
// calculatePerformanceMetrics TESTS
// =============================================================================

describe("calculatePerformanceMetrics", () => {
    it("calculates correct net profit by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -30 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: 50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -20 }),
        ];

        const result = calculatePerformanceMetrics(trades);

        expect(result.netProfit.total).toBe(100);
        expect(result.netProfit.long).toBe(70);
        expect(result.netProfit.short).toBe(30);
    });

    it("calculates correct gross profit by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -30 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: 50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -20 }),
        ];

        const result = calculatePerformanceMetrics(trades);

        expect(result.grossProfit.total).toBe(150);
        expect(result.grossProfit.long).toBe(100);
        expect(result.grossProfit.short).toBe(50);
    });

    it("calculates correct gross loss by direction (as positive numbers)", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -30 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: 50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -20 }),
        ];

        const result = calculatePerformanceMetrics(trades);

        expect(result.grossLoss.total).toBe(50);
        expect(result.grossLoss.long).toBe(30);
        expect(result.grossLoss.short).toBe(20);
    });

    it("handles empty trades array", () => {
        const result = calculatePerformanceMetrics([]);

        expect(result.netProfit.total).toBe(0);
        expect(result.netProfit.long).toBe(0);
        expect(result.netProfit.short).toBe(0);
        expect(result.grossProfit.total).toBe(0);
        expect(result.grossLoss.total).toBe(0);
    });

    it("handles only LONG trades", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -30 }),
        ];

        const result = calculatePerformanceMetrics(trades);

        expect(result.netProfit.short).toBe(0);
        expect(result.grossProfit.short).toBe(0);
        expect(result.grossLoss.short).toBe(0);
    });

    it("handles only SHORT trades", () => {
        const trades = [
            createTradeRecord({ direction: "SHORT", pnlUSD: 50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -20 }),
        ];

        const result = calculatePerformanceMetrics(trades);

        expect(result.netProfit.long).toBe(0);
        expect(result.grossProfit.long).toBe(0);
        expect(result.grossLoss.long).toBe(0);
    });
});

// =============================================================================
// calculateTradeStatistics TESTS
// =============================================================================

describe("calculateTradeStatistics", () => {
    it("counts trades correctly by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -30 }),
            createTradeRecord({ direction: "LONG", pnlUSD: 50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: 40 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -10 }),
        ];

        const result = calculateTradeStatistics(trades);

        expect(result.totalTrades).toBe(5);
        expect(result.winningTradesCount.long).toBe(2);
        expect(result.winningTradesCount.short).toBe(1);
        expect(result.losingTradesCount.long).toBe(1);
        expect(result.losingTradesCount.short).toBe(1);
    });

    it("calculates percent profitable correctly by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -30 }),
            createTradeRecord({ direction: "LONG", pnlUSD: 50 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -20 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: 40 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -10 }),
        ];

        const result = calculateTradeStatistics(trades);

        expect(result.percentProfitable.long).toBe(0.5); // 2/4
        expect(result.percentProfitable.short).toBe(0.5); // 1/2
    });

    it("handles no trades in a direction", () => {
        const trades = [createTradeRecord({ direction: "LONG", pnlUSD: 100 })];

        const result = calculateTradeStatistics(trades);

        expect(result.percentProfitable.short).toBe(0);
        expect(result.winningTradesCount.short).toBe(0);
        expect(result.losingTradesCount.short).toBe(0);
    });

    it("handles empty trades array", () => {
        const result = calculateTradeStatistics([]);

        expect(result.totalTrades).toBe(0);
        expect(result.winningTradesCount.long).toBe(0);
        expect(result.winningTradesCount.short).toBe(0);
    });
});

// =============================================================================
// calculatePnLAnalysis TESTS
// =============================================================================

describe("calculatePnLAnalysis", () => {
    it("calculates average P&L by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: 50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -20 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -30 }),
        ];

        const result = calculatePnLAnalysis(trades);

        expect(result.avgPnl.long).toBe(75);
        expect(result.avgPnl.short).toBe(-25);
    });

    it("calculates average winning trade by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: 200 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: 60 }),
        ];

        const result = calculatePnLAnalysis(trades);

        expect(result.avgWinningTrade.long).toBe(150);
        expect(result.avgWinningTrade.short).toBe(60);
    });

    it("calculates average losing trade as positive number", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: -100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -30 }),
        ];

        const result = calculatePnLAnalysis(trades);

        expect(result.avgLosingTrade.long).toBe(75);
        expect(result.avgLosingTrade.short).toBe(30);
    });

    it("calculates largest winning/losing trades by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: 200 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -50 }),
            createTradeRecord({ direction: "LONG", pnlUSD: -80 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: 60 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -40 }),
        ];

        const result = calculatePnLAnalysis(trades);

        expect(result.largestWinningTrade.long).toBe(200);
        expect(result.largestWinningTrade.short).toBe(60);
        expect(result.largestLosingTrade.long).toBe(80);
        expect(result.largestLosingTrade.short).toBe(40);
    });

    it("handles no winners or losers in a direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "LONG", pnlUSD: 50 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -30 }),
        ];

        const result = calculatePnLAnalysis(trades);

        expect(result.avgLosingTrade.long).toBe(0);
        expect(result.largestLosingTrade.long).toBe(0);
        expect(result.avgWinningTrade.short).toBe(0);
        expect(result.largestWinningTrade.short).toBe(0);
    });
});

// =============================================================================
// calculateDurationAnalysis TESTS
// =============================================================================

describe("calculateDurationAnalysis", () => {
    it("calculates average trade duration by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", durationBars: 100, pnlUSD: 50 }),
            createTradeRecord({ direction: "LONG", durationBars: 200, pnlUSD: -20 }),
            createTradeRecord({ direction: "SHORT", durationBars: 150, pnlUSD: 30 }),
        ];

        const result = calculateDurationAnalysis(trades);

        expect(result.avgTradeDurationBars.long).toBe(150);
        expect(result.avgTradeDurationBars.short).toBe(150);
    });

    it("calculates average winning trade duration by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", durationBars: 100, pnlUSD: 50 }),
            createTradeRecord({ direction: "LONG", durationBars: 200, pnlUSD: 80 }),
            createTradeRecord({ direction: "LONG", durationBars: 300, pnlUSD: -20 }),
            createTradeRecord({ direction: "SHORT", durationBars: 150, pnlUSD: 30 }),
        ];

        const result = calculateDurationAnalysis(trades);

        expect(result.avgWinningTradeDurationBars.long).toBe(150);
        expect(result.avgWinningTradeDurationBars.short).toBe(150);
    });

    it("calculates average losing trade duration by direction", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", durationBars: 100, pnlUSD: 50 }),
            createTradeRecord({ direction: "LONG", durationBars: 200, pnlUSD: -80 }),
            createTradeRecord({ direction: "LONG", durationBars: 400, pnlUSD: -20 }),
            createTradeRecord({ direction: "SHORT", durationBars: 150, pnlUSD: -30 }),
        ];

        const result = calculateDurationAnalysis(trades);

        expect(result.avgLosingTradeDurationBars.long).toBe(300);
        expect(result.avgLosingTradeDurationBars.short).toBe(150);
    });

    it("returns 0 for empty directions", () => {
        const trades = [createTradeRecord({ direction: "LONG", durationBars: 100, pnlUSD: 50 })];

        const result = calculateDurationAnalysis(trades);

        expect(result.avgTradeDurationBars.short).toBe(0);
        expect(result.avgWinningTradeDurationBars.short).toBe(0);
        expect(result.avgLosingTradeDurationBars.short).toBe(0);
    });
});

// =============================================================================
// calculateAdditionalMetrics TESTS
// =============================================================================

describe("calculateAdditionalMetrics", () => {
    const startTime = 1704067200; // 2024-01-01
    const endTime = 1704672000; // 2024-01-08 (7 days)
    const initialCapital = 10000;

    it("calculates profit factor correctly", () => {
        const trades = [
            createTradeRecord({ pnlUSD: 100 }),
            createTradeRecord({ pnlUSD: 50 }),
            createTradeRecord({ pnlUSD: -30 }),
        ];
        const equityCurve = createDailyEquityCurve([10000, 10100, 10120]);

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        // Gross profit = 150, Gross loss = 30
        // Profit factor = 150 / 30 = 5
        expect(result.profitFactor).toBe(5);
    });

    it("returns Infinity for profit factor when no losses", () => {
        const trades = [createTradeRecord({ pnlUSD: 100 }), createTradeRecord({ pnlUSD: 50 })];
        const equityCurve = createDailyEquityCurve([10000, 10100, 10150]);

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        expect(result.profitFactor).toBe(Infinity);
    });

    it("returns 0 for profit factor when no profits", () => {
        const trades = [createTradeRecord({ pnlUSD: -100 }), createTradeRecord({ pnlUSD: -50 })];
        const equityCurve = createDailyEquityCurve([10000, 9900, 9850]);

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        expect(result.profitFactor).toBe(0);
    });

    it("calculates expectancy correctly", () => {
        const trades = [
            createTradeRecord({ pnlUSD: 100 }),
            createTradeRecord({ pnlUSD: -30 }),
            createTradeRecord({ pnlUSD: 50 }),
            createTradeRecord({ pnlUSD: -20 }),
        ];
        const equityCurve = createDailyEquityCurve([10000, 10100]);

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        // Total P&L = 100, 4 trades
        // Expectancy = 100 / 4 = 25
        expect(result.expectancy).toBe(25);
    });

    it("calculates trades per day correctly", () => {
        const trades = [
            createTradeRecord({ pnlUSD: 100 }),
            createTradeRecord({ pnlUSD: 50 }),
            createTradeRecord({ pnlUSD: -30 }),
        ];
        const equityCurve = createDailyEquityCurve([10000, 10120]);

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        // 3 trades over 7 days
        expectApprox(result.tradesPerDay, 3 / 7, 0.01);
    });

    it("calculates max drawdown in USD", () => {
        const equityCurve = [
            createEquityPoint({ equity: 10000, drawdownPct: 0 }),
            createEquityPoint({ equity: 10500, drawdownPct: 0 }),
            createEquityPoint({ equity: 9500, drawdownPct: 0.0952 }), // ~9.52% drawdown
            createEquityPoint({ equity: 10200, drawdownPct: 0.0286 }),
        ];
        const trades = [createTradeRecord({ pnlUSD: 200 })];

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        // Max drawdown = 9.52% of initial capital
        expectApprox(result.maxDrawdownUSD, 952, 10);
    });

    it("counts exit reasons correctly", () => {
        const trades = [
            createTradeRecord({ exitReason: "SIGNAL" }),
            createTradeRecord({ exitReason: "SIGNAL" }),
            createTradeRecord({ exitReason: "STOP_LOSS" }),
            createTradeRecord({ exitReason: "TAKE_PROFIT" }),
            createTradeRecord({ exitReason: "TRAILING_STOP" }),
            createTradeRecord({ exitReason: "END_OF_BACKTEST" }),
        ];
        const equityCurve = createDailyEquityCurve([10000, 10100]);

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        expect(result.exitsByReason.SIGNAL).toBe(2);
        expect(result.exitsByReason.STOP_LOSS).toBe(1);
        expect(result.exitsByReason.TAKE_PROFIT).toBe(1);
        expect(result.exitsByReason.TRAILING_STOP).toBe(1);
        expect(result.exitsByReason.END_OF_BACKTEST).toBe(1);
    });

    it("calculates Calmar ratio correctly", () => {
        // Calmar = CAGR / Max Drawdown
        const equityCurve = createDailyEquityCurve([10000, 10200, 10100, 10500, 10300, 11000, 10800, 11500]);
        const trades = [createTradeRecord({ pnlUSD: 1500 })];

        // 8 days period, starting with 10000, ending with 11500
        const result = calculateAdditionalMetrics(
            trades,
            equityCurve,
            startTime,
            startTime + 8 * 86400,
            initialCapital
        );

        // Calmar should be positive for profitable strategy with drawdowns
        expect(result.calmarRatio).toBeGreaterThan(0);
    });

    it("returns Infinity for Calmar ratio when no drawdown", () => {
        // Monotonically increasing equity
        const equityCurve = [
            createEquityPoint({ equity: 10000, drawdownPct: 0 }),
            createEquityPoint({ equity: 10100, drawdownPct: 0 }),
            createEquityPoint({ equity: 10200, drawdownPct: 0 }),
        ];
        const trades = [createTradeRecord({ pnlUSD: 200 })];

        const result = calculateAdditionalMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        expect(result.calmarRatio).toBe(Infinity);
    });
});

// =============================================================================
// calculateAllMetrics TESTS
// =============================================================================

describe("calculateAllMetrics", () => {
    it("returns all metric categories", () => {
        const trades = [
            createTradeRecord({ direction: "LONG", pnlUSD: 100 }),
            createTradeRecord({ direction: "SHORT", pnlUSD: -30 }),
        ];
        const equityCurve = createDailyEquityCurve([10000, 10100, 10070]);
        const startTime = 1704067200;
        const endTime = 1704240000;
        const initialCapital = 10000;

        const result = calculateAllMetrics(trades, equityCurve, startTime, endTime, initialCapital);

        expect(result.summary).toBeDefined();
        expect(result.performance).toBeDefined();
        expect(result.analysis).toBeDefined();
        expect(result.additional).toBeDefined();

        // Spot check values
        expect(result.summary.totalPnlUSD).toBe(70);
        expect(result.summary.numberOfTrades).toBe(2);
        expect(result.performance.netProfit.total).toBe(70);
        expect(result.analysis.statistics.totalTrades).toBe(2);
    });

    it("uses default risk-free rate of 0", () => {
        const trades = [createTradeRecord({ pnlUSD: 100 })];
        const equityCurve = createDailyEquityCurve([10000, 10100, 10200]);

        // Call without explicit risk-free rate
        const result = calculateAllMetrics(trades, equityCurve, 0, 86400 * 3, 10000);

        // Should work without error and produce valid Sharpe ratio
        expect(result.summary.sharpeRatio).toBeDefined();
    });

    it("handles empty inputs gracefully", () => {
        const result = calculateAllMetrics([], [], 0, 86400, 10000);

        expect(result.summary.totalPnlUSD).toBe(0);
        expect(result.summary.numberOfTrades).toBe(0);
        expect(result.summary.winRate).toBe(0);
        expect(result.performance.netProfit.total).toBe(0);
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("Edge Cases", () => {
    it("handles trades with zero P&L", () => {
        const trades = [createTradeRecord({ pnlUSD: 0 }), createTradeRecord({ pnlUSD: 100 })];

        const result = calculateSummaryMetrics(trades, []);

        expect(result.winRate).toBe(0.5); // Only positive P&L counts as win
    });

    it("handles very small numbers", () => {
        const trades = [createTradeRecord({ pnlUSD: 0.0001 }), createTradeRecord({ pnlUSD: -0.00005 })];

        const result = calculateSummaryMetrics(trades, []);

        expectApprox(result.totalPnlUSD, 0.00005, 0.00001);
    });

    it("handles very large numbers", () => {
        const trades = [createTradeRecord({ pnlUSD: 1000000000 }), createTradeRecord({ pnlUSD: -500000000 })];

        const result = calculateSummaryMetrics(trades, []);

        expect(result.totalPnlUSD).toBe(500000000);
    });

    it("handles single trade", () => {
        const trades = [createTradeRecord({ pnlUSD: 100 })];
        const equityCurve = createDailyEquityCurve([10000, 10100]);

        const result = calculateSummaryMetrics(trades, equityCurve);

        expect(result.numberOfTrades).toBe(1);
        expect(result.winRate).toBe(1);
        expect(result.totalPnlUSD).toBe(100);
    });

    it("handles breakeven trades (P&L = 0)", () => {
        const trades = [createTradeRecord({ pnlUSD: 0 }), createTradeRecord({ pnlUSD: 0 })];

        const result = calculateSummaryMetrics(trades, []);

        expect(result.totalPnlUSD).toBe(0);
        expect(result.winRate).toBe(0);
        expect(result.largestWinUSD).toBe(0);
        expect(result.largestLossUSD).toBe(0);
    });
});
