/**
 * Trade Recording Helpers
 *
 * Utilities for opening/closing positions and creating TradeRecord objects.
 * Works with BalanceIndicator for accurate P&L calculations.
 */

import type { Direction, ValueConfig } from "../core/types.ts";
import type { TradeRecord, ExitReason } from "./types.ts";
import type { IntraTradeExtremes } from "../simulation/special-indicators/types.ts";
import { BalanceIndicator } from "../simulation/special-indicators/balance.ts";

// =============================================================================
// OPEN POSITION
// =============================================================================

/**
 * Information about an open position.
 * Created when entering a trade.
 */
export interface OpenPosition {
  /** Trade ID (sequential) */
  tradeId: number;
  /** Trade direction */
  direction: Direction;
  /** Entry timestamp (Unix seconds) */
  entryTime: number;
  /** Entry price (before slippage) */
  entryPrice: number;
  /** Effective entry price (after slippage) */
  effectiveEntryPrice: number;
  /** Position size in asset units */
  qty: number;
  /** Position size in USD */
  positionSizeUSD: number;
  /** Entry bar index */
  entryBarIndex: number;
  /** Stop loss price level (if set) */
  stopLossPrice?: number;
  /** Take profit price level (if set) */
  takeProfitPrice?: number;
  /** Balance indicator for tracking P&L */
  balanceIndicator: BalanceIndicator;
}

/**
 * Configuration for opening a position.
 */
export interface OpenPositionConfig {
  tradeId: number;
  direction: Direction;
  entryTime: number;
  entryPrice: number;
  entryBarIndex: number;
  initialCapital: number;
  positionSize: ValueConfig;
  feeBps: number;
  slippageBps: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

/**
 * Open a new position and create tracking structures.
 *
 * @param config - Position configuration
 * @returns Open position record with balance indicator
 */
export function openPosition(config: OpenPositionConfig): OpenPosition {
  // Create balance indicator for this trade
  const balanceIndicator = new BalanceIndicator({
    direction: config.direction,
    initialCapital: config.initialCapital,
    positionSize: config.positionSize,
    feeBps: config.feeBps,
    slippageBps: config.slippageBps,
  });

  // Reset the indicator with entry price
  balanceIndicator.reset(config.entryPrice, config.entryTime);

  return {
    tradeId: config.tradeId,
    direction: config.direction,
    entryTime: config.entryTime,
    entryPrice: config.entryPrice,
    effectiveEntryPrice: balanceIndicator.getEffectiveEntryPrice(),
    qty: balanceIndicator.getPositionSizeAsset(),
    positionSizeUSD: balanceIndicator.getPositionSizeUSD(),
    entryBarIndex: config.entryBarIndex,
    stopLossPrice: config.stopLossPrice,
    takeProfitPrice: config.takeProfitPrice,
    balanceIndicator,
  };
}

// =============================================================================
// CLOSE POSITION
// =============================================================================

/**
 * Configuration for closing a position.
 */
export interface ClosePositionConfig {
  position: OpenPosition;
  exitTime: number;
  exitPrice: number;
  exitBarIndex: number;
  exitReason: ExitReason;
  extremes: IntraTradeExtremes;
  cumulativePnlBeforeTrade: number;
  equityBeforeTrade: number;
}

/**
 * Close a position and create a complete TradeRecord.
 *
 * @param config - Close configuration
 * @returns Complete trade record
 */
export function closePosition(config: ClosePositionConfig): TradeRecord {
  const { position, exitTime, exitPrice, exitBarIndex, exitReason, extremes } =
    config;

  // Calculate realized P&L using the balance indicator
  const pnlUSD = position.balanceIndicator.calculateRealizedPnL(exitPrice);
  const pnlPct = pnlUSD / position.positionSizeUSD;

  // Calculate duration
  const durationSeconds = exitTime - position.entryTime;
  const durationBars = exitBarIndex - position.entryBarIndex;

  // Calculate cumulative values
  const cumulativePnlUSD = config.cumulativePnlBeforeTrade + pnlUSD;
  const equityAfterTrade = config.equityBeforeTrade + pnlUSD;

  return {
    tradeId: position.tradeId,
    direction: position.direction,

    // Entry
    entryTime: position.entryTime,
    entryPrice: position.entryPrice,

    // Exit
    exitTime,
    exitPrice,

    // Size
    qty: position.qty,

    // P&L
    pnlUSD,
    pnlPct,

    // Intra-trade extremes
    runUpUSD: extremes.maxRunUpUSD,
    runUpPct: extremes.maxRunUpPct,
    drawdownUSD: extremes.maxDrawdownUSD,
    drawdownPct: extremes.maxDrawdownPct,

    // Duration
    durationSeconds,
    durationBars,

    // Cumulative
    cumulativePnlUSD,
    equityAfterTrade,

    // Exit info
    exitReason,
    stopLossPrice: position.stopLossPrice,
    takeProfitPrice: position.takeProfitPrice,
  };
}

// =============================================================================
// TRADE ACCUMULATOR
// =============================================================================

/**
 * Accumulator for tracking trade sequence and cumulative values.
 */
export class TradeAccumulator {
  private trades: TradeRecord[] = [];
  private cumulativePnl: number = 0;
  private currentEquity: number;
  private nextTradeId: number = 1;

