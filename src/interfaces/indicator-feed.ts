// Indicator Feed Interface - Defines the contract for accessing indicator signals
// Implementations: PreCalculatedFeed (pre-computed for backtest), RealTimeFeed (live computation)

import type { ConditionType, ConditionSnapshot } from "../events/types.ts";

// INDICATOR INFO TYPES

export interface IndicatorInfo {
    key: string;                  // Unique key identifying this indicator (includes params hash)
    type: string;                 // Indicator type name (e.g., "RSI", "MACD")
    conditionType: ConditionType; // Which condition this indicator belongs to
    isRequired: boolean;          // Whether this is a required or optional indicator
    description?: string;         // Human-readable description
}

export interface IndicatorState {
    key: string;        // Unique indicator key
    signal: boolean;    // Current boolean signal
    rawValue?: number;  // Raw numeric value (if applicable)
    lastUpdated: number; // Timestamp of last update
}

export interface ConditionEvaluation {
    conditionType: ConditionType;      // Which condition was evaluated
    isMet: boolean;                    // Whether the condition is met
    snapshot: ConditionSnapshot;       // Detailed snapshot
    indicatorStates: IndicatorState[]; // States of contributing indicators
}

// INDICATOR FEED INTERFACE

export interface IIndicatorFeed {
    setCurrentBar(barIndex: number, timestamp: number): void;            // Set current bar index (advances through signals)
    getCurrentBarIndex(): number;                                        // Get current bar index
    getCurrentSignals(): Map<string, boolean>;                           // Get all indicator signals for current bar
    getSignal(indicatorKey: string): boolean | undefined;                // Get specific indicator's signal
    getRawValue(indicatorKey: string): number | undefined;               // Get raw numeric value (if applicable)
    evaluateCondition(conditionType: ConditionType): ConditionEvaluation; // Evaluate a condition (entry/exit)
    getConditionSnapshot(conditionType: ConditionType): ConditionSnapshot; // Get snapshot of condition's state
    getIndicatorInfo(): Map<string, IndicatorInfo>;                      // Get metadata for all indicators
    getIndicatorsForCondition(conditionType: ConditionType): IndicatorInfo[]; // Get indicators for specific condition
    getPreviousConditionMet(conditionType: ConditionType): boolean;      // Check if condition was met on previous bar
    getTotalBars(): number;                                              // Get total number of bars in feed
}
