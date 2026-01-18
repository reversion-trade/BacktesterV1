/**
 * Event-Driven Simulation - Barrel Export
 *
 * @module simulation/event-driven
 * @description
 * Exports all components of the event-driven simulation system.
 *
 * This system replaces bar-by-bar iteration with heap-based event processing
 * for ~400x fewer iterations.
 *
 * @architecture
 * Components:
 * - SimulationEvent types: Events that drive the simulation
 * - EventHeap: Priority queue for event ordering
 * - EventExtractor: Extract events from signal arrays
 * - SLTPScanner: Pre-calculate SL/TP trigger times
 * - EventSimulator: Unified simulation loop with state machine
 *
 * @audit-trail
 * - Created: 2026-01-09 (Event-Driven Simulation Implementation)
 */

// =============================================================================
// EVENT TYPES
// =============================================================================
export {
    // State type
    type SimState,

    // Event types
    type SimulationEventType,
    type SimulationEvent,
    type SignalCrossingEvent,
    type ConditionMetEvent,
    type ConditionUnmetEvent,
    type SLTriggerEvent,
    type TPTriggerEvent,
    type TrailingTriggerEvent,
    type TimeoutExpiredEvent,
    type AnySimulationEvent,

    // Type guards
    isSignalCrossingEvent,
    isConditionMetEvent,
    isConditionUnmetEvent,
    isSLTriggerEvent,
    isTPTriggerEvent,
    isTrailingTriggerEvent,
    isTimeoutExpiredEvent,
    isPriceTriggerEvent,

    // Factory functions
    generateEventId,
    resetEventIdCounter,
    createSignalCrossingEvent,
    createConditionMetEvent,
    createConditionUnmetEvent,
    createSLTriggerEvent,
    createTPTriggerEvent,
    createTrailingTriggerEvent,
    createTimeoutExpiredEvent,
} from "../../events/simulation-events.ts";

// =============================================================================
// EVENT HEAP
// =============================================================================
export { EventHeap, createEventHeap, mergeIntoHeap } from "../event-heap.ts";

// =============================================================================
// EVENT EXTRACTOR
// =============================================================================
export {
    extractSimulationEvents,
    findFirstConditionMet,
    getCrossingsForIndicator,
    getEventsForCondition,
    summarizeOpportunities,
    type EventExtractionResult,
    type EventExtractionStats,
} from "../event-extractor.ts";

// =============================================================================
// SL/TP SCANNER
// =============================================================================
export {
    scanForSLTPTriggers,
    wouldSLTrigger,
    wouldTPTrigger,
    getLevels,
    type SLTPScanInput,
    type SLTPScanResult,
    type ScanStats,
} from "../sl-tp-scanner.ts";

// =============================================================================
// EVENT SIMULATOR
// =============================================================================
export {
    runEventDrivenSimulation,
    type EventSimulatorConfig,
    type EventSimulatorResult,
    type EquityPoint,
    type SimulatorStats,
} from "../event-simulator.ts";
