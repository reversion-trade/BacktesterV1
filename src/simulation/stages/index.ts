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
export {
  runSimulation,
  type SimulationConfig,
  type SimulationResult,
  type EquityPoint,
} from "../loop.ts";

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
export async function runBacktestPipeline(
  candles: Candle[],
  input: BacktestInput
): Promise<BacktestOutput> {
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
  const resamplingInput = createResamplingInput(
    dataResult.filteredCandles,
    indicatorResult
  );
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
  const indicatorInfoForFeed = new Map<string, import("../../interfaces/indicator-feed.ts").IndicatorInfo>();
  for (const [key, info] of initResult.indicatorInfoMap) {
    indicatorInfoForFeed.set(key, {
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
  const algoEvents = await env.database.getAlgoEvents();
  const swapEvents = await env.database.getSwapEvents();

  // Build TradeEvents from SwapEvents (pair entry/exit)
  const trades = buildTradeEventsFromSwaps(swapEvents, initResult.symbol);

  // Build equity curve from AlgoRunner bar results
  const equityCurve: EquityPoint[] = buildEquityCurve(
    algoResult.barResults,
    initResult.initialCapital
  );

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
 * Entry swaps (USD → Asset) are paired with exit swaps (Asset → USD).
 */
function buildTradeEventsFromSwaps(
  swapEvents: import("../../events/types.ts").SwapEvent[],
  symbol: string
): import("../../events/types.ts").TradeEvent[] {
  const trades: import("../../events/types.ts").TradeEvent[] = [];
  let currentEntrySwap: import("../../events/types.ts").SwapEvent | null = null;
  let tradeId = 1;

  for (const swap of swapEvents) {
    if (swap.fromAsset === "USD") {
      // Entry swap (USD → Asset)
      currentEntrySwap = swap;
    } else if (swap.toAsset === "USD" && currentEntrySwap) {
      // Exit swap (Asset → USD)
      const direction: import("../../core/types.ts").Direction =
        swap.fromAsset === symbol ? "LONG" : "SHORT";

      const pnlUSD = swap.toAmount - currentEntrySwap.fromAmount;
      const pnlPct = pnlUSD / currentEntrySwap.fromAmount;
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
function buildEquityCurve(
  barResults: import("../algo-runner.ts").BarResult[],
  initialCapital: number
): EquityPoint[] {
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

