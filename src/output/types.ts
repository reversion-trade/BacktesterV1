/**
 * Output Types for Backtester-v2
 *
 * Event-based format with full event logs and algo analytics.
 */

// Re-export event types from events module for convenience
export type {
    SwapEvent,
    TradeEvent,
    AlgoEvent,
    IndicatorFlipEvent,
    ConditionChangeEvent,
    StateTransitionEvent,
    SpecialIndicatorEvent,
    ConditionType,
    TransitionReason,
    ConditionSnapshot,
    SwapMetrics,
    AlgoMetrics,
    IndicatorAnalysis,
    NearMissAnalysis,
    ApproachSequence,
    BacktestOutput,
} from "../events/types.ts";

// =============================================================================
// EQUITY TRACKING
// =============================================================================

/**
 * A point on the equity curve.
 * Tracks portfolio value over time.
 */
export interface EquityPoint {
    time: number;
    equity: number;
    drawdownPct: number;
    runupPct: number;
    barIndex?: number;        // Bar index (for correlation with events)
    timestamp?: number;       // Unix timestamp
}

/**
 * Result from the simulation loop.
 * Contains all events and data needed for output generation.
 */
export interface SimulationResult {
    algoEvents: import("../events/types.ts").AlgoEvent[];
    swapEvents: import("../events/types.ts").SwapEvent[];
    trades: import("../events/types.ts").TradeEvent[];
    equityCurve: EquityPoint[];
}

