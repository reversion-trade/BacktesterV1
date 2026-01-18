/**
 * Signal Resampler - Handles resolution management and signal resampling. See docs/RESOLUTION_STRATEGY.md.
 */

import { makeIndicator } from "@indicators/factory.ts";
import { CANDLE_BUCKETS } from "@indicators/common.ts";
import type { IndicatorConfig } from "@indicators/factory.ts";

// CONSTANTS

export const MIN_SIMULATION_RESOLUTION = 60;                                    // Minimum simulation resolution in seconds (1 minute floor)
export const RESOLUTION_BUCKETS = [...CANDLE_BUCKETS].sort((a, b) => a - b);    // Available candle bucket resolutions (sorted ascending)

// TYPES

export interface IndicatorResolutionInfo {
    cacheKey: string;                                   // Indicator's unique cache key
    resolution: number;                                 // Resolution in seconds
    warmupCount: number;                                // Number of candles needed for warmup
}

export interface SimulationResolutionResult {
    simulationResolution: number;                       // The simulation resolution in seconds
    minIndicatorResolution: number;                     // Minimum indicator resolution found
    indicatorResolutions: IndicatorResolutionInfo[];    // Resolution info for each indicator
    maxWarmupCandles: number;                           // Maximum warmup period across all indicators
}

export interface ResampledSignalCache {
    get(key: string): boolean[] | undefined;            // Get resampled signals by cache key
    has(key: string): boolean;                          // Check if indicator has been resampled
    keys(): string[];                                   // Get all cache keys
    getResolution(): number;                            // Get the simulation resolution
    getTimestamps(): number[];                          // Get simulation timestamps
}

// RESOLUTION DETERMINATION

export function getNextLowerBucket(resolution: number): number { // Find largest bucket strictly less than resolution
    let result = RESOLUTION_BUCKETS[0]!;
    for (const bucket of RESOLUTION_BUCKETS) {
        if (bucket < resolution) result = bucket;
        else break;
    }
    return result;
}

export function collectIndicatorResolutions(configs: IndicatorConfig[]): IndicatorResolutionInfo[] {
    const seen = new Set<string>();
    const results: IndicatorResolutionInfo[] = [];

    for (const config of configs) {
        const indicator = makeIndicator(config);
        const key = indicator.getCacheKey();
        if (seen.has(key)) continue;
        seen.add(key);

        const requirements = indicator.getPointRequirements();
        results.push({ cacheKey: key, resolution: requirements.resolution, warmupCount: requirements.count });
    }
    return results;
}

export function determineSimulationResolution(configs: IndicatorConfig[]): SimulationResolutionResult {
    const indicatorResolutions = collectIndicatorResolutions(configs);

    if (indicatorResolutions.length === 0) {
        return { simulationResolution: MIN_SIMULATION_RESOLUTION, minIndicatorResolution: MIN_SIMULATION_RESOLUTION, indicatorResolutions: [], maxWarmupCandles: 0 };
    }

    const minIndicatorResolution = Math.min(...indicatorResolutions.map((r) => r.resolution));
    const maxWarmupCandles = Math.max(...indicatorResolutions.map((r) => r.warmupCount));
    const nextLower = getNextLowerBucket(minIndicatorResolution);
    const simulationResolution = Math.max(nextLower, MIN_SIMULATION_RESOLUTION); // Floor at minimum

    return { simulationResolution, minIndicatorResolution, indicatorResolutions, maxWarmupCandles };
}

// SIGNAL RESAMPLING

export function generateTimestamps(startTime: number, endTime: number, resolution: number): number[] {
    const timestamps: number[] = [];
    for (let t = startTime; t <= endTime; t += resolution) timestamps.push(t);
    return timestamps;
}

export function resampleSignals(signals: boolean[], signalTimes: number[], simulationTimes: number[]): boolean[] { // Forward-fill (sample-and-hold) strategy
    if (signals.length === 0 || simulationTimes.length === 0) return new Array(simulationTimes.length).fill(false);
    if (signalTimes.length !== signals.length) throw new Error(`Signal array length (${signals.length}) must match signalTimes length (${signalTimes.length})`);

    const resampled: boolean[] = [];
    let signalIndex = 0;

    for (const simTime of simulationTimes) {
        while (signalIndex < signalTimes.length - 1 && signalTimes[signalIndex + 1]! <= simTime) signalIndex++; // Advance to most recent signal at or before simTime
        if (simTime < signalTimes[0]!) resampled.push(false); // Before all signals
        else resampled.push(signals[signalIndex]!);
    }
    return resampled;
}

export function createSignalTimestamps(startTime: number, signalCount: number, resolution: number): number[] {
    return Array.from({ length: signalCount }, (_, i) => startTime + i * resolution);
}

// RESAMPLED CACHE BUILDER

export interface IndicatorCalculationWithResolution {
    signals: Map<string, boolean[]>;                    // Indicator signals by cache key
    signalTimes: Map<string, number[]>;                 // Timestamps for each indicator's signals
    resolutions: Map<string, number>;                   // Resolution for each indicator
    warmupCandles: number;                              // Max warmup across indicators
}

export function buildResampledCache(calculations: IndicatorCalculationWithResolution, simulationTimes: number[], simulationResolution: number): ResampledSignalCache {
    const resampledSignals = new Map<string, boolean[]>();

    for (const [key, signals] of calculations.signals) {
        const signalTimes = calculations.signalTimes.get(key);
        if (!signalTimes) throw new Error(`Missing signal times for indicator: ${key}`);
        resampledSignals.set(key, resampleSignals(signals, signalTimes, simulationTimes));
    }

    return {
        get: (key) => resampledSignals.get(key),
        has: (key) => resampledSignals.has(key),
        keys: () => Array.from(resampledSignals.keys()),
        getResolution: () => simulationResolution,
        getTimestamps: () => simulationTimes,
    };
}
