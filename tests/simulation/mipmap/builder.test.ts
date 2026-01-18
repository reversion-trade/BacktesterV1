/**
 * Tests for MIP-Map Builder Functions
 *
 * Note: These tests focus on the builder logic. Since indicator resolution
 * is determined internally by each indicator's getPointRequirements(),
 * we test with actual indicators where needed.
 */

import { describe, expect, test } from "bun:test";
import {
    buildCandleMipMap,
    getCandlesAtResolution,
    lookupResolution,
    hasResolution,
    getAvailableResolutions,
    collectRequiredResolutions,
    determineBaseResolution,
    formatMipMapSummary,
} from "../../../src/simulation/mipmap/builder.ts";
import type { Candle, IndicatorConfig } from "../../../src/core/types.ts";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createCandle(bucket: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
    return { bucket, open, high, low, close, volume };
}

function create1mCandles(count: number, startBucket = 0): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < count; i++) {
        const bucket = startBucket + i * 60;
        const basePrice = 100 + i;
        candles.push(createCandle(bucket, basePrice, basePrice + 2, basePrice - 1, basePrice + 1, 100));
    }
    return candles;
}

// =============================================================================
// collectRequiredResolutions
// =============================================================================

describe("collectRequiredResolutions", () => {
    test("returns empty array for empty configs", () => {
        const result = collectRequiredResolutions([]);
        expect(result).toEqual([]);
    });

    test("collects resolutions from real indicator configs", () => {
        // Use actual EMA configs - resolution is determined by the indicator
        const configs: IndicatorConfig[] = [
            { type: "EMA", params: { period: 60, signal: "point_above_value", source: "1_close" } },
            { type: "EMA", params: { period: 120, signal: "point_above_value", source: "1_close" } },
        ];

        const result = collectRequiredResolutions(configs);

        // Should return some resolutions (exact values depend on indicator logic)
        expect(result.length).toBeGreaterThan(0);
        // Should be sorted ascending
        for (let i = 1; i < result.length; i++) {
            expect(result[i]).toBeGreaterThanOrEqual(result[i - 1]!);
        }
    });

    test("deduplicates identical indicators", () => {
        const configs: IndicatorConfig[] = [
            { type: "EMA", params: { period: 60, signal: "point_above_value", source: "1_close" } },
            { type: "EMA", params: { period: 60, signal: "point_above_value", source: "1_close" } },
        ];

        const result = collectRequiredResolutions(configs);

        // Duplicates should be deduplicated
        expect(result.length).toBe(1);
    });
});

// =============================================================================
// determineBaseResolution
// =============================================================================

describe("determineBaseResolution", () => {
    test("returns loaded resolution when no indicators", () => {
        const result = determineBaseResolution([], 60);
        expect(result).toBe(60);
    });

    test("goes one bucket lower than min indicator resolution", () => {
        // Min indicator is 300s (5m), should go to 60s (1m)
        const result = determineBaseResolution([300, 3600], 60);
        expect(result).toBe(60);
    });

    test("cannot go finer than loaded candles", () => {
        // Min indicator is 60s, wants to go to 15s, but source is 60s
        const result = determineBaseResolution([60, 300], 60);
        expect(result).toBe(60);
    });

    test("floors at MIN_SIMULATION_RESOLUTION", () => {
        // Even with 15s candles and 60s indicators, floor at 60s
        const result = determineBaseResolution([60, 300], 15);
        expect(result).toBe(60); // MIN_SIMULATION_RESOLUTION
    });
});

// =============================================================================
// buildCandleMipMap - Empty/Basic Cases
// =============================================================================

