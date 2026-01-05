/**
 * Stage 3: Resampling Tests
 *
 * Tests for signal resampling functionality.
 * CRITICAL stage per the architecture requirements.
 *
 * @module simulation/stages/__tests__/resampling.test
 */

import { describe, it, expect } from "bun:test";
import {
    executeResampling,
    validateResamplingResult,
    getResampledSignalAtBar,
    getTimestampForBar,
    formatResamplingDebugInfo,
    type ResamplingResult,
    type ResamplingInput,
} from "../resampling.ts";
import {
    getNextLowerBucket,
    generateTimestamps,
    resampleSignals,
    createSignalTimestamps,
    MIN_SIMULATION_RESOLUTION,
    RESOLUTION_BUCKETS,
} from "../../../indicators/resampler.ts";
import type { Candle } from "../../../core/types.ts";
import type { SignalCache } from "../../../indicators/calculator.ts";

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createCandle(bucket: number, close: number = 42000): Candle {
    return {
        bucket,
        open: close - 10,
        high: close + 20,
        low: close - 20,
        close,
        volume: 100,
    };
}

function createMockResamplingResult(overrides: Partial<ResamplingResult> = {}): ResamplingResult {
    const simulationTimestamps = [0, 60, 120, 180, 240];
    const resampledMap = new Map<string, boolean[]>([["indicator1", [true, true, false, false, true]]]);

    return {
        resampledSignals: {
            get: (key) => resampledMap.get(key),
            has: (key) => resampledMap.has(key),
            keys: () => Array.from(resampledMap.keys()),
            getResolution: () => 60,
            getTimestamps: () => simulationTimestamps,
        },
        simulationResolution: 60,
        simulationTimestamps,
        indicatorResolutions: [],
        minIndicatorResolution: 60,
        warmupBars: 2,
        totalSimulationBars: 5,
        resamplingStats: {
            indicatorsResampled: 1,
            upsampledCount: 0,
            downsampledCount: 0,
            noResampleCount: 1,
            originalSignalPoints: 5,
            resampledSignalPoints: 5,
        },
        ...overrides,
    };
}

// =============================================================================
// RESAMPLER UTILITY FUNCTION TESTS
// =============================================================================

describe("getNextLowerBucket", () => {
    it("returns next lower bucket for 300s (5m)", () => {
        const result = getNextLowerBucket(300);
        expect(result).toBeLessThan(300);
    });

    it("returns next lower bucket for 60s (1m)", () => {
        const result = getNextLowerBucket(60);
        expect(result).toBeLessThanOrEqual(60);
    });

    it("returns minimum bucket for smallest resolution", () => {
        const result = getNextLowerBucket(RESOLUTION_BUCKETS[0]!);
        expect(result).toBe(RESOLUTION_BUCKETS[0]);
    });

    it("handles resolution larger than any bucket", () => {
        const result = getNextLowerBucket(86400 * 365); // 1 year
        expect(RESOLUTION_BUCKETS).toContain(result);
    });

    it("returns a valid bucket resolution", () => {
        const result = getNextLowerBucket(3600);
        expect(RESOLUTION_BUCKETS).toContain(result);
    });
});

describe("generateTimestamps", () => {
    it("generates correct number of timestamps", () => {
        const timestamps = generateTimestamps(0, 300, 60);
        // 0, 60, 120, 180, 240, 300 = 6 timestamps
        expect(timestamps.length).toBe(6);
    });

    it("starts at startTime", () => {
        const timestamps = generateTimestamps(100, 400, 60);
        expect(timestamps[0]).toBe(100);
    });

    it("ends at or before endTime", () => {
        const timestamps = generateTimestamps(0, 250, 60);
        const lastTimestamp = timestamps[timestamps.length - 1]!;
        expect(lastTimestamp).toBeLessThanOrEqual(250);
    });

    it("has correct spacing between timestamps", () => {
        const resolution = 60;
        const timestamps = generateTimestamps(0, 300, resolution);

        for (let i = 1; i < timestamps.length; i++) {
            expect(timestamps[i]! - timestamps[i - 1]!).toBe(resolution);
        }
    });

    it("returns empty array when startTime > endTime", () => {
        const timestamps = generateTimestamps(300, 0, 60);
        expect(timestamps.length).toBe(0);
    });

    it("returns single timestamp when startTime equals endTime", () => {
        const timestamps = generateTimestamps(100, 100, 60);
        expect(timestamps.length).toBe(1);
        expect(timestamps[0]).toBe(100);
    });

    it("handles large time ranges", () => {
        const timestamps = generateTimestamps(0, 86400, 3600); // 24 hours, 1 hour resolution
        expect(timestamps.length).toBe(25); // 0-24 inclusive
    });
});

