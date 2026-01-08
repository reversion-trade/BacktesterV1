/**
 * Backtester-v2 Entry Point
 *
 * Event-based backtest API with full algo analytics.
 */

import type { Candle } from "./core/types.ts";
import type { BacktestOutput } from "./output/types.ts";
import { BacktestInputSchema, type BacktestInput } from "./core/config.ts";
import { runBacktestPipeline } from "./simulation/stages/index.ts";

// =============================================================================
// MAIN BACKTEST FUNCTION
// =============================================================================

/**
 * Run a complete backtest with full event logging.
 * Returns BacktestOutput format with algo analytics.
 *
 * Uses the modern AlgoRunner pipeline with dependency injection,
 * ensuring consistent behavior between backtest and live trading.
 *
 * @param candles - Historical price data (1m candles)
 * @param input - Backtest input (algoConfig + runSettings)
 * @returns Complete backtest output with events and metrics
 */
export async function runBacktestWithEvents(candles: Candle[], input: BacktestInput): Promise<BacktestOutput> {
    const validatedInput = BacktestInputSchema.parse(input);
    return runBacktestPipeline(candles, validatedInput);
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

// Output types
export type { BacktestOutput, EquityPoint, SimulationResult } from "./output/types.ts";

// Event types
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
} from "./events/types.ts";

// Config types and schemas
export type { BacktestInput } from "./core/config.ts";
export {
    BacktestInputSchema,
    AlgoParamsSchema,
    AlgoConfigSchema,
    RunSettingsSchema,
    ValueConfigSchema,
} from "./core/config.ts";

// Event collector
export { EventCollector, type IndicatorInfo } from "./events/collector.ts";

// Metrics calculators
export { calculateSwapMetrics } from "./output/swap-metrics.ts";
export { calculateAlgoMetrics } from "./output/algo-metrics.ts";

// Simulation components
export { TradingStateMachine, createStateMachine } from "./simulation/state-machine.ts";

// Modern DI-based simulation
export { runBacktestPipeline } from "./simulation/stages/index.ts";
export { AlgoRunner, runBacktestWithAlgoRunner } from "./simulation/algo-runner.ts";

export {
    StopLossIndicator,
    TakeProfitIndicator,
    TrailingStopIndicator,
    BalanceIndicator,
} from "./simulation/special-indicators/index.ts";
