/**
 * Signal Resampler
 *
 * Handles resolution management and signal resampling for the backtester.
 * See docs/RESOLUTION_STRATEGY.md for detailed explanation.
 */

import { makeIndicator } from "@indicators/factory.ts";
import { CANDLE_BUCKETS } from "@indicators/common.ts";
import type { IndicatorConfig } from "@indicators/factory.ts";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Minimum simulation resolution in seconds (1 minute).
 * This is the floor for user-facing backtests.
 */
export const MIN_SIMULATION_RESOLUTION = 60;

/**
 * Available candle bucket resolutions in seconds.
 * Must be sorted ascending.
 */
export const RESOLUTION_BUCKETS = [...CANDLE_BUCKETS].sort((a, b) => a - b);

// =============================================================================
// TYPES
// =============================================================================

/**
 * Information about an indicator's resolution requirements.
 */
export interface IndicatorResolutionInfo {
    cacheKey: string;
    resolution: number;
    warmupCount: number;
}

/**
 * Result of determining simulation resolution.
 */
export interface SimulationResolutionResult {
    /** The simulation resolution in seconds */
    simulationResolution: number;
    /** Minimum indicator resolution found */
    minIndicatorResolution: number;
    /** Resolution info for each indicator */
    indicatorResolutions: IndicatorResolutionInfo[];
    /** Maximum warmup period across all indicators */
    maxWarmupCandles: number;
}

/**
 * Resampled signal cache with timestamps.
 */
export interface ResampledSignalCache {
    /** Get resampled signals for an indicator by cache key */
    get(key: string): boolean[] | undefined;
    /** Check if indicator has been resampled */
    has(key: string): boolean;
    /** Get all cache keys */
    keys(): string[];
    /** Get the simulation resolution */
    getResolution(): number;
    /** Get simulation timestamps */
    getTimestamps(): number[];
}

// =============================================================================
// RESOLUTION DETERMINATION
// =============================================================================

/**
 * Get the next lower bucket from the available resolutions.
 *
 * @param resolution - Current resolution in seconds
 * @returns Next lower bucket, or the same if already at minimum
 *
 * @example
 * getNextLowerBucket(300) // 60 (5m → 1m)
 * getNextLowerBucket(60)  // 15 (1m → 15s)
 * getNextLowerBucket(15)  // 15 (already at minimum)
 */
export function getNextLowerBucket(resolution: number): number {
    // Find the largest bucket that is strictly less than resolution
    let result = RESOLUTION_BUCKETS[0]!;

    for (const bucket of RESOLUTION_BUCKETS) {
        if (bucket < resolution) {
            result = bucket;
        } else {
            break;
        }
    }

    return result;
}

/**
 * Collect resolution information from all indicator configs.
 *
 * @param configs - Array of indicator configurations
 * @returns Array of resolution info for each unique indicator
 */
export function collectIndicatorResolutions(configs: IndicatorConfig[]): IndicatorResolutionInfo[] {
    const seen = new Set<string>();
    const results: IndicatorResolutionInfo[] = [];

    for (const config of configs) {
        const indicator = makeIndicator(config);
        const key = indicator.getCacheKey();

        if (seen.has(key)) continue;
        seen.add(key);

        const requirements = indicator.getPointRequirements();
        results.push({
            cacheKey: key,
            resolution: requirements.resolution,
            warmupCount: requirements.count,
        });
    }

    return results;
}

/**
 * Determine the simulation resolution based on indicator requirements.
 *
 * Strategy:
 * 1. Find the minimum resolution across all indicators
 * 2. Get the next lower bucket for finer TP/SL tracking
 * 3. Floor at MIN_SIMULATION_RESOLUTION (1m)
 *
 * @param configs - Array of indicator configurations
 * @returns Simulation resolution details
 */
export function determineSimulationResolution(configs: IndicatorConfig[]): SimulationResolutionResult {
    const indicatorResolutions = collectIndicatorResolutions(configs);

    if (indicatorResolutions.length === 0) {
        return {
            simulationResolution: MIN_SIMULATION_RESOLUTION,
            minIndicatorResolution: MIN_SIMULATION_RESOLUTION,
            indicatorResolutions: [],
            maxWarmupCandles: 0,
        };
    }

    // Find minimum resolution and max warmup
    const minIndicatorResolution = Math.min(...indicatorResolutions.map((r) => r.resolution));
    const maxWarmupCandles = Math.max(...indicatorResolutions.map((r) => r.warmupCount));

    // Get next lower bucket, floored at minimum
    const nextLower = getNextLowerBucket(minIndicatorResolution);
    const simulationResolution = Math.max(nextLower, MIN_SIMULATION_RESOLUTION);

    return {
        simulationResolution,
        minIndicatorResolution,
        indicatorResolutions,
        maxWarmupCandles,
    };
}

