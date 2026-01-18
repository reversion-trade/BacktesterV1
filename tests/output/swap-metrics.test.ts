/**
 * Swap Metrics Calculation Tests
 *
 * Tests for calculateSwapMetrics, calculateTotalFees,
 * calculateTotalSlippage, and getSwapVolumeStats.
 *
 * @module output/__tests__/swap-metrics.test
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
    calculateSwapMetrics,
    calculateTotalFees,
    calculateTotalSlippage,
    getSwapVolumeStats,
} from "../../src/output/swap-metrics.ts";
import type { SwapEvent, TradeEvent } from "../../src/events/types.ts";
import type { Direction } from "../../src/core/types.ts";
import {
    createMockSwapEvent,
    createMockTradeEvent,
    createEntrySwap,
    createExitSwap,
    resetIdCounters,
} from "../test-utils.ts";

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a trade event with configurable direction and P&L.
 */
function createTradeEvent(
    direction: Direction,
    pnlUSD: number,
    entryPrice: number = 42000,
    entryBar: number = 0,
    exitBar: number = 10
): TradeEvent {
    const entryAmount = 1000;
    const entrySwap = createEntrySwap(entryPrice, entryAmount, entryBar);

    // Calculate exit price from P&L
    const assetAmount = entryAmount / entryPrice;
    const exitAmount = entryAmount + pnlUSD;
    const exitPrice = exitAmount / assetAmount;
    const exitSwap = createExitSwap(exitPrice, assetAmount, exitBar);

    return {
        tradeId: 1,
        direction,
        entrySwap,
        exitSwap,
        pnlUSD,
        pnlPct: pnlUSD / entryAmount,
        durationBars: exitBar - entryBar,
        durationSeconds: (exitBar - entryBar) * 60,
    };
}

/**
 * Create an equity curve for testing.
 */
function createEquityCurve(equities: number[]): Array<{ timestamp: number; equity: number; drawdownPct: number }> {
    const baseTime = 1704067200;
    const DAY = 86400;
    let maxEquity = equities[0] ?? 10000;

    return equities.map((equity, i) => {
        maxEquity = Math.max(maxEquity, equity);
        const drawdownPct = maxEquity > 0 ? (maxEquity - equity) / maxEquity : 0;

        return {
            timestamp: baseTime + i * DAY,
            equity,
            drawdownPct,
        };
    });
}

beforeEach(() => {
    resetIdCounters();
});

// =============================================================================
// calculateSwapMetrics TESTS
// =============================================================================

