/**
 * Event Extractor - Extract Simulation Events from Signal Arrays
 *
 * @module simulation/event-extractor
 * @description
 * Converts pre-calculated boolean signal arrays into simulation events.
 * This is the bridge between indicator calculation (Stage 2) and
 * event-driven simulation (Stage 5).
 *
 * @architecture
 * Two-step extraction:
 * 1. Signal Crossing Events: Scan boolean arrays for transitions
 * 2. Condition Events: Derive when conditions become met/unmet
 *
 * The same indicator can appear in multiple conditions (e.g., RSI
 * used for both LONG_ENTRY and SHORT_EXIT). Each transition generates
 * separate events for each condition.
 *
 * @performance
 * - O(n) scan per indicator where n = signal array length
 * - Condition events derived in second pass from crossings
 * - Expected: ~1,000 events from ~400,000 bars
 *
 * @audit-trail
 * - Created: 2026-01-09 (Event-Driven Simulation Implementation)
 * - Purpose: Enable pre-calculation of all simulation events
 */

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

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of event extraction.
 */
export interface EventExtractionResult {
    /** All signal crossing events (raw indicator transitions) */
    signalCrossingEvents: SignalCrossingEvent[];

    /** Condition met events (entry/exit conditions became satisfied) */
    conditionMetEvents: ConditionMetEvent[];

    /** Condition unmet events (entry/exit conditions became unsatisfied) */
    conditionUnmetEvents: ConditionUnmetEvent[];

    /** Extraction statistics */
    stats: EventExtractionStats;
}

/**
 * Statistics about the extraction process.
 */
export interface EventExtractionStats {
    /** Total signal crossings found */
    totalSignalCrossings: number;

    /** Crossings by condition type */
    crossingsByCondition: Record<ConditionType, number>;

    /** Rising edge crossings (false → true) */
    risingEdgeCount: number;

    /** Falling edge crossings (true → false) */
    fallingEdgeCount: number;

    /** Condition met event count */
    conditionMetCount: number;

    /** Condition unmet event count */
    conditionUnmetCount: number;

    /** Indicators processed */
    indicatorsProcessed: number;

    /** Bars scanned */
    barsScanned: number;
}

/**
 * Maps indicator cache key → usage info in conditions.
 * An indicator can be used in multiple conditions.
 */
interface IndicatorUsage {
    conditionType: ConditionType;
    isRequired: boolean;
}

/**
 * Condition state tracker for deriving condition events.
 */
interface ConditionTracker {
    /** Required indicator keys for this condition */
    requiredKeys: Set<string>;
    /** Optional indicator keys for this condition */
    optionalKeys: Set<string>;
    /** Current state of each indicator (initially false) */
    indicatorStates: Map<string, boolean>;
    /** Previous condition met state */
    previousMet: boolean;
}

// =============================================================================
// MAIN EXTRACTION FUNCTION
// =============================================================================

/**
 * Extract all simulation events from signal arrays.
 *
 * @param signalCache - Map of indicator key → boolean signal array
 * @param indicatorInfoMap - Map of composite key → IndicatorInfo
 * @param timestamps - Timestamp for each bar index
 * @returns EventExtractionResult with all extracted events
 *
 * @example
 * ```typescript
 * const result = extractSimulationEvents(
 *     resamplingResult.resampledSignals,
 *     initResult.indicatorInfoMap,
 *     resamplingResult.simulationTimestamps
 * );
 *
 * // Build heap from events
 * const heap = mergeIntoHeap(
 *     result.signalCrossingEvents,
 *     result.conditionMetEvents,
 *     result.conditionUnmetEvents
 * );
 * ```
 */
