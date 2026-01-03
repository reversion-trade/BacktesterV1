/**
 * Algo Metrics Calculation
 *
 * Calculates AlgoMetrics from AlgoEvents.
 * These are diagnostic metrics for algorithm tuning:
 * - Indicator analysis (flip counts, usefulness scores)
 * - Near-miss analysis (how close we got to triggering)
 * - State distribution (time in each position state)
 * - Exit reason breakdown
 */

import type {
  AlgoEvent,
  AlgoMetrics,
  IndicatorAnalysis,
  NearMissAnalysis,
  ApproachSequence,
  ConditionType,
  IndicatorFlipEvent,
  ConditionChangeEvent,
  StateTransitionEvent,
  SpecialIndicatorEvent,
} from "../events/types.ts";
import { sum, mean } from "../utils/math.ts";

// =============================================================================
// MAIN CALCULATION
// =============================================================================

/**
 * Calculate algo-based metrics from algo events.
 *
 * @param algoEvents - All algo events from simulation
 * @param totalBars - Total number of bars in the simulation
 */
export function calculateAlgoMetrics(
  algoEvents: AlgoEvent[],
  totalBars: number
): AlgoMetrics {
  // Categorize events by type
  const flipEvents = algoEvents.filter((e): e is IndicatorFlipEvent => e.type === "INDICATOR_FLIP");
  const conditionEvents = algoEvents.filter((e): e is ConditionChangeEvent => e.type === "CONDITION_CHANGE");
  const stateEvents = algoEvents.filter((e): e is StateTransitionEvent => e.type === "STATE_TRANSITION");
  const specialEvents = algoEvents.filter(
    (e): e is SpecialIndicatorEvent =>
      e.type === "SL_SET" ||
      e.type === "TP_SET" ||
      e.type === "TRAILING_SET" ||
      e.type === "TRAILING_UPDATE" ||
      e.type === "SL_HIT" ||
      e.type === "TP_HIT" ||
      e.type === "TRAILING_HIT"
  );

  return {
    indicatorAnalysis: calculateIndicatorAnalysis(flipEvents, conditionEvents, totalBars),
    nearMissAnalysis: calculateNearMissAnalysis(flipEvents),
    stateDistribution: calculateStateDistribution(stateEvents, totalBars),
    exitReasonBreakdown: calculateExitReasonBreakdown(stateEvents),
    conditionTriggerCounts: calculateConditionTriggerCounts(conditionEvents),
    eventCounts: {
      indicatorFlips: flipEvents.length,
      conditionChanges: conditionEvents.length,
      stateTransitions: stateEvents.length,
      specialIndicatorEvents: specialEvents.length,
    },
  };
}

// =============================================================================
// INDICATOR ANALYSIS
// =============================================================================

/**
 * Analyze individual indicator behavior.
 */
function calculateIndicatorAnalysis(
  flipEvents: IndicatorFlipEvent[],
  conditionEvents: ConditionChangeEvent[],
  totalBars: number
): IndicatorAnalysis[] {
  // Group flips by indicator key
  const flipsByIndicator = new Map<string, IndicatorFlipEvent[]>();
  for (const flip of flipEvents) {
    const existing = flipsByIndicator.get(flip.indicatorKey) ?? [];
    existing.push(flip);
    flipsByIndicator.set(flip.indicatorKey, existing);
  }

  // Build triggering map (which indicator triggered which condition changes)
  const triggeringCounts = new Map<string, number>();
  for (const change of conditionEvents) {
    if (change.newState && change.triggeringIndicatorKey) {
      const count = triggeringCounts.get(change.triggeringIndicatorKey) ?? 0;
      triggeringCounts.set(change.triggeringIndicatorKey, count + 1);
    }
  }

  const analyses: IndicatorAnalysis[] = [];

  for (const [indicatorKey, flips] of flipsByIndicator) {
    if (flips.length === 0) continue;

    const firstFlip = flips[0]!;
    const indicatorType = firstFlip.indicatorType;
    const conditionType = firstFlip.conditionType;
    const isRequired = firstFlip.isRequired;

    // Calculate flip count
    const flipCount = flips.length;

    // Calculate average duration in true/false states
    const { avgDurationTrueBars, avgDurationFalseBars, pctTimeTrue } = calculateDurationStats(
      flips,
      totalBars
    );

    // Triggering count
    const triggeringFlipCount = triggeringCounts.get(indicatorKey) ?? 0;

    // Blocking count: times this was false when it was the only false required indicator
    const blockingCount = calculateBlockingCount(flips);

    // Usefulness score (0-100)
    const usefulnessScore = calculateUsefulnessScore(
      flipCount,
      pctTimeTrue,
      triggeringFlipCount,
      blockingCount,
      totalBars,
      isRequired
    );

    analyses.push({
      indicatorKey,
      indicatorType,
      conditionType,
      isRequired,
      flipCount,
      avgDurationTrueBars,
      avgDurationFalseBars,
      pctTimeTrue,
      triggeringFlipCount,
      blockingCount,
      usefulnessScore,
    });
  }

  // Sort by usefulness score (descending)
  analyses.sort((a, b) => b.usefulnessScore - a.usefulnessScore);

  return analyses;
}

