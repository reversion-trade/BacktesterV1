/**
 * Math Utilities
 *
 * Shared mathematical functions used across the backtester.
 */

/**
 * Calculate sum of an array of numbers.
 */
export function sum(values: number[]): number {
    let total = 0;
    for (const v of values) total += v;
    return total;
}

/**
 * Calculate arithmetic mean of an array of numbers.
 * Returns 0 for empty arrays.
 */
export function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return sum(values) / values.length;
}

/**
 * Calculate population standard deviation.
 * Returns 0 for empty arrays.
 */
export function stddevPopulation(values: number[]): number {
    if (values.length === 0) return 0;
    const m = mean(values);
    let sumSq = 0;
    for (const v of values) {
        const d = v - m;
        sumSq += d * d;
    }
    return Math.sqrt(sumSq / values.length);
}

/**
 * Calculate sample standard deviation.
 * Returns 0 for arrays with fewer than 2 elements.
 */
export function stddevSample(values: number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    let sumSq = 0;
    for (const v of values) {
        const d = v - m;
        sumSq += d * d;
    }
    return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Calculate minimum value in array.
 * Returns Infinity for empty arrays.
 */
export function min(values: number[]): number {
    if (values.length === 0) return Infinity;
    let result = values[0]!;
    for (let i = 1; i < values.length; i++) {
        if (values[i]! < result) result = values[i]!;
    }
    return result;
}

/**
 * Calculate maximum value in array.
 * Returns -Infinity for empty arrays.
 */
export function max(values: number[]): number {
    if (values.length === 0) return -Infinity;
    let result = values[0]!;
    for (let i = 1; i < values.length; i++) {
        if (values[i]! > result) result = values[i]!;
    }
    return result;
}
