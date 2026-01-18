/**
 * Special Indicators
 *
 * Stateful indicators created per-trade for TP/SL/Balance tracking.
 * Unlike regular indicators which are precomputed, these maintain
 * state during a position's lifecycle.
 *
 * Architecture:
 * - BaseSpecialIndicator: Abstract base class with shared functionality
 * - Expanding Operators: Track values with expanding window (vs sliding)
 * - Registry: Metadata and factory for all special indicators
 *
 * Pattern Alignment with the indicators library:
 * - BaseOperator pattern (adapted for expanding windows)
 * - Error handling with context (withErrorHandling)
 * - Caching support (getCacheKey)
 * - Zod schema validation
 * - Metadata registry
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
    SpecialIndicator,
    BalanceResult,
    IntraTradeExtremes,
    TriggerInfo,
    PriceLevelResult,
    TrailingStopResult,
} from "./types.ts";

export { calculateTargetPrice, isPriceLevelHit } from "./types.ts";

// =============================================================================
// BASE CLASS & SCHEMAS
// =============================================================================

export {
    BaseSpecialIndicator,
    RuntimeValueSchema,
    DirectionSchema,
    StopLossConfigSchema,
    TakeProfitConfigSchema,
    TrailingStopConfigSchema,
    BalanceConfigSchema,
    SPECIAL_INDICATOR_TAGS,
} from "./base.ts";

export type {
    BaseSpecialIndicatorConfig,
    SpecialIndicatorMetadata,
    SpecialIndicatorTag,
    StopLossConfigInput,
    TakeProfitConfigInput,
    TrailingStopConfigInput,
    BalanceConfigInput,
} from "./base.ts";

// =============================================================================
// EXPANDING WINDOW OPERATORS
// =============================================================================

export {
    BaseExpandingOperator,
    ExpandingMaxOperator,
    ExpandingMinOperator,
    ExpandingRangeOperator,
    ExpandingPnLOperator,
} from "./operators.ts";

// =============================================================================
// INDICATORS
// =============================================================================

export { StopLossIndicator, createStopLoss } from "./stop-loss.ts";
export type { StopLossConfig } from "./stop-loss.ts";

export { TakeProfitIndicator, createTakeProfit } from "./take-profit.ts";
export type { TakeProfitConfig } from "./take-profit.ts";

export { TrailingStopIndicator, createTrailingStop } from "./trailing-stop.ts";
export type { TrailingStopConfig } from "./trailing-stop.ts";

export { BalanceIndicator, createBalance, createBalanceWithDefaults } from "./balance.ts";
export type { BalanceConfig } from "./balance.ts";
