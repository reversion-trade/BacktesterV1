/**
 * Tests for MIP-Map Candle Aggregation Functions
 */

import { describe, expect, test } from "bun:test";
import {
    aggregateCandles,
    aggregateCandleGroup,
    calculateAggregationFactor,
    alignBucketToResolution,
    isCleanAggregation,
    expectedAggregatedCount,
    validateCandlesForAggregation,
    progressiveAggregate,
} from "../../../src/simulation/mipmap/aggregation.ts";
import type { Candle } from "../../../src/core/types.ts";

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
// aggregateCandles
// =============================================================================

describe("aggregateCandles", () => {
    test("returns same candles if target equals source resolution", () => {
        const candles = create1mCandles(5);
        const result = aggregateCandles(candles, 60, 60);
        expect(result).toEqual(candles);
    });

    test("throws if target is finer than source", () => {
        const candles = create1mCandles(5);
        expect(() => aggregateCandles(candles, 300, 60)).toThrow("Cannot aggregate to finer resolution");
    });

    test("returns empty array for empty input", () => {
        const result = aggregateCandles([], 60, 300);
        expect(result).toEqual([]);
    });

    test("aggregates 1m to 5m correctly", () => {
        // 5 one-minute candles should become 1 five-minute candle
        const candles: Candle[] = [
            createCandle(0, 100, 105, 98, 102, 100),
            createCandle(60, 102, 107, 101, 104, 150),
            createCandle(120, 104, 110, 103, 108, 200),
            createCandle(180, 108, 112, 106, 110, 120),
            createCandle(240, 110, 115, 109, 113, 130),
        ];

        const result = aggregateCandles(candles, 60, 300);

        expect(result.length).toBe(1);
        const agg = result[0]!;

        // OHLCV rules:
        expect(agg.open).toBe(100);        // First candle's open
        expect(agg.high).toBe(115);        // Max of all highs
        expect(agg.low).toBe(98);          // Min of all lows
        expect(agg.close).toBe(113);       // Last candle's close
        expect(agg.volume).toBe(700);      // Sum of all volumes
        expect(agg.bucket).toBe(0);        // Aligned to 5m boundary
    });

    test("aggregates partial groups at the end", () => {
        // 7 one-minute candles → 2 five-minute candles (5 + 2)
        const candles = create1mCandles(7);
        const result = aggregateCandles(candles, 60, 300);

        expect(result.length).toBe(2);
    });

    test("handles single candle input", () => {
        const candles = [createCandle(0, 100, 105, 98, 102, 100)];
        const result = aggregateCandles(candles, 60, 300);

        expect(result.length).toBe(1);
        expect(result[0]!.open).toBe(100);
        expect(result[0]!.close).toBe(102);
    });

    test("aggregates 1m to 1h correctly", () => {
        // 60 one-minute candles → 1 one-hour candle
        const candles = create1mCandles(60);
        const result = aggregateCandles(candles, 60, 3600);

        expect(result.length).toBe(1);
        expect(result[0]!.volume).toBe(60 * 100); // 60 candles * 100 volume each
    });
});

// =============================================================================
// aggregateCandleGroup
// =============================================================================

describe("aggregateCandleGroup", () => {
    test("throws on empty group", () => {
        expect(() => aggregateCandleGroup([], 300)).toThrow("Cannot aggregate empty candle group");
    });

    test("correctly aggregates OHLCV", () => {
        const group: Candle[] = [
            createCandle(0, 100, 105, 95, 102, 100),
            createCandle(60, 102, 108, 100, 106, 200),
            createCandle(120, 106, 110, 104, 107, 150),
        ];

        const result = aggregateCandleGroup(group, 300);

        expect(result.open).toBe(100);     // First open
        expect(result.high).toBe(110);     // Max high
        expect(result.low).toBe(95);       // Min low
        expect(result.close).toBe(107);    // Last close
        expect(result.volume).toBe(450);   // Sum volumes
    });

    test("aligns bucket to target resolution", () => {
        const group = [createCandle(65, 100, 105, 95, 102, 100)]; // Not aligned to 60s
        const result = aggregateCandleGroup(group, 300);

        // 65 should align to 0 (floor(65/300)*300 = 0)
        expect(result.bucket).toBe(0);
    });
});

// =============================================================================
// calculateAggregationFactor
// =============================================================================

describe("calculateAggregationFactor", () => {
    test("calculates correct factor for clean divisions", () => {
        expect(calculateAggregationFactor(60, 300)).toBe(5);   // 1m → 5m
        expect(calculateAggregationFactor(60, 3600)).toBe(60); // 1m → 1h
        expect(calculateAggregationFactor(300, 3600)).toBe(12); // 5m → 1h
    });

    test("uses ceiling for non-clean divisions", () => {
        expect(calculateAggregationFactor(60, 350)).toBe(6);   // Ceil(350/60) = 6
    });

    test("throws on non-positive resolutions", () => {
        expect(() => calculateAggregationFactor(0, 300)).toThrow("Resolutions must be positive");
        expect(() => calculateAggregationFactor(60, 0)).toThrow("Resolutions must be positive");
        expect(() => calculateAggregationFactor(-60, 300)).toThrow("Resolutions must be positive");
    });
});

