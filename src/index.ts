import type { Candle } from "./core/types.ts";
import type { BacktestOutput } from "./output/types.ts";
import { validateBacktestInput, type BacktestInput } from "./core/config.ts";
import { runBacktestPipeline } from "./simulation/stages/index.ts";

// MAIN BACKTEST FUNCTION
export async function runBacktestWithEvents(candles: Candle[], input: BacktestInput): Promise<BacktestOutput> {
    const validatedInput = validateBacktestInput(input);
    return runBacktestPipeline(candles, validatedInput);
}

// EXPORTS core types
export type {
    Candle,
    AlgoParams,
    AlgoConfig,
    RunSettings,
    Direction,
    ValueConfig,
    ValueType,
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
    validateBacktestInput,
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

// Event-driven simulation pipeline
export { runBacktestPipeline } from "./simulation/stages/index.ts";

export {
    StopLossIndicator,
    TakeProfitIndicator,
    TrailingStopIndicator,
    BalanceIndicator,
} from "./simulation/special-indicators/index.ts";
