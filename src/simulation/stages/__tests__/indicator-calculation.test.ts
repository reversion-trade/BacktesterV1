/**
 * Stage 2: Indicator Calculation Tests
 *
 * Tests for indicator pre-calculation functionality.
 *
 * @module simulation/stages/__tests__/indicator-calculation.test
 */

import { describe, it, expect } from "bun:test";
import {
  executeIndicatorCalculation,
  createIndicatorInputFromDataResult,
  validateIndicatorResult,
  getSignalAtBar,
  type IndicatorCalculationResult,
  type IndicatorCalculationInput,
} from "../indicator-calculation.ts";
import type { Candle, AlgoParams } from "../../../core/types.ts";
import type { SignalCache } from "../../../indicators/calculator.ts";
import type { DataLoadingResult } from "../data-loading.ts";

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

function createMinimalAlgoParams(
  overrides: Partial<AlgoParams> = {}
): AlgoParams {
  return {
    type: "LONG",
    longEntry: { required: [], optional: [] },
    positionSize: { type: "REL", value: 0.1 },
    orderType: "MARKET",
    startingCapitalUSD: 10000,
    ...overrides,
  };
}

function createMockSignalCache(
  entries: [string, boolean[]][]
): SignalCache {
  const map = new Map<string, boolean[]>(entries);
  return {
    get: (key: string) => map.get(key),
    has: (key: string) => map.has(key),
    keys: () => Array.from(map.keys()),
    set: (key: string, signals: boolean[]) => {
      map.set(key, signals);
      return map as unknown as SignalCache;
    },
    size: map.size,
  } as unknown as SignalCache;
}

function createMockIndicatorResult(
  overrides: Partial<IndicatorCalculationResult> = {}
): IndicatorCalculationResult {
  const signalCache = createMockSignalCache([
    ["indicator1", [true, false, true, true, false]],
    ["indicator2", [false, false, true, false, true]],
  ]);

  return {
    signalCache,
    warmupCandles: 10,
    indicatorConfigs: [
      { type: "RSI", params: {} } as any,
      { type: "EMA", params: {} } as any,
    ],
    uniqueIndicatorCount: 2,
    indicatorKeys: ["indicator1", "indicator2"],
    ...overrides,
  };
}

function createMockDataLoadingResult(): DataLoadingResult {
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
        assumePositionImmediately: false,
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
  };
}

// =============================================================================
// EXECUTE INDICATOR CALCULATION TESTS
// =============================================================================

