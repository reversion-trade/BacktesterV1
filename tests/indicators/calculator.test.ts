/**
 * Tests for Indicator Calculator Functions
 *
 * Tests the MIP-map aware indicator calculation.
 */

import { describe, expect, test } from "bun:test";
import {
    calculateIndicatorsWithMipMap,
    collectIndicatorConfigs,
} from "../../src/indicators/calculator.ts";
import { buildCandleMipMap } from "../../src/simulation/mipmap/index.ts";
import type { Candle, IndicatorConfig, AlgoParams } from "../../src/core/types.ts";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createCandle(bucket: number, close: number = 100): Candle {
    return {
        bucket,
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
        volume: 100,
    };
}

function create1mCandles(count: number, startBucket = 0): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < count; i++) {
        candles.push(createCandle(startBucket + i * 60, 100 + i * 0.1));
    }
    return candles;
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
// collectIndicatorConfigs
// =============================================================================

describe("collectIndicatorConfigs", () => {
    test("returns empty array for no indicators", () => {
        const params = createMinimalAlgoParams();
        const configs = collectIndicatorConfigs(params);
        expect(configs).toEqual([]);
    });

    test("collects from longEntry required", () => {
        const indicator: IndicatorConfig = {
            type: "EMA",
            params: { period: 60, signal: "point_above_value", source: "1_close" },
        };
        const params = createMinimalAlgoParams({
            longEntry: { required: [indicator], optional: [] },
        });

        const configs = collectIndicatorConfigs(params);

        expect(configs.length).toBe(1);
        expect(configs[0]).toEqual(indicator);
    });

    test("collects from multiple conditions", () => {
        const ema1: IndicatorConfig = {
            type: "EMA",
            params: { period: 60, signal: "point_above_value", source: "1_close" },
        };
        const ema2: IndicatorConfig = {
            type: "EMA",
            params: { period: 120, signal: "point_below_value", source: "1_close" },
        };

        const params = createMinimalAlgoParams({
            longEntry: { required: [ema1], optional: [] },
            longExit: { required: [ema2], optional: [] },
        });

        const configs = collectIndicatorConfigs(params);

        expect(configs.length).toBe(2);
    });
});

// =============================================================================
// calculateIndicatorsWithMipMap
// =============================================================================

describe("calculateIndicatorsWithMipMap", () => {
    test("returns empty result for empty MIP-map", () => {
        const result = buildCandleMipMap([], 60, []);

        const calcResult = calculateIndicatorsWithMipMap(result.mipMap, []);

        expect(calcResult.warmupCandles).toBe(0);
        expect(calcResult.signals.keys()).toEqual([]);
    });

    test("returns empty result for no configs", () => {
        const candles = create1mCandles(120);
        const result = buildCandleMipMap(candles, 60, []);

        const calcResult = calculateIndicatorsWithMipMap(result.mipMap, []);

        expect(calcResult.warmupCandles).toBe(0);
        expect(calcResult.signals.keys()).toEqual([]);
    });

    test("calculates single indicator", () => {
        const candles = create1mCandles(200);
        const config: IndicatorConfig = {
            type: "EMA",
            params: { period: 60, signal: "point_above_value", source: "1_close" },
        };

        // Build MIP-map with the indicator config
        const mipMapResult = buildCandleMipMap(candles, 60, [config]);

        const calcResult = calculateIndicatorsWithMipMap(mipMapResult.mipMap, [config]);

        // Should have calculated the indicator
        expect(calcResult.signals.keys().length).toBe(1);
        expect(calcResult.warmupCandles).toBeGreaterThan(0);
    });

    test("deduplicates identical configs", () => {
        const candles = create1mCandles(200);
        const config: IndicatorConfig = {
            type: "EMA",
            params: { period: 60, signal: "point_above_value", source: "1_close" },
        };

        const mipMapResult = buildCandleMipMap(candles, 60, [config, config]);

        // Pass same config twice
        const calcResult = calculateIndicatorsWithMipMap(mipMapResult.mipMap, [config, config]);

        // Should only calculate once (deduplicated by cache key)
        expect(calcResult.signals.keys().length).toBe(1);
    });

    test("calculates multiple different indicators", () => {
        const candles = create1mCandles(200);
        const ema1: IndicatorConfig = {
            type: "EMA",
            params: { period: 60, signal: "point_above_value", source: "1_close" },
        };
        const ema2: IndicatorConfig = {
            type: "EMA",
            params: { period: 120, signal: "point_below_value", source: "1_close" },
        };

        const mipMapResult = buildCandleMipMap(candles, 60, [ema1, ema2]);

        const calcResult = calculateIndicatorsWithMipMap(mipMapResult.mipMap, [ema1, ema2]);

        // Should have both indicators
        expect(calcResult.signals.keys().length).toBe(2);
    });

    test("signals array has correct length", () => {
        const candles = create1mCandles(200);
        const config: IndicatorConfig = {
            type: "EMA",
            params: { period: 60, signal: "point_above_value", source: "1_close" },
        };

        const mipMapResult = buildCandleMipMap(candles, 60, [config]);
        const calcResult = calculateIndicatorsWithMipMap(mipMapResult.mipMap, [config]);

        // Get the signals array
        const key = calcResult.signals.keys()[0]!;
        const signals = calcResult.signals.get(key);

        expect(signals).toBeDefined();
        // Signals array length should match the candles at the indicator's resolution
        expect(signals!.length).toBeGreaterThan(0);
    });

    test("warmup is tracked correctly", () => {
        const candles = create1mCandles(200);
        const shortPeriod: IndicatorConfig = {
            type: "EMA",
            params: { period: 60, signal: "point_above_value", source: "1_close" },
        };
        const longPeriod: IndicatorConfig = {
            type: "EMA",
            params: { period: 120, signal: "point_above_value", source: "1_close" },
        };

        const mipMapResult = buildCandleMipMap(candles, 60, [shortPeriod, longPeriod]);

        const calcResult = calculateIndicatorsWithMipMap(mipMapResult.mipMap, [shortPeriod, longPeriod]);

        // Warmup should be positive (some warmup required for EMAs)
        expect(calcResult.warmupCandles).toBeGreaterThan(0);
    });
});
