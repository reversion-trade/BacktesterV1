/**
 * Executor Interface
 *
 * @module interfaces/executor
 * @description
 * Defines the interface for trade execution.
 * Implementations:
 * - FakeExecutor: Simulates execution for backtesting
 * - RealExecutor: Connects to exchange APIs for live trading
 *
 * @architecture
 * This interface enables the algo class to execute trades without
 * knowing whether it's in a backtest or live environment. The algo
 * class should have NO conditional logic like 'if is_backtesting:
 * do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Abstract trade execution for live/backtest parity
 */

import type { Direction } from "../core/types.ts";

// =============================================================================
// ORDER TYPES
// =============================================================================

/**
 * Request to place an order.
 */
export interface OrderRequest {
  /** Unique client-generated order ID */
  clientOrderId: string;
  /** Asset symbol (e.g., "BTC", "ETH") */
  symbol: string;
  /** Order side */
  side: "BUY" | "SELL";
  /** Order type */
  type: "MARKET" | "LIMIT" | "TWAP" | "SMART";
  /** Order amount in USD (for market orders) */
  amountUSD?: number;
  /** Order amount in asset units */
  amountAsset?: number;
  /** Limit price (required for LIMIT orders) */
  limitPrice?: number;
  /** Time-in-force (optional) */
  timeInForce?: "GTC" | "IOC" | "FOK";
}

/**
 * Result of an order execution.
 */
export interface OrderResult {
  /** Exchange order ID */
  orderId: string;
  /** Client order ID (from request) */
  clientOrderId: string;
  /** Order status */
  status: "FILLED" | "PARTIALLY_FILLED" | "REJECTED" | "PENDING";
  /** Filled amount in asset units */
  filledAmount: number;
  /** Average fill price */
  avgPrice: number;
  /** Total value in USD */
  totalValueUSD: number;
  /** Fee paid in USD */
  feeUSD: number;
  /** Slippage incurred in USD */
  slippageUSD: number;
  /** Execution timestamp */
  timestamp: number;
  /** Rejection reason (if rejected) */
  rejectReason?: string;
}

/**
 * An open order.
 */
export interface OpenOrder {
  /** Exchange order ID */
  orderId: string;
  /** Client order ID */
  clientOrderId: string;
  /** Asset symbol */
  symbol: string;
  /** Order side */
  side: "BUY" | "SELL";
  /** Order type */
  type: "MARKET" | "LIMIT" | "TWAP" | "SMART";
  /** Order status */
  status: "PENDING" | "PARTIALLY_FILLED";
  /** Original order amount in asset units */
  originalAmount: number;
  /** Remaining amount to fill */
  remainingAmount: number;
  /** Limit price (for limit orders) */
  limitPrice?: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Current position information.
 */
export interface Position {
  /** Asset symbol */
  symbol: string;
  /** Position direction */
  direction: Direction;
  /** Entry price (average) */
  entryPrice: number;
  /** Position size in asset units */
  size: number;
  /** Position size in USD (at entry) */
  sizeUSD: number;
  /** Unrealized P&L in USD */
  unrealizedPnlUSD: number;
  /** Entry timestamp */
  entryTime: number;
  /** Associated trade ID (for backtest tracking) */
  tradeId?: number;
}

// =============================================================================
// EXECUTOR INTERFACE
// =============================================================================

/**
 * Interface for trade execution.
 *
 * Abstracts the execution layer so the algo class can work
 * identically in backtest and live environments.
 *
 * @example
 * ```typescript
 * // Algo class uses executor without knowing environment
 * async onSignal(signal: EntrySignal) {
 *   const result = await this.executor.placeOrder({
 *     clientOrderId: uuid(),
 *     symbol: "BTC",
 *     side: "BUY",
 *     type: "MARKET",
 *     amountUSD: 1000,
 *   });
 *
 *   if (result.status === "FILLED") {
 *     // Handle fill
 *   }
 * }
 * ```
 */
export interface IExecutor {
  /**
   * Place an order.
   *
   * @param order - Order request
   * @returns Order execution result
   */
  placeOrder(order: OrderRequest): Promise<OrderResult>;

  /**
   * Cancel an open order.
   *
   * @param orderId - Exchange order ID to cancel
   * @returns True if cancelled, false if already filled/cancelled
   */
  cancelOrder(orderId: string): Promise<boolean>;

  /**
   * Get all open orders.
   *
   * @param symbol - Optional filter by symbol
   * @returns Array of open orders
   */
  getOpenOrders(symbol?: string): Promise<OpenOrder[]>;

  /**
   * Get current position.
   *
   * @param symbol - Asset symbol
   * @returns Position or null if flat
   */
  getPosition(symbol: string): Promise<Position | null>;

  /**
   * Get current price for a symbol.
   *
   * @param symbol - Asset symbol
   * @returns Current price
   */
  getCurrentPrice(symbol: string): Promise<number>;

  /**
   * Get account balance.
   *
   * @returns Available USD balance
   */
  getBalance(): Promise<number>;
}