describe("resampleSignals", () => {
    it("forward-fills signals correctly", () => {
        const signals = [true, false, true];
        const signalTimes = [0, 120, 240];
        const simTimes = [0, 60, 120, 180, 240];

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        // At t=0: true, t=60: true (held), t=120: false, t=180: false (held), t=240: true
        expect(resampled).toEqual([true, true, false, false, true]);
    });

    it("handles empty signals array", () => {
        const signals: boolean[] = [];
        const signalTimes: number[] = [];
        const simTimes = [0, 60, 120];

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        expect(resampled).toEqual([false, false, false]);
    });

    it("handles empty simulation times", () => {
        const signals = [true, false];
        const signalTimes = [0, 60];
        const simTimes: number[] = [];

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        expect(resampled).toEqual([]);
    });

    it("uses false for times before first signal", () => {
        const signals = [true, false];
        const signalTimes = [100, 200];
        const simTimes = [0, 50, 100, 150, 200];

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        // t=0,50: before signals → false, t=100: true, t=150: true (held), t=200: false
        expect(resampled[0]).toBe(false);
        expect(resampled[1]).toBe(false);
        expect(resampled[2]).toBe(true);
    });

    it("holds last signal value after all signal times", () => {
        const signals = [true];
        const signalTimes = [0];
        const simTimes = [0, 60, 120, 180];

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        expect(resampled).toEqual([true, true, true, true]);
    });

    it("throws when signal and time arrays have different lengths", () => {
        const signals = [true, false];
        const signalTimes = [0, 60, 120]; // length 3 vs 2

        expect(() => {
            resampleSignals(signals, signalTimes, [0, 60]);
        }).toThrow();
    });

    it("handles single signal", () => {
        const signals = [true];
        const signalTimes = [0];
        const simTimes = [0, 60, 120];

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        expect(resampled).toEqual([true, true, true]);
    });

    it("handles exactly matching timestamps", () => {
        const signals = [true, false, true];
        const signalTimes = [0, 60, 120];
        const simTimes = [0, 60, 120];

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        expect(resampled).toEqual([true, false, true]);
    });

    it("handles upsampling (fewer signals than sim times)", () => {
        const signals = [true, false];
        const signalTimes = [0, 300]; // 5m resolution
        const simTimes = [0, 60, 120, 180, 240, 300]; // 1m resolution

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        // true holds from 0-240, false at 300
        expect(resampled).toEqual([true, true, true, true, true, false]);
    });

    it("handles downsampling (more signals than sim times)", () => {
        const signals = [true, true, false, false, true]; // 1m resolution
        const signalTimes = [0, 60, 120, 180, 240];
        const simTimes = [0, 120, 240]; // 2m resolution

        const resampled = resampleSignals(signals, signalTimes, simTimes);

        // t=0: true, t=120: false (latest at or before 120), t=240: true
        expect(resampled).toEqual([true, false, true]);
    });
});

describe("createSignalTimestamps", () => {
    it("generates correct timestamps from start time", () => {
        const timestamps = createSignalTimestamps(0, 5, 60);
        expect(timestamps).toEqual([0, 60, 120, 180, 240]);
    });

    it("handles non-zero start time", () => {
        const timestamps = createSignalTimestamps(100, 3, 60);
        expect(timestamps).toEqual([100, 160, 220]);
    });

    it("handles zero count", () => {
        const timestamps = createSignalTimestamps(0, 0, 60);
        expect(timestamps).toEqual([]);
    });

    it("handles different resolutions", () => {
        const timestamps = createSignalTimestamps(0, 4, 300);
        expect(timestamps).toEqual([0, 300, 600, 900]);
    });
});

// =============================================================================
// RESAMPLING STAGE TESTS
// =============================================================================

