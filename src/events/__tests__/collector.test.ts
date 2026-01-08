/**
 * EventCollector Tests
 *
 * Tests for the EventCollector class which tracks indicator flips,
 * condition changes, swap events, and state transitions.
 *
 * @module events/__tests__/collector.test
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { EventCollector, type IndicatorInfo } from "../collector.ts";
import type { IndicatorFlipEvent, ConditionChangeEvent, StateTransitionEvent, ConditionType } from "../types.ts";

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create an indicator info object.
 */
function createIndicatorInfo(
    key: string,
    type: string,
    conditionType: ConditionType,
    isRequired: boolean
): IndicatorInfo {
    return {
        indicatorKey: key,
        indicatorType: type,
        conditionType,
        isRequired,
    };
}

/**
 * Create a map of indicator infos by key.
 */
function createIndicatorInfoMap(infos: IndicatorInfo[]): Map<string, IndicatorInfo> {
    return new Map(infos.map((info) => [info.indicatorKey, info]));
}

// =============================================================================
// CONSTRUCTOR AND INITIALIZATION
// =============================================================================

describe("EventCollector", () => {
    let collector: EventCollector;

    beforeEach(() => {
        collector = new EventCollector("BTC");
    });

    describe("constructor", () => {
        it("creates collector with asset symbol", () => {
            const btcCollector = new EventCollector("BTC");
            const ethCollector = new EventCollector("ETH");

            // Should use symbol in swap events
            expect(btcCollector).toBeDefined();
            expect(ethCollector).toBeDefined();
        });

        it("initializes with CASH state", () => {
            expect(collector.getCurrentState()).toBe("CASH");
        });

        it("initializes with no current trade", () => {
            expect(collector.getCurrentTradeId()).toBeNull();
        });
    });

    describe("registerIndicators", () => {
        it("registers indicators and groups by condition type", () => {
            const indicators = [
                createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true),
                createIndicatorInfo("macd", "MACD", "LONG_ENTRY", true),
                createIndicatorInfo("volume", "VOLUME", "LONG_ENTRY", false),
                createIndicatorInfo("rsi14_exit", "RSI", "LONG_EXIT", true),
            ];

            collector.registerIndicators(indicators);

            // Should be able to get snapshots for registered conditions
            const entrySnapshot = collector.getConditionSnapshot("LONG_ENTRY");
            const exitSnapshot = collector.getConditionSnapshot("LONG_EXIT");

            expect(entrySnapshot).not.toBeNull();
            expect(entrySnapshot!.requiredTotal).toBe(2);
            expect(entrySnapshot!.optionalTotal).toBe(1);

            expect(exitSnapshot).not.toBeNull();
            expect(exitSnapshot!.requiredTotal).toBe(1);
            expect(exitSnapshot!.optionalTotal).toBe(0);
        });

        it("returns null for unregistered condition types", () => {
            const indicators = [createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true)];
            collector.registerIndicators(indicators);

            const snapshot = collector.getConditionSnapshot("SHORT_ENTRY");
            expect(snapshot).toBeNull();
        });
    });
});

// =============================================================================
// INDICATOR UPDATES AND FLIP DETECTION
// =============================================================================

