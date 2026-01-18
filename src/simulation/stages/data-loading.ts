/**
 * Stage 1: Data Loading
 *
 * @module simulation/stages/data-loading
 * @description
 * First stage in the backtester pipeline. Responsible for:
 * - Validating and parsing backtest configuration
 * - Filtering candle data to the requested time range
 * - Extracting data requirements from algo configuration
 *
 * @architecture
 * This is a pure function stage with no side effects.
 * Input: Raw candles + BacktestInput
 * Output: DataLoadingResult containing validated config and filtered candles
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Purpose: Extract data loading logic from index.ts into explicit stage
 * - Follows architecture principle: "Stages should be separate and explicit"
 */

import type { Candle } from "../../core/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import { BacktestInputSchema } from "../../core/config.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of Stage 1: Data Loading
 *
 * Contains all data needed for subsequent stages.
 */
export interface DataLoadingResult {
    /** Validated and parsed backtest input */
    validatedInput: BacktestInput;

    /** Candles filtered to the requested time range (including pre-warming bars if applicable) */
    filteredCandles: Candle[];

    /** Actual start time (first candle timestamp) */
    actualStartTime: number;

    /** Actual end time (last candle timestamp) */
    actualEndTime: number;

    /** Computed initial capital (base * scaler) */
    initialCapital: number;

    /** Whether the result is empty (no candles in range) */
    isEmpty: boolean;

    /**
     * Index in filteredCandles where actual trading should start.
     * Pre-warming bars (indices 0 to tradingStartIndex-1) are used for indicator warmup only.
     * Without pre-warming, this equals 0.
     */
    tradingStartIndex: number;

    /**
     * Number of pre-warming seconds actually loaded (may be less than requested if data unavailable).
     * 0 if no pre-warming was applied.
     */
    actualPreWarmingSeconds: number;
}

// =============================================================================
// STAGE 1: DATA LOADING
// =============================================================================

/**
 * Execute Stage 1: Load and validate data.
 *
 * @param candles - Raw historical price data (typically 1m candles)
 * @param input - Backtest input configuration
 * @param warmupSeconds - Optional: seconds of pre-warming data to load before startTime.
 *                        If provided, extra bars will be loaded before startTime for indicator warmup,
 *                        and tradingStartIndex will indicate where actual trading should begin.
 * @returns DataLoadingResult with validated config and filtered candles
 *
 * @example
 * ```typescript
 * // Without pre-warming (backward compatible)
 * const result = executeDataLoading(candles, input);
 *
 * // With pre-warming (for aligned warmup)
 * const warmupSec = getWarmupSeconds(indicatorConfigs);
 * const result = executeDataLoading(candles, input, warmupSec);
 * // result.tradingStartIndex tells you where to start trading
 * ```
 */
export function executeDataLoading(
    candles: Candle[],
    input: BacktestInput,
    warmupSeconds: number = 0
): DataLoadingResult {
    // Step 1: Validate input schema
    const validatedInput = BacktestInputSchema.parse(input);
    const { algoConfig, runSettings } = validatedInput;

    const requestedStartTime = runSettings.startTime!;
    const requestedEndTime = runSettings.endTime!;

    // Step 2: Calculate pre-warming start time
    // Load extra bars before the requested start time for indicator warmup
    const preWarmStartTime = requestedStartTime - warmupSeconds;

    // Step 3: Filter candles to extended range (including pre-warming)
    const filteredCandles = filterCandlesToRange(candles, preWarmStartTime, requestedEndTime);

    // Step 4: Find where actual trading should start
    // This is the first candle at or after the original requested start time
    let tradingStartIndex = 0;
    if (warmupSeconds > 0 && filteredCandles.length > 0) {
        tradingStartIndex = filteredCandles.findIndex((c) => c.bucket >= requestedStartTime);
        // If no candle found at/after requestedStartTime, use 0 (shouldn't happen normally)
        if (tradingStartIndex === -1) {
            tradingStartIndex = 0;
        }
    }

    // Step 5: Calculate actual pre-warming achieved
    const actualPreWarmingSeconds =
        tradingStartIndex > 0 && filteredCandles.length > 0
            ? requestedStartTime - filteredCandles[0]!.bucket
            : 0;

    // Step 6: Determine actual time bounds
    const isEmpty = filteredCandles.length === 0;
    const actualStartTime = isEmpty ? requestedStartTime : filteredCandles[0]!.bucket;
    const actualEndTime = isEmpty ? requestedEndTime : filteredCandles[filteredCandles.length - 1]!.bucket;

    // Step 7: Calculate initial capital
    const initialCapital = algoConfig.params.startingCapitalUSD * runSettings.capitalScaler;

    return {
        validatedInput,
        filteredCandles,
        actualStartTime,
        actualEndTime,
        initialCapital,
        isEmpty,
        tradingStartIndex,
        actualPreWarmingSeconds,
    };
}

/**
 * Filter candles to a specific time range.
 *
 * @param candles - All available candles
 * @param startTime - Start timestamp (inclusive)
 * @param endTime - End timestamp (inclusive)
 * @returns Candles within the time range
 */
export function filterCandlesToRange(candles: Candle[], startTime: number, endTime: number): Candle[] {
    return candles.filter((c) => c.bucket >= startTime && c.bucket <= endTime);
}

