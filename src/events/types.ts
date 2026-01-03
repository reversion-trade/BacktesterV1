/**
 * Event Types for Backtester-v2
 *
 * Two distinct event categories:
 * 1. SwapEvents - Pure wallet conversions (dumb events, no algo knowledge)
 * 2. AlgoEvents - Internal algorithm state changes (indicator flips, conditions, transitions)
 *
 * This separation enables:
 * - Clear metrics categorization (swap-based vs algo-based)
 * - Diagnostic insights for algo tuning
 * - Near-miss analysis for entry conditions
 */

import type { Direction, PositionState } from "../core/types.ts";

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Which condition an event relates to
 */
export type ConditionType = "LONG_ENTRY" | "LONG_EXIT" | "SHORT_ENTRY" | "SHORT_EXIT";

/**
 * Why a state transition occurred
 */
export type TransitionReason =
  | "ENTRY_SIGNAL"
  | "EXIT_SIGNAL"
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "TRAILING_STOP"
  | "END_OF_BACKTEST";

// =============================================================================
// SWAP EVENTS (Wallet Conversions)
// =============================================================================

/**
 * A pure wallet conversion event.
 * "Dumb event" - no algo logic knowledge required.
 *
 * Examples:
 * - Entry: USD → BTC (buying)
 * - Exit: BTC → USD (selling)
 */
export interface SwapEvent {
  /** Unique identifier for this swap */
  id: string;
  /** Unix timestamp (seconds) */
  timestamp: number;
  /** Candle index in the dataset */
  barIndex: number;
  /** Asset leaving the wallet (e.g., "USD", "BTC") */
  fromAsset: string;
  /** Asset entering the wallet */
  toAsset: string;
  /** Amount of fromAsset */
  fromAmount: number;
  /** Amount of toAsset received */
  toAmount: number;
  /** Execution price */
  price: number;
  /** Fee paid in USD */
  feeUSD: number;
  /** Slippage incurred in USD */
  slippageUSD: number;
  /** Whether this swap is opening a position (entry) or closing (exit) */
  isEntry?: boolean;
  /** Direction of the trade this swap belongs to (LONG or SHORT) */
  tradeDirection?: Direction;
}

/**
 * A complete trade consisting of entry and exit swaps.
 * Derived from paired SwapEvents.
 */
export interface TradeEvent {
  /** Sequential trade ID */
  tradeId: number;
  /** Trade direction */
  direction: Direction;
  /** Entry swap (USD → Asset) */
  entrySwap: SwapEvent;
  /** Exit swap (Asset → USD) */
  exitSwap: SwapEvent;
  /** Net profit/loss in USD (after fees) */
  pnlUSD: number;
  /** Profit/loss as percentage of entry value */
  pnlPct: number;
  /** Number of candles the trade was open */
  durationBars: number;
  /** Duration in seconds */
  durationSeconds: number;
}

// =============================================================================
// CONDITION SNAPSHOT
// =============================================================================

/**
 * Snapshot of a condition's state at a point in time.
 * Used to track "how close" we were to triggering.
 */
export interface ConditionSnapshot {
  /** Number of required indicators currently true */
  requiredTrue: number;
  /** Total number of required indicators */
  requiredTotal: number;
  /** Number of optional indicators currently true */
  optionalTrue: number;
  /** Total number of optional indicators */
  optionalTotal: number;
  /** Whether the full condition is met (all required + at least 1 optional if any) */
  conditionMet: boolean;
  /**
   * Distance from triggering:
   * - 0 = condition is met
   * - 1 = one more indicator needs to flip
   * - N = N more indicators needed
   */
  distanceFromTrigger: number;
}

// =============================================================================
// ALGO EVENTS (Internal State Changes)
// =============================================================================

/**
 * Base fields shared by all algo events
 */
interface AlgoEventBase {
  /** Unix timestamp (seconds) */
  timestamp: number;
  /** Candle index in the dataset */
  barIndex: number;
}

/**
 * An individual indicator changed its signal state.
 * This is the most granular algo event.
 */
