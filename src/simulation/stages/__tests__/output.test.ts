/**
 * Stage 6: Output Generation Tests
 *
 * Tests for output generation and metrics calculation.
 *
 * @module simulation/stages/__tests__/output.test
 */

import { describe, it, expect } from "bun:test";
import {
    executeOutputGeneration,
    calculateMetrics,
    createEmptyBacktestOutput,
    createEmptySwapMetrics,
    createEmptyAlgoMetrics,
    type OutputGenerationInput,
} from "../output.ts";
import { validateBacktestOutput, formatOutputSummary } from "./test-utils.ts";
import type { BacktestOutput, TradeEvent, AlgoEvent, SwapEvent } from "../../../events/types.ts";
import type { BacktestInput } from "../../../core/config.ts";
import type { SimulationResult, EquityPoint } from "../../../output/types.ts";
import type { DataLoadingResult } from "../data-loading.ts";
import type { AlgoParams, Candle, Direction } from "../../../core/types.ts";

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

function createMinimalAlgoParams(): AlgoParams {
    return {
        type: "LONG",
        longEntry: { required: [], optional: [] },
        positionSize: { type: "REL", value: 0.1 },
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 },
    };
}

function createMockSwapEvent(overrides: Partial<SwapEvent> = {}): SwapEvent {
    return {
        id: `swap-${Math.random().toString(36).slice(2)}`,
        timestamp: 1000,
        barIndex: 0,
        fromAsset: "USD",
        toAsset: "BTC",
        fromAmount: 1000,
        toAmount: 0.025,
        price: 40000,
        feeUSD: 1,
        slippageUSD: 0.5,
        ...overrides,
    };
}

function createMockTradeEvent(overrides: Partial<TradeEvent> = {}): TradeEvent {
    const entrySwap = createMockSwapEvent({
        fromAsset: "USD",
        toAsset: "BTC",
        fromAmount: 1000,
        toAmount: 0.025,
        price: 40000,
        barIndex: 0,
        timestamp: 1000,
    });

    const exitSwap = createMockSwapEvent({
        fromAsset: "BTC",
        toAsset: "USD",
        fromAmount: 0.025,
        toAmount: 1050,
        price: 42000,
        barIndex: 10,
        timestamp: 1600,
    });

    return {
        tradeId: 1,
        direction: "LONG" as Direction,
        entrySwap,
        exitSwap,
        pnlUSD: 50,
        pnlPct: 0.05,
        durationBars: 10,
        durationSeconds: 600,
        ...overrides,
    };
}

function createMockAlgoEvent(overrides: Partial<AlgoEvent> = {}): AlgoEvent {
    return {
        timestamp: 1000,
        barIndex: 0,
        type: "INDICATOR_FLIP",
        indicatorKey: "test-indicator",
        previousValue: false,
        newValue: true,
        conditionSnapshot: {
            requiredTrue: 1,
            requiredTotal: 2,
            optionalTrue: 0,
            optionalTotal: 1,
            conditionMet: false,
            distanceFromTrigger: 1,
        },
        ...overrides,
    } as AlgoEvent;
}

function createMockEquityPoint(overrides: Partial<EquityPoint> = {}): EquityPoint {
    return {
        time: 1000,
        timestamp: 1000,
        barIndex: 0,
        equity: 10000,
        drawdownPct: 0,
        runupPct: 0,
        ...overrides,
    };
}

function createMockSimulationResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
    return {
        trades: [],
        swapEvents: [],
        algoEvents: [],
        equityCurve: [createMockEquityPoint()],
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
    };
}

function createMockBacktestInput(): BacktestInput {
    const now = Math.floor(Date.now() / 1000);
    return {
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
    };
}

function createMockBacktestOutput(overrides: Partial<BacktestOutput> = {}): BacktestOutput {
    return {
        config: {
            algoId: "test-algo",
            version: 1,
            symbol: "BTC",
            startTime: 1000,
            endTime: 2000,
            startingCapitalUSD: 10000,
            feeBps: 10,
            slippageBps: 5,
        },
        events: {
            swapEvents: [],
            algoEvents: [],
        },
        trades: [],
        equityCurve: [],
        swapMetrics: createEmptySwapMetrics(),
        algoMetrics: createEmptyAlgoMetrics(),
        completedAt: Math.floor(Date.now() / 1000),
        durationMs: 100,
        totalBarsProcessed: 0,
        ...overrides,
    };
}

// =============================================================================
// EXECUTE OUTPUT GENERATION TESTS
// =============================================================================

