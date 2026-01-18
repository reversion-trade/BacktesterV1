/** Special Indicators - Stateful per-trade indicators for SL/TP/Trailing/Balance tracking. */

export type { BalanceResult, IntraTradeExtremes, PriceLevelResult, StopLossResult, TrailingStopResult } from "./types.ts";
export { calculateTargetPrice, isPriceLevelHit } from "./types.ts";

export { BaseSpecialIndicator, RuntimeValueSchema, DirectionSchema, StopLossConfigSchema, TakeProfitConfigSchema, TrailingStopConfigSchema, BalanceConfigSchema, SPECIAL_INDICATOR_TAGS } from "./base.ts";
export type { BaseSpecialIndicatorConfig, SpecialIndicatorMetadata, SpecialIndicatorTag, StopLossConfigInput, TakeProfitConfigInput, TrailingStopConfigInput, BalanceConfigInput } from "./base.ts";

export { BaseExpandingOperator, ExpandingMaxOperator, ExpandingMinOperator, ExpandingRangeOperator } from "./operators.ts";

export { StopLossIndicator, createStopLoss } from "./stop-loss.ts";
export type { StopLossConfig } from "./stop-loss.ts";

export { TakeProfitIndicator, createTakeProfit } from "./take-profit.ts";
export type { TakeProfitConfig } from "./take-profit.ts";

export { TrailingStopIndicator, createTrailingStop } from "./trailing-stop.ts";
export type { TrailingStopConfig } from "./trailing-stop.ts";

export { BalanceIndicator, createBalance, createBalanceWithDefaults } from "./balance.ts";
export type { BalanceConfig } from "./balance.ts";
