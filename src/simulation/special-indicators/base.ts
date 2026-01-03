/**
 * Base Special Indicator Abstract Class
 *
 * Provides shared functionality for all special indicators, aligned with
 * the BaseIndicator pattern from the indicators library.
 *
 * Pattern alignment with indicators/src/BaseIndicator.ts:
 * - getCacheKey() for caching/deduplication
 * - getClassName() for logging/debugging
 * - withErrorHandling() wrapper for robust error handling
 * - Metadata support via static registry
 */

import { z } from "zod";
import type { Direction, ValueConfig } from "../../core/types.ts";

// =============================================================================
// ZOD SCHEMAS (aligned with indicators library patterns)
// =============================================================================

/**
 * Base schema for value configuration (ABS, REL, or DYN).
 */
export const ValueConfigSchema = z.object({
  type: z.enum(["ABS", "REL", "DYN"]).describe("Absolute USD, relative percentage, or dynamic indicator-based"),
  value: z.number().positive().describe("The value (USD for ABS, decimal for REL/DYN base)"),
  // Note: valueFactor indicator config is validated at the config level, not here
  // since special indicators receive the computed modulation factor, not the raw config
  inverted: z.boolean().optional().describe("Whether to invert the indicator modulation"),
});

/**
 * Direction schema.
 */
export const DirectionSchema = z.enum(["LONG", "SHORT"]).describe("Trade direction");

/**
 * Stop loss configuration schema.
 */
export const StopLossConfigSchema = z.object({
  direction: DirectionSchema,
  stopLoss: ValueConfigSchema.describe("Stop loss offset from entry"),
});

/**
 * Take profit configuration schema.
 */
export const TakeProfitConfigSchema = z.object({
  direction: DirectionSchema,
  takeProfit: ValueConfigSchema.describe("Take profit offset from entry"),
});

/**
 * Trailing stop configuration schema.
 */
export const TrailingStopConfigSchema = z.object({
  direction: DirectionSchema,
  trailingOffset: ValueConfigSchema.describe("Trailing offset from extreme price"),
});

/**
 * Balance indicator configuration schema.
 */
export const BalanceConfigSchema = z.object({
  direction: DirectionSchema,
  initialCapital: z.number().positive().describe("Starting capital in USD"),
  positionSize: ValueConfigSchema.describe("Position size (ABS USD or REL fraction)"),
  feeBps: z.number().min(0).max(1000).describe("Trading fee in basis points"),
  slippageBps: z.number().min(0).max(1000).describe("Slippage in basis points"),
});

// Export schema types
export type StopLossConfigInput = z.input<typeof StopLossConfigSchema>;
export type TakeProfitConfigInput = z.input<typeof TakeProfitConfigSchema>;
export type TrailingStopConfigInput = z.input<typeof TrailingStopConfigSchema>;
export type BalanceConfigInput = z.input<typeof BalanceConfigSchema>;

// =============================================================================
// ERROR HANDLING (aligned with indicators library withErrorHandling pattern)
// =============================================================================

/**
 * Format parameters for error messages.
 */
function formatParams(params: Record<string, unknown>): string {
  return JSON.stringify(params, null, 0);
}

/**
 * Wrap a function with error handling and context.
 */
