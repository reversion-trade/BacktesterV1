/** Pipeline Stages - Modular backtester with 7 stages: DataLoading → MipMap → SubBar → ValueFactor → Indicators → Resampling → Init → Simulation → Output */

import type { Candle } from "../../core/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import type { BacktestOutput } from "../../events/types.ts";
import type { SimulationResult, EquityPoint } from "../../output/types.ts";
import { executeDataLoading } from "./data-loading.ts";
import { executeMipMapBuilding, createMipMapInputFromDataResult } from "./mipmap-building.ts";
import { executeSubBarLoading } from "./subbar-loading.ts";
import { executeValueFactorLoading, createStopLossFactorLookup, createTakeProfitFactorLookup } from "./valuefactor-loading.ts";
import { executeIndicatorCalculationWithMipMap } from "./indicator-calculation.ts";
import { executeResampling, createResamplingInput } from "./resampling.ts";
import { executeInitialization } from "./initialization.ts";
import { executeOutputGeneration, createEmptyBacktestOutput } from "./output.ts";
import { getWarmupSeconds, collectIndicatorConfigs } from "../../indicators/calculator.ts";
import { FakeSubBarProvider } from "../fakes/fake-subbar-provider.ts";
import { mergeIntoHeap, extractSimulationEvents, runEventDrivenSimulation, type EventSimulatorConfig } from "../event-driven/index.ts";

// Stage 1: Data Loading
export { executeDataLoading, filterCandlesToRange, type DataLoadingResult } from "./data-loading.ts";

// Stage 1.1: MipMap Building
export { executeMipMapBuilding, createMipMapInputFromDataResult, detectCandleResolution, type MipMapBuildingResult, type MipMapBuildingInput } from "./mipmap-building.ts";
export { lookupResolution, getAvailableResolutions } from "../mipmap/index.ts";                   // Re-export for convenience

// Stage 1.5: SubBar Loading
export { executeSubBarLoading, getSubBarsForParent, getExpectedSubBarCount, hasSubBarsForParent, type SubBarLoadingResult, type SubBarLoadingInput } from "./subbar-loading.ts";

// Stage 1.6: ValueFactor Loading
export { executeValueFactorLoading, extractValueFactorConfigs, flattenSubBarCandles, createStopLossFactorLookup, createTakeProfitFactorLookup, type ValueFactorLoadingResult, type ValueFactorLoadingInput, type ValueFactorConfig } from "./valuefactor-loading.ts";

// Stage 2: Indicator Calculation
export { executeIndicatorCalculation, executeIndicatorCalculationWithMipMap, createIndicatorInputFromDataResult, type IndicatorCalculationResult, type IndicatorCalculationInput, type IndicatorCalculationWithMipMapInput } from "./indicator-calculation.ts";

// Stage 3: Resampling
export { executeResampling, createResamplingInput, type ResamplingResult, type ResamplingInput, type ResamplingStats, type ResampledSignalCache } from "./resampling.ts";

// Stage 4: Initialization
export { executeInitialization, buildIndicatorInfoMap, type InitializationResult, type InitializationInput } from "./initialization.ts";

// Stage 5: Simulation Types
export type { SimulationResult, EquityPoint } from "../../output/types.ts";

// Stage 6: Output Generation
export { executeOutputGeneration, calculateMetrics, createEmptyBacktestOutput, createEmptySwapMetrics, createEmptyAlgoMetrics, type OutputGenerationInput, type CalculatedMetrics } from "./output.ts";

