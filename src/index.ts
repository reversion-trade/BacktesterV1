import type { Candle } from "./core/types.ts";
import type { BacktestOutput } from "./output/types.ts";
import { validateBacktestInput, type BacktestInput } from "./core/config.ts";
import { runBacktestPipeline } from "./simulation/stages/index.ts";

export function runBacktestWithEvents(candles: Candle[], input: BacktestInput): BacktestOutput {
    return runBacktestPipeline(candles, validateBacktestInput(input));
}

export type { Candle, AlgoParams, AlgoConfig, RunSettings, Direction, ValueConfig, ValueType, OrderType, RunStatus, EntryCondition, ExitCondition, PositionState } from "./core/types.ts"; // Core types
export type { BacktestOutput, EquityPoint, SimulationResult } from "./output/types.ts"; // Output types
export type { SwapEvent, TradeEvent, AlgoEvent, IndicatorFlipEvent, ConditionChangeEvent, StateTransitionEvent, SpecialIndicatorEvent, ConditionType, TransitionReason, ConditionSnapshot, SwapMetrics, AlgoMetrics, IndicatorAnalysis, NearMissAnalysis, ApproachSequence } from "./events/types.ts"; // Event types
export type { BacktestInput } from "./core/config.ts";
export { validateBacktestInput, BacktestInputSchema, AlgoParamsSchema, AlgoConfigSchema, RunSettingsSchema, ValueConfigSchema } from "./core/config.ts"; // Config schemas
export { EventCollector, type IndicatorInfo } from "./events/collector.ts";
export { calculateSwapMetrics } from "./output/swap-metrics.ts";
export { calculateAlgoMetrics } from "./output/algo-metrics.ts";
export { runBacktestPipeline } from "./simulation/stages/index.ts";
export { StopLossIndicator, TakeProfitIndicator, TrailingStopIndicator, BalanceIndicator } from "./simulation/special-indicators/index.ts";
