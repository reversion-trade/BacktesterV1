/** Stage 3: Signal Resampling - Aligns indicator signals to common simulation timeframe using forward-fill (sample-and-hold). */

import type { Candle, IndicatorConfig } from "../../core/types.ts";
import type { SignalCache } from "../../indicators/calculator.ts";
import {
    determineSimulationResolution,
    generateTimestamps,
    resampleSignals,
    createSignalTimestamps,
    type ResampledSignalCache,
    type SimulationResolutionResult,
    type IndicatorResolutionInfo,
    MIN_SIMULATION_RESOLUTION,
} from "../../indicators/resampler.ts";
import type { IndicatorCalculationResult } from "./indicator-calculation.ts";

export type { ResampledSignalCache };

export interface ResamplingResult {
    resampledSignals: ResampledSignalCache;                                       // Signals aligned to simulation resolution
    simulationResolution: number;                                                 // Simulation resolution in seconds
    simulationTimestamps: number[];                                               // Timestamps at simulation resolution
    indicatorResolutions: IndicatorResolutionInfo[];                              // Resolution info per indicator (for debugging)
    minIndicatorResolution: number;                                               // Minimum resolution across all indicators
    warmupBars: number;                                                           // Max warmup period in simulation bars
    totalSimulationBars: number;                                                  // Number of simulation bars after resampling
    resamplingStats: ResamplingStats;                                             // Statistics for auditing
}

export interface ResamplingStats {
    indicatorsResampled: number;                                                  // Number of indicators resampled
    upsampledCount: number;                                                       // Indicators upsampled (higher res → sim res)
    downsampledCount: number;                                                     // Indicators downsampled (lower res → sim res)
    noResampleCount: number;                                                      // Indicators already at simulation resolution
    originalSignalPoints: number;                                                 // Total original signal points
    resampledSignalPoints: number;                                                // Total resampled signal points
}

export interface ResamplingInput {
    candles: Candle[];                                                            // Candles (for determining time range)
    signalCache: SignalCache;                                                     // Signal cache from Stage 2
    indicatorConfigs: IndicatorConfig[];                                          // Indicator configs (for resolution)
    warmupCandles: number;                                                        // Warmup candles from Stage 2
}

/** Execute Stage 3: Resample all signals to simulation timeframe. Forward-fills signals between updates. */
export function executeResampling(input: ResamplingInput): ResamplingResult {
    const { candles, signalCache, indicatorConfigs, warmupCandles } = input;

    if (candles.length === 0) {                                                   // Handle empty candles
        return {
            resampledSignals: { get: () => undefined, has: () => false, keys: () => [], getResolution: () => MIN_SIMULATION_RESOLUTION, getTimestamps: () => [] },
            simulationResolution: MIN_SIMULATION_RESOLUTION,
            simulationTimestamps: [],
            indicatorResolutions: [],
            minIndicatorResolution: MIN_SIMULATION_RESOLUTION,
            warmupBars: 0,
            totalSimulationBars: 0,
            resamplingStats: { indicatorsResampled: 0, upsampledCount: 0, downsampledCount: 0, noResampleCount: 0, originalSignalPoints: 0, resampledSignalPoints: 0 },
        };
    }

    const resolutionResult = determineSimulationResolution(indicatorConfigs);     // Step 1: Determine simulation resolution
    const { simulationResolution, minIndicatorResolution, indicatorResolutions } = resolutionResult;

    const startTime = candles[0]?.bucket ?? 0;                                    // Step 2: Generate simulation timestamps
    const endTime = candles[candles.length - 1]?.bucket ?? 0;
    const simulationTimestamps = generateTimestamps(startTime, endTime, simulationResolution);

    const resampledMap = new Map<string, boolean[]>();                            // Step 3: Resample each indicator's signals
    const stats: ResamplingStats = { indicatorsResampled: 0, upsampledCount: 0, downsampledCount: 0, noResampleCount: 0, originalSignalPoints: 0, resampledSignalPoints: 0 };

    for (const key of signalCache.keys()) {
        const originalSignals = signalCache.get(key);
        if (!originalSignals) continue;

        const resInfo = indicatorResolutions.find((r) => r.cacheKey === key);
        const indicatorResolution = resInfo?.resolution ?? MIN_SIMULATION_RESOLUTION;
        const signalTimestamps = createSignalTimestamps(startTime, originalSignals.length, indicatorResolution);
        const resampled = resampleSignals(originalSignals, signalTimestamps, simulationTimestamps);

        resampledMap.set(key, resampled);
        stats.indicatorsResampled++;
        stats.originalSignalPoints += originalSignals.length;
        stats.resampledSignalPoints += resampled.length;

        if (indicatorResolution > simulationResolution) stats.upsampledCount++;
        else if (indicatorResolution < simulationResolution) stats.downsampledCount++;
        else stats.noResampleCount++;
    }

    const resampledSignals: ResampledSignalCache = {                              // Step 4: Build resampled cache interface
        get: (key) => resampledMap.get(key),
        has: (key) => resampledMap.has(key),
        keys: () => Array.from(resampledMap.keys()),
        getResolution: () => simulationResolution,
        getTimestamps: () => simulationTimestamps,
    };

    const warmupBars = Math.ceil((warmupCandles * MIN_SIMULATION_RESOLUTION) / simulationResolution);

    return {
        resampledSignals,
        simulationResolution,
        simulationTimestamps,
        indicatorResolutions,
        minIndicatorResolution,
        warmupBars,
        totalSimulationBars: simulationTimestamps.length,
        resamplingStats: stats,
    };
}

/** Create ResamplingInput from previous stage results for stage chaining. */
export function createResamplingInput(candles: Candle[], indicatorResult: IndicatorCalculationResult): ResamplingInput {
    return { candles, signalCache: indicatorResult.signalCache, indicatorConfigs: indicatorResult.indicatorConfigs, warmupCandles: indicatorResult.warmupCandles };
}
