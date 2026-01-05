/**
 * BTC Candle Data Loader
 *
 * Utilities for loading and manipulating real BTC candle data for testing.
 *
 * @module __tests__/fixtures/load-candles
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Candle } from "../../core/types.ts";

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the CSV data file
const CSV_PATH = join(__dirname, "btc-1m-3mo.csv");

// Cache for loaded candles
let cachedCandles: Candle[] | null = null;

/**
 * Check if BTC data file exists
 */
export function hasBTCData(): boolean {
    return existsSync(CSV_PATH);
}

/**
 * Load all BTC candles from CSV
 *
 * Expected CSV format:
 * timestamp,open,high,low,close,volume
 * 1704067200000,42000.00,42050.00,41980.00,42030.00,123.45
 */
export function loadBTCCandles(): Candle[] {
    if (cachedCandles) {
        return cachedCandles;
    }

    if (!hasBTCData()) {
        throw new Error(
            `BTC data file not found at ${CSV_PATH}. ` +
                "Please provide a CSV file with columns: timestamp,open,high,low,close,volume"
        );
    }

    const content = readFileSync(CSV_PATH, "utf-8");
    const lines = content.trim().split("\n");

    // Skip header row
    const dataLines = lines.slice(1);

    cachedCandles = dataLines.map((line, index) => {
        const [timestamp, open, high, low, close, volume] = line.split(",");

        if (!timestamp || !open || !high || !low || !close || !volume) {
            throw new Error(`Invalid CSV line at row ${index + 2}: ${line}`);
        }

        return {
            bucket: parseInt(timestamp, 10),
            open: parseFloat(open),
            high: parseFloat(high),
            low: parseFloat(low),
            close: parseFloat(close),
            volume: parseFloat(volume),
        };
    });

    // Validate data integrity
    validateCandles(cachedCandles);

    console.log(`Loaded ${cachedCandles.length} BTC candles`);
    return cachedCandles;
}

/**
 * Validate candle data integrity
 */
function validateCandles(candles: Candle[]): void {
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];

        // Check for NaN values
        if (isNaN(c.bucket) || isNaN(c.open) || isNaN(c.high) || isNaN(c.low) || isNaN(c.close) || isNaN(c.volume)) {
            throw new Error(`Invalid candle data at index ${i}: contains NaN values`);
        }

        // Check OHLC relationships
        if (c.high < c.low) {
            throw new Error(`Invalid candle at index ${i}: high (${c.high}) < low (${c.low})`);
        }
        if (c.high < c.open || c.high < c.close) {
            throw new Error(`Invalid candle at index ${i}: high is not the highest value`);
        }
        if (c.low > c.open || c.low > c.close) {
            throw new Error(`Invalid candle at index ${i}: low is not the lowest value`);
        }

        // Check timestamp ordering (should be ascending)
        if (i > 0 && candles[i].bucket <= candles[i - 1].bucket) {
            throw new Error(`Invalid timestamp ordering at index ${i}: timestamps must be ascending`);
        }
    }
}

/**
 * Load a slice of candles starting at a specific index
 */
export function loadCandleSlice(startIndex: number, count: number): Candle[] {
    const candles = loadBTCCandles();

    if (startIndex < 0 || startIndex >= candles.length) {
        throw new Error(`Invalid startIndex ${startIndex}. Must be 0-${candles.length - 1}`);
    }

    const endIndex = Math.min(startIndex + count, candles.length);
    return candles.slice(startIndex, endIndex);
}

/**
 * Load candles by time range
 */
export function loadCandlesByTimeRange(startTime: number, endTime: number): Candle[] {
    const candles = loadBTCCandles();
    return candles.filter((c) => c.bucket >= startTime && c.bucket <= endTime);
}

/**
 * Resample candles to a higher timeframe
 *
 * @param candles - Source candles (e.g., 1-minute)
 * @param targetIntervalMs - Target interval in milliseconds (e.g., 300000 for 5-minute)
 */
