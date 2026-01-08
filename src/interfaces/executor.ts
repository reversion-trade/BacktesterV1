// Executor Interface - Defines the contract for trade execution
// Implementations: FakeExecutor (simulated for backtest), RealExecutor (exchange APIs for live)

import type { Direction } from "../core/types.ts";

// ORDER TYPES

export interface OrderRequest {
    clientOrderId: string;                       // Unique client-generated order ID
    symbol: string;                              // Asset symbol (e.g., "BTC", "ETH")
    side: "BUY" | "SELL";                        // Order side
    type: "MARKET" | "LIMIT" | "TWAP" | "SMART"; // Order type
    amountUSD?: number;                          // Order amount in USD (for market orders)
    amountAsset?: number;                        // Order amount in asset units
    limitPrice?: number;                         // Limit price (required for LIMIT orders)
    timeInForce?: "GTC" | "IOC" | "FOK";         // Time-in-force (optional)
    isEntry?: boolean;                           // Whether this order is opening (entry) or closing (exit)
    tradeDirection?: Direction;                  // Direction of the position being opened/closed
}

export interface OrderResult {
    orderId: string;                                                   // Exchange order ID
    clientOrderId: string;                                             // Client order ID (from request)
    status: "FILLED" | "PARTIALLY_FILLED" | "REJECTED" | "PENDING";    // Order status
    filledAmount: number;                                              // Filled amount in asset units
    avgPrice: number;                                                  // Average fill price
    totalValueUSD: number;                                             // Total value in USD
    feeUSD: number;                                                    // Fee paid in USD
    slippageUSD: number;                                               // Slippage incurred in USD
    timestamp: number;                                                 // Execution timestamp
    rejectReason?: string;                                             // Rejection reason (if rejected)
}

export interface OpenOrder {
    orderId: string;                             // Exchange order ID
    clientOrderId: string;                       // Client order ID
    symbol: string;                              // Asset symbol
    side: "BUY" | "SELL";                        // Order side
    type: "MARKET" | "LIMIT" | "TWAP" | "SMART"; // Order type
    status: "PENDING" | "PARTIALLY_FILLED";      // Order status
    originalAmount: number;                      // Original order amount in asset units
    remainingAmount: number;                     // Remaining amount to fill
    limitPrice?: number;                         // Limit price (for limit orders)
    createdAt: number;                           // Creation timestamp
}

export interface Position {
    symbol: string;          // Asset symbol
    direction: Direction;    // Position direction (LONG or SHORT)
    entryPrice: number;      // Entry price (average)
    size: number;            // Position size in asset units
    sizeUSD: number;         // Position size in USD (at entry)
    unrealizedPnlUSD: number; // Unrealized P&L in USD
    entryTime: number;       // Entry timestamp
    tradeId?: number;        // Associated trade ID (for backtest tracking)
}

// EXECUTOR INTERFACE

export interface IExecutor {
    placeOrder(order: OrderRequest): Promise<OrderResult>;  // Place an order
    cancelOrder(orderId: string): Promise<boolean>;         // Cancel an open order (true if cancelled)
    getOpenOrders(symbol?: string): Promise<OpenOrder[]>;   // Get all open orders (optionally filtered by symbol)
    getPosition(symbol: string): Promise<Position | null>;  // Get current position (null if flat)
    getCurrentPrice(symbol: string): Promise<number>;       // Get current price for a symbol
    getBalance(): Promise<number>;                          // Get available USD balance
}
