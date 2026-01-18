/** Event Extractor - Converts pre-calculated boolean signal arrays into simulation events. Bridge between Stage 2 and Stage 5. */

import type { IndicatorInfo } from "../events/collector.ts";
import type { ConditionType } from "../events/types.ts";
import {
    createSignalCrossingEvent,
    createConditionMetEvent,
    createConditionUnmetEvent,
    type SignalCrossingEvent,
    type ConditionMetEvent,
    type ConditionUnmetEvent,
} from "../events/simulation-events.ts";

export interface EventExtractionResult {
    signalCrossingEvents: SignalCrossingEvent[];                                // Raw indicator transitions
    conditionMetEvents: ConditionMetEvent[];                                    // Entry/exit conditions became satisfied
    conditionUnmetEvents: ConditionUnmetEvent[];                                // Entry/exit conditions became unsatisfied
    stats: EventExtractionStats;                                                // Extraction statistics
}

export interface EventExtractionStats {
    totalSignalCrossings: number;                                               // Total signal crossings found
    crossingsByCondition: Record<ConditionType, number>;                        // Crossings by condition type
    risingEdgeCount: number;                                                    // Rising edge crossings (false → true)
    fallingEdgeCount: number;                                                   // Falling edge crossings (true → false)
    conditionMetCount: number;                                                  // Condition met event count
    conditionUnmetCount: number;                                                // Condition unmet event count
    indicatorsProcessed: number;                                                // Indicators processed
    barsScanned: number;                                                        // Bars scanned
}

interface IndicatorUsage {
    conditionType: ConditionType;                                               // Which condition uses this indicator
    isRequired: boolean;                                                        // Required vs optional
}

interface ConditionTracker {
    requiredKeys: Set<string>;                                                  // Required indicator keys for this condition
    optionalKeys: Set<string>;                                                  // Optional indicator keys for this condition
    indicatorStates: Map<string, boolean>;                                      // Current state of each indicator (initially false)
    previousMet: boolean;                                                       // Previous condition met state
}

/** Extract all simulation events from signal arrays. O(n) scan per indicator. */
export function extractSimulationEvents(
    signalCache: Map<string, boolean[]>,
    indicatorInfoMap: Map<string, IndicatorInfo>,
    timestamps: number[],
    warmupBars: number = 0
): EventExtractionResult {
    const indicatorUsages = buildIndicatorUsageMap(indicatorInfoMap);           // Build reverse mapping (indicator key → usages in conditions)
    const signalCrossingEvents = extractSignalCrossingEvents(signalCache, indicatorUsages, timestamps, warmupBars);
    const { conditionMetEvents, conditionUnmetEvents } = deriveConditionEvents(signalCrossingEvents, indicatorInfoMap, timestamps.length);
    const stats = computeExtractionStats(signalCrossingEvents, conditionMetEvents, conditionUnmetEvents, indicatorUsages.size, timestamps.length);
    return { signalCrossingEvents, conditionMetEvents, conditionUnmetEvents, stats };
}

/** Build reverse mapping from indicator cache key to its usages. */
function buildIndicatorUsageMap(indicatorInfoMap: Map<string, IndicatorInfo>): Map<string, IndicatorUsage[]> {
    const usageMap = new Map<string, IndicatorUsage[]>();
    for (const info of indicatorInfoMap.values()) {
        const usages = usageMap.get(info.indicatorKey) ?? [];
        usages.push({ conditionType: info.conditionType, isRequired: info.isRequired });
        usageMap.set(info.indicatorKey, usages);
    }
    return usageMap;
}

/** Extract signal crossing events by scanning boolean arrays. For each transition, creates events for each condition using the indicator. */
function extractSignalCrossingEvents(
    signalCache: Map<string, boolean[]>,
    indicatorUsages: Map<string, IndicatorUsage[]>,
    timestamps: number[],
    warmupBars: number = 0
): SignalCrossingEvent[] {
    const events: SignalCrossingEvent[] = [];

    for (const [indicatorKey, signals] of signalCache) {
        const usages = indicatorUsages.get(indicatorKey);
        if (!usages || usages.length === 0) continue;                           // Indicator not used in any condition

        const startIndex = Math.max(0, warmupBars);                             // Start scanning at trading start
        const initialValue = signals[startIndex] ?? false;

        if (initialValue === true) {                                            // Signal already TRUE at trading start - generate initial crossing event
            const timestamp = timestamps[startIndex] ?? startIndex * 60;        // Fallback defensive only - timestamps always provided
            for (const usage of usages) {
                events.push(createSignalCrossingEvent({
                    timestamp, barIndex: startIndex, indicatorKey,
                    conditionType: usage.conditionType, isRequired: usage.isRequired,
                    previousValue: false, newValue: true,                        // Treat as transition from false→true
                }));
            }
        }

        let previousValue = initialValue;
        for (let barIndex = startIndex + 1; barIndex < signals.length; barIndex++) {
            const currentValue = signals[barIndex] ?? false;
            if (currentValue !== previousValue) {                               // Transition detected
                const timestamp = timestamps[barIndex] ?? barIndex * 60;
                for (const usage of usages) {
                    events.push(createSignalCrossingEvent({
                        timestamp, barIndex, indicatorKey,
                        conditionType: usage.conditionType, isRequired: usage.isRequired,
                        previousValue, newValue: currentValue,
                    }));
                }
            }
            previousValue = currentValue;
        }
    }

    events.sort((a, b) => a.timestamp - b.timestamp || a.barIndex - b.barIndex); // Sort by timestamp for heap initialization
    return events;
}

