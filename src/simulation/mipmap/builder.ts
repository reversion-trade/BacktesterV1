/**
 * MIP-Map Builder
 *
 * @module simulation/mipmap/builder
 * @description
 * Constructs multi-resolution candle pyramids from source candles.
 * Analyzes indicator requirements to determine which resolutions to build.
 *
 * @architecture
 * 1. Scan all indicator configs to collect required resolutions
 * 2. Determine base resolution (one bucket lower than min indicator resolution)
 * 3. Build levels by aggregating upward from base
 * 4. Store all levels in a Map for O(1) lookup
 *
 * @audit-trail
 * - Created: 2026-01-09 (MIP-Map Implementation Phase 1)
 * - Purpose: Enable correct multi-resolution indicator calculation
 */

import { makeIndicator } from "@indicators/factory.ts";
import type { Candle, IndicatorConfig } from "../../core/types.ts";
import { getNextLowerBucket, MIN_SIMULATION_RESOLUTION } from "../../indicators/resampler.ts";
import { aggregateCandles, calculateAggregationFactor } from "./aggregation.ts";
import type {
    CandleMipMap,
    MipMapBuildResult,
    MipMapBuildStats,
    MipMapLevel,
    MipMapBuildOptions,
    ResolutionLookup,
} from "./types.ts";

// =============================================================================
// RESOLUTION COLLECTION
// =============================================================================

/**
 * Collect all unique resolutions required by indicator configs.
 *
 * @param configs - Array of indicator configurations
 * @returns Sorted array of unique resolutions (ascending)
 *
 * @example
 * ```typescript
 * const resolutions = collectRequiredResolutions(configs);
 * // [60, 300, 3600] - indicators need 1m, 5m, 1h
 * ```
 */
export function collectRequiredResolutions(configs: IndicatorConfig[]): number[] {
    const resolutions = new Set<number>();

    for (const config of configs) {
        const indicator = makeIndicator(config);
        const { resolution } = indicator.getPointRequirements();
        resolutions.add(resolution);
    }

    return Array.from(resolutions).sort((a, b) => a - b);
}

/**
 * Determine base resolution for MIP-map.
 * Goes one bucket lower than min indicator resolution for SL/TP precision.
 *
 * @param indicatorResolutions - Required indicator resolutions
 * @param loadedCandleResolution - Resolution of loaded source candles
 * @returns Base resolution to use (finest level of MIP-map)
 *
 * @example
 * ```typescript
 * // Indicators need 5m, 1h. Source candles are 1m.
 * const base = determineBaseResolution([300, 3600], 60);
 * // Returns 60 (can't go finer than loaded data)
 * ```
 */
export function determineBaseResolution(
    indicatorResolutions: number[],
    loadedCandleResolution: number
): number {
    if (indicatorResolutions.length === 0) {
        return loadedCandleResolution;
    }

    const minIndicatorRes = Math.min(...indicatorResolutions);
    const lowerBucket = getNextLowerBucket(minIndicatorRes);

    // Can't go finer than loaded candles or MIN_SIMULATION_RESOLUTION
    return Math.max(lowerBucket, loadedCandleResolution, MIN_SIMULATION_RESOLUTION);
}

// =============================================================================
// MIP-MAP BUILDER
// =============================================================================

/**
 * Build complete MIP-map from source candles.
 *
 * @param candles - Source candles at sourceResolution
 * @param sourceResolution - Resolution of source candles in seconds
 * @param indicatorConfigs - All indicator configurations that need data
 * @param options - Optional build configuration
 * @returns MipMapBuildResult with the constructed map and statistics
 *
 * @example
 * ```typescript
 * const result = buildCandleMipMap(candles, 60, indicatorConfigs);
 * console.log(`Built ${result.stats.levelsBuilt} levels`);
 * console.log(`Memory overhead: ${result.stats.overheadPct.toFixed(1)}%`);
 *
 * // Access candles at specific resolution
 * const candles5m = getCandlesAtResolution(result.mipMap, 300);
 * ```
 */
