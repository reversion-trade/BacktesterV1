/**
 * Balance Indicator
 *
 * Tracks portfolio value during a position, including:
 * - Unrealized P&L (USD and percentage)
 * - Balance after entry costs (slippage + fees)
 * - Intra-trade run-up and drawdown
 *
 * This is a non-triggering indicator (isTriggered always returns false).
 * It exists to provide balance data at every simulation point for:
 * - Equity curve construction
 * - Drawdown tracking
 * - Position analytics
 *
 * Uses ExpandingRangeOperator to efficiently track intra-trade P&L extremes.
 */

import type { Direction, ValueConfig } from "../../core/types.ts";
import { bpsToDecimal } from "../../core/constants.ts";
import { BaseSpecialIndicator, BalanceConfigSchema } from "./base.ts";
import type { BalanceResult, IntraTradeExtremes, BalanceConfig } from "./types.ts";

import { ExpandingRangeOperator } from "./operators.ts";

export type { BalanceConfig };

// =============================================================================
// BALANCE INDICATOR
// =============================================================================

/**
 * Balance indicator that tracks portfolio value during a position.
 * Extends BaseSpecialIndicator but never triggers (tracking-only).
 *
 * @example
 * const balance = new BalanceIndicator({
 *   direction: "LONG",
 *   initialCapital: 10000,
 *   positionSize: { type: "REL", value: 1.0 }, // 100% of capital
 *   feeBps: 10,     // 0.1% fee
 *   slippageBps: 10 // 0.1% slippage
 * });
 *
 * balance.reset(50000, 1704067200); // Entry at $50,000
 *
 * const results = balance.calculate([51000, 52000, 51500], [t1, t2, t3]);
 * // results[0] = { balance: ~10180, unrealizedPnL: ~200, unrealizedPnLPct: ~2% }
 */
export class BalanceIndicator extends BaseSpecialIndicator<BalanceConfig, BalanceResult> {
    // Expanding operator for tracking P&L extremes
    private readonly pnlRangeOperator: ExpandingRangeOperator;

    // Entry state (calculated on reset)
    private effectiveEntryPrice: number = 0;
    private positionSizeUSD: number = 0;
    private positionSizeAsset: number = 0;
    private entryFeeUSD: number = 0;
    private valueAfterEntry: number = 0;

    constructor(config: BalanceConfig) {
        super(config);
        this.pnlRangeOperator = new ExpandingRangeOperator();
    }

    // ---------------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------------

    /**
     * Reset for a new trade.
     * Calculates entry costs and initial position.
     */
    protected onReset(): void {
        const slippageRate = bpsToDecimal(this.config.slippageBps);
        const feeRate = bpsToDecimal(this.config.feeBps);

        // Apply slippage to entry price
        // LONG: we pay more (price slips up)
        // SHORT: we receive less (price slips down)
        if (this.config.direction === "LONG") {
            this.effectiveEntryPrice = this.entryPrice * (1 + slippageRate);
        } else {
            this.effectiveEntryPrice = this.entryPrice * (1 - slippageRate);
        }

        // Calculate position size in USD
        if (this.config.positionSize.type === "REL") {
            this.positionSizeUSD = this.config.initialCapital * this.config.positionSize.value;
        } else {
            this.positionSizeUSD = this.config.positionSize.value;
        }

        // Cap position size at available capital
        this.positionSizeUSD = Math.min(this.positionSizeUSD, this.config.initialCapital);

        // Calculate position size in asset units
        this.positionSizeAsset = this.positionSizeUSD / this.effectiveEntryPrice;

        // Calculate entry fee (on position value)
        this.entryFeeUSD = this.positionSizeUSD * feeRate;

        // Value after entry = initial capital - entry fee
        this.valueAfterEntry = this.config.initialCapital - this.entryFeeUSD;

        // Reset P&L range operator
        this.pnlRangeOperator.resetWithValue(0);
    }

    // ---------------------------------------------------------------------------
    // Core Logic
    // ---------------------------------------------------------------------------

    /**
     * Process a batch of prices and calculate balance at each point.
     */
    calculate(prices: number[], _times: number[]): BalanceResult[] {
        return this.withErrorHandling(() => {
            const results: BalanceResult[] = [];

            for (const price of prices) {
                // Calculate unrealized P&L
                const unrealizedPnL = this.calculateUnrealizedPnL(price);
                const unrealizedPnLPct = unrealizedPnL / this.positionSizeUSD;

                // Current balance = value after entry + unrealized P&L
                const balance = this.valueAfterEntry + unrealizedPnL;

                // Track extremes using operator
                this.pnlRangeOperator.feed(unrealizedPnL);

                results.push({
                    balance,
                    unrealizedPnL,
                    unrealizedPnLPct,
                });
            }

            return results;
        }, "calculate");
    }

