/**
 * Fake Executor for Backtesting
 *
 * @module simulation/fakes/fake-executor
 * @description
 * Implements IExecutor for backtesting by simulating order execution
 * using historical price data. Records SwapEvents for analysis.
 *
 * @architecture
 * This is the backtest implementation of IExecutor. It:
 * - Simulates order fills at current price with slippage/fees
 * - Maintains virtual position state
 * - Records all executions as SwapEvents
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Simulate trade execution for backtesting
 */

import type { Direction } from "../../core/types.ts";
import type { SwapEvent } from "../../events/types.ts";
import type {
  IExecutor,
  OrderRequest,
  OrderResult,
  OpenOrder,
  Position,
} from "../../interfaces/executor.ts";

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration for the fake executor.
 */
export interface FakeExecutorConfig {
  /** Starting capital in USD */
  initialCapitalUSD: number;
  /** Fee in basis points (e.g., 10 = 0.1%) */
  feeBps: number;
  /** Slippage in basis points (e.g., 5 = 0.05%) */
  slippageBps: number;
  /** Asset symbol (e.g., "BTC") */
  symbol: string;
}

// =============================================================================
// FAKE EXECUTOR IMPLEMENTATION
// =============================================================================

/**
 * Fake executor that simulates order execution for backtesting.
 *
 * @example
 * ```typescript
 * const executor = new FakeExecutor({
 *   initialCapitalUSD: 10000,
 *   feeBps: 10,
 *   slippageBps: 5,
 *   symbol: "BTC",
 * });
 *
 * // Set price for current bar
 * executor.setCurrentPrice(50000);
 * executor.setCurrentBar(100, 1704067200);
 *
 * // Simulate order
 * const result = await executor.placeOrder({
 *   clientOrderId: "order-1",
 *   symbol: "BTC",
 *   side: "BUY",
 *   type: "MARKET",
 *   amountUSD: 1000,
 * });
 * ```
 */
export class FakeExecutor implements IExecutor {
  private config: FakeExecutorConfig;
  private capitalUSD: number;
  private currentPrice: number = 0;
  private currentBarIndex: number = 0;
  private currentTimestamp: number = 0;
  private position: Position | null = null;
  private orderIdCounter: number = 0;
  private swapEvents: SwapEvent[] = [];
  private swapIdCounter: number = 0;

  constructor(config: FakeExecutorConfig) {
    this.config = config;
    this.capitalUSD = config.initialCapitalUSD;
  }

  // ===========================================================================
  // SIMULATION CONTROL (Backtest-specific)
  // ===========================================================================

  /**
   * Set the current price for order simulation.
   * Called by the simulation loop before processing each bar.
   */
  setCurrentPrice(price: number): void {
    this.currentPrice = price;
  }

  /**
   * Set the current bar context.
   * Called by the simulation loop before processing each bar.
   */
  setCurrentBar(barIndex: number, timestamp: number): void {
    this.currentBarIndex = barIndex;
    this.currentTimestamp = timestamp;
  }

  /**
   * Get all swap events generated during the backtest.
   */
  getSwapEvents(): SwapEvent[] {
    return [...this.swapEvents];
  }

  /**
   * Get the current capital.
   */
  getCapitalUSD(): number {
    return this.capitalUSD;
  }

  /**
   * Reset the executor state for a new backtest.
   */
  reset(): void {
    this.capitalUSD = this.config.initialCapitalUSD;
    this.position = null;
    this.swapEvents = [];
    this.swapIdCounter = 0;
    this.orderIdCounter = 0;
    this.currentPrice = 0;
    this.currentBarIndex = 0;
    this.currentTimestamp = 0;
  }

  // ===========================================================================
  // IExecutor IMPLEMENTATION
  // ===========================================================================

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    if (this.currentPrice <= 0) {
      return this.createRejectedResult(order, "No current price set");
    }

    // Calculate fill price with slippage
    const slippageMultiplier = order.side === "BUY"
      ? (1 + this.config.slippageBps / 10000)
      : (1 - this.config.slippageBps / 10000);
    const fillPrice = this.currentPrice * slippageMultiplier;

    // Determine order amount
    let amountAsset: number;
    let amountUSD: number;

    if (order.amountUSD !== undefined) {
      amountUSD = order.amountUSD;
      amountAsset = amountUSD / fillPrice;
    } else if (order.amountAsset !== undefined) {
      amountAsset = order.amountAsset;
      amountUSD = amountAsset * fillPrice;
    } else {
      return this.createRejectedResult(order, "No amount specified");
    }

    // Calculate fee
    let feeUSD = amountUSD * (this.config.feeBps / 10000);

    // Check if we have enough capital for buys - auto-adjust to fit
    if (order.side === "BUY" && amountUSD + feeUSD > this.capitalUSD) {
      // Auto-adjust order size to fit within available capital (including fees)
      // totalNeeded = amountUSD + fee = amountUSD * (1 + feeBps/10000)
      // amountUSD = capitalUSD / (1 + feeBps/10000)
      const adjustedAmountUSD = this.capitalUSD / (1 + this.config.feeBps / 10000);
      amountUSD = adjustedAmountUSD;
      amountAsset = amountUSD / fillPrice;
      feeUSD = amountUSD * (this.config.feeBps / 10000);
    }

    // Calculate slippage in USD
    const idealPrice = this.currentPrice;
    const slippageUSD = Math.abs(fillPrice - idealPrice) * amountAsset;

    // Execute the order
    const orderId = `fake-${++this.orderIdCounter}`;

