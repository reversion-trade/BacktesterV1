/** Stage 1.5: MIP-Map Building - Builds multi-resolution candle pyramid for efficient indicator calculation. */

import type { Candle, AlgoParams, IndicatorConfig } from "../../core/types.ts";
import { collectIndicatorConfigs } from "../../indicators/calculator.ts";
import { buildCandleMipMap, type CandleMipMap, type MipMapBuildStats, type MipMapBuildOptions } from "../mipmap/index.ts";
import type { DataLoadingResult } from "./data-loading.ts";

export interface MipMapBuildingInput {
    candles: Candle[];                                                            // Candles from Stage 1 (filtered to time range)
    candleResolution: number;                                                     // Resolution of source candles in seconds
    algoParams: AlgoParams;                                                       // Algorithm parameters with indicator configs
    symbol?: string;                                                              // Symbol for identification (optional)
}

export interface MipMapBuildingResult {
    mipMap: CandleMipMap;                                                         // The constructed MIP-map
    baseResolution: number;                                                       // Base resolution (finest level)
    availableResolutions: number[];                                               // All resolutions in the map
    indicatorConfigs: IndicatorConfig[];                                          // Indicator configs for Stage 2
    stats: MipMapBuildStats;                                                      // Build statistics for monitoring
    warnings: string[];                                                           // Any warnings during building
    isEmpty: boolean;                                                             // True if no candles
}

/** Execute Stage 1.5: Build MIP-map from candle data. */
export function executeMipMapBuilding(input: MipMapBuildingInput): MipMapBuildingResult {
    const { candles, candleResolution, algoParams, symbol = "" } = input;
    const warnings: string[] = [];

    if (candles.length === 0) return createEmptyMipMapResult(symbol);             // Handle empty candles

    const indicatorConfigs = collectIndicatorConfigs(algoParams);                 // Extract indicator configs
    const buildResult = buildCandleMipMap(candles, candleResolution, indicatorConfigs);
    buildResult.mipMap.symbol = symbol;

    for (const [res, level] of buildResult.mipMap.levels) {                       // Warn on non-standard aggregation factors
        if (level.aggregationFactor > 1 && ![2, 3, 4, 5, 6, 12, 60].includes(level.aggregationFactor)) {
            warnings.push(`Non-standard aggregation factor ${level.aggregationFactor}x for ${formatResolution(res)} resolution`);
        }
    }

    if (buildResult.stats.overheadPct > 50) {                                     // Warn on high memory overhead
        warnings.push(`High memory overhead: ${buildResult.stats.overheadPct.toFixed(1)}% (expected ~33%)`);
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

/** Create MIP-map building input from Stage 1 result. */
export function createMipMapInputFromDataResult(dataResult: DataLoadingResult): MipMapBuildingInput {
    return {
        candles: dataResult.filteredCandles,
        candleResolution: detectCandleResolution(dataResult.filteredCandles),
        algoParams: dataResult.validatedInput.algoConfig.params,
        symbol: dataResult.validatedInput.runSettings.coinSymbol,
    };
}

/** Detect candle resolution from gap between first two candles. Returns 60 (1min) if unable to detect. */
export function detectCandleResolution(candles: Candle[]): number {
    if (candles.length < 2) return 60;                                            // Default to 1 minute
    const gap = candles[1]!.bucket - candles[0]!.bucket;
    return (gap >= 1 && gap <= 86400) ? gap : 60;                                 // Validate gap is reasonable (1s to 1d)
}

function formatResolution(seconds: number): string {
    if (seconds >= 86400) return `${seconds / 86400}d`;
    if (seconds >= 3600) return `${seconds / 3600}h`;
    if (seconds >= 60) return `${seconds / 60}m`;
    return `${seconds}s`;
}

function createEmptyMipMapResult(symbol: string): MipMapBuildingResult {
    return {
        mipMap: { baseResolution: 60, levels: new Map(), requestedResolutions: [], symbol },
        baseResolution: 60,
        availableResolutions: [],
        indicatorConfigs: [],
        stats: { sourceCandles: 0, levelsBuilt: 0, totalCandles: 0, overheadPct: 0, buildTimeMs: 0 },
        warnings: [],
        isEmpty: true,
    };
}
