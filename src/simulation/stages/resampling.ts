/**
 * Stage 3: Signal Resampling
 *
 * @module simulation/stages/resampling
 * @description
 * Third stage in the backtester pipeline. CRITICAL STAGE.
 *
 * This stage is responsible for:
 * - Aligning indicator signals to a common simulation timeframe
 * - Forward-filling signals (sample-and-hold) between updates
 * - Handling multi-resolution indicators (e.g., 5m EMA + 1h RSI)
 *
 * @architecture
 * **CRITICAL:**
 * Resampling and simulation should be separate stages, not combined.
 *
 * This separation ensures:
 * 1. Clear data flow - signals are pre-aligned before simulation
 * 2. Testability - resampling logic can be tested independently
 * 3. Performance - resampling is done once, not per-bar
 * 4. Correctness - forward-fill behavior is explicit and auditable
 *
 * Input: IndicatorCalculationResult (from Stage 2)
 * Output: ResamplingResult with aligned signals for simulation
 *
 * @forward-fill-strategy
 * Signals are forward-filled using sample-and-hold:
 * - When a new signal arrives, it replaces the previous value
 * - Between signal updates, the last known value is maintained
 * - This matches how indicators work in live trading
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Purpose: Extract resampling from embedded simulation logic
 * - Implements explicit stage separation requirement
 * - Wraps existing resampler.ts functions in stage interface
 */

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

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of Stage 3: Signal Resampling
 *
 * Contains signals aligned to simulation timeframe, ready for the simulation loop.
 */
export interface ResamplingResult {
    /** Resampled signal cache aligned to simulation resolution */
    resampledSignals: ResampledSignalCache;

    /** Simulation resolution in seconds */
    simulationResolution: number;

    /** Timestamps at simulation resolution */
    simulationTimestamps: number[];

    /** Resolution information for each indicator (for debugging) */
    indicatorResolutions: IndicatorResolutionInfo[];

    /** Minimum resolution found across all indicators */
    minIndicatorResolution: number;

    /** Maximum warmup period in simulation bars */
    warmupBars: number;

    /** Number of simulation bars (after resampling) */
    totalSimulationBars: number;

    /** Resampling statistics for auditing */
    resamplingStats: ResamplingStats;
}

/**
 * Statistics about the resampling process for auditing.
 */
export interface ResamplingStats {
    /** Number of indicators resampled */
    indicatorsResampled: number;

    /** Indicators that required upsampling (higher res → sim res) */
    upsampledCount: number;

    /** Indicators that required downsampling (lower res → sim res) */
    downsampledCount: number;

    /** Indicators already at simulation resolution */
    noResampleCount: number;

    /** Total original signal points */
    originalSignalPoints: number;

    /** Total resampled signal points */
    resampledSignalPoints: number;
}

/**
 * Input for Stage 3.
 */
export interface ResamplingInput {
    /** Candles (for determining time range) */
    candles: Candle[];

    /** Signal cache from Stage 2 */
    signalCache: SignalCache;

    /** Indicator configs (for resolution determination) */
    indicatorConfigs: IndicatorConfig[];

    /** Warmup candles from Stage 2 */
    warmupCandles: number;
}

// =============================================================================
// STAGE 3: SIGNAL RESAMPLING
// =============================================================================

/**
 * Execute Stage 3: Resample all signals to simulation timeframe.
 *
 * This is a CRITICAL stage that ensures all indicator signals are
 * aligned to a common timeframe before simulation begins.
 *
 * @param input - Resampling input (candles, signals, configs)
 * @returns ResamplingResult with aligned signals
 *
 * @example
 * ```typescript
 * // From Stage 2 result:
 * const resamplingResult = executeResampling({
 *   candles: dataResult.filteredCandles,
 *   signalCache: indicatorResult.signalCache,
 *   indicatorConfigs: indicatorResult.indicatorConfigs,
 *   warmupCandles: indicatorResult.warmupCandles,
 * });
 *
 * // Signals are now aligned and ready for Stage 5 (simulation)
 * const simBars = resamplingResult.totalSimulationBars;
 * ```
 *
 * @audit-note
 * Forward-fill behavior:
 * - Each signal value persists until a new value arrives
 * - This matches live trading where indicators update at their resolution
 * - Example: 5m EMA updates every 5 minutes, value holds between updates
 */
