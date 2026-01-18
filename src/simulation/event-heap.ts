/** Event Heap - Min-heap priority queue for simulation events. O(log n) push/pop, O(1) peek/markDead. */
import type { SimulationEvent } from "../events/simulation-events.ts";

/** Priority queue for simulation events sorted by timestamp (ascending). Uses binary min-heap with dead event pattern. */
export class EventHeap {
    private heap: SimulationEvent[] = [];                                       // Heap storage (array-based binary heap)
    private eventMap: Map<string, SimulationEvent> = new Map();                 // Event ID → Event for O(1) markDead lookup
    private liveCount = 0;                                                      // Count of live (non-dead) events

    /** Add a single event to the heap. O(log n). */
    push(event: SimulationEvent): void {
        this.heap.push(event);
        this.eventMap.set(event.id, event);
        if (!event.isDead) this.liveCount++;
        this.bubbleUp(this.heap.length - 1);
    }

    /** Add multiple events at once. Uses heapify for O(n) complexity. */
    pushAll(events: SimulationEvent[]): void {
        if (events.length === 0) return;
        for (const event of events) {
            this.heap.push(event);
            this.eventMap.set(event.id, event);
            if (!event.isDead) this.liveCount++;
        }
        const startIdx = Math.floor(this.heap.length / 2) - 1;                  // Start from last non-leaf node
        for (let i = startIdx; i >= 0; i--) this.bubbleDown(i);
    }

    /** Remove and return the earliest live event. Skips dead events. O(log n) amortized. */
    pop(): SimulationEvent | undefined {
        while (this.heap.length > 0) {
            const event = this.removeMin();
            if (!event) return undefined;
            if (!event.isDead) {
                this.liveCount--;
                return event;
            }
        }
        return undefined;
    }

    /** Peek at the earliest live event without removing. O(1) for live at top, O(log n) if dead need removal. */
    peek(): SimulationEvent | undefined {
        while (this.heap.length > 0) {
            const top = this.heap[0];
            if (!top) return undefined;
            if (!top.isDead) return top;
            this.removeMin();                                                   // Top is dead, remove it
        }
        return undefined;
    }

    /** Mark an event as dead (cancelled). O(1) via map lookup. Event skipped on pop/peek. */
    markDead(eventId: string): boolean {
        const event = this.eventMap.get(eventId);
        if (!event) return false;
        if (!event.isDead) {
            event.isDead = true;
            this.liveCount--;
        }
        return true;
    }

    /** Check if an event exists and is alive. */
    isAlive(eventId: string): boolean {
        const event = this.eventMap.get(eventId);
        return event !== undefined && !event.isDead;
    }

    get size(): number { return this.heap.length; }                             // Total events including dead
    get liveSize(): number { return this.liveCount; }                           // Live (non-dead) events
    get isEmpty(): boolean { return this.liveCount === 0; }                     // True if no live events

    /** Clear all events from the heap. */
    clear(): void {
        this.heap = [];
        this.eventMap.clear();
        this.liveCount = 0;
    }

    /** Get all events as array copy (for debugging/testing). */
    toArray(): SimulationEvent[] { return [...this.heap]; }

    /** Get all live events in timestamp order (for debugging/testing). Expensive for large heaps. */
    toLiveArray(): SimulationEvent[] {
        return this.heap.filter((e) => !e.isDead).sort((a, b) => a.timestamp - b.timestamp);
    }

    /** Remove and return the minimum element (root). */
    private removeMin(): SimulationEvent | undefined {
        if (this.heap.length === 0) return undefined;
        const min = this.heap[0]!;
        const last = this.heap.pop();
        if (this.heap.length > 0 && last) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }
        this.eventMap.delete(min.id);
        return min;
    }

    /** Bubble up an element to restore heap property. Used after push. */
    private bubbleUp(index: number): void {
        while (index > 0) {
            const parentIdx = Math.floor((index - 1) / 2);
            const current = this.heap[index]!, parent = this.heap[parentIdx]!;
            if (current.timestamp >= parent.timestamp) break;                   // Current not smaller than parent, done
            this.heap[index] = parent;
            this.heap[parentIdx] = current;
            index = parentIdx;
        }
    }

    /** Bubble down an element to restore heap property. Used after pop/removeMin. */
    private bubbleDown(index: number): void {
        const length = this.heap.length;
        while (true) {
            const leftIdx = 2 * index + 1, rightIdx = 2 * index + 2;
            let smallestIdx = index;
            if (leftIdx < length && this.heap[leftIdx]!.timestamp < this.heap[smallestIdx]!.timestamp) smallestIdx = leftIdx;
            if (rightIdx < length && this.heap[rightIdx]!.timestamp < this.heap[smallestIdx]!.timestamp) smallestIdx = rightIdx;
            if (smallestIdx === index) break;                                   // No swap needed, done
            const temp = this.heap[index]!;
            this.heap[index] = this.heap[smallestIdx]!;
            this.heap[smallestIdx] = temp;
            index = smallestIdx;
        }
    }
}

/** Create a new EventHeap pre-populated with events. */
export function createEventHeap(events: SimulationEvent[] = []): EventHeap {
    const heap = new EventHeap();
    if (events.length > 0) heap.pushAll(events);
    return heap;
}

/** Merge multiple event arrays into a single heap. */
export function mergeIntoHeap(...eventArrays: SimulationEvent[][]): EventHeap {
    return createEventHeap(eventArrays.flat());
}
