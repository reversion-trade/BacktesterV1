/**
 * Backtester-v2 Entry Point
 *
 * Main backtest functions that orchestrate the entire backtest process.
 *
 * Two output formats supported:
 * 1. BacktestResult (legacy) - Traditional metrics format for backward compatibility
 * 2. BacktestOutput (new) - Event-based format with full algo analytics
 */

import type { Candle, AlgoParams, AlgoConfig, RunSettings } from "./core/types.ts";
import type { BacktestResult, BacktestOutput, EquityPoint as OutputEquityPoint } from "./output/types.ts";
import {
    BacktestConfigSchema,
    BacktestInputSchema,
    backfillLegacyConfig,
    type BacktestConfig,
    type BacktestInput,
} from "./core/config.ts";
import { calculateIndicators, collectIndicatorConfigs } from "./indicators/calculator.ts";
import { runSimulation, type SimulationConfig, type SimulationResult } from "./simulation/loop.ts";
import { runBacktestPipeline } from "./simulation/stages/index.ts";
import { processEquityCurve } from "./output/equity-curve.ts";
import { calculateAllMetrics } from "./output/metrics.ts";
import { calculateSwapMetrics } from "./output/swap-metrics.ts";
import { calculateAlgoMetrics } from "./output/algo-metrics.ts";
import type { TradeEvent, SwapMetrics, AlgoMetrics } from "./events/types.ts";

// =============================================================================
// NEW EVENT-BASED BACKTEST
// =============================================================================

/**
 * Run a complete backtest with full event logging.
 * Returns the new BacktestOutput format with algo analytics.
 *
 * Uses the modern AlgoRunner pipeline with dependency injection,
 * ensuring consistent behavior between backtest and live trading.
 *
 * @param candles - Historical price data (1m candles)
 * @param input - Backtest input (algoConfig + runSettings)
 * @returns Complete backtest output with events and metrics
 *
 * @audit-trail
 * - Updated: 2026-01-05 (Refactoring: Now uses runBacktestPipeline for single source of truth)
 */
export async function runBacktestWithEvents(candles: Candle[], input: BacktestInput): Promise<BacktestOutput> {
    // Validate input and delegate to the modern pipeline
    const validatedInput = BacktestInputSchema.parse(input);
    return runBacktestPipeline(candles, validatedInput);
}

// =============================================================================
// LEGACY FORMAT - BACKWARD COMPATIBLE
// =============================================================================

/**
 * Run a complete backtest using the new BacktestInput format.
 * Returns legacy BacktestResult format.
 *
 * @param candles - Historical price data (1m candles)
 * @param input - Backtest input (algoConfig + runSettings)
 * @returns Complete backtest results with metrics (legacy format)
 */
export function runBacktestNew(candles: Candle[], input: BacktestInput): BacktestResult {
    // Validate input
    const validatedInput = BacktestInputSchema.parse(input);

    // Convert to legacy format for internal processing
    const legacyConfig = backfillLegacyConfig(validatedInput);

    // Run backtest with legacy config
    return runBacktestInternal(candles, legacyConfig, validatedInput.runSettings);
}

/**
 * Run a complete backtest using the legacy BacktestConfig format.
 *
 * @param candles - Historical price data (1m candles)
 * @param config - Legacy backtest configuration
 * @returns Complete backtest results with metrics
 */
export function runBacktest(candles: Candle[], config: BacktestConfig): BacktestResult {
    // Validate config
    const validatedConfig = BacktestConfigSchema.parse(config);

    // Create partial RunSettings for internal use
    const runSettings: Partial<RunSettings> = {
        assumePositionImmediately: validatedConfig.assumePositionImmediately,
        closePositionOnExit: validatedConfig.closePositionOnExit,
    };

    return runBacktestInternal(candles, validatedConfig, runSettings);
}

// =============================================================================
// INTERNAL IMPLEMENTATION
// =============================================================================

/**
 * Internal backtest implementation for legacy format.
 */
