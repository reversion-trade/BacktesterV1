/**
 * Stage 4: Initialization Tests
 *
 * Tests for algo state initialization functionality.
 *
 * @module simulation/stages/__tests__/initialization.test
 */

import { describe, it, expect } from "bun:test";
import {
    executeInitialization,
    buildIndicatorInfoMap,
    type InitializationResult,
    type InitializationInput,
} from "../../../src/simulation/stages/initialization.ts";
import {
    getIndicatorKeys,
    getIndicatorsForCondition,
    getRequiredIndicatorCount,
    validateInitializationResult,
} from "./test-utils.ts";
import type { AlgoParams, Candle } from "../../../src/core/types.ts";
import type { IndicatorInfo, ConditionType } from "../../../src/events/index.ts";
import { EventCollector } from "../../../src/events/index.ts";
import type { DataLoadingResult } from "../../../src/simulation/stages/data-loading.ts";
import type { ResamplingResult, ResampledSignalCache } from "../../../src/simulation/stages/resampling.ts";

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

function createMinimalAlgoParams(overrides: Partial<AlgoParams> = {}): AlgoParams {
    return {
        type: "LONG",
        longEntry: { required: [], optional: [] },
        positionSize: { type: "REL", value: 0.1 },
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 },
        ...overrides,
    };
}

function createMockDataLoadingResult(overrides: Partial<DataLoadingResult> = {}): DataLoadingResult {
    const now = Math.floor(Date.now() / 1000);
    return {
        validatedInput: {
            algoConfig: {
                userID: "test-user",
                algoID: "test-algo",
                algoName: "Test Algorithm",
                version: 1,
                params: createMinimalAlgoParams(),
            },
            runSettings: {
                userID: "test-user",
                algoID: "test-algo",
                version: "1",
                runID: "test-run-1",
                isBacktest: true,
                coinSymbol: "BTC",
                capitalScaler: 1,
                startTime: 1000,
                endTime: 2000,
                closePositionOnExit: true,
                launchTime: now,
                status: "NEW",
                exchangeID: "test-exchange",
            },
            feeBps: 10,
            slippageBps: 5,
        },
        filteredCandles: [createCandle(1000), createCandle(1060), createCandle(1120)],
        actualStartTime: 1000,
        actualEndTime: 1120,
        initialCapital: 10000,
        isEmpty: false,
        tradingStartIndex: 0,
        actualPreWarmingSeconds: 0,
        ...overrides,
    };
}

function createMockResamplingResult(overrides: Partial<ResamplingResult> = {}): ResamplingResult {
    const simulationTimestamps = [1000, 1060, 1120];
    const resampledMap = new Map<string, boolean[]>();

    const resampledSignals: ResampledSignalCache = {
        get: (key) => resampledMap.get(key),
        has: (key) => resampledMap.has(key),
        keys: () => Array.from(resampledMap.keys()),
        getResolution: () => 60,
        getTimestamps: () => simulationTimestamps,
    };

    return {
        resampledSignals,
        simulationResolution: 60,
        simulationTimestamps,
        indicatorResolutions: [],
        minIndicatorResolution: 60,
        warmupBars: 10,
        totalSimulationBars: 3,
        resamplingStats: {
            indicatorsResampled: 0,
            upsampledCount: 0,
            downsampledCount: 0,
            noResampleCount: 0,
            originalSignalPoints: 0,
            resampledSignalPoints: 0,
        },
        ...overrides,
    };
}

function createMockIndicatorInfoMap(entries: [string, Partial<IndicatorInfo>][]): Map<string, IndicatorInfo> {
    return new Map(
        entries.map(([key, partial]) => [
            key,
            {
                indicatorKey: key,
                indicatorType: "RSI",
                conditionType: "LONG_ENTRY" as ConditionType,
                isRequired: true,
                ...partial,
            },
        ])
    );
}

function createMockInitializationResult(overrides: Partial<InitializationResult> = {}): InitializationResult {
    return {
        collector: new EventCollector("BTC"),
        indicatorInfoMap: new Map(),
        initialState: "CASH",
        initialCapital: 10000,
        closePositionOnExit: true,
        feeBps: 10,
        slippageBps: 5,
        symbol: "BTC",
        warmupBars: 10,
        algoParams: createMinimalAlgoParams(),
        ...overrides,
    };
}

// =============================================================================
// EXECUTE INITIALIZATION TESTS
// =============================================================================

