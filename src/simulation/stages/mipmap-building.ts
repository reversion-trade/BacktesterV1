/**
 * Stage 1.5: MIP-Map Building
 *
 * @module simulation/stages/mipmap-building
 * @description
 * Builds multi-resolution candle pyramid for efficient indicator calculation.
 * This stage sits between Data Loading (Stage 1) and Indicator Calculation (Stage 2).
 *
 * @architecture
 * MIP-mapping pre-aggregates candles to multiple resolutions BEFORE indicator
 * calculation, ensuring each indicator receives data at its native resolution.
 *
 * Input: Filtered candles from Stage 1 + indicator configs from algo params
 * Output: CandleMipMap ready for Stage 2 indicator calculation
 *
 * @performance
 * - Memory overhead: ~33% for typical MIP-map (acceptable)
 * - Build time: O(n * log(resolutions)) where n = candle count
 * - Enables correct multi-resolution indicator calculation
 *
 * @audit-trail
 * - Created: 2026-01-09 (MIP-Map Implementation Phase 2)
 * - Purpose: Pre-aggregate candles for correct indicator resolution handling
 * - Prerequisite for event-driven simulation model
 */

import type { Candle, AlgoParams, IndicatorConfig } from "../../core/types.ts";
import { collectIndicatorConfigs } from "../../indicators/calculator.ts";
import {
    buildCandleMipMap,
    type CandleMipMap,
    type MipMapBuildStats,
    type MipMapBuildOptions,
} from "../mipmap/index.ts";
import type { DataLoadingResult } from "./data-loading.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for Stage 1.5: MIP-Map Building
 *
 * Can be constructed from Stage 1 result or manually for testing.
 */
export interface MipMapBuildingInput {
    /** Candles from Stage 1 (filtered to time range) */
    candles: Candle[];

    /** Resolution of source candles in seconds */
    candleResolution: number;

    /** Algorithm parameters containing indicator configs */
    algoParams: AlgoParams;

    /** Symbol for identification (optional, for logging) */
    symbol?: string;
}

/**
 * Result of Stage 1.5: MIP-Map Building
 *
 * Contains the multi-resolution candle pyramid ready for indicator calculation.
 */
export interface MipMapBuildingResult {
    /** The constructed MIP-map */
    mipMap: CandleMipMap;

    /** Base resolution (finest level in the MIP-map) */
    baseResolution: number;

    /** All resolutions available in the map */
    availableResolutions: number[];

    /** Indicator configs extracted (for passing to Stage 2) */
    indicatorConfigs: IndicatorConfig[];

    /** Build statistics for monitoring/debugging */
    stats: MipMapBuildStats;

    /** Any warnings generated during building */
    warnings: string[];

    /** Whether the MIP-map is empty (no candles) */
    isEmpty: boolean;
}

// =============================================================================
// STAGE 1.5: MIP-MAP BUILDING
// =============================================================================

/**
 * Execute Stage 1.5: Build MIP-map from candle data.
 *
 * @param input - MIP-map building input
 * @returns MipMapBuildingResult with the constructed MIP-map
 *
 * @example
 * ```typescript
 * // From Stage 1 result:
 * const mipMapResult = executeMipMapBuilding({
 *   candles: dataResult.filteredCandles,
 *   candleResolution: detectCandleResolution(dataResult.filteredCandles),
 *   algoParams: dataResult.validatedInput.algoConfig.params,
 *   symbol: dataResult.validatedInput.runSettings.coinSymbol,
 * });
 *
 * // MIP-map is now ready for Stage 2 indicator calculation
 * const candles5m = getCandlesAtResolution(mipMapResult.mipMap, 300);
 * ```
 */
export function executeMipMapBuilding(input: MipMapBuildingInput): MipMapBuildingResult {
    const { candles, candleResolution, algoParams, symbol = "" } = input;
    const warnings: string[] = [];

    // Step 1: Handle empty candles case
    if (candles.length === 0) {
        return createEmptyMipMapResult(symbol);
    }

    // Step 2: Extract indicator configs from algo params
    const indicatorConfigs = collectIndicatorConfigs(algoParams);

    // Step 3: Build the MIP-map
    const buildResult = buildCandleMipMap(candles, candleResolution, indicatorConfigs);

    // Step 4: Set symbol on the MIP-map
    buildResult.mipMap.symbol = symbol;

    // Step 5: Check for non-standard aggregation factors and warn
    for (const [res, level] of buildResult.mipMap.levels) {
        if (level.aggregationFactor > 1 && ![2, 3, 4, 5, 6, 12, 60].includes(level.aggregationFactor)) {
            warnings.push(
                `Non-standard aggregation factor ${level.aggregationFactor}x for ${formatResolution(res)} resolution`
            );
        }
    }

    // Step 6: Warn if memory overhead is high
    if (buildResult.stats.overheadPct > 50) {
        warnings.push(
            `High memory overhead: ${buildResult.stats.overheadPct.toFixed(1)}% (expected ~33%)`
        );
    }

    return {
        mipMap: buildResult.mipMap,
        baseResolution: buildResult.baseResolution,
        availableResolutions: buildResult.resolutionsBuilt,
        indicatorConfigs,
        stats: buildResult.stats,
        warnings,
        isEmpty: false,
    };
}

/**
 * Convenience function to create MIP-map building input from Stage 1 result.
 *
 * @param dataResult - Result from Stage 1 (data loading)
 * @returns MipMapBuildingInput ready for executeMipMapBuilding()
 */
export function createMipMapInputFromDataResult(dataResult: DataLoadingResult): MipMapBuildingInput {
    const candleResolution = detectCandleResolution(dataResult.filteredCandles);

    return {
        candles: dataResult.filteredCandles,
        candleResolution,
        algoParams: dataResult.validatedInput.algoConfig.params,
        symbol: dataResult.validatedInput.runSettings.coinSymbol,
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Detect candle resolution from candle data.
 * Uses the gap between first two candles.
 *
 * @param candles - Candle array
 * @returns Detected resolution in seconds, or 60 if unable to detect
 */
export function detectCandleResolution(candles: Candle[]): number {
    if (candles.length < 2) {
        return 60; // Default to 1 minute
    }

    const gap = candles[1]!.bucket - candles[0]!.bucket;

    // Validate the gap is reasonable (between 1 second and 1 day)
    if (gap >= 1 && gap <= 86400) {
        return gap;
    }

    return 60; // Default to 1 minute if gap seems invalid
}

/**
 * Format resolution in human-readable form.
 */
function formatResolution(seconds: number): string {
    if (seconds >= 86400) return `${seconds / 86400}d`;
    if (seconds >= 3600) return `${seconds / 3600}h`;
    if (seconds >= 60) return `${seconds / 60}m`;
    return `${seconds}s`;
}

/**
 * Create empty MIP-map result for when no candles are available.
 */
function createEmptyMipMapResult(symbol: string): MipMapBuildingResult {
    return {
        mipMap: {
            baseResolution: 60,
            levels: new Map(),
            requestedResolutions: [],
            symbol,
        },
        baseResolution: 60,
        availableResolutions: [],
        indicatorConfigs: [],
        stats: {
            sourceCandles: 0,
            levelsBuilt: 0,
            totalCandles: 0,
            overheadPct: 0,
            buildTimeMs: 0,
        },
        warnings: [],
        isEmpty: true,
    };
}

