/**
 * Simulation Loop (Event-Based)
 *
 * Core forward-pass simulation engine.
 * Emits AlgoEvents and SwapEvents instead of directly creating TradeRecords.
 *
 * Key design:
 * - Single forward pass through price data
 * - No backtracking
 * - All indicator signals pre-computed
 * - Events capture every state change for analysis
 */

import type {
  Candle,
  AlgoParams,
  Direction,
  PositionState,
  EntryCondition,
  ExitCondition,
} from "../core/types.ts";
import type { SignalCache } from "../indicators/calculator.ts";
import type { ResampledSignalCache } from "../indicators/resampler.ts";
import { makeIndicator } from "@indicators/factory.ts";
import {
  EventCollector,
  type IndicatorInfo,
  type ConditionType,
  type TransitionReason,
  type AlgoEvent,
  type SwapEvent,
  type TradeEvent,
} from "../events/index.ts";
import {
  StopLossIndicator,
  TakeProfitIndicator,
  TrailingStopIndicator,
  BalanceIndicator,
} from "./special-indicators/index.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for running the simulation.
 */
export interface SimulationConfig {
  /** Historical price data */
  candles: Candle[];
  /**
   * Pre-calculated indicator signals.
   * Accepts either raw SignalCache (from Stage 2) or ResampledSignalCache (from Stage 3).
   * For proper multi-resolution support, use ResampledSignalCache from Stage 3.
   */
  signalCache: SignalCache | ResampledSignalCache;
  /** Algorithm parameters */
  algoParams: AlgoParams;
  /** Asset symbol (e.g., "BTC") */
  symbol: string;
  /** Starting capital in USD */
  initialCapital: number;
  /** Trading fee in basis points */
  feeBps: number;
  /** Slippage in basis points */
  slippageBps: number;
  /** Number of candles to skip for indicator warmup */
  warmupCandles: number;
  /** Enter on first signal without waiting for edge */
  assumePositionImmediately?: boolean;
  /** Force close position at end of data */
  closePositionOnExit?: boolean;
  /** Maximum number of trades before stopping */
  tradesLimit?: number;
}

/**
 * Result of running the simulation.
 */
export interface SimulationResult {
  /** All algo events (indicator flips, condition changes, state transitions) */
  algoEvents: AlgoEvent[];
  /** All swap events (wallet conversions) */
  swapEvents: SwapEvent[];
  /** Derived trade events (paired entry/exit swaps) */
  trades: TradeEvent[];
  /** Equity curve at simulation resolution */
  equityCurve: EquityPoint[];
}

/**
 * Point on the equity curve.
 */
export interface EquityPoint {
  timestamp: number;
  barIndex: number;
  equity: number;
  drawdownPct: number;
}

/**
 * Active position tracking.
 */