/**
 * Calculate duration statistics for an indicator.
 */
function calculateDurationStats(
  flips: IndicatorFlipEvent[],
  totalBars: number
): {
  avgDurationTrueBars: number;
  avgDurationFalseBars: number;
  pctTimeTrue: number;
} {
  if (flips.length === 0) {
    return { avgDurationTrueBars: 0, avgDurationFalseBars: 0, pctTimeTrue: 0 };
  }

  // Sort by bar index
  const sortedFlips = [...flips].sort((a, b) => a.barIndex - b.barIndex);

  const trueDurations: number[] = [];
  const falseDurations: number[] = [];

  let lastFlipBar = 0;
  let lastValue = false; // Assume starts false

  for (const flip of sortedFlips) {
    const duration = flip.barIndex - lastFlipBar;
    if (duration > 0) {
      if (lastValue) {
        trueDurations.push(duration);
      } else {
        falseDurations.push(duration);
      }
    }
    lastFlipBar = flip.barIndex;
    lastValue = flip.newValue;
  }

  // Add final duration to end of simulation
  const finalDuration = totalBars - lastFlipBar;
  if (finalDuration > 0) {
    if (lastValue) {
      trueDurations.push(finalDuration);
    } else {
      falseDurations.push(finalDuration);
    }
  }

  const totalTrue = sum(trueDurations);
  const totalFalse = sum(falseDurations);
  const totalTime = totalTrue + totalFalse;

  return {
    avgDurationTrueBars: trueDurations.length > 0 ? mean(trueDurations) : 0,
    avgDurationFalseBars: falseDurations.length > 0 ? mean(falseDurations) : 0,
    pctTimeTrue: totalTime > 0 ? totalTrue / totalTime : 0,
  };
}

/**
 * Calculate how often this indicator was the only one blocking a condition.
 */
function calculateBlockingCount(flips: IndicatorFlipEvent[]): number {
  let blockingCount = 0;

  for (const flip of flips) {
    // Check if this flip from true->false caused condition to become unmet
    // and was the deciding factor (distanceFromTrigger was 0 before, 1 after)
    if (!flip.newValue && flip.conditionSnapshot.distanceFromTrigger === 1) {
      // This indicator becoming false made the condition unmet by exactly 1
      blockingCount++;
    }
  }

  return blockingCount;
}

/**
 * Calculate usefulness score (0-100).
 *
 * Low score means:
 * - Always true (useless confirmation)
 * - Never flips (too strict)
 * - Never triggers or blocks (no impact)
 */