describe("updateIndicators", () => {
    let collector: EventCollector;
    let indicators: IndicatorInfo[];
    let indicatorInfoMap: Map<string, IndicatorInfo>;

    beforeEach(() => {
        collector = new EventCollector("BTC");
        indicators = [
            createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true),
            createIndicatorInfo("macd", "MACD", "LONG_ENTRY", true),
        ];
        indicatorInfoMap = createIndicatorInfoMap(indicators);
        collector.registerIndicators(indicators);
    });

    it("detects indicator flip from false to true", () => {
        // Initial state: all false
        const states1 = new Map<string, boolean>([
            ["rsi14", false],
            ["macd", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);

        // Bar 1: rsi14 flips to true
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);

        const events = collector.getEvents();
        const flipEvents = events.algoEvents.filter((e) => e.type === "INDICATOR_FLIP") as IndicatorFlipEvent[];

        expect(flipEvents.length).toBe(1);
        expect(flipEvents[0]!.indicatorKey).toBe("rsi14");
        expect(flipEvents[0]!.previousValue).toBe(false);
        expect(flipEvents[0]!.newValue).toBe(true);
        expect(flipEvents[0]!.barIndex).toBe(1);
    });

    it("detects indicator flip from true to false", () => {
        // Set initial state (this causes a flip from false→true for rsi14)
        const states1 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);

        // Bar 1: rsi14 flips to false
        const states2 = new Map<string, boolean>([
            ["rsi14", false],
            ["macd", false],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);

        const events = collector.getEvents();
        const flipEvents = events.algoEvents.filter((e) => e.type === "INDICATOR_FLIP") as IndicatorFlipEvent[];

        // 2 flips: bar 0 (false→true), bar 1 (true→false)
        expect(flipEvents.length).toBe(2);

        // Find the true→false flip at bar 1
        const trueToFalseFlip = flipEvents.find((e) => e.barIndex === 1 && e.indicatorKey === "rsi14");
        expect(trueToFalseFlip).toBeDefined();
        expect(trueToFalseFlip!.previousValue).toBe(true);
        expect(trueToFalseFlip!.newValue).toBe(false);
    });

    it("does not emit flip event when no change", () => {
        const states = new Map<string, boolean>([
            ["rsi14", false],
            ["macd", false],
        ]);

        collector.updateIndicators(0, 1000, states, indicatorInfoMap);
        collector.updateIndicators(1, 1001, states, indicatorInfoMap);

        const events = collector.getEvents();
        const flipEvents = events.algoEvents.filter((e) => e.type === "INDICATOR_FLIP");

        expect(flipEvents.length).toBe(0);
    });

    it("includes condition snapshot in flip event", () => {
        // Set up: one indicator true, one false
        const states1 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);

        // Flip macd to true
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);

        const events = collector.getEvents();
        const flipEvent = events.algoEvents.find(
            (e) => e.type === "INDICATOR_FLIP" && (e as IndicatorFlipEvent).indicatorKey === "macd"
        ) as IndicatorFlipEvent;

        expect(flipEvent.conditionSnapshot.requiredTrue).toBe(2);
        expect(flipEvent.conditionSnapshot.requiredTotal).toBe(2);
        expect(flipEvent.conditionSnapshot.conditionMet).toBe(true);
        expect(flipEvent.conditionSnapshot.distanceFromTrigger).toBe(0);
    });

    it("detects multiple flips in same bar", () => {
        const states1 = new Map<string, boolean>([
            ["rsi14", false],
            ["macd", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);

        // Both flip in same bar
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);

        const events = collector.getEvents();
        const flipEvents = events.algoEvents.filter((e) => e.type === "INDICATOR_FLIP") as IndicatorFlipEvent[];

        expect(flipEvents.length).toBe(2);
        expect(flipEvents.some((e) => e.indicatorKey === "rsi14")).toBe(true);
        expect(flipEvents.some((e) => e.indicatorKey === "macd")).toBe(true);
    });
});

// =============================================================================
// CONDITION CHANGE EVENTS
// =============================================================================

describe("condition change detection", () => {
    let collector: EventCollector;
    let indicators: IndicatorInfo[];
    let indicatorInfoMap: Map<string, IndicatorInfo>;

    beforeEach(() => {
        collector = new EventCollector("BTC");
        indicators = [
            createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true),
            createIndicatorInfo("macd", "MACD", "LONG_ENTRY", true),
        ];
        indicatorInfoMap = createIndicatorInfoMap(indicators);
        collector.registerIndicators(indicators);
    });

    it("emits condition change when condition becomes met", () => {
        // Start with both false
        const states1 = new Map<string, boolean>([
            ["rsi14", false],
            ["macd", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);

        // One indicator true
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);

        // Both true - condition now met
        const states3 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
        ]);
        collector.updateIndicators(2, 1002, states3, indicatorInfoMap);

        const events = collector.getEvents();
        const conditionEvents = events.algoEvents.filter(
            (e) => e.type === "CONDITION_CHANGE"
        ) as ConditionChangeEvent[];

        expect(conditionEvents.length).toBe(1);
        expect(conditionEvents[0]!.previousState).toBe(false);
        expect(conditionEvents[0]!.newState).toBe(true);
        expect(conditionEvents[0]!.conditionType).toBe("LONG_ENTRY");
        expect(conditionEvents[0]!.barIndex).toBe(2);
    });

    it("emits condition change when condition becomes unmet", () => {
        // Start with both true
        const states1 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);

        // One flips to false
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);

        const events = collector.getEvents();
        const conditionEvents = events.algoEvents.filter(
            (e) => e.type === "CONDITION_CHANGE"
        ) as ConditionChangeEvent[];

        // First event is becoming met, second is becoming unmet
        expect(conditionEvents.length).toBe(2);
        expect(conditionEvents[1]!.previousState).toBe(true);
        expect(conditionEvents[1]!.newState).toBe(false);
    });

    it("identifies triggering indicator key", () => {
        const states1 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);

        // macd is the triggering indicator
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);

        const events = collector.getEvents();
        const conditionEvent = events.algoEvents.find((e) => e.type === "CONDITION_CHANGE") as ConditionChangeEvent;

        expect(conditionEvent.triggeringIndicatorKey).toBe("macd");
    });
});

