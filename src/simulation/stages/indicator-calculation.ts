/**
 * Stage 2: Indicator Pre-Calculation
 *
 * @module simulation/stages/indicator-calculation
 * @description
 * Second stage in the backtester pipeline. Responsible for:
 * - Extracting indicator configurations from algo parameters
 * - Pre-calculating all indicator signals over the entire dataset
 * - Determining warmup periods for each indicator
 * - Building the signal cache for simulation consumption
 *
 * @architecture
 * This stage performs the "expensive" computation upfront.
 * All indicators are calculated once before simulation begins.
 * Input: DataLoadingResult (from Stage 1)
 * Output: IndicatorCalculationResult with signal cache
 *
 * @performance
 * - Indicators are deduplicated by cache key (same indicator in multiple
 *   conditions is only calculated once)
 * - This is CPU-intensive; runtime scales with indicator count and data size
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Purpose: Extract indicator calculation from runBacktestWithEvents()
 * - Wraps existing calculator.ts functions in explicit stage interface
 * - Follows architecture principle: "Stages should be separate and explicit"
 */

import type { Candle, AlgoParams, IndicatorConfig } from "../../core/types.ts";
import type { SignalCache } from "../../indicators/calculator.ts";
import { calculateIndicators, calculateIndicatorsWithMipMap, collectIndicatorConfigs } from "../../indicators/calculator.ts";
import type { DataLoadingResult } from "./data-loading.ts";
import type { MipMapBuildingResult } from "./mipmap-building.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of Stage 2: Indicator Pre-Calculation
 *
 * Contains pre-calculated signals ready for simulation or resampling.
 */
export interface IndicatorCalculationResult {
    /** Pre-calculated signal cache keyed by indicator cache key */
    signalCache: SignalCache;

    /** Maximum warmup period across all indicators (in candles) */
    warmupCandles: number;

    /** All indicator configurations extracted from algo params */
    indicatorConfigs: IndicatorConfig[];

    /** Number of unique indicators (after deduplication) */
    uniqueIndicatorCount: number;

    /** Indicator cache keys for debugging/auditing */
    indicatorKeys: string[];
}

/**
 * Input for Stage 2.
 * Can be constructed from Stage 1 result or manually for testing.
 */
export interface IndicatorCalculationInput {
    /** Candles to calculate indicators over */
    candles: Candle[];

    /** Algorithm parameters containing indicator configs */
    algoParams: AlgoParams;
}

/**
 * Input for Stage 2 with MIP-Map.
 * Uses pre-built MIP-map for multi-resolution indicator calculation.
 */
export interface IndicatorCalculationWithMipMapInput {
    /** MIP-map result from Stage 1.1 */
    mipMapResult: MipMapBuildingResult;

    /** Algorithm parameters containing indicator configs */
    algoParams: AlgoParams;
}

// =============================================================================
// STAGE 2: INDICATOR PRE-CALCULATION
// =============================================================================

/**
 * Execute Stage 2: Pre-calculate all indicator signals.
 *
 * @param input - Indicator calculation input (candles + algo params)
 * @returns IndicatorCalculationResult with signal cache and metadata
 *
 * @example
 * ```typescript
 * // From Stage 1 result:
 * const indicatorResult = executeIndicatorCalculation({
 *   candles: dataResult.filteredCandles,
 *   algoParams: dataResult.validatedInput.algoConfig.params,
 * });
 *
 * // Signals are now ready for Stage 3 (resampling)
 * const rsiSignals = indicatorResult.signalCache.get("rsi:14:close:60");
 * ```
 *
 * @audit-note
 * This function wraps the existing calculateIndicators() from calculator.ts.
 * It adds metadata tracking for auditability (config count, key list, etc.).
 */
export function executeIndicatorCalculation(input: IndicatorCalculationInput): IndicatorCalculationResult {
    const { candles, algoParams } = input;

    // Step 1: Extract all indicator configs from algo parameters
    const indicatorConfigs = collectIndicatorConfigs(algoParams);

    // Step 2: Calculate all indicators (deduplication happens internally)
    const { signals: signalCache, warmupCandles } = calculateIndicators(candles, indicatorConfigs);

    // Step 3: Gather metadata for auditing
    const indicatorKeys = signalCache.keys();
    const uniqueIndicatorCount = indicatorKeys.length;

    return {
        signalCache,
        warmupCandles,
        indicatorConfigs,
        uniqueIndicatorCount,
        indicatorKeys,
    };
}

/**
 * Execute Stage 2 with MIP-Map: Pre-calculate all indicator signals using
 * multi-resolution candle data.
 *
 * This is the MIP-map aware version of executeIndicatorCalculation().
 * Instead of using raw candles, it uses pre-aggregated candles at each
 * indicator's native resolution for correct multi-timeframe calculation.
 *
 * @param input - MIP-map indicator calculation input
 * @returns IndicatorCalculationResult with signal cache and metadata
 *
 * @example
 * ```typescript
 * // From Stage 1.1 result:
 * const indicatorResult = executeIndicatorCalculationWithMipMap({
 *     mipMapResult,
 *     algoParams: dataResult.validatedInput.algoConfig.params,
 * });
 * ```
 *
 * @audit-note
 * This function uses calculateIndicatorsWithMipMap() which retrieves
 * candles at the correct resolution for each indicator before calculation.
 */
export function executeIndicatorCalculationWithMipMap(
    input: IndicatorCalculationWithMipMapInput
): IndicatorCalculationResult {
    const { mipMapResult, algoParams } = input;

    // Step 1: Extract all indicator configs from algo parameters
    const indicatorConfigs = collectIndicatorConfigs(algoParams);

    // Step 2: Calculate all indicators using MIP-map (correct multi-resolution)
    const { signals: signalCache, warmupCandles } = calculateIndicatorsWithMipMap(
        mipMapResult.mipMap,
        indicatorConfigs
    );

    // Step 3: Gather metadata for auditing
    const indicatorKeys = signalCache.keys();
    const uniqueIndicatorCount = indicatorKeys.length;

    return {
        signalCache,
        warmupCandles,
        indicatorConfigs,
        uniqueIndicatorCount,
        indicatorKeys,
    };
}

/**
 * Create IndicatorCalculationInput from DataLoadingResult.
 *
 * Convenience function for stage chaining.
 *
 * @param dataResult - Result from Stage 1
 * @returns Input for Stage 2
 */
export function createIndicatorInputFromDataResult(dataResult: DataLoadingResult): IndicatorCalculationInput {
    return {
        candles: dataResult.filteredCandles,
        algoParams: dataResult.validatedInput.algoConfig.params,
    };
}

