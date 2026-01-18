/**
 * MIP-Map Candle Aggregation Functions
 *
 * @module simulation/mipmap/aggregation
 * @description
 * Core functions for aggregating OHLCV candles from finer to coarser resolutions.
 * Implements standard OHLCV aggregation rules:
 *   O = first.open
 *   H = max(all highs)
 *   L = min(all lows)
 *   C = last.close
 *   V = sum(all volumes)
 *
 * @audit-trail
 * - Created: 2026-01-09 (MIP-Map Implementation Phase 1)
 * - Purpose: Enable candle aggregation for multi-resolution MIP-map
 */

import type { Candle } from "../../core/types.ts";

// =============================================================================
// CORE AGGREGATION
// =============================================================================

/**
 * Aggregate candles from finer to coarser resolution.
 *
 * @param candles - Source candles at finer resolution
 * @param sourceResolution - Resolution of source candles in seconds
 * @param targetResolution - Target resolution in seconds (must be >= source)
 * @returns Aggregated candles at target resolution
 *
 * @throws Error if targetResolution < sourceResolution
 *
 * @example
 * ```typescript
 * // Aggregate 1-minute candles to 5-minute candles
 * const candles1m = [...]; // 60s resolution
 * const candles5m = aggregateCandles(candles1m, 60, 300);
 * ```
 */
export function aggregateCandles(
    candles: Candle[],
    sourceResolution: number,
    targetResolution: number
): Candle[] {
    if (targetResolution < sourceResolution) {
        throw new Error(
            `Cannot aggregate to finer resolution: ${targetResolution}s < ${sourceResolution}s`
        );
    }

    if (targetResolution === sourceResolution) {
        return candles;
    }

    if (candles.length === 0) {
        return [];
    }

    const result: Candle[] = [];
    const factor = calculateAggregationFactor(sourceResolution, targetResolution);

    for (let i = 0; i < candles.length; i += factor) {
        const group = candles.slice(i, i + factor);
        if (group.length === 0) break;

        const aggregated = aggregateCandleGroup(group, targetResolution);
        result.push(aggregated);
    }

    return result;
}

/**
 * Aggregate a group of candles into a single candle.
 * Applies standard OHLCV aggregation rules.
 *
 * @param group - Candles to aggregate (must not be empty)
 * @param targetResolution - Resolution for bucket alignment
 * @returns Single aggregated candle
 */
export function aggregateCandleGroup(group: Candle[], targetResolution: number): Candle {
    if (group.length === 0) {
        throw new Error("Cannot aggregate empty candle group");
    }

    const first = group[0]!;
    const last = group[group.length - 1]!;

    // Align bucket to target resolution
    const alignedBucket = alignBucketToResolution(first.bucket, targetResolution);

    // Use reduce instead of spread for consistency (though groups are typically small)
    let high = first.high;
    let low = first.low;
    let volume = 0;
    for (const c of group) {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
        volume += c.volume;
    }

    return {
        bucket: alignedBucket,
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
    };
}

// =============================================================================
// RESOLUTION HELPERS
// =============================================================================

/**
 * Calculate how many source candles make up one target candle.
 *
 * @param sourceResolution - Source resolution in seconds
 * @param targetResolution - Target resolution in seconds
 * @returns Number of source candles per target candle
 *
 * @example
 * calculateAggregationFactor(60, 300)  // 5 (1m → 5m)
 * calculateAggregationFactor(300, 3600) // 12 (5m → 1h)
 */
export function calculateAggregationFactor(sourceResolution: number, targetResolution: number): number {
    if (sourceResolution <= 0 || targetResolution <= 0) {
        throw new Error("Resolutions must be positive");
    }

    // Use ceiling to ensure we capture all data even with non-exact divisions
    return Math.ceil(targetResolution / sourceResolution);
}

/**
 * Align a timestamp to the start of a resolution bucket.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param resolution - Resolution in seconds
 * @returns Aligned timestamp (start of bucket)
 *
 * @example
 * alignBucketToResolution(125, 60)   // 120 (aligns to 2-minute mark)
 * alignBucketToResolution(3700, 3600) // 3600 (aligns to 1-hour mark)
 */
export function alignBucketToResolution(timestamp: number, resolution: number): number {
    return Math.floor(timestamp / resolution) * resolution;
}