/** Derive condition met/unmet events from signal crossings. Simulates condition evaluation at each crossing. */
function deriveConditionEvents(
    crossingEvents: SignalCrossingEvent[],
    indicatorInfoMap: Map<string, IndicatorInfo>,
    _totalBars: number
): { conditionMetEvents: ConditionMetEvent[]; conditionUnmetEvents: ConditionUnmetEvent[] } {
    const conditionMetEvents: ConditionMetEvent[] = [];
    const conditionUnmetEvents: ConditionUnmetEvent[] = [];
    const trackers = initializeConditionTrackers(indicatorInfoMap);

    for (const crossing of crossingEvents) {
        const tracker = trackers.get(crossing.conditionType);
        if (!tracker) continue;

        tracker.indicatorStates.set(crossing.indicatorKey, crossing.newValue);  // Update indicator state
        const currentMet = evaluateCondition(tracker);

        if (currentMet !== tracker.previousMet) {                               // Condition state changed
            if (currentMet) {
                conditionMetEvents.push(createConditionMetEvent({
                    timestamp: crossing.timestamp, barIndex: crossing.barIndex,
                    conditionType: crossing.conditionType, triggeringIndicatorKey: crossing.indicatorKey,
                }));
            } else {
                conditionUnmetEvents.push(createConditionUnmetEvent({
                    timestamp: crossing.timestamp, barIndex: crossing.barIndex,
                    conditionType: crossing.conditionType, triggeringIndicatorKey: crossing.indicatorKey,
                }));
            }
            tracker.previousMet = currentMet;
        }
    }

    return { conditionMetEvents, conditionUnmetEvents };
}

/** Initialize condition trackers from indicator info. Groups indicators by condition. */
function initializeConditionTrackers(indicatorInfoMap: Map<string, IndicatorInfo>): Map<ConditionType, ConditionTracker> {
    const trackers = new Map<ConditionType, ConditionTracker>();

    for (const info of indicatorInfoMap.values()) {
        let tracker = trackers.get(info.conditionType);
        if (!tracker) {
            tracker = { requiredKeys: new Set(), optionalKeys: new Set(), indicatorStates: new Map(), previousMet: false };
            trackers.set(info.conditionType, tracker);
        }
        if (info.isRequired) tracker.requiredKeys.add(info.indicatorKey);
        else tracker.optionalKeys.add(info.indicatorKey);
        tracker.indicatorStates.set(info.indicatorKey, false);
    }

    return trackers;
}

/** Evaluate if a condition is currently met. ALL required must be true, at least ONE optional (if any exist). */
function evaluateCondition(tracker: ConditionTracker): boolean {
    for (const key of tracker.requiredKeys) {
        if (!tracker.indicatorStates.get(key)) return false;                    // Required indicator not met
    }
    if (tracker.optionalKeys.size === 0) return true;                           // No optional indicators, condition met
    for (const key of tracker.optionalKeys) {
        if (tracker.indicatorStates.get(key)) return true;                      // At least one optional is true
    }
    return false;
}

/** Compute extraction statistics. */
function computeExtractionStats(
    signalCrossingEvents: SignalCrossingEvent[],
    conditionMetEvents: ConditionMetEvent[],
    conditionUnmetEvents: ConditionUnmetEvent[],
    indicatorsProcessed: number,
    barsScanned: number
): EventExtractionStats {
    const crossingsByCondition: Record<ConditionType, number> = { LONG_ENTRY: 0, LONG_EXIT: 0, SHORT_ENTRY: 0, SHORT_EXIT: 0 };
    let risingEdgeCount = 0, fallingEdgeCount = 0;

    for (const event of signalCrossingEvents) {
        crossingsByCondition[event.conditionType]++;
        if (event.newValue) risingEdgeCount++;
        else fallingEdgeCount++;
    }

    return {
        totalSignalCrossings: signalCrossingEvents.length, crossingsByCondition, risingEdgeCount, fallingEdgeCount,
        conditionMetCount: conditionMetEvents.length, conditionUnmetCount: conditionUnmetEvents.length,
        indicatorsProcessed, barsScanned,
    };
}

/** Get the first bar where a condition becomes met. Useful for finding entry points. Returns -1 if never. */
export function findFirstConditionMet(conditionMetEvents: ConditionMetEvent[], conditionType: ConditionType, afterBar: number = -1): number {
    for (const event of conditionMetEvents) {
        if (event.conditionType === conditionType && event.barIndex > afterBar) return event.barIndex;
    }
    return -1;
}

/** Get all crossing events for a specific indicator. */
export function getCrossingsForIndicator(events: SignalCrossingEvent[], indicatorKey: string): SignalCrossingEvent[] {
    return events.filter((e) => e.indicatorKey === indicatorKey);
}

/** Get all condition events for a specific condition type. Returns combined and sorted events. */
export function getEventsForCondition(
    metEvents: ConditionMetEvent[],
    unmetEvents: ConditionUnmetEvent[],
    conditionType: ConditionType
): (ConditionMetEvent | ConditionUnmetEvent)[] {
    const filtered = [...metEvents.filter((e) => e.conditionType === conditionType), ...unmetEvents.filter((e) => e.conditionType === conditionType)];
    return filtered.sort((a, b) => a.timestamp - b.timestamp);
}

/** Check if extracted events show trading opportunities. Useful for early validation before simulation. */
export function summarizeOpportunities(result: EventExtractionResult): {
    hasLongOpportunities: boolean;
    hasShortOpportunities: boolean;
    longEntryCount: number;
    shortEntryCount: number;
} {
    let longEntryCount = 0, shortEntryCount = 0;
    for (const event of result.conditionMetEvents) {
        if (event.conditionType === "LONG_ENTRY") longEntryCount++;
        if (event.conditionType === "SHORT_ENTRY") shortEntryCount++;
    }
    return { hasLongOpportunities: longEntryCount > 0, hasShortOpportunities: shortEntryCount > 0, longEntryCount, shortEntryCount };
}