describe("executeIndicatorCalculation", () => {
  it("handles empty indicator configs", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0), createCandle(60), createCandle(120)],
      algoParams: createMinimalAlgoParams({
        longEntry: { required: [], optional: [] },
        longExit: { required: [], optional: [] },
      }),
    };

    const result = executeIndicatorCalculation(input);

    expect(result.indicatorConfigs).toEqual([]);
    expect(result.uniqueIndicatorCount).toBe(0);
    expect(result.indicatorKeys).toEqual([]);
    expect(result.warmupCandles).toBe(0);
  });

  it("returns signal cache interface", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0), createCandle(60)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(result.signalCache).toBeDefined();
    expect(typeof result.signalCache.get).toBe("function");
    expect(typeof result.signalCache.has).toBe("function");
    expect(typeof result.signalCache.keys).toBe("function");
  });

  it("returns warmup candles value", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0), createCandle(60)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(typeof result.warmupCandles).toBe("number");
    expect(result.warmupCandles).toBeGreaterThanOrEqual(0);
  });

  it("returns indicator configs array", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0), createCandle(60)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(Array.isArray(result.indicatorConfigs)).toBe(true);
  });

  it("returns unique indicator count", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0), createCandle(60)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(typeof result.uniqueIndicatorCount).toBe("number");
    expect(result.uniqueIndicatorCount).toBeGreaterThanOrEqual(0);
  });

  it("returns indicator keys array", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0), createCandle(60)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(Array.isArray(result.indicatorKeys)).toBe(true);
  });

  it("handles empty candles array", () => {
    const input: IndicatorCalculationInput = {
      candles: [],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(result.indicatorKeys.length).toBe(0);
  });

  it("handles single candle", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(result).toBeDefined();
    expect(result.warmupCandles).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// CREATE INDICATOR INPUT FROM DATA RESULT TESTS
// =============================================================================

describe("createIndicatorInputFromDataResult", () => {
  it("extracts candles from data result", () => {
    const dataResult = createMockDataLoadingResult();

    const input = createIndicatorInputFromDataResult(dataResult);

    expect(input.candles).toEqual(dataResult.filteredCandles);
    expect(input.candles.length).toBe(3);
  });

  it("extracts algo params from data result", () => {
    const dataResult = createMockDataLoadingResult();

    const input = createIndicatorInputFromDataResult(dataResult);

    expect(input.algoParams).toEqual(
      dataResult.validatedInput.algoConfig.params
    );
  });

  it("preserves algo params structure", () => {
    const dataResult = createMockDataLoadingResult();

    const input = createIndicatorInputFromDataResult(dataResult);

    expect(input.algoParams.type).toBe("LONG");
    expect(input.algoParams.positionSize).toBeDefined();
    expect(input.algoParams.orderType).toBe("MARKET");
  });

  it("handles empty filtered candles", () => {
    const dataResult = createMockDataLoadingResult();
    dataResult.filteredCandles = [];

    const input = createIndicatorInputFromDataResult(dataResult);

    expect(input.candles).toEqual([]);
  });
});

// =============================================================================
// VALIDATE INDICATOR RESULT TESTS
// =============================================================================

describe("validateIndicatorResult", () => {
  it("validates correct result", () => {
    const result = createMockIndicatorResult();
    const validation = validateIndicatorResult(result);

    expect(validation.isValid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("detects empty indicator configs", () => {
    const result = createMockIndicatorResult({
      indicatorConfigs: [],
    });
    const validation = validateIndicatorResult(result);

    expect(validation.isValid).toBe(false);
    expect(validation.issues.some((i) => i.includes("No indicator"))).toBe(true);
  });

  it("detects missing signals for key", () => {
    const signalCache = createMockSignalCache([
      ["indicator1", [true, false]],
      // indicator2 is missing but in indicatorKeys
    ]);
    const result = createMockIndicatorResult({
      signalCache,
      indicatorKeys: ["indicator1", "indicator2"],
    });
    const validation = validateIndicatorResult(result);

    expect(validation.isValid).toBe(false);
    expect(validation.issues.some((i) => i.includes("Missing signals"))).toBe(true);
  });

  it("detects empty signal array", () => {
    const signalCache = createMockSignalCache([
      ["indicator1", [true, false]],
      ["indicator2", []], // Empty array
    ]);
    const result = createMockIndicatorResult({
      signalCache,
      indicatorKeys: ["indicator1", "indicator2"],
    });
    const validation = validateIndicatorResult(result);

    expect(validation.isValid).toBe(false);
    expect(validation.issues.some((i) => i.includes("Empty signal"))).toBe(true);
  });

  it("detects negative warmup candles", () => {
    const result = createMockIndicatorResult({
      warmupCandles: -1,
    });
    const validation = validateIndicatorResult(result);

    expect(validation.isValid).toBe(false);
    expect(validation.issues.some((i) => i.includes("Invalid warmup"))).toBe(true);
  });

  it("returns summary statistics", () => {
    const result = createMockIndicatorResult();
    const validation = validateIndicatorResult(result);

    expect(validation.summary).toHaveProperty("configCount");
    expect(validation.summary).toHaveProperty("uniqueCount");
    expect(validation.summary).toHaveProperty("warmupCandles");
    expect(validation.summary).toHaveProperty("duplicatesRemoved");
  });

  it("calculates duplicates removed correctly", () => {
    const result = createMockIndicatorResult({
      indicatorConfigs: [{} as any, {} as any, {} as any], // 3 configs
      uniqueIndicatorCount: 2, // Only 2 unique
    });
    const validation = validateIndicatorResult(result);

    expect(validation.summary.duplicatesRemoved).toBe(1);
  });

  it("handles zero warmup candles", () => {
    const result = createMockIndicatorResult({
      warmupCandles: 0,
    });
    const validation = validateIndicatorResult(result);

    // Zero warmup is valid
    expect(validation.issues.some((i) => i.includes("warmup"))).toBe(false);
  });
});

// =============================================================================
// GET SIGNAL AT BAR TESTS
// =============================================================================

describe("getSignalAtBar", () => {
  it("returns signal at valid index", () => {
    const signalCache = createMockSignalCache([
      ["test", [true, false, true, false]],
    ]);

    expect(getSignalAtBar(signalCache, "test", 0)).toBe(true);
    expect(getSignalAtBar(signalCache, "test", 1)).toBe(false);
    expect(getSignalAtBar(signalCache, "test", 2)).toBe(true);
    expect(getSignalAtBar(signalCache, "test", 3)).toBe(false);
  });

  it("returns undefined for unknown key", () => {
    const signalCache = createMockSignalCache([
      ["test", [true, false]],
    ]);

    expect(getSignalAtBar(signalCache, "unknown", 0)).toBeUndefined();
  });

  it("returns undefined for negative index", () => {
    const signalCache = createMockSignalCache([
      ["test", [true, false]],
    ]);

    expect(getSignalAtBar(signalCache, "test", -1)).toBeUndefined();
  });

  it("returns undefined for out-of-bounds index", () => {
    const signalCache = createMockSignalCache([
      ["test", [true, false]],
    ]);

    expect(getSignalAtBar(signalCache, "test", 100)).toBeUndefined();
  });

  it("handles empty signal array", () => {
    const signalCache = createMockSignalCache([
      ["test", []],
    ]);

    expect(getSignalAtBar(signalCache, "test", 0)).toBeUndefined();
  });

  it("handles single element array", () => {
    const signalCache = createMockSignalCache([
      ["test", [true]],
    ]);

    expect(getSignalAtBar(signalCache, "test", 0)).toBe(true);
    expect(getSignalAtBar(signalCache, "test", 1)).toBeUndefined();
  });

  it("handles boundary index (last element)", () => {
    const signalCache = createMockSignalCache([
      ["test", [true, false, true]],
    ]);

    expect(getSignalAtBar(signalCache, "test", 2)).toBe(true);
    expect(getSignalAtBar(signalCache, "test", 3)).toBeUndefined();
  });
});

// =============================================================================
// RESULT STRUCTURE TESTS
// =============================================================================

describe("IndicatorCalculationResult structure", () => {
  it("contains all required fields", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0), createCandle(60)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(result).toHaveProperty("signalCache");
    expect(result).toHaveProperty("warmupCandles");
    expect(result).toHaveProperty("indicatorConfigs");
    expect(result).toHaveProperty("uniqueIndicatorCount");
    expect(result).toHaveProperty("indicatorKeys");
  });

  it("signalCache has required methods", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(typeof result.signalCache.get).toBe("function");
    expect(typeof result.signalCache.has).toBe("function");
    expect(typeof result.signalCache.keys).toBe("function");
  });

  it("indicator keys match signal cache keys", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    const cacheKeys = result.signalCache.keys();
    expect(result.indicatorKeys).toEqual(cacheKeys);
  });

  it("unique indicator count matches indicator keys length", () => {
    const input: IndicatorCalculationInput = {
      candles: [createCandle(0)],
      algoParams: createMinimalAlgoParams(),
    };

    const result = executeIndicatorCalculation(input);

    expect(result.uniqueIndicatorCount).toBe(result.indicatorKeys.length);
  });
});
