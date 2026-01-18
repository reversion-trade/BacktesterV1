/**
 * Simulation Event Types - Internal events for event-driven simulation loop.
 * Pre-calculated, stored in heap sorted by timestamp, processed via state machine.
 * Uses "dead event" pattern for O(1) cancellation. Expected ~1,000 events vs ~400,000 bars.
 */

import type { Direction } from "../core/types.ts";
import type { ConditionType } from "./types.ts";

// SIMULATION STATE (POSITION uses direction context variable instead of separate LONG/SHORT states)
export type SimState = "CASH" | "POSITION" | "TIMEOUT";

// EVENT TYPES
export type SimulationEventType = "SIGNAL_CROSSING" | "CONDITION_MET" | "CONDITION_UNMET" | "SL_TRIGGER" | "TP_TRIGGER" | "TRAILING_TRIGGER" | "TIMEOUT_EXPIRED";

// BASE EVENT
export interface SimulationEvent {
    id: string;                      // Unique ID for O(1) markDead lookup
    timestamp: number;               // Unix timestamp in seconds (heap sort key)
    barIndex: number;                // Candle index in dataset
    eventType: SimulationEventType;  // Event type discriminator
    isDead: boolean;                 // Dead event flag for O(1) cancellation
}

// SIGNAL CROSSING - Indicator boolean signal transitioned
export interface SignalCrossingEvent extends SimulationEvent {
    eventType: "SIGNAL_CROSSING";
    indicatorKey: string;            // e.g., "EMA:14:close:60"
    conditionType: ConditionType;
    isRequired: boolean;
    previousValue: boolean;
    newValue: boolean;
}

// CONDITION MET - Entry/exit condition became true (all requirements satisfied)
export interface ConditionMetEvent extends SimulationEvent {
    eventType: "CONDITION_MET";
    conditionType: ConditionType;
    triggeringIndicatorKey: string;  // Last indicator to flip true
}

// CONDITION UNMET - Entry/exit condition became false
export interface ConditionUnmetEvent extends SimulationEvent {
    eventType: "CONDITION_UNMET";
    conditionType: ConditionType;
    triggeringIndicatorKey: string;  // Indicator that flipped false
}

// PRICE TRIGGER BASE - Shared fields for SL/TP/Trailing events
interface PriceTriggerEventBase extends SimulationEvent {
    triggerPrice: number;
    entryPrice: number;
    direction: Direction;
    tradeId: number;
    subBarIndex?: number;            // Sub-bar index within candle
    checkpointIndex?: number;        // Price checkpoint array index
}

// SL TRIGGER - Stop loss hit
export interface SLTriggerEvent extends PriceTriggerEventBase {
    eventType: "SL_TRIGGER";
    slLevel: number;
}

// TP TRIGGER - Take profit hit
export interface TPTriggerEvent extends PriceTriggerEventBase {
    eventType: "TP_TRIGGER";
    tpLevel: number;
}

// TRAILING TRIGGER - Trailing stop hit
export interface TrailingTriggerEvent extends PriceTriggerEventBase {
    eventType: "TRAILING_TRIGGER";
    trailingLevel: number;
    peakPrice: number;               // Max favorable price before reversal
}

// TIMEOUT EXPIRED - Cooldown period ended
export interface TimeoutExpiredEvent extends SimulationEvent {
    eventType: "TIMEOUT_EXPIRED";
    tradeId: number;
    timeoutStartBar: number;
    cooldownBars: number;
}

// UNION TYPE
export type AnySimulationEvent = SignalCrossingEvent | ConditionMetEvent | ConditionUnmetEvent | SLTriggerEvent | TPTriggerEvent | TrailingTriggerEvent | TimeoutExpiredEvent;

// TYPE GUARDS
export function isSignalCrossingEvent(event: SimulationEvent): event is SignalCrossingEvent { return event.eventType === "SIGNAL_CROSSING"; }
export function isConditionMetEvent(event: SimulationEvent): event is ConditionMetEvent { return event.eventType === "CONDITION_MET"; }
export function isConditionUnmetEvent(event: SimulationEvent): event is ConditionUnmetEvent { return event.eventType === "CONDITION_UNMET"; }
export function isSLTriggerEvent(event: SimulationEvent): event is SLTriggerEvent { return event.eventType === "SL_TRIGGER"; }
export function isTPTriggerEvent(event: SimulationEvent): event is TPTriggerEvent { return event.eventType === "TP_TRIGGER"; }
export function isTrailingTriggerEvent(event: SimulationEvent): event is TrailingTriggerEvent { return event.eventType === "TRAILING_TRIGGER"; }
export function isTimeoutExpiredEvent(event: SimulationEvent): event is TimeoutExpiredEvent { return event.eventType === "TIMEOUT_EXPIRED"; }
export function isPriceTriggerEvent(event: SimulationEvent): event is SLTriggerEvent | TPTriggerEvent | TrailingTriggerEvent {
    return event.eventType === "SL_TRIGGER" || event.eventType === "TP_TRIGGER" || event.eventType === "TRAILING_TRIGGER";
}

// EVENT ID GENERATOR
let eventIdCounter = 0;
export function generateEventId(): string { return `evt_${++eventIdCounter}`; }
export function resetEventIdCounter(): void { eventIdCounter = 0; }

// FACTORY FUNCTIONS
export function createSignalCrossingEvent(params: { timestamp: number; barIndex: number; indicatorKey: string; conditionType: ConditionType; isRequired: boolean; previousValue: boolean; newValue: boolean }): SignalCrossingEvent {
    return { id: generateEventId(), eventType: "SIGNAL_CROSSING", isDead: false, ...params };
}

export function createConditionMetEvent(params: { timestamp: number; barIndex: number; conditionType: ConditionType; triggeringIndicatorKey: string }): ConditionMetEvent {
    return { id: generateEventId(), eventType: "CONDITION_MET", isDead: false, ...params };
}

export function createConditionUnmetEvent(params: { timestamp: number; barIndex: number; conditionType: ConditionType; triggeringIndicatorKey: string }): ConditionUnmetEvent {
    return { id: generateEventId(), eventType: "CONDITION_UNMET", isDead: false, ...params };
}

export function createSLTriggerEvent(params: { timestamp: number; barIndex: number; triggerPrice: number; entryPrice: number; direction: Direction; tradeId: number; slLevel: number; subBarIndex?: number; checkpointIndex?: number }): SLTriggerEvent {
    return { id: generateEventId(), eventType: "SL_TRIGGER", isDead: false, ...params };
}

export function createTPTriggerEvent(params: { timestamp: number; barIndex: number; triggerPrice: number; entryPrice: number; direction: Direction; tradeId: number; tpLevel: number; subBarIndex?: number; checkpointIndex?: number }): TPTriggerEvent {
    return { id: generateEventId(), eventType: "TP_TRIGGER", isDead: false, ...params };
}

export function createTrailingTriggerEvent(params: { timestamp: number; barIndex: number; triggerPrice: number; entryPrice: number; direction: Direction; tradeId: number; trailingLevel: number; peakPrice: number; subBarIndex?: number; checkpointIndex?: number }): TrailingTriggerEvent {
    return { id: generateEventId(), eventType: "TRAILING_TRIGGER", isDead: false, ...params };
}

export function createTimeoutExpiredEvent(params: { timestamp: number; barIndex: number; tradeId: number; timeoutStartBar: number; cooldownBars: number }): TimeoutExpiredEvent {
    return { id: generateEventId(), eventType: "TIMEOUT_EXPIRED", isDead: false, ...params };
}
