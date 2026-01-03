/**
 * Events Module
 *
 * Exports event types and the EventCollector for use in simulation.
 */

// Types
export type {
  // Common
  ConditionType,
  TransitionReason,
  // Swap events
  SwapEvent,
  TradeEvent,
  // Algo events
  AlgoEvent,
  IndicatorFlipEvent,
  ConditionChangeEvent,
  StateTransitionEvent,
  SpecialIndicatorEvent,
  ConditionSnapshot,
  // Analysis
  ApproachSequence,
  NearMissAnalysis,
  IndicatorAnalysis,
  // Metrics
  SwapMetrics,
  AlgoMetrics,
  // Output
  BacktestOutput,
} from "./types.ts";

// Collector
export { EventCollector, type IndicatorInfo } from "./collector.ts";
