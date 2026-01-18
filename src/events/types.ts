/**
 * Event Types - SwapEvents (wallet conversions) and AlgoEvents (internal state changes).
 * Enables clear metrics categorization, diagnostic insights, and near-miss analysis.
 */

import type { Direction, PositionState } from "../core/types.ts";

// COMMON TYPES
export type ConditionType = "LONG_ENTRY" | "LONG_EXIT" | "SHORT_ENTRY" | "SHORT_EXIT";
export type TransitionReason = "ENTRY_SIGNAL" | "EXIT_SIGNAL" | "STOP_LOSS" | "TAKE_PROFIT" | "TRAILING_STOP" | "END_OF_BACKTEST";

// SWAP EVENTS - Pure wallet conversions (USD → BTC or BTC → USD)
export interface SwapEvent {
    id: string;
    timestamp: number;               // Unix timestamp (seconds)
    barIndex: number;                // Candle index in dataset
    fromAsset: string;               // Asset leaving wallet (e.g., "USD", "BTC")
    toAsset: string;                 // Asset entering wallet
    fromAmount: number;
    toAmount: number;
    price: number;                   // Execution price
    feeUSD: number;
    slippageUSD: number;
    isEntry?: boolean;               // Opening (entry) or closing (exit) position
    tradeDirection?: Direction;
}

// TRADE EVENT - Complete trade (entry + exit swaps paired)
export interface TradeEvent {
    tradeId: number;
    direction: Direction;
    entrySwap: SwapEvent;            // USD → Asset
    exitSwap: SwapEvent;             // Asset → USD
    pnlUSD: number;                  // Net profit/loss after fees
    pnlPct: number;                  // P&L as percentage of entry
    durationBars: number;
    durationSeconds: number;
}

// CONDITION SNAPSHOT - State at a point in time, tracks "how close" to triggering
export interface ConditionSnapshot {
    requiredTrue: number;            // Required indicators currently true
    requiredTotal: number;
    optionalTrue: number;            // Optional indicators currently true
    optionalTotal: number;
    conditionMet: boolean;           // All required + at least 1 optional (if any)
    distanceFromTrigger: number;     // 0=met, N=N more indicators needed
}

// ALGO EVENTS - Internal state changes
interface AlgoEventBase {
    timestamp: number;
    barIndex: number;
}

export interface IndicatorFlipEvent extends AlgoEventBase {
    type: "INDICATOR_FLIP";
    indicatorKey: string;            // Cache key (e.g., "RSI:14:close:60")
    indicatorType: string;           // e.g., "RSI", "MACD"
    previousValue: boolean;
    newValue: boolean;
    conditionType: ConditionType;
    isRequired: boolean;
    conditionSnapshot: ConditionSnapshot; // State AFTER this flip
}

export interface ConditionChangeEvent extends AlgoEventBase {
    type: "CONDITION_CHANGE";
    conditionType: ConditionType;
    previousState: boolean;
    newState: boolean;
    triggeringIndicatorKey?: string; // Which indicator caused this change
    snapshot: ConditionSnapshot;
}

export interface StateTransitionEvent extends AlgoEventBase {
    type: "STATE_TRANSITION";
    fromState: PositionState;
    toState: PositionState;
    reason: TransitionReason;
    tradeId?: number;
}

export interface SpecialIndicatorEvent extends AlgoEventBase {
    type: "SL_SET" | "TP_SET" | "TRAILING_SET" | "TRAILING_UPDATE" | "SL_HIT" | "TP_HIT" | "TRAILING_HIT";
    price: number;                   // Current price when event occurred
    level: number;                   // SL/TP/Trailing level
    direction: Direction;
    tradeId: number;
}

export type AlgoEvent = IndicatorFlipEvent | ConditionChangeEvent | StateTransitionEvent | SpecialIndicatorEvent;

// NEAR-MISS ANALYSIS - Tracks "almost traded" scenarios
export interface ApproachSequence {
    startBar: number;
    endBar: number;
    startDistance: number;
    minDistance: number;             // Closest we got during approach
    triggered: boolean;
    conditionType: ConditionType;
}

export interface NearMissAnalysis {
    conditionType: ConditionType;
    distanceHistogram: Record<number, number>; // distance → count of times reached
    closestApproachWithoutTrigger: number;
    approachSequences: ApproachSequence[];
    totalEvaluations: number;
    triggerCount: number;
}

// INDICATOR ANALYSIS - Per-indicator behavior metrics
export interface IndicatorAnalysis {
    indicatorKey: string;
    indicatorType: string;
    conditionType: ConditionType;
    isRequired: boolean;
    flipCount: number;               // Total true↔false transitions
    avgDurationTrueBars: number;
    avgDurationFalseBars: number;
    pctTimeTrue: number;
    triggeringFlipCount: number;     // Times this was the deciding indicator
    blockingCount: number;           // Times FALSE while all others TRUE
    usefulnessScore: number;         // 0-100, low = always true/never flips
}

// SWAP METRICS - Traditional trading performance
export interface SwapMetrics {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnlUSD: number;
    grossProfitUSD: number;
    grossLossUSD: number;
    avgPnlUSD: number;
    avgWinUSD: number;
    avgLossUSD: number;
    largestWinUSD: number;
    largestLossUSD: number;
    profitFactor: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdownPct: number;
    maxDrawdownUSD: number;
    calmarRatio: number;
    longTrades: number;
    shortTrades: number;
    longWinRate: number;
    shortWinRate: number;
    longPnlUSD: number;
    shortPnlUSD: number;
    avgTradeDurationBars: number;
    avgTradeDurationSeconds: number;
    avgWinDurationBars: number;
    avgLossDurationBars: number;
    totalFeesUSD: number;
    totalSlippageUSD: number;
}

// ALGO METRICS - Diagnostic metrics for algo tuning
export interface AlgoMetrics {
    indicatorAnalysis: IndicatorAnalysis[];
    nearMissAnalysis: NearMissAnalysis[];
    stateDistribution: {
        pctTimeFlat: number;
        pctTimeLong: number;
        pctTimeShort: number;
        avgTimeFlatBars: number;
        avgTimeLongBars: number;
        avgTimeShortBars: number;
    };
    exitReasonBreakdown: {
        signal: number;
        stopLoss: number;
        takeProfit: number;
        trailingStop: number;
        endOfBacktest: number;
    };
    conditionTriggerCounts: Record<ConditionType, number>;
    eventCounts: {
        indicatorFlips: number;
        conditionChanges: number;
        stateTransitions: number;
        specialIndicatorEvents: number;
    };
}

// BACKTEST OUTPUT - Complete result with events and metrics
export interface BacktestOutput {
    config: {
        algoId: string;
        version: number;
        symbol: string;
        startTime: number;
        endTime: number;
        startingCapitalUSD: number;
        feeBps: number;
        slippageBps: number;
    };
    events: {
        swapEvents: SwapEvent[];
        algoEvents: AlgoEvent[];
    };
    trades: TradeEvent[];
    equityCurve: Array<{
        timestamp: number;
        equity: number;
        drawdownPct: number;
    }>;
    swapMetrics: SwapMetrics;
    algoMetrics: AlgoMetrics;
    completedAt: number;
    durationMs: number;
    totalBarsProcessed: number;
}
