/**
 * Backtester Pipeline Stages
 *
 * @module simulation/stages
 * @description
 * This module exports all stages of the modular backtester pipeline.
 *
 * @architecture
 * The backtester is organized into 7 explicit stages:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 1: Data Loading                                          │
 * │  ─────────────────────                                          │
 * │  Validate config, filter candles to time range                  │
 * │  Output: DataLoadingResult                                      │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 1.5: Sub-Bar Loading                                     │
 * │  ──────────────────────────                                     │
 * │  Fetch lower-timeframe candles for granular SL/TP simulation    │
 * │  Output: SubBarLoadingResult                                    │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 1.6: ValueFactor Pre-Calculation                         │
 * │  ────────────────────────────────────                           │
 * │  Calculate DYN SL/TP indicators at sub-bar granularity          │
 * │  Output: ValueFactorLoadingResult (lookup functions)            │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 2: Indicator Pre-Calculation                             │
 * │  ──────────────────────────────────                             │
 * │  Calculate all indicator signals over entire dataset            │
 * │  Output: IndicatorCalculationResult                             │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 3: Resampling (CRITICAL)                                 │
 * │  ─────────────────────────────────                              │
 * │  Align signals to simulation timeframe with forward-fill        │
 * │  Output: ResamplingResult                                       │
 * │  NOTE: Must be separate from simulation stage                   │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 4: Algo State Initialization                             │
 * │  ──────────────────────────────────                             │
 * │  Initialize EventCollector, set initial state                   │
 * │  Output: InitializationResult                                   │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 5: Simulation Loop (with Sub-Bar SL/TP)                  │
 * │  ─────────────────────────────────────────────                  │
 * │  Forward pass through candles, granular SL/TP checking          │
 * │  Output: SimulationResult                                        │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 6: Output Generation                                     │
 * │  ──────────────────────────                                     │
 * │  Calculate metrics with sub-bar equity data                     │
 * │  Output: BacktestOutput                                         │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Updated: 2026-01-01 (Audit Fix - Stage 3 wiring)
 * - Purpose: Central export point for all pipeline stages
 * - Follows architecture principle: "Stages should be separate and explicit"
 * - CRITICAL FIX: Pipeline now correctly passes resampledSignals to Stage 5
 *
 * @usage
 * ```typescript
 * import {
 *   executeDataLoading,
 *   executeIndicatorCalculation,
 *   executeResampling,
 *   executeInitialization,
 *   executeOutputGeneration,
 * } from "./simulation/stages";
 *
 * // Or use the orchestrator:
 * import { runBacktestPipeline } from "./simulation/stages";
 * const output = runBacktestPipeline(candles, input);
 * ```
 */

// =============================================================================
// STAGE 1: DATA LOADING
// =============================================================================
export {
    executeDataLoading,
    filterCandlesToRange,
    type DataLoadingResult,
} from "./data-loading.ts";

// =============================================================================
// STAGE 1.1: MIP-MAP BUILDING (Multi-Resolution Candle Aggregation)
// =============================================================================
export {
    executeMipMapBuilding,
    createMipMapInputFromDataResult,
    detectCandleResolution,
    type MipMapBuildingResult,
    type MipMapBuildingInput,
} from "./mipmap-building.ts";

// =============================================================================
// STAGE 1.5: SUB-BAR LOADING (Granular SL/TP Simulation)
// =============================================================================
export {
    executeSubBarLoading,
    getSubBarsForParent,
    getExpectedSubBarCount,
    hasSubBarsForParent,
    type SubBarLoadingResult,
    type SubBarLoadingInput,
} from "./subbar-loading.ts";

// =============================================================================
// STAGE 1.6: VALUEFACTOR LOADING (Dynamic SL/TP Indicators)
// =============================================================================
export {
    executeValueFactorLoading,
    extractValueFactorConfigs,
    flattenSubBarCandles,
    createStopLossFactorLookup,
    createTakeProfitFactorLookup,
    type ValueFactorLoadingResult,
    type ValueFactorLoadingInput,
    type ValueFactorConfig,
} from "./valuefactor-loading.ts";

