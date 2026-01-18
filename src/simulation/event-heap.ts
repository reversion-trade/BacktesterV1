/**
 * Event Heap - Priority Queue for Event-Driven Simulation
 *
 * @module simulation/event-heap
 * @description
 * Min-heap implementation for managing simulation events sorted by timestamp.
 * Provides O(log n) insert, O(1) peek, and O(log n) pop operations.
 *
 * @architecture
 * Key features:
 * 1. Min-heap sorted by timestamp (earliest event first)
 * 2. Dead event pattern: O(1) mark vs O(n) delete
 * 3. Event ID map for O(1) dead marking lookup
 * 4. Bulk insert with heapify for initialization
 *
 * @performance
 * - push(): O(log n)
 * - pop(): O(log n) amortized (skips dead events)
 * - peek(): O(1)
 * - markDead(): O(1)
 * - pushAll(): O(n) via heapify (better than n * O(log n))
 *
 * @audit-trail
 * - Created: 2026-01-09 (Event-Driven Simulation Implementation)
 * - Purpose: Enable heap-based event processing for simulation
 */

import type { SimulationEvent } from "../events/simulation-events.ts";

// =============================================================================
// EVENT HEAP CLASS
// =============================================================================

/**
 * Priority queue for simulation events.
 *
 * Events are sorted by timestamp (ascending).
 * Uses a binary min-heap backed by an array.
 *
 * @example
 * ```typescript
 * const heap = new EventHeap();
 *
 * // Add events
 * heap.push(signalEvent1);
 * heap.push(slEvent);
 * heap.pushAll(conditionEvents);
 *
 * // Process events in order
 * while (!heap.isEmpty) {
 *     const event = heap.pop();
 *     if (!event) break;
 *     processEvent(event);
 * }
 *
 * // Cancel pending SL/TP when position exits early
 * heap.markDead(pendingSlEventId);
 * ```
 */
export class EventHeap {
    /** Heap storage (array-based binary heap) */
    private heap: SimulationEvent[] = [];

    /** Event ID → Event mapping for O(1) markDead lookup */
    private eventMap: Map<string, SimulationEvent> = new Map();

    /** Count of live (non-dead) events */
    private liveCount = 0;

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Add a single event to the heap.
     * O(log n) complexity.
     *
     * @param event - Event to add
     */
    push(event: SimulationEvent): void {
        this.heap.push(event);
        this.eventMap.set(event.id, event);
        if (!event.isDead) {
            this.liveCount++;
        }
        this.bubbleUp(this.heap.length - 1);
    }

    /**
     * Add multiple events at once.
     * Uses heapify for O(n) complexity (better than n * O(log n)).
     *
     * @param events - Events to add
     */
    pushAll(events: SimulationEvent[]): void {
        if (events.length === 0) return;

        // Add all events to heap and map
        for (const event of events) {
            this.heap.push(event);
            this.eventMap.set(event.id, event);
            if (!event.isDead) {
                this.liveCount++;
            }
        }

        // Heapify: start from last non-leaf node and bubble down
        const startIdx = Math.floor(this.heap.length / 2) - 1;
        for (let i = startIdx; i >= 0; i--) {
            this.bubbleDown(i);
        }
    }

    /**
     * Remove and return the earliest event.
     * Automatically skips dead events.
     * O(log n) amortized complexity.
     *
     * @returns Earliest live event, or undefined if heap is empty
     */
    pop(): SimulationEvent | undefined {
        // Keep popping until we find a live event or heap is empty
        while (this.heap.length > 0) {
            const event = this.removeMin();
            if (!event) return undefined;

            if (!event.isDead) {
                this.liveCount--;
                return event;
            }
            // Event was dead, continue to next
        }
        return undefined;
    }

    /**
     * Peek at the earliest event without removing it.
     * Automatically skips dead events by internally popping dead ones.
     * O(1) for live events at top, O(log n) if dead events need removal.
     *
     * @returns Earliest live event, or undefined if heap is empty
     */
    peek(): SimulationEvent | undefined {
        // Remove dead events from top until we find a live one
        while (this.heap.length > 0) {
            const top = this.heap[0];
            if (!top) return undefined;

            if (!top.isDead) {
                return top;
            }

            // Top is dead, remove it
            this.removeMin();
        }
        return undefined;
    }

