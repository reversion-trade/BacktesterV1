import type { EquityPoint } from "../output/types.ts";

// =============================================================================
// BASIC DOWNSAMPLING
// =============================================================================

/**
 * Simple downsampling: take every Nth point.
 *
 * @param points - Array of points to downsample
 * @param factor - Take every Nth point (e.g., 10 = keep every 10th)
 * @returns Downsampled array
 */
export function downsample<T>(points: T[], factor: number): T[] {
    if (factor <= 1) return points;
    if (points.length === 0) return [];

    const result: T[] = [];

    for (let i = 0; i < points.length; i += factor) {
        result.push(points[i]!);
    }

    // Always include the last point
    const lastIdx = points.length - 1;
    if (lastIdx % factor !== 0) {
        result.push(points[lastIdx]!);
    }

    return result;
}

/**
 * Downsample to a target number of points.
 *
 * @param points - Array of points to downsample
 * @param targetCount - Desired number of points in result
 * @returns Downsampled array
 */
export function downsampleToCount<T>(points: T[], targetCount: number): T[] {
    if (targetCount >= points.length) return points;
    if (targetCount <= 0) return [];

    const factor = Math.ceil(points.length / targetCount);
    return downsample(points, factor);
}

// =============================================================================
// PEAK-PRESERVING DOWNSAMPLING
// =============================================================================

/**
 * Downsample while preserving local peaks and valleys.
 * Uses the Largest Triangle Three Buckets (LTTB) algorithm concept.
 *
 * @param points - Array of equity points
 * @param targetCount - Desired number of points
 * @returns Downsampled array with preserved extremes
 */
export function downsampleWithPeaks(points: EquityPoint[], targetCount: number): EquityPoint[] {
    if (targetCount >= points.length) return points;
    if (targetCount <= 2) {
        // Just return first and last
        return points.length > 0 ? [points[0]!, points[points.length - 1]!] : [];
    }

    const result: EquityPoint[] = [];

    // Always include first point
    result.push(points[0]!);

    // Calculate bucket size
    const bucketSize = (points.length - 2) / (targetCount - 2);

    let lastSelectedIndex = 0;

    for (let i = 0; i < targetCount - 2; i++) {
        // Calculate bucket boundaries
        const bucketStart = Math.floor(1 + i * bucketSize);
        const bucketEnd = Math.floor(1 + (i + 1) * bucketSize);

        // Find the point in this bucket that maximizes triangle area
        // with the last selected point and the average of the next bucket
        let maxArea = -1;
        let maxAreaIndex = bucketStart;

        // Calculate average of next bucket
        const nextBucketStart = bucketEnd;
        const nextBucketEnd = Math.min(Math.floor(1 + (i + 2) * bucketSize), points.length - 1);

        let avgX = 0;
        let avgY = 0;
        let nextBucketCount = 0;

        for (let j = nextBucketStart; j <= nextBucketEnd; j++) {
            avgX += points[j]!.time;
            avgY += points[j]!.equity;
            nextBucketCount++;
        }

        if (nextBucketCount > 0) {
            avgX /= nextBucketCount;
            avgY /= nextBucketCount;
        }

        // Find point with max triangle area
        const lastPoint = points[lastSelectedIndex]!;

        for (let j = bucketStart; j < bucketEnd && j < points.length; j++) {
            const point = points[j]!;

            // Calculate triangle area
            const area = Math.abs(
                (lastPoint.time - avgX) * (point.equity - lastPoint.equity) -
                    (lastPoint.time - point.time) * (avgY - lastPoint.equity)
            );

            if (area > maxArea) {
                maxArea = area;
                maxAreaIndex = j;
            }
        }

        result.push(points[maxAreaIndex]!);
        lastSelectedIndex = maxAreaIndex;
    }

    // Always include last point
    result.push(points[points.length - 1]!);

    return result;
}

/**
 * Downsample while always preserving drawdown peaks.
 * Never lose a point that represents a local maximum drawdown.
 *
 * @param points - Array of equity points
 * @param targetCount - Desired number of points (may exceed if many peaks)
 * @returns Downsampled array with preserved drawdown peaks
 */
export function downsamplePreserveDrawdownPeaks(points: EquityPoint[], targetCount: number): EquityPoint[] {
    if (points.length === 0) return [];
    if (targetCount >= points.length) return points;

    // Find all drawdown peaks (local maxima in drawdown)
    const peakIndices = new Set<number>();
    peakIndices.add(0); // Always keep first
    peakIndices.add(points.length - 1); // Always keep last

    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]!.drawdownPct;
        const curr = points[i]!.drawdownPct;
        const next = points[i + 1]!.drawdownPct;

        // Is this a local peak in drawdown?
        if (curr >= prev && curr >= next && curr > 0) {
            peakIndices.add(i);
        }
    }

    // If peaks alone exceed target, just return peaks
    if (peakIndices.size >= targetCount) {
        const indices = Array.from(peakIndices).sort((a, b) => a - b);
        return indices.map((i) => points[i]!);
    }

    // Fill remaining quota with evenly spaced points
    const remainingQuota = targetCount - peakIndices.size;
    const step = points.length / (remainingQuota + 1);

    for (let i = 1; i <= remainingQuota; i++) {
        const idx = Math.round(i * step);
        if (idx > 0 && idx < points.length - 1) {
            peakIndices.add(idx);
        }
    }

    // Sort indices and extract points
    const sortedIndices = Array.from(peakIndices).sort((a, b) => a - b);
    return sortedIndices.map((i) => points[i]!);
}