// =============================================================================
// STAGE 2: INDICATOR PRE-CALCULATION
// =============================================================================
export {
    executeIndicatorCalculation,
    executeIndicatorCalculationWithMipMap,
    createIndicatorInputFromDataResult,
    type IndicatorCalculationResult,
    type IndicatorCalculationInput,
    type IndicatorCalculationWithMipMapInput,
} from "./indicator-calculation.ts";

// =============================================================================
// STAGE 3: RESAMPLING (CRITICAL)
// =============================================================================
export {
    executeResampling,
    createResamplingInput,
    type ResamplingResult,
    type ResamplingInput,
    type ResamplingStats,
    type ResampledSignalCache,
} from "./resampling.ts";

// =============================================================================
// STAGE 4: INITIALIZATION
// =============================================================================
export {
    executeInitialization,
    buildIndicatorInfoMap,
    type InitializationResult,
    type InitializationInput,
} from "./initialization.ts";

// =============================================================================
// STAGE 5: SIMULATION TYPES
// =============================================================================
export type { SimulationResult, EquityPoint } from "../../output/types.ts";

// =============================================================================
// STAGE 6: OUTPUT GENERATION
// =============================================================================
export {
    executeOutputGeneration,
    calculateMetrics,
    createEmptyBacktestOutput,
    createEmptySwapMetrics,
    createEmptyAlgoMetrics,
    type OutputGenerationInput,
    type CalculatedMetrics,
} from "./output.ts";

// =============================================================================
// PIPELINE ORCHESTRATOR
// =============================================================================

import type { Candle } from "../../core/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import type { BacktestOutput } from "../../events/types.ts";

import { executeDataLoading } from "./data-loading.ts";
import { executeMipMapBuilding, createMipMapInputFromDataResult } from "./mipmap-building.ts";
import { executeSubBarLoading } from "./subbar-loading.ts";
import {
    executeValueFactorLoading,
    createStopLossFactorLookup,
    createTakeProfitFactorLookup,
} from "./valuefactor-loading.ts";
import { executeIndicatorCalculationWithMipMap } from "./indicator-calculation.ts";
import { executeResampling, createResamplingInput } from "./resampling.ts";
import { executeInitialization } from "./initialization.ts";
import { executeOutputGeneration, createEmptyBacktestOutput } from "./output.ts";
import { type SimulationResult, type EquityPoint } from "../../output/types.ts";

// Import for pre-warming calculation
import { getWarmupSeconds, collectIndicatorConfigs } from "../../indicators/calculator.ts";

// Sub-bar provider for synthetic sub-bar generation
import { FakeSubBarProvider } from "../fakes/fake-subbar-provider.ts";

// Event-driven simulation imports
import {
    mergeIntoHeap,
    extractSimulationEvents,
    runEventDrivenSimulation,
    type EventSimulatorConfig,
} from "../event-driven/index.ts";

/**
 * Run the complete backtest pipeline using Event-Driven Simulation.
 *
 * This function uses heap-based event processing for high performance:
 * - ~400x fewer iterations (processes ~1,000 events vs ~400,000 bars)
 * - Pre-calculates signal crossing times from boolean arrays
 * - Uses priority heap sorted by timestamp for O(log n) event processing
 * - Unified state machine with centralized switch statement
 *
 * @architecture
 * Stage 1: Data Loading - validate config, filter candles to time range
 * Stage 1.1: MIP-Map Building - multi-resolution candle aggregation
 * Stage 1.5: Sub-Bar Loading - fetch lower-timeframe candles for SL/TP
 * Stage 1.6: ValueFactor Pre-Calculation - dynamic SL/TP indicators
 * Stage 2: Indicator Pre-Calculation - calculate all indicators
 * Stage 3: Resampling - align signals to simulation timeframe
 * Stage 4: Initialization - set up state and event extraction
 * Stage 5: Event-Driven Simulation - heap-based state machine
 * Stage 6: Output Generation - calculate metrics
 *
 * @param candles - Historical price data
 * @param input - Backtest input configuration
 * @returns Complete BacktestOutput
 *
 * @example
 * ```typescript
 * const output = runBacktestPipeline(candles, input);
 * console.log(`Total P&L: $${output.swapMetrics.totalPnlUSD}`);
 * ```
 *
 * @audit-trail
 * - Created: 2026-01-09 (Event-Driven Simulation Implementation)
 * - Updated: 2026-01-09 (Bar-by-bar removal - now the only pipeline)
 */
