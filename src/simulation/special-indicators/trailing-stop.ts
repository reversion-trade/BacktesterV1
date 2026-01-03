/**
 * Trailing Stop Indicator
 *
 * Dynamic stop loss that ratchets with favorable price movement.
 * The stop level is always a fixed offset from the extreme price.
 *
 * Uses ExpandingMaxOperator (LONG) or ExpandingMinOperator (SHORT) to track
 * the extreme price since entry with an expanding window.
 *
 * For LONG:
 *   - Tracks highest price seen (using ExpandingMaxOperator)
 *   - SL level = highest - offset
 *   - Triggers when price <= SL level
 *
 * For SHORT:
 *   - Tracks lowest price seen (using ExpandingMinOperator)
 *   - SL level = lowest + offset
 *   - Triggers when price >= SL level
 */

import type { Direction, ValueConfig } from "../../core/types.ts";
import {
  BaseSpecialIndicator,
  TrailingStopConfigSchema,
} from "./base.ts";
import type { TrailingStopResult } from "./types.ts";
import { ExpandingMaxOperator, ExpandingMinOperator } from "./operators.ts";

// =============================================================================
// CONFIG TYPE
// =============================================================================

/**
 * Configuration for trailing stop indicator.
 */
export interface TrailingStopConfig {
  direction: Direction;
  trailingOffset: ValueConfig;
}

// =============================================================================
// TRAILING STOP INDICATOR
// =============================================================================

/**
 * Trailing stop indicator that follows favorable price movement.
 * Extends BaseSpecialIndicator for shared functionality and uses
 * expanding window operators for extreme price tracking.
 *
 * @example
 * const ts = new TrailingStopIndicator({
 *   direction: "LONG",
 *   trailingOffset: { type: "REL", value: 0.03 }, // 3% trailing stop
 * });
 *
 * ts.reset(50000, 1704067200); // Entry at $50,000
 * // Initial extreme = $50,000, SL = $48,500 (3% below)
 *
 * const results = ts.calculate(
 *   [51000, 52000, 51500, 50000],
 *   [t1, t2, t3, t4]
 * );
 * // Price rises to $52,000, extreme updates, SL ratchets up to $50,440
 * // Price drops to $50,000, hits the trailing stop
 * // results[3].hit = true
 */
export class TrailingStopIndicator extends BaseSpecialIndicator<
  TrailingStopConfig,
  TrailingStopResult
> {
  // Expanding window operator for tracking extreme price
  private readonly extremeOperator: ExpandingMaxOperator | ExpandingMinOperator;

  // Current state
  private currentLevel: number = 0;
  private offset: number = 0;

  constructor(config: TrailingStopConfig) {
    super(config);

    // Use appropriate operator based on direction
    this.extremeOperator =
      config.direction === "LONG"
        ? new ExpandingMaxOperator()
        : new ExpandingMinOperator();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Reset for a new trade.
   */
  protected onReset(): void {
    // Calculate offset from entry price
    this.offset = this.calculateOffset(this.config.trailingOffset);

    // Initialize extreme operator with entry price
    if (this.config.direction === "LONG") {
      (this.extremeOperator as ExpandingMaxOperator).resetWithValue(
        this.entryPrice
      );
    } else {
      (this.extremeOperator as ExpandingMinOperator).resetWithValue(
        this.entryPrice
      );
    }

    // Calculate initial stop level
    this.currentLevel = this.calculateStopLevel(this.entryPrice);
  }

  // ---------------------------------------------------------------------------
  // Core Logic
  // ---------------------------------------------------------------------------

  /**
   * Process a batch of prices, updating extreme and checking for hits.
   * Once triggered, all subsequent results also show hit = true.
   */
  calculate(prices: number[], times: number[]): TrailingStopResult[] {
    return this.withErrorHandling(() => {
      const results: TrailingStopResult[] = [];

      for (let i = 0; i < prices.length; i++) {
        const price = prices[i]!;
        const time = times[i]!;

        // If already triggered, return current state
        if (this.triggered) {
          results.push({
            hit: true,
            currentLevel: this.currentLevel,
            extremePrice: this.getExtremePrice(),
          });
          continue;
        }

        // Feed price through operator to update extreme
        this.extremeOperator.feed(price);
        const extremePrice = this.getExtremePrice();

        // Update stop level based on new extreme
        this.currentLevel = this.calculateStopLevel(extremePrice);

        // Check if trailing stop was hit
        const hit = this.isStopHit(price);

        if (hit) {
          this.recordTrigger(price, time);
        }

        results.push({
          hit,
          currentLevel: this.currentLevel,
          extremePrice,
        });
      }

      return results;
    }, "calculate");
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get the current trailing stop price level.
   */
  getCurrentLevel(): number {
    return this.currentLevel;
  }

  /**
   * Get the current extreme price.
   */
  getExtremePrice(): number {
    if (this.config.direction === "LONG") {
      return (this.extremeOperator as ExpandingMaxOperator).getMax();
    }
    return (this.extremeOperator as ExpandingMinOperator).getMin();
  }

  /**
   * Get the trailing offset value in absolute terms.
   */
  getOffset(): number {
    return this.offset;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Calculate the stop level from a reference price.
   * For REL type, offset is calculated as percentage of the reference (extreme) price.
   * For ABS type, offset is a fixed dollar amount.
   */
  private calculateStopLevel(referencePrice: number): number {
    // For REL type, recalculate offset as percentage of current extreme
    // For ABS type, use the fixed offset from entry
    let effectiveOffset = this.offset;
    if (this.config.trailingOffset.type === "REL") {
      effectiveOffset = referencePrice * this.config.trailingOffset.value;
    }

    if (this.config.direction === "LONG") {
      // LONG: SL is below the reference price
      return referencePrice - effectiveOffset;
    } else {
      // SHORT: SL is above the reference price
      return referencePrice + effectiveOffset;
    }
  }

  /**
   * Check if the trailing stop was hit.
   */
  private isStopHit(price: number): boolean {
    if (this.config.direction === "LONG") {
      return price <= this.currentLevel;
    }
    return price >= this.currentLevel;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new trailing stop indicator with validation.
 */
export function createTrailingStop(
  direction: Direction,
  trailingOffset: ValueConfig
): TrailingStopIndicator {
  // Validate config
  const config = TrailingStopConfigSchema.parse({ direction, trailingOffset });
  return new TrailingStopIndicator(config);
}
