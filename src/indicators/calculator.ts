/**
 * Indicator Calculator
 *
 * Pre-calculates all indicator signals for the entire dataset.
 * This is the "expensive" step - done once upfront.
 */

import { makeIndicator } from "@indicators/factory.ts";
import { createChartPointsForSource } from "@indicators/conversions.ts";
import type { IndicatorConfig, Candle } from "../core/types.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Cache of pre-calculated signals.
 * Key = indicator's unique cache key (based on type + params)
 * Value = array of booleans, one per candle
 */
export interface SignalCache {
    /** Get signals for an indicator (by cache key) */
    get(key: string): boolean[] | undefined;

    /** Check if indicator has been calculated */
    has(key: string): boolean;

    /** Get all cache keys */
    keys(): string[];
}

/**
 * Result of calculating all indicators
 */
export interface CalculationResult {
    /** The signal cache */
    signals: SignalCache;

    /** Maximum warmup period across all indicators (in candles) */
    warmupCandles: number;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Pre-calculate signals for all indicators in the given configs.
 *
 * @param candles - Historical price data
 * @param configs - All indicator configs from entry/exit conditions
 * @returns SignalCache + warmup info
 *
 * @example
 * const allConfigs = [
 *   ...algoParams.longEntry.required,
 *   ...algoParams.longEntry.optional,
 *   ...algoParams.longExit.required,
 *   // etc.
 * ];
 * const { signals, warmupCandles } = calculateIndicators(candles, allConfigs);
 *
 * // Later, check if RSI signaled at candle 50:
 * const rsiKey = makeIndicator(rsiConfig).getCacheKey();
 * const didSignal = signals.get(rsiKey)?.[50] ?? false;
 */
export function calculateIndicators(candles: Candle[], configs: IndicatorConfig[]): CalculationResult {
    const signalMap = new Map<string, boolean[]>();
    let maxWarmup = 0;

    // Deduplicate configs by cache key
    // (same indicator might appear in multiple conditions)
    const uniqueIndicators = new Map<string, ReturnType<typeof makeIndicator>>();

    for (const config of configs) {
        const indicator = makeIndicator(config);
        const key = indicator.getCacheKey();

        if (!uniqueIndicators.has(key)) {
            uniqueIndicators.set(key, indicator);
        }
    }

    // Calculate each unique indicator
    for (const [key, indicator] of uniqueIndicators) {
        // Get warmup requirements
        const requirements = indicator.getPointRequirements();
        maxWarmup = Math.max(maxWarmup, requirements.count);

        // Convert candles to ChartPoints for this indicator's source type
        const source = indicator.params.source;
        const chartPoints = createChartPointsForSource(candles, source, requirements.resolution);

        // Calculate indicator over all data
        const results = indicator.calculate(chartPoints);

        // Extract boolean signals
        // Results array is shorter than candles (missing warmup period)
        // So we pad the beginning with `false`
        const signals = new Array<boolean>(candles.length).fill(false);
        const offset = candles.length - results.length;

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result) {
                signals[offset + i] = result.signal;
            }
        }

        signalMap.set(key, signals);
    }

    // Build the cache interface
    const cache: SignalCache = {
        get: (key) => signalMap.get(key),
        has: (key) => signalMap.has(key),
        keys: () => Array.from(signalMap.keys()),
    };

    return {
        signals: cache,
        warmupCandles: maxWarmup,
    };
}

// =============================================================================
// HELPER: Collect all configs from AlgoParams
// =============================================================================

import type { AlgoParams } from "../core/types.ts";

/**
 * Extract all indicator configs from an AlgoParams object.
 * Collects from all entry/exit conditions (required + optional).
 *
 * @param algoParams - The algorithm parameters
 * @returns Flat array of all IndicatorConfigs
 */
export function collectIndicatorConfigs(algoParams: AlgoParams): IndicatorConfig[] {
    const configs: IndicatorConfig[] = [];

    // Long entry
    if (algoParams.longEntry) {
        configs.push(...algoParams.longEntry.required);
        configs.push(...algoParams.longEntry.optional);
    }

    // Long exit
    if (algoParams.longExit) {
        configs.push(...algoParams.longExit.required);
        configs.push(...algoParams.longExit.optional);
    }

    // Short entry
    if (algoParams.shortEntry) {
        configs.push(...algoParams.shortEntry.required);
        configs.push(...algoParams.shortEntry.optional);
    }

    // Short exit
    if (algoParams.shortExit) {
        configs.push(...algoParams.shortExit.required);
        configs.push(...algoParams.shortExit.optional);
    }

    return configs;
}
