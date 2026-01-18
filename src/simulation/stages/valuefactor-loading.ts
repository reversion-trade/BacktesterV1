/** Stage 1.6: ValueFactor Pre-Calculation - Pre-calculates valueFactor indicators at sub-bar timeframe for dynamic SL/TP. */

import type { Candle, IndicatorConfig, AlgoParams } from "../../core/types.ts";
import type { SubBarLoadingResult } from "./subbar-loading.ts";
import { calculateValueFactors, createValueFactorLookup, type ValueFactorResult, type ValueFactorCalculationResult } from "../valuefactor-calculation.ts";

export interface ValueFactorConfig {
    indicatorConfig: IndicatorConfig;                                             // Indicator configuration for the valueFactor
    exitType: "stopLoss" | "takeProfit";                                          // Which exit type this applies to
    direction: "LONG" | "SHORT";                                                  // Direction this applies to
    inverted: boolean;                                                            // Whether the factor is inverted
}

export interface ValueFactorLoadingResult {
    stopLossValueFactorMap: Map<number, ValueFactorResult> | null;                // Timestamp → ValueFactorResult for SL
    takeProfitValueFactorMap: Map<number, ValueFactorResult> | null;              // Timestamp → ValueFactorResult for TP
    stopLossIndicatorName: string | null;                                         // SL valueFactor indicator name
    takeProfitIndicatorName: string | null;                                       // TP valueFactor indicator name
    hasDynamicExits: boolean;                                                     // Whether any dynamic SL/TP is configured
    warmupBars: number;                                                           // Warmup bars needed for valueFactor indicators
    totalCalculations: number;                                                    // Total valueFactor calculations performed
}

export interface ValueFactorLoadingInput {
    algoParams: AlgoParams;                                                       // Algorithm parameters with exit conditions
    subBarResult: SubBarLoadingResult;                                            // Result from Stage 1.5 (Sub-Bar Loading)
    parentTimeframe: string;                                                      // Parent timeframe (e.g., "5m") for warmup conversion
}

/** Execute Stage 1.6: Pre-calculate valueFactor indicators at sub-bar granularity for dynamic SL/TP levels. */
export function executeValueFactorLoading(input: ValueFactorLoadingInput): ValueFactorLoadingResult {
    const { algoParams, subBarResult, parentTimeframe } = input;

    const valueFactorConfigs = extractValueFactorConfigs(algoParams);
    if (valueFactorConfigs.length === 0) return createEmptyResult();              // No dynamic SL/TP configured

    const flattenedSubBars = flattenSubBarCandles(subBarResult.subBarCandlesMap);
    if (flattenedSubBars.length === 0) return createEmptyResult();                // No sub-bar data, fall back to parent bar

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

    const warmupBars = convertWarmupToParentBars(maxWarmupCandles, subBarResult.subBarTimeframe, parentTimeframe);

    return { stopLossValueFactorMap, takeProfitValueFactorMap, stopLossIndicatorName, takeProfitIndicatorName, hasDynamicExits: true, warmupBars, totalCalculations };
}

/** Extract valueFactor indicator configs from algo parameters (longExit/shortExit with type: "DYN"). */
export function extractValueFactorConfigs(algoParams: AlgoParams): ValueFactorConfig[] {
    const configs: ValueFactorConfig[] = [];

    if (algoParams.longExit) {
        if (algoParams.longExit.stopLoss?.type === "DYN" && algoParams.longExit.stopLoss.valueFactor) {
            configs.push({ indicatorConfig: algoParams.longExit.stopLoss.valueFactor, exitType: "stopLoss", direction: "LONG", inverted: algoParams.longExit.stopLoss.inverted ?? false });
        }
        if (algoParams.longExit.takeProfit?.type === "DYN" && algoParams.longExit.takeProfit.valueFactor) {
            configs.push({ indicatorConfig: algoParams.longExit.takeProfit.valueFactor, exitType: "takeProfit", direction: "LONG", inverted: algoParams.longExit.takeProfit.inverted ?? false });
        }
    }

    if (algoParams.shortExit) {
        if (algoParams.shortExit.stopLoss?.type === "DYN" && algoParams.shortExit.stopLoss.valueFactor) {
            configs.push({ indicatorConfig: algoParams.shortExit.stopLoss.valueFactor, exitType: "stopLoss", direction: "SHORT", inverted: algoParams.shortExit.stopLoss.inverted ?? false });
        }
        if (algoParams.shortExit.takeProfit?.type === "DYN" && algoParams.shortExit.takeProfit.valueFactor) {
            configs.push({ indicatorConfig: algoParams.shortExit.takeProfit.valueFactor, exitType: "takeProfit", direction: "SHORT", inverted: algoParams.shortExit.takeProfit.inverted ?? false });
        }
    }

    return deduplicateValueFactorConfigs(configs);                                // Deduplicate: same indicator for long/short only calculated once
}

function deduplicateValueFactorConfigs(configs: ValueFactorConfig[]): ValueFactorConfig[] {
    const seen = new Map<string, ValueFactorConfig>();
    for (const config of configs) {
        const key = `${config.exitType}:${JSON.stringify(config.indicatorConfig)}`;
        if (!seen.has(key)) seen.set(key, config);
    }
    return Array.from(seen.values());
}

/** Flatten sub-bar candles map into chronological array. */
export function flattenSubBarCandles(subBarCandlesMap: Map<number, Candle[]>): Candle[] {
    const allSubBars: Candle[] = [];
    for (const subBars of subBarCandlesMap.values()) allSubBars.push(...subBars);
    allSubBars.sort((a, b) => a.bucket - b.bucket);
    return allSubBars;
}

function convertWarmupToParentBars(warmupCandles: number, subBarTimeframe: string, parentTimeframe: string): number {
    const subBarDurationSec = getTimeframeDurationSeconds(subBarTimeframe);
    const parentDurationSec = getTimeframeDurationSeconds(parentTimeframe);
    if (parentDurationSec === 0) return warmupCandles;
    return Math.ceil((warmupCandles * subBarDurationSec) / parentDurationSec);
}

function getTimeframeDurationSeconds(timeframe: string): number {
    const durationMap: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
    return durationMap[timeframe] ?? 60;
}

function createEmptyResult(): ValueFactorLoadingResult {
    return { stopLossValueFactorMap: null, takeProfitValueFactorMap: null, stopLossIndicatorName: null, takeProfitIndicatorName: null, hasDynamicExits: false, warmupBars: 0, totalCalculations: 0 };
}

/** Create lookup function for SL dynamicFactor. Returns function that gets normalized value for timestamp. */
export function createStopLossFactorLookup(result: ValueFactorLoadingResult): (timestamp: number) => number | undefined {
    if (!result.stopLossValueFactorMap) return () => undefined;
    return createValueFactorLookup({ valueFactorMap: result.stopLossValueFactorMap, isNormalized: false, indicatorName: result.stopLossIndicatorName ?? "", warmupCandles: 0 });
}

/** Create lookup function for TP dynamicFactor. */
export function createTakeProfitFactorLookup(result: ValueFactorLoadingResult): (timestamp: number) => number | undefined {
    if (!result.takeProfitValueFactorMap) return () => undefined;
    return createValueFactorLookup({ valueFactorMap: result.takeProfitValueFactorMap, isNormalized: false, indicatorName: result.takeProfitIndicatorName ?? "", warmupCandles: 0 });
}