describe("executeInitialization", () => {
    it("creates EventCollector", () => {
        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.collector).toBeDefined();
        expect(result.collector).toBeInstanceOf(EventCollector);
    });

    it("sets initial state to CASH", () => {
        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.initialState).toBe("CASH");
    });

    it("preserves initial capital from data result", () => {
        const dataResult = createMockDataLoadingResult();
        dataResult.initialCapital = 25000;

        const input: InitializationInput = {
            dataResult,
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.initialCapital).toBe(25000);
    });

    it("extracts closePositionOnExit from run settings", () => {
        const dataResult = createMockDataLoadingResult();
        dataResult.validatedInput.runSettings.closePositionOnExit = false;

        const input: InitializationInput = {
            dataResult,
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.closePositionOnExit).toBe(false);
    });

    it("extracts tradesLimit from run settings", () => {
        const dataResult = createMockDataLoadingResult();
        dataResult.validatedInput.runSettings.tradesLimit = 50;

        const input: InitializationInput = {
            dataResult,
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.tradesLimit).toBe(50);
    });

    it("extracts fees from validated input", () => {
        const dataResult = createMockDataLoadingResult();
        dataResult.validatedInput.feeBps = 15;
        dataResult.validatedInput.slippageBps = 8;

        const input: InitializationInput = {
            dataResult,
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.feeBps).toBe(15);
        expect(result.slippageBps).toBe(8);
    });

    it("extracts symbol from run settings", () => {
        const dataResult = createMockDataLoadingResult();
        dataResult.validatedInput.runSettings.coinSymbol = "ETH";

        const input: InitializationInput = {
            dataResult,
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.symbol).toBe("ETH");
    });

    it("extracts warmup bars from resampling result", () => {
        const resamplingResult = createMockResamplingResult();
        resamplingResult.warmupBars = 25;

        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult,
        };

        const result = executeInitialization(input);

        expect(result.warmupBars).toBe(25);
    });

    it("extracts algo params from data result", () => {
        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.algoParams).toBeDefined();
        expect(result.algoParams.type).toBe("LONG");
    });

    it("returns indicator info map", () => {
        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.indicatorInfoMap).toBeInstanceOf(Map);
    });

    it("handles empty conditions (no indicators)", () => {
        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result.indicatorInfoMap.size).toBe(0);
    });
});

// =============================================================================
// BUILD INDICATOR INFO MAP TESTS
// =============================================================================

describe("buildIndicatorInfoMap", () => {
    it("returns empty map for empty conditions", () => {
        const algoParams = createMinimalAlgoParams({
            longEntry: { required: [], optional: [] },
            longExit: { required: [], optional: [] },
        });

        const map = buildIndicatorInfoMap(algoParams);

        expect(map.size).toBe(0);
    });

    it("handles undefined conditions", () => {
        const algoParams = createMinimalAlgoParams({
            longEntry: undefined,
            longExit: undefined,
            shortEntry: undefined,
            shortExit: undefined,
        });

        const map = buildIndicatorInfoMap(algoParams);

        expect(map.size).toBe(0);
    });

    it("handles LONG type with empty conditions", () => {
        const algoParams = createMinimalAlgoParams({
            type: "LONG",
            longEntry: { required: [], optional: [] },
        });

        // Should not throw
        const map = buildIndicatorInfoMap(algoParams);
        expect(map).toBeInstanceOf(Map);
    });

    it("handles SHORT type with empty conditions", () => {
        const algoParams = createMinimalAlgoParams({
            type: "SHORT",
            shortEntry: { required: [], optional: [] },
        });

        // Should not throw
        const map = buildIndicatorInfoMap(algoParams);
        expect(map).toBeInstanceOf(Map);
    });

    it("handles BOTH type with empty conditions", () => {
        const algoParams = createMinimalAlgoParams({
            type: "BOTH",
            longEntry: { required: [], optional: [] },
            shortEntry: { required: [], optional: [] },
        });

        // Should not throw
        const map = buildIndicatorInfoMap(algoParams);
        expect(map).toBeInstanceOf(Map);
    });
});

// =============================================================================
// GET INDICATOR KEYS TESTS
// =============================================================================

