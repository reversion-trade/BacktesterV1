/**
 * Backtester Pipeline Stages
 *
 * @module simulation/stages
 * @description
 * This module exports all stages of the modular backtester pipeline.
 *
 * @architecture
 * The backtester is organized into 6 explicit stages:
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
 * │  Stage 5: Simulation Loop                                       │
 * │  ────────────────────────                                       │
 * │  Forward pass through candles, emit events                      │
 * │  Output: SimulationResult (from loop.ts)                        │
 * └─────────────────────────────────────────────────────────────────┘
 *                               ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Stage 6: Output Generation                                     │
 * │  ──────────────────────────                                     │
 * │  Calculate metrics, assemble final output                       │
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
    extractDataRequirements,
    type DataLoadingResult,
    type DataRequirements,
} from "./data-loading.ts";

// =============================================================================
// STAGE 2: INDICATOR PRE-CALCULATION
// =============================================================================
export {
    executeIndicatorCalculation,
    createIndicatorInputFromDataResult,
    validateIndicatorResult,
    getSignalAtBar,
    type IndicatorCalculationResult,
    type IndicatorCalculationInput,
} from "./indicator-calculation.ts";

// =============================================================================
// STAGE 3: RESAMPLING (CRITICAL)
// =============================================================================
export {
    executeResampling,
    createResamplingInput,
    validateResamplingResult,
    getResampledSignalAtBar,
    getTimestampForBar,
    formatResamplingDebugInfo,
    type ResamplingResult,
    type ResamplingInput,
    type ResamplingStats,
} from "./resampling.ts";

// =============================================================================
// STAGE 4: INITIALIZATION
// =============================================================================
export {
    executeInitialization,
    buildIndicatorInfoMap,
    getIndicatorKeys,
    getIndicatorsForCondition,
    getRequiredIndicatorCount,
    validateInitializationResult,
    type InitializationResult,
    type InitializationInput,
} from "./initialization.ts";

// =============================================================================
// STAGE 5: SIMULATION LOOP
// Re-exported from loop.ts for completeness
// =============================================================================
export { runSimulation, type SimulationConfig, type SimulationResult, type EquityPoint } from "../loop.ts";

// =============================================================================
// STAGE 5 (ALTERNATIVE): INTERFACE-BASED SIMULATION
// Uses AlgoRunner with dependency injection for backtest/live parity
// =============================================================================
export {
    AlgoRunner,
    runBacktestWithAlgoRunner,
    type AlgoRunnerConfig,
    type BarResult,
    type AlgoRunnerBacktestResult,
} from "../algo-runner.ts";

// =============================================================================
// STAGE 6: OUTPUT GENERATION
// =============================================================================
export {
    executeOutputGeneration,
    calculateMetrics,
    createEmptyBacktestOutput,
    createEmptySwapMetrics,
    createEmptyAlgoMetrics,
    validateBacktestOutput,
    formatOutputSummary,
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
import { executeIndicatorCalculation, createIndicatorInputFromDataResult } from "./indicator-calculation.ts";
import { executeResampling, createResamplingInput } from "./resampling.ts";
import { executeInitialization } from "./initialization.ts";
import { executeOutputGeneration, createEmptyBacktestOutput } from "./output.ts";
import { type SimulationResult, type EquityPoint } from "../loop.ts";

// Interface-based imports for DI pipeline
import { runBacktestWithAlgoRunner, type AlgoRunnerConfig } from "../algo-runner.ts";
import { createBacktestEnvironment } from "../../factory/backtest-factory.ts";

/**
 * Run the complete backtest pipeline using Dependency Injection.
 *
 * This function orchestrates all 6 stages using the DI pattern:
 * - Stage 5 uses AlgoRunner with injected IExecutor, IDatabase, IIndicatorFeed
 * - This ensures the same code can run in live trading by swapping implementations
 *
 * @architecture
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @param candles - Historical price data
 * @param input - Backtest input configuration
 * @returns Complete BacktestOutput
 *
 * @example
 * ```typescript
 * const output = await runBacktestPipeline(candles, input);
 * console.log(`Total P&L: $${output.swapMetrics.totalPnlUSD}`);
 * ```
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Updated: 2026-01-02 (Phase 6 Integration: Now uses DI infrastructure)
 * - This is the main entry point that uses BacktestEnvironment + AlgoRunner
 */