    /**
     * Mark an event as dead (cancelled).
     * O(1) complexity using event map lookup.
     * The event will be skipped on pop/peek.
     *
     * @param eventId - ID of event to mark dead
     * @returns true if event was found and marked, false if not found
     */
    markDead(eventId: string): boolean {
        const event = this.eventMap.get(eventId);
        if (!event) return false;

        if (!event.isDead) {
            event.isDead = true;
            this.liveCount--;
        }
        return true;
    }

    /**
     * Check if an event exists and is alive.
     *
     * @param eventId - Event ID to check
     * @returns true if event exists and is not dead
     */
    isAlive(eventId: string): boolean {
        const event = this.eventMap.get(eventId);
        return event !== undefined && !event.isDead;
    }

    /**
     * Get the total number of events in the heap (including dead).
     */
    get size(): number {
        return this.heap.length;
    }

    /**
     * Get the number of live (non-dead) events.
     */
    get liveSize(): number {
        return this.liveCount;
    }

    /**
     * Check if the heap has no live events.
     */
    get isEmpty(): boolean {
        return this.liveCount === 0;
    }

    /**
     * Clear all events from the heap.
     */
    clear(): void {
        this.heap = [];
        this.eventMap.clear();
        this.liveCount = 0;
    }

    /**
     * Get all events (for debugging/testing).
     * Returns a copy to prevent external mutation.
     */
    toArray(): SimulationEvent[] {
        return [...this.heap];
    }

    /**
     * Get all live events in timestamp order (for debugging/testing).
     * Note: This creates a copy and sorts, expensive for large heaps.
     */
    toLiveArray(): SimulationEvent[] {
        return this.heap
            .filter((e) => !e.isDead)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    // =========================================================================
    // PRIVATE HEAP OPERATIONS
    // =========================================================================

    /**
     * Remove and return the minimum element (root).
     */
    private removeMin(): SimulationEvent | undefined {
        if (this.heap.length === 0) return undefined;

        const min = this.heap[0]!;

        // Move last element to root
        const last = this.heap.pop();
        if (this.heap.length > 0 && last) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }

        // Remove from map
        this.eventMap.delete(min.id);

        return min;
    }

    /**
     * Bubble up an element to restore heap property.
     * Used after push.
     */
    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIdx = Math.floor((index - 1) / 2);
            const current = this.heap[index]!;
            const parent = this.heap[parentIdx]!;

            // If current is not smaller than parent, we're done
            if (current.timestamp >= parent.timestamp) break;

            // Swap with parent
            this.heap[index] = parent;
            this.heap[parentIdx] = current;
            index = parentIdx;
        }
    }

    /**
     * Bubble down an element to restore heap property.
     * Used after pop/removeMin.
     */
    private bubbleDown(index: number): void {
        const length = this.heap.length;

        while (true) {
            const leftIdx = 2 * index + 1;
            const rightIdx = 2 * index + 2;
            let smallestIdx = index;

            // Check left child
            if (
                leftIdx < length &&
                this.heap[leftIdx]!.timestamp < this.heap[smallestIdx]!.timestamp
            ) {
                smallestIdx = leftIdx;
            }

            // Check right child
            if (
                rightIdx < length &&
                this.heap[rightIdx]!.timestamp < this.heap[smallestIdx]!.timestamp
            ) {
                smallestIdx = rightIdx;
            }

            // If no swap needed, we're done
            if (smallestIdx === index) break;

            // Swap
            const temp = this.heap[index]!;
            this.heap[index] = this.heap[smallestIdx]!;
            this.heap[smallestIdx] = temp;
            index = smallestIdx;
        }
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create a new EventHeap pre-populated with events.
 * Convenience function for initialization.
 *
 * @param events - Initial events to add
 * @returns New EventHeap with events
 */
export function createEventHeap(events: SimulationEvent[] = []): EventHeap {
    const heap = new EventHeap();
    if (events.length > 0) {
        heap.pushAll(events);
    }
    return heap;
}

/**
 * Merge multiple event arrays into a single heap.
 *
 * @param eventArrays - Arrays of events to merge
 * @returns EventHeap containing all events
 */
export function mergeIntoHeap(...eventArrays: SimulationEvent[][]): EventHeap {
    const allEvents = eventArrays.flat();
    return createEventHeap(allEvents);
}