describe("getIndicatorKeys", () => {
    it("returns empty array for empty map", () => {
        const map = new Map<string, IndicatorInfo>();

        const keys = getIndicatorKeys(map);

        expect(keys).toEqual([]);
    });

    it("returns all keys from map", () => {
        const map = createMockIndicatorInfoMap([
            ["indicator1", {}],
            ["indicator2", {}],
            ["indicator3", {}],
        ]);

        const keys = getIndicatorKeys(map);

        expect(keys.length).toBe(3);
        expect(keys).toContain("indicator1");
        expect(keys).toContain("indicator2");
        expect(keys).toContain("indicator3");
    });

    it("returns keys in insertion order", () => {
        const map = new Map<string, IndicatorInfo>();
        map.set("first", {
            indicatorKey: "first",
            indicatorType: "RSI",
            conditionType: "LONG_ENTRY",
            isRequired: true,
        });
        map.set("second", {
            indicatorKey: "second",
            indicatorType: "EMA",
            conditionType: "LONG_EXIT",
            isRequired: false,
        });

        const keys = getIndicatorKeys(map);

        expect(keys[0]).toBe("first");
        expect(keys[1]).toBe("second");
    });
});

// =============================================================================
// GET INDICATORS FOR CONDITION TESTS
// =============================================================================

describe("getIndicatorsForCondition", () => {
    it("returns empty array for empty map", () => {
        const map = new Map<string, IndicatorInfo>();

        const indicators = getIndicatorsForCondition(map, "LONG_ENTRY");

        expect(indicators).toEqual([]);
    });

    it("filters by condition type", () => {
        const map = createMockIndicatorInfoMap([
            ["ind1", { conditionType: "LONG_ENTRY" }],
            ["ind2", { conditionType: "LONG_EXIT" }],
            ["ind3", { conditionType: "LONG_ENTRY" }],
        ]);

        const entryIndicators = getIndicatorsForCondition(map, "LONG_ENTRY");

        expect(entryIndicators.length).toBe(2);
        expect(entryIndicators.every((i) => i.conditionType === "LONG_ENTRY")).toBe(true);
    });

    it("returns all condition types correctly", () => {
        const map = createMockIndicatorInfoMap([
            ["ind1", { conditionType: "LONG_ENTRY" }],
            ["ind2", { conditionType: "LONG_EXIT" }],
            ["ind3", { conditionType: "SHORT_ENTRY" }],
            ["ind4", { conditionType: "SHORT_EXIT" }],
        ]);

        expect(getIndicatorsForCondition(map, "LONG_ENTRY").length).toBe(1);
        expect(getIndicatorsForCondition(map, "LONG_EXIT").length).toBe(1);
        expect(getIndicatorsForCondition(map, "SHORT_ENTRY").length).toBe(1);
        expect(getIndicatorsForCondition(map, "SHORT_EXIT").length).toBe(1);
    });

    it("returns empty array for non-existent condition type", () => {
        const map = createMockIndicatorInfoMap([["ind1", { conditionType: "LONG_ENTRY" }]]);

        const shortExitIndicators = getIndicatorsForCondition(map, "SHORT_EXIT");

        expect(shortExitIndicators).toEqual([]);
    });
});

// =============================================================================
// GET REQUIRED INDICATOR COUNT TESTS
// =============================================================================

describe("getRequiredIndicatorCount", () => {
    it("returns 0 for empty map", () => {
        const map = new Map<string, IndicatorInfo>();

        const count = getRequiredIndicatorCount(map, "LONG_ENTRY");

        expect(count).toBe(0);
    });

    it("counts only required indicators", () => {
        const map = createMockIndicatorInfoMap([
            ["ind1", { conditionType: "LONG_ENTRY", isRequired: true }],
            ["ind2", { conditionType: "LONG_ENTRY", isRequired: false }],
            ["ind3", { conditionType: "LONG_ENTRY", isRequired: true }],
        ]);

        const count = getRequiredIndicatorCount(map, "LONG_ENTRY");

        expect(count).toBe(2);
    });

    it("filters by condition type", () => {
        const map = createMockIndicatorInfoMap([
            ["ind1", { conditionType: "LONG_ENTRY", isRequired: true }],
            ["ind2", { conditionType: "LONG_EXIT", isRequired: true }],
            ["ind3", { conditionType: "LONG_ENTRY", isRequired: true }],
        ]);

        const entryCount = getRequiredIndicatorCount(map, "LONG_ENTRY");
        const exitCount = getRequiredIndicatorCount(map, "LONG_EXIT");

        expect(entryCount).toBe(2);
        expect(exitCount).toBe(1);
    });

    it("returns 0 when all are optional", () => {
        const map = createMockIndicatorInfoMap([
            ["ind1", { conditionType: "LONG_ENTRY", isRequired: false }],
            ["ind2", { conditionType: "LONG_ENTRY", isRequired: false }],
        ]);

        const count = getRequiredIndicatorCount(map, "LONG_ENTRY");

        expect(count).toBe(0);
    });
});

