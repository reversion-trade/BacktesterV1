/**
 * ValueFactor Calculation Module
 *
 * @module simulation/valuefactor-calculation
 * @description
 * Calculates valueFactor indicators for dynamic SL/TP.
 * Used when SL/TP has type: "DYN" with a valueFactor indicator.
 *
 * IMPORTANT: Only indicators with the "Normalized" tag (0-100 output range)
 * are supported as valueFactor indicators. The library tags are the source
 * of truth - use getSupportedIndicators() to get the current list.
 *
 * @audit-trail
 * - Created: 2026-01-08 (Phase 6: Dynamic SL/TP ValueFactor)
 * - Updated: 2026-01-09 (Simplified to rely on library tags after ATR fix)
 * - Purpose: Calculate valueFactor indicators at sub-bar granularity
 */

import type { Candle, IndicatorConfig } from "../core/types.ts";
import { makeIndicator } from "@indicators/factory.ts";
import { IndicatorsRegistry } from "@indicators/factory.ts";
import { createChartPointsForSource } from "@indicators/conversions.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result for a single valueFactor calculation at a specific timestamp.
 */
export interface ValueFactorResult {
    /** Timestamp of this calculation (sub-bar bucket) */
    timestamp: number;

    /** Indicator value (already in 0-100 range for normalized indicators) */
    rawValue: number;

    /** Same as rawValue for normalized indicators (0-100 scale) */
    normalizedValue: number;
}

/**
 * Complete result of valueFactor pre-calculation.
 */
export interface ValueFactorCalculationResult {
    /** Map from timestamp to value factor result */
    valueFactorMap: Map<number, ValueFactorResult>;

    /** Always true for supported indicators (only normalized indicators allowed) */
    isNormalized: boolean;

    /** Indicator name for debugging */
    indicatorName: string;

    /** Warmup candles required by this indicator */
    warmupCandles: number;

    /** Error message if indicator is not supported */
    error?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// No hardcoded indicator lists needed - we now rely on the library's "Normalized" tag
// which has been verified to only be present on truly normalized indicators (0-100 output)

// =============================================================================
// MAIN CALCULATION FUNCTION
// =============================================================================

/**
 * Pre-calculate valueFactor indicator values for all sub-bar candles.
 *
 * IMPORTANT: Only normalized indicators (RSI, StochRSI, MFI, UO, Stochastic)
 * are supported. Non-normalized indicators will return an error result.
 *
 * @param indicatorConfig - The indicator configuration from ValueConfig.valueFactor
 * @param subBarCandles - All sub-bar candles (flattened from the Map)
 * @returns ValueFactorCalculationResult with values (or error if unsupported)
 *
 * @example
 * ```typescript
 * // For RSI-based dynamic SL:
 * const result = calculateValueFactors(
 *   { type: "RSI", params: { period: 14, source: "close" } },
 *   allSubBarCandles
 * );
 *
 * // Get value at entry:
 * const entryFactor = result.valueFactorMap.get(entryTimestamp)?.normalizedValue;
 * // Returns 0-100 directly from RSI
 * ```
 */
export function calculateValueFactors(
    indicatorConfig: IndicatorConfig,
    subBarCandles: Candle[]
): ValueFactorCalculationResult {
    const indicatorName = indicatorConfig.type;

    // Check if indicator is supported (must have "Normalized" tag = 0-100 output)
    if (!isIndicatorSupported(indicatorName)) {
        const supportedList = getSupportedIndicators().join(", ");
        return {
            valueFactorMap: new Map(),
            isNormalized: false,
            indicatorName,
            warmupCandles: 0,
            error: `Indicator "${indicatorName}" is not supported as valueFactor. ` +
                   `Only normalized indicators (0-100 output) are allowed: ${supportedList}. ` +
                   `Non-normalized indicators cannot be used because they don't output 0-100 range values.`,
        };
    }

    if (subBarCandles.length === 0) {
        return {
            valueFactorMap: new Map(),
            isNormalized: true,
            indicatorName,
            warmupCandles: 0,
        };
    }

    // Create indicator instance
    const indicator = makeIndicator(indicatorConfig);

    // Get warmup requirements
    const requirements = indicator.getPointRequirements();
    const warmupCandles = requirements.count;

    // Convert candles to chart points
    const source = indicator.params.source || "close";
    const chartPoints = createChartPointsForSource(subBarCandles, source, requirements.resolution);

    // Calculate indicator values
    const results = indicator.calculate(chartPoints);

    // Extract values (results are shorter than candles due to warmup)
    const offset = subBarCandles.length - results.length;

    // Build the value factor map
    const valueFactorMap = new Map<number, ValueFactorResult>();

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result && typeof result.value === "number") {
            const timestamp = subBarCandles[offset + i]!.bucket;
            const value = clamp(result.value, 0, 100); // Clamp to be safe

            valueFactorMap.set(timestamp, {
                timestamp,
                rawValue: result.value,
                normalizedValue: value,
            });
        }
    }

    return {
        valueFactorMap,
        isNormalized: true,
        indicatorName,
        warmupCandles,
    };
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Check if an indicator is supported as a valueFactor.
 *
 * Only indicators with the "Normalized" tag (0-100 output) are supported.
 * The library tags have been verified to be accurate.
 *
 * @param indicatorName - The indicator type name (e.g., "RSI", "ATR")
 * @returns true if indicator can be used as valueFactor
 */
export function isIndicatorSupported(indicatorName: string): boolean {
    const metadata = IndicatorsRegistry[indicatorName as keyof typeof IndicatorsRegistry];
    if (metadata && "tags" in metadata) {
        const tags = metadata.tags as readonly string[];
        return tags.includes("Normalized");
    }
    return false;
}

/**
 * Get list of supported valueFactor indicators.
 * Dynamically reads from the registry based on "Normalized" tag.
 */
export function getSupportedIndicators(): string[] {
    const supported: string[] = [];
    for (const [name, metadata] of Object.entries(IndicatorsRegistry)) {
        if ("tags" in metadata) {
            const tags = metadata.tags as readonly string[];
            if (tags.includes("Normalized")) {
                supported.push(name);
            }
        }
    }
    return supported;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Get the closest value factor result for a given timestamp.
 *
 * Useful when exact timestamp isn't in the map (e.g., checkpoint between candles).
 *
 * @param valueFactorMap - The pre-calculated value factor map
 * @param targetTimestamp - The timestamp to look up
 * @returns The closest ValueFactorResult or undefined
 */
export function getClosestValueFactor(
    valueFactorMap: Map<number, ValueFactorResult>,
    targetTimestamp: number
): ValueFactorResult | undefined {
    // First try exact match
    const exact = valueFactorMap.get(targetTimestamp);
    if (exact) {
        return exact;
    }

    // Find the closest timestamp that is <= target
    let closestTimestamp: number | undefined;
    let closestResult: ValueFactorResult | undefined;

    for (const [timestamp, result] of valueFactorMap) {
        if (timestamp <= targetTimestamp) {
            if (closestTimestamp === undefined || timestamp > closestTimestamp) {
                closestTimestamp = timestamp;
                closestResult = result;
            }
        }
    }

    return closestResult;
}

/**
 * Create a lookup function for value factors.
 *
 * Returns a function that efficiently looks up normalized values by timestamp.
 *
 * @param result - The calculation result
 * @returns Lookup function
 */
export function createValueFactorLookup(
    result: ValueFactorCalculationResult
): (timestamp: number) => number | undefined {
    return (timestamp: number) => {
        const vf = getClosestValueFactor(result.valueFactorMap, timestamp);
        return vf?.normalizedValue;
    };
}
