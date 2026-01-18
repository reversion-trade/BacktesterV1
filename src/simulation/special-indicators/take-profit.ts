/** Take Profit Indicator - Fixed TP that triggers when price moves in favor of position by specified offset. LONG: price >= entry + offset, SHORT: price <= entry - offset. */

import type { Direction, ValueConfig } from "../../core/types.ts";
import { BaseSpecialIndicator, TakeProfitConfigSchema } from "./base.ts";
import type { PriceLevelResult, TakeProfitConfig } from "./types.ts";
import { isPriceLevelHit } from "./types.ts";

export type { TakeProfitConfig };

export class TakeProfitIndicator extends BaseSpecialIndicator<TakeProfitConfig, PriceLevelResult> {
    private takeProfitPrice: number = 0;

    constructor(config: TakeProfitConfig) { super(config); }

    protected onReset(): void { this.recalculatePriceLevel(); }

    protected override onDynamicFactorUpdate(): void { this.recalculatePriceLevel(); }  // Called when dynamicFactor updated mid-position

    private recalculatePriceLevel(): void {
        const offset = this.calculateOffset(this.config.takeProfit);
        this.takeProfitPrice = this.config.direction === "LONG"
            ? this.entryPrice + offset                                            // LONG: TP above entry
            : this.entryPrice - offset;                                           // SHORT: TP below entry
    }

    calculate(prices: number[], times: number[]): PriceLevelResult[] {
        return this.withErrorHandling(() => {
            const results: PriceLevelResult[] = [];
            for (let i = 0; i < prices.length; i++) {
                const price = prices[i]!;
                const time = times[i]!;

                if (this.triggered) {                                             // Already triggered - all subsequent true
                    results.push(true);
                    continue;
                }

                const hit = isPriceLevelHit(price, this.takeProfitPrice, this.config.direction, false);
                if (hit) this.recordTrigger(price, time);
                results.push(hit);
            }
            return results;
        }, "calculate");
    }

    getTakeProfitPrice(): number { return this.takeProfitPrice; }
}

export function createTakeProfit(direction: Direction, takeProfit: ValueConfig): TakeProfitIndicator {
    return new TakeProfitIndicator(TakeProfitConfigSchema.parse({ direction, takeProfit }));
}
