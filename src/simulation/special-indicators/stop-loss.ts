/**
 * Stop Loss Indicator
 *
 * Fixed stop loss that triggers when price moves against the position
 * by a specified amount (absolute or relative).
 *
 * For LONG: triggers when price <= entry - offset
 * For SHORT: triggers when price >= entry + offset
 */

import type { Direction, ValueConfig } from "../../core/types.ts";
import {
  BaseSpecialIndicator,
  StopLossConfigSchema,
} from "./base.ts";
import type { PriceLevelResult } from "./types.ts";
import { isPriceLevelHit } from "./types.ts";

// =============================================================================
// CONFIG TYPE
// =============================================================================

/**
 * Configuration for stop loss indicator.
 */
export interface StopLossConfig {
  direction: Direction;
  stopLoss: ValueConfig;
}

// =============================================================================
// STOP LOSS INDICATOR
// =============================================================================

/**
 * Stop loss indicator that monitors price for stop loss hits.
 * Extends BaseSpecialIndicator for shared functionality.
 *
 * @example
 * const sl = new StopLossIndicator({
 *   direction: "LONG",
 *   stopLoss: { type: "REL", value: 0.02 }, // 2% stop loss
 * });
 *
 * sl.reset(50000, 1704067200); // Entry at $50,000
 * // SL level = $49,000 (2% below entry)
 *
 * const results = sl.calculate([49500, 49200, 48900], [t1, t2, t3]);
 * // results = [false, false, true] - triggered at $48,900
 *
 * sl.isTriggered(); // true
 * sl.getTriggerPrice(); // 48900
 */
export class StopLossIndicator extends BaseSpecialIndicator<
  StopLossConfig,
  PriceLevelResult
> {
  // Calculated price level
  private stopLossPrice: number = 0;

  constructor(config: StopLossConfig) {
    super(config);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Reset for a new trade.
   * Calculates the stop loss price level based on entry price and config.
   */
  protected onReset(): void {
    const offset = this.calculateOffset(this.config.stopLoss);

    // Calculate SL price level
    if (this.config.direction === "LONG") {
      // LONG: SL below entry
      this.stopLossPrice = this.entryPrice - offset;
    } else {
      // SHORT: SL above entry
      this.stopLossPrice = this.entryPrice + offset;
    }
  }

  // ---------------------------------------------------------------------------
  // Core Logic
  // ---------------------------------------------------------------------------

  /**
   * Process a batch of prices and check for stop loss hits.
   * Once triggered, all subsequent prices also return true.
   */
  calculate(prices: number[], times: number[]): PriceLevelResult[] {
    return this.withErrorHandling(() => {
      const results: PriceLevelResult[] = [];

      for (let i = 0; i < prices.length; i++) {
        const price = prices[i]!;
        const time = times[i]!;

        // If already triggered, all subsequent results are true
        if (this.triggered) {
          results.push(true);
          continue;
        }

        // Check if this price hits the stop loss
        const hit = isPriceLevelHit(
          price,
          this.stopLossPrice,
          this.config.direction,
          true // isStopLoss
        );

        if (hit) {
          this.recordTrigger(price, time);
        }

        results.push(hit);
      }

      return results;
    }, "calculate");
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get the current stop loss price level.
   */
  getStopLossPrice(): number {
    return this.stopLossPrice;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new stop loss indicator with validation.
 */
export function createStopLoss(
  direction: Direction,
  stopLoss: ValueConfig
): StopLossIndicator {
  const config = StopLossConfigSchema.parse({ direction, stopLoss });
  return new StopLossIndicator(config);
}