function runBacktestInternal(
    candles: Candle[],
    config: BacktestConfig,
    runSettings: Partial<RunSettings>
): BacktestResult {
    const startTimeMs = Date.now();

    // Filter candles to time range
    const filteredCandles = candles.filter((c) => c.bucket >= config.startTime && c.bucket <= config.endTime);

    if (filteredCandles.length === 0) {
        return createEmptyResult(config, startTimeMs);
    }

    // Collect all indicator configs and calculate signals
    const indicatorConfigs = collectIndicatorConfigs(config.algoParams);
    const { signals: signalCache, warmupCandles } = calculateIndicators(filteredCandles, indicatorConfigs);

    // Run simulation
    const simConfig: SimulationConfig = {
        candles: filteredCandles,
        signalCache,
        algoParams: config.algoParams,
        symbol: config.symbol,
        initialCapital: config.startingCapitalUSD,
        feeBps: config.feeBps,
        slippageBps: config.slippageBps,
        warmupCandles,
        assumePositionImmediately: runSettings.assumePositionImmediately,
        closePositionOnExit: runSettings.closePositionOnExit,
        tradesLimit: runSettings.tradesLimit,
    };

    const simResult = runSimulation(simConfig);

    // Convert TradeEvent[] to TradeRecord[] for legacy format
    const trades = convertTradeEventsToRecords(simResult.trades, config.startingCapitalUSD);

    // Convert equity curve to legacy format
    const rawEquityCurve: OutputEquityPoint[] = simResult.equityCurve.map((p) => ({
        time: p.timestamp,
        equity: p.equity,
        drawdownPct: p.drawdownPct,
        runupPct: 0, // Calculate if needed
    }));

    // Process equity curve (downsample for storage)
    const equityCurve = processEquityCurve(rawEquityCurve, {
        targetPoints: 500,
        preserveDrawdownPeaks: true,
    });

    // Calculate all metrics using legacy format
    const actualStartTime = filteredCandles[0]?.bucket ?? config.startTime;
    const actualEndTime = filteredCandles[filteredCandles.length - 1]?.bucket ?? config.endTime;

    const metrics = calculateAllMetrics(trades, equityCurve, actualStartTime, actualEndTime, config.startingCapitalUSD);

    // Assemble result
    const endTimeMs = Date.now();

    return {
        config: {
            coinSymbol: config.symbol,
            startTime: actualStartTime,
            endTime: actualEndTime,
            startingCapitalUSD: config.startingCapitalUSD,
            feeBps: config.feeBps,
            slippageBps: config.slippageBps,
            algoParams: config.algoParams,
        },
        summary: metrics.summary,
        performance: metrics.performance,
        trades,
        analysis: metrics.analysis,
        additional: metrics.additional,
        equityCurve,
        completedAt: Math.floor(endTimeMs / 1000),
        durationMs: endTimeMs - startTimeMs,
    };
}

// =============================================================================
// CONVERSION HELPERS
// =============================================================================

import type { TradeRecord, ExitReason } from "./output/types.ts";

/**
 * Convert new TradeEvent[] to legacy TradeRecord[].
 */
function convertTradeEventsToRecords(trades: TradeEvent[], initialCapital: number): TradeRecord[] {
    let cumulativePnl = 0;

    return trades.map((trade) => {
        cumulativePnl += trade.pnlUSD;
        const equityAfterTrade = initialCapital + cumulativePnl;

        return {
            tradeId: trade.tradeId,
            direction: trade.direction,
            entryTime: trade.entrySwap.timestamp,
            entryPrice: trade.entrySwap.price,
            exitTime: trade.exitSwap.timestamp,
            exitPrice: trade.exitSwap.price,
            qty: trade.entrySwap.toAmount, // Asset amount
            pnlUSD: trade.pnlUSD,
            pnlPct: trade.pnlPct,
            runUpUSD: 0, // TODO: Track in simulation
            runUpPct: 0,
            drawdownUSD: 0,
            drawdownPct: 0,
            durationSeconds: trade.durationSeconds,
            durationBars: trade.durationBars,
            cumulativePnlUSD: cumulativePnl,
            equityAfterTrade,
            exitReason: "SIGNAL" as ExitReason, // TODO: Extract from events
            stopLossPrice: undefined,
            takeProfitPrice: undefined,
        };
    });
}

