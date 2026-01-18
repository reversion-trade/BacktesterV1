/**
 * Stage 1.6: ValueFactor Pre-Calculation
 *
 * @module simulation/stages/valuefactor-loading
 * @description
 * Pre-calculates valueFactor indicators at sub-bar timeframe for dynamic SL/TP.
 * Runs after Stage 1.5 (Sub-Bar Loading) before Stage 2 (Indicator Calculation).
 *
 * This stage only runs if the algo has SL or TP with type: "DYN" and a valueFactor.
 * Pre-calculation at sub-bar granularity enables accurate dynamic level updates
 * at each price checkpoint during simulation.
 *
 * @architecture
 * - Extracts valueFactor indicator configs from exitConditions
 * - Flattens all sub-bar candles into chronological order
 * - Pre-calculates indicator values using valuefactor-calculation module
 * - Returns a lookup function for use in algo-runner
 *
 * @audit-trail
 * - Created: 2026-01-08 (Phase 6: Dynamic SL/TP ValueFactor)
 * - Purpose: Enable accurate dynamic SL/TP levels at sub-bar granularity
 */

import type { Candle, IndicatorConfig, AlgoParams } from "../../core/types.ts";
import type { SubBarLoadingResult } from "./subbar-loading.ts";
import {
    calculateValueFactors,
    createValueFactorLookup,
    type ValueFactorResult,
    type ValueFactorCalculationResult,
} from "../valuefactor-calculation.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for a dynamic SL/TP valueFactor.
 */
export interface ValueFactorConfig {
    /** Indicator configuration for the valueFactor */
    indicatorConfig: IndicatorConfig;

    /** Which exit type this applies to */
    exitType: "stopLoss" | "takeProfit";

    /** Direction this applies to */
    direction: "LONG" | "SHORT";

    /** Whether the factor is inverted */
    inverted: boolean;
}

/**
 * Result of Stage 1.6: ValueFactor Pre-Calculation
 */
export interface ValueFactorLoadingResult {
    /** Map from timestamp to ValueFactorResult (for SL) */
    stopLossValueFactorMap: Map<number, ValueFactorResult> | null;

    /** Map from timestamp to ValueFactorResult (for TP) */
    takeProfitValueFactorMap: Map<number, ValueFactorResult> | null;

    /** SL valueFactor indicator name (for debugging) */
    stopLossIndicatorName: string | null;

    /** TP valueFactor indicator name (for debugging) */
    takeProfitIndicatorName: string | null;

    /** Whether any dynamic SL/TP is configured */
    hasDynamicExits: boolean;

    /** Warmup bars needed for valueFactor indicators */
    warmupBars: number;

    /** Total valueFactor calculations performed */
    totalCalculations: number;
}

/**
 * Input for Stage 1.6
 */
export interface ValueFactorLoadingInput {
    /** Algorithm parameters containing exit conditions */
    algoParams: AlgoParams;

    /** Result from Stage 1.5 (Sub-Bar Loading) */
    subBarResult: SubBarLoadingResult;

    /** Parent timeframe (e.g., "5m") for warmup conversion */
    parentTimeframe: string;
}

// =============================================================================
// STAGE 1.6: VALUEFACTOR LOADING
// =============================================================================

/**
 * Execute Stage 1.6: Pre-calculate valueFactor indicators at sub-bar granularity.
 *
 * This stage extracts dynamic SL/TP configurations and pre-calculates
 * indicator values for accurate level updates during simulation.
 *
 * @param input - ValueFactor loading input
 * @returns ValueFactorLoadingResult with pre-calculated values
 *
 * @example
 * ```typescript
 * const valueFactorResult = await executeValueFactorLoading({
 *   algoParams: validatedInput.algoConfig.params,
 *   subBarResult: stage1_5_result,
 *   parentTimeframe: "5m",
 * });
 *
 * // Use in algo-runner:
 * const slFactor = valueFactorResult.stopLossValueFactorMap?.get(timestamp);
 * ```
 */
