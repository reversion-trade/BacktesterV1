/**
 * Pre-Calculated Indicator Feed for Backtesting
 *
 * @module simulation/fakes/pre-calculated-feed
 * @description
 * Implements IIndicatorFeed for backtesting using pre-calculated
 * signal arrays. Provides efficient random access to any bar.
 *
 * @architecture
 * This is the backtest implementation of IIndicatorFeed. It:
 * - Wraps pre-calculated signal arrays (from Stage 2 & 3)
 * - Provides efficient O(1) access to signals at any bar
 * - Evaluates conditions based on cached signals
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Provide indicator signals from pre-calculated cache
 */

import type { ConditionType, ConditionSnapshot } from "../../events/types.ts";
import type {
  IIndicatorFeed,
  IndicatorInfo,
  IndicatorState,
  ConditionEvaluation,
} from "../../interfaces/indicator-feed.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Pre-calculated signal cache from Stage 2 & 3.
 * Map of indicator key to boolean array (one value per bar).
 */
export type SignalCache = Map<string, boolean[]>;

/**
 * Optional raw value cache for numeric indicator values.
 */
export type RawValueCache = Map<string, number[]>;

// =============================================================================
// PRE-CALCULATED FEED IMPLEMENTATION
// =============================================================================

/**
 * Indicator feed that reads from pre-calculated signal arrays.
 *
 * @example
 * ```typescript
 * // Build signal cache (from Stage 2 & 3)
 * const signalCache = new Map<string, boolean[]>();
 * signalCache.set("RSI_14_70_30", [false, false, true, true, false, ...]);
 *
 * // Build indicator info map
 * const indicatorInfo = new Map<string, IndicatorInfo>();
 * indicatorInfo.set("RSI_14_70_30", {
 *   key: "RSI_14_70_30",
 *   type: "RSI",
 *   conditionType: "LONG_ENTRY",
 *   isRequired: true,
 * });
 *
 * // Create feed
 * const feed = new PreCalculatedFeed(signalCache, indicatorInfo);
 *
 * // Use in simulation
 * feed.setCurrentBar(100, 1704067200);
 * const signals = feed.getCurrentSignals();
 * const entryEval = feed.evaluateCondition("LONG_ENTRY");
 * ```
 */
/**
 * Represents an indicator signal flip (change from true to false or vice versa).
 */
export interface IndicatorFlip {
  indicatorKey: string;
  previousValue: boolean;
  newValue: boolean;
}

export class PreCalculatedFeed implements IIndicatorFeed {
  private signalCache: SignalCache;
  private rawValueCache: RawValueCache | null;
  private indicatorInfoMap: Map<string, IndicatorInfo>;
  private currentBarIndex: number = 0;
  private currentTimestamp: number = 0;
  private totalBars: number = 0;
  private previousConditionMet: Map<ConditionType, boolean> = new Map();
  private previousSignals: Map<string, boolean> = new Map();
  private lastFlips: IndicatorFlip[] = [];

  constructor(
    signalCache: SignalCache,
    indicatorInfo: Map<string, IndicatorInfo>,
    rawValueCache?: RawValueCache
  ) {
    this.signalCache = signalCache;
    this.indicatorInfoMap = indicatorInfo;
    this.rawValueCache = rawValueCache || null;

    // Determine total bars from first signal array
    for (const signals of signalCache.values()) {
      this.totalBars = signals.length;
      break;
    }

    // Initialize previous condition states
    this.previousConditionMet.set("LONG_ENTRY", false);
    this.previousConditionMet.set("LONG_EXIT", false);
    this.previousConditionMet.set("SHORT_ENTRY", false);
    this.previousConditionMet.set("SHORT_EXIT", false);
  }

  // ===========================================================================
  // IIndicatorFeed IMPLEMENTATION
  // ===========================================================================

  setCurrentBar(barIndex: number, timestamp: number): void {
    // Clear previous flips
    this.lastFlips = [];

    // Before changing bar, save current condition states as "previous"
    if (barIndex !== this.currentBarIndex) {
      for (const conditionType of ["LONG_ENTRY", "LONG_EXIT", "SHORT_ENTRY", "SHORT_EXIT"] as ConditionType[]) {
        const snapshot = this.getConditionSnapshot(conditionType);
        this.previousConditionMet.set(conditionType, snapshot.conditionMet);
      }

      // Save current signals as previous before moving to new bar
      for (const [key, signalArray] of this.signalCache) {
        if (this.currentBarIndex < signalArray.length) {
          const currentSignal = signalArray[this.currentBarIndex];
          if (currentSignal !== undefined) {
            this.previousSignals.set(key, currentSignal);
          }
        }
      }
    }

    this.currentBarIndex = barIndex;
    this.currentTimestamp = timestamp;

    // Detect flips by comparing previous signals to current signals
    for (const [key, signalArray] of this.signalCache) {
      if (barIndex < signalArray.length) {
        const newSignal = signalArray[barIndex];
        const previousSignal = this.previousSignals.get(key);

        // If we have a previous value and it changed, record the flip
        if (previousSignal !== undefined && newSignal !== undefined && previousSignal !== newSignal) {
          this.lastFlips.push({
            indicatorKey: key,
            previousValue: previousSignal,
            newValue: newSignal,
          });
        }
      }
    }
  }

  /**
   * Get indicator flips that occurred when transitioning to the current bar.
   */
  getLastFlips(): IndicatorFlip[] {
    return [...this.lastFlips];
  }

  getCurrentBarIndex(): number {
    return this.currentBarIndex;
  }

