/** Stage 2: Indicator Pre-Calculation - Extracts configs, pre-calculates signals, determines warmup periods. */

import type { Candle, AlgoParams, IndicatorConfig } from "../../core/types.ts";
import type { SignalCache } from "../../indicators/calculator.ts";
import { calculateIndicators, calculateIndicatorsWithMipMap, collectIndicatorConfigs } from "../../indicators/calculator.ts";
import type { DataLoadingResult } from "./data-loading.ts";
import type { MipMapBuildingResult } from "./mipmap-building.ts";

export interface IndicatorCalculationResult {
    signalCache: SignalCache;                                                     // Pre-calculated signals keyed by indicator cache key
    warmupCandles: number;                                                        // Maximum warmup period across all indicators
    indicatorConfigs: IndicatorConfig[];                                          // All configs extracted from algo params
    uniqueIndicatorCount: number;                                                 // Count after deduplication
    indicatorKeys: string[];                                                      // Cache keys for debugging
}

export interface IndicatorCalculationInput {
    candles: Candle[];                                                            // Candles to calculate indicators over
    algoParams: AlgoParams;                                                       // Algorithm parameters with indicator configs
}

export interface IndicatorCalculationWithMipMapInput {
    mipMapResult: MipMapBuildingResult;                                           // MIP-map from Stage 1.1
    algoParams: AlgoParams;                                                       // Algorithm parameters with indicator configs
}

/** Execute Stage 2: Pre-calculate all indicator signals from raw candles. */
export function executeIndicatorCalculation(input: IndicatorCalculationInput): IndicatorCalculationResult {
    const { candles, algoParams } = input;
    const indicatorConfigs = collectIndicatorConfigs(algoParams);                 // Extract all indicator configs
    const { signals: signalCache, warmupCandles } = calculateIndicators(candles, indicatorConfigs);
    const indicatorKeys = signalCache.keys();
    return { signalCache, warmupCandles, indicatorConfigs, uniqueIndicatorCount: indicatorKeys.length, indicatorKeys };
}

/** Execute Stage 2 with MIP-Map: Pre-calculate signals using multi-resolution candle data. */
export function executeIndicatorCalculationWithMipMap(input: IndicatorCalculationWithMipMapInput): IndicatorCalculationResult {
    const { mipMapResult, algoParams } = input;
    const indicatorConfigs = collectIndicatorConfigs(algoParams);                 // Extract all indicator configs
    const { signals: signalCache, warmupCandles } = calculateIndicatorsWithMipMap(mipMapResult.mipMap, indicatorConfigs);
    const indicatorKeys = signalCache.keys();
    return { signalCache, warmupCandles, indicatorConfigs, uniqueIndicatorCount: indicatorKeys.length, indicatorKeys };
}

/** Create IndicatorCalculationInput from DataLoadingResult for stage chaining. */
export function createIndicatorInputFromDataResult(dataResult: DataLoadingResult): IndicatorCalculationInput {
    return { candles: dataResult.filteredCandles, algoParams: dataResult.validatedInput.algoConfig.params };
}
