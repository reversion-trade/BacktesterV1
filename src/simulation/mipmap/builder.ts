/** MIP-Map Builder - Constructs multi-resolution candle pyramids from source candles based on indicator requirements. */

import { makeIndicator } from "@indicators/factory.ts";
import type { Candle, IndicatorConfig } from "../../core/types.ts";
import { getNextLowerBucket, MIN_SIMULATION_RESOLUTION } from "../../indicators/resampler.ts";
import { aggregateCandles, calculateAggregationFactor } from "./aggregation.ts";
import type { CandleMipMap, MipMapBuildResult, MipMapBuildStats, MipMapLevel, MipMapBuildOptions, ResolutionLookup } from "./types.ts";

// RESOLUTION COLLECTION

export function collectRequiredResolutions(configs: IndicatorConfig[]): number[] { // Get unique resolutions required by indicators (sorted ascending)
    const resolutions = new Set<number>();
    for (const config of configs) {
        const indicator = makeIndicator(config);
        resolutions.add(indicator.getPointRequirements().resolution);
    }
    return Array.from(resolutions).sort((a, b) => a - b);
}

export function determineBaseResolution(indicatorResolutions: number[], loadedCandleResolution: number): number { // One bucket lower than min indicator res for SL/TP precision
    if (indicatorResolutions.length === 0) return loadedCandleResolution;
    const minIndicatorRes = Math.min(...indicatorResolutions);
    const lowerBucket = getNextLowerBucket(minIndicatorRes);
    return Math.max(lowerBucket, loadedCandleResolution, MIN_SIMULATION_RESOLUTION); // Can't go finer than loaded candles
}

// MIP-MAP BUILDER

export function buildCandleMipMap(candles: Candle[], sourceResolution: number, indicatorConfigs: IndicatorConfig[], options: MipMapBuildOptions = {}): MipMapBuildResult {
    const startTime = performance.now();
    const requiredResolutions = collectRequiredResolutions(indicatorConfigs);
    const baseResolution = options.forceBaseResolution ?? determineBaseResolution(requiredResolutions, sourceResolution);

    if (candles.length === 0) return createEmptyMipMapResult(baseResolution, requiredResolutions, startTime);

    const levels = new Map<number, MipMapLevel>();
    let totalCandles = 0;

    let baseCandles = candles; // Step 1: Create or aggregate base level
    if (sourceResolution < baseResolution) {
        baseCandles = aggregateCandles(candles, sourceResolution, baseResolution);
    } else if (sourceResolution > baseResolution) {
        console.warn(`Source resolution (${sourceResolution}s) is coarser than desired base (${baseResolution}s). Using source resolution as base.`);
    }

    levels.set(baseResolution, createMipMapLevel(baseCandles, baseResolution, 1));
    totalCandles += baseCandles.length;

    for (const targetRes of requiredResolutions) { // Step 2: Build each required resolution level
        if (targetRes <= baseResolution || levels.has(targetRes)) continue;

        const sourceLevel = findClosestLowerLevel(levels, targetRes);
        const aggregated = aggregateCandles(sourceLevel.candles, sourceLevel.resolution, targetRes);
        const factor = calculateAggregationFactor(sourceLevel.resolution, targetRes);
        levels.set(targetRes, createMipMapLevel(aggregated, targetRes, factor * sourceLevel.aggregationFactor));
        totalCandles += aggregated.length;
    }

    const buildTimeMs = performance.now() - startTime;
    const overheadPct = baseCandles.length > 0 ? ((totalCandles / baseCandles.length) - 1) * 100 : 0;

    const stats: MipMapBuildStats = { sourceCandles: candles.length, levelsBuilt: levels.size, totalCandles, overheadPct, buildTimeMs };
    const mipMap: CandleMipMap = { baseResolution, levels, requestedResolutions: requiredResolutions, symbol: "" };

    return {
        mipMap,
        baseResolution,
        minIndicatorResolution: requiredResolutions.length > 0 ? Math.min(...requiredResolutions) : baseResolution,
        resolutionsBuilt: Array.from(levels.keys()).sort((a, b) => a - b),
        stats,
    };
}

// MIP-MAP ACCESS

export function getCandlesAtResolution(mipMap: CandleMipMap, resolution: number): Candle[] { // Falls back to nearest available if exact not found
    const level = mipMap.levels.get(resolution);
    if (level) return level.candles;

    const availableRes = Array.from(mipMap.levels.keys()).sort((a, b) => a - b); // Find nearest (prefer coarser to avoid synthesizing)
    const nearest = availableRes.find((r) => r >= resolution) ?? availableRes[availableRes.length - 1]!;
    return mipMap.levels.get(nearest)?.candles ?? [];
}

export function lookupResolution(mipMap: CandleMipMap, resolution: number): ResolutionLookup { // Detailed info about resolution lookup
    const level = mipMap.levels.get(resolution);
    if (level) return { requestedResolution: resolution, actualResolution: resolution, exactMatch: true, candleCount: level.candles.length };

    const availableRes = Array.from(mipMap.levels.keys()).sort((a, b) => a - b);
    const nearest = availableRes.find((r) => r >= resolution) ?? availableRes[availableRes.length - 1]!;
    const nearestLevel = mipMap.levels.get(nearest);
    return { requestedResolution: resolution, actualResolution: nearest, exactMatch: false, candleCount: nearestLevel?.candles.length ?? 0 };
}

export function hasResolution(mipMap: CandleMipMap, resolution: number): boolean { return mipMap.levels.has(resolution); }
export function getAvailableResolutions(mipMap: CandleMipMap): number[] { return Array.from(mipMap.levels.keys()).sort((a, b) => a - b); }

// HELPER FUNCTIONS

function createMipMapLevel(candles: Candle[], resolution: number, aggregationFactor: number): MipMapLevel {
    return { resolution, candles, startTime: candles[0]?.bucket ?? 0, endTime: candles[candles.length - 1]?.bucket ?? 0, aggregationFactor };
}

function findClosestLowerLevel(levels: Map<number, MipMapLevel>, targetRes: number): MipMapLevel { // Find closest lower level to aggregate from
    let closest: MipMapLevel | null = null;
    for (const [res, level] of levels) {
        if (res < targetRes && (!closest || res > closest.resolution)) closest = level;
    }
    if (!closest) throw new Error(`No lower level found for resolution ${targetRes}s`);
    return closest;
}

function createEmptyMipMapResult(baseResolution: number, requiredResolutions: number[], startTime: number): MipMapBuildResult {
    return {
        mipMap: { baseResolution, levels: new Map(), requestedResolutions: requiredResolutions, symbol: "" },
        baseResolution,
        minIndicatorResolution: requiredResolutions.length > 0 ? Math.min(...requiredResolutions) : baseResolution,
        resolutionsBuilt: [],
        stats: { sourceCandles: 0, levelsBuilt: 0, totalCandles: 0, overheadPct: 0, buildTimeMs: performance.now() - startTime },
    };
}

// DEBUG UTILITIES

export function formatMipMapSummary(result: MipMapBuildResult): string {
    const { stats, resolutionsBuilt, baseResolution, minIndicatorResolution } = result;
    const resolutionList = resolutionsBuilt.map((r) => formatResolution(r)).join(", ");
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

function formatResolution(seconds: number): string {
    if (seconds >= 86400) return `${seconds / 86400}d`;
    if (seconds >= 3600) return `${seconds / 3600}h`;
    if (seconds >= 60) return `${seconds / 60}m`;
    return `${seconds}s`;
}