function withErrorHandling<T>(
  fn: () => T,
  context: string,
  params?: Record<string, unknown>
): T {
  try {
    return fn();
  } catch (error) {
    const paramStr = params ? formatParams(params) : "";
    const message = `${context}${paramStr}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    throw new Error(message);
  }
}

// =============================================================================
// BASE SPECIAL INDICATOR
// =============================================================================

/**
 * Configuration for BaseSpecialIndicator.
 */
export interface BaseSpecialIndicatorConfig {
  direction: Direction;
  [key: string]: unknown;
}

/**
 * Abstract base class for special indicators.
 * Provides shared functionality aligned with the BaseIndicator pattern.
 *
 * @template TConfig - Configuration type
 * @template TResult - Result type from calculate()
 */
export abstract class BaseSpecialIndicator<
  TConfig extends BaseSpecialIndicatorConfig,
  TResult
> {
  protected readonly config: TConfig;

  // Trigger state (shared by all price-level indicators)
  protected triggered: boolean = false;
  protected triggerPrice: number | undefined = undefined;
  protected triggerTime: number | undefined = undefined;

  // Entry state
  protected entryPrice: number = 0;
  protected entryTime: number = 0;

  // Dynamic modulation factor (0-100 range, normalized to 0-1 for calculations)
  // Used when ValueConfig.type === "DYN"
  protected dynamicFactor: number = 1;

  constructor(config: TConfig) {
    this.config = config;
  }

  // ---------------------------------------------------------------------------
  // Metadata Methods (aligned with indicators library pattern)
  // ---------------------------------------------------------------------------

  /**
   * Get a unique cache key for this indicator configuration.
   * Useful for deduplication and caching.
   */
  public getCacheKey(): string {
    return `${this.constructor.name}:${JSON.stringify(this.config)}`;
  }

  /**
   * Get the class name without "Indicator" suffix.
   */
  public getClassName(): string {
    return this.constructor.name.replace(/Indicator$/, "");
  }

  /**
   * Get the trade direction.
   */
  public getDirection(): Direction {
    return this.config.direction;
  }

  /**
   * Get the full configuration.
   */
  public getConfig(): TConfig {
    return this.config;
  }

  // ---------------------------------------------------------------------------
  // Error Handling (aligned with indicators library pattern)
  // ---------------------------------------------------------------------------

  /**
   * Throw an error with indicator context.
   */
  protected throwError(message: string): never {
    const fullMessage = `${this.getClassName()}${formatParams(this.config as Record<string, unknown>)}:\n${message}`;
    console.error(fullMessage);
    throw new Error(fullMessage);
  }

  /**
   * Wrap a function with error handling.
   */
  protected withErrorHandling<T>(fn: () => T, context: string): T {
    return withErrorHandling(
      fn,
      `${context} in ${this.getClassName()}`,
      this.config as Record<string, unknown>
    );
  }

  // ---------------------------------------------------------------------------
  // Trigger State (shared by SL, TP, Trailing)
  // ---------------------------------------------------------------------------

  /**
   * Check if the indicator has triggered.
   */
  public isTriggered(): boolean {
    return this.triggered;
  }

  /**
   * Get the price at which trigger occurred.
   */
  public getTriggerPrice(): number | undefined {
    return this.triggerPrice;
  }

  /**
   * Get the time at which trigger occurred.
   */
  public getTriggerTime(): number | undefined {
    return this.triggerTime;
  }

  /**
   * Get entry price.
   */
  public getEntryPrice(): number {
    return this.entryPrice;
  }

  /**
   * Get entry time.
   */
  public getEntryTime(): number {
    return this.entryTime;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Methods
  // ---------------------------------------------------------------------------

  /**
   * Reset the indicator for a new trade.
   * Subclasses should call super.reset() and then do their own reset.
   *
   * @param entryPrice - Price at which position was opened
   * @param entryTime - Timestamp of entry (Unix seconds)
   * @param dynamicFactor - Optional modulation factor for DYN values (0-100 range)
   *                        Will be normalized to 0-1 for calculations
   */
  public reset(entryPrice: number, entryTime: number, dynamicFactor?: number): void {
    this.entryPrice = entryPrice;
    this.entryTime = entryTime;
    this.triggered = false;
    this.triggerPrice = undefined;
    this.triggerTime = undefined;

    // Store dynamic factor (normalize from 0-100 to 0-1)
    this.dynamicFactor = dynamicFactor !== undefined ? dynamicFactor / 100 : 1;

    // Call subclass reset
    this.onReset();
  }

  /**
   * Hook for subclass-specific reset logic.
   * Called after base reset is complete.
   */
  protected abstract onReset(): void;

  /**
   * Process a batch of prices.
   * Subclasses implement the core logic here.
   */
  public abstract calculate(prices: number[], times: number[]): TResult[];

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Record a trigger event.
   */
  protected recordTrigger(price: number, time: number): void {
    if (!this.triggered) {
      this.triggered = true;
      this.triggerPrice = price;
      this.triggerTime = time;
    }
  }

  /**
   * Calculate offset value from entry price.
   * Handles ABS, REL, and DYN value types.
   *
   * For DYN type:
   * - Base value is modulated by the dynamic factor (0-1)
   * - If inverted is true, uses (1 - dynamicFactor) instead
   * - Example: value=0.05 (5%), dynamicFactor=0.5 (50/100)
   *   → effectiveValue = 0.05 * 0.5 = 0.025 (2.5%)
   */
  protected calculateOffset(valueConfig: ValueConfig): number {
    let effectiveValue = valueConfig.value;

    // Apply dynamic modulation if DYN type
    if (valueConfig.type === "DYN") {
      const factor = valueConfig.inverted
        ? (1 - this.dynamicFactor)
        : this.dynamicFactor;
      effectiveValue = valueConfig.value * factor;
    }

    // For REL and DYN, value is a percentage of entry price
    // For ABS, value is the absolute amount
    if (valueConfig.type === "REL" || valueConfig.type === "DYN") {
      return this.entryPrice * effectiveValue;
    }
    return effectiveValue;
  }

  /**
   * Get the current dynamic modulation factor (normalized 0-1).
   */
  public getDynamicFactor(): number {
    return this.dynamicFactor;
  }
}

// =============================================================================
// METADATA TYPES (aligned with indicators library IndicatorMetadata)
// =============================================================================

/**
 * Tags for categorizing special indicators.
 */
export const SPECIAL_INDICATOR_TAGS = [
  "Risk Management",
  "Profit Target",
  "Dynamic",
  "Balance Tracking",
] as const;

export type SpecialIndicatorTag = (typeof SPECIAL_INDICATOR_TAGS)[number];

/**
 * Metadata for a special indicator.
 * Aligned with the IndicatorMetadata pattern.
 */
export interface SpecialIndicatorMetadata<TConfig, TResult> {
  /** Constructor for the indicator class */
  class: new (config: TConfig) => BaseSpecialIndicator<TConfig & BaseSpecialIndicatorConfig, TResult>;
  /** Short name for display */
  name: string;
  /** Categorization tags */
  tags: SpecialIndicatorTag[];
  /** Brief description */
  description: string;
  /** When/why to use this indicator */
  useCases: string;
  /** Zod schema for validation */
  schema: z.ZodSchema<TConfig>;
}