describe("calculateSwapMetrics", () => {
    describe("empty trades", () => {
        it("returns zeros for empty trades array", () => {
            const result = calculateSwapMetrics([], []);

            expect(result.totalTrades).toBe(0);
            expect(result.winningTrades).toBe(0);
            expect(result.losingTrades).toBe(0);
            expect(result.winRate).toBe(0);
            expect(result.totalPnlUSD).toBe(0);
            expect(result.profitFactor).toBe(0);
            expect(result.sharpeRatio).toBe(0);
            expect(result.sortinoRatio).toBe(0);
        });
    });

    describe("trade counts and win rate", () => {
        it("calculates correct total trades", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", -30),
                createTradeEvent("SHORT", 50),
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.totalTrades).toBe(3);
        });

        it("calculates correct winning and losing counts", () => {
            const trades = [
                createTradeEvent("LONG", 100), // win
                createTradeEvent("LONG", -30), // loss
                createTradeEvent("LONG", 50), // win
                createTradeEvent("LONG", -20), // loss
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.winningTrades).toBe(2);
            expect(result.losingTrades).toBe(2);
        });

        it("calculates correct win rate", () => {
            const trades = [
                createTradeEvent("LONG", 100), // win
                createTradeEvent("LONG", -30), // loss
                createTradeEvent("LONG", 50), // win
                createTradeEvent("LONG", -20), // loss
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.winRate).toBe(0.5);
        });

        it("handles all winning trades (100% win rate)", () => {
            const trades = [createTradeEvent("LONG", 100), createTradeEvent("LONG", 50), createTradeEvent("LONG", 75)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.winRate).toBe(1);
            expect(result.winningTrades).toBe(3);
            expect(result.losingTrades).toBe(0);
        });

        it("handles all losing trades (0% win rate)", () => {
            const trades = [createTradeEvent("LONG", -100), createTradeEvent("LONG", -50)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.winRate).toBe(0);
            expect(result.winningTrades).toBe(0);
            expect(result.losingTrades).toBe(2);
        });
    });

    describe("P&L calculations", () => {
        it("calculates correct total P&L", () => {
            const trades = [createTradeEvent("LONG", 100), createTradeEvent("LONG", -30), createTradeEvent("LONG", 50)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.totalPnlUSD).toBe(120);
        });

        it("calculates correct gross profit (sum of winners)", () => {
            const trades = [createTradeEvent("LONG", 100), createTradeEvent("LONG", -30), createTradeEvent("LONG", 50)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.grossProfitUSD).toBe(150);
        });

        it("calculates correct gross loss as positive number", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", -30),
                createTradeEvent("LONG", -50),
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.grossLossUSD).toBe(80);
        });

        it("calculates correct average P&L", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", -30),
                createTradeEvent("LONG", 50),
                createTradeEvent("LONG", -20),
            ];
            const result = calculateSwapMetrics(trades, []);

            // Total = 100, 4 trades
            expect(result.avgPnlUSD).toBe(25);
        });

        it("calculates correct average win", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", -30),
                createTradeEvent("LONG", 200),
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.avgWinUSD).toBe(150);
        });

        it("calculates correct average loss as positive number", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", -30),
                createTradeEvent("LONG", -70),
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.avgLossUSD).toBe(50);
        });

        it("calculates correct largest win and loss", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", 200),
                createTradeEvent("LONG", -30),
                createTradeEvent("LONG", -80),
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.largestWinUSD).toBe(200);
            expect(result.largestLossUSD).toBe(80);
        });
    });

    describe("profit factor", () => {
        it("calculates correct profit factor", () => {
            const trades = [
                createTradeEvent("LONG", 150), // gross profit = 150
                createTradeEvent("LONG", -30), // gross loss = 30
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.profitFactor).toBe(5);
        });

        it("returns Infinity when no losses", () => {
            const trades = [createTradeEvent("LONG", 100), createTradeEvent("LONG", 50)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.profitFactor).toBe(Infinity);
        });

        it("returns 0 when no profits", () => {
            const trades = [createTradeEvent("LONG", -100), createTradeEvent("LONG", -50)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.profitFactor).toBe(0);
        });
    });

    describe("direction breakdown", () => {
        it("counts trades by direction", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", -30),
                createTradeEvent("LONG", 50),
                createTradeEvent("SHORT", 40),
                createTradeEvent("SHORT", -10),
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.longTrades).toBe(3);
            expect(result.shortTrades).toBe(2);
        });

        it("calculates win rate by direction", () => {
            const trades = [
                createTradeEvent("LONG", 100), // long win
                createTradeEvent("LONG", -30), // long loss
                createTradeEvent("LONG", 50), // long win
                createTradeEvent("SHORT", 40), // short win
                createTradeEvent("SHORT", -10), // short loss
                createTradeEvent("SHORT", -20), // short loss
            ];
            const result = calculateSwapMetrics(trades, []);

            // Long: 2/3 = 66.67%
            expect(result.longWinRate).toBeCloseTo(2 / 3, 4);
            // Short: 1/3 = 33.33%
            expect(result.shortWinRate).toBeCloseTo(1 / 3, 4);
        });

        it("calculates P&L by direction", () => {
            const trades = [
                createTradeEvent("LONG", 100),
                createTradeEvent("LONG", -30),
                createTradeEvent("SHORT", 50),
                createTradeEvent("SHORT", -20),
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.longPnlUSD).toBe(70);
            expect(result.shortPnlUSD).toBe(30);
        });

        it("handles only LONG trades", () => {
            const trades = [createTradeEvent("LONG", 100), createTradeEvent("LONG", -30)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.longTrades).toBe(2);
            expect(result.shortTrades).toBe(0);
            expect(result.shortWinRate).toBe(0);
            expect(result.shortPnlUSD).toBe(0);
        });

        it("handles only SHORT trades", () => {
            const trades = [createTradeEvent("SHORT", 50), createTradeEvent("SHORT", -20)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.longTrades).toBe(0);
            expect(result.shortTrades).toBe(2);
            expect(result.longWinRate).toBe(0);
            expect(result.longPnlUSD).toBe(0);
        });
    });

    describe("duration metrics", () => {
        it("calculates average trade duration in bars", () => {
            const trades = [
                createTradeEvent("LONG", 100, 42000, 0, 10), // 10 bars
                createTradeEvent("LONG", 50, 42000, 0, 30), // 30 bars
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.avgTradeDurationBars).toBe(20);
        });

        it("calculates average trade duration in seconds", () => {
            const trades = [
                createTradeEvent("LONG", 100, 42000, 0, 10), // 600 seconds
                createTradeEvent("LONG", 50, 42000, 0, 30), // 1800 seconds
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.avgTradeDurationSeconds).toBe(1200);
        });

        it("calculates average winning trade duration", () => {
            const trades = [
                createTradeEvent("LONG", 100, 42000, 0, 10), // win - 10 bars
                createTradeEvent("LONG", -50, 42000, 0, 5), // loss - 5 bars
                createTradeEvent("LONG", 50, 42000, 0, 20), // win - 20 bars
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.avgWinDurationBars).toBe(15); // (10 + 20) / 2
        });

        it("calculates average losing trade duration", () => {
            const trades = [
                createTradeEvent("LONG", 100, 42000, 0, 10), // win - 10 bars
                createTradeEvent("LONG", -50, 42000, 0, 5), // loss - 5 bars
                createTradeEvent("LONG", -30, 42000, 0, 15), // loss - 15 bars
            ];
            const result = calculateSwapMetrics(trades, []);

            expect(result.avgLossDurationBars).toBe(10); // (5 + 15) / 2
        });
    });

    describe("fees and slippage", () => {
        it("calculates total fees from swap events", () => {
            // createEntrySwap and createExitSwap set fees at 0.1% of trade amount
            const trades = [
                createTradeEvent("LONG", 100), // Entry: $1 fee, Exit: ~$1.1 fee
                createTradeEvent("LONG", 50), // Entry: $1 fee, Exit: ~$1.05 fee
            ];
            const result = calculateSwapMetrics(trades, []);

            // Each trade has entry and exit swaps with fees
            expect(result.totalFeesUSD).toBeGreaterThan(0);
        });

        it("calculates total slippage from swap events", () => {
            const trades = [createTradeEvent("LONG", 100), createTradeEvent("LONG", 50)];
            const result = calculateSwapMetrics(trades, []);

            // Each swap has slippage at 0.05% of trade amount
            expect(result.totalSlippageUSD).toBeGreaterThan(0);
        });
    });

    describe("drawdown metrics", () => {
        it("calculates max drawdown percentage from equity curve", () => {
            const trades = [createTradeEvent("LONG", 100)];
            const equityCurve = createEquityCurve([10000, 10500, 9500, 10200]);
            // Max drawdown from 10500 to 9500 = 9.52%

            const result = calculateSwapMetrics(trades, equityCurve);

            expect(result.maxDrawdownPct).toBeCloseTo(0.0952, 3);
        });

        it("calculates max drawdown in USD from equity curve", () => {
            const trades = [createTradeEvent("LONG", 100)];
            const equityCurve = createEquityCurve([10000, 10500, 9500, 10200]);

            const result = calculateSwapMetrics(trades, equityCurve);

            // Peak 10500, trough 9500 = $1000 drawdown
            expect(result.maxDrawdownUSD).toBe(1000);
        });

        it("returns 0 drawdown for monotonically increasing equity", () => {
            const trades = [createTradeEvent("LONG", 100)];
            const equityCurve = createEquityCurve([10000, 10100, 10200, 10300]);

            const result = calculateSwapMetrics(trades, equityCurve);

            expect(result.maxDrawdownPct).toBe(0);
            expect(result.maxDrawdownUSD).toBe(0);
        });
    });

    describe("Sharpe and Sortino ratios", () => {
        it("returns 0 for insufficient data (less than 2 days)", () => {
            const trades = [createTradeEvent("LONG", 100)];
            const equityCurve = createEquityCurve([10100]);

            const result = calculateSwapMetrics(trades, equityCurve);

            expect(result.sharpeRatio).toBe(0);
            expect(result.sortinoRatio).toBe(0);
        });

        it("calculates positive Sharpe for profitable strategy", () => {
            const trades = [createTradeEvent("LONG", 300)];
            const equityCurve = createEquityCurve([10000, 10100, 10200, 10300]);

            const result = calculateSwapMetrics(trades, equityCurve);

            expect(result.sharpeRatio).toBeGreaterThan(0);
        });

        it("returns Infinity Sortino for no downside deviation", () => {
            const trades = [createTradeEvent("LONG", 300)];
            const equityCurve = createEquityCurve([10000, 10100, 10200, 10300]);

            const result = calculateSwapMetrics(trades, equityCurve);

            expect(result.sortinoRatio).toBe(Infinity);
        });
    });

    describe("Calmar ratio", () => {
        it("returns 0 for empty equity curve", () => {
            const trades = [createTradeEvent("LONG", 100)];
            const result = calculateSwapMetrics(trades, []);

            expect(result.calmarRatio).toBe(0);
        });

        it("returns Infinity for zero drawdown with positive returns", () => {
            const trades = [createTradeEvent("LONG", 300)];
            const equityCurve = createEquityCurve([10000, 10100, 10200, 10300]);

            const result = calculateSwapMetrics(trades, equityCurve);

            expect(result.calmarRatio).toBe(Infinity);
        });

        it("calculates positive Calmar for profitable strategy with drawdowns", () => {
            const trades = [createTradeEvent("LONG", 500)];
            const equityCurve = createEquityCurve([10000, 10200, 10100, 10400, 10300, 10500]);

            const result = calculateSwapMetrics(trades, equityCurve);

            // Has positive returns and some drawdowns
            expect(result.calmarRatio).toBeGreaterThan(0);
        });
    });
});

