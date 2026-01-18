/**
 * Stage 1.1: MIP-Map Building Tests
 *
 * Tests for multi-resolution candle aggregation stage.
 *
 * @module simulation/stages/__tests__/mipmap-building.test
 */

import { describe, it, expect } from "bun:test";
import {
    executeMipMapBuilding,
    createMipMapInputFromDataResult,
    detectCandleResolution,
    type MipMapBuildingInput,
    type MipMapBuildingResult,
} from "../../../src/simulation/stages/mipmap-building.ts";
import { formatMipMapBuildingResult } from "./test-utils.ts";
import type { Candle, AlgoParams } from "../../../src/core/types.ts";
import type { DataLoadingResult } from "../../../src/simulation/stages/data-loading.ts";
import type { BacktestInput } from "../../../src/core/config.ts";

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

function create1mCandles(count: number, startBucket = 0): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < count; i++) {
        candles.push(createCandle(startBucket + i * 60, 42000 + i));
    }
    return candles;
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

function createMinimalDataLoadingResult(overrides: {
    candles?: Candle[];
    symbol?: string;
    algoParams?: AlgoParams;
}): DataLoadingResult {
    const candles = overrides.candles ?? create1mCandles(60);
    const algoParams = overrides.algoParams ?? createMinimalAlgoParams();

    return {
        validatedInput: {
            algoConfig: {
                userID: "test-user",
                algoID: "test-algo",
                algoName: "Test Algorithm",
                version: 1,
                params: algoParams,
            },
            runSettings: {
                userID: "test-user",
                algoID: "test-algo",
                version: "1",
                runID: "test-run-1",
                isBacktest: true,
                coinSymbol: overrides.symbol ?? "BTC",
                capitalScaler: 1,
                startTime: candles[0]?.bucket ?? 0,
                endTime: candles[candles.length - 1]?.bucket ?? 1000,
                closePositionOnExit: true,
                launchTime: Math.floor(Date.now() / 1000),
                status: "NEW",
                exchangeID: "test-exchange",
            },
            feeBps: 10,
            slippageBps: 5,
        },
        filteredCandles: candles,
        actualStartTime: candles[0]?.bucket ?? 0,
        actualEndTime: candles[candles.length - 1]?.bucket ?? 0,
        initialCapital: 10000,
        isEmpty: candles.length === 0,
        tradingStartIndex: 0,
        actualPreWarmingSeconds: 0,
    };
}

// =============================================================================
// detectCandleResolution
// =============================================================================

describe("detectCandleResolution", () => {
    it("detects 1-minute resolution", () => {
        const candles = create1mCandles(5);
        expect(detectCandleResolution(candles)).toBe(60);
    });

    it("detects 5-minute resolution", () => {
        const candles: Candle[] = [];
        for (let i = 0; i < 5; i++) {
            candles.push(createCandle(i * 300));
        }
        expect(detectCandleResolution(candles)).toBe(300);
    });

    it("returns 60 for single candle", () => {
        expect(detectCandleResolution([createCandle(0)])).toBe(60);
    });

    it("returns 60 for empty array", () => {
        expect(detectCandleResolution([])).toBe(60);
    });
});

// =============================================================================
// executeMipMapBuilding
// =============================================================================

