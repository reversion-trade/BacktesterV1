/** Output Types for Backtester-v2 - Event-based format with full event logs and algo analytics. */

export type { SwapEvent, TradeEvent, AlgoEvent, IndicatorFlipEvent, ConditionChangeEvent, StateTransitionEvent, SpecialIndicatorEvent, ConditionType, TransitionReason, ConditionSnapshot, SwapMetrics, AlgoMetrics, IndicatorAnalysis, NearMissAnalysis, ApproachSequence, BacktestOutput } from "../events/types.ts";

// EQUITY TRACKING

export interface EquityPoint {                          // A point on the equity curve tracking portfolio value over time
    time: number;                                       // Time value
    equity: number;                                     // Portfolio value
    drawdownPct: number;                                // Current drawdown percentage
    runupPct: number;                                   // Current runup percentage
    barIndex?: number;                                  // Bar index (for correlation with events)
    timestamp?: number;                                 // Unix timestamp
}

export interface SimulationResult {                     // Result from simulation loop with all events and data for output generation
    algoEvents: import("../events/types.ts").AlgoEvent[];
    swapEvents: import("../events/types.ts").SwapEvent[];
    trades: import("../events/types.ts").TradeEvent[];
    equityCurve: EquityPoint[];
}
