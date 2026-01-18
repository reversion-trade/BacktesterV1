/** Balance Indicator - Tracks portfolio value during a position (unrealized P&L, run-up, drawdown). Non-triggering. */

import type { Direction, ValueConfig } from "../../core/types.ts";
import { bpsToDecimal } from "../../core/constants.ts";
import { BaseSpecialIndicator, BalanceConfigSchema } from "./base.ts";
import type { BalanceResult, IntraTradeExtremes, BalanceConfig } from "./types.ts";
import { ExpandingRangeOperator } from "./operators.ts";

export type { BalanceConfig };

export class BalanceIndicator extends BaseSpecialIndicator<BalanceConfig, BalanceResult> {
    private readonly pnlRangeOperator: ExpandingRangeOperator;
    private effectiveEntryPrice: number = 0;
    private positionSizeUSD: number = 0;
    private positionSizeAsset: number = 0;
    private entryFeeUSD: number = 0;
    private valueAfterEntry: number = 0;

    constructor(config: BalanceConfig) {
        super(config);
        this.pnlRangeOperator = new ExpandingRangeOperator();
    }

    protected onReset(): void {
        const slippageRate = bpsToDecimal(this.config.slippageBps);
        const feeRate = bpsToDecimal(this.config.feeBps);

        if (this.config.direction === "LONG") {                                    // Apply slippage: LONG pays more, SHORT receives less
            this.effectiveEntryPrice = this.entryPrice * (1 + slippageRate);
        } else {
            this.effectiveEntryPrice = this.entryPrice * (1 - slippageRate);
        }

        if (this.config.positionSize.type === "REL") {                             // Calculate position size in USD
            this.positionSizeUSD = this.config.initialCapital * this.config.positionSize.value;
        } else {
            this.positionSizeUSD = this.config.positionSize.value;
        }

        this.positionSizeUSD = Math.min(this.positionSizeUSD, this.config.initialCapital);  // Cap at available capital
        this.positionSizeAsset = this.positionSizeUSD / this.effectiveEntryPrice;
        this.entryFeeUSD = this.positionSizeUSD * feeRate;
        this.valueAfterEntry = this.config.initialCapital - this.entryFeeUSD;
        this.pnlRangeOperator.resetWithValue(0);
    }

    calculate(prices: number[], _times: number[]): BalanceResult[] {
        return this.withErrorHandling(() => {
            const results: BalanceResult[] = [];
            for (const price of prices) {
                const unrealizedPnL = this.calculateUnrealizedPnL(price);
                const unrealizedPnLPct = unrealizedPnL / this.positionSizeUSD;
                const balance = this.valueAfterEntry + unrealizedPnL;
                this.pnlRangeOperator.feed(unrealizedPnL);
                results.push({ balance, unrealizedPnL, unrealizedPnLPct });
            }
            return results;
        }, "calculate");
    }

    override isTriggered(): boolean { return false; }                              // Balance indicator never triggers

    getEffectiveEntryPrice(): number { return this.effectiveEntryPrice; }
    getPositionSizeUSD(): number { return this.positionSizeUSD; }
    getPositionSizeAsset(): number { return this.positionSizeAsset; }
    getEntryFeeUSD(): number { return this.entryFeeUSD; }
    getValueAfterEntry(): number { return this.valueAfterEntry; }

    getExtremes(): IntraTradeExtremes {                                            // Get intra-trade max run-up and drawdown
        const maxPnL = this.pnlRangeOperator.getMax();
        const minPnL = this.pnlRangeOperator.getMin();
        return {
            maxRunUpUSD: Math.max(0, maxPnL),
            maxRunUpPct: Math.max(0, maxPnL / this.positionSizeUSD),
            maxDrawdownUSD: Math.max(0, -minPnL),
            maxDrawdownPct: Math.max(0, -minPnL / this.positionSizeUSD),
        };
    }

    calculateExitFee(exitPrice: number): number {
        const feeRate = bpsToDecimal(this.config.feeBps);
        return this.positionSizeAsset * exitPrice * feeRate;
    }

    calculateEffectiveExitPrice(exitPrice: number): number {                       // LONG sells lower (slips down), SHORT buys back higher (slips up)
        const slippageRate = bpsToDecimal(this.config.slippageBps);
        return this.config.direction === "LONG" ? exitPrice * (1 - slippageRate) : exitPrice * (1 + slippageRate);
    }

    calculateRealizedPnL(exitPrice: number): number {                              // Final P&L after exit (includes entry + exit fees)
        const effectiveExitPrice = this.calculateEffectiveExitPrice(exitPrice);
        const exitFeeUSD = this.calculateExitFee(effectiveExitPrice);
        const grossPnL = this.config.direction === "LONG"
            ? this.positionSizeAsset * (effectiveExitPrice - this.effectiveEntryPrice)
            : this.positionSizeAsset * (this.effectiveEntryPrice - effectiveExitPrice);
        return grossPnL - this.entryFeeUSD - exitFeeUSD;
    }

    private calculateUnrealizedPnL(currentPrice: number): number {
        return this.config.direction === "LONG"
            ? this.positionSizeAsset * (currentPrice - this.effectiveEntryPrice)
            : this.positionSizeAsset * (this.effectiveEntryPrice - currentPrice);
    }
}

export function createBalance(config: BalanceConfig): BalanceIndicator {
    return new BalanceIndicator(BalanceConfigSchema.parse(config));
}

export function createBalanceWithDefaults(direction: Direction, initialCapital: number, positionSize: ValueConfig, feeBps: number = 10, slippageBps: number = 10): BalanceIndicator {
    return createBalance({ direction, initialCapital, positionSize, feeBps, slippageBps });
}
