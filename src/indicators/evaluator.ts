/**
 * Condition Evaluator
 *
 * Evaluates entry/exit conditions at a specific candle index.
 * Uses pre-calculated signals from the SignalCache.
 */

import { makeIndicator } from "@indicators/factory.ts";
import type { SignalCache } from "./calculator.ts";
import type { EntryCondition, ExitCondition, IndicatorConfig } from "../core/types.ts";

// =============================================================================
// CORE EVALUATION LOGIC
// =============================================================================

/**
 * Check if a single indicator is signaling at the given candle index.
 *
 * @param config - The indicator configuration
 * @param candleIndex - Which candle to check
 * @param cache - Pre-calculated signals
 * @returns true if indicator is signaling
 */
function isIndicatorSignaling(
  config: IndicatorConfig,
  candleIndex: number,
  cache: SignalCache
): boolean {
  const indicator = makeIndicator(config);
  const key = indicator.getCacheKey();
  const signals = cache.get(key);

  if (!signals) {
    // Indicator wasn't calculated - shouldn't happen if setup is correct
    console.warn(`Indicator not found in cache: ${key}`);
    return false;
  }

  return signals[candleIndex] ?? false;
}

/**
 * Evaluate an entry or exit condition at a specific candle.
 *
 * Logic:
 *   - ALL required indicators must signal (AND)
 *   - If optional is not empty, at least ONE must signal (OR)
 *   - If optional is empty, required alone is sufficient
 *
 * @param condition - The entry or exit condition
 * @param candleIndex - Which candle to check
 * @param cache - Pre-calculated signals
 * @returns true if condition is met
 */
export function evaluateCondition(
  condition: EntryCondition | ExitCondition,
  candleIndex: number,
  cache: SignalCache
): boolean {
  // Check required indicators (ALL must signal)
  for (const config of condition.required) {
    if (!isIndicatorSignaling(config, candleIndex, cache)) {
      return false; // One required indicator not signaling = condition not met
    }
  }

  // If no optional indicators, required alone is sufficient
  if (condition.optional.length === 0) {
    return true;
  }

  // Check optional indicators (at least ONE must signal)
  for (const config of condition.optional) {
    if (isIndicatorSignaling(config, candleIndex, cache)) {
      return true; // Found one optional signaling = condition met
    }
  }

  // No optional indicators signaled
  return false;
}

// =============================================================================
// EDGE DETECTION (for event generation)
// =============================================================================

/**
 * Detect when a condition transitions from false → true.
 *
 * We don't want to fire an event every candle the condition is true.
 * We only want to fire when it BECOMES true (the "edge").
 *
 * @param condition - The entry or exit condition
 * @param candleIndex - Current candle to check
 * @param cache - Pre-calculated signals
 * @returns true if condition just became true (wasn't true on previous candle)
 */
export function detectConditionEdge(
  condition: EntryCondition | ExitCondition,
  candleIndex: number,
  cache: SignalCache
): boolean {
  // Can't have an edge on the first candle
  if (candleIndex === 0) {
    return evaluateCondition(condition, candleIndex, cache);
  }

  const isTrue = evaluateCondition(condition, candleIndex, cache);
  const wasTrueBefore = evaluateCondition(condition, candleIndex - 1, cache);

  // Edge = wasn't true before, but is true now
  return isTrue && !wasTrueBefore;
}