export function extractSimulationEvents(
    signalCache: Map<string, boolean[]>,
    indicatorInfoMap: Map<string, IndicatorInfo>,
    timestamps: number[],
    warmupBars: number = 0
): EventExtractionResult {
    // Step 1: Build reverse mapping (indicator key → usages in conditions)
    const indicatorUsages = buildIndicatorUsageMap(indicatorInfoMap);

    // Step 2: Extract signal crossing events (skip warmup period)
    const signalCrossingEvents = extractSignalCrossingEvents(
        signalCache,
        indicatorUsages,
        timestamps,
        warmupBars
    );

    // Step 3: Derive condition events from crossings
    const { conditionMetEvents, conditionUnmetEvents } = deriveConditionEvents(
        signalCrossingEvents,
        indicatorInfoMap,
        timestamps.length
    );

    // Step 4: Compute statistics
    const stats = computeExtractionStats(
        signalCrossingEvents,
        conditionMetEvents,
        conditionUnmetEvents,
        indicatorUsages.size,
        timestamps.length
    );

    return {
        signalCrossingEvents,
        conditionMetEvents,
        conditionUnmetEvents,
        stats,
    };
}

// =============================================================================
// SIGNAL CROSSING EXTRACTION
// =============================================================================

/**
 * Build reverse mapping from indicator cache key to its usages.
 *
 * @param indicatorInfoMap - Map of composite key → IndicatorInfo
 * @returns Map of indicator key → array of usages
 */
function buildIndicatorUsageMap(
    indicatorInfoMap: Map<string, IndicatorInfo>
): Map<string, IndicatorUsage[]> {
    const usageMap = new Map<string, IndicatorUsage[]>();

    for (const info of indicatorInfoMap.values()) {
        const usages = usageMap.get(info.indicatorKey) ?? [];
        usages.push({
            conditionType: info.conditionType,
            isRequired: info.isRequired,
        });
        usageMap.set(info.indicatorKey, usages);
    }

    return usageMap;
}

/**
 * Extract signal crossing events by scanning boolean arrays.
 *
 * For each transition (false→true or true→false), creates an event
 * for each condition that uses the indicator.
 *
 * @param signalCache - Map of indicator key → boolean signal array
 * @param indicatorUsages - Map of indicator key → usages
 * @param timestamps - Timestamp for each bar index
 * @param warmupBars - Number of bars to skip (warmup period)
 * @returns Array of signal crossing events
 */
function extractSignalCrossingEvents(
    signalCache: Map<string, boolean[]>,
    indicatorUsages: Map<string, IndicatorUsage[]>,
    timestamps: number[],
    warmupBars: number = 0
): SignalCrossingEvent[] {
    const events: SignalCrossingEvent[] = [];

    for (const [indicatorKey, signals] of signalCache) {
        const usages = indicatorUsages.get(indicatorKey);
        if (!usages || usages.length === 0) {
            // Indicator not used in any condition (shouldn't happen normally)
            continue;
        }

        // Start scanning at the trading start (warmupBars marks where trading begins)
        const startIndex = Math.max(0, warmupBars);
        const initialValue = signals[startIndex] ?? false;

        // CRITICAL FIX: If signal is already TRUE when trading starts, generate an
        // initial crossing event. This handles the case where the EMA crossover
        // happened during pre-warming and the condition is already met at trading start.
        // Without this, we'd miss the first entry when trading begins with signal=true.
        if (initialValue === true) {
            // Note: Fallback `startIndex * 60` is defensive only - timestamps are always
            // provided from candle data in practice. See stages/index.ts line 343.
            const timestamp = timestamps[startIndex] ?? startIndex * 60;
            for (const usage of usages) {
                events.push(
                    createSignalCrossingEvent({
                        timestamp,
                        barIndex: startIndex,
                        indicatorKey,
                        conditionType: usage.conditionType,
                        isRequired: usage.isRequired,
                        previousValue: false, // Treat as transition from false→true
                        newValue: true,
                    })
                );
            }
        }

        let previousValue = initialValue;

        // Scan for subsequent transitions
        for (let barIndex = startIndex + 1; barIndex < signals.length; barIndex++) {
            const currentValue = signals[barIndex] ?? false;

            // Check for transition
            if (currentValue !== previousValue) {
                const timestamp = timestamps[barIndex] ?? barIndex * 60;

                // Create event for each condition that uses this indicator
                for (const usage of usages) {
                    events.push(
                        createSignalCrossingEvent({
                            timestamp,
                            barIndex,
                            indicatorKey,
                            conditionType: usage.conditionType,
                            isRequired: usage.isRequired,
                            previousValue,
                            newValue: currentValue,
                        })
                    );
                }
            }

            previousValue = currentValue;
        }
    }

    // Sort by timestamp for heap initialization
    events.sort((a, b) => a.timestamp - b.timestamp || a.barIndex - b.barIndex);

    return events;
}

