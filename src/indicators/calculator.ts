/**
 * Indicator Calculator
 *
 * Pre-calculates all indicator signals for the entire dataset.
 * This is the "expensive" step - done once upfront.
 */

import { makeIndicator } from "@indicators/factory.ts";
import { createChartPointsForSource } from "@indicators/conversions.ts";
import type { IndicatorConfig, Candle } from "../core/types.ts";
import { getCandlesAtResolution, type CandleMipMap } from "../simulation/mipmap/index.ts";

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
// MIP-MAP AWARE CALCULATION
// =============================================================================

/**
 * Calculate indicators using MIP-map for correct multi-resolution support.
 *
 * This is the MIP-map-aware version of calculateIndicators(). Instead of
 * receiving raw candles, it receives a pre-built MIP-map and retrieves
 * candles at each indicator's native resolution.
 *
 * @param mipMap - Pre-built candle MIP-map with multiple resolutions
 * @param configs - All indicator configs from entry/exit conditions
 * @returns SignalCache + warmup info
 *
 * @example
 * ```typescript
 * // Build MIP-map first (Stage 1.1)
 * const mipMapResult = executeMipMapBuilding({
 *     candles: dataResult.filteredCandles,
 *     candleResolution: 60,
 *     algoParams,
 *     symbol: "BTC",
 * });
 *
 * // Calculate indicators with correct resolutions
 * const { signals, warmupCandles } = calculateIndicatorsWithMipMap(
 *     mipMapResult.mipMap,
 *     indicatorConfigs
 * );
 * ```
 */
export function calculateIndicatorsWithMipMap(
    mipMap: CandleMipMap,
    configs: IndicatorConfig[]
): CalculationResult {
    const signalMap = new Map<string, boolean[]>();
    let maxWarmup = 0;

    // Get base resolution candle count for signal array sizing
    const baseLevel = mipMap.levels.get(mipMap.baseResolution);
    const baseCandleCount = baseLevel?.candles.length ?? 0;

    if (baseCandleCount === 0) {
        // Empty MIP-map, return empty result
        return {
            signals: {
                get: () => undefined,
                has: () => false,
                keys: () => [],
            },
            warmupCandles: 0,
        };
    }

    // Deduplicate configs by cache key
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

        // KEY DIFFERENCE: Get pre-aggregated candles at correct resolution
        const candles = getCandlesAtResolution(mipMap, requirements.resolution);

        // Convert to ChartPoints
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
// HELPER: Get warmup in seconds for pre-warming data loading
// =============================================================================

/**
 * Calculate the warmup period in seconds needed for a set of indicator configs.
 * This is used for pre-warming: loading extra bars before the start time so
 * indicators are fully warmed up when trading begins.
 *
 * @param configs - All indicator configs from entry/exit conditions
 * @returns Warmup period in seconds (time duration, not bar count)
 *
 * @example
 * ```typescript
 * const configs = collectIndicatorConfigs(algoParams);
 * const warmupSeconds = getWarmupSeconds(configs);
 * const preWarmStartTime = startTime - warmupSeconds;
 * ```
 */
export function getWarmupSeconds(configs: IndicatorConfig[]): number {
    let maxWarmupSeconds = 0;

    for (const config of configs) {
        const indicator = makeIndicator(config);
        const requirements = indicator.getPointRequirements();
        // Warmup in seconds = count (candles) × resolution (seconds/candle)
        const warmupSeconds = requirements.count * requirements.resolution;
        maxWarmupSeconds = Math.max(maxWarmupSeconds, warmupSeconds);
    }

    return maxWarmupSeconds;
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
