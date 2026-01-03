/**
 * Fake Database for Backtesting
 *
 * @module simulation/fakes/fake-database
 * @description
 * Implements IDatabase for backtesting using in-memory storage.
 * All events and state are stored in arrays/maps for fast access.
 *
 * @architecture
 * This is the backtest implementation of IDatabase. It:
 * - Stores all events in memory for fast access
 * - Maintains algo state in a simple object
 * - Provides efficient querying by bar index or time
 *
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: In-memory state persistence for backtesting
 */

import type { AlgoEvent, SwapEvent } from "../../events/types.ts";
import type {
  IDatabase,
  AlgoState,
  IndicatorStateSnapshot,
  EventQueryOptions,
} from "../../interfaces/database.ts";

// =============================================================================
// FAKE DATABASE IMPLEMENTATION
// =============================================================================

/**
 * In-memory database implementation for backtesting.
 *
 * @example
 * ```typescript
 * const db = new FakeDatabase();
 *
 * // Log events
 * await db.logAlgoEvent({
 *   type: "STATE_TRANSITION",
 *   timestamp: 1704067200,
 *   barIndex: 0,
 *   fromState: "FLAT",
 *   toState: "LONG",
 *   reason: "ENTRY_SIGNAL",
 * });
 *
 * // Get all events
 * const events = await db.getAlgoEvents();
 * ```
 */
export class FakeDatabase implements IDatabase {
  private algoEvents: AlgoEvent[] = [];
  private swapEvents: SwapEvent[] = [];
  private state: AlgoState | null = null;
  private indicatorSnapshots: Map<number, IndicatorStateSnapshot> = new Map();

  // ===========================================================================
  // IDatabase IMPLEMENTATION
  // ===========================================================================

  async logAlgoEvent(event: AlgoEvent): Promise<void> {
    this.algoEvents.push(event);
  }

  async logSwapEvent(swap: SwapEvent): Promise<void> {
    this.swapEvents.push(swap);
  }

  async getAlgoEvents(options?: EventQueryOptions): Promise<AlgoEvent[]> {
    return this.filterEvents(this.algoEvents, options);
  }

  async getSwapEvents(options?: EventQueryOptions): Promise<SwapEvent[]> {
    return this.filterEvents(this.swapEvents, options);
  }

  async saveState(state: AlgoState): Promise<void> {
    this.state = { ...state };
  }

  async getState(): Promise<AlgoState | null> {
    return this.state ? { ...this.state } : null;
  }

  async saveIndicatorSnapshot(snapshot: IndicatorStateSnapshot): Promise<void> {
    this.indicatorSnapshots.set(snapshot.barIndex, {
      ...snapshot,
      indicatorStates: new Map(snapshot.indicatorStates),
      conditionSnapshots: new Map(snapshot.conditionSnapshots),
    });
  }

  async getIndicatorSnapshotAtBar(barIndex: number): Promise<IndicatorStateSnapshot | null> {
    const snapshot = this.indicatorSnapshots.get(barIndex);
    if (!snapshot) {
      return null;
    }
    return {
      ...snapshot,
      indicatorStates: new Map(snapshot.indicatorStates),
      conditionSnapshots: new Map(snapshot.conditionSnapshots),
    };
  }

  async clear(): Promise<void> {
    this.algoEvents = [];
    this.swapEvents = [];
    this.state = null;
    this.indicatorSnapshots.clear();
  }

  // ===========================================================================
  // ADDITIONAL HELPERS (Backtest-specific)
  // ===========================================================================

  /**
   * Get all events without async overhead (for performance).
   */
  getAllAlgoEventsSync(): AlgoEvent[] {
    return [...this.algoEvents];
  }

  /**
   * Get all swap events without async overhead.
   */
  getAllSwapEventsSync(): SwapEvent[] {
    return [...this.swapEvents];
  }

  /**
   * Get event counts by type for debugging.
   */
  getEventCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.algoEvents) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return counts;
  }

  /**
   * Get the total number of indicator snapshots stored.
   */
  getSnapshotCount(): number {
    return this.indicatorSnapshots.size;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private filterEvents<T extends { timestamp: number; barIndex: number }>(
    events: T[],
    options?: EventQueryOptions
  ): T[] {
    if (!options) {
      return [...events];
    }

    let filtered = events;

    // Filter by time range
    if (options.startTime !== undefined) {
      filtered = filtered.filter(e => e.timestamp >= options.startTime!);
    }
    if (options.endTime !== undefined) {
      filtered = filtered.filter(e => e.timestamp <= options.endTime!);
    }

    // Filter by bar range
    if (options.startBar !== undefined) {
      filtered = filtered.filter(e => e.barIndex >= options.startBar!);
    }
    if (options.endBar !== undefined) {
      filtered = filtered.filter(e => e.barIndex <= options.endBar!);
    }

    // Filter by event types (for AlgoEvents)
    if (options.eventTypes && options.eventTypes.length > 0) {
      const types = new Set(options.eventTypes);
      filtered = filtered.filter(e => {
        const eventWithType = e as T & { type?: string };
        return eventWithType.type && types.has(eventWithType.type);
      });
    }

    // Apply limit
    if (options.limit !== undefined && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    return [...filtered];
  }
}