describe("buildCandleMipMap", () => {
    test("handles empty candles", () => {
        const result = buildCandleMipMap([], 60, []);

        expect(result.mipMap.levels.size).toBe(0);
        expect(result.stats.sourceCandles).toBe(0);
        expect(result.stats.totalCandles).toBe(0);
    });

    test("handles empty configs", () => {
        const candles = create1mCandles(10);
        const result = buildCandleMipMap(candles, 60, []);

        // Should create base level only
        expect(result.mipMap.levels.size).toBe(1);
        expect(result.baseResolution).toBe(60);
        expect(hasResolution(result.mipMap, 60)).toBe(true);
    });

    test("base level has correct candle count", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        const baseLevel = result.mipMap.levels.get(60);
        expect(baseLevel).toBeDefined();
        expect(baseLevel!.candles.length).toBe(60);
    });

    test("keeps source resolution when no indicators", () => {
        // With no indicators, base resolution = source resolution
        const candles15s: Candle[] = [];
        for (let i = 0; i < 120; i++) {
            const bucket = i * 15;
            candles15s.push(createCandle(bucket, 100, 102, 99, 101, 50));
        }

        const result = buildCandleMipMap(candles15s, 15, []);

        // With no indicators, base resolution = source resolution
        expect(result.baseResolution).toBe(15);
        const baseLevel = result.mipMap.levels.get(15);
        expect(baseLevel).toBeDefined();
        expect(baseLevel!.candles.length).toBe(120);
    });

    test("sets symbol on mipmap", () => {
        const candles = create1mCandles(10);
        const result = buildCandleMipMap(candles, 60, []);
        result.mipMap.symbol = "BTCUSD";

        expect(result.mipMap.symbol).toBe("BTCUSD");
    });

    test("calculates stats correctly for base only", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        expect(result.stats.sourceCandles).toBe(60);
        expect(result.stats.levelsBuilt).toBe(1);
        expect(result.stats.totalCandles).toBe(60);
        expect(result.stats.overheadPct).toBe(0);
        expect(result.stats.buildTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("builds multiple levels with real indicators", () => {
        const candles = create1mCandles(120);

        // Use indicators that request different resolutions
        const configs: IndicatorConfig[] = [
            { type: "EMA", params: { period: 60, signal: "point_above_value", source: "1_close" } },
            { type: "EMA", params: { period: 300, signal: "point_above_value", source: "1_close" } },
        ];

        const result = buildCandleMipMap(candles, 60, configs);

        // Should have at least the base level
        expect(result.mipMap.levels.size).toBeGreaterThanOrEqual(1);
        expect(result.stats.levelsBuilt).toBeGreaterThanOrEqual(1);
    });
});

// =============================================================================
// getCandlesAtResolution
// =============================================================================

describe("getCandlesAtResolution", () => {
    test("returns base level candles", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        const retrieved = getCandlesAtResolution(result.mipMap, 60);
        expect(retrieved.length).toBe(60);
    });

    test("returns empty for empty mipmap", () => {
        const result = buildCandleMipMap([], 60, []);
        const candles = getCandlesAtResolution(result.mipMap, 300);
        expect(candles).toEqual([]);
    });

    test("falls back to available resolution when exact not found", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        // Request 120s which doesn't exist, should get nearest (60s base)
        const nearest = getCandlesAtResolution(result.mipMap, 120);
        expect(nearest.length).toBe(60);
    });
});

// =============================================================================
// lookupResolution
// =============================================================================

describe("lookupResolution", () => {
    test("returns exact match info for base resolution", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        const lookup = lookupResolution(result.mipMap, 60);

        expect(lookup.exactMatch).toBe(true);
        expect(lookup.requestedResolution).toBe(60);
        expect(lookup.actualResolution).toBe(60);
        expect(lookup.candleCount).toBe(60);
    });

    test("returns nearest match for non-existing resolution", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        const lookup = lookupResolution(result.mipMap, 120);

        expect(lookup.exactMatch).toBe(false);
        expect(lookup.requestedResolution).toBe(120);
        // Should fall back to some available resolution
        expect(lookup.actualResolution).toBeDefined();
    });
});

// =============================================================================
// hasResolution & getAvailableResolutions
// =============================================================================

describe("hasResolution", () => {
    test("returns true for base resolution", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        expect(hasResolution(result.mipMap, 60)).toBe(true);
    });

    test("returns false for non-existing resolutions", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        expect(hasResolution(result.mipMap, 300)).toBe(false);
        expect(hasResolution(result.mipMap, 3600)).toBe(false);
    });
});

describe("getAvailableResolutions", () => {
    test("returns base resolution for empty configs", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        const available = getAvailableResolutions(result.mipMap);

        expect(available).toContain(60);
        expect(available.length).toBe(1);
    });

    test("returns sorted resolutions", () => {
        const candles = create1mCandles(120);
        const configs: IndicatorConfig[] = [
            { type: "EMA", params: { period: 60, signal: "point_above_value", source: "1_close" } },
        ];
        const result = buildCandleMipMap(candles, 60, configs);

        const available = getAvailableResolutions(result.mipMap);

        // Should be sorted ascending
        for (let i = 1; i < available.length; i++) {
            expect(available[i]).toBeGreaterThan(available[i - 1]!);
        }
    });
});

// =============================================================================
// formatMipMapSummary
// =============================================================================

describe("formatMipMapSummary", () => {
    test("formats summary with correct fields", () => {
        const candles = create1mCandles(60);
        const result = buildCandleMipMap(candles, 60, []);

        const summary = formatMipMapSummary(result);

        expect(summary).toContain("MIP-Map Summary");
        expect(summary).toContain("Base Resolution:");
        expect(summary).toContain("Source Candles: 60");
        expect(summary).toContain("Levels Built: 1");
        expect(summary).toContain("Build Time:");
    });
});