// =============================================================================
// CONDITION EVENT DERIVATION
// =============================================================================

/**
 * Derive condition met/unmet events from signal crossings.
 *
 * Simulates condition evaluation at each crossing to determine
 * when conditions become met or unmet.
 *
 * @param crossingEvents - All signal crossing events (sorted by timestamp)
 * @param indicatorInfoMap - Map of composite key → IndicatorInfo
 * @param totalBars - Total number of bars
 * @returns Condition met and unmet events
 */
function deriveConditionEvents(
    crossingEvents: SignalCrossingEvent[],
    indicatorInfoMap: Map<string, IndicatorInfo>,
    _totalBars: number
): { conditionMetEvents: ConditionMetEvent[]; conditionUnmetEvents: ConditionUnmetEvent[] } {
    const conditionMetEvents: ConditionMetEvent[] = [];
    const conditionUnmetEvents: ConditionUnmetEvent[] = [];

    // Initialize condition trackers
    const trackers = initializeConditionTrackers(indicatorInfoMap);

    // Process crossings in timestamp order
    for (const crossing of crossingEvents) {
        const tracker = trackers.get(crossing.conditionType);
        if (!tracker) continue;

        // Update indicator state
        tracker.indicatorStates.set(crossing.indicatorKey, crossing.newValue);

        // Evaluate condition
        const currentMet = evaluateCondition(tracker);

        // Check for condition state change
        if (currentMet !== tracker.previousMet) {
            if (currentMet) {
                // Condition became met
                conditionMetEvents.push(
                    createConditionMetEvent({
                        timestamp: crossing.timestamp,
                        barIndex: crossing.barIndex,
                        conditionType: crossing.conditionType,
                        triggeringIndicatorKey: crossing.indicatorKey,
                    })
                );
            } else {
                // Condition became unmet
                conditionUnmetEvents.push(
                    createConditionUnmetEvent({
                        timestamp: crossing.timestamp,
                        barIndex: crossing.barIndex,
                        conditionType: crossing.conditionType,
                        triggeringIndicatorKey: crossing.indicatorKey,
                    })
                );
            }
            tracker.previousMet = currentMet;
        }
    }

    return { conditionMetEvents, conditionUnmetEvents };
}

/**
 * Initialize condition trackers from indicator info.
 */
function initializeConditionTrackers(
    indicatorInfoMap: Map<string, IndicatorInfo>
): Map<ConditionType, ConditionTracker> {
    const trackers = new Map<ConditionType, ConditionTracker>();

    // Group indicators by condition
    for (const info of indicatorInfoMap.values()) {
        let tracker = trackers.get(info.conditionType);
        if (!tracker) {
            tracker = {
                requiredKeys: new Set(),
                optionalKeys: new Set(),
                indicatorStates: new Map(),
                previousMet: false,
            };
            trackers.set(info.conditionType, tracker);
        }

        if (info.isRequired) {
            tracker.requiredKeys.add(info.indicatorKey);
        } else {
            tracker.optionalKeys.add(info.indicatorKey);
        }
        tracker.indicatorStates.set(info.indicatorKey, false);
    }

    return trackers;
}

/**
 * Evaluate if a condition is currently met.
 *
 * Condition is met when:
 * - ALL required indicators are true
 * - At least ONE optional indicator is true (if any optional exist)
 */