  constructor(initialCapital: number) {
    this.currentEquity = initialCapital;
  }

  /**
   * Get the next trade ID.
   */
  getNextTradeId(): number {
    return this.nextTradeId;
  }

  /**
   * Record a completed trade.
   */
  recordTrade(trade: TradeRecord): void {
    this.trades.push(trade);
    this.cumulativePnl = trade.cumulativePnlUSD;
    this.currentEquity = trade.equityAfterTrade;
    this.nextTradeId++;
  }

  /**
   * Get cumulative P&L before the current trade.
   */
  getCumulativePnl(): number {
    return this.cumulativePnl;
  }

  /**
   * Get current equity before the current trade closes.
   */
  getCurrentEquity(): number {
    return this.currentEquity;
  }

  /**
   * Get all recorded trades.
   */
  getTrades(): TradeRecord[] {
    return this.trades;
  }

  /**
   * Get the number of completed trades.
   */
  getTradeCount(): number {
    return this.trades.length;
  }

  /**
   * Reset the accumulator for a new backtest.
   */
  reset(initialCapital: number): void {
    this.trades = [];
    this.cumulativePnl = 0;
    this.currentEquity = initialCapital;
    this.nextTradeId = 1;
  }
}

// =============================================================================
// EXIT REASON DETERMINATION
// =============================================================================

/**
 * Determine the exit reason based on which conditions triggered.
 * Uses priority: TRAILING_STOP > STOP_LOSS > TAKE_PROFIT > SIGNAL > END_OF_BACKTEST
 *
 * @param slTriggered - Stop loss was hit
 * @param trailingTriggered - Trailing stop was hit
 * @param tpTriggered - Take profit was hit
 * @param signalTriggered - Exit signal condition was met
 * @param isLastCandle - We're at the end of the backtest data
 * @returns The highest priority exit reason, or null if no exit
 */
export function determineExitReason(
  slTriggered: boolean,
  trailingTriggered: boolean,
  tpTriggered: boolean,
  signalTriggered: boolean,
  isLastCandle: boolean
): ExitReason | null {
  // Priority order: risk management first
  if (trailingTriggered) return "TRAILING_STOP";
  if (slTriggered) return "STOP_LOSS";
  if (tpTriggered) return "TAKE_PROFIT";
  if (signalTriggered) return "SIGNAL";
  if (isLastCandle) return "END_OF_BACKTEST";
  return null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a trade was a winner.
 */
export function isWinningTrade(trade: TradeRecord): boolean {
  return trade.pnlUSD > 0;
}

/**
 * Check if a trade was a loser.
 */
export function isLosingTrade(trade: TradeRecord): boolean {
  return trade.pnlUSD < 0;
}

/**
 * Filter trades by direction.
 */
export function filterTradesByDirection(
  trades: TradeRecord[],
  direction: Direction
): TradeRecord[] {
  return trades.filter((t) => t.direction === direction);
}

/**
 * Calculate total P&L for a list of trades.
 */
export function calculateTotalPnl(trades: TradeRecord[]): number {
  return trades.reduce((sum, t) => sum + t.pnlUSD, 0);
}

/**
 * Calculate win rate for a list of trades.
 */
export function calculateWinRate(trades: TradeRecord[]): number {
  if (trades.length === 0) return 0;
  const winners = trades.filter(isWinningTrade).length;
  return winners / trades.length;
}
