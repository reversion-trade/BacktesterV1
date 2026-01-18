/** ValueFactor Calculation - Calculates normalized indicators (0-100) for dynamic SL/TP. Only "Normalized" tagged indicators supported. */

import type { Candle, IndicatorConfig } from "../core/types.ts";
import { makeIndicator, IndicatorsRegistry } from "@indicators/factory.ts";
import { createChartPointsForSource } from "@indicators/conversions.ts";

export interface ValueFactorResult {
    timestamp: number;                                                          // Timestamp of this calculation (sub-bar bucket)
    rawValue: number;                                                           // Indicator value (already 0-100 for normalized)
    normalizedValue: number;                                                    // Same as rawValue for normalized indicators
}

export interface ValueFactorCalculationResult {
    valueFactorMap: Map<number, ValueFactorResult>;                             // Timestamp → value factor result
    isNormalized: boolean;                                                      // Always true for supported indicators
    indicatorName: string;                                                      // Indicator name for debugging
    warmupCandles: number;                                                      // Warmup candles required by this indicator
    error?: string;                                                             // Error message if indicator not supported
}

/** Pre-calculate valueFactor indicator values for all sub-bar candles. Only normalized indicators (RSI, StochRSI, etc.) supported. */
export function calculateValueFactors(indicatorConfig: IndicatorConfig, subBarCandles: Candle[]): ValueFactorCalculationResult {
    const indicatorName = indicatorConfig.type;

    if (!isIndicatorSupported(indicatorName)) {
        const supportedList = getSupportedIndicators().join(", ");
        return {
            valueFactorMap: new Map(), isNormalized: false, indicatorName, warmupCandles: 0,
            error: `Indicator "${indicatorName}" not supported as valueFactor. Only normalized (0-100) allowed: ${supportedList}.`,
        };
    }

    if (subBarCandles.length === 0) return { valueFactorMap: new Map(), isNormalized: true, indicatorName, warmupCandles: 0 };

    const indicator = makeIndicator(indicatorConfig);
    const requirements = indicator.getPointRequirements();
    const warmupCandles = requirements.count;
    const source = indicator.params.source || "close";
    const chartPoints = createChartPointsForSource(subBarCandles, source, requirements.resolution);
    const results = indicator.calculate(chartPoints);
    const offset = subBarCandles.length - results.length;                       // Results shorter than candles due to warmup

    const valueFactorMap = new Map<number, ValueFactorResult>();
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result && typeof result.value === "number") {
            const timestamp = subBarCandles[offset + i]!.bucket;
            const value = Math.max(0, Math.min(100, result.value));             // Clamp to 0-100
            valueFactorMap.set(timestamp, { timestamp, rawValue: result.value, normalizedValue: value });
        }
    }

    return { valueFactorMap, isNormalized: true, indicatorName, warmupCandles };
}

/** Create a lookup function for value factors. Returns normalized value (0-100) for timestamp. */
export function createValueFactorLookup(result: ValueFactorCalculationResult): (timestamp: number) => number | undefined {
    return (timestamp: number) => {
        const exact = result.valueFactorMap.get(timestamp);                     // Try exact match first
        if (exact) return exact.normalizedValue;

        let closestTimestamp: number | undefined, closestValue: number | undefined;
        for (const [ts, vf] of result.valueFactorMap) {                         // Find closest timestamp <= target
            if (ts <= timestamp && (closestTimestamp === undefined || ts > closestTimestamp)) {
                closestTimestamp = ts;
                closestValue = vf.normalizedValue;
            }
        }
        return closestValue;
    };
}

/** Check if indicator has "Normalized" tag (0-100 output). */
function isIndicatorSupported(indicatorName: string): boolean {
    const metadata = IndicatorsRegistry[indicatorName as keyof typeof IndicatorsRegistry];
    if (metadata && "tags" in metadata) return (metadata.tags as readonly string[]).includes("Normalized");
    return false;
}

/** Get list of supported valueFactor indicators (those with "Normalized" tag). */
function getSupportedIndicators(): string[] {
    const supported: string[] = [];
    for (const [name, metadata] of Object.entries(IndicatorsRegistry)) {
        if ("tags" in metadata && (metadata.tags as readonly string[]).includes("Normalized")) supported.push(name);
    }
    return supported;
}
