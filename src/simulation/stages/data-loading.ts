/** Stage 1: Data Loading - Validates config, filters candles to time range, handles pre-warming for indicator warmup. */

import type { Candle } from "../../core/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import { BacktestInputSchema } from "../../core/config.ts";

export interface DataLoadingResult {
    validatedInput: BacktestInput;                                                // Parsed and validated backtest input
    filteredCandles: Candle[];                                                    // Candles in range (including pre-warming bars)
    actualStartTime: number;                                                      // First candle timestamp
    actualEndTime: number;                                                        // Last candle timestamp
    initialCapital: number;                                                       // base * scaler
    isEmpty: boolean;                                                             // No candles in range
    tradingStartIndex: number;                                                    // Index where trading starts (after pre-warming bars)
    actualPreWarmingSeconds: number;                                              // Actual pre-warming loaded (may be < requested)
}

/** Execute Stage 1: Validate input, filter candles, calculate pre-warming offsets. */
export function executeDataLoading(candles: Candle[], input: BacktestInput, warmupSeconds: number = 0): DataLoadingResult {
    const validatedInput = BacktestInputSchema.parse(input);
    const { algoConfig, runSettings } = validatedInput;
    const requestedStartTime = runSettings.startTime!;
    const requestedEndTime = runSettings.endTime!;

    const preWarmStartTime = requestedStartTime - warmupSeconds;                  // Load extra bars before start for warmup
    const filteredCandles = filterCandlesToRange(candles, preWarmStartTime, requestedEndTime);

    let tradingStartIndex = 0;                                                    // Find first candle at/after requested start
    if (warmupSeconds > 0 && filteredCandles.length > 0) {
        tradingStartIndex = filteredCandles.findIndex((c) => c.bucket >= requestedStartTime);
        if (tradingStartIndex === -1) tradingStartIndex = 0;                      // Fallback if no candle found
    }

    const actualPreWarmingSeconds = tradingStartIndex > 0 && filteredCandles.length > 0
        ? requestedStartTime - filteredCandles[0]!.bucket
        : 0;

    const isEmpty = filteredCandles.length === 0;
    const actualStartTime = isEmpty ? requestedStartTime : filteredCandles[0]!.bucket;
    const actualEndTime = isEmpty ? requestedEndTime : filteredCandles[filteredCandles.length - 1]!.bucket;
    const initialCapital = algoConfig.params.startingCapitalUSD * runSettings.capitalScaler;

    return { validatedInput, filteredCandles, actualStartTime, actualEndTime, initialCapital, isEmpty, tradingStartIndex, actualPreWarmingSeconds };
}

/** Filter candles to time range (inclusive on both ends). */
export function filterCandlesToRange(candles: Candle[], startTime: number, endTime: number): Candle[] {
    return candles.filter((c) => c.bucket >= startTime && c.bucket <= endTime);
}
