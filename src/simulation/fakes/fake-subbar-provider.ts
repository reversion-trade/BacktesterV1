/** Fake Sub-Bar Provider - Mock implementation for testing. Generates synthetic sub-bars or uses pre-loaded data. */

import type { Candle } from "../../core/types.ts";
import type { ISubBarDataProvider } from "../../interfaces/subbar-data-provider.ts";
import { SUBBAR_TIMEFRAME_MAP, SUBBAR_COUNT_MAP } from "../../interfaces/subbar-data-provider.ts";

export class FakeSubBarProvider implements ISubBarDataProvider {
    private preloadedData: Map<number, Candle[]> = new Map();  // parentTimestamp → sub-bar candles
    private parentCandles: Map<number, Candle> = new Map();    // timestamp → parent candle (for generation)

    preloadSubBars(parentTimestamp: number, subBars: Candle[]): void { this.preloadedData.set(parentTimestamp, subBars); } // Set up deterministic test scenarios
    preloadParentCandles(candles: Candle[]): void { for (const candle of candles) this.parentCandles.set(candle.bucket, candle); } // For automatic sub-bar generation
    clear(): void { this.preloadedData.clear(); this.parentCandles.clear(); }

    getSubBarCandles(_symbol: string, parentBarTimestamp: number, parentTimeframe: string): Candle[] {
        const preloaded = this.preloadedData.get(parentBarTimestamp); // Check preloaded data first
        if (preloaded) return preloaded;

        const parentCandle = this.parentCandles.get(parentBarTimestamp); // Generate synthetic sub-bars from parent
        if (parentCandle) return this.generateSubBars(parentCandle, parentTimeframe);

        return []; // No data available
    }

    getSubBarCandlesBatch(symbol: string, parentBarTimestamps: number[], parentTimeframe: string): Map<number, Candle[]> {
        const result = new Map<number, Candle[]>();
        for (const timestamp of parentBarTimestamps) result.set(timestamp, this.getSubBarCandles(symbol, timestamp, parentTimeframe));
        return result;
    }

    getSubBarTimeframe(parentTimeframe: string): string | null { return SUBBAR_TIMEFRAME_MAP[parentTimeframe] ?? null; }
    getSubBarCount(parentTimeframe: string): number { return SUBBAR_COUNT_MAP[parentTimeframe] ?? 0; }

    private generateSubBars(parentCandle: Candle, parentTimeframe: string): Candle[] { // Generate synthetic sub-bars with realistic path
        const subBarCount = this.getSubBarCount(parentTimeframe);
        if (subBarCount === 0) return [];

        const { open, high, low, close, bucket } = parentCandle;
        const subBarDuration = this.getSubBarDuration(parentTimeframe);
        const subBars: Candle[] = [];
        const bullish = close >= open; // Determines if we hit high first or low first
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

    private generatePricePath(open: number, high: number, low: number, close: number, subBarCount: number, bullish: boolean): number[] {
        const path: number[] = [open]; // Returns subBarCount + 1 prices (one for each sub-bar open + final close)
        const midPoint = Math.floor(subBarCount / 2);

        for (let i = 1; i <= subBarCount; i++) {
            let price: number;
            if (i <= midPoint) { // First half: move toward extreme (high for bullish, low for bearish)
                const extreme = bullish ? high : low;
                price = open + (extreme - open) * (i / midPoint);
            } else { // Second half: move toward close
                const extreme = bullish ? high : low;
                price = extreme + (close - extreme) * ((i - midPoint) / (subBarCount - midPoint));
            }
            price += (Math.random() - 0.5) * price * 0.001; // Add small random noise (0.1% of price)
            path.push(price);
        }
        path[path.length - 1] = close; // Ensure final price is exactly close
        return path;
    }

    private getSubBarDuration(parentTimeframe: string): number { // Sub-bar duration in seconds
        const durationMap: Record<string, number> = { "5m": 60, "15m": 300, "1h": 900, "4h": 3600, "1d": 14400 };
        return durationMap[parentTimeframe] ?? 60;
    }
}
