/** MIP-Map Candle Aggregation Types - Multi-resolution candle pyramid for efficient indicator calculation. */

import type { Candle } from "../../core/types.ts";

export interface MipMapLevel {
    resolution: number;                // Resolution in seconds (e.g., 60 for 1m candles)
    candles: Candle[];                 // Candles at this resolution
    startTime: number;                 // Timestamp of first candle
    endTime: number;                   // Timestamp of last candle
    aggregationFactor: number;         // Source candles per aggregated candle (1 for base level)
}

export interface CandleMipMap {
    baseResolution: number;            // Finest resolution in the map (base of pyramid)
    levels: Map<number, MipMapLevel>;  // Map from resolution (seconds) to MipMapLevel
    requestedResolutions: number[];    // Resolutions explicitly requested by indicators
    symbol: string;                    // Symbol this MIP-map was built for
}

export interface MipMapBuildResult {
    mipMap: CandleMipMap;              // The constructed MIP-map
    baseResolution: number;            // Base resolution used (finest level)
    minIndicatorResolution: number;    // Minimum resolution required by any indicator
    resolutionsBuilt: number[];        // All resolutions built (sorted ascending)
    stats: MipMapBuildStats;           // Build statistics
}

export interface MipMapBuildStats {
    sourceCandles: number;             // Number of candles in source data
    levelsBuilt: number;               // Number of resolution levels built
    totalCandles: number;              // Total candles across all levels
    overheadPct: number;               // Memory overhead: ((total/source) - 1) * 100, expected ~33%
    buildTimeMs: number;               // Time taken to build in milliseconds
}

export interface MipMapBuildOptions {
    includeStandardResolutions?: boolean;  // Include standard resolutions even if not requested (default: false)
    forceBaseResolution?: number;          // Force specific base resolution (use with caution)
    validateCandles?: boolean;             // Validate candle data during build (default: true)
}

export interface ResolutionLookup {
    requestedResolution: number;       // Resolution that was requested
    actualResolution: number;          // Resolution actually used (may differ if no exact match)
    exactMatch: boolean;               // Whether exact match was found
    candleCount: number;               // Number of candles at this resolution
}
