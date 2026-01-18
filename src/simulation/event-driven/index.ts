/** Event-Driven Simulation - Heap-based event processing (~400x fewer iterations than bar-by-bar). */

// EVENT TYPES
export { type SimState, type SimulationEventType, type SimulationEvent, type SignalCrossingEvent, type ConditionMetEvent, type ConditionUnmetEvent, type SLTriggerEvent, type TPTriggerEvent, type TrailingTriggerEvent, type TimeoutExpiredEvent, type AnySimulationEvent, isSignalCrossingEvent, isConditionMetEvent, isConditionUnmetEvent, isSLTriggerEvent, isTPTriggerEvent, isTrailingTriggerEvent, isTimeoutExpiredEvent, isPriceTriggerEvent, generateEventId, resetEventIdCounter, createSignalCrossingEvent, createConditionMetEvent, createConditionUnmetEvent, createSLTriggerEvent, createTPTriggerEvent, createTrailingTriggerEvent, createTimeoutExpiredEvent } from "../../events/simulation-events.ts";

// EVENT HEAP
export { EventHeap, createEventHeap, mergeIntoHeap } from "../event-heap.ts";

// EVENT EXTRACTOR
export { extractSimulationEvents, findFirstConditionMet, getCrossingsForIndicator, getEventsForCondition, summarizeOpportunities, type EventExtractionResult, type EventExtractionStats } from "../event-extractor.ts";

// SL/TP SCANNER
export { scanForSLTPTriggers, wouldSLTrigger, wouldTPTrigger, getLevels, type SLTPScanInput, type SLTPScanResult, type ScanStats } from "../sl-tp-scanner.ts";

// EVENT SIMULATOR
export { runEventDrivenSimulation, type EventSimulatorConfig, type EventSimulatorResult, type EquityPoint, type SimulatorStats } from "../event-simulator.ts";
