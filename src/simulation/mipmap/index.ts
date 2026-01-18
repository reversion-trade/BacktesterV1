/**
 * MIP-Map Candle Aggregation Module
 *
 * @module simulation/mipmap
 * @description
 * Multi-resolution candle aggregation for efficient indicator calculation.
 * Pre-aggregates candles to multiple resolutions BEFORE indicator calculation,
 * ensuring each indicator receives data at its native resolution.
 *
 * @example
 * ```typescript
 * import {
 *   buildCandleMipMap,
 *   getCandlesAtResolution,
 *   formatMipMapSummary,
 * } from "./mipmap/index.ts";
 *
 * // Build MIP-map from source candles
 * const result = buildCandleMipMap(candles, 60, indicatorConfigs);
 * console.log(formatMipMapSummary(result));
 *
 * // Get candles at specific resolution for indicator calculation
 * const candles5m = getCandlesAtResolution(result.mipMap, 300);
 * ```
 *
 * @audit-trail
 * - Created: 2026-01-09 (MIP-Map Implementation Phase 1)
 * - Purpose: Correct multi-resolution candle aggregation
 */

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type {
    // Core types
    MipMapLevel,
    CandleMipMap,

    // Build types
    MipMapBuildResult,
    MipMapBuildStats,
    MipMapBuildingInput,
    MipMapBuildingResult,

    // Utility types
    MipMapBuildOptions,
    ResolutionLookup,
    StandardResolution,
} from "./types.ts";

export { STANDARD_RESOLUTIONS } from "./types.ts";

// =============================================================================
// AGGREGATION EXPORTS
// =============================================================================

export {
    // Core aggregation
    aggregateCandles,
    aggregateCandleGroup,

    // Resolution helpers
    calculateAggregationFactor,
    alignBucketToResolution,
    isCleanAggregation,
    expectedAggregatedCount,

    // Validation
    validateCandlesForAggregation,

    // Progressive aggregation
    progressiveAggregate,
} from "./aggregation.ts";

// =============================================================================
// BUILDER EXPORTS
// =============================================================================

export {
    // Resolution collection
    collectRequiredResolutions,
    determineBaseResolution,

    // Main builder
    buildCandleMipMap,

    // MIP-map access
    getCandlesAtResolution,
    lookupResolution,
    hasResolution,
    getAvailableResolutions,

    // Debug utilities
    formatMipMapSummary,
} from "./builder.ts";