    if (order.side === "BUY") {
      // USD → Asset
      this.capitalUSD -= (amountUSD + feeUSD);
      this.createSwapEvent(
        "USD",
        order.symbol,
        amountUSD + feeUSD,
        amountAsset,
        fillPrice,
        feeUSD,
        slippageUSD,
        order.isEntry,
        order.tradeDirection
      );

      // Update or create position
      if (this.position && this.position.direction === "LONG") {
        // Adding to long position
        const totalSize = this.position.size + amountAsset;
        const totalSizeUSD = this.position.sizeUSD + amountUSD;
        const avgPrice = totalSizeUSD / totalSize;
        this.position = {
          ...this.position,
          size: totalSize,
          sizeUSD: totalSizeUSD,
          entryPrice: avgPrice,
        };
      } else if (this.position && this.position.direction === "SHORT") {
        // Closing short position (buying back what was sold)
        this.position.size -= amountAsset;
        this.position.sizeUSD -= amountUSD;
        if (this.position.size <= 0) {
          this.position = null;
        }
      } else if (!this.position) {
        // New long position
        this.position = {
          symbol: order.symbol,
          direction: "LONG",
          entryPrice: fillPrice,
          size: amountAsset,
          sizeUSD: amountUSD,
          unrealizedPnlUSD: 0,
          entryTime: this.currentTimestamp,
        };
      }
    } else {
      // SELL: Asset → USD
      if (this.position && this.position.size >= amountAsset) {
        this.capitalUSD += (amountUSD - feeUSD);
        this.createSwapEvent(
          order.symbol,
          "USD",
          amountAsset,
          amountUSD - feeUSD,
          fillPrice,
          feeUSD,
          slippageUSD,
          order.isEntry,
          order.tradeDirection
        );

        // Update position
        this.position.size -= amountAsset;
        this.position.sizeUSD -= amountUSD;
        if (this.position.size <= 0) {
          this.position = null;
        }
      } else {
        // Short selling (or closing non-existent position)
        this.capitalUSD += (amountUSD - feeUSD);
        this.createSwapEvent(
          order.symbol,
          "USD",
          amountAsset,
          amountUSD - feeUSD,
          fillPrice,
          feeUSD,
          slippageUSD,
          order.isEntry,
          order.tradeDirection
        );

        if (!this.position) {
          // New short position
          this.position = {
            symbol: order.symbol,
            direction: "SHORT",
            entryPrice: fillPrice,
            size: amountAsset,
            sizeUSD: amountUSD,
            unrealizedPnlUSD: 0,
            entryTime: this.currentTimestamp,
          };
        }
      }
    }

    return {
      orderId,
      clientOrderId: order.clientOrderId,
      status: "FILLED",
      filledAmount: amountAsset,
      avgPrice: fillPrice,
      totalValueUSD: amountUSD,
      feeUSD,
      slippageUSD,
      timestamp: this.currentTimestamp,
    };
  }

  async cancelOrder(_orderId: string): Promise<boolean> {
    // In backtesting with market orders, all orders fill immediately
    // No open orders to cancel
    return false;
  }

  async getOpenOrders(_symbol?: string): Promise<OpenOrder[]> {
    // In backtesting with market orders, all orders fill immediately
    return [];
  }

  async getPosition(symbol: string): Promise<Position | null> {
    if (this.position && this.position.symbol === symbol) {
      // Update unrealized P&L
      const priceDiff = this.currentPrice - this.position.entryPrice;
      const pnlMultiplier = this.position.direction === "LONG" ? 1 : -1;
      this.position.unrealizedPnlUSD = priceDiff * this.position.size * pnlMultiplier;
      return { ...this.position };
    }
    return null;
  }

  async getCurrentPrice(_symbol: string): Promise<number> {
    return this.currentPrice;
  }

  async getBalance(): Promise<number> {
    // Return total equity: cash + position value (mark-to-market)
    if (this.position && this.currentPrice > 0) {
      // Calculate current position value at market price
      const positionValueAtMarket = this.position.size * this.currentPrice;

      // For LONG: we spent USD to buy asset, position value is what we'd get if we sold
      // For SHORT: we received USD when we sold, position value is negative (liability)
      if (this.position.direction === "LONG") {
        return this.capitalUSD + positionValueAtMarket;
      } else {
        // SHORT: capitalUSD includes proceeds from short sale
        // We owe back the asset, so subtract current value to buy it back
        return this.capitalUSD - positionValueAtMarket;
      }
    }
    return this.capitalUSD;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private createRejectedResult(order: OrderRequest, reason: string): OrderResult {
    return {
      orderId: `rejected-${++this.orderIdCounter}`,
      clientOrderId: order.clientOrderId,
      status: "REJECTED",
      filledAmount: 0,
      avgPrice: 0,
      totalValueUSD: 0,
      feeUSD: 0,
      slippageUSD: 0,
      timestamp: this.currentTimestamp,
      rejectReason: reason,
    };
  }

  private createSwapEvent(
    fromAsset: string,
    toAsset: string,
    fromAmount: number,
    toAmount: number,
    price: number,
    feeUSD: number,
    slippageUSD: number,
    isEntry?: boolean,
    tradeDirection?: Direction
  ): void {
    const swap: SwapEvent = {
      id: `swap-${++this.swapIdCounter}`,
      timestamp: this.currentTimestamp,
      barIndex: this.currentBarIndex,
      fromAsset,
      toAsset,
      fromAmount,
      toAmount,
      price,
      feeUSD,
      slippageUSD,
      isEntry,
      tradeDirection,
    };
    this.swapEvents.push(swap);
  }
}
