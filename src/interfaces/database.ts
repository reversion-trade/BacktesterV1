// Database Interface - Defines the contract for state persistence and event logging
// Implementations: FakeDatabase (in-memory for backtest), RealDatabase (PostgreSQL for live)

import type { PositionState, Direction } from "../core/types.ts";
import type { AlgoEvent, SwapEvent, ConditionSnapshot, ConditionType } from "../events/types.ts";

// STATE TYPES

export interface AlgoState {
    positionState: PositionState;      // CASH, LONG, SHORT, or TIMEOUT
    currentTradeId: number;            // Which trade number are we on?
    entryPrice: number | null;         // Price we entered at (null if no position)
    entryTime: number | null;          // When we entered
    positionSize: number;              // How many coins we hold
    positionSizeUSD: number;           // How much USD that was worth at entry
    capitalUSD: number;                // Current total capital
    stopLossLevel: number | null;      // SL price (if set)
    takeProfitLevel: number | null;    // TP price (if set)
    trailingStopLevel: number | null;  // Trailing SL price (if set)
    trailingPeakPrice: number | null;  // Highest price since entry (for trailing)
    lastBarIndex: number;              // Which bar we last processed
    lastTimestamp: number;             // When we last processed
}

export interface IndicatorStateSnapshot {
    timestamp: number;                                      // Timestamp of snapshot
    barIndex: number;                                       // Bar index of snapshot
    indicatorStates: Map<string, boolean>;                  // Map of indicator key to boolean signal
    conditionSnapshots: Map<ConditionType, ConditionSnapshot>; // Condition snapshots
}

export interface EventQueryOptions {
    startTime?: number;    // Start timestamp (inclusive)
    endTime?: number;      // End timestamp (inclusive)
    startBar?: number;     // Start bar index (inclusive)
    endBar?: number;       // End bar index (inclusive)
    limit?: number;        // Maximum number of events to return
    eventTypes?: string[]; // Event types to filter (for AlgoEvents)
}

// DATABASE INTERFACE

export interface IDatabase {
    logAlgoEvent(event: AlgoEvent): Promise<void>;                              // Log an algorithm event
    logSwapEvent(swap: SwapEvent): Promise<void>;                               // Log a swap/trade event
    getAlgoEvents(options?: EventQueryOptions): Promise<AlgoEvent[]>;           // Get all logged algo events
    getSwapEvents(options?: EventQueryOptions): Promise<SwapEvent[]>;           // Get all logged swap events
    saveState(state: AlgoState): Promise<void>;                                 // Save the current algo state
    getState(): Promise<AlgoState | null>;                                      // Get the current algo state
    saveIndicatorSnapshot(snapshot: IndicatorStateSnapshot): Promise<void>;     // Save indicator state snapshot
    getIndicatorSnapshotAtBar(barIndex: number): Promise<IndicatorStateSnapshot | null>; // Get snapshot at bar
    clear(): Promise<void>;                                                     // Clear all stored data (reset between backtests)
}