// =============================================================================
// CONDITION SNAPSHOT
// =============================================================================

describe("getConditionSnapshot", () => {
    let collector: EventCollector;
    let indicators: IndicatorInfo[];
    let indicatorInfoMap: Map<string, IndicatorInfo>;

    beforeEach(() => {
        collector = new EventCollector("BTC");
        indicators = [
            createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true),
            createIndicatorInfo("macd", "MACD", "LONG_ENTRY", true),
            createIndicatorInfo("volume", "VOLUME", "LONG_ENTRY", false), // optional
        ];
        indicatorInfoMap = createIndicatorInfoMap(indicators);
        collector.registerIndicators(indicators);
    });

    it("returns correct counts for required indicators", () => {
        const states = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
            ["volume", false],
        ]);
        collector.updateIndicators(0, 1000, states, indicatorInfoMap);

        const snapshot = collector.getConditionSnapshot("LONG_ENTRY");

        expect(snapshot!.requiredTrue).toBe(1);
        expect(snapshot!.requiredTotal).toBe(2);
    });

    it("returns correct counts for optional indicators", () => {
        const states = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
            ["volume", true],
        ]);
        collector.updateIndicators(0, 1000, states, indicatorInfoMap);

        const snapshot = collector.getConditionSnapshot("LONG_ENTRY");

        expect(snapshot!.optionalTrue).toBe(1);
        expect(snapshot!.optionalTotal).toBe(1);
    });

    it("calculates distanceFromTrigger correctly", () => {
        // 0 required true, need 2 + 1 optional = distance 3
        const states1 = new Map<string, boolean>([
            ["rsi14", false],
            ["macd", false],
            ["volume", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);
        let snapshot = collector.getConditionSnapshot("LONG_ENTRY");
        expect(snapshot!.distanceFromTrigger).toBe(3); // 2 required + 1 optional

        // 1 required true, need 1 more + 1 optional = distance 2
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", false],
            ["volume", false],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);
        snapshot = collector.getConditionSnapshot("LONG_ENTRY");
        expect(snapshot!.distanceFromTrigger).toBe(2); // 1 required + 1 optional

        // 2 required true, need 1 optional = distance 1
        const states3 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
            ["volume", false],
        ]);
        collector.updateIndicators(2, 1002, states3, indicatorInfoMap);
        snapshot = collector.getConditionSnapshot("LONG_ENTRY");
        expect(snapshot!.distanceFromTrigger).toBe(1); // Just need optional

        // All met = distance 0
        const states4 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
            ["volume", true],
        ]);
        collector.updateIndicators(3, 1003, states4, indicatorInfoMap);
        snapshot = collector.getConditionSnapshot("LONG_ENTRY");
        expect(snapshot!.distanceFromTrigger).toBe(0);
    });

    it("condition met requires all required + at least one optional", () => {
        // All required but no optional - not met
        const states1 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
            ["volume", false],
        ]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);
        let snapshot = collector.getConditionSnapshot("LONG_ENTRY");
        expect(snapshot!.conditionMet).toBe(false);

        // All required + optional - met
        const states2 = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
            ["volume", true],
        ]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);
        snapshot = collector.getConditionSnapshot("LONG_ENTRY");
        expect(snapshot!.conditionMet).toBe(true);
    });

    it("condition met when no optional indicators exist", () => {
        // Set up with only required indicators
        collector = new EventCollector("BTC");
        const reqOnlyIndicators = [
            createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true),
            createIndicatorInfo("macd", "MACD", "LONG_ENTRY", true),
        ];
        const reqOnlyMap = createIndicatorInfoMap(reqOnlyIndicators);
        collector.registerIndicators(reqOnlyIndicators);

        const states = new Map<string, boolean>([
            ["rsi14", true],
            ["macd", true],
        ]);
        collector.updateIndicators(0, 1000, states, reqOnlyMap);

        const snapshot = collector.getConditionSnapshot("LONG_ENTRY");
        expect(snapshot!.conditionMet).toBe(true);
    });
});

