/**
 * MIP-Map Candle Aggregation Types
 *
 * @module simulation/mipmap/types
 * @description
 * Type definitions for multi-resolution candle aggregation.
 * MIP-mapping pre-aggregates candles to multiple resolutions BEFORE
 * indicator calculation, ensuring each indicator gets data at its
 * native resolution.
 *
 * @architecture
 * Borrowed from graphics (mipmapping): build a pyramid of progressively
 * coarser data. Each level is aggregated from the level below.
 *
 * Base candles (60s) → Aggregate → 300s → Aggregate → 3600s → ...
 *                           ↓           ↓              ↓
 *                     Store all in MIP-map (Map<resolution, Candle[]>)
 *
 * @audit-trail
 * - Created: 2026-01-09 (MIP-Map Implementation Phase 1)
 * - Purpose: Enable correct multi-resolution indicator calculation
 * - Prerequisite for event-driven simulation model
 */

import type { Candle } from "../../core/types.ts";
import type { IndicatorConfig } from "../../core/types.ts";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Standard candle resolutions in seconds.
 * Aligned with common trading timeframes and indicator requirements.
 *
 * 15s, 1m, 5m, 15m, 1h, 4h, 1d
 */
export const STANDARD_RESOLUTIONS = [15, 60, 300, 900, 3600, 14400, 86400] as const;

/**
 * Type for standard resolution values.
 */
export type StandardResolution = (typeof STANDARD_RESOLUTIONS)[number];

// =============================================================================
// CORE TYPES
// =============================================================================

/**
 * A single level in the MIP-map pyramid.
 * Contains all candles at a specific resolution.
 */
export interface MipMapLevel {
    /** Resolution in seconds (e.g., 60 for 1-minute candles) */
    resolution: number;

    /** Candles at this resolution */
    candles: Candle[];

    /** Timestamp of first candle (bucket) */
    startTime: number;

    /** Timestamp of last candle (bucket) */
    endTime: number;

    /**
     * How many source candles were aggregated into each candle at this level.
     * For base level, this is 1. For 5m from 1m, this is 5.
     */
    aggregationFactor: number;
}

/**
 * Complete MIP-map containing all resolution levels.
 * The pyramid structure for efficient multi-resolution access.
 */
export interface CandleMipMap {
    /** The finest resolution in the map (base of pyramid) */
    baseResolution: number;

    /** Map from resolution (seconds) to MipMapLevel */
    levels: Map<number, MipMapLevel>;

    /** Resolutions that were explicitly requested by indicators */
    requestedResolutions: number[];

    /** Symbol this MIP-map was built for */
    symbol: string;
}

// =============================================================================
// BUILD TYPES
// =============================================================================

/**
 * Result of building a MIP-map from source candles.
 */
export interface MipMapBuildResult {
    /** The constructed MIP-map */
    mipMap: CandleMipMap;

    /** Base resolution that was used (finest level) */
    baseResolution: number;

    /** Minimum resolution required by any indicator */
    minIndicatorResolution: number;

    /** All resolutions that were built (sorted ascending) */
    resolutionsBuilt: number[];

    /** Build statistics */
    stats: MipMapBuildStats;
}

/**
 * Statistics from building a MIP-map.
 * Useful for debugging and performance monitoring.
 */
export interface MipMapBuildStats {
    /** Number of candles in the source data */
    sourceCandles: number;

    /** Number of resolution levels built */
    levelsBuilt: number;

    /** Total candles across all levels */
    totalCandles: number;

    /**
     * Memory overhead percentage.
     * Formula: ((totalCandles / sourceCandles) - 1) * 100
     * Expected: ~33% for typical MIP-map
     */
    overheadPct: number;

    /** Time taken to build in milliseconds */
    buildTimeMs: number;
}

// =============================================================================
// STAGE INPUT/OUTPUT TYPES
// =============================================================================

/**
 * Input for Stage 1.1: MIP-Map Building.
 * Comes after data loading (Stage 1) and before indicator calculation.
 */
export interface MipMapBuildingInput {
    /** Source candles from data loading stage */
    candles: Candle[];

    /** Resolution of the source candles in seconds */
    candleResolution: number;

    /** All indicator configs that need resolution data */
    indicatorConfigs: IndicatorConfig[];

    /** Symbol for identification */
    symbol: string;
}

/**
 * Result of Stage 1.1: MIP-Map Building.
 */
export interface MipMapBuildingResult {
    /** The constructed MIP-map */
    mipMap: CandleMipMap;

    /** Base resolution (finest level) */
    baseResolution: number;

    /** All resolutions available in the map */
    resolutions: number[];

    /** Build statistics */
    stats: MipMapBuildStats;

    /** Any warnings generated during building */
    warnings: string[];
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Options for MIP-map building behavior.
 */
export interface MipMapBuildOptions {
    /**
     * Whether to include standard resolutions even if not requested.
     * Defaults to false (only build what's needed).
     */
    includeStandardResolutions?: boolean;

    /**
     * Force a specific base resolution instead of auto-detecting.
     * Use with caution - may result in lower precision than needed.
     */
    forceBaseResolution?: number;

    /**
     * Whether to validate candle data during build.
     * Defaults to true.
     */
    validateCandles?: boolean;
}

/**
 * Information about a resolution lookup in the MIP-map.
 */
export interface ResolutionLookup {
    /** The resolution that was requested */
    requestedResolution: number;

    /** The resolution that was actually used (may differ if exact match not available) */
    actualResolution: number;

    /** Whether exact match was found */
    exactMatch: boolean;

    /** Number of candles at this resolution */
    candleCount: number;
}
