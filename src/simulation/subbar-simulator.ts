// Sub-Bar Path Simulator - Generates realistic price paths through sub-bar candles
// Uses "nearest extreme" logic: within each candle, price goes to closest extreme first

import type { Candle } from "../core/types.ts";

// TYPES

export interface PriceCheckpoint {
    price: number;           // Price at this checkpoint
    timestamp: number;       // Timestamp of this checkpoint
    subBarIndex: number;     // Which sub-bar candle (0, 1, 2...)
    checkpointIndex: number; // Position within sub-bar (0=open, 1=near-extreme, 2=far-extreme, 3=close)
}

// CORE FUNCTIONS

/**
 * Simulate the price path within a single candle using "nearest extreme" logic.
 *
 * Logic: Price starts at open, goes to whichever extreme (high/low) is closer first,
 * then to the other extreme, then closes.
 *
 * Example: open=100, high=105, low=98, close=102
 * - Distance to high: |105-100| = 5
 * - Distance to low: |98-100| = 2 (closer!)
 * - Path: open(100) → low(98) → high(105) → close(102)
 */
export function simulateSubBarPath(candle: Candle): number[] {
    const { open, high, low, close } = candle;
    const distToHigh = Math.abs(high - open);
    const distToLow = Math.abs(low - open);

    if (distToHigh <= distToLow) {
        return [open, high, low, close];  // High is closer (or equal), go up first
    } else {
        return [open, low, high, close];  // Low is closer, go down first
    }
}

/**
 * Generate price checkpoints from an array of sub-bar candles.
 * Each sub-bar produces 4 checkpoints: open, near-extreme, far-extreme, close.
 *
 * Example: 5 sub-bar candles → 20 price checkpoints
 */
export function generatePriceCheckpoints(subBarCandles: Candle[]): PriceCheckpoint[] {
    const checkpoints: PriceCheckpoint[] = [];

    for (let subBarIndex = 0; subBarIndex < subBarCandles.length; subBarIndex++) {
        const candle = subBarCandles[subBarIndex]!;
        const path = simulateSubBarPath(candle);

        // Calculate approximate timestamps for each checkpoint within the candle
        // Assume equal spacing within the candle period
        const candleDuration = getCandleDuration(candle, subBarCandles[subBarIndex + 1]);

        for (let checkpointIndex = 0; checkpointIndex < path.length; checkpointIndex++) {
            const timestampOffset = Math.floor((candleDuration * checkpointIndex) / 4);

            checkpoints.push({
                price: path[checkpointIndex]!,
                timestamp: candle.bucket + timestampOffset,
                subBarIndex,
                checkpointIndex,
            });
        }
    }

    return checkpoints;
}

/**
 * Get just the prices from checkpoints (for SL/TP checking).
 */
export function getCheckpointPrices(checkpoints: PriceCheckpoint[]): number[] {
    return checkpoints.map(cp => cp.price);
}

/**
 * Get just the timestamps from checkpoints.
 */
export function getCheckpointTimestamps(checkpoints: PriceCheckpoint[]): number[] {
    return checkpoints.map(cp => cp.timestamp);
}

/**
 * Find which checkpoint triggered an exit (SL/TP hit).
 * Returns the index of the first true result, or -1 if none triggered.
 */
export function findTriggerCheckpoint(results: boolean[]): number {
    return results.findIndex(r => r);
}

// HELPER FUNCTIONS

/**
 * Estimate candle duration in seconds.
 * Uses next candle's timestamp if available, otherwise falls back to 60s.
 * The fallback only applies to the last candle in a sequence where no next candle exists.
 */
function getCandleDuration(candle: Candle, nextCandle?: Candle): number {
    if (nextCandle) {
        return nextCandle.bucket - candle.bucket;
    }
    // Fallback for last candle only. In practice, this affects only the final
    // checkpoint timing within a candle, which has minimal impact on SL/TP detection.
    return 60;
}

/**
 * Validate that sub-bar candles are in chronological order and within expected range.
 */
export function validateSubBarCandles(
    subBarCandles: Candle[],
    parentBarTimestamp: number,
    parentBarDuration: number
): boolean {
    if (subBarCandles.length === 0) return false;

    const parentEnd = parentBarTimestamp + parentBarDuration;

    for (let i = 0; i < subBarCandles.length; i++) {
        const candle = subBarCandles[i]!;

        // Check candle is within parent bar time range
        if (candle.bucket < parentBarTimestamp || candle.bucket >= parentEnd) {
            return false;
        }

        // Check chronological order
        if (i > 0 && candle.bucket <= subBarCandles[i - 1]!.bucket) {
            return false;
        }
    }

    return true;
}

/**
 * Get a summary of the price path for debugging/logging.
 */
export function summarizePricePath(checkpoints: PriceCheckpoint[]): string {
    if (checkpoints.length === 0) return "[]";

    const prices = checkpoints.map(cp => cp.price.toFixed(2));
    const first = checkpoints[0]!;
    const last = checkpoints[checkpoints.length - 1]!;

    return `${checkpoints.length} checkpoints, ${first.price.toFixed(2)} → ${last.price.toFixed(2)}`;
}