interface ActivePosition {
  tradeId: number;
  direction: Direction;
  entryPrice: number;
  entryTime: number;
  entryBarIndex: number;
  positionSizeUSD: number;
  assetAmount: number;
  stopLoss?: StopLossIndicator;
  takeProfit?: TakeProfitIndicator;
  trailingStop?: TrailingStopIndicator;
  balance: BalanceIndicator;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build indicator info for all indicators in algo params.
 * Maps indicator cache keys to their condition context.
 */
function buildIndicatorInfoMap(algoParams: AlgoParams): Map<string, IndicatorInfo> {
  const infoMap = new Map<string, IndicatorInfo>();

  const processCondition = (
    condition: EntryCondition | ExitCondition | undefined,
    conditionType: ConditionType
  ) => {
    if (!condition) return;

    for (const config of condition.required) {
      const indicator = makeIndicator(config);
      const key = indicator.getCacheKey();
      infoMap.set(key, {
        indicatorKey: key,
        indicatorType: config.type,
        conditionType,
        isRequired: true,
      });
    }

    for (const config of condition.optional) {
      const indicator = makeIndicator(config);
      const key = indicator.getCacheKey();
      infoMap.set(key, {
        indicatorKey: key,
        indicatorType: config.type,
        conditionType,
        isRequired: false,
      });
    }
  };

  processCondition(algoParams.longEntry, "LONG_ENTRY");
  processCondition(algoParams.longExit, "LONG_EXIT");
  processCondition(algoParams.shortEntry, "SHORT_ENTRY");
  processCondition(algoParams.shortExit, "SHORT_EXIT");

  return infoMap;
}

/**
 * Get current indicator states from signal cache.
 * Works with both raw SignalCache and ResampledSignalCache.
 */
function getIndicatorStates(
  barIndex: number,
  signalCache: SignalCache | ResampledSignalCache,
  indicatorKeys: string[]
): Map<string, boolean> {
  const states = new Map<string, boolean>();
  for (const key of indicatorKeys) {
    const signals = signalCache.get(key);
    const value = signals?.[barIndex] ?? false;
    states.set(key, value);
  }
  return states;
}

/**
 * Calculate position size based on config.
 */
function calculatePositionSize(
  algoParams: AlgoParams,
  currentEquity: number
): number {
  const config = algoParams.positionSize;
  if (config.type === "ABS") {
    return Math.min(config.value, currentEquity);
  } else {
    // REL or DYN (DYN handled at higher level)
    return currentEquity * config.value;
  }
}

/**
 * Get prices within a candle for TP/SL checking.
 */
function getCandlePrices(candle: Candle): number[] {
  if (candle.close >= candle.open) {
    // Bullish: open → low → high → close
    return [candle.open, candle.low, candle.high, candle.close];
  } else {
    // Bearish: open → high → low → close
    return [candle.open, candle.high, candle.low, candle.close];
  }
}

// =============================================================================
// MAIN SIMULATION LOOP
// =============================================================================

/**
 * Run the forward-pass simulation.
 *
 * @param config - Simulation configuration
 * @returns Events and equity curve
 */
export function runSimulation(config: SimulationConfig): SimulationResult {
  const {
    candles,
    signalCache,
    algoParams,
    symbol,
    initialCapital,
    feeBps,
    slippageBps,
    warmupCandles,
    tradesLimit,
  } = config;

  const assumePositionImmediately = config.assumePositionImmediately ?? false;
  const closePositionOnExit = config.closePositionOnExit ?? true;

  // Initialize event collector
  const collector = new EventCollector(symbol);

  // Build indicator info and register with collector
  const indicatorInfoMap = buildIndicatorInfoMap(algoParams);
  collector.registerIndicators(Array.from(indicatorInfoMap.values()));

  // State tracking
  let currentEquity = initialCapital;
  let peakEquity = initialCapital;
  let currentState: PositionState = "FLAT";
  let activePosition: ActivePosition | null = null;
  let tradeCount = 0;

  // Note: Previous condition states are tracked by EventCollector
  // Use collector.getPreviousConditionMet(type) for edge detection

  // Equity curve
  const equityCurve: EquityPoint[] = [];

  // Get all indicator keys for state extraction
  const indicatorKeys = Array.from(indicatorInfoMap.keys());

  // ---------------------------------------------------------------------------
  // MAIN LOOP
  // ---------------------------------------------------------------------------
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const isLastCandle = i === candles.length - 1;
    const isWarmupPeriod = i < warmupCandles;

    // -------------------------------------------------------------------------
    // Step 1: Update indicator states and emit flip events
    // -------------------------------------------------------------------------
    const indicatorStates = getIndicatorStates(i, signalCache, indicatorKeys);
    collector.updateIndicators(i, candle.bucket, indicatorStates, indicatorInfoMap);

    // -------------------------------------------------------------------------
    // Step 2: Check for position exit (if in position)
    // -------------------------------------------------------------------------
    if (activePosition !== null && currentState !== "FLAT") {
      const exitCondition = currentState === "LONG" ? algoParams.longExit : algoParams.shortExit;
      const exitConditionType: ConditionType = currentState === "LONG" ? "LONG_EXIT" : "SHORT_EXIT";

      // Get current condition state
      const exitSnapshot = collector.getConditionSnapshot(exitConditionType);
      const exitConditionMet = exitSnapshot?.conditionMet ?? false;

      // Check for condition edge (false → true)
      // Use collector as single source of truth for previous state
      const prevExitMet = collector.getPreviousConditionMet(exitConditionType);
      const exitSignalTriggered = assumePositionImmediately
        ? exitConditionMet
        : (!prevExitMet && exitConditionMet);

      // Check special indicators (SL/TP/Trailing)
      const prices = getCandlePrices(candle);
      const times = [candle.bucket, candle.bucket, candle.bucket, candle.bucket];

      // Update balance
      const balanceResults = activePosition.balance.calculate(prices, times);
      const lastBalanceResult = balanceResults[balanceResults.length - 1];
      const unrealizedPnL = lastBalanceResult?.unrealizedPnL ?? 0;
      currentEquity = initialCapital + unrealizedPnL; // Simplified for now

      let slTriggered = false;
      let tpTriggered = false;
      let trailingTriggered = false;

      if (activePosition.stopLoss) {
        activePosition.stopLoss.calculate(prices, times);
        slTriggered = activePosition.stopLoss.isTriggered();
        if (slTriggered) {
          collector.emitSpecialIndicatorEvent(
            i, candle.bucket, "SL_HIT",
            activePosition.stopLoss.getTriggerPrice()!,
            activePosition.stopLoss.getStopLossPrice(),
            activePosition.direction
          );
        }
      }

      if (activePosition.takeProfit) {
        activePosition.takeProfit.calculate(prices, times);
        tpTriggered = activePosition.takeProfit.isTriggered();
        if (tpTriggered) {
          collector.emitSpecialIndicatorEvent(
            i, candle.bucket, "TP_HIT",
            activePosition.takeProfit.getTriggerPrice()!,
            activePosition.takeProfit.getTakeProfitPrice(),
            activePosition.direction
          );
        }
      }

      if (activePosition.trailingStop) {
        const prevLevel = activePosition.trailingStop.getCurrentLevel?.() ?? 0;
        activePosition.trailingStop.calculate(prices, times);
        trailingTriggered = activePosition.trailingStop.isTriggered();
        const newLevel = activePosition.trailingStop.getCurrentLevel?.() ?? 0;

        if (newLevel !== prevLevel && !trailingTriggered) {
          collector.emitSpecialIndicatorEvent(
            i, candle.bucket, "TRAILING_UPDATE",
            candle.close, newLevel, activePosition.direction
          );
        }
        if (trailingTriggered) {
          collector.emitSpecialIndicatorEvent(
            i, candle.bucket, "TRAILING_HIT",
            activePosition.trailingStop.getTriggerPrice()!,
            newLevel, activePosition.direction
          );
        }
      }

      // Determine exit
      const shouldForceClose = isLastCandle && closePositionOnExit;
      let exitReason: TransitionReason | null = null;

      if (trailingTriggered) exitReason = "TRAILING_STOP";
      else if (slTriggered) exitReason = "STOP_LOSS";
      else if (tpTriggered) exitReason = "TAKE_PROFIT";
      else if (exitSignalTriggered) exitReason = "EXIT_SIGNAL";
      else if (shouldForceClose) exitReason = "END_OF_BACKTEST";

      if (exitReason) {
        // Determine exit price
        let exitPrice = candle.close;
        if (exitReason === "STOP_LOSS" && activePosition.stopLoss) {
          exitPrice = activePosition.stopLoss.getTriggerPrice() ?? candle.close;
        } else if (exitReason === "TAKE_PROFIT" && activePosition.takeProfit) {
          exitPrice = activePosition.takeProfit.getTriggerPrice() ?? candle.close;
        } else if (exitReason === "TRAILING_STOP" && activePosition.trailingStop) {
          exitPrice = activePosition.trailingStop.getTriggerPrice() ?? candle.close;
        }

        // Calculate exit amounts
        const slippageMultiplier = 1 - (slippageBps / 10000);
        const feeMultiplier = 1 - (feeBps / 10000);
        const grossUSD = activePosition.assetAmount * exitPrice;
        const exitFeeUSD = grossUSD * (feeBps / 10000);
        const exitSlippageUSD = grossUSD * (slippageBps / 10000);
        const netUSD = grossUSD * slippageMultiplier * feeMultiplier;

        // Emit exit swap
        collector.emitExitSwap(
          i, candle.bucket,
          activePosition.direction,
          exitPrice,
          activePosition.assetAmount,
          netUSD,
          exitFeeUSD,
          exitSlippageUSD
        );

        // Emit state transition
        collector.emitStateTransition(i, candle.bucket, currentState, "FLAT", exitReason);

        // Update equity
        const pnl = netUSD - activePosition.positionSizeUSD;
        currentEquity = initialCapital + pnl; // Reset to account for this trade

        // Reset state
        currentState = "FLAT";
        activePosition = null;
        tradeCount++;
      }

      // Note: Previous condition state is updated by collector.updateIndicators()
      // via checkConditionChange() - no need to track separately
    }

    // -------------------------------------------------------------------------
    // Step 3: Check for position entry (if flat and past warmup)
    // -------------------------------------------------------------------------
    if (currentState === "FLAT" && !isWarmupPeriod) {
      const hitTradesLimit = tradesLimit !== undefined && tradeCount >= tradesLimit;

      if (!hitTradesLimit) {
        // Check long entry
        const longEntrySnapshot = collector.getConditionSnapshot("LONG_ENTRY");
        const longEntryMet = longEntrySnapshot?.conditionMet ?? false;
        const prevLongEntryMet = collector.getPreviousConditionMet("LONG_ENTRY");
        const longEntryTriggered = assumePositionImmediately
          ? longEntryMet
          : (!prevLongEntryMet && longEntryMet);

        if (longEntryTriggered && algoParams.type !== "SHORT") {
          activePosition = enterPosition(
            "LONG", candle, i, algoParams, currentEquity, feeBps, slippageBps, collector
          );
          collector.emitStateTransition(i, candle.bucket, "FLAT", "LONG", "ENTRY_SIGNAL");
          currentState = "LONG";
        }

        // Check short entry (only if didn't just go long)
        if (currentState === "FLAT") {
          const shortEntrySnapshot = collector.getConditionSnapshot("SHORT_ENTRY");
          const shortEntryMet = shortEntrySnapshot?.conditionMet ?? false;
          const prevShortEntryMet = collector.getPreviousConditionMet("SHORT_ENTRY");
          const shortEntryTriggered = assumePositionImmediately
            ? shortEntryMet
            : (!prevShortEntryMet && shortEntryMet);

          if (shortEntryTriggered && algoParams.type !== "LONG") {
            activePosition = enterPosition(
              "SHORT", candle, i, algoParams, currentEquity, feeBps, slippageBps, collector
            );
            collector.emitStateTransition(i, candle.bucket, "FLAT", "SHORT", "ENTRY_SIGNAL");
            currentState = "SHORT";
          }
        }

        // Note: Previous condition states are updated by collector.updateIndicators()
        // via checkConditionChange() - no need to track separately
      }
    }

    // -------------------------------------------------------------------------
    // Step 4: Track equity curve
    // -------------------------------------------------------------------------
    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }
    const drawdownPct = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;