describe("executeOutputGeneration", () => {
    it("returns valid BacktestOutput structure", () => {
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult(),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 100,
            startTimeMs: Date.now() - 1000,
        };

        const output = executeOutputGeneration(input);

        expect(output).toHaveProperty("config");
        expect(output).toHaveProperty("events");
        expect(output).toHaveProperty("trades");
        expect(output).toHaveProperty("equityCurve");
        expect(output).toHaveProperty("swapMetrics");
        expect(output).toHaveProperty("algoMetrics");
        expect(output).toHaveProperty("completedAt");
        expect(output).toHaveProperty("durationMs");
        expect(output).toHaveProperty("totalBarsProcessed");
    });

    it("extracts config from data result", () => {
        const dataResult = createMockDataLoadingResult();
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult(),
            dataResult,
            totalBarsProcessed: 100,
            startTimeMs: Date.now(),
        };

        const output = executeOutputGeneration(input);

        expect(output.config.algoId).toBe("test-algo");
        expect(output.config.version).toBe(1);
        expect(output.config.symbol).toBe("BTC");
    });

    it("includes trades from simulation result", () => {
        const trades = [createMockTradeEvent({ tradeId: 1 }), createMockTradeEvent({ tradeId: 2 })];
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult({ trades }),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 100,
            startTimeMs: Date.now(),
        };

        const output = executeOutputGeneration(input);

        expect(output.trades.length).toBe(2);
    });

    it("includes swap events from simulation result", () => {
        const swapEvents = [createMockSwapEvent(), createMockSwapEvent()];
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult({ swapEvents }),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 100,
            startTimeMs: Date.now(),
        };

        const output = executeOutputGeneration(input);

        expect(output.events.swapEvents.length).toBe(2);
    });

    it("includes algo events from simulation result", () => {
        const algoEvents = [createMockAlgoEvent()];
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult({ algoEvents }),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 100,
            startTimeMs: Date.now(),
        };

        const output = executeOutputGeneration(input);

        expect(output.events.algoEvents.length).toBe(1);
    });

    it("transforms equity curve", () => {
        const equityCurve = [
            createMockEquityPoint({ equity: 10000, drawdownPct: 0 }),
            createMockEquityPoint({ equity: 10500, drawdownPct: 0 }),
            createMockEquityPoint({ equity: 10200, drawdownPct: 0.0286 }),
        ];
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult({ equityCurve }),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 100,
            startTimeMs: Date.now(),
        };

        const output = executeOutputGeneration(input);

        expect(output.equityCurve.length).toBe(3);
        expect(output.equityCurve[0]).toHaveProperty("timestamp");
        expect(output.equityCurve[0]).toHaveProperty("equity");
        expect(output.equityCurve[0]).toHaveProperty("drawdownPct");
    });

    it("calculates duration from start time", () => {
        const startTimeMs = Date.now() - 500;
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult(),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 100,
            startTimeMs,
        };

        const output = executeOutputGeneration(input);

        expect(output.durationMs).toBeGreaterThanOrEqual(500);
    });

    it("records total bars processed", () => {
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult(),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 250,
            startTimeMs: Date.now(),
        };

        const output = executeOutputGeneration(input);

        expect(output.totalBarsProcessed).toBe(250);
    });

    it("sets completedAt timestamp", () => {
        const input: OutputGenerationInput = {
            simulationResult: createMockSimulationResult(),
            dataResult: createMockDataLoadingResult(),
            totalBarsProcessed: 100,
            startTimeMs: Date.now(),
        };

        const output = executeOutputGeneration(input);

        expect(output.completedAt).toBeGreaterThan(0);
        expect(typeof output.completedAt).toBe("number");
    });
});

// =============================================================================
// CALCULATE METRICS TESTS
// =============================================================================

describe("calculateMetrics", () => {
    it("returns swap and algo metrics", () => {
        const metrics = calculateMetrics([], [], [], 100);

        expect(metrics).toHaveProperty("swapMetrics");
        expect(metrics).toHaveProperty("algoMetrics");
    });

    it("handles empty trades array", () => {
        const metrics = calculateMetrics([], [], [], 100);

        expect(metrics.swapMetrics.totalTrades).toBe(0);
        expect(metrics.swapMetrics.winRate).toBe(0);
    });

    it("handles empty algo events array", () => {
        const metrics = calculateMetrics([], [], [], 100);

        expect(metrics.algoMetrics.eventCounts.indicatorFlips).toBe(0);
        expect(metrics.algoMetrics.eventCounts.stateTransitions).toBe(0);
    });

    it("calculates swap metrics from trades", () => {
        const trades = [createMockTradeEvent({ pnlUSD: 100 }), createMockTradeEvent({ pnlUSD: -50 })];
        const equityCurve = [createMockEquityPoint()];

        const metrics = calculateMetrics(trades, [], equityCurve, 100);

        expect(metrics.swapMetrics.totalTrades).toBe(2);
    });
});

// =============================================================================
// CREATE EMPTY BACKTEST OUTPUT TESTS
// =============================================================================

