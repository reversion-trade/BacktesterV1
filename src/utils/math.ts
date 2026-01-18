/** Math Utilities - Shared mathematical functions for backtester calculations. */
export function sum(values: number[]): number {
    let total = 0;
    for (const v of values) total += v;
    return total;
}

export function mean(values: number[]): number {                                // Arithmetic mean, returns 0 for empty arrays
    if (values.length === 0) return 0;
    return sum(values) / values.length;
}

export function stddevPopulation(values: number[]): number {                    // Population std dev, returns 0 for empty arrays
    if (values.length === 0) return 0;
    const m = mean(values);
    let sumSq = 0;
    for (const v of values) { const d = v - m; sumSq += d * d; }
    return Math.sqrt(sumSq / values.length);
}
