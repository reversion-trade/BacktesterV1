/**
 * Simulation Event Types for Event-Driven Backtester
 *
 * @module events/simulation-events
 * @description
 * Internal event types that drive the event-driven simulation loop.
 * These are DIFFERENT from AlgoEvents (output events for metrics).
 *
 * Simulation events are:
 * - Pre-calculated before simulation starts
 * - Stored in a priority heap sorted by timestamp
 * - Processed one-by-one to drive the state machine
 * - Use "dead event" pattern for O(1) cancellation
 *
 * @architecture
 * Event Flow:
 * 1. Extract crossing events from boolean signal arrays
 * 2. Build heap with all events sorted by timestamp
 * 3. Process events via unified loop + state machine
 * 4. Mark SL/TP events dead when position exits early
 *
 * @performance
 * Expected: ~1,000 events vs ~400,000 bar iterations
 * Dead event pattern: O(1) mark vs O(n) delete from heap
 *
 * @audit-trail
 * - Created: 2026-01-09 (Event-Driven Simulation Implementation)
 * - Purpose: Enable heap-based simulation with 400x fewer iterations
 */

import type { Direction, PositionState } from "../core/types.ts";
import type { ConditionType } from "./types.ts";

// =============================================================================
// SIMULATION STATE
// =============================================================================

/**
 * Simulation state machine states.
 * Used in the unified loop's switch statement.
 */
export type SimState = "CASH" | "LONG" | "SHORT" | "TIMEOUT";

// =============================================================================
// EVENT TYPES
// =============================================================================

/**
 * All simulation event types.
 *
 * - SIGNAL_CROSSING: An indicator's boolean signal flipped
 * - CONDITION_MET: Entry/exit condition became true
 * - CONDITION_UNMET: Entry/exit condition became false
 * - SL_TRIGGER: Stop loss price was hit
 * - TP_TRIGGER: Take profit price was hit
 * - TRAILING_TRIGGER: Trailing stop price was hit
 * - TIMEOUT_EXPIRED: Cooldown period ended
 */
export type SimulationEventType =
    | "SIGNAL_CROSSING"
    | "CONDITION_MET"
    | "CONDITION_UNMET"
    | "SL_TRIGGER"
    | "TP_TRIGGER"
    | "TRAILING_TRIGGER"
    | "TIMEOUT_EXPIRED";

// =============================================================================
// BASE EVENT INTERFACE
// =============================================================================

/**
 * Base simulation event.
 * All events in the heap extend this interface.
 */
export interface SimulationEvent {
    /** Unique identifier for this event (for O(1) markDead lookup) */
    id: string;

    /** Unix timestamp in seconds (heap sort key) */
    timestamp: number;

    /** Candle index in the dataset (for quick data lookup) */
    barIndex: number;

    /** Event type discriminator */
    eventType: SimulationEventType;

    /**
     * Dead event flag.
     * When true, this event is skipped during heap.pop().
     * Used for O(1) cancellation instead of O(n) heap deletion.
     *
     * @example
     * // When position exits via signal, mark pending SL/TP as dead:
     * if (pendingSlEventId) heap.markDead(pendingSlEventId);
     */
    isDead: boolean;
}

// =============================================================================
// SIGNAL CROSSING EVENT
// =============================================================================

/**
 * An indicator's boolean signal transitioned from one state to another.
 *
 * Extracted from pre-calculated signal arrays by scanning for transitions.
 * These are the "raw" events that condition events are derived from.
 *
 * @example
 * // Signal array: [false, false, true, true, false]
 * // Crossing events at bars 2 (false→true) and 4 (true→false)
 */
export interface SignalCrossingEvent extends SimulationEvent {
    eventType: "SIGNAL_CROSSING";

    /** Indicator cache key (e.g., "EMA:14:close:60") */
    indicatorKey: string;

    /** Which condition this indicator belongs to */
    conditionType: ConditionType;

    /** Whether this is a required or optional indicator */
    isRequired: boolean;

    /** Previous signal value (before transition) */
    previousValue: boolean;

    /** New signal value (after transition) */
    newValue: boolean;
}

// =============================================================================
// CONDITION EVENTS
// =============================================================================

/**
 * An entry/exit condition became met (all requirements satisfied).
 *
 * Derived from signal crossing events when:
 * - All required indicators are true
 * - At least one optional indicator is true (if any optional exist)
 */
export interface ConditionMetEvent extends SimulationEvent {
    eventType: "CONDITION_MET";

