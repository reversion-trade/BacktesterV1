// Sub-Bar Data Provider Interface - Fetches lower-timeframe candles for accurate SL/TP simulation

import type { Candle } from "../core/types.ts";

// TIMEFRAME MAPPING - One level down for each parent timeframe
export const SUBBAR_TIMEFRAME_MAP: Record<string, string> = {
    "5m": "1m",    // 5 sub-bars per bar
    "15m": "5m",   // 3 sub-bars per bar
    "1h": "15m",   // 4 sub-bars per bar
    "4h": "1h",    // 4 sub-bars per bar
    "1d": "4h",    // 6 sub-bars per bar
};

// How many sub-bars per parent bar for each timeframe
export const SUBBAR_COUNT_MAP: Record<string, number> = {
    "5m": 5,
    "15m": 3,
    "1h": 4,
    "4h": 4,
    "1d": 6,
};

// SUB-BAR DATA PROVIDER INTERFACE

export interface ISubBarDataProvider {
    getSubBarCandles(
        symbol: string,
        parentBarTimestamp: number,
        parentTimeframe: string
    ): Candle[];

    getSubBarCandlesBatch(
        symbol: string,
        parentBarTimestamps: number[],
        parentTimeframe: string
    ): Map<number, Candle[]>;

    getSubBarTimeframe(parentTimeframe: string): string | null;
    getSubBarCount(parentTimeframe: string): number;
}

// HELPER FUNCTIONS

export function getSubBarTimeframe(parentTimeframe: string): string | null {
    return SUBBAR_TIMEFRAME_MAP[parentTimeframe] ?? null;
}

export function getSubBarCount(parentTimeframe: string): number {
    return SUBBAR_COUNT_MAP[parentTimeframe] ?? 0;
}

export function isSubBarSupported(parentTimeframe: string): boolean {
    return parentTimeframe in SUBBAR_TIMEFRAME_MAP;
}