// =============================================================================
// SIGNAL RESAMPLING
// =============================================================================

/**
 * Generate timestamps at a given resolution for a time range.
 *
 * @param startTime - Start timestamp in seconds
 * @param endTime - End timestamp in seconds
 * @param resolution - Resolution in seconds
 * @returns Array of timestamps
 */
export function generateTimestamps(startTime: number, endTime: number, resolution: number): number[] {
    const timestamps: number[] = [];

    for (let t = startTime; t <= endTime; t += resolution) {
        timestamps.push(t);
    }

    return timestamps;
}

/**
 * Resample signals from indicator resolution to simulation resolution.
 * Uses forward-fill (sample-and-hold) strategy.
 *
 * @param signals - Original signals at indicator resolution
 * @param signalTimes - Timestamps at indicator resolution
 * @param simulationTimes - Timestamps at simulation resolution
 * @returns Resampled signals at simulation resolution
 *
 * @example
 * // EMA at 5m resolution, simulation at 1m
 * const signals = [true, true, false];
 * const signalTimes = [0, 300, 600];  // 0s, 5m, 10m
 * const simTimes = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600];
 * resampleSignals(signals, signalTimes, simTimes);
 * // [true, true, true, true, true, true, true, true, true, true, false]
 */
export function resampleSignals(signals: boolean[], signalTimes: number[], simulationTimes: number[]): boolean[] {
    if (signals.length === 0 || simulationTimes.length === 0) {
        return new Array(simulationTimes.length).fill(false);
    }

    if (signalTimes.length !== signals.length) {
        throw new Error(
            `Signal array length (${signals.length}) must match signalTimes length (${signalTimes.length})`
        );
    }

    const resampled: boolean[] = [];
    let signalIndex = 0;

    for (const simTime of simulationTimes) {
        // Advance to the most recent signal at or before simTime
        while (signalIndex < signalTimes.length - 1 && signalTimes[signalIndex + 1]! <= simTime) {
            signalIndex++;
        }

        // If simTime is before all signals, use false
        if (simTime < signalTimes[0]!) {
            resampled.push(false);
        } else {
            resampled.push(signals[signalIndex]!);
        }
    }

    return resampled;
}

/**
 * Create timestamps for signals based on candle data.
 *
 * @param startTime - First candle timestamp
 * @param signalCount - Number of signals
 * @param resolution - Resolution between signals in seconds
 * @returns Array of timestamps
 */
export function createSignalTimestamps(startTime: number, signalCount: number, resolution: number): number[] {
    return Array.from({ length: signalCount }, (_, i) => startTime + i * resolution);
}

// =============================================================================
// RESAMPLED CACHE BUILDER
// =============================================================================

/**
 * Result from calculateIndicators that includes resolution info.
 */
export interface IndicatorCalculationWithResolution {
    signals: Map<string, boolean[]>;
    signalTimes: Map<string, number[]>;
    resolutions: Map<string, number>;
    warmupCandles: number;
}

/**
 * Build a resampled signal cache from indicator calculations.
 *
 * @param calculations - Indicator calculations with resolution info
 * @param simulationTimes - Target simulation timestamps
 * @param simulationResolution - Target simulation resolution
 * @returns Resampled signal cache
 */
export function buildResampledCache(
    calculations: IndicatorCalculationWithResolution,
    simulationTimes: number[],
    simulationResolution: number
): ResampledSignalCache {
    const resampledSignals = new Map<string, boolean[]>();

    for (const [key, signals] of calculations.signals) {
        const signalTimes = calculations.signalTimes.get(key);

        if (!signalTimes) {
            throw new Error(`Missing signal times for indicator: ${key}`);
        }

        const resampled = resampleSignals(signals, signalTimes, simulationTimes);
        resampledSignals.set(key, resampled);
    }

    return {
        get: (key) => resampledSignals.get(key),
        has: (key) => resampledSignals.has(key),
        keys: () => Array.from(resampledSignals.keys()),
        getResolution: () => simulationResolution,
        getTimestamps: () => simulationTimes,
    };
}
