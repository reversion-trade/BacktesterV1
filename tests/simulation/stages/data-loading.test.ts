/**
 * Stage 1: Data Loading Tests
 *
 * Tests for data loading and filtering functionality.
 *
 * @module simulation/stages/__tests__/data-loading.test
 */

import { describe, it, expect } from "bun:test";
import {
    executeDataLoading,
    filterCandlesToRange,
    type DataLoadingResult,
} from "../../../src/simulation/stages/data-loading.ts";
import type { Candle, AlgoParams } from "../../../src/core/types.ts";
import type { BacktestInput } from "../../../src/core/config.ts";

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createCandle(bucket: number, close: number = 42000): Candle {
    return {
        bucket,
        open: close - 10,
        high: close + 20,
        low: close - 20,
        close,
        volume: 100,
    };
}

function createMinimalBacktestInput(overrides: {
    startTime?: number;
    endTime?: number;
    startingCapitalUSD?: number;
    capitalScaler?: number;
}): BacktestInput {
    const now = Math.floor(Date.now() / 1000);
    // Note: Zod schema requires startTime > 0 and endTime > startTime
    return {
        algoConfig: {
            userID: "test-user",
            algoID: "test-algo",
            algoName: "Test Algorithm",
            version: 1,
            params: {
                type: "LONG",
                longEntry: { required: [], optional: [] },
                positionSize: { type: "REL", value: 0.1 },
                orderType: "MARKET",
                startingCapitalUSD: overrides.startingCapitalUSD ?? 10000,
                timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 },
            },
        },
        runSettings: {
            userID: "test-user",
            algoID: "test-algo",
            version: "1",
            runID: "test-run-1",
            isBacktest: true,
            coinSymbol: "BTC",
            capitalScaler: overrides.capitalScaler ?? 1,
            startTime: overrides.startTime ?? 1,
            endTime: overrides.endTime ?? 1000,
            closePositionOnExit: true,
            launchTime: now,
            status: "NEW",
            exchangeID: "test-exchange",
        },
        feeBps: 10,
        slippageBps: 5,
    };
}

function createMinimalAlgoParams(overrides: Partial<AlgoParams> = {}): AlgoParams {
    return {
        type: "LONG",
        longEntry: { required: [], optional: [] },
        positionSize: { type: "REL", value: 0.1 },
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 },
        ...overrides,
    };
}

// =============================================================================
// FILTER CANDLES TO RANGE TESTS
// =============================================================================

describe("filterCandlesToRange", () => {
    it("filters candles within range", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120), createCandle(180), createCandle(240)];

        const filtered = filterCandlesToRange(candles, 60, 180);

        expect(filtered.length).toBe(3);
        expect(filtered[0]!.bucket).toBe(60);
        expect(filtered[2]!.bucket).toBe(180);
    });

    it("includes boundary candles", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120)];

        const filtered = filterCandlesToRange(candles, 0, 120);

        expect(filtered.length).toBe(3);
    });

    it("returns empty array when no candles in range", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120)];

        const filtered = filterCandlesToRange(candles, 500, 600);

        expect(filtered.length).toBe(0);
    });

    it("handles empty candle array", () => {
        const filtered = filterCandlesToRange([], 0, 1000);
        expect(filtered.length).toBe(0);
    });

    it("handles single candle in range", () => {
        const candles = [createCandle(50)];

        const filtered = filterCandlesToRange(candles, 0, 100);

        expect(filtered.length).toBe(1);
        expect(filtered[0]!.bucket).toBe(50);
    });

    it("handles single candle out of range", () => {
        const candles = [createCandle(500)];

        const filtered = filterCandlesToRange(candles, 0, 100);

        expect(filtered.length).toBe(0);
    });

    it("handles start time equal to end time", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120)];

        const filtered = filterCandlesToRange(candles, 60, 60);

        expect(filtered.length).toBe(1);
        expect(filtered[0]!.bucket).toBe(60);
    });

    it("returns all candles when range covers entire dataset", () => {
        const candles = [createCandle(100), createCandle(200), createCandle(300)];

        const filtered = filterCandlesToRange(candles, 0, 1000);

        expect(filtered.length).toBe(3);
    });

    it("does not modify original array", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120)];
        const originalLength = candles.length;

        filterCandlesToRange(candles, 60, 60);

        expect(candles.length).toBe(originalLength);
    });
});

// =============================================================================
// EXECUTE DATA LOADING TESTS
// =============================================================================

