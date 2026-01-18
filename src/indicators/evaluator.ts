/**
 * Condition Evaluator - Evaluates entry/exit conditions at a specific candle index using pre-calculated signals.
 */

import { makeIndicator } from "@indicators/factory.ts";
import type { SignalCache } from "./calculator.ts";
import type { EntryCondition, ExitCondition, IndicatorConfig } from "../core/types.ts";

// CORE EVALUATION LOGIC

function isIndicatorSignaling(config: IndicatorConfig, candleIndex: number, cache: SignalCache): boolean {
    const indicator = makeIndicator(config);
    const key = indicator.getCacheKey();
    const signals = cache.get(key);

    if (!signals) {
        console.warn(`Indicator not found in cache: ${key}`); // Shouldn't happen if setup is correct
        return false;
    }
    return signals[candleIndex] ?? false;
}

export function evaluateCondition(condition: EntryCondition | ExitCondition, candleIndex: number, cache: SignalCache): boolean {
    for (const config of condition.required) { // Check required indicators (ALL must signal)
        if (!isIndicatorSignaling(config, candleIndex, cache)) return false;
    }

    if (condition.optional.length === 0) return true; // No optional = required alone is sufficient

    for (const config of condition.optional) { // Check optional indicators (at least ONE must signal)
        if (isIndicatorSignaling(config, candleIndex, cache)) return true;
    }
    return false; // No optional indicators signaled
}

// EDGE DETECTION (for event generation)

export function detectConditionEdge(condition: EntryCondition | ExitCondition, candleIndex: number, cache: SignalCache): boolean {
    if (candleIndex === 0) return evaluateCondition(condition, candleIndex, cache); // Can't have edge on first candle

    const isTrue = evaluateCondition(condition, candleIndex, cache);
    const wasTrueBefore = evaluateCondition(condition, candleIndex - 1, cache);
    return isTrue && !wasTrueBefore; // Edge = wasn't true before, but is true now
}
