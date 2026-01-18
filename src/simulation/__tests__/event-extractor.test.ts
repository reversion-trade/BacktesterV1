/**
 * Event Extractor Unit Tests
 *
 * Tests for extracting simulation events from signal arrays.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
    extractSimulationEvents,
    findFirstConditionMet,
    getCrossingsForIndicator,
    getEventsForCondition,
    summarizeOpportunities,
} from "../event-extractor.ts";
import { resetEventIdCounter } from "../../events/simulation-events.ts";
import type { IndicatorInfo } from "../../events/collector.ts";
import type { ConditionType } from "../../events/types.ts";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createIndicatorInfo(
    indicatorKey: string,
    conditionType: ConditionType,
    isRequired: boolean = true
): IndicatorInfo {
    return {
        indicatorKey,
        indicatorType: "TEST",
        conditionType,
        isRequired,
    };
}

function buildIndicatorInfoMap(
    infos: Array<{ key: string; condition: ConditionType; required?: boolean }>
): Map<string, IndicatorInfo> {
    const map = new Map<string, IndicatorInfo>();
    for (const info of infos) {
        // Composite key: conditionType:indicatorKey
        const mapKey = `${info.condition}:${info.key}`;
        map.set(mapKey, createIndicatorInfo(info.key, info.condition, info.required ?? true));
    }
    return map;
}

function createTimestamps(count: number, startTime: number = 0, interval: number = 60): number[] {
    return Array.from({ length: count }, (_, i) => startTime + i * interval);
}

// =============================================================================
// BASIC EXTRACTION
// =============================================================================

describe("Event Extractor - Basic Extraction", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("extracts no events from empty signal cache", () => {
        const signalCache = new Map<string, boolean[]>();
        const indicatorInfoMap = new Map<string, IndicatorInfo>();
        const timestamps = createTimestamps(10);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.signalCrossingEvents.length).toBe(0);
        expect(result.conditionMetEvents.length).toBe(0);
        expect(result.conditionUnmetEvents.length).toBe(0);
    });

    test("extracts no events from all-false signals", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, false, false, false, false]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // No transitions means no events
        expect(result.signalCrossingEvents.length).toBe(0);
    });

    test("extracts single rising edge event", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, false, true, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.signalCrossingEvents.length).toBe(1);
        expect(result.signalCrossingEvents[0]!.barIndex).toBe(2);
        expect(result.signalCrossingEvents[0]!.previousValue).toBe(false);
        expect(result.signalCrossingEvents[0]!.newValue).toBe(true);
    });

    test("extracts single falling edge event", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [true, true, false, false, false]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // With warmupBars=0 (default) and signal starting TRUE:
        // - Bar 0: initial true state generates a "rising edge" event (false→true)
        // - Bar 2: transition true→false generates falling edge event
        expect(result.signalCrossingEvents.length).toBe(2);
        expect(result.signalCrossingEvents[0]!.barIndex).toBe(0); // initial true
        expect(result.signalCrossingEvents[1]!.barIndex).toBe(2); // true → false
    });

    test("extracts multiple transitions", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, false, true, false]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // Transitions at: bar 1 (false→true), bar 2 (true→false), bar 3 (false→true), bar 4 (true→false)
        expect(result.signalCrossingEvents.length).toBe(4);
        expect(result.signalCrossingEvents[0]!.barIndex).toBe(1);
        expect(result.signalCrossingEvents[1]!.barIndex).toBe(2);
        expect(result.signalCrossingEvents[2]!.barIndex).toBe(3);
        expect(result.signalCrossingEvents[3]!.barIndex).toBe(4);
    });

    test("events are sorted by timestamp", () => {
        const signalCache = new Map<string, boolean[]>();
        // First indicator transitions at bar 3
        signalCache.set("ema:14", [false, false, false, true, true]);
        // Second indicator transitions at bar 1
        signalCache.set("rsi:20", [false, true, true, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:14", condition: "LONG_ENTRY" },
            { key: "rsi:20", condition: "LONG_ENTRY" },
        ]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // Events should be sorted by timestamp (bar 1 before bar 3)
        expect(result.signalCrossingEvents[0]!.barIndex).toBe(1); // rsi at bar 1
        expect(result.signalCrossingEvents[1]!.barIndex).toBe(3); // ema at bar 3
    });
});

// =============================================================================
// MULTI-CONDITION INDICATORS
// =============================================================================

describe("Event Extractor - Multi-Condition Indicators", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("same indicator in multiple conditions creates multiple events", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("rsi:14", [false, true, true, true, true]);

        // RSI used in both LONG_ENTRY and SHORT_EXIT
        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "rsi:14", condition: "LONG_ENTRY" },
            { key: "rsi:14", condition: "SHORT_EXIT" },
        ]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // Should have 2 events for the single transition (one per condition)
        expect(result.signalCrossingEvents.length).toBe(2);
        expect(result.signalCrossingEvents[0]!.conditionType).toBe("LONG_ENTRY");
        expect(result.signalCrossingEvents[1]!.conditionType).toBe("SHORT_EXIT");
    });

    test("handles multiple indicators across conditions", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:9", [false, true, true, true]);
        signalCache.set("ema:21", [false, false, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:9", condition: "LONG_ENTRY" },
            { key: "ema:21", condition: "LONG_ENTRY" },
            { key: "ema:9", condition: "SHORT_ENTRY" },
        ]);
        const timestamps = createTimestamps(4);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // ema:9 rises at bar 1 → 2 events (LONG_ENTRY, SHORT_ENTRY)
        // ema:21 rises at bar 2 → 1 event (LONG_ENTRY)
        expect(result.signalCrossingEvents.length).toBe(3);
    });
});

// =============================================================================
// CONDITION EVENT DERIVATION
// =============================================================================

describe("Event Extractor - Condition Events", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("derives condition met for single required indicator", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, false, true, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.conditionMetEvents.length).toBe(1);
        expect(result.conditionMetEvents[0]!.conditionType).toBe("LONG_ENTRY");
        expect(result.conditionMetEvents[0]!.barIndex).toBe(2);
    });

    test("derives condition unmet when indicator falls", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, true, false, false]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.conditionMetEvents.length).toBe(1);
        expect(result.conditionUnmetEvents.length).toBe(1);
        expect(result.conditionUnmetEvents[0]!.barIndex).toBe(3);
    });

    test("condition met requires all required indicators", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:9", [false, true, true, true, true]);
        signalCache.set("ema:21", [false, false, false, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:9", condition: "LONG_ENTRY", required: true },
            { key: "ema:21", condition: "LONG_ENTRY", required: true },
        ]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // Condition met only when BOTH are true (bar 3)
        expect(result.conditionMetEvents.length).toBe(1);
        expect(result.conditionMetEvents[0]!.barIndex).toBe(3);
    });

    test("condition met with optional indicator when any optional is true", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:9", [false, true, true, true, true]); // Required - rises at bar 1
        signalCache.set("rsi:14", [false, true, true, true, true]); // Optional - rises at bar 1

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:9", condition: "LONG_ENTRY", required: true },
            { key: "rsi:14", condition: "LONG_ENTRY", required: false },
        ]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // Condition met when required + at least one optional is true
        expect(result.conditionMetEvents.length).toBe(1);
        expect(result.conditionMetEvents[0]!.barIndex).toBe(1);
    });

    test("condition not met if required true but all optional false", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:9", [false, true, true, true, true]); // Required - rises at bar 1
        signalCache.set("rsi:14", [false, false, false, true, true]); // Optional - rises at bar 3

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:9", condition: "LONG_ENTRY", required: true },
            { key: "rsi:14", condition: "LONG_ENTRY", required: false },
        ]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // Condition met at bar 3 when optional becomes true
        expect(result.conditionMetEvents.length).toBe(1);
        expect(result.conditionMetEvents[0]!.barIndex).toBe(3);
    });

    test("condition with no optional indicators is met when all required are true", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:9", [false, true, true, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:9", condition: "LONG_ENTRY", required: true },
        ]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.conditionMetEvents.length).toBe(1);
        expect(result.conditionMetEvents[0]!.barIndex).toBe(1);
    });
});

// =============================================================================
// STATISTICS
// =============================================================================

describe("Event Extractor - Statistics", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("computes correct statistics", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, false, true, false]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.stats.totalSignalCrossings).toBe(4);
        expect(result.stats.risingEdgeCount).toBe(2);
        expect(result.stats.fallingEdgeCount).toBe(2);
        expect(result.stats.barsScanned).toBe(5);
        expect(result.stats.indicatorsProcessed).toBe(1);
    });

    test("crossings by condition are tracked correctly", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, true, true]);
        signalCache.set("rsi:20", [false, false, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:14", condition: "LONG_ENTRY" },
            { key: "rsi:20", condition: "SHORT_ENTRY" },
        ]);
        const timestamps = createTimestamps(4);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.stats.crossingsByCondition["LONG_ENTRY"]).toBe(1);
        expect(result.stats.crossingsByCondition["SHORT_ENTRY"]).toBe(1);
    });
});

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

describe("Event Extractor - Utilities", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("findFirstConditionMet finds correct bar", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, false, true, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(findFirstConditionMet(result.conditionMetEvents, "LONG_ENTRY")).toBe(2);
        expect(findFirstConditionMet(result.conditionMetEvents, "SHORT_ENTRY")).toBe(-1);
    });

    test("findFirstConditionMet respects afterBar parameter", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, false, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // First met at bar 1, second at bar 3
        expect(findFirstConditionMet(result.conditionMetEvents, "LONG_ENTRY", 1)).toBe(3);
    });

    test("getCrossingsForIndicator filters correctly", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, true]);
        signalCache.set("rsi:20", [false, false, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:14", condition: "LONG_ENTRY" },
            { key: "rsi:20", condition: "LONG_ENTRY" },
        ]);
        const timestamps = createTimestamps(3);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        const emaCrossings = getCrossingsForIndicator(result.signalCrossingEvents, "ema:14");
        expect(emaCrossings.length).toBe(1);
        expect(emaCrossings[0]!.indicatorKey).toBe("ema:14");
    });

    test("getEventsForCondition combines met and unmet events", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, false, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(4);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        const events = getEventsForCondition(
            result.conditionMetEvents,
            result.conditionUnmetEvents,
            "LONG_ENTRY"
        );

        // Should have: met at bar 1, unmet at bar 2, met at bar 3
        expect(events.length).toBe(3);
        expect(events[0]!.eventType).toBe("CONDITION_MET");
        expect(events[1]!.eventType).toBe("CONDITION_UNMET");
        expect(events[2]!.eventType).toBe("CONDITION_MET");
    });

    test("summarizeOpportunities reports correctly", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, false, true, true]);
        signalCache.set("rsi:20", [false, false, true, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([
            { key: "ema:14", condition: "LONG_ENTRY" },
            { key: "rsi:20", condition: "SHORT_ENTRY" },
        ]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);
        const summary = summarizeOpportunities(result);

        expect(summary.hasLongOpportunities).toBe(true);
        expect(summary.hasShortOpportunities).toBe(true);
        expect(summary.longEntryCount).toBe(2); // bar 1, bar 3
        expect(summary.shortEntryCount).toBe(1); // bar 2
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("Event Extractor - Edge Cases", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("handles empty timestamps array", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", []);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps: number[] = [];

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.signalCrossingEvents.length).toBe(0);
    });

    test("handles signal cache with indicator not in info map", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("unknown:indicator", [false, true, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(3);

        // Should not throw, just skip the unknown indicator
        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        expect(result.signalCrossingEvents.length).toBe(0);
    });

    test("handles rapid oscillation", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [false, true, false, true, false, true]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(6);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // Should have 6 transitions
        expect(result.signalCrossingEvents.length).toBe(5); // 5 transitions from initial false
        expect(result.stats.risingEdgeCount).toBe(3);
        expect(result.stats.fallingEdgeCount).toBe(2);
    });

    test("handles signal starting with true", () => {
        const signalCache = new Map<string, boolean[]>();
        signalCache.set("ema:14", [true, true, true, false, false]);

        const indicatorInfoMap = buildIndicatorInfoMap([{ key: "ema:14", condition: "LONG_ENTRY" }]);
        const timestamps = createTimestamps(5);

        const result = extractSimulationEvents(signalCache, indicatorInfoMap, timestamps);

        // With warmupBars=0 (default) and signal starting TRUE:
        // - Bar 0: initial true generates a "rising edge" event (for immediate entry)
        // - Bar 3: true→false transition
        expect(result.signalCrossingEvents.length).toBe(2);
        expect(result.signalCrossingEvents[0]!.barIndex).toBe(0); // initial true
        expect(result.signalCrossingEvents[1]!.barIndex).toBe(3); // true → false
    });
});