export function buildCandleMipMap(
    candles: Candle[],
    sourceResolution: number,
    indicatorConfigs: IndicatorConfig[],
    options: MipMapBuildOptions = {}
): MipMapBuildResult {
    const startTime = performance.now();

    // Collect required resolutions from indicators
    const requiredResolutions = collectRequiredResolutions(indicatorConfigs);

    // Determine base resolution
    const baseResolution = options.forceBaseResolution
        ?? determineBaseResolution(requiredResolutions, sourceResolution);

    // Handle empty candles
    if (candles.length === 0) {
        return createEmptyMipMapResult(baseResolution, requiredResolutions, startTime);
    }

    // Build the levels map
    const levels = new Map<number, MipMapLevel>();
    let totalCandles = 0;

    // Step 1: Create or aggregate base level
    let baseCandles = candles;
    if (sourceResolution < baseResolution) {
        // Need to aggregate source candles to reach base resolution
        baseCandles = aggregateCandles(candles, sourceResolution, baseResolution);
    } else if (sourceResolution > baseResolution) {
        // Source is coarser than needed base - use source as base
        // (Can't synthesize finer data)
        console.warn(
            `Source resolution (${sourceResolution}s) is coarser than desired base (${baseResolution}s). ` +
            `Using source resolution as base.`
        );
    }

    // Add base level
    levels.set(baseResolution, createMipMapLevel(baseCandles, baseResolution, 1));
    totalCandles += baseCandles.length;

    // Step 2: Build each required resolution level
    for (const targetRes of requiredResolutions) {
        if (targetRes <= baseResolution || levels.has(targetRes)) {
            continue;
        }

        // Find the closest lower level to aggregate from
        const sourceLevel = findClosestLowerLevel(levels, targetRes);
        const aggregated = aggregateCandles(
            sourceLevel.candles,
            sourceLevel.resolution,
            targetRes
        );

        const factor = calculateAggregationFactor(sourceLevel.resolution, targetRes);
        levels.set(targetRes, createMipMapLevel(aggregated, targetRes, factor * sourceLevel.aggregationFactor));
        totalCandles += aggregated.length;
    }

    // Calculate build statistics
    const buildTimeMs = performance.now() - startTime;
    const overheadPct = baseCandles.length > 0
        ? ((totalCandles / baseCandles.length) - 1) * 100
        : 0;

    const stats: MipMapBuildStats = {
        sourceCandles: candles.length,
        levelsBuilt: levels.size,
        totalCandles,
        overheadPct,
        buildTimeMs,
    };

    const mipMap: CandleMipMap = {
        baseResolution,
        levels,
        requestedResolutions: requiredResolutions,
        symbol: "",
    };

    return {
        mipMap,
        baseResolution,
        minIndicatorResolution: requiredResolutions.length > 0 ? Math.min(...requiredResolutions) : baseResolution,
        resolutionsBuilt: Array.from(levels.keys()).sort((a, b) => a - b),
        stats,
    };
}

// =============================================================================
// MIP-MAP ACCESS
// =============================================================================

/**
 * Get candles at a specific resolution from the MIP-map.
 * Falls back to nearest available resolution if exact match not found.
 *
 * @param mipMap - The MIP-map to query
 * @param resolution - Desired resolution in seconds
 * @returns Candles at the requested (or nearest) resolution
 *
 * @example
 * ```typescript
 * const candles = getCandlesAtResolution(mipMap, 300);
 * ```
 */
export function getCandlesAtResolution(mipMap: CandleMipMap, resolution: number): Candle[] {
    const level = mipMap.levels.get(resolution);
    if (level) {
        return level.candles;
    }

    // Find nearest available resolution (prefer coarser to avoid synthesizing)
    const availableRes = Array.from(mipMap.levels.keys()).sort((a, b) => a - b);
    const nearest = availableRes.find((r) => r >= resolution) ?? availableRes[availableRes.length - 1]!;

    const nearestLevel = mipMap.levels.get(nearest);
    if (!nearestLevel) {
        return [];
    }

    return nearestLevel.candles;
}

/**
 * Get detailed information about a resolution lookup.
 *
 * @param mipMap - The MIP-map to query
 * @param resolution - Desired resolution in seconds
 * @returns Lookup information including whether exact match was found
 */