describe("executeResampling", () => {
    it("handles empty input", () => {
        const input: ResamplingInput = {
            candles: [],
            signalCache: new Map(),
            indicatorConfigs: [],
            warmupCandles: 0,
        };

        const result = executeResampling(input);

        expect(result.totalSimulationBars).toBe(0);
        expect(result.simulationTimestamps).toEqual([]);
        expect(result.resamplingStats.indicatorsResampled).toBe(0);
    });

    it("handles candles without indicators", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120)];
        const input: ResamplingInput = {
            candles,
            signalCache: new Map(),
            indicatorConfigs: [],
            warmupCandles: 0,
        };

        const result = executeResampling(input);

        expect(result.simulationResolution).toBe(MIN_SIMULATION_RESOLUTION);
        expect(result.minIndicatorResolution).toBe(MIN_SIMULATION_RESOLUTION);
        expect(result.indicatorResolutions).toEqual([]);
    });

    it("uses MIN_SIMULATION_RESOLUTION when no indicators", () => {
        const candles = [createCandle(0), createCandle(60)];
        const input: ResamplingInput = {
            candles,
            signalCache: new Map(),
            indicatorConfigs: [],
            warmupCandles: 0,
        };

        const result = executeResampling(input);

        expect(result.simulationResolution).toBe(MIN_SIMULATION_RESOLUTION);
    });

    it("calculates warmup bars correctly", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120)];
        const input: ResamplingInput = {
            candles,
            signalCache: new Map(),
            indicatorConfigs: [],
            warmupCandles: 10,
        };

        const result = executeResampling(input);

        // warmupBars = ceil((10 * MIN_SIMULATION_RESOLUTION) / simulationResolution)
        expect(result.warmupBars).toBeGreaterThan(0);
    });

    it("generates simulation timestamps for candle range", () => {
        const candles = [createCandle(0), createCandle(60), createCandle(120)];
        const input: ResamplingInput = {
            candles,
            signalCache: new Map(),
            indicatorConfigs: [],
            warmupCandles: 0,
        };

        const result = executeResampling(input);

        expect(result.simulationTimestamps[0]).toBe(0);
        expect(result.simulationTimestamps[result.simulationTimestamps.length - 1]).toBe(120);
    });

    it("resampled signals interface works correctly", () => {
        const candles = [createCandle(0), createCandle(60)];
        const signalCache: SignalCache = new Map([["testKey", [true, false]]]);
        const input: ResamplingInput = {
            candles,
            signalCache,
            indicatorConfigs: [], // Empty - no indicator factory needed
            warmupCandles: 0,
        };

        const result = executeResampling(input);

        // The resampled signals interface should work even without proper indicator configs
        // (signals that don't match indicator configs are still processed)
        expect(typeof result.resampledSignals.get).toBe("function");
        expect(typeof result.resampledSignals.has).toBe("function");
        expect(typeof result.resampledSignals.keys).toBe("function");
    });
});

// =============================================================================
// VALIDATION FUNCTION TESTS
// =============================================================================

describe("validateResamplingResult", () => {
    it("validates correct result", () => {
        const result = createMockResamplingResult();
        const validation = validateResamplingResult(result);

        expect(validation.isValid).toBe(true);
        expect(validation.issues).toEqual([]);
    });

    it("detects simulation resolution below minimum", () => {
        const result = createMockResamplingResult({
            simulationResolution: 10, // Below MIN_SIMULATION_RESOLUTION
        });
        const validation = validateResamplingResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("below minimum"))).toBe(true);
    });

    it("detects timestamp count mismatch", () => {
        const result = createMockResamplingResult({
            simulationTimestamps: [0, 60, 120],
            totalSimulationBars: 5, // Mismatch
        });
        const validation = validateResamplingResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("doesn't match"))).toBe(true);
    });

    it("detects negative warmup bars", () => {
        const result = createMockResamplingResult({
            warmupBars: -1,
        });
        const validation = validateResamplingResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("Invalid warmup"))).toBe(true);
    });

    it("detects warmup >= total bars", () => {
        const result = createMockResamplingResult({
            warmupBars: 10,
            totalSimulationBars: 5,
        });
        const validation = validateResamplingResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("Warmup") && i.includes(">="))).toBe(true);
    });

    it("returns summary statistics", () => {
        const result = createMockResamplingResult();
        const validation = validateResamplingResult(result);

        expect(validation.summary).toHaveProperty("simulationResolution");
        expect(validation.summary).toHaveProperty("totalBars");
        expect(validation.summary).toHaveProperty("indicatorsProcessed");
        expect(validation.summary).toHaveProperty("upsampled");
        expect(validation.summary).toHaveProperty("downsampled");
    });
});

