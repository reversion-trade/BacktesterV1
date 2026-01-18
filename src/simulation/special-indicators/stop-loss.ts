/** Stop Loss Indicator - Unified SL supporting both fixed and trailing modes. Fixed: triggers at entry ± offset. Trailing: ratchets with favorable price movement. */

import type { Direction, ValueConfig } from "../../core/types.ts";
import { BaseSpecialIndicator, StopLossConfigSchema } from "./base.ts";
import type { StopLossResult, StopLossConfig } from "./types.ts";
import { ExpandingMaxOperator, ExpandingMinOperator } from "./operators.ts";

export type { StopLossConfig };

export class StopLossIndicator extends BaseSpecialIndicator<StopLossConfig, StopLossResult> {
    private stopLossPrice: number = 0;
    private extremeOperator: ExpandingMaxOperator | ExpandingMinOperator | null = null; // Only for trailing mode
    private extremePrice: number = 0;

    constructor(config: StopLossConfig) {
        super(config);
        if (config.trailing) {                                                    // Initialize extreme tracker for trailing mode
            this.extremeOperator = config.direction === "LONG" ? new ExpandingMaxOperator() : new ExpandingMinOperator();
        }
    }

    protected onReset(): void {
        if (this.config.trailing && this.extremeOperator) {                       // Trailing: initialize extreme with entry price
            if (this.config.direction === "LONG") {
                (this.extremeOperator as ExpandingMaxOperator).resetWithValue(this.entryPrice);
            } else {
                (this.extremeOperator as ExpandingMinOperator).resetWithValue(this.entryPrice);
            }
            this.extremePrice = this.entryPrice;
        }
        this.recalculatePriceLevel();
    }

    protected override onDynamicFactorUpdate(): void { this.recalculatePriceLevel(); }

    private recalculatePriceLevel(): void {
        const referencePrice = this.config.trailing ? this.extremePrice : this.entryPrice;
        const offset = this.config.trailing && this.config.stopLoss.type === "REL"
            ? referencePrice * this.config.stopLoss.value                         // Trailing REL: % of extreme price
            : this.calculateOffset(this.config.stopLoss);                         // Fixed: % of entry price
        this.stopLossPrice = this.config.direction === "LONG"
            ? referencePrice - offset                                             // LONG: SL below reference
            : referencePrice + offset;                                            // SHORT: SL above reference
    }

    calculate(prices: number[], times: number[]): StopLossResult[] {
        return this.withErrorHandling(() => {
            const results: StopLossResult[] = [];
            for (let i = 0; i < prices.length; i++) {
                const price = prices[i]!;
                const time = times[i]!;

                if (this.triggered) {                                             // Already triggered - return current state
                    results.push({ hit: true, currentLevel: this.stopLossPrice, extremePrice: this.config.trailing ? this.extremePrice : undefined });
                    continue;
                }

                if (this.config.trailing && this.extremeOperator) {               // Update extreme and ratchet stop level
                    this.extremeOperator.feed(price);
                    this.extremePrice = this.config.direction === "LONG"
                        ? (this.extremeOperator as ExpandingMaxOperator).getMax()
                        : (this.extremeOperator as ExpandingMinOperator).getMin();
                    this.recalculatePriceLevel();                                 // Ratchet stop to new extreme
                }

                const hit = this.config.direction === "LONG" ? price <= this.stopLossPrice : price >= this.stopLossPrice;
                if (hit) this.recordTrigger(price, time);
                results.push({ hit, currentLevel: this.stopLossPrice, extremePrice: this.config.trailing ? this.extremePrice : undefined });
            }
            return results;
        }, "calculate");
    }

    getStopLossPrice(): number { return this.stopLossPrice; }
    getExtremePrice(): number { return this.extremePrice; }
    isTrailing(): boolean { return this.config.trailing ?? false; }
}

export function createStopLoss(direction: Direction, stopLoss: ValueConfig, trailing: boolean = false): StopLossIndicator {
    return new StopLossIndicator(StopLossConfigSchema.parse({ direction, stopLoss, trailing }));
}