    equityCurve.push({
      timestamp: candle.bucket,
      barIndex: i,
      equity: currentEquity,
      drawdownPct,
    });
  }

  // ---------------------------------------------------------------------------
  // BUILD RESULTS
  // ---------------------------------------------------------------------------
  const { algoEvents, swapEvents } = collector.getEvents();
  const trades = collector.buildTradeEvents();

  return {
    algoEvents,
    swapEvents,
    trades,
    equityCurve,
  };
}

// =============================================================================
// ENTER POSITION HELPER
// =============================================================================

function enterPosition(
  direction: Direction,
  candle: Candle,
  barIndex: number,
  algoParams: AlgoParams,
  currentEquity: number,
  feeBps: number,
  slippageBps: number,
  collector: EventCollector
): ActivePosition {
  const exitCondition = direction === "LONG" ? algoParams.longExit : algoParams.shortExit;

  // Calculate position size
  const positionSizeUSD = calculatePositionSize(algoParams, currentEquity);

  // Calculate entry with fees/slippage
  const slippageMultiplier = 1 + (slippageBps / 10000); // Pay more on entry
  const feeMultiplier = 1 + (feeBps / 10000);
  const effectivePrice = candle.close * slippageMultiplier;
  const entryFeeUSD = positionSizeUSD * (feeBps / 10000);
  const entrySlippageUSD = positionSizeUSD * (slippageBps / 10000);
  const assetAmount = (positionSizeUSD - entryFeeUSD - entrySlippageUSD) / effectivePrice;

  // Emit entry swap
  const tradeId = collector.emitEntrySwap(
    barIndex, candle.bucket,
    direction,
    candle.close,
    positionSizeUSD,
    assetAmount,
    entryFeeUSD,
    entrySlippageUSD
  );

  // Create balance indicator
  const balance = new BalanceIndicator({
    direction,
    initialCapital: currentEquity,
    positionSize: algoParams.positionSize,
    feeBps,
    slippageBps,
  });
  balance.reset(candle.close, candle.bucket);

  // Create active position
  const position: ActivePosition = {
    tradeId,
    direction,
    entryPrice: candle.close,
    entryTime: candle.bucket,
    entryBarIndex: barIndex,
    positionSizeUSD,
    assetAmount,
    balance,
  };

  // Create special indicators if configured
  if (exitCondition?.stopLoss) {
    position.stopLoss = new StopLossIndicator({
      direction,
      stopLoss: exitCondition.stopLoss,
    });
    position.stopLoss.reset(candle.close, candle.bucket);

    collector.emitSpecialIndicatorEvent(
      barIndex, candle.bucket, "SL_SET",
      candle.close, position.stopLoss.getStopLossPrice(), direction
    );
  }

  if (exitCondition?.takeProfit) {
    position.takeProfit = new TakeProfitIndicator({
      direction,
      takeProfit: exitCondition.takeProfit,
    });
    position.takeProfit.reset(candle.close, candle.bucket);

    collector.emitSpecialIndicatorEvent(
      barIndex, candle.bucket, "TP_SET",
      candle.close, position.takeProfit.getTakeProfitPrice(), direction
    );
  }

  if (exitCondition?.trailingSL && exitCondition?.stopLoss) {
    position.trailingStop = new TrailingStopIndicator({
      direction,
      trailingOffset: exitCondition.stopLoss,
    });
    position.trailingStop.reset(candle.close, candle.bucket);

    collector.emitSpecialIndicatorEvent(
      barIndex, candle.bucket, "TRAILING_SET",
      candle.close, position.trailingStop.getCurrentLevel?.() ?? 0, direction
    );
  }

  return position;
}