    /** Which condition became met */
    conditionType: ConditionType;

    /** The indicator key that triggered this (the last one to flip true) */
    triggeringIndicatorKey: string;
}

/**
 * An entry/exit condition became unmet (requirements no longer satisfied).
 *
 * Derived from signal crossing events when a required indicator flips false.
 */
export interface ConditionUnmetEvent extends SimulationEvent {
    eventType: "CONDITION_UNMET";

    /** Which condition became unmet */
    conditionType: ConditionType;

    /** The indicator key that caused this (flipped false) */
    triggeringIndicatorKey: string;
}

// =============================================================================
// PRICE TRIGGER EVENTS
// =============================================================================

/**
 * Base interface for price-triggered events (SL, TP, Trailing).
 *
 * These events are scheduled when entering a position, with trigger times
 * found by forward-scanning the price data from the entry point.
 */
interface PriceTriggerEventBase extends SimulationEvent {
    /** Price level that triggered this event */
    triggerPrice: number;

    /** Entry price of the position */
    entryPrice: number;

    /** Direction of the position */
    direction: Direction;

    /** Trade ID this event belongs to */
    tradeId: number;

    /**
     * Sub-bar index within the candle (for sub-bar precision).
     * Undefined if trigger occurred at OHLC boundary.
     */
    subBarIndex?: number;

    /**
     * Checkpoint index for sub-bar simulation.
     * Maps to the price checkpoint array generated for the candle.
     */
    checkpointIndex?: number;
}

/**
 * Stop loss was triggered.
 *
 * Scheduled when entering a position if SL is configured.
 * Marked dead if position exits via signal or TP first.
 */
export interface SLTriggerEvent extends PriceTriggerEventBase {
    eventType: "SL_TRIGGER";

    /** The SL level that was hit */
    slLevel: number;
}

/**
 * Take profit was triggered.
 *
 * Scheduled when entering a position if TP is configured.
 * Marked dead if position exits via signal or SL first.
 */
export interface TPTriggerEvent extends PriceTriggerEventBase {
    eventType: "TP_TRIGGER";

    /** The TP level that was hit */
    tpLevel: number;
}

/**
 * Trailing stop was triggered.
 *
 * Similar to SL but with dynamic level updates.
 * The level updates as price moves favorably.
 */
export interface TrailingTriggerEvent extends PriceTriggerEventBase {
    eventType: "TRAILING_TRIGGER";

    /** The trailing stop level that was hit */
    trailingLevel: number;

    /** Maximum favorable price reached before reversal */
    peakPrice: number;
}

// =============================================================================
// TIMEOUT EVENT
// =============================================================================

/**
 * Cooldown period expired.
 *
 * Scheduled when entering TIMEOUT state.
 * The handler checks timeout mode conditions before transitioning to CASH.
 */
export interface TimeoutExpiredEvent extends SimulationEvent {
    eventType: "TIMEOUT_EXPIRED";

    /** Trade ID that triggered the timeout */
    tradeId: number;

    /** Bar index when timeout started */
    timeoutStartBar: number;

    /** Number of cooldown bars configured */
    cooldownBars: number;
}

// =============================================================================
// UNION TYPE
// =============================================================================

/**
 * Union of all simulation event types.
 * Used for type-safe event handling in the simulation loop.
 */
export type AnySimulationEvent =
    | SignalCrossingEvent
    | ConditionMetEvent
    | ConditionUnmetEvent
    | SLTriggerEvent
    | TPTriggerEvent
    | TrailingTriggerEvent
    | TimeoutExpiredEvent;

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard for signal crossing events.
 */
export function isSignalCrossingEvent(event: SimulationEvent): event is SignalCrossingEvent {
    return event.eventType === "SIGNAL_CROSSING";
}

/**
 * Type guard for condition met events.
 */
export function isConditionMetEvent(event: SimulationEvent): event is ConditionMetEvent {
    return event.eventType === "CONDITION_MET";
}

/**
 * Type guard for condition unmet events.
 */
export function isConditionUnmetEvent(event: SimulationEvent): event is ConditionUnmetEvent {
    return event.eventType === "CONDITION_UNMET";
}

/**
 * Type guard for SL trigger events.
 */
export function isSLTriggerEvent(event: SimulationEvent): event is SLTriggerEvent {
    return event.eventType === "SL_TRIGGER";
}

/**
 * Type guard for TP trigger events.
 */
export function isTPTriggerEvent(event: SimulationEvent): event is TPTriggerEvent {
    return event.eventType === "TP_TRIGGER";
}