describe("createEmptyBacktestOutput", () => {
    it("returns valid structure", () => {
        const input = createMockBacktestInput();
        const output = createEmptyBacktestOutput(input, Date.now());

        expect(output).toHaveProperty("config");
        expect(output).toHaveProperty("events");
        expect(output).toHaveProperty("trades");
        expect(output).toHaveProperty("equityCurve");
        expect(output).toHaveProperty("swapMetrics");
        expect(output).toHaveProperty("algoMetrics");
    });

    it("has empty trades array", () => {
        const input = createMockBacktestInput();
        const output = createEmptyBacktestOutput(input, Date.now());

        expect(output.trades).toEqual([]);
    });

    it("has empty events", () => {
        const input = createMockBacktestInput();
        const output = createEmptyBacktestOutput(input, Date.now());

        expect(output.events.swapEvents).toEqual([]);
        expect(output.events.algoEvents).toEqual([]);
    });

    it("has empty equity curve", () => {
        const input = createMockBacktestInput();
        const output = createEmptyBacktestOutput(input, Date.now());

        expect(output.equityCurve).toEqual([]);
    });

    it("has zero bars processed", () => {
        const input = createMockBacktestInput();
        const output = createEmptyBacktestOutput(input, Date.now());

        expect(output.totalBarsProcessed).toBe(0);
    });

    it("calculates initial capital with scaler", () => {
        const input = createMockBacktestInput();
        input.algoConfig.params.startingCapitalUSD = 10000;
        input.runSettings.capitalScaler = 2;

        const output = createEmptyBacktestOutput(input, Date.now());

        expect(output.config.startingCapitalUSD).toBe(20000);
    });

    it("uses config from input", () => {
        const input = createMockBacktestInput();
        input.algoConfig.algoID = "my-algo";
        input.algoConfig.version = 5;
        input.runSettings.coinSymbol = "ETH";

        const output = createEmptyBacktestOutput(input, Date.now());

        expect(output.config.algoId).toBe("my-algo");
        expect(output.config.version).toBe(5);
        expect(output.config.symbol).toBe("ETH");
    });
});

// =============================================================================
// CREATE EMPTY SWAP METRICS TESTS
// =============================================================================

describe("createEmptySwapMetrics", () => {
    it("returns all zero values", () => {
        const metrics = createEmptySwapMetrics();

        expect(metrics.totalTrades).toBe(0);
        expect(metrics.winningTrades).toBe(0);
        expect(metrics.losingTrades).toBe(0);
        expect(metrics.winRate).toBe(0);
        expect(metrics.totalPnlUSD).toBe(0);
        expect(metrics.profitFactor).toBe(0);
    });

    it("includes all required fields", () => {
        const metrics = createEmptySwapMetrics();

        expect(metrics).toHaveProperty("totalTrades");
        expect(metrics).toHaveProperty("winningTrades");
        expect(metrics).toHaveProperty("losingTrades");
        expect(metrics).toHaveProperty("winRate");
        expect(metrics).toHaveProperty("totalPnlUSD");
        expect(metrics).toHaveProperty("grossProfitUSD");
        expect(metrics).toHaveProperty("grossLossUSD");
        expect(metrics).toHaveProperty("avgPnlUSD");
        expect(metrics).toHaveProperty("sharpeRatio");
        expect(metrics).toHaveProperty("sortinoRatio");
        expect(metrics).toHaveProperty("maxDrawdownPct");
        expect(metrics).toHaveProperty("calmarRatio");
        expect(metrics).toHaveProperty("profitFactor");
    });
});

// =============================================================================
// CREATE EMPTY ALGO METRICS TESTS
// =============================================================================

describe("createEmptyAlgoMetrics", () => {
    it("returns empty arrays for analysis", () => {
        const metrics = createEmptyAlgoMetrics();

        expect(metrics.indicatorAnalysis).toEqual([]);
        expect(metrics.nearMissAnalysis).toEqual([]);
    });

    it("returns default state distribution", () => {
        const metrics = createEmptyAlgoMetrics();

        expect(metrics.stateDistribution.pctTimeFlat).toBe(1);
        expect(metrics.stateDistribution.pctTimeLong).toBe(0);
        expect(metrics.stateDistribution.pctTimeShort).toBe(0);
    });

    it("returns zero exit reason counts", () => {
        const metrics = createEmptyAlgoMetrics();

        expect(metrics.exitReasonBreakdown.signal).toBe(0);
        expect(metrics.exitReasonBreakdown.stopLoss).toBe(0);
        expect(metrics.exitReasonBreakdown.takeProfit).toBe(0);
        expect(metrics.exitReasonBreakdown.trailingStop).toBe(0);
        expect(metrics.exitReasonBreakdown.endOfBacktest).toBe(0);
    });

    it("returns zero condition trigger counts", () => {
        const metrics = createEmptyAlgoMetrics();

        expect(metrics.conditionTriggerCounts.LONG_ENTRY).toBe(0);
        expect(metrics.conditionTriggerCounts.LONG_EXIT).toBe(0);
        expect(metrics.conditionTriggerCounts.SHORT_ENTRY).toBe(0);
        expect(metrics.conditionTriggerCounts.SHORT_EXIT).toBe(0);
    });

    it("returns zero event counts", () => {
        const metrics = createEmptyAlgoMetrics();

        expect(metrics.eventCounts.indicatorFlips).toBe(0);
        expect(metrics.eventCounts.conditionChanges).toBe(0);
        expect(metrics.eventCounts.stateTransitions).toBe(0);
        expect(metrics.eventCounts.specialIndicatorEvents).toBe(0);
    });
});