function calculateUsefulnessScore(
  flipCount: number,
  pctTimeTrue: number,
  triggeringFlipCount: number,
  blockingCount: number,
  totalBars: number,
  isRequired: boolean
): number {
  let score = 50; // Base score

  // Flip frequency factor (0-20 points)
  // Optimal: flips occasionally but not constantly
  const flipRate = flipCount / Math.max(totalBars, 1);
  if (flipRate > 0.5) {
    // Too noisy
    score -= 10;
  } else if (flipRate > 0.01 && flipRate < 0.2) {
    // Good flip rate
    score += 15;
  } else if (flipRate < 0.001) {
    // Too static
    score -= 15;
  }

  // Time distribution factor (0-20 points)
  // Optimal: not always true, not always false
  if (pctTimeTrue > 0.95 || pctTimeTrue < 0.05) {
    // Almost always one value = useless
    score -= 20;
  } else if (pctTimeTrue > 0.3 && pctTimeTrue < 0.7) {
    // Balanced
    score += 15;
  }

  // Impact factor for required indicators (0-30 points)
  if (isRequired) {
    // Triggering impact
    if (triggeringFlipCount > 0) {
      score += Math.min(15, triggeringFlipCount * 3);
    }

    // Blocking impact
    if (blockingCount > 0) {
      score += Math.min(15, blockingCount * 2);
    }
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

// =============================================================================
// NEAR-MISS ANALYSIS
// =============================================================================

/**
 * Analyze near-miss patterns for each condition type.
 */
function calculateNearMissAnalysis(flipEvents: IndicatorFlipEvent[]): NearMissAnalysis[] {
  // Group by condition type
  const byCondition = new Map<ConditionType, IndicatorFlipEvent[]>();
  for (const flip of flipEvents) {
    const existing = byCondition.get(flip.conditionType) ?? [];
    existing.push(flip);
    byCondition.set(flip.conditionType, existing);
  }

  const analyses: NearMissAnalysis[] = [];

  for (const [conditionType, flips] of byCondition) {
    const sortedFlips = [...flips].sort((a, b) => a.barIndex - b.barIndex);

    // Build distance histogram
    const distanceHistogram: Record<number, number> = {};
    let closestApproachWithoutTrigger = Infinity;
    let triggerCount = 0;
    let totalEvaluations = flips.length;

    // Track approach sequences
    const approachSequences: ApproachSequence[] = [];
    let currentApproach: ApproachSequence | null = null;

    for (const flip of sortedFlips) {
      const distance = flip.conditionSnapshot.distanceFromTrigger;

      // Update histogram
      distanceHistogram[distance] = (distanceHistogram[distance] ?? 0) + 1;

      // Track triggers
      if (distance === 0) {
        triggerCount++;
        if (currentApproach) {
          currentApproach.endBar = flip.barIndex;
          currentApproach.triggered = true;
          approachSequences.push(currentApproach);
          currentApproach = null;
        }
      } else {
        // Track closest approach without trigger
        if (distance < closestApproachWithoutTrigger) {
          closestApproachWithoutTrigger = distance;
        }

        // Track approach sequences
        if (!currentApproach) {
          // Start new approach
          currentApproach = {
            startBar: flip.barIndex,
            endBar: flip.barIndex,
            startDistance: distance,
            minDistance: distance,
            triggered: false,
            conditionType,
          };
        } else if (distance < currentApproach.minDistance) {
          // Getting closer
          currentApproach.minDistance = distance;
        } else if (distance > currentApproach.minDistance + 1) {
          // Retreating - end this approach
          currentApproach.endBar = flip.barIndex;
          approachSequences.push(currentApproach);
          currentApproach = {
            startBar: flip.barIndex,
            endBar: flip.barIndex,
            startDistance: distance,
            minDistance: distance,
            triggered: false,
            conditionType,
          };
        }
      }
    }

    // Don't forget incomplete approach
    if (currentApproach) {
      approachSequences.push(currentApproach);
    }

    analyses.push({
      conditionType,
      distanceHistogram,
      closestApproachWithoutTrigger: closestApproachWithoutTrigger === Infinity ? 0 : closestApproachWithoutTrigger,
      approachSequences,
      totalEvaluations,
      triggerCount,
    });
  }

  return analyses;
}

// =============================================================================
// STATE DISTRIBUTION
// =============================================================================

/**
 * Calculate time spent in each position state.
 */
function calculateStateDistribution(
  stateEvents: StateTransitionEvent[],
  totalBars: number
): AlgoMetrics["stateDistribution"] {
  if (stateEvents.length === 0 || totalBars === 0) {
    return {
      pctTimeFlat: 1,
      pctTimeLong: 0,
      pctTimeShort: 0,
      avgTimeFlatBars: totalBars,
      avgTimeLongBars: 0,
      avgTimeShortBars: 0,
    };
  }

  // Sort by bar index
  const sortedEvents = [...stateEvents].sort((a, b) => a.barIndex - b.barIndex);

  // Track time in each state
  const stateDurations: Record<string, number[]> = {
    FLAT: [],
    LONG: [],
    SHORT: [],
  };

  let lastBar = 0;
  let currentState = "FLAT";

  for (const event of sortedEvents) {
    const duration = event.barIndex - lastBar;
    if (duration > 0 && currentState in stateDurations) {
      stateDurations[currentState]!.push(duration);
    }
    lastBar = event.barIndex;
    currentState = event.toState;
  }

  // Add final duration
  const finalDuration = totalBars - lastBar;
  if (finalDuration > 0 && currentState in stateDurations) {
    stateDurations[currentState]!.push(finalDuration);
  }

  const flatDurations = stateDurations["FLAT"]!;
  const longDurations = stateDurations["LONG"]!;
  const shortDurations = stateDurations["SHORT"]!;

  const totalFlat = sum(flatDurations);
  const totalLong = sum(longDurations);
  const totalShort = sum(shortDurations);
  const totalTime = totalFlat + totalLong + totalShort;

  return {
    pctTimeFlat: totalTime > 0 ? totalFlat / totalTime : 1,
    pctTimeLong: totalTime > 0 ? totalLong / totalTime : 0,
    pctTimeShort: totalTime > 0 ? totalShort / totalTime : 0,
    avgTimeFlatBars: flatDurations.length > 0 ? mean(flatDurations) : 0,
    avgTimeLongBars: longDurations.length > 0 ? mean(longDurations) : 0,
    avgTimeShortBars: shortDurations.length > 0 ? mean(shortDurations) : 0,
  };
}

// =============================================================================
// EXIT REASON BREAKDOWN
// =============================================================================

/**
 * Count exits by reason from state transition events.
 */
function calculateExitReasonBreakdown(
  stateEvents: StateTransitionEvent[]
): AlgoMetrics["exitReasonBreakdown"] {
  const breakdown = {
    signal: 0,
    stopLoss: 0,
    takeProfit: 0,
    trailingStop: 0,
    endOfBacktest: 0,
  };

  for (const event of stateEvents) {
    // Only count transitions TO FLAT (exits)
    if (event.toState === "FLAT") {
      switch (event.reason) {
        case "EXIT_SIGNAL":
          breakdown.signal++;
          break;
        case "STOP_LOSS":
          breakdown.stopLoss++;
          break;
        case "TAKE_PROFIT":
          breakdown.takeProfit++;
          break;
        case "TRAILING_STOP":
          breakdown.trailingStop++;
          break;
        case "END_OF_BACKTEST":
          breakdown.endOfBacktest++;
          break;
      }
    }
  }

  return breakdown;
}

// =============================================================================
// CONDITION TRIGGER COUNTS
// =============================================================================

/**
 * Count how many times each condition type was triggered.
 */
function calculateConditionTriggerCounts(
  conditionEvents: ConditionChangeEvent[]
): Record<ConditionType, number> {
  const counts: Record<ConditionType, number> = {
    LONG_ENTRY: 0,
    LONG_EXIT: 0,
    SHORT_ENTRY: 0,
    SHORT_EXIT: 0,
  };

  for (const event of conditionEvents) {
    // Only count when condition becomes true (triggered)
    if (event.newState) {
      counts[event.conditionType]++;
    }
  }

  return counts;
}

// Note: sum() and mean() imported from ../utils/math.ts