export function resampleCandles(candles: Candle[], targetIntervalMs: number): Candle[] {
    if (candles.length === 0) return [];

    const resampled: Candle[] = [];
    let currentBucket = Math.floor(candles[0].bucket / targetIntervalMs) * targetIntervalMs;
    let currentCandles: Candle[] = [];

    for (const candle of candles) {
        const candleBucket = Math.floor(candle.bucket / targetIntervalMs) * targetIntervalMs;

        if (candleBucket !== currentBucket && currentCandles.length > 0) {
            // Aggregate current candles into one
            resampled.push(aggregateCandles(currentCandles, currentBucket));
            currentCandles = [];
            currentBucket = candleBucket;
        }

        currentCandles.push(candle);
    }

    // Don't forget the last bucket
    if (currentCandles.length > 0) {
        resampled.push(aggregateCandles(currentCandles, currentBucket));
    }

    return resampled;
}

/**
 * Aggregate multiple candles into one OHLCV candle
 */
function aggregateCandles(candles: Candle[], bucket: number): Candle {
    return {
        bucket,
        open: candles[0].open,
        high: Math.max(...candles.map((c) => c.high)),
        low: Math.min(...candles.map((c) => c.low)),
        close: candles[candles.length - 1].close,
        volume: candles.reduce((sum, c) => sum + c.volume, 0),
    };
}

/**
 * Common timeframe intervals in milliseconds
 */
export const TIMEFRAMES = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
} as const;

/**
 * Find interesting price patterns in the data
 */
export function findPatternSlices(candles: Candle[]): {
    uptrend: { start: number; end: number };
    downtrend: { start: number; end: number };
    sideways: { start: number; end: number };
} {
    // Simple heuristic: look for 1000-bar windows with consistent behavior
    const windowSize = 1000;
    let bestUptrend = { start: 0, end: windowSize, score: 0 };
    let bestDowntrend = { start: 0, end: windowSize, score: 0 };
    let bestSideways = { start: 0, end: windowSize, score: Infinity };

    for (let i = 0; i < candles.length - windowSize; i += 100) {
        const window = candles.slice(i, i + windowSize);
        const startPrice = window[0].close;
        const endPrice = window[window.length - 1].close;
        const pctChange = (endPrice - startPrice) / startPrice;

        // Calculate volatility (standard deviation of returns)
        const returns = window.slice(1).map((c, j) => (c.close - window[j].close) / window[j].close);
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const volatility = Math.sqrt(variance);

        // Score patterns
        if (pctChange > bestUptrend.score) {
            bestUptrend = { start: i, end: i + windowSize, score: pctChange };
        }
        if (pctChange < bestDowntrend.score) {
            bestDowntrend = { start: i, end: i + windowSize, score: pctChange };
        }
        if (Math.abs(pctChange) < bestSideways.score && volatility < 0.01) {
            bestSideways = { start: i, end: i + windowSize, score: Math.abs(pctChange) };
        }
    }

    return {
        uptrend: { start: bestUptrend.start, end: bestUptrend.end },
        downtrend: { start: bestDowntrend.start, end: bestDowntrend.end },
        sideways: { start: bestSideways.start, end: bestSideways.end },
    };
}

/**
 * Get data summary statistics
 */
export function getDataSummary(candles: Candle[]): {
    count: number;
    startTime: Date;
    endTime: Date;
    durationDays: number;
    priceRange: { min: number; max: number };
    avgVolume: number;
} {
    if (candles.length === 0) {
        throw new Error("Cannot get summary of empty candle array");
    }

    const prices = candles.flatMap((c) => [c.high, c.low]);
    const volumes = candles.map((c) => c.volume);

    return {
        count: candles.length,
        startTime: new Date(candles[0].bucket),
        endTime: new Date(candles[candles.length - 1].bucket),
        durationDays: (candles[candles.length - 1].bucket - candles[0].bucket) / (24 * 60 * 60 * 1000),
        priceRange: {
            min: Math.min(...prices),
            max: Math.max(...prices),
        },
        avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
    };
}

/**
 * Clear the candle cache (useful for testing)
 */
export function clearCandleCache(): void {
    cachedCandles = null;
}