describe("getResampledSignalAtBar", () => {
    it("returns signal at valid bar index", () => {
        const result = createMockResamplingResult();

        expect(getResampledSignalAtBar(result.resampledSignals, "indicator1", 0)).toBe(true);
        expect(getResampledSignalAtBar(result.resampledSignals, "indicator1", 2)).toBe(false);
        expect(getResampledSignalAtBar(result.resampledSignals, "indicator1", 4)).toBe(true);
    });

    it("returns undefined for unknown key", () => {
        const result = createMockResamplingResult();
        expect(getResampledSignalAtBar(result.resampledSignals, "unknown", 0)).toBeUndefined();
    });

    it("returns undefined for negative index", () => {
        const result = createMockResamplingResult();
        expect(getResampledSignalAtBar(result.resampledSignals, "indicator1", -1)).toBeUndefined();
    });

    it("returns undefined for out-of-bounds index", () => {
        const result = createMockResamplingResult();
        expect(getResampledSignalAtBar(result.resampledSignals, "indicator1", 100)).toBeUndefined();
    });
});

describe("getTimestampForBar", () => {
    it("returns timestamp for valid bar index", () => {
        const result = createMockResamplingResult();

        expect(getTimestampForBar(result, 0)).toBe(0);
        expect(getTimestampForBar(result, 1)).toBe(60);
        expect(getTimestampForBar(result, 4)).toBe(240);
    });

    it("returns undefined for negative index", () => {
        const result = createMockResamplingResult();
        expect(getTimestampForBar(result, -1)).toBeUndefined();
    });

    it("returns undefined for out-of-bounds index", () => {
        const result = createMockResamplingResult();
        expect(getTimestampForBar(result, 100)).toBeUndefined();
    });
});

describe("formatResamplingDebugInfo", () => {
    it("returns formatted string", () => {
        const result = createMockResamplingResult();
        const debugInfo = formatResamplingDebugInfo(result);

        expect(typeof debugInfo).toBe("string");
        expect(debugInfo.length).toBeGreaterThan(0);
    });

    it("includes simulation resolution", () => {
        const result = createMockResamplingResult();
        const debugInfo = formatResamplingDebugInfo(result);

        expect(debugInfo).toContain("Simulation Resolution");
        expect(debugInfo).toContain("60");
    });

    it("includes total bars", () => {
        const result = createMockResamplingResult();
        const debugInfo = formatResamplingDebugInfo(result);

        expect(debugInfo).toContain("Total Simulation Bars");
        expect(debugInfo).toContain("5");
    });

    it("includes warmup bars", () => {
        const result = createMockResamplingResult();
        const debugInfo = formatResamplingDebugInfo(result);

        expect(debugInfo).toContain("Warmup Bars");
        expect(debugInfo).toContain("2");
    });

    it("includes indicator statistics", () => {
        const result = createMockResamplingResult();
        const debugInfo = formatResamplingDebugInfo(result);

        expect(debugInfo).toContain("Indicator Statistics");
        expect(debugInfo).toContain("Total Indicators");
        expect(debugInfo).toContain("Upsampled");
        expect(debugInfo).toContain("Downsampled");
    });

    it("includes signal point counts", () => {
        const result = createMockResamplingResult();
        const debugInfo = formatResamplingDebugInfo(result);

        expect(debugInfo).toContain("Signal Points");
        expect(debugInfo).toContain("Original");
        expect(debugInfo).toContain("Resampled");
    });
});

// =============================================================================
// RESAMPLING STATS TESTS
// =============================================================================

describe("ResamplingStats", () => {
    it("tracks indicator counts correctly", () => {
        const result = createMockResamplingResult();

        expect(result.resamplingStats.indicatorsResampled).toBe(1);
        expect(result.resamplingStats.upsampledCount).toBeGreaterThanOrEqual(0);
        expect(result.resamplingStats.downsampledCount).toBeGreaterThanOrEqual(0);
        expect(result.resamplingStats.noResampleCount).toBeGreaterThanOrEqual(0);
    });

    it("tracks signal point counts correctly", () => {
        const result = createMockResamplingResult();

        expect(result.resamplingStats.originalSignalPoints).toBeGreaterThanOrEqual(0);
        expect(result.resamplingStats.resampledSignalPoints).toBeGreaterThanOrEqual(0);
    });
});
