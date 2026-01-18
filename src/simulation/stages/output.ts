/** Stage 6: Output Generation - Builds TradeEvents, calculates metrics, assembles final BacktestOutput. */

import type { BacktestOutput, SwapMetrics, AlgoMetrics, TradeEvent, AlgoEvent, SwapEvent } from "../../events/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import { calculateSwapMetrics } from "../../output/swap-metrics.ts";
import { calculateAlgoMetrics } from "../../output/algo-metrics.ts";
import type { SimulationResult, EquityPoint } from "../../output/types.ts";
import type { DataLoadingResult } from "./data-loading.ts";

export interface OutputGenerationInput {
    simulationResult: SimulationResult;                                           // Simulation result from Stage 5
    dataResult: DataLoadingResult;                                                // Data loading result from Stage 1
    totalBarsProcessed: number;                                                   // Total bars processed (for algo metrics)
    startTimeMs: number;                                                          // Backtest start time (for duration calc)
}

export interface CalculatedMetrics {
    swapMetrics: SwapMetrics;                                                     // Traditional trading metrics
    algoMetrics: AlgoMetrics;                                                     // Algorithm diagnostic metrics
}

/** Execute Stage 6: Generate final backtest output. */
export function executeOutputGeneration(input: OutputGenerationInput): BacktestOutput {
    const { simulationResult, dataResult, totalBarsProcessed, startTimeMs } = input;
    const { validatedInput } = dataResult;
    const { algoConfig, runSettings, feeBps, slippageBps } = validatedInput;

    const metrics = calculateMetrics(simulationResult.trades, simulationResult.algoEvents, simulationResult.equityCurve, totalBarsProcessed);
    const endTimeMs = Date.now();

    return {
        config: {
            algoId: algoConfig.algoID,
            version: algoConfig.version,
            symbol: runSettings.coinSymbol,
            startTime: dataResult.actualStartTime,
            endTime: dataResult.actualEndTime,
            startingCapitalUSD: dataResult.initialCapital,
            feeBps,
            slippageBps,
        },
        events: { swapEvents: simulationResult.swapEvents, algoEvents: simulationResult.algoEvents },
        trades: simulationResult.trades,
        equityCurve: simulationResult.equityCurve.map((p) => ({
            timestamp: p.timestamp ?? p.time,
            equity: p.equity,
            drawdownPct: p.drawdownPct,
        })),
        swapMetrics: metrics.swapMetrics,
        algoMetrics: metrics.algoMetrics,
        completedAt: Math.floor(endTimeMs / 1000),
        durationMs: endTimeMs - startTimeMs,
        totalBarsProcessed,
    };
}

/** Calculate all metrics from simulation results. */
export function calculateMetrics(trades: TradeEvent[], algoEvents: AlgoEvent[], equityCurve: EquityPoint[], totalBars: number): CalculatedMetrics {
    const equityCurveForMetrics = equityCurve.map((p) => ({                       // Convert to format expected by swap metrics
        timestamp: p.timestamp ?? p.time,
        equity: p.equity,
        drawdownPct: p.drawdownPct,
    }));
    return {
        swapMetrics: calculateSwapMetrics(trades, equityCurveForMetrics),
        algoMetrics: calculateAlgoMetrics(algoEvents, totalBars),
    };
}

/** Create empty BacktestOutput for when no candles are available. */
export function createEmptyBacktestOutput(input: BacktestInput, startTimeMs: number): BacktestOutput {
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
        events: { swapEvents: [], algoEvents: [] },
        trades: [],
        equityCurve: [],
        swapMetrics: createEmptySwapMetrics(),
        algoMetrics: createEmptyAlgoMetrics(),
        completedAt: Math.floor(endTimeMs / 1000),
        durationMs: endTimeMs - startTimeMs,
        totalBarsProcessed: 0,
    };
}

/** Create empty SwapMetrics. */
export function createEmptySwapMetrics(): SwapMetrics {
    return {
        totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
        totalPnlUSD: 0, grossProfitUSD: 0, grossLossUSD: 0, avgPnlUSD: 0, avgWinUSD: 0, avgLossUSD: 0,
        largestWinUSD: 0, largestLossUSD: 0, profitFactor: 0,
        sharpeRatio: 0, sortinoRatio: 0, maxDrawdownPct: 0, maxDrawdownUSD: 0, calmarRatio: 0,
        longTrades: 0, shortTrades: 0, longWinRate: 0, shortWinRate: 0, longPnlUSD: 0, shortPnlUSD: 0,
        avgTradeDurationBars: 0, avgTradeDurationSeconds: 0, avgWinDurationBars: 0, avgLossDurationBars: 0,
        totalFeesUSD: 0, totalSlippageUSD: 0,
    };
}

/** Create empty AlgoMetrics. */
export function createEmptyAlgoMetrics(): AlgoMetrics {
    return {
        indicatorAnalysis: [],
        nearMissAnalysis: [],
        stateDistribution: { pctTimeFlat: 1, pctTimeLong: 0, pctTimeShort: 0, avgTimeFlatBars: 0, avgTimeLongBars: 0, avgTimeShortBars: 0 },
        exitReasonBreakdown: { signal: 0, stopLoss: 0, takeProfit: 0, trailingStop: 0, endOfBacktest: 0 },
        conditionTriggerCounts: { LONG_ENTRY: 0, LONG_EXIT: 0, SHORT_ENTRY: 0, SHORT_EXIT: 0 },
        eventCounts: { indicatorFlips: 0, conditionChanges: 0, stateTransitions: 0, specialIndicatorEvents: 0 },
    };
}
