/**
 * Event Simulator Unit Tests
 *
 * Tests for the unified event-driven simulation loop.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { runEventDrivenSimulation, type EventSimulatorConfig } from "../event-simulator.ts";
import { EventHeap, createEventHeap, mergeIntoHeap } from "../event-heap.ts";
import {
    resetEventIdCounter,
    createSignalCrossingEvent,
    createConditionMetEvent,
    createConditionUnmetEvent,
    createSLTriggerEvent,
    createTPTriggerEvent,
} from "../../events/simulation-events.ts";
import type { Candle, AlgoParams } from "../../core/types.ts";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createCandle(bucket: number, open: number, high: number, low: number, close: number): Candle {
    return { bucket, open, high, low, close, volume: 100 };
}

function createSimpleCandles(count: number, startPrice: number = 100): Candle[] {
    return Array.from({ length: count }, (_, i) => ({
        bucket: i * 60,
        open: startPrice + i,
        high: startPrice + i + 5,
        low: startPrice + i - 5,
        close: startPrice + i,
        volume: 100,
    }));
}

function createMinimalAlgoParams(overrides: Partial<AlgoParams> = {}): AlgoParams {
    return {
        type: "LONG",
        longEntry: { required: [], optional: [] },
        longExit: { required: [], optional: [] },
        positionSize: { type: "REL", value: 1.0 }, // Use 100% of capital
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 },
        ...overrides,
    };
}

function createSimulatorConfig(overrides: Partial<EventSimulatorConfig> = {}): EventSimulatorConfig {
    return {
        algoParams: createMinimalAlgoParams(),
        initialCapital: 10000,
        symbol: "BTC",
        feeBps: 10, // 0.1% fee
        slippageBps: 5, // 0.05% slippage
        closePositionOnExit: true,
        barDurationSeconds: 60, // Default 1m bars for tests
        ...overrides,
    };
}

// =============================================================================
// BASIC SIMULATION
// =============================================================================

describe("Event Simulator - Basic", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("empty heap produces no trades", () => {
        const heap = new EventHeap();
        const candles = createSimpleCandles(10);
        const config = createSimulatorConfig();

        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.trades.length).toBe(0);
        expect(result.swapEvents.length).toBe(0);
        expect(result.finalState).toBe("CASH");
        expect(result.finalEquity).toBe(10000);
    });

    test("single entry and exit creates one trade", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 300,
                barIndex: 5,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig({
            algoParams: createMinimalAlgoParams({
                type: "LONG",
                longEntry: { required: [], optional: [] },
                longExit: { required: [], optional: [] },
            }),
        });

        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.trades.length).toBe(1);
        expect(result.swapEvents.length).toBe(2); // Entry + Exit
        expect(result.stats.entriesExecuted).toBe(1);
        expect(result.stats.exitsExecuted).toBe(1);
        expect(result.stats.signalExits).toBe(1);
    });

    test("condition unmet after met prevents entry", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            // Entry should happen here
            createConditionUnmetEvent({
                timestamp: 120,
                barIndex: 2,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            // Second condition met should trigger new entry (but we're still in position)
            createConditionMetEvent({
                timestamp: 180,
                barIndex: 3,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig();
        const result = runEventDrivenSimulation(heap, candles, config);

        // Should have 1 complete trade
        expect(result.trades.length).toBe(1);
    });
});

// =============================================================================
// SL/TP EXITS
// =============================================================================

describe("Event Simulator - SL/TP Exits", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("SL trigger exits position", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createSLTriggerEvent({
                timestamp: 180,
                barIndex: 3,
                triggerPrice: 95,
                entryPrice: 100,
                direction: "LONG",
                tradeId: 1,
                slLevel: 96,
            }),
        ]);

        const config = createSimulatorConfig();
        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.trades.length).toBe(1);
        expect(result.stats.slTriggered).toBe(1);
        expect(result.stats.tpTriggered).toBe(0);
    });

    test("TP trigger exits position", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createTPTriggerEvent({
                timestamp: 180,
                barIndex: 3,
                triggerPrice: 110,
                entryPrice: 100,
                direction: "LONG",
                tradeId: 1,
                tpLevel: 108,
            }),
        ]);

        const config = createSimulatorConfig();
        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.trades.length).toBe(1);
        expect(result.stats.tpTriggered).toBe(1);
        expect(result.stats.slTriggered).toBe(0);
    });
});

// =============================================================================
// DIRECTION HANDLING
// =============================================================================

describe("Event Simulator - Directions", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("LONG-only algo ignores SHORT signals", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "SHORT_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 120,
                barIndex: 2,
                conditionType: "SHORT_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig({
            algoParams: createMinimalAlgoParams({ type: "LONG" }),
        });

        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.trades.length).toBe(0);
        expect(result.stats.entriesExecuted).toBe(0);
    });

    test("SHORT algo can enter short positions", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "SHORT_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 300,
                barIndex: 5,
                conditionType: "SHORT_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig({
            algoParams: createMinimalAlgoParams({
                type: "SHORT",
                shortEntry: { required: [], optional: [] },
                shortExit: { required: [], optional: [] },
            }),
        });

        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.trades.length).toBe(1);
        expect(result.trades[0]!.direction).toBe("SHORT");
    });

    test("BOTH algo can trade either direction", () => {
        const candles = createSimpleCandles(20);
        const heap = createEventHeap([
            // Long trade
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 180,
                barIndex: 3,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
            // Clear LONG_ENTRY before SHORT trade (realistic behavior)
            createConditionUnmetEvent({
                timestamp: 240,
                barIndex: 4,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            // Short trade
            createConditionMetEvent({
                timestamp: 300,
                barIndex: 5,
                conditionType: "SHORT_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 420,
                barIndex: 7,
                conditionType: "SHORT_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig({
            algoParams: createMinimalAlgoParams({
                type: "BOTH",
                longEntry: { required: [], optional: [] },
                longExit: { required: [], optional: [] },
                shortEntry: { required: [], optional: [] },
                shortExit: { required: [], optional: [] },
            }),
        });

        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.trades.length).toBe(2);
        expect(result.trades[0]!.direction).toBe("LONG");
        expect(result.trades[1]!.direction).toBe("SHORT");
    });
});

// =============================================================================
// COOLDOWN / TIMEOUT
// =============================================================================

describe("Event Simulator - Timeout", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("cooldown prevents immediate re-entry", () => {
        const candles = createSimpleCandles(20);
        const heap = createEventHeap([
            // First trade
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 120,
                barIndex: 2,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
            // Try to re-enter immediately (should be blocked by cooldown)
            createConditionMetEvent({
                timestamp: 180,
                barIndex: 3,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            // This exit shouldn't happen as we're in timeout
            createConditionMetEvent({
                timestamp: 240,
                barIndex: 4,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig({
            algoParams: createMinimalAlgoParams({
                type: "LONG",
                timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 5 },
            }),
        });

        const result = runEventDrivenSimulation(heap, candles, config);

        // Only one trade should complete (the one before cooldown)
        expect(result.trades.length).toBe(1);
    });
});

// =============================================================================
// TRADE LIMIT
// =============================================================================

describe("Event Simulator - Trade Limit", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("respects trade limit", () => {
        const candles = createSimpleCandles(20);
        const heap = createEventHeap([
            // Trade 1
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 120,
                barIndex: 2,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
            // Trade 2
            createConditionMetEvent({
                timestamp: 180,
                barIndex: 3,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 240,
                barIndex: 4,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
            // Trade 3 (should be blocked by limit)
            createConditionMetEvent({
                timestamp: 300,
                barIndex: 5,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig({ tradesLimit: 2 });

        const result = runEventDrivenSimulation(heap, candles, config);

        // Only 2 trades should complete
        expect(result.trades.length).toBe(2);
        expect(result.stats.entriesExecuted).toBe(2);
    });
});

// =============================================================================
// END OF BACKTEST
// =============================================================================

describe("Event Simulator - End of Backtest", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("closes open position at end when configured", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            // No exit event - position left open
        ]);

        const config = createSimulatorConfig({ closePositionOnExit: true });

        const result = runEventDrivenSimulation(heap, candles, config);

        // Should have 1 complete trade (forced exit)
        expect(result.trades.length).toBe(1);
        expect(result.finalState).toBe("CASH");
    });

    test("leaves position open when not configured to close", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig({ closePositionOnExit: false });

        const result = runEventDrivenSimulation(heap, candles, config);

        // No completed trades (position still open)
        expect(result.trades.length).toBe(0);
        expect(result.swapEvents.length).toBe(1); // Only entry
        expect(result.finalState).toBe("LONG");
    });
});

// =============================================================================
// STATISTICS
// =============================================================================

describe("Event Simulator - Statistics", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("tracks events processed correctly", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 180,
                barIndex: 3,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig();
        const result = runEventDrivenSimulation(heap, candles, config);

        expect(result.stats.eventsProcessed).toBe(2);
    });

    test("state transitions are recorded", () => {
        const candles = createSimpleCandles(10);
        const heap = createEventHeap([
            createConditionMetEvent({
                timestamp: 60,
                barIndex: 1,
                conditionType: "LONG_ENTRY",
                triggeringIndicatorKey: "ema:14",
            }),
            createConditionMetEvent({
                timestamp: 180,
                barIndex: 3,
                conditionType: "LONG_EXIT",
                triggeringIndicatorKey: "ema:14",
            }),
        ]);

        const config = createSimulatorConfig();
        const result = runEventDrivenSimulation(heap, candles, config);

        // Should have: CASH → LONG, LONG → CASH
        expect(result.stateTransitions.length).toBe(2);
        expect(result.stateTransitions[0]!.fromState).toBe("CASH");
        expect(result.stateTransitions[0]!.toState).toBe("LONG");
        expect(result.stateTransitions[1]!.fromState).toBe("LONG");
        expect(result.stateTransitions[1]!.toState).toBe("CASH");
    });
});