// =============================================================================
// EMPTY RESULT HELPERS
// =============================================================================

/**
 * Create empty BacktestOutput when no candles available.
 */
function createEmptyBacktestOutput(input: BacktestInput, startTimeMs: number): BacktestOutput {
    const endTimeMs = Date.now();
    const { algoConfig, runSettings, feeBps, slippageBps } = input;

    return {
        config: {
            algoId: algoConfig.algoID,
            version: algoConfig.version,
            symbol: runSettings.coinSymbol,
            startTime: runSettings.startTime!,
            endTime: runSettings.endTime!,
            startingCapitalUSD: algoConfig.params.startingCapitalUSD * runSettings.capitalScaler,
            feeBps,
            slippageBps,
        },
        events: {
            swapEvents: [],
            algoEvents: [],
        },
        trades: [],
        equityCurve: [],
        swapMetrics: createEmptySwapMetrics(),
        algoMetrics: createEmptyAlgoMetrics(),
        completedAt: Math.floor(endTimeMs / 1000),
        durationMs: endTimeMs - startTimeMs,
        totalBarsProcessed: 0,
    };
}

function createEmptySwapMetrics(): SwapMetrics {
    return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnlUSD: 0,
        grossProfitUSD: 0,
        grossLossUSD: 0,
        avgPnlUSD: 0,
        avgWinUSD: 0,
        avgLossUSD: 0,
        largestWinUSD: 0,
        largestLossUSD: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        maxDrawdownPct: 0,
        maxDrawdownUSD: 0,
        calmarRatio: 0,
        longTrades: 0,
        shortTrades: 0,
        longWinRate: 0,
        shortWinRate: 0,
        longPnlUSD: 0,
        shortPnlUSD: 0,
        avgTradeDurationBars: 0,
        avgTradeDurationSeconds: 0,
        avgWinDurationBars: 0,
        avgLossDurationBars: 0,
        totalFeesUSD: 0,
        totalSlippageUSD: 0,
    };
}

function createEmptyAlgoMetrics(): AlgoMetrics {
    return {
        indicatorAnalysis: [],
        nearMissAnalysis: [],
        stateDistribution: {
            pctTimeFlat: 1,
            pctTimeLong: 0,
            pctTimeShort: 0,
            avgTimeFlatBars: 0,
            avgTimeLongBars: 0,
            avgTimeShortBars: 0,
        },
        exitReasonBreakdown: {
            signal: 0,
            stopLoss: 0,
            takeProfit: 0,
            trailingStop: 0,
            endOfBacktest: 0,
        },
        conditionTriggerCounts: {
            LONG_ENTRY: 0,
            LONG_EXIT: 0,
            SHORT_ENTRY: 0,
            SHORT_EXIT: 0,
        },
        eventCounts: {
            indicatorFlips: 0,
            conditionChanges: 0,
            stateTransitions: 0,
            specialIndicatorEvents: 0,
        },
    };
}

/**
 * Create an empty result when no candles are available (legacy format).
 */
