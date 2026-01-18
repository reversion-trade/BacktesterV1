import type { Candle } from "../../core/types.ts";

export function aggregateCandles(candles: Candle[], sourceResolution: number, targetResolution: number): Candle[] {
    if (targetResolution < sourceResolution) throw new Error(`Cannot aggregate to finer resolution: ${targetResolution}s < ${sourceResolution}s`);
    if (targetResolution === sourceResolution) return candles;
    if (candles.length === 0) return [];

    const result: Candle[] = [];
    const factor = calculateAggregationFactor(sourceResolution, targetResolution);

    for (let i = 0; i < candles.length; i += factor) {
        const group = candles.slice(i, i + factor);
        if (group.length === 0) break;
        result.push(aggregateCandleGroup(group, targetResolution));
    }
    return result;
}

export function aggregateCandleGroup(group: Candle[], targetResolution: number): Candle {   // Aggregate group into single candle with OHLCV rules
    if (group.length === 0) throw new Error("Cannot aggregate empty candle group");

    const first = group[0]!;
    const last = group[group.length - 1]!;
    const alignedBucket = alignBucketToResolution(first.bucket, targetResolution);

    let high = first.high, low = first.low, volume = 0;
    for (const c of group) {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
        volume += c.volume;
    }

    return { bucket: alignedBucket, open: first.open, high, low, close: last.close, volume };
}

export function calculateAggregationFactor(sourceResolution: number, targetResolution: number): number {  // How many source candles make one target candle
    if (sourceResolution <= 0 || targetResolution <= 0) throw new Error("Resolutions must be positive");
    return Math.ceil(targetResolution / sourceResolution);                                              // Ceiling ensures we capture all data
}

export function alignBucketToResolution(timestamp: number, resolution: number): number {                // Align timestamp to start of resolution bucket
    return Math.floor(timestamp / resolution) * resolution;
}

export function isCleanAggregation(sourceResolution: number, targetResolution: number): boolean {       // Check if target cleanly divisible by source
    return targetResolution % sourceResolution === 0;
}

export function expectedAggregatedCount(sourceCandleCount: number, aggregationFactor: number): number { // Expected output candle count
    return Math.ceil(sourceCandleCount / aggregationFactor);
}

export function validateCandlesForAggregation(candles: Candle[], expectedResolution: number): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    if (candles.length === 0) return { valid: true, issues: [] };

    for (let i = 1; i < candles.length; i++) {                                                        // Check chronological order
        const prev = candles[i - 1]!, curr = candles[i]!;
        if (curr.bucket <= prev.bucket) issues.push(`Candles not in chronological order at index ${i}: ${prev.bucket} >= ${curr.bucket}`);
    }

    if (candles.length >= 2) {                                                                          // Check consistent resolution
        const observedResolution = candles[1]!.bucket - candles[0]!.bucket;
        if (observedResolution !== expectedResolution) issues.push(`First candle gap (${observedResolution}s) doesn't match expected resolution (${expectedResolution}s)`);
    }

    for (let i = 0; i < candles.length; i++) {                                                          // Check OHLC validity
        const c = candles[i]!;
        if (c.high < c.low) issues.push(`Invalid candle at index ${i}: high (${c.high}) < low (${c.low})`);
        if (c.high < c.open || c.high < c.close) issues.push(`Invalid candle at index ${i}: high (${c.high}) is not the highest price`);
        if (c.low > c.open || c.low > c.close) issues.push(`Invalid candle at index ${i}: low (${c.low}) is not the lowest price`);
    }

    return { valid: issues.length === 0, issues };
}

export function progressiveAggregate(candles: Candle[], sourceResolution: number, targetResolution: number, availableIntermediates: number[]): { candles: Candle[]; path: number[] } {
    if (targetResolution <= sourceResolution) return { candles, path: [sourceResolution] };

    const path: number[] = [sourceResolution];
    let currentRes = sourceResolution;
    let currentCandles = candles;
    const sortedIntermediates = [...availableIntermediates].sort((a, b) => a - b);

    for (const intermediate of sortedIntermediates) {                                                   // Find intermediate steps
        if (intermediate > currentRes && intermediate < targetResolution) {
            currentCandles = aggregateCandles(currentCandles, currentRes, intermediate);
            path.push(intermediate);
            currentRes = intermediate;
        }
    }

    if (currentRes < targetResolution) {                                                                // Final step to target
        currentCandles = aggregateCandles(currentCandles, currentRes, targetResolution);
        path.push(targetResolution);
    }

    return { candles: currentCandles, path };
}
