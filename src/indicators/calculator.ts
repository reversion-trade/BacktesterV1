/**
 * Indicator Calculator - Pre-calculates all indicator signals for the entire dataset.
 */

import { makeIndicator } from "@indicators/factory.ts";
import { createChartPointsForSource } from "@indicators/conversions.ts";
import type { IndicatorConfig, Candle, AlgoParams } from "../core/types.ts";
import { getCandlesAtResolution, type CandleMipMap } from "../simulation/mipmap/index.ts";

// TYPES

export interface SignalCache {                          // Cache of pre-calculated signals (key = indicator cache key, value = boolean[] per candle)
    get(key: string): boolean[] | undefined;            // Get signals for an indicator
    has(key: string): boolean;                          // Check if indicator has been calculated
    keys(): string[];                                   // Get all cache keys
}

export interface CalculationResult {
    signals: SignalCache;                               // The signal cache
    warmupCandles: number;                              // Maximum warmup period across all indicators (in candles)
}

// MAIN FUNCTION

export function calculateIndicators(candles: Candle[], configs: IndicatorConfig[]): CalculationResult {
    const signalMap = new Map<string, boolean[]>();
    let maxWarmup = 0;

    const uniqueIndicators = new Map<string, ReturnType<typeof makeIndicator>>(); // Dedupe by cache key (same indicator may appear in multiple conditions)
    for (const config of configs) {
        const indicator = makeIndicator(config);
        const key = indicator.getCacheKey();
        if (!uniqueIndicators.has(key)) uniqueIndicators.set(key, indicator);
    }

    for (const [key, indicator] of uniqueIndicators) {
        const requirements = indicator.getPointRequirements();
        maxWarmup = Math.max(maxWarmup, requirements.count);

        const source = indicator.params.source;
        const chartPoints = createChartPointsForSource(candles, source, requirements.resolution);
        const results = indicator.calculate(chartPoints);

        const signals = new Array<boolean>(candles.length).fill(false); // Pad beginning with false (results shorter due to warmup)
        const offset = candles.length - results.length;
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result) signals[offset + i] = result.signal;
        }
        signalMap.set(key, signals);
    }

    return {
        signals: { get: (key) => signalMap.get(key), has: (key) => signalMap.has(key), keys: () => Array.from(signalMap.keys()) },
        warmupCandles: maxWarmup,
    };
}

// MIP-MAP AWARE CALCULATION

export function calculateIndicatorsWithMipMap(mipMap: CandleMipMap, configs: IndicatorConfig[]): CalculationResult {
    const signalMap = new Map<string, boolean[]>();
    let maxWarmup = 0;

    const baseLevel = mipMap.levels.get(mipMap.baseResolution);
    const baseCandleCount = baseLevel?.candles.length ?? 0;

    if (baseCandleCount === 0) { // Empty MIP-map, return empty result
        return { signals: { get: () => undefined, has: () => false, keys: () => [] }, warmupCandles: 0 };
    }

    const uniqueIndicators = new Map<string, ReturnType<typeof makeIndicator>>(); // Dedupe by cache key
    for (const config of configs) {
        const indicator = makeIndicator(config);
        const key = indicator.getCacheKey();
        if (!uniqueIndicators.has(key)) uniqueIndicators.set(key, indicator);
    }

    for (const [key, indicator] of uniqueIndicators) {
        const requirements = indicator.getPointRequirements();
        maxWarmup = Math.max(maxWarmup, requirements.count);

        const candles = getCandlesAtResolution(mipMap, requirements.resolution); // KEY: Get pre-aggregated candles at correct resolution
        const source = indicator.params.source;
        const chartPoints = createChartPointsForSource(candles, source, requirements.resolution);
        const results = indicator.calculate(chartPoints);

        const signals = new Array<boolean>(candles.length).fill(false); // Pad beginning with false
        const offset = candles.length - results.length;
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result) signals[offset + i] = result.signal;
        }
        signalMap.set(key, signals);
    }

    return {
        signals: { get: (key) => signalMap.get(key), has: (key) => signalMap.has(key), keys: () => Array.from(signalMap.keys()) },
        warmupCandles: maxWarmup,
    };
}

// HELPERS

export function getWarmupSeconds(configs: IndicatorConfig[]): number { // Calculate warmup in seconds for pre-warming data loading
    let maxWarmupSeconds = 0;
    for (const config of configs) {
        const indicator = makeIndicator(config);
        const requirements = indicator.getPointRequirements();
        const warmupSeconds = requirements.count * requirements.resolution; // Warmup = count (candles) × resolution (seconds/candle)
        maxWarmupSeconds = Math.max(maxWarmupSeconds, warmupSeconds);
    }
    return maxWarmupSeconds;
}

export function collectIndicatorConfigs(algoParams: AlgoParams): IndicatorConfig[] { // Extract all indicator configs from AlgoParams
    const configs: IndicatorConfig[] = [];
    if (algoParams.longEntry) { configs.push(...algoParams.longEntry.required, ...algoParams.longEntry.optional); }
    if (algoParams.longExit) { configs.push(...algoParams.longExit.required, ...algoParams.longExit.optional); }
    if (algoParams.shortEntry) { configs.push(...algoParams.shortEntry.required, ...algoParams.shortEntry.optional); }
    if (algoParams.shortExit) { configs.push(...algoParams.shortExit.required, ...algoParams.shortExit.optional); }
    return configs;
}