// =============================================================================
// calculateTotalFees TESTS
// =============================================================================

describe("calculateTotalFees", () => {
    it("returns 0 for empty swaps", () => {
        const result = calculateTotalFees([]);
        expect(result).toBe(0);
    });

    it("sums fees from all swaps", () => {
        const swaps = [
            createMockSwapEvent({ feeUSD: 10 }),
            createMockSwapEvent({ feeUSD: 5 }),
            createMockSwapEvent({ feeUSD: 3 }),
        ];

        const result = calculateTotalFees(swaps);
        expect(result).toBe(18);
    });

    it("handles single swap", () => {
        const swaps = [createMockSwapEvent({ feeUSD: 7.5 })];

        const result = calculateTotalFees(swaps);
        expect(result).toBe(7.5);
    });
});

// =============================================================================
// calculateTotalSlippage TESTS
// =============================================================================

describe("calculateTotalSlippage", () => {
    it("returns 0 for empty swaps", () => {
        const result = calculateTotalSlippage([]);
        expect(result).toBe(0);
    });

    it("sums slippage from all swaps", () => {
        const swaps = [
            createMockSwapEvent({ slippageUSD: 2 }),
            createMockSwapEvent({ slippageUSD: 1.5 }),
            createMockSwapEvent({ slippageUSD: 0.5 }),
        ];

        const result = calculateTotalSlippage(swaps);
        expect(result).toBe(4);
    });

    it("handles single swap", () => {
        const swaps = [createMockSwapEvent({ slippageUSD: 3.25 })];

        const result = calculateTotalSlippage(swaps);
        expect(result).toBe(3.25);
    });
});