/** Run complete backtest pipeline with event-driven simulation (~400x fewer iterations than bar-by-bar). */
export function runBacktestPipeline(candles: Candle[], input: BacktestInput): BacktestOutput {
    const startTimeMs = Date.now();

    const indicatorConfigs = collectIndicatorConfigs(input.algoConfig.params);    // Pre-stage: Calculate warmup
    const warmupSeconds = getWarmupSeconds(indicatorConfigs);

    const dataResult = executeDataLoading(candles, input, warmupSeconds);         // Stage 1: Data Loading (with pre-warming)
    if (dataResult.isEmpty) return createEmptyBacktestOutput(dataResult.validatedInput, startTimeMs);

    const subBarProvider = new FakeSubBarProvider();                              // Stage 1.5: SubBar Loading
    subBarProvider.preloadParentCandles(dataResult.filteredCandles);
    const parentTimeframe = detectParentTimeframe(input) ?? "5m";
    const subBarResult = executeSubBarLoading({ filteredCandles: dataResult.filteredCandles, symbol: input.runSettings.coinSymbol, parentTimeframe, subBarProvider });

    const valueFactorResult = executeValueFactorLoading({ algoParams: input.algoConfig.params, subBarResult, parentTimeframe }); // Stage 1.6: ValueFactor
    const slValueFactorLookup = createStopLossFactorLookup(valueFactorResult);
    const tpValueFactorLookup = createTakeProfitFactorLookup(valueFactorResult);

    const mipMapInput = createMipMapInputFromDataResult(dataResult);              // Stage 1.1: MipMap Building
    const mipMapResult = executeMipMapBuilding(mipMapInput);

    const indicatorResult = executeIndicatorCalculationWithMipMap({ mipMapResult, algoParams: input.algoConfig.params }); // Stage 2: Indicators

    const resamplingInput = createResamplingInput(dataResult.filteredCandles, indicatorResult); // Stage 3: Resampling
    const resamplingResult = executeResampling(resamplingInput);

    const initResult = executeInitialization({ dataResult, resamplingResult });   // Stage 4: Initialization

    const timestamps = dataResult.filteredCandles.map((c) => c.bucket);           // Stage 4.5: Event Extraction
    const signalCacheMap = new Map<string, boolean[]>();
    for (const key of resamplingResult.resampledSignals.keys()) {
        const signals = resamplingResult.resampledSignals.get(key);
        if (signals) signalCacheMap.set(key, signals);
    }

    const indicatorInfoMapForExtraction = new Map<string, { indicatorKey: string; indicatorType: string; conditionType: import("../../events/types.ts").ConditionType; isRequired: boolean }>();
    for (const [key, info] of initResult.indicatorInfoMap) {
        indicatorInfoMapForExtraction.set(key, { indicatorKey: info.indicatorKey, indicatorType: info.indicatorType, conditionType: info.conditionType, isRequired: info.isRequired });
    }

    const tradingStartBar = dataResult.tradingStartIndex;                         // Skip pre-warming bars
    const extractionResult = extractSimulationEvents(signalCacheMap, indicatorInfoMapForExtraction, timestamps, tradingStartBar);
    const heap = mergeIntoHeap(extractionResult.signalCrossingEvents, extractionResult.conditionMetEvents, extractionResult.conditionUnmetEvents);

    const simulatorConfig: EventSimulatorConfig = {                               // Stage 5: Event-Driven Simulation
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

    const equityCurve: EquityPoint[] = eventSimResult.equityCurve.map((ep) => ({  // Convert to output format
        time: ep.timestamp, timestamp: ep.timestamp, barIndex: ep.barIndex, equity: ep.equity, drawdownPct: ep.drawdownPct, runupPct: 0,
    }));

    const simResult: SimulationResult = { algoEvents: [], swapEvents: eventSimResult.swapEvents, trades: eventSimResult.trades, equityCurve };

    const tradingBarsCount = dataResult.filteredCandles.length - dataResult.tradingStartIndex; // Stage 6: Output
    return executeOutputGeneration({ simulationResult: simResult, dataResult, totalBarsProcessed: tradingBarsCount, startTimeMs });
}

/** Detect parent timeframe from first indicator config with timeframe param. */
function detectParentTimeframe(input: BacktestInput): string | null {
    const conditions = [input.algoConfig.params.longEntry, input.algoConfig.params.longExit, input.algoConfig.params.shortEntry, input.algoConfig.params.shortExit];
    for (const condition of conditions) {
        if (!condition) continue;
        for (const indicator of [...condition.required, ...condition.optional]) {
            const params = indicator.params as Record<string, unknown>;
            if (params && typeof params["timeframe"] === "string") return params["timeframe"];
        }
    }
    return null;
}
