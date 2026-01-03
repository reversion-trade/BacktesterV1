/**
 * Special Indicators Type Definitions
 *
 * Special indicators are stateful objects created at trade entry and
 * destroyed at trade exit. Unlike regular indicators which are precomputed
 * for the entire dataset, special indicators:
 *
 * 1. Are created when entering a position
 * 2. Maintain internal state during the position
 * 3. Are fed price data in batches
 * 4. Output signals or values
 * 5. Are destroyed when exiting the position
 */

import type { Direction, ValueConfig } from "../../core/types.ts";

// =============================================================================
// COMMON INTERFACES
// =============================================================================

/**
 * Base interface for all special indicators.
 *
 * @template TResult - The type of result returned by calculate()
 */
export interface SpecialIndicator<TResult> {
  /**
   * Reset the indicator for a new trade.
   * Called when entering a position.
   *
   * @param entryPrice - Price at which position was opened
   * @param entryTime - Timestamp of entry (Unix seconds)
   */
  reset(entryPrice: number, entryTime: number): void;

  /**
   * Process a batch of prices.
   * Returns one result per price in the input array.
   *
   * @param prices - Array of prices at simulation resolution
   * @param times - Array of timestamps corresponding to prices
   * @returns Array of results, one per price
   */
  calculate(prices: number[], times: number[]): TResult[];

  /**
   * Check if the indicator has triggered an exit.
   */
  isTriggered(): boolean;

  /**
   * Get the price at which the trigger occurred.
   * Returns undefined if not triggered.
   */
  getTriggerPrice(): number | undefined;

  /**
   * Get the time at which the trigger occurred.
   * Returns undefined if not triggered.
   */
  getTriggerTime(): number | undefined;
}

// =============================================================================
// STOP LOSS / TAKE PROFIT TYPES
// =============================================================================

/**
 * Configuration for stop loss indicator.
 */
export interface StopLossConfig {
  /** Trade direction */
  direction: Direction;
  /** Stop loss configuration (ABS, REL, or DYN) */
  stopLoss: ValueConfig;
}

/**
 * Configuration for take profit indicator.
 */
export interface TakeProfitConfig {
  /** Trade direction */
  direction: Direction;
  /** Take profit configuration (ABS, REL, or DYN) */
  takeProfit: ValueConfig;
}

/**
 * Configuration for trailing stop indicator.
 */
export interface TrailingStopConfig {
  /** Trade direction */
  direction: Direction;
  /** Trailing offset configuration (ABS, REL, or DYN) */
  trailingOffset: ValueConfig;
}

// =============================================================================
// BALANCE INDICATOR TYPES
// =============================================================================

/**
 * Result from balance indicator calculation.
 */
export interface BalanceResult {
  /** Current portfolio value in USD */
  balance: number;
  /** Unrealized P&L in USD */
  unrealizedPnL: number;
  /** Unrealized P&L as percentage of entry value */
  unrealizedPnLPct: number;
}

/**
 * Configuration for balance indicator.
 */
export interface BalanceConfig {
  /** Trade direction */
  direction: Direction;
  /** Initial capital in USD */
  initialCapital: number;
  /** Position size configuration (ABS, REL, or DYN) */
  positionSize: ValueConfig;
  /** Trading fee in basis points */
  feeBps: number;
  /** Slippage in basis points */
  slippageBps: number;
}

/**
 * Intra-trade extremes tracked by balance indicator.
 */
export interface IntraTradeExtremes {
  /** Peak unrealized profit in USD */
  maxRunUpUSD: number;
  /** Peak unrealized profit as percentage */
  maxRunUpPct: number;
  /** Worst unrealized loss in USD (positive number) */
  maxDrawdownUSD: number;
  /** Worst unrealized loss as percentage (positive number) */
  maxDrawdownPct: number;
}

// =============================================================================
// TRIGGERED INFO
// =============================================================================

/**
 * Information about a triggered exit condition.
 */
export interface TriggerInfo {
  /** Whether the condition was triggered */
  triggered: boolean;
  /** Price at which trigger occurred */
  triggerPrice?: number;
  /** Time at which trigger occurred (Unix seconds) */
  triggerTime?: number;
}

// =============================================================================
// SPECIAL INDICATOR RESULT TYPES
// =============================================================================

/**
 * Type alias for price-level indicator results (SL, TP, Trailing).
 * Returns boolean indicating if the level was hit.
 */
export type PriceLevelResult = boolean;

/**
 * Extended result for trailing stop that includes current SL level.
 */
export interface TrailingStopResult {
  /** Whether the trailing stop was hit */
  hit: boolean;
  /** Current trailing stop price level */
  currentLevel: number;
  /** Current extreme price (high for LONG, low for SHORT) */
  extremePrice: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate the target price for a price-level indicator.
 * Supports ABS, REL, and DYN value types.
 *
 * @param entryPrice - Entry price
 * @param config - Value config (ABS, REL, or DYN)
 * @param direction - Trade direction
 * @param isStopLoss - True for SL (subtract), false for TP (add)
 * @param dynamicFactor - Optional modulation factor for DYN type (0-1 normalized)
 * @returns Target price level
 */
export function calculateTargetPrice(
  entryPrice: number,
  config: ValueConfig,
  direction: Direction,
  isStopLoss: boolean,
  dynamicFactor: number = 1
): number {
  const sign = isStopLoss
    ? direction === "LONG" ? -1 : 1
    : direction === "LONG" ? 1 : -1;

  let effectiveValue = config.value;

  // Apply dynamic modulation if DYN type
  if (config.type === "DYN") {
    const factor = config.inverted ? (1 - dynamicFactor) : dynamicFactor;
    effectiveValue = config.value * factor;
  }

  // REL and DYN are percentages, ABS is absolute value
  if (config.type === "REL" || config.type === "DYN") {
    return entryPrice * (1 + sign * effectiveValue);
  } else {
    return entryPrice + sign * effectiveValue;
  }
}

/**
 * Check if a price level was hit.
 *
 * @param price - Current price
 * @param targetPrice - Target price level
 * @param direction - Trade direction
 * @param isStopLoss - True for SL, false for TP
 * @returns True if level was hit
 */
export function isPriceLevelHit(
  price: number,
  targetPrice: number,
  direction: Direction,
  isStopLoss: boolean
): boolean {
  if (isStopLoss) {
    // SL hit when price moves against position
    return direction === "LONG" ? price <= targetPrice : price >= targetPrice;
  } else {
    // TP hit when price moves in favor of position
    return direction === "LONG" ? price >= targetPrice : price <= targetPrice;
  }
}