export async function runBacktestPipeline(candles: Candle[], input: BacktestInput): Promise<BacktestOutput> {
    const startTimeMs = Date.now();

    // Stage 1: Data Loading
    const dataResult = executeDataLoading(candles, input);

    // Early exit if no data
    if (dataResult.isEmpty) {
        return createEmptyBacktestOutput(dataResult.validatedInput, startTimeMs);
    }

    // Stage 2: Indicator Pre-Calculation
    const indicatorInput = createIndicatorInputFromDataResult(dataResult);
    const indicatorResult = executeIndicatorCalculation(indicatorInput);

    // Stage 3: Resampling
    const resamplingInput = createResamplingInput(dataResult.filteredCandles, indicatorResult);
    const resamplingResult = executeResampling(resamplingInput);

    // Stage 4: Initialization
    const initResult = executeInitialization({
        dataResult,
        resamplingResult,
    });

    // Stage 5: Simulation using Dependency Injection (PHASE 6 INTEGRATION)
    // Convert ResampledSignalCache to SignalCache format for BacktestEnvironment
    const signalCacheMap = new Map<string, boolean[]>();
    for (const key of resamplingResult.resampledSignals.keys()) {
        const signals = resamplingResult.resampledSignals.get(key);
        if (signals) {
            signalCacheMap.set(key, signals);
        }
    }

    // Convert IndicatorInfo from collector format to interface format
    // IMPORTANT: Use info.indicatorKey as map key (matches signalCache keys), not the composite key
    const indicatorInfoForFeed = new Map<string, import("../../interfaces/indicator-feed.ts").IndicatorInfo>();
    for (const [_key, info] of initResult.indicatorInfoMap) {
        indicatorInfoForFeed.set(info.indicatorKey, {
            key: info.indicatorKey,
            type: info.indicatorType,
            conditionType: info.conditionType,
            isRequired: info.isRequired,
        });
    }

    // Create BacktestEnvironment with fake implementations
    // This is where DI happens - AlgoRunner receives interfaces, not concrete classes
    const env = createBacktestEnvironment({
        algoConfig: input.algoConfig,
        candles: dataResult.filteredCandles,
        signalCache: signalCacheMap,
        indicatorInfoMap: indicatorInfoForFeed,
        feeBps: initResult.feeBps,
        slippageBps: initResult.slippageBps,
    });

    // Configure AlgoRunner
    const algoConfig: AlgoRunnerConfig = {
        algoParams: initResult.algoParams,
        symbol: initResult.symbol,
        assumePositionImmediately: initResult.assumePositionImmediately,
        tradesLimit: initResult.tradesLimit,
        warmupBars: resamplingResult.warmupBars,
    };

    // Run simulation using AlgoRunner with injected interfaces
    // This is the SAME code that would run in live trading!
    const algoResult = await runBacktestWithAlgoRunner(
        env.executor,
        env.database,
        env.indicatorFeed,
        dataResult.filteredCandles,
        algoConfig,
        initResult.closePositionOnExit
    );

    // Extract events from FakeDatabase and FakeExecutor
    // AlgoEvents are logged to the database by AlgoRunner
    const algoEvents = await env.database.getAlgoEvents();
    // SwapEvents are created by FakeExecutor during order execution (not stored in database)
    // We need to cast to access the backtest-specific getSwapEvents() method
    const swapEvents = (env.executor as import("../fakes/fake-executor.ts").FakeExecutor).getSwapEvents();

    // Build TradeEvents from SwapEvents (pair entry/exit)
    const trades = buildTradeEventsFromSwaps(swapEvents, initResult.symbol);

    // Build equity curve from AlgoRunner bar results
    const equityCurve: EquityPoint[] = buildEquityCurve(algoResult.barResults, initResult.initialCapital);

    // Build SimulationResult for Stage 6
    const simResult: SimulationResult = {
        algoEvents,
        swapEvents,
        trades,
        equityCurve,
    };

    // Stage 6: Output Generation
    return executeOutputGeneration({
        simulationResult: simResult,
        dataResult,
        totalBarsProcessed: dataResult.filteredCandles.length,
        startTimeMs,
    });
}

