/**
 * Event Heap Unit Tests
 *
 * Tests for the priority queue implementation used in event-driven simulation.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { EventHeap, createEventHeap, mergeIntoHeap } from "../../src/simulation/event-heap.ts";
import {
    createSignalCrossingEvent,
    createSLTriggerEvent,
    createTPTriggerEvent,
    createTimeoutExpiredEvent,
    resetEventIdCounter,
    type SimulationEvent,
} from "../../src/events/simulation-events.ts";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestEvent(timestamp: number, barIndex?: number): SimulationEvent {
    return createSignalCrossingEvent({
        timestamp,
        barIndex: barIndex ?? Math.floor(timestamp / 60),
        indicatorKey: "test:indicator",
        conditionType: "LONG_ENTRY",
        isRequired: true,
        previousValue: false,
        newValue: true,
    });
}

// =============================================================================
// BASIC HEAP OPERATIONS
// =============================================================================

describe("EventHeap - Basic Operations", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("newly created heap is empty", () => {
        const heap = new EventHeap();
        expect(heap.isEmpty).toBe(true);
        expect(heap.size).toBe(0);
        expect(heap.liveSize).toBe(0);
    });

    test("push increases size", () => {
        const heap = new EventHeap();
        const event = createTestEvent(100);

        heap.push(event);

        expect(heap.size).toBe(1);
        expect(heap.liveSize).toBe(1);
        expect(heap.isEmpty).toBe(false);
    });

    test("pop returns event and decreases size", () => {
        const heap = new EventHeap();
        const event = createTestEvent(100);
        heap.push(event);

        const result = heap.pop();

        expect(result).toBeDefined();
        expect(result?.timestamp).toBe(100);
        expect(heap.size).toBe(0);
        expect(heap.isEmpty).toBe(true);
    });

    test("pop returns undefined for empty heap", () => {
        const heap = new EventHeap();

        const result = heap.pop();

        expect(result).toBeUndefined();
    });

    test("peek returns event without removing", () => {
        const heap = new EventHeap();
        const event = createTestEvent(100);
        heap.push(event);

        const result = heap.peek();

        expect(result).toBeDefined();
        expect(result?.timestamp).toBe(100);
        expect(heap.size).toBe(1);
        expect(heap.isEmpty).toBe(false);
    });

    test("peek returns undefined for empty heap", () => {
        const heap = new EventHeap();

        const result = heap.peek();

        expect(result).toBeUndefined();
    });

    test("clear removes all events", () => {
        const heap = new EventHeap();
        heap.push(createTestEvent(100));
        heap.push(createTestEvent(200));
        heap.push(createTestEvent(300));

        heap.clear();

        expect(heap.isEmpty).toBe(true);
        expect(heap.size).toBe(0);
    });
});

// =============================================================================
// HEAP ORDERING
// =============================================================================

describe("EventHeap - Ordering", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("pop returns events in timestamp order", () => {
        const heap = new EventHeap();

        // Push in random order
        heap.push(createTestEvent(300));
        heap.push(createTestEvent(100));
        heap.push(createTestEvent(200));

        // Should pop in sorted order
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(200);
        expect(heap.pop()?.timestamp).toBe(300);
    });

    test("handles many events in correct order", () => {
        const heap = new EventHeap();

        // Push 100 events in random order
        const timestamps = Array.from({ length: 100 }, (_, i) => i * 10);
        const shuffled = timestamps.sort(() => Math.random() - 0.5);

        for (const ts of shuffled) {
            heap.push(createTestEvent(ts));
        }

        // Pop should return in sorted order
        let prevTs = -1;
        while (!heap.isEmpty) {
            const event = heap.pop()!;
            expect(event.timestamp).toBeGreaterThan(prevTs);
            prevTs = event.timestamp;
        }
    });

    test("peek always returns earliest event", () => {
        const heap = new EventHeap();

        heap.push(createTestEvent(300));
        expect(heap.peek()?.timestamp).toBe(300);

        heap.push(createTestEvent(100));
        expect(heap.peek()?.timestamp).toBe(100);

        heap.push(createTestEvent(200));
        expect(heap.peek()?.timestamp).toBe(100);
    });

    test("events with same timestamp maintain valid heap order", () => {
        const heap = new EventHeap();

        // Multiple events at same timestamp
        heap.push(createTestEvent(100));
        heap.push(createTestEvent(100));
        heap.push(createTestEvent(100));

        // All should be poppable
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()).toBeUndefined();
    });
});

// =============================================================================
// DEAD EVENT PATTERN
// =============================================================================

describe("EventHeap - Dead Event Pattern", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("markDead marks event as dead", () => {
        const heap = new EventHeap();
        const event = createTestEvent(100);
        heap.push(event);

        const result = heap.markDead(event.id);

        expect(result).toBe(true);
        expect(event.isDead).toBe(true);
    });

    test("markDead returns false for unknown event", () => {
        const heap = new EventHeap();

        const result = heap.markDead("unknown-id");

        expect(result).toBe(false);
    });

    test("pop skips dead events", () => {
        const heap = new EventHeap();
        const event1 = createTestEvent(100);
        const event2 = createTestEvent(200);
        const event3 = createTestEvent(300);

        heap.push(event1);
        heap.push(event2);
        heap.push(event3);

        // Mark middle event as dead
        heap.markDead(event2.id);

        // Pop should skip event2
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(300);
        expect(heap.pop()).toBeUndefined();
    });

    test("peek skips dead events", () => {
        const heap = new EventHeap();
        const event1 = createTestEvent(100);
        const event2 = createTestEvent(200);

        heap.push(event1);
        heap.push(event2);

        // Mark first event as dead
        heap.markDead(event1.id);

        // Peek should return event2
        expect(heap.peek()?.timestamp).toBe(200);
    });

    test("liveSize reflects dead events", () => {
        const heap = new EventHeap();
        heap.push(createTestEvent(100));
        heap.push(createTestEvent(200));
        heap.push(createTestEvent(300));

        expect(heap.liveSize).toBe(3);

        heap.markDead(heap.peek()!.id);

        expect(heap.liveSize).toBe(2);
        expect(heap.size).toBe(3); // Total size unchanged
    });

    test("isEmpty reflects dead events", () => {
        const heap = new EventHeap();
        const event = createTestEvent(100);
        heap.push(event);

        expect(heap.isEmpty).toBe(false);

        heap.markDead(event.id);

        expect(heap.isEmpty).toBe(true);
    });

    test("isAlive correctly reports event status", () => {
        const heap = new EventHeap();
        const event = createTestEvent(100);
        heap.push(event);

        expect(heap.isAlive(event.id)).toBe(true);

        heap.markDead(event.id);

        expect(heap.isAlive(event.id)).toBe(false);
    });

    test("isAlive returns false for unknown event", () => {
        const heap = new EventHeap();

        expect(heap.isAlive("unknown-id")).toBe(false);
    });

    test("marking same event dead twice only decrements liveSize once", () => {
        const heap = new EventHeap();
        const event = createTestEvent(100);
        heap.push(event);

        heap.markDead(event.id);
        heap.markDead(event.id); // Second call

        expect(heap.liveSize).toBe(0); // Should only decrement once
    });
});

// =============================================================================
// BULK OPERATIONS
// =============================================================================

describe("EventHeap - Bulk Operations", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("pushAll adds multiple events", () => {
        const heap = new EventHeap();
        const events = [createTestEvent(100), createTestEvent(200), createTestEvent(300)];

        heap.pushAll(events);

        expect(heap.size).toBe(3);
        expect(heap.liveSize).toBe(3);
    });

    test("pushAll maintains heap order", () => {
        const heap = new EventHeap();

        // Push in random order
        heap.pushAll([createTestEvent(300), createTestEvent(100), createTestEvent(200)]);

        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(200);
        expect(heap.pop()?.timestamp).toBe(300);
    });

    test("pushAll with empty array does nothing", () => {
        const heap = new EventHeap();

        heap.pushAll([]);

        expect(heap.size).toBe(0);
    });

    test("pushAll can add to existing heap", () => {
        const heap = new EventHeap();
        heap.push(createTestEvent(200));

        heap.pushAll([createTestEvent(100), createTestEvent(300)]);

        expect(heap.size).toBe(3);
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(200);
        expect(heap.pop()?.timestamp).toBe(300);
    });
});

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

describe("EventHeap - Utilities", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("createEventHeap creates empty heap", () => {
        const heap = createEventHeap();

        expect(heap.isEmpty).toBe(true);
    });

    test("createEventHeap creates heap with events", () => {
        const events = [createTestEvent(100), createTestEvent(200)];

        const heap = createEventHeap(events);

        expect(heap.size).toBe(2);
        expect(heap.pop()?.timestamp).toBe(100);
    });

    test("mergeIntoHeap merges multiple arrays", () => {
        const array1 = [createTestEvent(100), createTestEvent(300)];
        const array2 = [createTestEvent(200)];
        const array3 = [createTestEvent(400), createTestEvent(50)];

        const heap = mergeIntoHeap(array1, array2, array3);

        expect(heap.size).toBe(5);
        expect(heap.pop()?.timestamp).toBe(50);
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(200);
        expect(heap.pop()?.timestamp).toBe(300);
        expect(heap.pop()?.timestamp).toBe(400);
    });

    test("toArray returns copy of heap", () => {
        const heap = new EventHeap();
        heap.push(createTestEvent(100));
        heap.push(createTestEvent(200));

        const array = heap.toArray();

        expect(array.length).toBe(2);
        // Modifying array shouldn't affect heap
        array.pop();
        expect(heap.size).toBe(2);
    });

    test("toLiveArray returns sorted live events", () => {
        const heap = new EventHeap();
        const event1 = createTestEvent(100);
        const event2 = createTestEvent(200);
        const event3 = createTestEvent(300);
        heap.push(event3);
        heap.push(event1);
        heap.push(event2);
        heap.markDead(event2.id);

        const liveArray = heap.toLiveArray();

        expect(liveArray.length).toBe(2);
        expect(liveArray[0]?.timestamp).toBe(100);
        expect(liveArray[1]?.timestamp).toBe(300);
    });
});

// =============================================================================
// DIFFERENT EVENT TYPES
// =============================================================================

describe("EventHeap - Different Event Types", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("handles mixed event types", () => {
        const heap = new EventHeap();

        const signalEvent = createSignalCrossingEvent({
            timestamp: 200,
            barIndex: 3,
            indicatorKey: "ema:14",
            conditionType: "LONG_ENTRY",
            isRequired: true,
            previousValue: false,
            newValue: true,
        });

        const slEvent = createSLTriggerEvent({
            timestamp: 100,
            barIndex: 1,
            triggerPrice: 99,
            entryPrice: 100,
            direction: "LONG",
            tradeId: 1,
            slLevel: 99,
        });

        const tpEvent = createTPTriggerEvent({
            timestamp: 300,
            barIndex: 5,
            triggerPrice: 105,
            entryPrice: 100,
            direction: "LONG",
            tradeId: 1,
            tpLevel: 105,
        });

        const timeoutEvent = createTimeoutExpiredEvent({
            timestamp: 400,
            barIndex: 6,
            tradeId: 1,
            timeoutStartBar: 5,
            cooldownBars: 10,
        });

        heap.push(timeoutEvent);
        heap.push(signalEvent);
        heap.push(slEvent);
        heap.push(tpEvent);

        expect(heap.pop()?.eventType).toBe("SL_TRIGGER");
        expect(heap.pop()?.eventType).toBe("SIGNAL_CROSSING");
        expect(heap.pop()?.eventType).toBe("TP_TRIGGER");
        expect(heap.pop()?.eventType).toBe("TIMEOUT_EXPIRED");
    });

    test("SL/TP dead event pattern works correctly", () => {
        const heap = new EventHeap();

        const slEvent = createSLTriggerEvent({
            timestamp: 150,
            barIndex: 2,
            triggerPrice: 99,
            entryPrice: 100,
            direction: "LONG",
            tradeId: 1,
            slLevel: 99,
        });

        const tpEvent = createTPTriggerEvent({
            timestamp: 200,
            barIndex: 3,
            triggerPrice: 105,
            entryPrice: 100,
            direction: "LONG",
            tradeId: 1,
            tpLevel: 105,
        });

        const exitSignal = createSignalCrossingEvent({
            timestamp: 100,
            barIndex: 1,
            indicatorKey: "macd",
            conditionType: "LONG_EXIT",
            isRequired: true,
            previousValue: false,
            newValue: true,
        });

        heap.push(slEvent);
        heap.push(tpEvent);
        heap.push(exitSignal);

        // First event is exit signal
        const first = heap.pop();
        expect(first?.eventType).toBe("SIGNAL_CROSSING");

        // On exit signal, we would mark SL/TP as dead
        heap.markDead(slEvent.id);
        heap.markDead(tpEvent.id);

        // Heap should now be empty (both remaining events are dead)
        expect(heap.isEmpty).toBe(true);
        expect(heap.pop()).toBeUndefined();
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("EventHeap - Edge Cases", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("handles single element heap correctly", () => {
        const heap = new EventHeap();
        heap.push(createTestEvent(100));

        expect(heap.peek()?.timestamp).toBe(100);
        expect(heap.pop()?.timestamp).toBe(100);
        expect(heap.isEmpty).toBe(true);
    });

    test("handles alternating push/pop", () => {
        const heap = new EventHeap();

        heap.push(createTestEvent(100));
        expect(heap.pop()?.timestamp).toBe(100);

        heap.push(createTestEvent(200));
        heap.push(createTestEvent(50));
        expect(heap.pop()?.timestamp).toBe(50);
        expect(heap.pop()?.timestamp).toBe(200);

        expect(heap.isEmpty).toBe(true);
    });

    test("handles all events being dead", () => {
        const heap = new EventHeap();
        const event1 = createTestEvent(100);
        const event2 = createTestEvent(200);
        heap.push(event1);
        heap.push(event2);

        heap.markDead(event1.id);
        heap.markDead(event2.id);

        expect(heap.isEmpty).toBe(true);
        expect(heap.pop()).toBeUndefined();
        expect(heap.peek()).toBeUndefined();
    });

    test("handles timestamp 0", () => {
        const heap = new EventHeap();
        heap.push(createTestEvent(100));
        heap.push(createTestEvent(0));
        heap.push(createTestEvent(50));

        expect(heap.pop()?.timestamp).toBe(0);
    });

    test("handles very large timestamps", () => {
        const heap = new EventHeap();
        const largeTs = Number.MAX_SAFE_INTEGER - 1000;

        heap.push(createTestEvent(largeTs));
        heap.push(createTestEvent(largeTs + 1));
        heap.push(createTestEvent(largeTs - 1));

        expect(heap.pop()?.timestamp).toBe(largeTs - 1);
        expect(heap.pop()?.timestamp).toBe(largeTs);
        expect(heap.pop()?.timestamp).toBe(largeTs + 1);
    });
});