// =============================================================================
// getSwapVolumeStats TESTS
// =============================================================================

describe("getSwapVolumeStats", () => {
    it("returns zeros for empty swaps", () => {
        const result = getSwapVolumeStats([]);

        expect(result.totalVolumeUSD).toBe(0);
        expect(result.avgSwapSizeUSD).toBe(0);
        expect(result.swapCount).toBe(0);
    });

    it("calculates total volume in USD", () => {
        const swaps = [
            createMockSwapEvent({ fromAsset: "USD", fromAmount: 1000 }),
            createMockSwapEvent({ fromAsset: "USD", fromAmount: 2000 }),
        ];

        const result = getSwapVolumeStats(swaps);
        expect(result.totalVolumeUSD).toBe(3000);
    });

    it("calculates average swap size", () => {
        const swaps = [
            createMockSwapEvent({ fromAsset: "USD", fromAmount: 1000 }),
            createMockSwapEvent({ fromAsset: "USD", fromAmount: 3000 }),
        ];

        const result = getSwapVolumeStats(swaps);
        expect(result.avgSwapSizeUSD).toBe(2000);
    });

    it("counts swaps correctly", () => {
        const swaps = [createMockSwapEvent({}), createMockSwapEvent({}), createMockSwapEvent({})];

        const result = getSwapVolumeStats(swaps);
        expect(result.swapCount).toBe(3);
    });

    it("uses toAmount for exit swaps (asset to USD)", () => {
        const swaps = [createMockSwapEvent({ fromAsset: "BTC", toAsset: "USD", fromAmount: 0.1, toAmount: 4200 })];

        const result = getSwapVolumeStats(swaps);
        expect(result.totalVolumeUSD).toBe(4200);
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("Edge Cases", () => {
    it("handles trades with zero P&L", () => {
        const trades = [createTradeEvent("LONG", 0), createTradeEvent("LONG", 100)];
        const result = calculateSwapMetrics(trades, []);

        // Zero P&L is not a winner
        expect(result.winRate).toBe(0.5);
    });

    it("handles very small numbers", () => {
        const trades = [createTradeEvent("LONG", 0.0001), createTradeEvent("LONG", -0.00005)];
        const result = calculateSwapMetrics(trades, []);

        expect(result.totalPnlUSD).toBeCloseTo(0.00005, 5);
    });

    it("handles very large numbers", () => {
        const trades = [createTradeEvent("LONG", 1000000000), createTradeEvent("LONG", -500000000)];
        const result = calculateSwapMetrics(trades, []);

        expect(result.totalPnlUSD).toBe(500000000);
    });

    it("handles single trade", () => {
        const trades = [createTradeEvent("LONG", 100)];
        const equityCurve = createEquityCurve([10000, 10100]);

        const result = calculateSwapMetrics(trades, equityCurve);

        expect(result.totalTrades).toBe(1);
        expect(result.winRate).toBe(1);
        expect(result.totalPnlUSD).toBe(100);
    });

    it("handles breakeven trade (P&L = 0)", () => {
        const trades = [createTradeEvent("LONG", 0)];
        const result = calculateSwapMetrics(trades, []);

        expect(result.totalPnlUSD).toBe(0);
        expect(result.winRate).toBe(0);
    });
});
