/**
 * Database Interface
 *
 * @module interfaces/database
 * @description
 * Defines the interface for state persistence and event logging.
 * Implementations:
 * - FakeDatabase: In-memory storage for backtesting
 * - RealDatabase: PostgreSQL/etc for live trading
 *
 * @architecture
 * This interface enables the algo class to persist state without
 * knowing whether it's in a backtest or live environment. The algo
 * class should have NO conditional logic like 'if is_backtesting:
 * do X else do Y'.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 3: Dependency Injection)
 * - Purpose: Abstract state persistence for live/backtest parity
 */

import type { PositionState, Direction } from "../core/types.ts";
import type { AlgoEvent, SwapEvent, ConditionSnapshot, ConditionType } from "../events/types.ts";

// =============================================================================
// STATE TYPES
// =============================================================================

/**
 * Current algorithm state that needs to be persisted.
 */
export interface AlgoState {
    /** Current position state (FLAT, LONG, SHORT) */
    positionState: PositionState;
    /** Current trade ID (increments on each new position) */
    currentTradeId: number;
    /** Entry price if in position */
    entryPrice: number | null;
    /** Entry timestamp if in position */
    entryTime: number | null;
    /** Position size in asset units */
    positionSize: number;
    /** Position size in USD at entry */
    positionSizeUSD: number;
    /** Current capital in USD */
    capitalUSD: number;
    /** Stop loss level (if set) */
    stopLossLevel: number | null;
    /** Take profit level (if set) */
    takeProfitLevel: number | null;
    /** Trailing stop level (if set) */
    trailingStopLevel: number | null;
    /** Peak price for trailing stop calculation */
    trailingPeakPrice: number | null;
    /** Last processed bar index */
    lastBarIndex: number;
    /** Last processed timestamp */
    lastTimestamp: number;
}

/**
 * Snapshot of indicator states at a point in time.
 */
export interface IndicatorStateSnapshot {
    /** Timestamp of snapshot */
    timestamp: number;
    /** Bar index of snapshot */
    barIndex: number;
    /** Map of indicator key to boolean signal */
    indicatorStates: Map<string, boolean>;
    /** Condition snapshots */
    conditionSnapshots: Map<ConditionType, ConditionSnapshot>;
}

/**
 * Query options for retrieving events.
 */
export interface EventQueryOptions {
    /** Start timestamp (inclusive) */
    startTime?: number;
    /** End timestamp (inclusive) */
    endTime?: number;
    /** Start bar index (inclusive) */
    startBar?: number;
    /** End bar index (inclusive) */
    endBar?: number;
    /** Maximum number of events to return */
    limit?: number;
    /** Event types to filter (for AlgoEvents) */
    eventTypes?: string[];
}

// =============================================================================
// DATABASE INTERFACE
// =============================================================================

/**
 * Interface for state persistence and event logging.
 *
 * Abstracts the storage layer so the algo class can work
 * identically in backtest and live environments.
 *
 * @example
 * ```typescript
 * // Algo class uses database without knowing environment
 * async onPositionEntry(entry: PositionEntry) {
 *   await this.database.saveState({
 *     positionState: "LONG",
 *     entryPrice: entry.price,
 *     // ...
 *   });
 *
 *   await this.database.logAlgoEvent({
 *     type: "STATE_TRANSITION",
 *     fromState: "FLAT",
 *     toState: "LONG",
 *     // ...
 *   });
 * }
 * ```
 */
export interface IDatabase {
    /**
     * Log an algorithm event.
     *
     * @param event - The algo event to log
     */
    logAlgoEvent(event: AlgoEvent): Promise<void>;

    /**
     * Log a swap event.
     *
     * @param swap - The swap event to log
     */
    logSwapEvent(swap: SwapEvent): Promise<void>;

    /**
     * Get all logged algo events.
     *
     * @param options - Query options for filtering
     * @returns Array of algo events
     */
    getAlgoEvents(options?: EventQueryOptions): Promise<AlgoEvent[]>;

    /**
     * Get all logged swap events.
     *
     * @param options - Query options for filtering
     * @returns Array of swap events
     */
    getSwapEvents(options?: EventQueryOptions): Promise<SwapEvent[]>;

    /**
     * Save the current algo state.
     *
     * @param state - The state to save
     */
    saveState(state: AlgoState): Promise<void>;

    /**
     * Get the current algo state.
     *
     * @returns The current state or null if not initialized
     */
    getState(): Promise<AlgoState | null>;

    /**
     * Save an indicator state snapshot.
     *
     * @param snapshot - The indicator state snapshot
     */
    saveIndicatorSnapshot(snapshot: IndicatorStateSnapshot): Promise<void>;

    /**
     * Get indicator state at a specific bar.
     *
     * @param barIndex - The bar index to query
     * @returns The snapshot or null if not found
     */
    getIndicatorSnapshotAtBar(barIndex: number): Promise<IndicatorStateSnapshot | null>;

    /**
     * Clear all stored data.
     * Used for resetting between backtests.
     */
    clear(): Promise<void>;
}