export interface IndicatorFlipEvent extends AlgoEventBase {
  type: "INDICATOR_FLIP";
  /** Unique cache key identifying this indicator + params */
  indicatorKey: string;
  /** Indicator type name (e.g., "RSI", "MACD") */
  indicatorType: string;
  /** Previous signal value */
  previousValue: boolean;
  /** New signal value */
  newValue: boolean;
  /** Which condition this indicator belongs to */
  conditionType: ConditionType;
  /** Whether this is a required or optional indicator */
  isRequired: boolean;
  /** Condition state AFTER this flip */
  conditionSnapshot: ConditionSnapshot;
}

/**
 * A full entry/exit condition changed state.
 * Emitted when condition goes from met→unmet or unmet→met.
 */
export interface ConditionChangeEvent extends AlgoEventBase {
  type: "CONDITION_CHANGE";
  /** Which condition changed */
  conditionType: ConditionType;
  /** Previous condition state */
  previousState: boolean;
  /** New condition state */
  newState: boolean;
  /** Which indicator flip caused this change (if applicable) */
  triggeringIndicatorKey?: string;
  /** Full condition snapshot */
  snapshot: ConditionSnapshot;
}

/**
 * Position state machine transition.
 * FLAT → LONG, LONG → FLAT, etc.
 */
export interface StateTransitionEvent extends AlgoEventBase {
  type: "STATE_TRANSITION";
  /** Previous position state */
  fromState: PositionState;
  /** New position state */
  toState: PositionState;
  /** What caused this transition */
  reason: TransitionReason;
  /** Associated trade ID (if entering/exiting a position) */
  tradeId?: number;
}

/**
 * Special indicator (SL/TP/Trailing) events.
 */
export interface SpecialIndicatorEvent extends AlgoEventBase {
  type: "SL_SET" | "TP_SET" | "TRAILING_SET" | "TRAILING_UPDATE" | "SL_HIT" | "TP_HIT" | "TRAILING_HIT";
  /** Current price when event occurred */
  price: number;
  /** The SL/TP/Trailing level */
  level: number;
  /** Trade direction this applies to */
  direction: Direction;
  /** Associated trade ID */
  tradeId: number;
}

/**
 * Union of all algo event types
 */
export type AlgoEvent =
  | IndicatorFlipEvent
  | ConditionChangeEvent
  | StateTransitionEvent
  | SpecialIndicatorEvent;

// =============================================================================
// NEAR-MISS ANALYSIS
// =============================================================================

/**
 * An "approach sequence" - period where we got closer to triggering.
 * Useful for analyzing "almost traded" scenarios.
 */
export interface ApproachSequence {
  /** Candle index when approach started */
  startBar: number;
  /** Candle index when approach ended (retreated or triggered) */
  endBar: number;
  /** Starting distance from trigger */
  startDistance: number;
  /** Closest we got during this approach */
  minDistance: number;
  /** Did this approach result in a trigger? */
  triggered: boolean;
  /** Which condition was being approached */
  conditionType: ConditionType;
}

/**
 * Analysis of near-miss patterns for a condition.
 */
export interface NearMissAnalysis {
  /** Which condition this analysis is for */
  conditionType: ConditionType;
  /**
   * Histogram of distance levels reached.
   * Key = distance, Value = count of times reached.
   * e.g., { 0: 5, 1: 23, 2: 45 } means triggered 5 times, got to 1-away 23 times, etc.
   */
  distanceHistogram: Record<number, number>;
  /** Closest we got without actually triggering */
  closestApproachWithoutTrigger: number;
  /** All approach sequences (getting closer then retreating or triggering) */
  approachSequences: ApproachSequence[];
  /** Total times condition was evaluated */
  totalEvaluations: number;
  /** Times condition fully triggered */
  triggerCount: number;
}

// =============================================================================
// INDICATOR ANALYSIS
// =============================================================================

/**
 * Analysis of a single indicator's behavior.
 */