// =============================================================================
// alignBucketToResolution
// =============================================================================

describe("alignBucketToResolution", () => {
    test("aligns correctly", () => {
        expect(alignBucketToResolution(125, 60)).toBe(120);
        expect(alignBucketToResolution(3700, 3600)).toBe(3600);
        expect(alignBucketToResolution(0, 60)).toBe(0);
        expect(alignBucketToResolution(59, 60)).toBe(0);
        expect(alignBucketToResolution(60, 60)).toBe(60);
    });
});

// =============================================================================
// isCleanAggregation
// =============================================================================

describe("isCleanAggregation", () => {
    test("returns true for clean divisions", () => {
        expect(isCleanAggregation(60, 300)).toBe(true);   // 5x
        expect(isCleanAggregation(60, 3600)).toBe(true);  // 60x
        expect(isCleanAggregation(15, 60)).toBe(true);    // 4x
    });

    test("returns false for non-clean divisions", () => {
        expect(isCleanAggregation(60, 350)).toBe(false);
        expect(isCleanAggregation(60, 100)).toBe(false);
    });
});

// =============================================================================
// expectedAggregatedCount
// =============================================================================

describe("expectedAggregatedCount", () => {
    test("calculates correct output count", () => {
        expect(expectedAggregatedCount(60, 5)).toBe(12);  // 60/5 = 12
        expect(expectedAggregatedCount(61, 5)).toBe(13);  // Ceil(61/5) = 13
        expect(expectedAggregatedCount(7, 5)).toBe(2);    // Ceil(7/5) = 2
    });
});

// =============================================================================
// validateCandlesForAggregation
// =============================================================================

describe("validateCandlesForAggregation", () => {
    test("returns valid for empty array", () => {
        const result = validateCandlesForAggregation([], 60);
        expect(result.valid).toBe(true);
        expect(result.issues).toEqual([]);
    });

    test("returns valid for correct candles", () => {
        const candles = create1mCandles(5);
        const result = validateCandlesForAggregation(candles, 60);
        expect(result.valid).toBe(true);
    });

    test("detects non-chronological order", () => {
        const candles: Candle[] = [
            createCandle(120, 100, 105, 95, 102, 100),
            createCandle(60, 102, 108, 100, 106, 200), // Out of order!
        ];
        const result = validateCandlesForAggregation(candles, 60);
        expect(result.valid).toBe(false);
        expect(result.issues[0]).toContain("not in chronological order");
    });

    test("detects resolution mismatch", () => {
        const candles: Candle[] = [
            createCandle(0, 100, 105, 95, 102, 100),
            createCandle(300, 102, 108, 100, 106, 200), // 5m gap instead of 1m
        ];
        const result = validateCandlesForAggregation(candles, 60);
        expect(result.valid).toBe(false);
        expect(result.issues[0]).toContain("doesn't match expected resolution");
    });

    test("detects invalid OHLC (high < low)", () => {
        const candles: Candle[] = [
            createCandle(0, 100, 95, 105, 102, 100), // high < low!
        ];
        const result = validateCandlesForAggregation(candles, 60);
        expect(result.valid).toBe(false);
        expect(result.issues[0]).toContain("high");
    });
});

// =============================================================================
// progressiveAggregate
// =============================================================================

describe("progressiveAggregate", () => {
    test("returns input if target <= source", () => {
        const candles = create1mCandles(5);
        const result = progressiveAggregate(candles, 60, 60, [300, 3600]);
        expect(result.candles).toEqual(candles);
        expect(result.path).toEqual([60]);
    });

    test("aggregates directly if no intermediates apply", () => {
        const candles = create1mCandles(10);
        const result = progressiveAggregate(candles, 60, 300, [3600]); // 3600 > 300, doesn't help
        expect(result.path).toEqual([60, 300]);
        expect(result.candles.length).toBe(2); // 10 1m → 2 5m
    });

    test("uses intermediate levels when beneficial", () => {
        // 60 1m candles → via 300 → 3600
        const candles = create1mCandles(60);
        const result = progressiveAggregate(candles, 60, 3600, [300, 900]);

        // Path should include intermediate steps
        expect(result.path).toContain(60);
        expect(result.path).toContain(300);
        expect(result.path).toContain(900);
        expect(result.path).toContain(3600);

        expect(result.candles.length).toBe(1); // 60 1m → 1 1h
    });
});