// =============================================================================
// getPreviousConditionMet
// =============================================================================

describe("getPreviousConditionMet", () => {
    let collector: EventCollector;
    let indicators: IndicatorInfo[];
    let indicatorInfoMap: Map<string, IndicatorInfo>;

    beforeEach(() => {
        collector = new EventCollector("BTC");
        indicators = [createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true)];
        indicatorInfoMap = createIndicatorInfoMap(indicators);
        collector.registerIndicators(indicators);
    });

    it("returns false initially", () => {
        expect(collector.getPreviousConditionMet("LONG_ENTRY")).toBe(false);
    });

    it("returns true after condition becomes met", () => {
        // Start false
        const states1 = new Map<string, boolean>([["rsi14", false]]);
        collector.updateIndicators(0, 1000, states1, indicatorInfoMap);
        expect(collector.getPreviousConditionMet("LONG_ENTRY")).toBe(false);

        // Becomes true
        const states2 = new Map<string, boolean>([["rsi14", true]]);
        collector.updateIndicators(1, 1001, states2, indicatorInfoMap);
        expect(collector.getPreviousConditionMet("LONG_ENTRY")).toBe(true);
    });

    it("returns false for unregistered condition", () => {
        expect(collector.getPreviousConditionMet("SHORT_ENTRY")).toBe(false);
    });
});

// =============================================================================
// STATE TRANSITIONS
// =============================================================================

describe("emitStateTransition", () => {
    let collector: EventCollector;

    beforeEach(() => {
        collector = new EventCollector("BTC");
    });

    it("emits state transition event", () => {
        collector.emitStateTransition(0, 1000, "CASH", "LONG", "ENTRY_SIGNAL");

        const events = collector.getEvents();
        const stateEvents = events.algoEvents.filter((e) => e.type === "STATE_TRANSITION") as StateTransitionEvent[];

        expect(stateEvents.length).toBe(1);
        expect(stateEvents[0]!.fromState).toBe("CASH");
        expect(stateEvents[0]!.toState).toBe("LONG");
        expect(stateEvents[0]!.reason).toBe("ENTRY_SIGNAL");
    });

    it("updates current state", () => {
        expect(collector.getCurrentState()).toBe("CASH");

        collector.emitStateTransition(0, 1000, "CASH", "LONG", "ENTRY_SIGNAL");
        expect(collector.getCurrentState()).toBe("LONG");

        collector.emitStateTransition(1, 1001, "LONG", "CASH", "EXIT_SIGNAL");
        expect(collector.getCurrentState()).toBe("CASH");
    });

    it("includes trade ID when in position", () => {
        // Enter position
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        collector.emitStateTransition(0, 1000, "CASH", "LONG", "ENTRY_SIGNAL");

        const events = collector.getEvents();
        const stateEvent = events.algoEvents.find((e) => e.type === "STATE_TRANSITION") as StateTransitionEvent;

        expect(stateEvent.tradeId).toBe(1);
    });
});

// =============================================================================
// SWAP EVENTS
// =============================================================================