/**
 * Check if target resolution is cleanly divisible by source resolution.
 * Clean divisions are preferred as they produce exact aggregation.
 *
 * @param sourceResolution - Source resolution in seconds
 * @param targetResolution - Target resolution in seconds
 * @returns True if target is cleanly divisible by source
 *
 * @example
 * isCleanAggregation(60, 300)   // true (5x)
 * isCleanAggregation(60, 3600)  // true (60x)
 * isCleanAggregation(60, 350)   // false (5.83x)
 */
export function isCleanAggregation(sourceResolution: number, targetResolution: number): boolean {
    return targetResolution % sourceResolution === 0;
}

/**
 * Get the expected output candle count after aggregation.
 *
 * @param sourceCandleCount - Number of source candles
 * @param aggregationFactor - Candles per aggregated output
 * @returns Expected number of output candles
 */
export function expectedAggregatedCount(sourceCandleCount: number, aggregationFactor: number): number {
    return Math.ceil(sourceCandleCount / aggregationFactor);
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate that candles are suitable for aggregation.
 * Checks for chronological order and consistent resolution.
 *
 * @param candles - Candles to validate
 * @param expectedResolution - Expected resolution in seconds
 * @returns Validation result with any issues found
 */
export function validateCandlesForAggregation(
    candles: Candle[],
    expectedResolution: number
): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (candles.length === 0) {
        return { valid: true, issues: [] };
    }

    // Check chronological order
    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1]!;
        const curr = candles[i]!;

        if (curr.bucket <= prev.bucket) {
            issues.push(`Candles not in chronological order at index ${i}: ${prev.bucket} >= ${curr.bucket}`);
        }
    }

    // Check consistent resolution (allowing some gaps)
    if (candles.length >= 2) {
        const observedResolution = candles[1]!.bucket - candles[0]!.bucket;
        if (observedResolution !== expectedResolution) {
            issues.push(
                `First candle gap (${observedResolution}s) doesn't match expected resolution (${expectedResolution}s)`
            );
        }
    }

    // Check OHLC validity
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i]!;
        if (c.high < c.low) {
            issues.push(`Invalid candle at index ${i}: high (${c.high}) < low (${c.low})`);
        }
        if (c.high < c.open || c.high < c.close) {
            issues.push(`Invalid candle at index ${i}: high (${c.high}) is not the highest price`);
        }
        if (c.low > c.open || c.low > c.close) {
            issues.push(`Invalid candle at index ${i}: low (${c.low}) is not the lowest price`);
        }
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

// =============================================================================
// PROGRESSIVE AGGREGATION
// =============================================================================

/**
 * Progressively aggregate from source to target through intermediate levels.
 * More efficient than direct aggregation for large jumps.
 *
 * @param candles - Source candles
 * @param sourceResolution - Source resolution in seconds
 * @param targetResolution - Target resolution in seconds
 * @param availableIntermediates - Available intermediate resolutions (sorted ascending)
 * @returns Aggregated candles and the path taken
 *
 * @example
 * ```typescript
 * // Aggregate 15s to 1h through intermediate levels
 * const result = progressiveAggregate(candles, 15, 3600, [60, 300, 900]);
 * // May aggregate: 15s → 60s → 300s → 3600s
 * ```
 */
export function progressiveAggregate(
    candles: Candle[],
    sourceResolution: number,
    targetResolution: number,
    availableIntermediates: number[]
): { candles: Candle[]; path: number[] } {
    if (targetResolution <= sourceResolution) {
        return { candles, path: [sourceResolution] };
    }

    // Build the aggregation path
    const path: number[] = [sourceResolution];
    let currentRes = sourceResolution;
    let currentCandles = candles;

    // Find intermediate steps
    const sortedIntermediates = [...availableIntermediates].sort((a, b) => a - b);

    for (const intermediate of sortedIntermediates) {
        if (intermediate > currentRes && intermediate < targetResolution) {
            currentCandles = aggregateCandles(currentCandles, currentRes, intermediate);
            path.push(intermediate);
            currentRes = intermediate;
        }
    }

    // Final step to target
    if (currentRes < targetResolution) {
        currentCandles = aggregateCandles(currentCandles, currentRes, targetResolution);
        path.push(targetResolution);
    }

    return { candles: currentCandles, path };
}
