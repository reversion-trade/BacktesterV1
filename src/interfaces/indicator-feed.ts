/**
 * Indicator Feed Interface
 *
 * @module interfaces/indicator-feed
 * @description
 * Defines the interface for accessing indicator signals.
 * Implementations:
 * - PreCalculatedFeed: Pre-computed signals for backtesting
 * - RealTimeFeed: Live indicator computation for live trading
 *
 * @architecture
 * This interface enables the algo class to access indicator signals
 * without knowing whether they come from pre-calculated cache or
 * real-time computation. The algo class should have NO conditional
 * logic like 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Abstract indicator access for live/backtest parity
 */

import type { ConditionType, ConditionSnapshot } from "../events/types.ts";

// =============================================================================
// INDICATOR INFO TYPES
// =============================================================================

/**
 * Metadata about an indicator.
 */
export interface IndicatorInfo {
  /** Unique key identifying this indicator (includes params hash) */
  key: string;
  /** Indicator type name (e.g., "RSI", "MACD") */
  type: string;
  /** Which condition this indicator belongs to */
  conditionType: ConditionType;
  /** Whether this is a required or optional indicator */
  isRequired: boolean;
  /** Human-readable description */
  description?: string;
}

/**
 * Current state of a single indicator.
 */
export interface IndicatorState {
  /** Unique indicator key */
  key: string;
  /** Current boolean signal */
  signal: boolean;
  /** Raw numeric value (if applicable) */
  rawValue?: number;
  /** Timestamp of last update */
  lastUpdated: number;
}

/**
 * Result of evaluating all indicators for a condition.
 */
export interface ConditionEvaluation {
  /** Which condition was evaluated */
  conditionType: ConditionType;
  /** Whether the condition is met */
  isMet: boolean;
  /** Detailed snapshot */
  snapshot: ConditionSnapshot;
  /** States of contributing indicators */
  indicatorStates: IndicatorState[];
}

// =============================================================================
// INDICATOR FEED INTERFACE
// =============================================================================

/**
 * Interface for accessing indicator signals.
 *
 * Abstracts the indicator computation layer so the algo class can work
 * identically in backtest (pre-calculated) and live (real-time) environments.
 *
 * @example
 * ```typescript
 * // Algo class uses feed without knowing environment
 * async onBar(barIndex: number) {
 *   // Get all current signals
 *   const signals = this.feed.getCurrentSignals();
 *
 *   // Check if entry condition is met
 *   const entryEval = this.feed.evaluateCondition("LONG_ENTRY");
 *   if (entryEval.isMet) {
 *     // Execute entry logic
 *   }
 * }
 * ```
 */
export interface IIndicatorFeed {
  /**
   * Set the current bar index.
   * For backtesting, this advances through pre-calculated signals.
   * For live trading, this may trigger recalculation.
   *
   * @param barIndex - The bar index to set
   * @param timestamp - The timestamp of the bar
   */
  setCurrentBar(barIndex: number, timestamp: number): void;

  /**
   * Get the current bar index.
   *
   * @returns The current bar index
   */
  getCurrentBarIndex(): number;

  /**
   * Get all indicator signals for the current bar.
   *
   * @returns Map of indicator key to boolean signal
   */
  getCurrentSignals(): Map<string, boolean>;

  /**
   * Get a specific indicator's signal for the current bar.
   *
   * @param indicatorKey - The indicator key
   * @returns The boolean signal or undefined if not found
   */
  getSignal(indicatorKey: string): boolean | undefined;

  /**
   * Get the raw numeric value for an indicator (if applicable).
   *
   * @param indicatorKey - The indicator key
   * @returns The raw value or undefined if not applicable
   */
  getRawValue(indicatorKey: string): number | undefined;

  /**
   * Evaluate a condition (entry or exit) for the current bar.
   *
   * @param conditionType - Which condition to evaluate
   * @returns The evaluation result with snapshot
   */
  evaluateCondition(conditionType: ConditionType): ConditionEvaluation;

  /**
   * Get a snapshot of a condition's state.
   *
   * @param conditionType - Which condition to snapshot
   * @returns The condition snapshot
   */
  getConditionSnapshot(conditionType: ConditionType): ConditionSnapshot;

  /**
   * Get metadata for all registered indicators.
   *
   * @returns Map of indicator key to info
   */
  getIndicatorInfo(): Map<string, IndicatorInfo>;

  /**
   * Get indicators that belong to a specific condition.
   *
   * @param conditionType - Which condition to query
   * @returns Array of indicator info for that condition
   */
  getIndicatorsForCondition(conditionType: ConditionType): IndicatorInfo[];

  /**
   * Check if a previous condition was met (for detecting transitions).
   *
   * @param conditionType - Which condition to check
   * @returns Whether the condition was met on the previous bar
   */
  getPreviousConditionMet(conditionType: ConditionType): boolean;

  /**
   * Get the total number of bars in the feed.
   * For backtesting, this is the pre-calculated signal length.
   * For live trading, this grows as new bars arrive.
   *
   * @returns Total number of bars
   */
  getTotalBars(): number;
}