describe("swap events", () => {
    let collector: EventCollector;

    beforeEach(() => {
        collector = new EventCollector("BTC");
    });

    describe("emitEntrySwap", () => {
        it("creates swap event with correct structure", () => {
            const tradeId = collector.emitEntrySwap(
                0, // barIndex
                1000, // timestamp
                "LONG", // direction
                42000, // price
                1000, // usdAmount
                0.0238, // assetAmount
                1, // feeUSD
                0.5 // slippageUSD
            );

            expect(tradeId).toBe(1);

            const events = collector.getEvents();
            expect(events.swapEvents.length).toBe(1);

            const swap = events.swapEvents[0]!;
            expect(swap.fromAsset).toBe("USD");
            expect(swap.toAsset).toBe("BTC");
            expect(swap.fromAmount).toBe(1000);
            expect(swap.toAmount).toBe(0.0238);
            expect(swap.price).toBe(42000);
            expect(swap.feeUSD).toBe(1);
            expect(swap.slippageUSD).toBe(0.5);
        });

        it("increments trade ID", () => {
            const id1 = collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
            collector.emitExitSwap(1, 1001, "LONG", 42500, 0.0238, 1010, 1, 0.5);

            const id2 = collector.emitEntrySwap(2, 1002, "LONG", 42500, 1000, 0.0235, 1, 0.5);

            expect(id1).toBe(1);
            expect(id2).toBe(2);
        });

        it("sets current trade ID", () => {
            expect(collector.getCurrentTradeId()).toBeNull();

            collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);

            expect(collector.getCurrentTradeId()).toBe(1);
        });
    });

    describe("emitExitSwap", () => {
        it("creates swap event with correct structure", () => {
            collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
            collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1010, 1, 0.5);

            const events = collector.getEvents();
            expect(events.swapEvents.length).toBe(2);

            const exitSwap = events.swapEvents[1]!;
            expect(exitSwap.fromAsset).toBe("BTC");
            expect(exitSwap.toAsset).toBe("USD");
            expect(exitSwap.fromAmount).toBe(0.0238);
            expect(exitSwap.toAmount).toBe(1010);
        });

        it("returns TradeEvent with correct P&L calculation", () => {
            collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
            const trade = collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1011.9, 1, 0.5);

            expect(trade).not.toBeNull();
            expect(trade!.tradeId).toBe(1);
            expect(trade!.direction).toBe("LONG");
            expect(trade!.pnlUSD).toBeCloseTo(11.9, 1); // 1011.9 - 1000
            expect(trade!.pnlPct).toBeCloseTo(0.0119, 3);
            expect(trade!.durationBars).toBe(10);
            expect(trade!.durationSeconds).toBe(10);
        });

        it("clears current trade ID", () => {
            collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
            expect(collector.getCurrentTradeId()).toBe(1);

            collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1011.9, 1, 0.5);
            expect(collector.getCurrentTradeId()).toBeNull();
        });

        it("returns null if no pending entry", () => {
            const trade = collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1011.9, 1, 0.5);
            expect(trade).toBeNull();
        });
    });
});

// =============================================================================
// buildTradeEvents
// =============================================================================

describe("buildTradeEvents", () => {
    let collector: EventCollector;

    beforeEach(() => {
        collector = new EventCollector("BTC");
    });

    it("pairs entry and exit swaps into trade events", () => {
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1011.9, 1, 0.5);

        const trades = collector.buildTradeEvents();

        expect(trades.length).toBe(1);
        expect(trades[0]!.tradeId).toBe(1);
        expect(trades[0]!.direction).toBe("LONG");
        expect(trades[0]!.entrySwap.fromAsset).toBe("USD");
        expect(trades[0]!.exitSwap.toAsset).toBe("USD");
    });

    it("handles multiple trades", () => {
        // Trade 1
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1011.9, 1, 0.5);

        // Trade 2
        collector.emitEntrySwap(20, 1020, "LONG", 42500, 1000, 0.0235, 1, 0.5);
        collector.emitExitSwap(30, 1030, "LONG", 43000, 0.0235, 1011.8, 1, 0.5);

        const trades = collector.buildTradeEvents();

        expect(trades.length).toBe(2);
        expect(trades[0]!.tradeId).toBe(1);
        expect(trades[1]!.tradeId).toBe(2);
    });

    it("calculates P&L correctly", () => {
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1100, 1, 0.5);

        const trades = collector.buildTradeEvents();

        expect(trades[0]!.pnlUSD).toBe(100); // 1100 - 1000
        expect(trades[0]!.pnlPct).toBe(0.1); // 100/1000
    });

    it("calculates duration correctly", () => {
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        collector.emitExitSwap(100, 2000, "LONG", 42500, 0.0238, 1100, 1, 0.5);

        const trades = collector.buildTradeEvents();

        expect(trades[0]!.durationBars).toBe(100);
        expect(trades[0]!.durationSeconds).toBe(1000);
    });

    it("returns empty array for no trades", () => {
        const trades = collector.buildTradeEvents();
        expect(trades.length).toBe(0);
    });

    it("ignores unpaired entry swap", () => {
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        // No exit

        const trades = collector.buildTradeEvents();
        expect(trades.length).toBe(0);
    });
});