export function executeResampling(input: ResamplingInput): ResamplingResult {
    const { candles, signalCache, indicatorConfigs, warmupCandles } = input;

    // Handle empty candles - return empty result
    if (candles.length === 0) {
        const emptySignals: ResampledSignalCache = {
            get: () => undefined,
            has: () => false,
            keys: () => [],
            getResolution: () => MIN_SIMULATION_RESOLUTION,
            getTimestamps: () => [],
        };

        return {
            resampledSignals: emptySignals,
            simulationResolution: MIN_SIMULATION_RESOLUTION,
            simulationTimestamps: [],
            indicatorResolutions: [],
            minIndicatorResolution: MIN_SIMULATION_RESOLUTION,
            warmupBars: 0,
            totalSimulationBars: 0,
            resamplingStats: {
                indicatorsResampled: 0,
                upsampledCount: 0,
                downsampledCount: 0,
                noResampleCount: 0,
                originalSignalPoints: 0,
                resampledSignalPoints: 0,
            },
        };
    }

    // Step 1: Determine simulation resolution
    const resolutionResult = determineSimulationResolution(indicatorConfigs);
    const { simulationResolution, minIndicatorResolution, indicatorResolutions } = resolutionResult;

    // Step 2: Generate simulation timestamps
    const startTime = candles[0]?.bucket ?? 0;
    const endTime = candles[candles.length - 1]?.bucket ?? 0;
    const simulationTimestamps = generateTimestamps(startTime, endTime, simulationResolution);

    // Step 3: Resample each indicator's signals
    const resampledMap = new Map<string, boolean[]>();
    const stats: ResamplingStats = {
        indicatorsResampled: 0,
        upsampledCount: 0,
        downsampledCount: 0,
        noResampleCount: 0,
        originalSignalPoints: 0,
        resampledSignalPoints: 0,
    };

    for (const key of signalCache.keys()) {
        const originalSignals = signalCache.get(key);
        if (!originalSignals) continue;

        // Find resolution for this indicator
        const resInfo = indicatorResolutions.find((r) => r.cacheKey === key);
        const indicatorResolution = resInfo?.resolution ?? MIN_SIMULATION_RESOLUTION;

        // Create timestamps for original signals
        const signalTimestamps = createSignalTimestamps(startTime, originalSignals.length, indicatorResolution);

        // Resample to simulation resolution
        const resampled = resampleSignals(originalSignals, signalTimestamps, simulationTimestamps);

        resampledMap.set(key, resampled);

        // Track statistics
        stats.indicatorsResampled++;
        stats.originalSignalPoints += originalSignals.length;
        stats.resampledSignalPoints += resampled.length;

        if (indicatorResolution > simulationResolution) {
            stats.upsampledCount++;
        } else if (indicatorResolution < simulationResolution) {
            stats.downsampledCount++;
        } else {
            stats.noResampleCount++;
        }
    }

    // Step 4: Build resampled cache interface
    const resampledSignals: ResampledSignalCache = {
        get: (key) => resampledMap.get(key),
        has: (key) => resampledMap.has(key),
        keys: () => Array.from(resampledMap.keys()),
        getResolution: () => simulationResolution,
        getTimestamps: () => simulationTimestamps,
    };

    // Step 5: Calculate warmup in simulation bars
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

/**
 * Create ResamplingInput from previous stage results.
 *
 * Convenience function for stage chaining.
 *
 * @param candles - Filtered candles from Stage 1
 * @param indicatorResult - Result from Stage 2
 * @returns Input for Stage 3
 */
export function createResamplingInput(candles: Candle[], indicatorResult: IndicatorCalculationResult): ResamplingInput {
    return {
        candles,
        signalCache: indicatorResult.signalCache,
        indicatorConfigs: indicatorResult.indicatorConfigs,
        warmupCandles: indicatorResult.warmupCandles,
    };
}

// =============================================================================
// VALIDATION & DEBUGGING UTILITIES
// =============================================================================

/**
 * Validate resampling result for correctness.
 *
 * @param result - Resampling result to validate
 * @returns Validation report
 */
export function validateResamplingResult(result: ResamplingResult): {
    isValid: boolean;
    issues: string[];
    summary: {
        simulationResolution: number;
        totalBars: number;
        indicatorsProcessed: number;
        upsampled: number;
        downsampled: number;
    };
} {
    const issues: string[] = [];

    // Check simulation resolution is valid
    if (result.simulationResolution < MIN_SIMULATION_RESOLUTION) {
        issues.push(
            `Simulation resolution (${result.simulationResolution}s) below minimum (${MIN_SIMULATION_RESOLUTION}s)`
        );
    }

    // Check timestamps are consistent
    if (result.simulationTimestamps.length !== result.totalSimulationBars) {
        const actual = result.simulationTimestamps.length;
        const expected = result.totalSimulationBars;
        issues.push(`Timestamp count (${actual}) doesn't match totalSimulationBars (${expected})`);
    }

    // Check all resampled signals have correct length
    for (const key of result.resampledSignals.keys()) {
        const signals = result.resampledSignals.get(key);
        if (signals && signals.length !== result.totalSimulationBars) {
            issues.push(
                `Resampled signal "${key}" has ${signals.length} points, expected ${result.totalSimulationBars}`
            );
        }
    }

    // Check warmup is reasonable
    if (result.warmupBars < 0) {
        issues.push(`Invalid warmup bars: ${result.warmupBars}`);
    }

    if (result.warmupBars >= result.totalSimulationBars) {
        issues.push(`Warmup (${result.warmupBars}) >= total bars (${result.totalSimulationBars})`);
    }

    return {
        isValid: issues.length === 0,
        issues,
        summary: {
            simulationResolution: result.simulationResolution,
            totalBars: result.totalSimulationBars,
            indicatorsProcessed: result.resamplingStats.indicatorsResampled,
            upsampled: result.resamplingStats.upsampledCount,
            downsampled: result.resamplingStats.downsampledCount,
        },
    };
}

/**
 * Get resampled signal at a specific simulation bar.
 *
 * Utility for debugging and verification.
 *
 * @param resampledCache - The resampled signal cache
 * @param key - Indicator cache key
 * @param simBarIndex - Simulation bar index
 * @returns Signal value or undefined if not found
 */
export function getResampledSignalAtBar(
    resampledCache: ResampledSignalCache,
    key: string,
    simBarIndex: number
): boolean | undefined {
    const signals = resampledCache.get(key);
    if (!signals || simBarIndex < 0 || simBarIndex >= signals.length) {
        return undefined;
    }
    return signals[simBarIndex];
}

/**
 * Get timestamp for a simulation bar index.
 *
 * @param result - Resampling result
 * @param simBarIndex - Simulation bar index
 * @returns Timestamp in seconds
 */
export function getTimestampForBar(result: ResamplingResult, simBarIndex: number): number | undefined {
    if (simBarIndex < 0 || simBarIndex >= result.simulationTimestamps.length) {
        return undefined;
    }
    return result.simulationTimestamps[simBarIndex];
}

/**
 * Debug utility: Print resampling summary.
 *
 * @param result - Resampling result
 * @returns Formatted summary string
 */
export function formatResamplingDebugInfo(result: ResamplingResult): string {
    const { resamplingStats: stats } = result;

    return [
        "=== Resampling Summary ===",
        `Simulation Resolution: ${result.simulationResolution}s`,
        `Total Simulation Bars: ${result.totalSimulationBars}`,
        `Warmup Bars: ${result.warmupBars}`,
        `Min Indicator Resolution: ${result.minIndicatorResolution}s`,
        "",
        "=== Indicator Statistics ===",
        `Total Indicators: ${stats.indicatorsResampled}`,
        `  - Upsampled: ${stats.upsampledCount}`,
        `  - Downsampled: ${stats.downsampledCount}`,
        `  - No Change: ${stats.noResampleCount}`,
        "",
        "=== Signal Points ===",
        `Original: ${stats.originalSignalPoints}`,
        `Resampled: ${stats.resampledSignalPoints}`,
    ].join("\n");
}