/**
 * Build TradeEvents from paired SwapEvents.
 * Uses isEntry and tradeDirection fields for correct pairing (handles both LONG and SHORT).
 * Falls back to old logic (USD → Asset = entry) if fields are not set.
 */
function buildTradeEventsFromSwaps(
    swapEvents: import("../../events/types.ts").SwapEvent[],
    symbol: string
): import("../../events/types.ts").TradeEvent[] {
    const trades: import("../../events/types.ts").TradeEvent[] = [];
    let currentEntrySwap: import("../../events/types.ts").SwapEvent | null = null;
    let tradeId = 1;

    for (const swap of swapEvents) {
        // Use isEntry field if available, otherwise fall back to fromAsset check
        const isEntry = swap.isEntry ?? swap.fromAsset === "USD";

        if (isEntry) {
            // Entry swap
            currentEntrySwap = swap;
        } else if (currentEntrySwap) {
            // Exit swap - pair with current entry
            const direction = swap.tradeDirection ?? (swap.fromAsset === symbol ? "LONG" : "SHORT");

            // P&L calculation depends on direction:
            // LONG: Entry spends USD to buy asset, Exit sells asset for USD
            //       P&L = exitUSD - entryUSD
            // SHORT: Entry sells asset for USD, Exit spends USD to buy back asset
            //       P&L = entryUSD - exitUSD
            let pnlUSD: number;
            let entryUSD: number;

            if (direction === "LONG") {
                // Entry: USD → Asset (fromAmount is USD spent)
                // Exit: Asset → USD (toAmount is USD received)
                entryUSD = currentEntrySwap.fromAmount;
                pnlUSD = swap.toAmount - entryUSD;
            } else {
                // SHORT - Entry: Asset → USD (toAmount is USD received)
                // SHORT - Exit: USD → Asset (fromAmount is USD spent)
                entryUSD = currentEntrySwap.toAmount;
                pnlUSD = entryUSD - swap.fromAmount;
            }

            const pnlPct = pnlUSD / entryUSD;
            const durationBars = swap.barIndex - currentEntrySwap.barIndex;
            const durationSeconds = swap.timestamp - currentEntrySwap.timestamp;

            trades.push({
                tradeId: tradeId++,
                direction,
                entrySwap: currentEntrySwap,
                exitSwap: swap,
                pnlUSD,
                pnlPct,
                durationBars,
                durationSeconds,
            });

            currentEntrySwap = null;
        }
    }

    return trades;
}

/**
 * Build equity curve from AlgoRunner bar results.
 */
function buildEquityCurve(barResults: import("../algo-runner.ts").BarResult[], initialCapital: number): EquityPoint[] {
    if (barResults.length === 0) {
        return [];
    }

    let maxEquity = initialCapital;
    const equityCurve: EquityPoint[] = [];

    for (const result of barResults) {
        const equity = result.equity;
        maxEquity = Math.max(maxEquity, equity);
        const drawdownPct = maxEquity > 0 ? (maxEquity - equity) / maxEquity : 0;

        equityCurve.push({
            timestamp: result.timestamp,
            barIndex: result.barIndex,
            equity,
            drawdownPct,
        });
    }

    return equityCurve;
}
