/**
 * Take Profit Indicator
 *
 * Fixed take profit that triggers when price moves in favor of the position
 * by a specified amount (absolute or relative).
 *
 * For LONG: triggers when price >= entry + offset
 * For SHORT: triggers when price <= entry - offset
 */

import type { Direction, ValueConfig } from "../../core/types.ts";
import { BaseSpecialIndicator, TakeProfitConfigSchema } from "./base.ts";
import type { PriceLevelResult, TakeProfitConfig } from "./types.ts";
import { isPriceLevelHit } from "./types.ts";

export type { TakeProfitConfig };

// =============================================================================
// TAKE PROFIT INDICATOR
// =============================================================================

/**
 * Take profit indicator that monitors price for take profit hits.
 * Extends BaseSpecialIndicator for shared functionality.
 *
 * @example
 * const tp = new TakeProfitIndicator({
 *   direction: "LONG",
 *   takeProfit: { type: "REL", value: 0.05 }, // 5% take profit
 * });
 *
 * tp.reset(50000, 1704067200); // Entry at $50,000
 * // TP level = $52,500 (5% above entry)
 *
 * const results = tp.calculate([51000, 52000, 53000], [t1, t2, t3]);
 * // results = [false, false, true] - triggered at $53,000
 *
 * tp.isTriggered(); // true
 * tp.getTriggerPrice(); // 53000
 */
export class TakeProfitIndicator extends BaseSpecialIndicator<TakeProfitConfig, PriceLevelResult> {
    // Calculated price level
    private takeProfitPrice: number = 0;

    constructor(config: TakeProfitConfig) {
        super(config);
    }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    /**
     * Reset for a new trade.
     * Calculates the take profit price level based on entry price and config.
     */
    protected onReset(): void {
        this.recalculatePriceLevel();
    }

    /**
     * Called when dynamicFactor is updated mid-position (sub-bar recalculation).
     * Recalculates the TP level using the new dynamicFactor.
     */
    protected override onDynamicFactorUpdate(): void {
        this.recalculatePriceLevel();
    }

    /**
     * Calculate the take profit price level based on current entry price and dynamicFactor.
     * Called by both onReset() and onDynamicFactorUpdate().
     */
    private recalculatePriceLevel(): void {
        const offset = this.calculateOffset(this.config.takeProfit);

        // Calculate TP price level
        if (this.config.direction === "LONG") {
            // LONG: TP above entry
            this.takeProfitPrice = this.entryPrice + offset;
        } else {
            // SHORT: TP below entry
            this.takeProfitPrice = this.entryPrice - offset;
        }
    }

    // ---------------------------------------------------------------------------
    // Core Logic
    // ---------------------------------------------------------------------------

    /**
     * Process a batch of prices and check for take profit hits.
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

                // Check if this price hits the take profit
                const hit = isPriceLevelHit(
                    price,
                    this.takeProfitPrice,
                    this.config.direction,
                    false // isStopLoss = false means take profit
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
     * Get the current take profit price level.
     */
    getTakeProfitPrice(): number {
        return this.takeProfitPrice;
    }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new take profit indicator with validation.
 */
export function createTakeProfit(direction: Direction, takeProfit: ValueConfig): TakeProfitIndicator {
    const config = TakeProfitConfigSchema.parse({ direction, takeProfit });
    return new TakeProfitIndicator(config);
}
