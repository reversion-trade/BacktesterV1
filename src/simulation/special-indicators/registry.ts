/**
 * Special Indicator Registry
 *
 * Metadata registry for all special indicators, aligned with the
 * IndicatorRegistry pattern from the indicators library.
 *
 * Provides:
 * - Centralized metadata for all special indicators
 * - Constructor access by name
 * - Schema validation per indicator type
 * - Documentation and categorization
 */

import { z } from "zod";
import type { SpecialIndicatorMetadata, SpecialIndicatorTag } from "./base.ts";
import { StopLossConfigSchema, TakeProfitConfigSchema, TrailingStopConfigSchema, BalanceConfigSchema } from "./base.ts";
import { StopLossIndicator, type StopLossConfig } from "./stop-loss.ts";
import { TakeProfitIndicator, type TakeProfitConfig } from "./take-profit.ts";
import { TrailingStopIndicator, type TrailingStopConfig } from "./trailing-stop.ts";
import { BalanceIndicator, type BalanceConfig } from "./balance.ts";
import type { PriceLevelResult, TrailingStopResult, BalanceResult } from "./types.ts";

// =============================================================================
// REGISTRY
// =============================================================================

/**
 * Registry of all special indicators with metadata.
 * Aligned with the IndicatorRegistry pattern.
 */
export const SpecialIndicatorRegistry = {
    StopLoss: {
        class: StopLossIndicator,
        name: "Fixed Stop Loss",
        tags: ["Risk Management"] as SpecialIndicatorTag[],
        description: "Fixed stop loss that triggers when price moves against position by a specified offset",
        useCases: "Risk management, loss prevention, capital protection",
        schema: StopLossConfigSchema,
    } as SpecialIndicatorMetadata<StopLossConfig, PriceLevelResult>,

    TakeProfit: {
        class: TakeProfitIndicator,
        name: "Fixed Take Profit",
        tags: ["Profit Target"] as SpecialIndicatorTag[],
        description: "Fixed take profit that triggers when price moves in favor of position by a specified offset",
        useCases: "Profit locking, target-based exits, systematic profit taking",
        schema: TakeProfitConfigSchema,
    } as SpecialIndicatorMetadata<TakeProfitConfig, PriceLevelResult>,

    TrailingStop: {
        class: TrailingStopIndicator,
        name: "Trailing Stop",
        tags: ["Risk Management", "Dynamic"] as SpecialIndicatorTag[],
        description: "Dynamic stop loss that ratchets with favorable price movement, locking in gains",
        useCases: "Trend following, momentum trading, capturing large moves while protecting profits",
        schema: TrailingStopConfigSchema,
    } as SpecialIndicatorMetadata<TrailingStopConfig, TrailingStopResult>,

    Balance: {
        class: BalanceIndicator,
        name: "Balance Tracker",
        tags: ["Balance Tracking"] as SpecialIndicatorTag[],
        description: "Tracks portfolio value, unrealized P&L, and intra-trade extremes during a position",
        useCases: "Equity curve construction, drawdown tracking, position analytics",
        schema: BalanceConfigSchema,
    } as SpecialIndicatorMetadata<BalanceConfig, BalanceResult>,
} as const;

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Names of all registered special indicators.
 */
export type SpecialIndicatorName = keyof typeof SpecialIndicatorRegistry;

/**
 * Get all indicator names.
 */
export function getSpecialIndicatorNames(): SpecialIndicatorName[] {
    return Object.keys(SpecialIndicatorRegistry) as SpecialIndicatorName[];
}

/**
 * Get metadata for a specific indicator.
 */
export function getSpecialIndicatorMetadata(
    name: SpecialIndicatorName
): (typeof SpecialIndicatorRegistry)[typeof name] {
    return SpecialIndicatorRegistry[name];
}

/**
 * Get all indicators with a specific tag.
 */
export function getSpecialIndicatorsByTag(tag: SpecialIndicatorTag): SpecialIndicatorName[] {
    return getSpecialIndicatorNames().filter((name) => SpecialIndicatorRegistry[name].tags.includes(tag));
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a special indicator by name with validated config.
 *
 * @example
 * const sl = createSpecialIndicator("StopLoss", {
 *   direction: "LONG",
 *   stopLoss: { type: "REL", value: 0.02 }
 * });
 */
export function createSpecialIndicator<K extends SpecialIndicatorName>(
    name: K,
    config: z.input<(typeof SpecialIndicatorRegistry)[K]["schema"]>
): InstanceType<(typeof SpecialIndicatorRegistry)[K]["class"]> {
    const metadata = SpecialIndicatorRegistry[name];
    const validatedConfig = metadata.schema.parse(config);
    return new metadata.class(validatedConfig as any) as any;
}