/**
 * Type guard for trailing trigger events.
 */
export function isTrailingTriggerEvent(event: SimulationEvent): event is TrailingTriggerEvent {
    return event.eventType === "TRAILING_TRIGGER";
}

/**
 * Type guard for timeout expired events.
 */
export function isTimeoutExpiredEvent(event: SimulationEvent): event is TimeoutExpiredEvent {
    return event.eventType === "TIMEOUT_EXPIRED";
}

/**
 * Type guard for any price trigger event (SL, TP, or Trailing).
 */
export function isPriceTriggerEvent(
    event: SimulationEvent
): event is SLTriggerEvent | TPTriggerEvent | TrailingTriggerEvent {
    return (
        event.eventType === "SL_TRIGGER" ||
        event.eventType === "TP_TRIGGER" ||
        event.eventType === "TRAILING_TRIGGER"
    );
}

// =============================================================================
// EVENT FACTORY FUNCTIONS
// =============================================================================

let eventIdCounter = 0;

/**
 * Generate a unique event ID.
 * Uses simple counter for performance (no UUID overhead).
 */
export function generateEventId(): string {
    return `evt_${++eventIdCounter}`;
}

/**
 * Reset event ID counter (for testing).
 */
export function resetEventIdCounter(): void {
    eventIdCounter = 0;
}

/**
 * Create a signal crossing event.
 */
export function createSignalCrossingEvent(params: {
    timestamp: number;
    barIndex: number;
    indicatorKey: string;
    conditionType: ConditionType;
    isRequired: boolean;
    previousValue: boolean;
    newValue: boolean;
}): SignalCrossingEvent {
    return {
        id: generateEventId(),
        eventType: "SIGNAL_CROSSING",
        isDead: false,
        ...params,
    };
}

/**
 * Create a condition met event.
 */
export function createConditionMetEvent(params: {
    timestamp: number;
    barIndex: number;
    conditionType: ConditionType;
    triggeringIndicatorKey: string;
}): ConditionMetEvent {
    return {
        id: generateEventId(),
        eventType: "CONDITION_MET",
        isDead: false,
        ...params,
    };
}

/**
 * Create a condition unmet event.
 */
export function createConditionUnmetEvent(params: {
    timestamp: number;
    barIndex: number;
    conditionType: ConditionType;
    triggeringIndicatorKey: string;
}): ConditionUnmetEvent {
    return {
        id: generateEventId(),
        eventType: "CONDITION_UNMET",
        isDead: false,
        ...params,
    };
}

/**
 * Create an SL trigger event.
 */
export function createSLTriggerEvent(params: {
    timestamp: number;
    barIndex: number;
    triggerPrice: number;
    entryPrice: number;
    direction: Direction;
    tradeId: number;
    slLevel: number;
    subBarIndex?: number;
    checkpointIndex?: number;
}): SLTriggerEvent {
    return {
        id: generateEventId(),
        eventType: "SL_TRIGGER",
        isDead: false,
        ...params,
    };
}

/**
 * Create a TP trigger event.
 */
export function createTPTriggerEvent(params: {
    timestamp: number;
    barIndex: number;
    triggerPrice: number;
    entryPrice: number;
    direction: Direction;
    tradeId: number;
    tpLevel: number;
    subBarIndex?: number;
    checkpointIndex?: number;
}): TPTriggerEvent {
    return {
        id: generateEventId(),
        eventType: "TP_TRIGGER",
        isDead: false,
        ...params,
    };
}

/**
 * Create a trailing trigger event.
 */
export function createTrailingTriggerEvent(params: {
    timestamp: number;
    barIndex: number;
    triggerPrice: number;
    entryPrice: number;
    direction: Direction;
    tradeId: number;
    trailingLevel: number;
    peakPrice: number;
    subBarIndex?: number;
    checkpointIndex?: number;
}): TrailingTriggerEvent {
    return {
        id: generateEventId(),
        eventType: "TRAILING_TRIGGER",
        isDead: false,
        ...params,
    };
}

/**
 * Create a timeout expired event.
 */
export function createTimeoutExpiredEvent(params: {
    timestamp: number;
    barIndex: number;
    tradeId: number;
    timeoutStartBar: number;
    cooldownBars: number;
}): TimeoutExpiredEvent {
    return {
        id: generateEventId(),
        eventType: "TIMEOUT_EXPIRED",
        isDead: false,
        ...params,
    };
}
