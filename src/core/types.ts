// IMPORTS FROM INDICATORS LIBRARY
export type { Candle, ChartPoint } from "@indicators/common.ts";
import type { IndicatorConfig } from "@indicators/factory.ts";
export type { IndicatorConfig };

// POSITION STATES
export type PositionState = "CASH" | "LONG" | "SHORT" | "TIMEOUT";

// - POST_TRADE: Reason for getting into timeout. After exiting a trade (TP/SL/signal, AMBIGUITY: Both long and short signals were true simultaneously
export type TimeoutReason = "POST_TRADE" | "AMBIGUITY";

//COOLDOWN_ONLY: Exit after X bars, ignore signal states
//REGULAR: Exit when cooldown met AND same-direction signal is false (opposite direction can fire immediately)
//STRICT: Exit when cooldown met AND both signals are false
export type TimeoutMode = "COOLDOWN_ONLY" | "REGULAR" | "STRICT";

//Configuration for the TIMEOUT state behavior.
export interface TimeoutConfig {
    mode: TimeoutMode;
    cooldownBars: number;
}
export type Direction = "LONG" | "SHORT"; // Direction of a trade
export type AlgoType = "LONG" | "SHORT" | "BOTH"; //Algorithm type - what directions can it trade?
export type RunStatus = "NEW" | "RUNNING" | "DONE"; //Run status for tracking algo/backtest lifecycle -- Not required or used in Backteester but its kept for having some OCD consistency with the live trading system


//Order execution type - Note in algorunner its hard coded to market but this is just there for future use or adaptation
export type OrderType = "MARKET" | "TWAP" | "SMART" | "LIMIT";


//Parameters for ladder-based position sizing or entry/exit levels.Used to create multiple levels at different price offsets.
export interface LadderParams { //Map of <offset, weight> in percent //
    levels: Record<number, number>;
    direction: "UP" | "DOWN" | "CENTER"; //offset direction
    method: "CLAMP" | "SCALE"; //hether to remove levels beyond limit (CLAMP) or scale proportionally (SCALE)
    normalize: boolean; //Whether to require all weights to be normalized
}

// VALUE CONFIGURATION
// ABS means a fixed dollar amount (like "$100 stop loss"), REL means a percentage of something (like "2% of entry price" or "50% of capital"), 
//and DYN means a percentage that gets dynamically adjusted by an indicator's value (like "2% stop loss but scaled up/down based on current volatility").
export type ValueType = "ABS" | "REL" | "DYN";


export interface ValueConfig {
    type: ValueType;     // Applicable to both price levels and position sizes */
    value: number;     // USD price or amount if type=ABS, percent otherwise */
    valueFactor?: IndicatorConfig; // Single-use value-modulating indicator (if type=DYN) */
    inverted?: boolean;     // Scale up (position size) or down (stop loss) based on indicator's value */
    ladder?: LadderParams; //Persistent set of levels generated after value * valueFactor evaluation
}

//Conditions to ENTER a trade
export interface EntryCondition {
    required: IndicatorConfig[]; //all required conditions must be true
    optional: IndicatorConfig[]; //At least one optional indicator must be true for condition to be true
}

//Conditions to EXIT a trade.
export interface ExitCondition { //All required indicators must be true for condition to be true
    required: IndicatorConfig[]; // At least one optional indicator must be true for condition to be true //
    optional: IndicatorConfig[];
    stopLoss?: ValueConfig;
    takeProfit?: ValueConfig;
    trailingSL?: boolean; //avail when SL sets and makes it trailing
}

// =============================================================================
// ALGORITHM PARAMETERS
// =============================================================================

/**
 * Complete algorithm definition.
 * Defines entry/exit conditions for long and/or short trades.
 */
export interface AlgoParams {
    type: AlgoType;// What directions can this algo trade? //
    longEntry?: EntryCondition; //Entry conditions for long trades
    longExit?: ExitCondition; //Exit conditions for long trades
    shortEntry?: EntryCondition;// entry conditions for short
    shortExit?: ExitCondition; //exit conditions for shorts
    coinSymbol?: string; // which asset
    positionSize: ValueConfig; // money per trade
    orderType: OrderType; //Limit order, or market order etc
    startingCapitalUSD: number; //how mucch money to start with
    timeout: TimeoutConfig; // how should i config my timeout
}

// Wraps AlgoParams with identification and versioning.
export interface AlgoConfig {
    userID: string;
    algoID: string;
    algoName: string;
    version: number;
    params: AlgoParams;
}


/**
 * Configuration for a specific run (backtest or live trading).
 * Separates execution config from algorithm definition.
 */
export interface RunSettings {
    userID: string;
    /** A pair of algoID + version reference a unique read-only AlgoConfig */
    algoID: string;
    version: string;
    runID: string;
    /** Whether this is a live trading algo or a backtest simulation */
    isBacktest: boolean;
    /** Autofilled with AlgoParams.coinSymbol if set there (cannot be overridden) */
    coinSymbol: string;
    /** Scales AlgoParams.startingCapitalUSD (and positionSize if type=ABS). Defaults to 1 */
    capitalScaler: number;
    /** Unix timestamp (seconds) - required if isBacktest=true */
    startTime?: number;
    /** Unix timestamp (seconds) - required if isBacktest=true or closePositionOnExit=true */
    endTime?: number;
    /** Auto-stop after reaching certain number of trades */
    tradesLimit?: number;
    /** Force close when algo stops (RUNNING -> DONE transition) */
    closePositionOnExit: boolean;
    /** Unix timestamp (seconds) of when the run was submitted */
    launchTime: number;
    /** Algo/Backtesting services are responsible for progressing the status */
    status: RunStatus;
    /** Exchange identifier (Hyperliquid, KuCoin, etc.) */
    exchangeID: string;
}

// =============================================================================
// RE-EXPORT OUTPUT TYPES
// =============================================================================

export type { EquityPoint } from "../output/types.ts";
