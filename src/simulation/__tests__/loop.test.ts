/**
 * Simulation Loop Tests
 *
 * Tests for the runSimulation function which is the core forward-pass
 * simulation engine.
 *
 * NOTE: Many tests require the full indicator system with proper configs.
 * Tests marked with [INTEGRATION] require the indicator factory to work.
 * Basic tests use empty conditions which don't trigger indicator processing.
 *
 * @module simulation/__tests__/loop.test
 */

import { describe, it, expect } from "bun:test";
import { runSimulation, type SimulationConfig, type SimulationResult } from "../loop.ts";
import type { Candle, AlgoParams } from "../../core/types.ts";
import type { SignalCache } from "../../indicators/calculator.ts";

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createCandle(bucket: number, close: number, high?: number, low?: number): Candle {
    return {
        bucket,
        open: close - 10,
        high: high ?? close + 20,
        low: low ?? close - 20,
        close,
        volume: 100,
    };
}

function createAlgoParams(overrides: Partial<AlgoParams> = {}): AlgoParams {
    return {
        type: "LONG",
        longEntry: { required: [], optional: [] },
        longExit: { required: [], optional: [] },
        positionSize: { type: "REL", value: 0.1 },
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        ...overrides,
    };
}

function createDefaultConfig(
    candles: Candle[],
    signalCache: SignalCache,
    algoParamOverrides: Partial<AlgoParams> = {}
): SimulationConfig {
    return {
        candles,
        signalCache,
        algoParams: createAlgoParams(algoParamOverrides),
        symbol: "BTC",
        initialCapital: 10000,
        feeBps: 10, // 0.1%
        slippageBps: 5, // 0.05%
        warmupCandles: 0,
        assumePositionImmediately: true,
        closePositionOnExit: true,
    };
}

// =============================================================================
// BASIC FUNCTIONALITY TESTS
// =============================================================================

