/** Stage 4: Algo State Initialization - Initializes EventCollector, indicator metadata, and simulation context. */

import type { AlgoParams, Direction, PositionState, EntryCondition, ExitCondition } from "../../core/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import { makeIndicator } from "@indicators/factory.ts";
import { EventCollector, type IndicatorInfo } from "../../events/index.ts";
import type { ConditionType } from "../../events/types.ts";
import type { DataLoadingResult } from "./data-loading.ts";
import type { ResamplingResult } from "./resampling.ts";

export interface InitializationResult {
    collector: EventCollector;                                                    // EventCollector with registered indicators
    indicatorInfoMap: Map<string, IndicatorInfo>;                                 // Indicator keys → metadata
    initialState: PositionState;                                                  // Initial position state (always CASH)
    initialCapital: number;                                                       // Starting capital in USD
    closePositionOnExit: boolean;                                                 // Whether to close position at backtest end
    tradesLimit?: number;                                                         // Max trades allowed (optional)
    feeBps: number;                                                               // Fee in basis points
    slippageBps: number;                                                          // Slippage in basis points
    symbol: string;                                                               // Asset symbol being traded
    warmupBars: number;                                                           // Number of warmup bars to skip
    algoParams: AlgoParams;                                                       // Algo parameters for simulation
}

export interface InitializationInput {
    dataResult: DataLoadingResult;                                                // Result from Stage 1
    resamplingResult: ResamplingResult;                                           // Result from Stage 3 (for warmup info)
}

/** Execute Stage 4: Initialize algo state for simulation. */
export function executeInitialization(input: InitializationInput): InitializationResult {
    const { dataResult, resamplingResult } = input;
    const { validatedInput, initialCapital } = dataResult;
    const { algoConfig, runSettings, feeBps, slippageBps } = validatedInput;

    const indicatorInfoMap = buildIndicatorInfoMap(algoConfig.params);            // Build indicator info map
    const collector = new EventCollector(runSettings.coinSymbol);                 // Initialize EventCollector
    collector.registerIndicators(Array.from(indicatorInfoMap.values()));

    return {
        collector,
        indicatorInfoMap,
        initialState: "CASH",                                                     // Always start CASH; TIMEOUT handles re-entry
        initialCapital,
        closePositionOnExit: runSettings.closePositionOnExit ?? true,
        tradesLimit: runSettings.tradesLimit,
        feeBps,
        slippageBps,
        symbol: runSettings.coinSymbol,
        warmupBars: resamplingResult.warmupBars,
        algoParams: algoConfig.params,
    };
}

/** Build indicator info map from algo parameters. Maps each indicator's cache key to its metadata. */
export function buildIndicatorInfoMap(algoParams: AlgoParams): Map<string, IndicatorInfo> {
    const infoMap = new Map<string, IndicatorInfo>();

    const processCondition = (condition: EntryCondition | ExitCondition | undefined, conditionType: ConditionType) => {
        if (!condition) return;

        for (const config of condition.required) {
            const indicator = makeIndicator(config);
            const indicatorKey = indicator.getCacheKey();
            const mapKey = `${conditionType}:${indicatorKey}`;                    // Composite key allows same indicator in multiple conditions
            infoMap.set(mapKey, { indicatorKey, indicatorType: config.type, conditionType, isRequired: true });
        }

        for (const config of condition.optional) {
            const indicator = makeIndicator(config);
            const indicatorKey = indicator.getCacheKey();
            const mapKey = `${conditionType}:${indicatorKey}`;                    // Composite key allows same indicator in multiple conditions
            infoMap.set(mapKey, { indicatorKey, indicatorType: config.type, conditionType, isRequired: false });
        }
    };

    processCondition(algoParams.longEntry, "LONG_ENTRY");
    processCondition(algoParams.longExit, "LONG_EXIT");
    processCondition(algoParams.shortEntry, "SHORT_ENTRY");
    processCondition(algoParams.shortExit, "SHORT_EXIT");

    return infoMap;
}
