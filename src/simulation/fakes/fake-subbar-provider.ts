// Fake Sub-Bar Provider - Mock implementation for testing
// Generates synthetic sub-bar candles from parent candles or uses pre-loaded data

import type { Candle } from "../../core/types.ts";
import type { ISubBarDataProvider } from "../../interfaces/subbar-data-provider.ts";
import { SUBBAR_TIMEFRAME_MAP, SUBBAR_COUNT_MAP } from "../../interfaces/subbar-data-provider.ts";

export class FakeSubBarProvider implements ISubBarDataProvider {
    private preloadedData: Map<number, Candle[]> = new Map();  // parentTimestamp → sub-bar candles
    private parentCandles: Map<number, Candle> = new Map();    // timestamp → parent candle (for generation)

    constructor() {}

    // PRELOAD DATA (for tests with specific scenarios)

    /**
     * Preload sub-bar candles for specific parent bars.
     * Use this to set up deterministic test scenarios.
     */
    preloadSubBars(parentTimestamp: number, subBars: Candle[]): void {
        this.preloadedData.set(parentTimestamp, subBars);
    }

    /**
     * Preload parent candles for automatic sub-bar generation.
     */
    preloadParentCandles(candles: Candle[]): void {
        for (const candle of candles) {
            this.parentCandles.set(candle.bucket, candle);
        }
    }

    /**
     * Clear all preloaded data.
     */
    clear(): void {
        this.preloadedData.clear();
        this.parentCandles.clear();
    }

    // ISubBarDataProvider IMPLEMENTATION

    getSubBarCandles(
        _symbol: string,
        parentBarTimestamp: number,
        parentTimeframe: string
    ): Candle[] {
        // Check for preloaded data first
        const preloaded = this.preloadedData.get(parentBarTimestamp);
        if (preloaded) {
            return preloaded;
        }

        // Generate synthetic sub-bars from parent candle
        const parentCandle = this.parentCandles.get(parentBarTimestamp);
        if (parentCandle) {
            return this.generateSubBars(parentCandle, parentTimeframe);
        }

        // No data available - return empty array
        return [];
    }

    getSubBarCandlesBatch(
        symbol: string,
        parentBarTimestamps: number[],
        parentTimeframe: string
    ): Map<number, Candle[]> {
        const result = new Map<number, Candle[]>();

        for (const timestamp of parentBarTimestamps) {
            const subBars = this.getSubBarCandles(symbol, timestamp, parentTimeframe);
            result.set(timestamp, subBars);
        }

        return result;
    }

    getSubBarTimeframe(parentTimeframe: string): string | null {
        return SUBBAR_TIMEFRAME_MAP[parentTimeframe] ?? null;
    }

    getSubBarCount(parentTimeframe: string): number {
        return SUBBAR_COUNT_MAP[parentTimeframe] ?? 0;
    }

    // SYNTHETIC GENERATION

    /**
     * Generate synthetic sub-bar candles from a parent candle.
     * Creates a realistic-looking path from open to close through high/low.
     */
    private generateSubBars(parentCandle: Candle, parentTimeframe: string): Candle[] {
        const subBarCount = this.getSubBarCount(parentTimeframe);
        if (subBarCount === 0) return [];

        const { open, high, low, close, bucket } = parentCandle;
        const subBarDuration = this.getSubBarDuration(parentTimeframe);
        const subBars: Candle[] = [];

        // Determine if we hit high first or low first (based on close vs open)
        const bullish = close >= open;

        // Generate a realistic price path
        const pricePath = this.generatePricePath(open, high, low, close, subBarCount, bullish);

        for (let i = 0; i < subBarCount; i++) {
            const subBarOpen = pricePath[i]!;
            const subBarClose = pricePath[i + 1]!;
            const subBarHigh = Math.max(subBarOpen, subBarClose) + Math.random() * (high - Math.max(open, close)) * 0.2;
            const subBarLow = Math.min(subBarOpen, subBarClose) - Math.random() * (Math.min(open, close) - low) * 0.2;

            subBars.push({
                open: subBarOpen,
                high: Math.min(high, Math.max(subBarHigh, subBarOpen, subBarClose)),
                low: Math.max(low, Math.min(subBarLow, subBarOpen, subBarClose)),
                close: subBarClose,
                bucket: bucket + (i * subBarDuration),
            } as Candle);
        }

        return subBars;
    }

    /**
     * Generate a price path through the candle.
     * Returns subBarCount + 1 prices (one for each sub-bar open + final close).
     */
    private generatePricePath(
        open: number,
        high: number,
        low: number,
        close: number,
        subBarCount: number,
        bullish: boolean
    ): number[] {
        const path: number[] = [open];

        // Simple linear interpolation with some noise
        // For bullish: open → high → close
        // For bearish: open → low → close

        const midPoint = Math.floor(subBarCount / 2);

        for (let i = 1; i <= subBarCount; i++) {
            let price: number;

            if (i <= midPoint) {
                // First half: move toward extreme
                const extreme = bullish ? high : low;
                const progress = i / midPoint;
                price = open + (extreme - open) * progress;
            } else {
                // Second half: move toward close
                const extreme = bullish ? high : low;
                const progress = (i - midPoint) / (subBarCount - midPoint);
                price = extreme + (close - extreme) * progress;
            }

            // Add small random noise (0.1% of price)
            price += (Math.random() - 0.5) * price * 0.001;
            path.push(price);
        }

        // Ensure final price is exactly close
        path[path.length - 1] = close;

        return path;
    }

    /**
     * Get sub-bar duration in seconds.
     */
    private getSubBarDuration(parentTimeframe: string): number {
        const durationMap: Record<string, number> = {
            "5m": 60,      // 1m sub-bars
            "15m": 300,    // 5m sub-bars
            "1h": 900,     // 15m sub-bars
            "4h": 3600,    // 1h sub-bars
            "1d": 14400,   // 4h sub-bars
        };
        return durationMap[parentTimeframe] ?? 60;
    }
}