// =============================================================================
// VALIDATE INITIALIZATION RESULT TESTS
// =============================================================================

describe("validateInitializationResult", () => {
    it("validates correct result", () => {
        const result = createMockInitializationResult();
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(true);
        expect(validation.issues).toEqual([]);
    });

    it("detects invalid initial capital", () => {
        const result = createMockInitializationResult({
            initialCapital: 0,
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("initial capital"))).toBe(true);
    });

    it("detects negative initial capital", () => {
        const result = createMockInitializationResult({
            initialCapital: -1000,
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("initial capital"))).toBe(true);
    });

    it("detects negative warmup bars", () => {
        const result = createMockInitializationResult({
            warmupBars: -1,
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("warmup"))).toBe(true);
    });

    it("detects negative fee bps", () => {
        const result = createMockInitializationResult({
            feeBps: -1,
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("fee"))).toBe(true);
    });

    it("detects negative slippage bps", () => {
        const result = createMockInitializationResult({
            slippageBps: -1,
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("slippage"))).toBe(true);
    });

    it("returns summary statistics", () => {
        const result = createMockInitializationResult();
        const validation = validateInitializationResult(result);

        expect(validation.summary).toHaveProperty("indicatorCount");
        expect(validation.summary).toHaveProperty("longEntryIndicators");
        expect(validation.summary).toHaveProperty("longExitIndicators");
        expect(validation.summary).toHaveProperty("shortEntryIndicators");
        expect(validation.summary).toHaveProperty("shortExitIndicators");
        expect(validation.summary).toHaveProperty("initialCapital");
        expect(validation.summary).toHaveProperty("warmupBars");
    });

    it("accepts zero warmup bars", () => {
        const result = createMockInitializationResult({
            warmupBars: 0,
        });
        const validation = validateInitializationResult(result);

        expect(validation.issues.some((i) => i.includes("warmup"))).toBe(false);
    });

    it("accepts zero fees", () => {
        const result = createMockInitializationResult({
            feeBps: 0,
            slippageBps: 0,
        });
        const validation = validateInitializationResult(result);

        expect(validation.issues.some((i) => i.includes("fee"))).toBe(false);
        expect(validation.issues.some((i) => i.includes("slippage"))).toBe(false);
    });

    it("validates LONG algo type needs longEntry", () => {
        const result = createMockInitializationResult({
            algoParams: createMinimalAlgoParams({
                type: "LONG",
                longEntry: undefined,
            }),
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("LONG") && i.includes("longEntry"))).toBe(true);
    });

    it("validates SHORT algo type needs shortEntry", () => {
        const result = createMockInitializationResult({
            algoParams: createMinimalAlgoParams({
                type: "SHORT",
                shortEntry: undefined,
            }),
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("SHORT") && i.includes("shortEntry"))).toBe(true);
    });

    it("validates BOTH algo type needs entry conditions", () => {
        const result = createMockInitializationResult({
            algoParams: createMinimalAlgoParams({
                type: "BOTH",
                longEntry: undefined,
                shortEntry: undefined,
            }),
        });
        const validation = validateInitializationResult(result);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("BOTH"))).toBe(true);
    });
});

// =============================================================================
// RESULT STRUCTURE TESTS
// =============================================================================

describe("InitializationResult structure", () => {
    it("contains all required fields", () => {
        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        expect(result).toHaveProperty("collector");
        expect(result).toHaveProperty("indicatorInfoMap");
        expect(result).toHaveProperty("initialState");
        expect(result).toHaveProperty("initialCapital");
        expect(result).toHaveProperty("closePositionOnExit");
        expect(result).toHaveProperty("feeBps");
        expect(result).toHaveProperty("slippageBps");
        expect(result).toHaveProperty("symbol");
        expect(result).toHaveProperty("warmupBars");
        expect(result).toHaveProperty("algoParams");
    });

    it("tradesLimit is optional", () => {
        const input: InitializationInput = {
            dataResult: createMockDataLoadingResult(),
            resamplingResult: createMockResamplingResult(),
        };

        const result = executeInitialization(input);

        // tradesLimit may be undefined
        expect("tradesLimit" in result).toBe(true);
    });
});