export function runBacktestPipeline(candles: Candle[], input: BacktestInput): BacktestOutput {
    const startTimeMs = Date.now();

    // =========================================================================
    // PRE-STAGE: CALCULATE WARMUP FOR PRE-WARMING
    // =========================================================================
    // Calculate how many seconds of data we need before the start time
    // so indicators are fully warmed up when trading begins.
    const indicatorConfigs = collectIndicatorConfigs(input.algoConfig.params);
    const warmupSeconds = getWarmupSeconds(indicatorConfigs);

    // =========================================================================
    // STAGE 1: DATA LOADING (WITH PRE-WARMING)
    // =========================================================================
    // Pass warmupSeconds to load extra bars before startTime for indicator warmup.
    // dataResult.tradingStartIndex tells us where actual trading should begin.
    const dataResult = executeDataLoading(candles, input, warmupSeconds);

    // Early exit if no data
    if (dataResult.isEmpty) {
        return createEmptyBacktestOutput(dataResult.validatedInput, startTimeMs);
    }

    // =========================================================================
    // STAGE 1.5: SUB-BAR LOADING
    // =========================================================================
    const subBarProvider = new FakeSubBarProvider();
    subBarProvider.preloadParentCandles(dataResult.filteredCandles);

    const parentTimeframe = detectParentTimeframe(input) ?? "5m";

    const subBarResult = executeSubBarLoading({
        filteredCandles: dataResult.filteredCandles,
        symbol: input.runSettings.coinSymbol,
        parentTimeframe,
        subBarProvider,
    });

    // =========================================================================
    // STAGE 1.6: VALUEFACTOR PRE-CALCULATION
    // =========================================================================
    const valueFactorResult = executeValueFactorLoading({
        algoParams: input.algoConfig.params,
        subBarResult,
        parentTimeframe,
    });

    const slValueFactorLookup = createStopLossFactorLookup(valueFactorResult);
    const tpValueFactorLookup = createTakeProfitFactorLookup(valueFactorResult);

    // =========================================================================
    // STAGE 1.1: MIP-MAP BUILDING
    // =========================================================================
    const mipMapInput = createMipMapInputFromDataResult(dataResult);
    const mipMapResult = executeMipMapBuilding(mipMapInput);

    // =========================================================================
    // STAGE 2: INDICATOR PRE-CALCULATION
    // =========================================================================
    const indicatorResult = executeIndicatorCalculationWithMipMap({
        mipMapResult,
        algoParams: input.algoConfig.params,
    });

    // =========================================================================
    // STAGE 3: RESAMPLING
    // =========================================================================
    const resamplingInput = createResamplingInput(dataResult.filteredCandles, indicatorResult);
    const resamplingResult = executeResampling(resamplingInput);

    // =========================================================================
    // STAGE 4: INITIALIZATION
    // =========================================================================
    const initResult = executeInitialization({
        dataResult,
        resamplingResult,
    });

    // =========================================================================
    // STAGE 4.5: EVENT EXTRACTION (NEW - Event-Driven)
    // =========================================================================
    // Extract timestamps from candles
    const timestamps = dataResult.filteredCandles.map((c) => c.bucket);

    // Convert resampled signals to signal cache
    const signalCacheMap = new Map<string, boolean[]>();
    for (const key of resamplingResult.resampledSignals.keys()) {
        const signals = resamplingResult.resampledSignals.get(key);
        if (signals) {
            signalCacheMap.set(key, signals);
        }
    }

    // Convert IndicatorInfo format for event extraction
    const indicatorInfoMapForExtraction = new Map<
        string,
        {
            indicatorKey: string;
            indicatorType: string;
            conditionType: import("../../events/types.ts").ConditionType;
            isRequired: boolean;
        }
    >();
    for (const [key, info] of initResult.indicatorInfoMap) {
        indicatorInfoMapForExtraction.set(key, {
            indicatorKey: info.indicatorKey,
            indicatorType: info.indicatorType,
            conditionType: info.conditionType,
            isRequired: info.isRequired,
        });
    }

    // Calculate where trading should start in simulation bar space.
    // With pre-warming: tradingStartIndex marks where the user's requested date range begins.
    // Before tradingStartIndex, bars are used only for indicator warmup.
    // The tradingStartBar should be based on tradingStartIndex, not warmupBars.
    const tradingStartBar = dataResult.tradingStartIndex;

    // Extract all simulation events from pre-calculated signals
    // Pass tradingStartBar to skip pre-warming bars and start trading at the user's requested date
    const extractionResult = extractSimulationEvents(
        signalCacheMap,
        indicatorInfoMapForExtraction,
        timestamps,
        tradingStartBar
    );

    // Build event heap by merging all event types
    const heap = mergeIntoHeap(
        extractionResult.signalCrossingEvents,
        extractionResult.conditionMetEvents,
        extractionResult.conditionUnmetEvents
    );

    // =========================================================================
    // STAGE 5: EVENT-DRIVEN SIMULATION
    // =========================================================================
    const simulatorConfig: EventSimulatorConfig = {
        algoParams: initResult.algoParams,
        initialCapital: initResult.initialCapital,
        symbol: initResult.symbol,
        feeBps: initResult.feeBps,
        slippageBps: initResult.slippageBps,
        closePositionOnExit: initResult.closePositionOnExit,
        barDurationSeconds: resamplingResult.simulationResolution,
        tradesLimit: initResult.tradesLimit,
        subBarCandlesMap: subBarResult.isSupported ? subBarResult.subBarCandlesMap : undefined,
        slValueFactorLookup: valueFactorResult.hasDynamicExits ? slValueFactorLookup : undefined,
        tpValueFactorLookup: valueFactorResult.hasDynamicExits ? tpValueFactorLookup : undefined,
    };

    const eventSimResult = runEventDrivenSimulation(heap, dataResult.filteredCandles, simulatorConfig);

    // Convert event-simulator EquityPoint to output EquityPoint format
    const equityCurve: EquityPoint[] = eventSimResult.equityCurve.map((ep) => ({
        time: ep.timestamp,
        timestamp: ep.timestamp,
        barIndex: ep.barIndex,
        equity: ep.equity,
        drawdownPct: ep.drawdownPct,
        runupPct: 0, // Event-driven simulator doesn't track runup yet
    }));

    // Build SimulationResult for Stage 6
    const simResult: SimulationResult = {
        algoEvents: [], // Event-driven doesn't generate AlgoEvents yet
        swapEvents: eventSimResult.swapEvents,
        trades: eventSimResult.trades,
        equityCurve,
    };

    // =========================================================================
    // STAGE 6: OUTPUT GENERATION
    // =========================================================================
    // Only count the trading period bars, not the pre-warming bars
    const tradingBarsCount = dataResult.filteredCandles.length - dataResult.tradingStartIndex;

    return executeOutputGeneration({
        simulationResult: simResult,
        dataResult,
        totalBarsProcessed: tradingBarsCount,
        startTimeMs,
    });
}

/**
 * Detect parent timeframe from backtest input.
 * Extracts from first indicator config or returns null if not found.
 */
function detectParentTimeframe(input: BacktestInput): string | null {
    const algoParams = input.algoConfig.params;

    // Check entry/exit conditions for timeframe
    const conditions = [
        algoParams.longEntry,
        algoParams.longExit,
        algoParams.shortEntry,
        algoParams.shortExit,
    ];

    for (const condition of conditions) {
        if (!condition) continue;
        for (const indicator of [...condition.required, ...condition.optional]) {
            // Check params for timeframe property
            const params = indicator.params as Record<string, unknown>;
            if (params && typeof params["timeframe"] === "string") {
                return params["timeframe"];
            }
        }
    }

    return null;
}