  getCurrentSignals(): Map<string, boolean> {
    const signals = new Map<string, boolean>();
    for (const [key, signalArray] of this.signalCache) {
      if (this.currentBarIndex < signalArray.length) {
        const signal = signalArray[this.currentBarIndex];
        if (signal !== undefined) {
          signals.set(key, signal);
        }
      }
    }
    return signals;
  }

  getSignal(indicatorKey: string): boolean | undefined {
    const signalArray = this.signalCache.get(indicatorKey);
    if (!signalArray || this.currentBarIndex >= signalArray.length) {
      return undefined;
    }
    return signalArray[this.currentBarIndex];
  }

  getRawValue(indicatorKey: string): number | undefined {
    if (!this.rawValueCache) {
      return undefined;
    }
    const valueArray = this.rawValueCache.get(indicatorKey);
    if (!valueArray || this.currentBarIndex >= valueArray.length) {
      return undefined;
    }
    return valueArray[this.currentBarIndex];
  }

  evaluateCondition(conditionType: ConditionType): ConditionEvaluation {
    const snapshot = this.getConditionSnapshot(conditionType);
    const indicators = this.getIndicatorsForCondition(conditionType);

    const indicatorStates: IndicatorState[] = indicators.map(info => ({
      key: info.key,
      signal: this.getSignal(info.key) ?? false,
      rawValue: this.getRawValue(info.key),
      lastUpdated: this.currentTimestamp,
    }));

    return {
      conditionType,
      isMet: snapshot.conditionMet,
      snapshot,
      indicatorStates,
    };
  }

  getConditionSnapshot(conditionType: ConditionType): ConditionSnapshot {
    const indicators = this.getIndicatorsForCondition(conditionType);

    const required = indicators.filter(i => i.isRequired);
    const optional = indicators.filter(i => !i.isRequired);

    let requiredTrue = 0;
    let optionalTrue = 0;

    for (const ind of required) {
      if (this.getSignal(ind.key)) {
        requiredTrue++;
      }
    }

    for (const ind of optional) {
      if (this.getSignal(ind.key)) {
        optionalTrue++;
      }
    }

    const requiredTotal = required.length;
    const optionalTotal = optional.length;

    // Condition is met if:
    // - All required are true AND
    // - At least one optional is true (if any optional exist)
    const allRequiredMet = requiredTrue === requiredTotal;
    const optionalSatisfied = optionalTotal === 0 || optionalTrue > 0;
    const conditionMet = requiredTotal > 0 && allRequiredMet && optionalSatisfied;

    // Calculate distance from trigger
    let distanceFromTrigger = 0;
    if (!conditionMet) {
      // How many required still need to flip?
      const requiredNeeded = requiredTotal - requiredTrue;
      // If optional exists and none are true, we need at least 1
      const optionalNeeded = optionalTotal > 0 && optionalTrue === 0 ? 1 : 0;
      distanceFromTrigger = requiredNeeded + optionalNeeded;
    }

    return {
      requiredTrue,
      requiredTotal,
      optionalTrue,
      optionalTotal,
      conditionMet,
      distanceFromTrigger,
    };
  }

  getIndicatorInfo(): Map<string, IndicatorInfo> {
    return new Map(this.indicatorInfoMap);
  }

  getIndicatorsForCondition(conditionType: ConditionType): IndicatorInfo[] {
    const result: IndicatorInfo[] = [];
    for (const info of this.indicatorInfoMap.values()) {
      if (info.conditionType === conditionType) {
        result.push(info);
      }
    }
    return result;
  }

  getPreviousConditionMet(conditionType: ConditionType): boolean {
    return this.previousConditionMet.get(conditionType) ?? false;
  }

  getTotalBars(): number {
    return this.totalBars;
  }

  // ===========================================================================
  // ADDITIONAL HELPERS (Backtest-specific)
  // ===========================================================================

  /**
   * Get signal at a specific bar (without changing current bar).
   */
  getSignalAtBar(indicatorKey: string, barIndex: number): boolean | undefined {
    const signalArray = this.signalCache.get(indicatorKey);
    if (!signalArray || barIndex >= signalArray.length) {
      return undefined;
    }
    return signalArray[barIndex];
  }

  /**
   * Get all indicator keys.
   */
  getIndicatorKeys(): string[] {
    return Array.from(this.signalCache.keys());
  }

  /**
   * Check if a specific indicator exists in the feed.
   */
  hasIndicator(indicatorKey: string): boolean {
    return this.signalCache.has(indicatorKey);
  }

  /**
   * Get condition snapshot at a specific bar (without changing current bar).
   */
  getConditionSnapshotAtBar(conditionType: ConditionType, barIndex: number): ConditionSnapshot {
    const originalBar = this.currentBarIndex;
    const originalTimestamp = this.currentTimestamp;

    // Temporarily set bar (without updating previous condition state)
    this.currentBarIndex = barIndex;
    const snapshot = this.getConditionSnapshot(conditionType);

    // Restore
    this.currentBarIndex = originalBar;
    this.currentTimestamp = originalTimestamp;

    return snapshot;
  }

  /**
   * Reset the feed state (for restarting backtest).
   */
  reset(): void {
    this.currentBarIndex = 0;
    this.currentTimestamp = 0;
    this.previousConditionMet.clear();
    this.previousConditionMet.set("LONG_ENTRY", false);
    this.previousConditionMet.set("LONG_EXIT", false);
    this.previousConditionMet.set("SHORT_ENTRY", false);
    this.previousConditionMet.set("SHORT_EXIT", false);
    this.previousSignals.clear();
    this.lastFlips = [];
  }
}