describe("executeDataLoading", () => {
    it("returns filtered candles for time range", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120), createCandle(180)];
        const input = createMinimalBacktestInput({
            startTime: 60,
            endTime: 120,
        });

        const result = executeDataLoading(candles, input);

        expect(result.filteredCandles.length).toBe(2);
        expect(result.filteredCandles[0]!.bucket).toBe(60);
        expect(result.filteredCandles[1]!.bucket).toBe(120);
    });

    it("sets isEmpty to true when no candles in range", () => {
        const candles = [createCandle(0), createCandle(60)];
        const input = createMinimalBacktestInput({
            startTime: 500,
            endTime: 600,
        });

        const result = executeDataLoading(candles, input);

        expect(result.isEmpty).toBe(true);
        expect(result.filteredCandles.length).toBe(0);
    });

    it("sets isEmpty to false when candles exist", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
        });

        const result = executeDataLoading(candles, input);

        expect(result.isEmpty).toBe(false);
    });

    it("calculates actual start and end times from candles", () => {
        const candles = [createCandle(100), createCandle(200), createCandle(300)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 1000,
        });

        const result = executeDataLoading(candles, input);

        expect(result.actualStartTime).toBe(100);
        expect(result.actualEndTime).toBe(300);
    });

    it("uses requested times when no candles in range", () => {
        const candles = [createCandle(100)];
        const input = createMinimalBacktestInput({
            startTime: 500,
            endTime: 600,
        });

        const result = executeDataLoading(candles, input);

        expect(result.actualStartTime).toBe(500);
        expect(result.actualEndTime).toBe(600);
    });

    it("calculates initial capital correctly", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
            startingCapitalUSD: 10000,
            capitalScaler: 2,
        });

        const result = executeDataLoading(candles, input);

        expect(result.initialCapital).toBe(20000);
    });

    it("calculates initial capital with fractional scaler", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
            startingCapitalUSD: 10000,
            capitalScaler: 0.5,
        });

        const result = executeDataLoading(candles, input);

        expect(result.initialCapital).toBe(5000);
    });

    it("returns validated input in result", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
        });

        const result = executeDataLoading(candles, input);

        expect(result.validatedInput).toBeDefined();
        expect(result.validatedInput.algoConfig.algoID).toBe("test-algo");
        expect(result.validatedInput.runSettings.isBacktest).toBe(true);
    });

    it("throws on invalid backtest input", () => {
        const candles = [createCandle(50)];
        const invalidInput = {
            algoConfig: {
                userID: "", // Invalid: empty string
                algoID: "test",
                algoName: "Test",
                version: 1,
                params: createMinimalAlgoParams(),
            },
            runSettings: {
                userID: "test",
                algoID: "test",
                version: "1",
                runID: "run-1",
                isBacktest: true,
                coinSymbol: "BTC",
                capitalScaler: 1,
                startTime: 1,
                endTime: 100,
                closePositionOnExit: true,
                launchTime: Date.now(),
                status: "NEW" as const,
                exchangeID: "test",
            },
        };

        expect(() => executeDataLoading(candles, invalidInput as any)).toThrow();
    });

    it("handles large candle arrays efficiently", () => {
        // Create 10000 candles
        const candles = Array.from({ length: 10000 }, (_, i) => createCandle(i * 60));
        const input = createMinimalBacktestInput({
            startTime: 300000, // Start at candle 5000
            endTime: 360000, // End at candle 6000
        });

        const start = performance.now();
        const result = executeDataLoading(candles, input);
        const duration = performance.now() - start;

        expect(result.filteredCandles.length).toBe(1001); // 5000-6000 inclusive
        expect(duration).toBeLessThan(100); // Should complete quickly
    });
});

// =============================================================================
// DATA LOADING RESULT STRUCTURE TESTS
// =============================================================================

describe("DataLoadingResult structure", () => {
    it("contains all required fields", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
        });

        const result = executeDataLoading(candles, input);

        expect(result).toHaveProperty("validatedInput");
        expect(result).toHaveProperty("filteredCandles");
        expect(result).toHaveProperty("actualStartTime");
        expect(result).toHaveProperty("actualEndTime");
        expect(result).toHaveProperty("initialCapital");
        expect(result).toHaveProperty("isEmpty");
    });

    it("filteredCandles is an array", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
        });

        const result = executeDataLoading(candles, input);

        expect(Array.isArray(result.filteredCandles)).toBe(true);
    });

    it("isEmpty is a boolean", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
        });

        const result = executeDataLoading(candles, input);

        expect(typeof result.isEmpty).toBe("boolean");
    });

    it("timestamps are numbers", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
        });

        const result = executeDataLoading(candles, input);

        expect(typeof result.actualStartTime).toBe("number");
        expect(typeof result.actualEndTime).toBe("number");
    });

    it("initialCapital is a positive number", () => {
        const candles = [createCandle(50)];
        const input = createMinimalBacktestInput({
            startTime: 1,
            endTime: 100,
            startingCapitalUSD: 10000,
        });

        const result = executeDataLoading(candles, input);

        expect(typeof result.initialCapital).toBe("number");
        expect(result.initialCapital).toBeGreaterThan(0);
    });
});
