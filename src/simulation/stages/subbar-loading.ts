/** Stage 1.5: Sub-Bar Data Loading - Pre-fetches lower-timeframe candles for accurate SL/TP simulation using "nearest extreme" logic. */

import type { Candle } from "../../core/types.ts";
import type { ISubBarDataProvider } from "../../interfaces/subbar-data-provider.ts";
import { isSubBarSupported, getSubBarTimeframe, getSubBarCount } from "../../interfaces/subbar-data-provider.ts";

export interface SubBarLoadingResult {
    subBarCandlesMap: Map<number, Candle[]>;                                      // Parent bar timestamp → sub-bar candles
    subBarTimeframe: string;                                                      // Sub-bar timeframe (e.g., "1m" for 5m parent)
    parentTimeframe: string;                                                      // Parent timeframe
    totalSubBarsLoaded: number;                                                   // Total sub-bars loaded
    parentBarsWithData: number;                                                   // Parent bars with sub-bar data
    isSupported: boolean;                                                         // Whether sub-bar simulation is available
}

export interface SubBarLoadingInput {
    filteredCandles: Candle[];                                                    // Filtered candles from Stage 1
    symbol: string;                                                               // Symbol being backtested
    parentTimeframe: string;                                                      // Parent timeframe (e.g., "5m", "1h")
    subBarProvider: ISubBarDataProvider;                                          // Sub-bar data provider
}

/** Execute Stage 1.5: Batch-load sub-bar candles for all parent bars. More efficient than fetching during simulation. */
export function executeSubBarLoading(input: SubBarLoadingInput): SubBarLoadingResult {
    const { filteredCandles, symbol, parentTimeframe, subBarProvider } = input;

    if (!isSubBarSupported(parentTimeframe)) return createUnsupportedResult(parentTimeframe);

    const subBarTimeframe = getSubBarTimeframe(parentTimeframe)!;
    const parentTimestamps = filteredCandles.map((c) => c.bucket);
    const subBarCandlesMap = subBarProvider.getSubBarCandlesBatch(symbol, parentTimestamps, parentTimeframe);

    let totalSubBarsLoaded = 0;
    let parentBarsWithData = 0;
    for (const [_timestamp, subBars] of subBarCandlesMap) {
        if (subBars.length > 0) {
            totalSubBarsLoaded += subBars.length;
            parentBarsWithData++;
        }
    }

    return { subBarCandlesMap, subBarTimeframe, parentTimeframe, totalSubBarsLoaded, parentBarsWithData, isSupported: true };
}

function createUnsupportedResult(parentTimeframe: string): SubBarLoadingResult {
    return { subBarCandlesMap: new Map(), subBarTimeframe: "", parentTimeframe, totalSubBarsLoaded: 0, parentBarsWithData: 0, isSupported: false };
}

/** Get sub-bar candles for a specific parent bar. Returns empty array if unavailable. */
export function getSubBarsForParent(subBarResult: SubBarLoadingResult, parentTimestamp: number): Candle[] {
    return subBarResult.subBarCandlesMap.get(parentTimestamp) ?? [];
}

/** Get expected number of sub-bars per parent bar for a timeframe. */
export function getExpectedSubBarCount(parentTimeframe: string): number {
    return getSubBarCount(parentTimeframe);
}

/** Check if sub-bar data is available for a parent bar. */
export function hasSubBarsForParent(subBarResult: SubBarLoadingResult, parentTimestamp: number): boolean {
    const subBars = subBarResult.subBarCandlesMap.get(parentTimestamp);
    return subBars !== undefined && subBars.length > 0;
}