export interface IndicatorAnalysis {
  /** Unique cache key for this indicator */
  indicatorKey: string;
  /** Indicator type name */
  indicatorType: string;
  /** Which condition this indicator belongs to */
  conditionType: ConditionType;
  /** Whether it's required or optional */
  isRequired: boolean;
  /** Total number of flips (true→false or false→true) */
  flipCount: number;
  /** Average duration when signal is true (in bars) */
  avgDurationTrueBars: number;
  /** Average duration when signal is false (in bars) */
  avgDurationFalseBars: number;
  /** Percentage of time signal was true */
  pctTimeTrue: number;
  /**
   * How often this was the LAST indicator to flip true, triggering the condition.
   * High = this indicator is often the deciding factor.
   */
  triggeringFlipCount: number;
  /**
   * How often this was FALSE when all other indicators were TRUE.
   * High = this indicator is blocking entries.
   */
  blockingCount: number;
  /**
   * Usefulness score (0-100).
   * Low score means: always true (useless), never flips (too strict), or never blocking.
   */
  usefulnessScore: number;
}

// =============================================================================
// AGGREGATE METRICS TYPES
// =============================================================================

/**
 * Metrics derived from SwapEvents/TradeEvents.
 * Traditional trading performance metrics.
 */
export interface SwapMetrics {
  // Summary
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;

  // P&L
  totalPnlUSD: number;
  grossProfitUSD: number;
  grossLossUSD: number;
  avgPnlUSD: number;
  avgWinUSD: number;
  avgLossUSD: number;
  largestWinUSD: number;
  largestLossUSD: number;

  // Risk metrics
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  maxDrawdownUSD: number;
  calmarRatio: number;

  // By direction
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  longPnlUSD: number;
  shortPnlUSD: number;

  // Duration
  avgTradeDurationBars: number;
  avgTradeDurationSeconds: number;
  avgWinDurationBars: number;
  avgLossDurationBars: number;

  // Fees
  totalFeesUSD: number;
  totalSlippageUSD: number;
}

/**
 * Metrics derived from AlgoEvents.
 * Diagnostic metrics for algo tuning.
 */
export interface AlgoMetrics {
  /** Per-indicator analysis */
  indicatorAnalysis: IndicatorAnalysis[];

  /** Near-miss analysis per condition */
  nearMissAnalysis: NearMissAnalysis[];

  /** State distribution */
  stateDistribution: {
    pctTimeFlat: number;
    pctTimeLong: number;
    pctTimeShort: number;
    avgTimeFlatBars: number;
    avgTimeLongBars: number;
    avgTimeShortBars: number;
  };

  /** Exit reason breakdown */
  exitReasonBreakdown: {
    signal: number;
    stopLoss: number;
    takeProfit: number;
    trailingStop: number;
    endOfBacktest: number;
  };

  /** Condition trigger counts */
  conditionTriggerCounts: Record<ConditionType, number>;

  /** Total algo events by type */
  eventCounts: {
    indicatorFlips: number;
    conditionChanges: number;
    stateTransitions: number;
    specialIndicatorEvents: number;
  };
}

// =============================================================================
// BACKTEST RESULT STRUCTURE
// =============================================================================

/**
 * Complete backtest output with events and metrics.
 */
export interface BacktestOutput {
  // Configuration used
  config: {
    algoId: string;
    version: number;
    symbol: string;
    startTime: number;
    endTime: number;
    startingCapitalUSD: number;
    feeBps: number;
    slippageBps: number;
  };

  // Raw events (stored for later analysis)
  events: {
    swapEvents: SwapEvent[];
    algoEvents: AlgoEvent[];
  };

  // Derived trade records
  trades: TradeEvent[];

  // Equity curve
  equityCurve: Array<{
    timestamp: number;
    equity: number;
    drawdownPct: number;
  }>;

  // Metrics
  swapMetrics: SwapMetrics;
  algoMetrics: AlgoMetrics;

  // Meta
  completedAt: number;
  durationMs: number;
  totalBarsProcessed: number;
}