function createEmptyResult(config: BacktestConfig, startTimeMs: number): BacktestResult {
    const endTimeMs = Date.now();

    return {
        config: {
            coinSymbol: config.symbol,
            startTime: config.startTime,
            endTime: config.endTime,
            startingCapitalUSD: config.startingCapitalUSD,
            feeBps: config.feeBps,
            slippageBps: config.slippageBps,
            algoParams: config.algoParams,
        },
        summary: {
            totalPnlUSD: 0,
            maxEquityDrawdownPct: 0,
            maxEquityRunupPct: 0,
            numberOfTrades: 0,
            winRate: 0,
            sharpeRatio: 0,
            sortinoRatio: 0,
            largestWinUSD: 0,
            largestLossUSD: 0,
        },
        performance: {
            netProfit: { total: 0, long: 0, short: 0 },
            grossProfit: { total: 0, long: 0, short: 0 },
            grossLoss: { total: 0, long: 0, short: 0 },
        },
        trades: [],
        analysis: {
            statistics: {
                totalTrades: 0,
                winningTradesCount: { long: 0, short: 0 },
                losingTradesCount: { long: 0, short: 0 },
                percentProfitable: { long: 0, short: 0 },
            },
            profitLoss: {
                avgPnl: { long: 0, short: 0 },
                avgWinningTrade: { long: 0, short: 0 },
                avgLosingTrade: { long: 0, short: 0 },
                largestWinningTrade: { long: 0, short: 0 },
                largestLosingTrade: { long: 0, short: 0 },
            },
            duration: {
                avgTradeDurationBars: { long: 0, short: 0 },
                avgWinningTradeDurationBars: { long: 0, short: 0 },
                avgLosingTradeDurationBars: { long: 0, short: 0 },
            },
        },
        additional: {
            calmarRatio: 0,
            profitFactor: 0,
            expectancy: 0,
            dailyVolatility: 0,
            annualizedVolatility: 0,
            maxDrawdownUSD: 0,
            maxDrawdownDurationSeconds: 0,
            tradesPerDay: 0,
            annualizedReturnPct: 0,
            exitsByReason: {
                SIGNAL: 0,
                STOP_LOSS: 0,
                TAKE_PROFIT: 0,
                TRAILING_STOP: 0,
                END_OF_BACKTEST: 0,
            },
        },
        equityCurve: [],
        completedAt: Math.floor(endTimeMs / 1000),
        durationMs: endTimeMs - startTimeMs,
    };
}

// =============================================================================
// EXPORTS
// =============================================================================

// Core types
export type {
    Candle,
    AlgoParams,
    AlgoConfig,
    RunSettings,
    Direction,
    ValueConfig,
    ValueType,
    LadderParams,
    OrderType,
    RunStatus,
    EntryCondition,
    ExitCondition,
    PositionState,
} from "./core/types.ts";

// Output types (legacy)
export type {
    BacktestResult,
    TradeRecord,
    EquityPoint,
    SummaryMetrics,
    PerformanceMetrics,
    TradesAnalysis,
    ExitReason,
    AdditionalMetrics,
    BacktestConfig as OutputBacktestConfig,
} from "./output/types.ts";

// Event types (new)
export type {
    SwapEvent,
    TradeEvent,
    AlgoEvent,
    IndicatorFlipEvent,
    ConditionChangeEvent,
    StateTransitionEvent,
    SpecialIndicatorEvent,
    ConditionType,
    TransitionReason,
    ConditionSnapshot,
    SwapMetrics,
    AlgoMetrics,
    IndicatorAnalysis,
    NearMissAnalysis,
    ApproachSequence,
    BacktestOutput,
} from "./events/types.ts";

// Config types and schemas
export type { BacktestConfig, BacktestInput } from "./core/config.ts";
export {
    BacktestConfigSchema,
    BacktestInputSchema,
    AlgoParamsSchema,
    AlgoConfigSchema,
    RunSettingsSchema,
    ValueConfigSchema,
    backfillLegacyConfig,
    convertToBacktestInput,
} from "./core/config.ts";

// Event collector
export { EventCollector, type IndicatorInfo } from "./events/collector.ts";

// Metrics calculators
export { calculateSwapMetrics } from "./output/swap-metrics.ts";
export { calculateAlgoMetrics } from "./output/algo-metrics.ts";
export { calculateAllMetrics } from "./output/metrics.ts";

// Simulation components (for advanced users)
export { TradingStateMachine, createStateMachine } from "./simulation/state-machine.ts";

// Modern DI-based simulation (RECOMMENDED)
export { runBacktestPipeline } from "./simulation/stages/index.ts";
export { AlgoRunner, runBacktestWithAlgoRunner } from "./simulation/algo-runner.ts";

// Legacy simulation (DEPRECATED - use runBacktestPipeline instead)
/** @deprecated Use runBacktestPipeline instead */
export { runSimulation, type SimulationConfig, type SimulationResult } from "./simulation/loop.ts";

export {
    StopLossIndicator,
    TakeProfitIndicator,
    TrailingStopIndicator,
    BalanceIndicator,
} from "./simulation/special-indicators/index.ts";