export function lookupResolution(mipMap: CandleMipMap, resolution: number): ResolutionLookup {
    const level = mipMap.levels.get(resolution);

    if (level) {
        return {
            requestedResolution: resolution,
            actualResolution: resolution,
            exactMatch: true,
            candleCount: level.candles.length,
        };
    }

    // Find nearest
    const availableRes = Array.from(mipMap.levels.keys()).sort((a, b) => a - b);
    const nearest = availableRes.find((r) => r >= resolution) ?? availableRes[availableRes.length - 1]!;
    const nearestLevel = mipMap.levels.get(nearest)!;

    return {
        requestedResolution: resolution,
        actualResolution: nearest,
        exactMatch: false,
        candleCount: nearestLevel?.candles.length ?? 0,
    };
}

/**
 * Check if a specific resolution is available in the MIP-map.
 *
 * @param mipMap - The MIP-map to query
 * @param resolution - Resolution to check
 * @returns True if exact resolution is available
 */
export function hasResolution(mipMap: CandleMipMap, resolution: number): boolean {
    return mipMap.levels.has(resolution);
}

/**
 * Get all available resolutions in the MIP-map.
 *
 * @param mipMap - The MIP-map to query
 * @returns Sorted array of available resolutions (ascending)
 */
export function getAvailableResolutions(mipMap: CandleMipMap): number[] {
    return Array.from(mipMap.levels.keys()).sort((a, b) => a - b);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a MipMapLevel from candles.
 */
function createMipMapLevel(candles: Candle[], resolution: number, aggregationFactor: number): MipMapLevel {
    return {
        resolution,
        candles,
        startTime: candles[0]?.bucket ?? 0,
        endTime: candles[candles.length - 1]?.bucket ?? 0,
        aggregationFactor,
    };
}

/**
 * Find the closest lower level in the MIP-map to aggregate from.
 *
 * @param levels - Current MIP-map levels
 * @param targetRes - Target resolution we want to build
 * @returns The closest lower MipMapLevel
 * @throws Error if no lower level exists
 */
function findClosestLowerLevel(levels: Map<number, MipMapLevel>, targetRes: number): MipMapLevel {
    let closest: MipMapLevel | null = null;

    for (const [res, level] of levels) {
        if (res < targetRes && (!closest || res > closest.resolution)) {
            closest = level;
        }
    }

    if (!closest) {
        throw new Error(`No lower level found for resolution ${targetRes}s`);
    }

    return closest;
}

/**
 * Create empty MIP-map result for edge cases.
 */
function createEmptyMipMapResult(
    baseResolution: number,
    requiredResolutions: number[],
    startTime: number
): MipMapBuildResult {
    const buildTimeMs = performance.now() - startTime;

    return {
        mipMap: {
            baseResolution,
            levels: new Map(),
            requestedResolutions: requiredResolutions,
            symbol: "",
        },
        baseResolution,
        minIndicatorResolution: requiredResolutions.length > 0 ? Math.min(...requiredResolutions) : baseResolution,
        resolutionsBuilt: [],
        stats: {
            sourceCandles: 0,
            levelsBuilt: 0,
            totalCandles: 0,
            overheadPct: 0,
            buildTimeMs,
        },
    };
}

// =============================================================================
// DEBUG UTILITIES
// =============================================================================

/**
 * Format MIP-map summary for debugging.
 *
 * @param result - MipMapBuildResult to format
 * @returns Formatted summary string
 */
export function formatMipMapSummary(result: MipMapBuildResult): string {
    const { stats, resolutionsBuilt, baseResolution, minIndicatorResolution } = result;

    const resolutionList = resolutionsBuilt
        .map((r) => formatResolution(r))
        .join(", ");

    return [
        "=== MIP-Map Summary ===",
        `Base Resolution: ${formatResolution(baseResolution)}`,
        `Min Indicator Resolution: ${formatResolution(minIndicatorResolution)}`,
        `Levels Built: ${stats.levelsBuilt}`,
        `Resolutions: [${resolutionList}]`,
        `Source Candles: ${stats.sourceCandles}`,
        `Total Candles: ${stats.totalCandles}`,
        `Memory Overhead: ${stats.overheadPct.toFixed(1)}%`,
        `Build Time: ${stats.buildTimeMs.toFixed(2)}ms`,
    ].join("\n");
}

/**
 * Format resolution in human-readable form.
 */
function formatResolution(seconds: number): string {
    if (seconds >= 86400) {
        return `${seconds / 86400}d`;
    }
    if (seconds >= 3600) {
        return `${seconds / 3600}h`;
    }
    if (seconds >= 60) {
        return `${seconds / 60}m`;
    }
    return `${seconds}s`;
}