// =============================================================================
// SPECIAL INDICATOR EVENTS
// =============================================================================

describe("emitSpecialIndicatorEvent", () => {
    let collector: EventCollector;

    beforeEach(() => {
        collector = new EventCollector("BTC");
        // Enter a position first
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
    });

    it("emits SL_SET event", () => {
        collector.emitSpecialIndicatorEvent(0, 1000, "SL_SET", 42000, 40000, "LONG");

        const events = collector.getEvents();
        const specialEvents = events.algoEvents.filter((e) => e.type === "SL_SET");

        expect(specialEvents.length).toBe(1);
        expect(specialEvents[0]!.type).toBe("SL_SET");
    });

    it("emits TP_SET event", () => {
        collector.emitSpecialIndicatorEvent(0, 1000, "TP_SET", 42000, 45000, "LONG");

        const events = collector.getEvents();
        const specialEvents = events.algoEvents.filter((e) => e.type === "TP_SET");

        expect(specialEvents.length).toBe(1);
    });

    it("emits SL_HIT event", () => {
        collector.emitSpecialIndicatorEvent(0, 1000, "SL_SET", 42000, 40000, "LONG");
        collector.emitSpecialIndicatorEvent(5, 1005, "SL_HIT", 40000, 40000, "LONG");

        const events = collector.getEvents();
        const hitEvents = events.algoEvents.filter((e) => e.type === "SL_HIT");

        expect(hitEvents.length).toBe(1);
    });

    it("includes trade ID", () => {
        collector.emitSpecialIndicatorEvent(0, 1000, "SL_SET", 42000, 40000, "LONG");

        const events = collector.getEvents();
        const event = events.algoEvents.find((e) => e.type === "SL_SET")!;

        expect((event as any).tradeId).toBe(1);
    });
});

// =============================================================================
// RESET
// =============================================================================

describe("reset", () => {
    let collector: EventCollector;

    beforeEach(() => {
        collector = new EventCollector("BTC");
        const indicators = [createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true)];
        collector.registerIndicators(indicators);
    });

    it("clears all events", () => {
        collector.emitStateTransition(0, 1000, "CASH", "LONG", "ENTRY_SIGNAL");
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);

        const eventsBefore = collector.getEvents();
        expect(eventsBefore.algoEvents.length).toBe(1);
        expect(eventsBefore.swapEvents.length).toBe(1);

        collector.reset();

        const eventsAfter = collector.getEvents();
        expect(eventsAfter.algoEvents.length).toBe(0);
        expect(eventsAfter.swapEvents.length).toBe(0);
    });

    it("resets state to CASH", () => {
        collector.emitStateTransition(0, 1000, "CASH", "LONG", "ENTRY_SIGNAL");
        expect(collector.getCurrentState()).toBe("LONG");

        collector.reset();

        expect(collector.getCurrentState()).toBe("CASH");
    });

    it("clears current trade ID", () => {
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        expect(collector.getCurrentTradeId()).toBe(1);

        collector.reset();

        expect(collector.getCurrentTradeId()).toBeNull();
    });

    it("resets ID counters", () => {
        collector.emitEntrySwap(0, 1000, "LONG", 42000, 1000, 0.0238, 1, 0.5);
        collector.emitExitSwap(10, 1010, "LONG", 42500, 0.0238, 1100, 1, 0.5);

        collector.reset();

        // Re-register indicators after reset
        collector.registerIndicators([createIndicatorInfo("rsi14", "RSI", "LONG_ENTRY", true)]);

        const newTradeId = collector.emitEntrySwap(0, 2000, "LONG", 43000, 1000, 0.0233, 1, 0.5);
        expect(newTradeId).toBe(1); // Should start from 1 again
    });
});