describe("runSimulation", () => {
    describe("basic behavior", () => {
        it("returns empty results for empty candles", () => {
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig([], signalCache);

            const result = runSimulation(config);

            expect(result.algoEvents).toEqual([]);
            expect(result.swapEvents).toEqual([]);
            expect(result.trades).toEqual([]);
            expect(result.equityCurve).toEqual([]);
        });

        it("builds equity curve for each candle", () => {
            const candles = [createCandle(1000, 42000), createCandle(1001, 42100), createCandle(1002, 42200)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(3);
            expect(result.equityCurve[0]!.barIndex).toBe(0);
            expect(result.equityCurve[1]!.barIndex).toBe(1);
            expect(result.equityCurve[2]!.barIndex).toBe(2);
        });

        it("starts with initial capital in equity curve", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve[0]!.equity).toBe(10000);
        });

        it("equity curve points have correct structure", () => {
            const candles = [createCandle(1000, 42000), createCandle(2000, 43000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve[0]).toHaveProperty("timestamp", 1000);
            expect(result.equityCurve[0]).toHaveProperty("barIndex", 0);
            expect(result.equityCurve[0]).toHaveProperty("equity");
            expect(result.equityCurve[0]).toHaveProperty("drawdownPct");
            expect(result.equityCurve[1]).toHaveProperty("timestamp", 2000);
            expect(result.equityCurve[1]).toHaveProperty("barIndex", 1);
        });

        it("initial drawdown is zero", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve[0]!.drawdownPct).toBe(0);
        });

        it("handles single candle", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1);
            expect(result.algoEvents).toEqual([]);
            expect(result.swapEvents).toEqual([]);
            expect(result.trades).toEqual([]);
        });

        it("processes many candles without error", () => {
            const candles = Array.from({ length: 1000 }, (_, i) =>
                createCandle(i * 60000, 42000 + Math.sin(i * 0.1) * 1000)
            );
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1000);
        });
    });

    describe("configuration handling", () => {
        it("respects initialCapital configuration", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                initialCapital: 50000,
            };

            const result = runSimulation(config);

            expect(result.equityCurve[0]!.equity).toBe(50000);
        });

        it("respects symbol configuration", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                symbol: "ETH",
            };

            // Should not throw
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(1);
        });

        it("applies feeBps and slippageBps correctly (no trades, no effect)", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                feeBps: 50,
                slippageBps: 25,
            };

            const result = runSimulation(config);

            // With no trades, fees have no effect
            expect(result.equityCurve[0]!.equity).toBe(10000);
        });

        it("respects warmupCandles configuration", () => {
            const candles = [createCandle(1000, 42000), createCandle(2000, 42100), createCandle(3000, 42200)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                warmupCandles: 2,
            };

            // Should still process all candles but no entries during warmup
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(3);
        });
    });

    describe("result structure", () => {
        it("returns correct result shape", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result).toHaveProperty("algoEvents");
            expect(result).toHaveProperty("swapEvents");
            expect(result).toHaveProperty("trades");
            expect(result).toHaveProperty("equityCurve");
            expect(Array.isArray(result.algoEvents)).toBe(true);
            expect(Array.isArray(result.swapEvents)).toBe(true);
            expect(Array.isArray(result.trades)).toBe(true);
            expect(Array.isArray(result.equityCurve)).toBe(true);
        });

        it("algoEvents array starts empty when no conditions", () => {
            const candles = [createCandle(1000, 42000), createCandle(2000, 43000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.algoEvents).toEqual([]);
        });

        it("swapEvents array starts empty when no trades", () => {
            const candles = [createCandle(1000, 42000), createCandle(2000, 43000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.swapEvents).toEqual([]);
        });

        it("trades array starts empty when no complete trades", () => {
            const candles = [createCandle(1000, 42000), createCandle(2000, 43000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.trades).toEqual([]);
        });
    });

    describe("algo type handling", () => {
        it("accepts LONG-only algo type", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache, { type: "LONG" });

            // Should not throw
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(1);
        });

        it("accepts SHORT-only algo type", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache, { type: "SHORT" });

            // Should not throw
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(1);
        });

        it("accepts BOTH direction algo type", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache, { type: "BOTH" });

            // Should not throw
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(1);
        });
    });

    describe("position sizing types", () => {
        it("accepts REL position size type", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache, {
                positionSize: { type: "REL", value: 0.5 },
            });

            // Should not throw
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(1);
        });

        it("accepts ABS position size type", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache, {
                positionSize: { type: "ABS", value: 5000 },
            });

            // Should not throw
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(1);
        });
    });

    describe("closePositionOnExit behavior", () => {
        it("respects closePositionOnExit=true (no effect when no position)", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                closePositionOnExit: true,
            };

            const result = runSimulation(config);

            // No position was open, so no forced close
            expect(result.swapEvents).toEqual([]);
        });

        it("respects closePositionOnExit=false (no effect when no position)", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                closePositionOnExit: false,
            };

            const result = runSimulation(config);

            // No position was open, so no forced close
            expect(result.swapEvents).toEqual([]);
        });
    });

    describe("tradesLimit behavior", () => {
        it("respects tradesLimit=0 (no trades allowed)", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                tradesLimit: 0,
            };

            const result = runSimulation(config);

            // With limit 0 and empty conditions, no trades should occur
            expect(result.trades).toEqual([]);
        });

        it("accepts tradesLimit=undefined (unlimited)", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                tradesLimit: undefined,
            };

            const result = runSimulation(config);

            // Should not throw
            expect(result.equityCurve.length).toBe(1);
        });
    });

    describe("assumePositionImmediately behavior", () => {
        it("accepts assumePositionImmediately=true", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                assumePositionImmediately: true,
            };

            const result = runSimulation(config);

            // Should not throw
            expect(result.equityCurve.length).toBe(1);
        });

        it("accepts assumePositionImmediately=false", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                assumePositionImmediately: false,
            };

            const result = runSimulation(config);

            // Should not throw
            expect(result.equityCurve.length).toBe(1);
        });
    });

    describe("edge cases", () => {
        it("handles very small candle values", () => {
            const candles = [createCandle(1000, 0.001)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1);
        });

        it("handles very large candle values", () => {
            const candles = [createCandle(1000, 1000000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1);
        });

        it("handles zero volume candles", () => {
            const candles = [
                {
                    bucket: 1000,
                    open: 41990,
                    high: 42020,
                    low: 41980,
                    close: 42000,
                    volume: 0,
                },
            ];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1);
        });

        it("handles candles where open equals close", () => {
            const candles = [
                {
                    bucket: 1000,
                    open: 42000,
                    high: 42020,
                    low: 41980,
                    close: 42000,
                    volume: 100,
                },
            ];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1);
        });

        it("handles very small initial capital", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                initialCapital: 1,
            };

            const result = runSimulation(config);

            expect(result.equityCurve[0]!.equity).toBe(1);
        });

        it("handles zero warmup candles", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                warmupCandles: 0,
            };

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1);
        });

        it("handles warmup greater than candle count", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                warmupCandles: 100,
            };

            const result = runSimulation(config);

            // All candles are warmup, no entries possible
            expect(result.equityCurve.length).toBe(1);
            expect(result.swapEvents).toEqual([]);
        });

        it("handles zero fee/slippage", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config: SimulationConfig = {
                ...createDefaultConfig(candles, signalCache),
                feeBps: 0,
                slippageBps: 0,
            };

            const result = runSimulation(config);

            expect(result.equityCurve[0]!.equity).toBe(10000);
        });
    });

    describe("signal cache handling", () => {
        it("ignores unknown keys in signal cache", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map([
                ["UNKNOWN_INDICATOR:123", [true, false, true]],
                ["ANOTHER_UNKNOWN:456", [false, true]],
            ]);
            const config = createDefaultConfig(candles, signalCache);

            // Should not throw - unknown keys are ignored
            const result = runSimulation(config);
            expect(result.equityCurve.length).toBe(1);
        });

        it("handles empty signal cache", () => {
            const candles = [createCandle(1000, 42000)];
            const signalCache: SignalCache = new Map();
            const config = createDefaultConfig(candles, signalCache);

            const result = runSimulation(config);

            expect(result.equityCurve.length).toBe(1);
        });
    });
});

// =============================================================================
// INTEGRATION TESTS (require full indicator system)
// =============================================================================
// NOTE: The following tests would require proper indicator configurations
// to work with the indicator factory. They are documented here as a reference
// for future integration testing.
//
// Tests that need full indicator integration:
// - Entry/exit signal detection
// - Stop loss triggers
// - Take profit triggers
// - Trailing stop triggers
// - P&L calculations with actual trades
// - Multiple trades in sequence
// - Direction switching (LONG to FLAT to SHORT)
// - Edge detection (false → true transitions)
//
// These tests should be implemented as integration tests with the full
// indicator package properly configured.