function evaluateCondition(tracker: ConditionTracker): boolean {
    // Check all required indicators
    for (const key of tracker.requiredKeys) {
        if (!tracker.indicatorStates.get(key)) {
            return false;
        }
    }

    // If no optional indicators, condition is met if all required are true
    if (tracker.optionalKeys.size === 0) {
        return true;
    }

    // Check at least one optional is true
    for (const key of tracker.optionalKeys) {
        if (tracker.indicatorStates.get(key)) {
            return true;
        }
    }

    return false;
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Compute extraction statistics.
 */
function computeExtractionStats(
    signalCrossingEvents: SignalCrossingEvent[],
    conditionMetEvents: ConditionMetEvent[],
    conditionUnmetEvents: ConditionUnmetEvent[],
    indicatorsProcessed: number,
    barsScanned: number
): EventExtractionStats {
    const crossingsByCondition: Record<ConditionType, number> = {
        LONG_ENTRY: 0,
        LONG_EXIT: 0,
        SHORT_ENTRY: 0,
        SHORT_EXIT: 0,
    };

    let risingEdgeCount = 0;
    let fallingEdgeCount = 0;

    for (const event of signalCrossingEvents) {
        crossingsByCondition[event.conditionType]++;
        if (event.newValue) {
            risingEdgeCount++;
        } else {
            fallingEdgeCount++;
        }
    }

    return {
        totalSignalCrossings: signalCrossingEvents.length,
        crossingsByCondition,
        risingEdgeCount,
        fallingEdgeCount,
        conditionMetCount: conditionMetEvents.length,
        conditionUnmetCount: conditionUnmetEvents.length,
        indicatorsProcessed,
        barsScanned,
    };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get the first bar where a condition becomes met.
 * Useful for finding entry points.
 *
 * @param conditionMetEvents - Array of condition met events
 * @param conditionType - Which condition to find
 * @param afterBar - Only consider events after this bar (optional)
 * @returns Bar index where condition first becomes met, or -1 if never
 */
export function findFirstConditionMet(
    conditionMetEvents: ConditionMetEvent[],
    conditionType: ConditionType,
    afterBar: number = -1
): number {
    for (const event of conditionMetEvents) {
        if (event.conditionType === conditionType && event.barIndex > afterBar) {
            return event.barIndex;
        }
    }
    return -1;
}

/**
 * Get all crossing events for a specific indicator.
 *
 * @param events - All signal crossing events
 * @param indicatorKey - Indicator cache key to filter by
 * @returns Filtered events for that indicator
 */
export function getCrossingsForIndicator(
    events: SignalCrossingEvent[],
    indicatorKey: string
): SignalCrossingEvent[] {
    return events.filter((e) => e.indicatorKey === indicatorKey);
}

/**
 * Get all condition events for a specific condition type.
 *
 * @param metEvents - Condition met events
 * @param unmetEvents - Condition unmet events
 * @param conditionType - Condition type to filter by
 * @returns Combined and sorted events for that condition
 */
export function getEventsForCondition(
    metEvents: ConditionMetEvent[],
    unmetEvents: ConditionUnmetEvent[],
    conditionType: ConditionType
): (ConditionMetEvent | ConditionUnmetEvent)[] {
    const filtered = [
        ...metEvents.filter((e) => e.conditionType === conditionType),
        ...unmetEvents.filter((e) => e.conditionType === conditionType),
    ];
    return filtered.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Check if the extracted events show any trading opportunities.
 * Useful for early validation before running simulation.
 *
 * @param result - Event extraction result
 * @returns Summary of trading opportunities
 */
export function summarizeOpportunities(result: EventExtractionResult): {
    hasLongOpportunities: boolean;
    hasShortOpportunities: boolean;
    longEntryCount: number;
    shortEntryCount: number;
} {
    let longEntryCount = 0;
    let shortEntryCount = 0;

    for (const event of result.conditionMetEvents) {
        if (event.conditionType === "LONG_ENTRY") longEntryCount++;
        if (event.conditionType === "SHORT_ENTRY") shortEntryCount++;
    }

    return {
        hasLongOpportunities: longEntryCount > 0,
        hasShortOpportunities: shortEntryCount > 0,
        longEntryCount,
        shortEntryCount,
    };
}