    /**
     * Balance indicator never triggers.
     */
    override isTriggered(): boolean {
        return false;
    }

    // ---------------------------------------------------------------------------
    // Accessors
    // ---------------------------------------------------------------------------

    /**
     * Get the effective entry price (after slippage).
     */
    getEffectiveEntryPrice(): number {
        return this.effectiveEntryPrice;
    }

    /**
     * Get the position size in USD.
     */
    getPositionSizeUSD(): number {
        return this.positionSizeUSD;
    }

    /**
     * Get the position size in asset units.
     */
    getPositionSizeAsset(): number {
        return this.positionSizeAsset;
    }

    /**
     * Get the entry fee paid in USD.
     */
    getEntryFeeUSD(): number {
        return this.entryFeeUSD;
    }

    /**
     * Get the value after entry (initial capital - entry fee).
     */
    getValueAfterEntry(): number {
        return this.valueAfterEntry;
    }

    /**
     * Get the intra-trade extremes (max run-up and drawdown).
     * Uses expanding range operator for efficient tracking.
     */
    getExtremes(): IntraTradeExtremes {
        const maxPnL = this.pnlRangeOperator.getMax();
        const minPnL = this.pnlRangeOperator.getMin();

        return {
            maxRunUpUSD: Math.max(0, maxPnL),
            maxRunUpPct: Math.max(0, maxPnL / this.positionSizeUSD),
            maxDrawdownUSD: Math.max(0, -minPnL),
            maxDrawdownPct: Math.max(0, -minPnL / this.positionSizeUSD),
        };
    }

    /**
     * Calculate the exit fee for a given exit price.
     */
    calculateExitFee(exitPrice: number): number {
        const feeRate = bpsToDecimal(this.config.feeBps);
        const exitValue = this.positionSizeAsset * exitPrice;
        return exitValue * feeRate;
    }

    /**
     * Calculate the effective exit price (after slippage).
     */
    calculateEffectiveExitPrice(exitPrice: number): number {
        const slippageRate = bpsToDecimal(this.config.slippageBps);

        // LONG: we sell lower (price slips down)
        // SHORT: we buy back higher (price slips up)
        if (this.config.direction === "LONG") {
            return exitPrice * (1 - slippageRate);
        } else {
            return exitPrice * (1 + slippageRate);
        }
    }

    /**
     * Calculate final realized P&L after exit.
     * Includes both entry and exit fees.
     */
    calculateRealizedPnL(exitPrice: number): number {
        const effectiveExitPrice = this.calculateEffectiveExitPrice(exitPrice);
        const exitFeeUSD = this.calculateExitFee(effectiveExitPrice);

        // Gross P&L from position
        let grossPnL: number;
        if (this.config.direction === "LONG") {
            grossPnL = this.positionSizeAsset * (effectiveExitPrice - this.effectiveEntryPrice);
        } else {
            grossPnL = this.positionSizeAsset * (this.effectiveEntryPrice - effectiveExitPrice);
        }

        // Net P&L = gross - entry fee - exit fee
        return grossPnL - this.entryFeeUSD - exitFeeUSD;
    }

    // ---------------------------------------------------------------------------
    // Private Methods
    // ---------------------------------------------------------------------------

    /**
     * Calculate unrealized P&L at a given price.
     */
    private calculateUnrealizedPnL(currentPrice: number): number {
        if (this.config.direction === "LONG") {
            return this.positionSizeAsset * (currentPrice - this.effectiveEntryPrice);
        } else {
            return this.positionSizeAsset * (this.effectiveEntryPrice - currentPrice);
        }
    }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new balance indicator with validation.
 */
export function createBalance(config: BalanceConfig): BalanceIndicator {
    const validated = BalanceConfigSchema.parse(config);
    return new BalanceIndicator(validated);
}

/**
 * Create a balance indicator with common defaults.
 */
export function createBalanceWithDefaults(
    direction: Direction,
    initialCapital: number,
    positionSize: ValueConfig,
    feeBps: number = 10,
    slippageBps: number = 10
): BalanceIndicator {
    return createBalance({
        direction,
        initialCapital,
        positionSize,
        feeBps,
        slippageBps,
    });
}