export function executeValueFactorLoading(
    input: ValueFactorLoadingInput
): ValueFactorLoadingResult {
    const { algoParams, subBarResult, parentTimeframe } = input;

    // Extract valueFactor configs from exit conditions
    const valueFactorConfigs = extractValueFactorConfigs(algoParams);

    // If no dynamic SL/TP, return empty result
    if (valueFactorConfigs.length === 0) {
        return createEmptyResult();
    }

    // Flatten all sub-bar candles into chronological order
    const flattenedSubBars = flattenSubBarCandles(subBarResult.subBarCandlesMap);

    if (flattenedSubBars.length === 0) {
        // No sub-bar data available, return empty (will fall back to parent bar)
        return createEmptyResult();
    }

    // Calculate valueFactor for each config
    let stopLossValueFactorMap: Map<number, ValueFactorResult> | null = null;
    let takeProfitValueFactorMap: Map<number, ValueFactorResult> | null = null;
    let stopLossIndicatorName: string | null = null;
    let takeProfitIndicatorName: string | null = null;
    let maxWarmupCandles = 0;
    let totalCalculations = 0;

    for (const config of valueFactorConfigs) {
        const result = calculateValueFactors(config.indicatorConfig, flattenedSubBars);

        maxWarmupCandles = Math.max(maxWarmupCandles, result.warmupCandles);
        totalCalculations += result.valueFactorMap.size;

        if (config.exitType === "stopLoss") {
            stopLossValueFactorMap = result.valueFactorMap;
            stopLossIndicatorName = result.indicatorName;
        } else {
            takeProfitValueFactorMap = result.valueFactorMap;
            takeProfitIndicatorName = result.indicatorName;
        }
    }

    // Convert warmup candles to parent bars
    const warmupBars = convertWarmupToParentBars(
        maxWarmupCandles,
        subBarResult.subBarTimeframe,
        parentTimeframe
    );

    return {
        stopLossValueFactorMap,
        takeProfitValueFactorMap,
        stopLossIndicatorName,
        takeProfitIndicatorName,
        hasDynamicExits: true,
        warmupBars,
        totalCalculations,
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract valueFactor indicator configs from algo parameters.
 *
 * Looks at longExit and shortExit for stopLoss/takeProfit with type: "DYN".
 */
export function extractValueFactorConfigs(algoParams: AlgoParams): ValueFactorConfig[] {
    const configs: ValueFactorConfig[] = [];

    // Check long exit
    if (algoParams.longExit) {
        // Stop loss
        if (
            algoParams.longExit.stopLoss?.type === "DYN" &&
            algoParams.longExit.stopLoss.valueFactor
        ) {
            configs.push({
                indicatorConfig: algoParams.longExit.stopLoss.valueFactor,
                exitType: "stopLoss",
                direction: "LONG",
                inverted: algoParams.longExit.stopLoss.inverted ?? false,
            });
        }

        // Take profit
        if (
            algoParams.longExit.takeProfit?.type === "DYN" &&
            algoParams.longExit.takeProfit.valueFactor
        ) {
            configs.push({
                indicatorConfig: algoParams.longExit.takeProfit.valueFactor,
                exitType: "takeProfit",
                direction: "LONG",
                inverted: algoParams.longExit.takeProfit.inverted ?? false,
            });
        }
    }

    // Check short exit
    if (algoParams.shortExit) {
        // Stop loss
        if (
            algoParams.shortExit.stopLoss?.type === "DYN" &&
            algoParams.shortExit.stopLoss.valueFactor
        ) {
            configs.push({
                indicatorConfig: algoParams.shortExit.stopLoss.valueFactor,
                exitType: "stopLoss",
                direction: "SHORT",
                inverted: algoParams.shortExit.stopLoss.inverted ?? false,
            });
        }

        // Take profit
        if (
            algoParams.shortExit.takeProfit?.type === "DYN" &&
            algoParams.shortExit.takeProfit.valueFactor
        ) {
            configs.push({
                indicatorConfig: algoParams.shortExit.takeProfit.valueFactor,
                exitType: "takeProfit",
                direction: "SHORT",
                inverted: algoParams.shortExit.takeProfit.inverted ?? false,
            });
        }
    }

    // Deduplicate: If both long and short use the same indicator, only calculate once
    return deduplicateValueFactorConfigs(configs);
}

/**
 * Deduplicate valueFactor configs by indicator type.
 *
 * If long and short use the same indicator (e.g., ATR), only keep one.
 * We assume the indicator values are the same regardless of direction.
 */
function deduplicateValueFactorConfigs(configs: ValueFactorConfig[]): ValueFactorConfig[] {
    const seen = new Map<string, ValueFactorConfig>();

    for (const config of configs) {
        const key = `${config.exitType}:${JSON.stringify(config.indicatorConfig)}`;
        if (!seen.has(key)) {
            seen.set(key, config);
        }
    }

    return Array.from(seen.values());
}

/**
 * Flatten sub-bar candles map into chronological array.
 *
 * Combines all sub-bars from all parent bars into a single sorted array.
 */
export function flattenSubBarCandles(
    subBarCandlesMap: Map<number, Candle[]>
): Candle[] {
    const allSubBars: Candle[] = [];

    // Collect all sub-bars
    for (const subBars of subBarCandlesMap.values()) {
        allSubBars.push(...subBars);
    }

    // Sort by timestamp (bucket)
    allSubBars.sort((a, b) => a.bucket - b.bucket);

    return allSubBars;
}

/**
 * Convert warmup candles from sub-bar timeframe to parent bar count.
 *
 * @example
 * ```typescript
 * // ATR(14) on 1m sub-bars, parent is 5m
 * // warmupCandles = 14 (1m candles)
 * // subBarTimeframe = "1m" (60 sec)
 * // parentTimeframe = "5m" (300 sec)
 * // warmupBars = ceil(14 * 60 / 300) = ceil(2.8) = 3 parent bars
 * ```
 */
function convertWarmupToParentBars(
    warmupCandles: number,
    subBarTimeframe: string,
    parentTimeframe: string
): number {
    const subBarDurationSec = getTimeframeDurationSeconds(subBarTimeframe);
    const parentDurationSec = getTimeframeDurationSeconds(parentTimeframe);

    if (parentDurationSec === 0) {
        return warmupCandles; // Fallback
    }

    return Math.ceil((warmupCandles * subBarDurationSec) / parentDurationSec);
}

/**
 * Get duration of a timeframe in seconds.
 */
function getTimeframeDurationSeconds(timeframe: string): number {
    const durationMap: Record<string, number> = {
        "1m": 60,
        "5m": 300,
        "15m": 900,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400,
    };
    return durationMap[timeframe] ?? 60;
}

/**
 * Create empty result for when no dynamic exits are configured.
 */
function createEmptyResult(): ValueFactorLoadingResult {
    return {
        stopLossValueFactorMap: null,
        takeProfitValueFactorMap: null,
        stopLossIndicatorName: null,
        takeProfitIndicatorName: null,
        hasDynamicExits: false,
        warmupBars: 0,
        totalCalculations: 0,
    };
}

// =============================================================================
// LOOKUP UTILITIES
// =============================================================================

/**
 * Create a lookup function for SL dynamicFactor.
 *
 * Returns a function that gets the normalized value for a timestamp.
 */
export function createStopLossFactorLookup(
    result: ValueFactorLoadingResult
): (timestamp: number) => number | undefined {
    if (!result.stopLossValueFactorMap) {
        return () => undefined;
    }

    return createValueFactorLookup({
        valueFactorMap: result.stopLossValueFactorMap,
        isNormalized: false, // Doesn't matter for lookup
        indicatorName: result.stopLossIndicatorName ?? "",
        warmupCandles: 0,
    });
}

/**
 * Create a lookup function for TP dynamicFactor.
 */
export function createTakeProfitFactorLookup(
    result: ValueFactorLoadingResult
): (timestamp: number) => number | undefined {
    if (!result.takeProfitValueFactorMap) {
        return () => undefined;
    }

    return createValueFactorLookup({
        valueFactorMap: result.takeProfitValueFactorMap,
        isNormalized: false,
        indicatorName: result.takeProfitIndicatorName ?? "",
        warmupCandles: 0,
    });
}