// =============================================================================
// VALIDATE BACKTEST OUTPUT TESTS
// =============================================================================

describe("validateBacktestOutput", () => {
    it("validates correct output", () => {
        const output = createMockBacktestOutput();
        const validation = validateBacktestOutput(output);

        expect(validation.isValid).toBe(true);
        expect(validation.issues).toEqual([]);
    });

    it("detects missing algoId", () => {
        const output = createMockBacktestOutput();
        output.config.algoId = "";

        const validation = validateBacktestOutput(output);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("algoId"))).toBe(true);
    });

    it("detects missing symbol", () => {
        const output = createMockBacktestOutput();
        output.config.symbol = "";

        const validation = validateBacktestOutput(output);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("symbol"))).toBe(true);
    });

    it("detects trade count mismatch", () => {
        const output = createMockBacktestOutput({
            trades: [createMockTradeEvent()],
            swapMetrics: { ...createEmptySwapMetrics(), totalTrades: 5 },
        });

        const validation = validateBacktestOutput(output);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("mismatch"))).toBe(true);
    });

    it("detects trades without equity curve", () => {
        const output = createMockBacktestOutput({
            trades: [createMockTradeEvent()],
            swapMetrics: { ...createEmptySwapMetrics(), totalTrades: 1 },
            equityCurve: [],
        });

        const validation = validateBacktestOutput(output);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("equity curve"))).toBe(true);
    });

    it("detects startTime > endTime", () => {
        const output = createMockBacktestOutput();
        output.config.startTime = 2000;
        output.config.endTime = 1000;

        const validation = validateBacktestOutput(output);

        expect(validation.isValid).toBe(false);
        expect(validation.issues.some((i) => i.includes("startTime"))).toBe(true);
    });

    it("returns summary statistics", () => {
        const output = createMockBacktestOutput();
        const validation = validateBacktestOutput(output);

        expect(validation.summary).toHaveProperty("totalTrades");
        expect(validation.summary).toHaveProperty("totalPnlUSD");
        expect(validation.summary).toHaveProperty("winRate");
        expect(validation.summary).toHaveProperty("maxDrawdownPct");
        expect(validation.summary).toHaveProperty("durationMs");
    });
});

// =============================================================================
// FORMAT OUTPUT SUMMARY TESTS
// =============================================================================

describe("formatOutputSummary", () => {
    it("returns formatted string", () => {
        const output = createMockBacktestOutput();
        const summary = formatOutputSummary(output);

        expect(typeof summary).toBe("string");
        expect(summary.length).toBeGreaterThan(0);
    });

    it("includes symbol", () => {
        const output = createMockBacktestOutput();
        output.config.symbol = "ETH";

        const summary = formatOutputSummary(output);

        expect(summary).toContain("ETH");
    });

    it("includes total trades", () => {
        const output = createMockBacktestOutput({
            swapMetrics: { ...createEmptySwapMetrics(), totalTrades: 42 },
        });

        const summary = formatOutputSummary(output);

        expect(summary).toContain("42");
    });

    it("includes performance metrics", () => {
        const output = createMockBacktestOutput();
        const summary = formatOutputSummary(output);

        expect(summary).toContain("Win Rate");
        expect(summary).toContain("P&L");
        expect(summary).toContain("Drawdown");
        expect(summary).toContain("Sharpe");
    });

    it("includes algo metrics", () => {
        const output = createMockBacktestOutput();
        const summary = formatOutputSummary(output);

        expect(summary).toContain("Indicator Flips");
        expect(summary).toContain("State Transitions");
        expect(summary).toContain("Time Flat");
    });

    it("includes duration", () => {
        const output = createMockBacktestOutput({
            durationMs: 1234,
        });

        const summary = formatOutputSummary(output);

        expect(summary).toContain("1234");
    });

    it("includes bars processed", () => {
        const output = createMockBacktestOutput({
            totalBarsProcessed: 500,
        });

        const summary = formatOutputSummary(output);

        expect(summary).toContain("500");
    });
});
