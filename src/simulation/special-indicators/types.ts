/** Special Indicators Types - Stateful per-trade indicators created at entry, fed price data, destroyed at exit. */

import type { Direction, ValueConfig } from "../../core/types.ts";

export interface StopLossConfig {
    direction: Direction;
    stopLoss: ValueConfig;                                                        // ABS, REL, or DYN
    trailing?: boolean;                                                           // When true, SL ratchets with favorable price movement
    [key: string]: unknown;
}

export interface TakeProfitConfig {
    direction: Direction;
    takeProfit: ValueConfig;                                                      // ABS, REL, or DYN
    [key: string]: unknown;
}

/** @deprecated Use StopLossConfig with trailing=true instead */
export interface TrailingStopConfig {
    direction: Direction;
    trailingOffset: ValueConfig;                                                  // ABS, REL, or DYN
    [key: string]: unknown;
}

export interface BalanceConfig {
    direction: Direction;
    initialCapital: number;                                                       // USD
    positionSize: ValueConfig;                                                    // ABS, REL, or DYN
    feeBps: number;                                                               // Trading fee in basis points
    slippageBps: number;                                                          // Slippage in basis points
    [key: string]: unknown;
}

export interface BalanceResult {
    balance: number;                                                              // Current portfolio value in USD
    unrealizedPnL: number;                                                        // Unrealized P&L in USD
    unrealizedPnLPct: number;                                                     // Unrealized P&L as % of entry
}

export interface IntraTradeExtremes {
    maxRunUpUSD: number;                                                          // Peak unrealized profit USD
    maxRunUpPct: number;                                                          // Peak unrealized profit %
    maxDrawdownUSD: number;                                                       // Worst unrealized loss USD (positive)
    maxDrawdownPct: number;                                                       // Worst unrealized loss % (positive)
}

export interface StopLossResult {
    hit: boolean;                                                                 // Whether stop loss was hit
    currentLevel: number;                                                         // Current stop loss price level
    extremePrice?: number;                                                        // Current extreme price (only for trailing)
}

export type PriceLevelResult = boolean;                                           // Simple SL/TP hit indicator (legacy)

/** @deprecated Use StopLossResult instead */
export interface TrailingStopResult {
    hit: boolean;                                                                 // Whether trailing stop was hit
    currentLevel: number;                                                         // Current trailing stop price level
    extremePrice: number;                                                         // Current extreme (high for LONG, low for SHORT)
}

/** Calculate target price for SL/TP. Supports ABS, REL, DYN value types. */
export function calculateTargetPrice(
    entryPrice: number,
    config: ValueConfig,
    direction: Direction,
    isStopLoss: boolean,                                                          // true for SL (subtract), false for TP (add)
    dynamicFactor: number = 1                                                     // Modulation factor for DYN type (0-1 normalized)
): number {
    const sign = isStopLoss ? (direction === "LONG" ? -1 : 1) : direction === "LONG" ? 1 : -1;
    let effectiveValue = config.value;

    if (config.type === "DYN") {                                                  // Apply dynamic modulation
        const factor = config.inverted ? 1 - dynamicFactor : dynamicFactor;
        effectiveValue = config.value * factor;
    }

    return config.type === "REL" || config.type === "DYN"
        ? entryPrice * (1 + sign * effectiveValue)                                // REL/DYN: percentage
        : entryPrice + sign * effectiveValue;                                     // ABS: absolute value
}

/** Check if price level was hit. */
export function isPriceLevelHit(price: number, targetPrice: number, direction: Direction, isStopLoss: boolean): boolean {
    if (isStopLoss) {                                                             // SL hit when price moves against position
        return direction === "LONG" ? price <= targetPrice : price >= targetPrice;
    }
    return direction === "LONG" ? price >= targetPrice : price <= targetPrice;    // TP hit when price moves in favor
}