describe("executeMipMapBuilding", () => {
    it("returns empty result for empty candles", () => {
        const input: MipMapBuildingInput = {
            candles: [],
            candleResolution: 60,
            algoParams: createMinimalAlgoParams(),
            symbol: "BTC",
        };

        const result = executeMipMapBuilding(input);

        expect(result.isEmpty).toBe(true);
        expect(result.mipMap.levels.size).toBe(0);
        expect(result.stats.sourceCandles).toBe(0);
    });

    it("builds MIP-map for candles with no indicators", () => {
        const candles = create1mCandles(60);
        const input: MipMapBuildingInput = {
            candles,
            candleResolution: 60,
            algoParams: createMinimalAlgoParams(),
            symbol: "BTC",
        };

        const result = executeMipMapBuilding(input);

        expect(result.isEmpty).toBe(false);
        expect(result.mipMap.levels.size).toBe(1); // Only base level
        expect(result.baseResolution).toBe(60);
        expect(result.mipMap.symbol).toBe("BTC");
        expect(result.indicatorConfigs).toEqual([]);
    });

    it("sets symbol on MIP-map", () => {
        const input: MipMapBuildingInput = {
            candles: create1mCandles(10),
            candleResolution: 60,
            algoParams: createMinimalAlgoParams(),
            symbol: "ETH",
        };

        const result = executeMipMapBuilding(input);

        expect(result.mipMap.symbol).toBe("ETH");
    });

    it("extracts indicator configs from algo params", () => {
        const algoParams = createMinimalAlgoParams({
            longEntry: {
                required: [
                    { type: "EMA", params: { period: 60, signal: "point_above_value", source: "1_close" } },
                ],
                optional: [],
            },
        });

        const input: MipMapBuildingInput = {
            candles: create1mCandles(120),
            candleResolution: 60,
            algoParams,
            symbol: "BTC",
        };

        const result = executeMipMapBuilding(input);

        expect(result.indicatorConfigs.length).toBe(1);
        expect(result.indicatorConfigs[0]!.type).toBe("EMA");
    });

    it("calculates stats correctly", () => {
        const input: MipMapBuildingInput = {
            candles: create1mCandles(100),
            candleResolution: 60,
            algoParams: createMinimalAlgoParams(),
            symbol: "BTC",
        };

        const result = executeMipMapBuilding(input);

        expect(result.stats.sourceCandles).toBe(100);
        expect(result.stats.levelsBuilt).toBeGreaterThanOrEqual(1);
        expect(result.stats.buildTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("returns available resolutions sorted", () => {
        const input: MipMapBuildingInput = {
            candles: create1mCandles(60),
            candleResolution: 60,
            algoParams: createMinimalAlgoParams(),
            symbol: "BTC",
        };

        const result = executeMipMapBuilding(input);

        for (let i = 1; i < result.availableResolutions.length; i++) {
            expect(result.availableResolutions[i]).toBeGreaterThan(result.availableResolutions[i - 1]!);
        }
    });
});

// =============================================================================
// createMipMapInputFromDataResult
// =============================================================================

describe("createMipMapInputFromDataResult", () => {
    it("creates input from data loading result", () => {
        const dataResult = createMinimalDataLoadingResult({
            candles: create1mCandles(60),
            symbol: "ETH",
        });

        const input = createMipMapInputFromDataResult(dataResult);

        expect(input.candles.length).toBe(60);
        expect(input.candleResolution).toBe(60);
        expect(input.symbol).toBe("ETH");
        expect(input.algoParams).toBeDefined();
    });

    it("detects candle resolution automatically", () => {
        // Create 5-minute candles
        const candles: Candle[] = [];
        for (let i = 0; i < 20; i++) {
            candles.push(createCandle(i * 300));
        }

        const dataResult = createMinimalDataLoadingResult({ candles });
        const input = createMipMapInputFromDataResult(dataResult);

        expect(input.candleResolution).toBe(300);
    });
});

// =============================================================================
// formatMipMapBuildingResult
// =============================================================================

describe("formatMipMapBuildingResult", () => {
    it("formats empty result", () => {
        const input: MipMapBuildingInput = {
            candles: [],
            candleResolution: 60,
            algoParams: createMinimalAlgoParams(),
            symbol: "BTC",
        };

        const result = executeMipMapBuilding(input);
        const formatted = formatMipMapBuildingResult(result);

        expect(formatted).toContain("Empty");
    });

    it("formats non-empty result with all fields", () => {
        const input: MipMapBuildingInput = {
            candles: create1mCandles(60),
            candleResolution: 60,
            algoParams: createMinimalAlgoParams(),
            symbol: "BTC",
        };

        const result = executeMipMapBuilding(input);
        const formatted = formatMipMapBuildingResult(result);

        expect(formatted).toContain("Stage 1.5: MIP-Map Building");
        expect(formatted).toContain("Symbol: BTC");
        expect(formatted).toContain("Base Resolution:");
        expect(formatted).toContain("Source Candles: 60");
        expect(formatted).toContain("Build Time:");
    });
});

// =============================================================================
// INTEGRATION: Full Stage 1 → Stage 1.1 Flow
// =============================================================================

describe("Stage Integration", () => {
    it("Stage 1 result can be used as Stage 1.1 input", () => {
        // Create Stage 1 result
        const dataResult = createMinimalDataLoadingResult({
            candles: create1mCandles(120),
            symbol: "BTC",
        });

        // Create Stage 1.1 input from Stage 1 result
        const mipMapInput = createMipMapInputFromDataResult(dataResult);

        // Execute Stage 1.1
        const mipMapResult = executeMipMapBuilding(mipMapInput);

        // Verify output is valid for Stage 2
        expect(mipMapResult.isEmpty).toBe(false);
        expect(mipMapResult.mipMap).toBeDefined();
        expect(mipMapResult.indicatorConfigs).toBeDefined();
        expect(mipMapResult.stats.sourceCandles).toBe(120);
    });
});
