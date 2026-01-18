/** Sub-Bar Path Simulator - Generates realistic price paths using "nearest extreme" logic. */

import type { Candle } from "../core/types.ts";

export interface PriceCheckpoint {
    price: number;                                                              // Price at this checkpoint
    timestamp: number;                                                          // Timestamp of this checkpoint
    subBarIndex: number;                                                        // Which sub-bar candle (0, 1, 2...)
    checkpointIndex: number;                                                    // Position within sub-bar (0=open, 1=near-extreme, 2=far-extreme, 3=close)
}

/** Simulate price path within a single candle. Goes to nearest extreme first, then far extreme, then close. */
export function simulateSubBarPath(candle: Candle): number[] {
    const { open, high, low, close } = candle;
    const distToHigh = Math.abs(high - open);
    const distToLow = Math.abs(low - open);
    return distToHigh <= distToLow ? [open, high, low, close] : [open, low, high, close];
}

/** Generate price checkpoints from sub-bar candles. Each sub-bar produces 4 checkpoints: open, near-extreme, far-extreme, close. */
export function generatePriceCheckpoints(subBarCandles: Candle[]): PriceCheckpoint[] {
    const checkpoints: PriceCheckpoint[] = [];
    for (let subBarIndex = 0; subBarIndex < subBarCandles.length; subBarIndex++) {
        const candle = subBarCandles[subBarIndex]!;
        const path = simulateSubBarPath(candle);
        const candleDuration = getCandleDuration(candle, subBarCandles[subBarIndex + 1]);
        for (let checkpointIndex = 0; checkpointIndex < path.length; checkpointIndex++) {
            const timestampOffset = Math.floor((candleDuration * checkpointIndex) / 4);
            checkpoints.push({ price: path[checkpointIndex]!, timestamp: candle.bucket + timestampOffset, subBarIndex, checkpointIndex });
        }
    }
    return checkpoints;
}

/** Estimate candle duration in seconds. Uses next candle timestamp if available, else 60s fallback for last candle. */
function getCandleDuration(candle: Candle, nextCandle?: Candle): number {
    return nextCandle ? nextCandle.bucket - candle.bucket : 60;
}
