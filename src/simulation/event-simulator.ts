/** Event-Driven Simulator - Unified loop with state machine. Processes events from heap with centralized switch for all states. */

import type { Candle, AlgoParams, Direction, ValueConfig } from "../core/types.ts";
import type { ConditionType, SwapEvent, TradeEvent, TransitionReason, StateTransitionEvent } from "../events/types.ts";
import {
    type SimState, type SimulationEvent,
    isSignalCrossingEvent, isConditionMetEvent, isConditionUnmetEvent,
    isSLTriggerEvent, isTPTriggerEvent, isTrailingTriggerEvent, isTimeoutExpiredEvent,
    createTimeoutExpiredEvent,
} from "../events/simulation-events.ts";
import { EventHeap } from "./event-heap.ts";
import { scanForSLTPTriggers } from "./sl-tp-scanner.ts";

export interface EventSimulatorConfig {
    algoParams: AlgoParams;                                                     // Algorithm parameters
    initialCapital: number;                                                     // Initial capital in USD
    symbol: string;                                                             // Asset symbol (e.g., "BTC")
    feeBps: number;                                                             // Trading fee in basis points
    slippageBps: number;                                                        // Slippage in basis points
    closePositionOnExit: boolean;                                               // Close position at end of simulation
    barDurationSeconds: number;                                                 // Bar duration in seconds (60 for 1m, 300 for 5m)
    tradesLimit?: number;                                                       // Maximum trades allowed (undefined = unlimited)
    subBarCandlesMap?: Map<number, Candle[]>;                                   // Sub-bar candles map for SL/TP scanning
    slValueFactorLookup?: (timestamp: number) => number | undefined;            // SL value factor lookup for DYN SL
    tpValueFactorLookup?: (timestamp: number) => number | undefined;            // TP value factor lookup for DYN TP
}

export interface EventSimulatorResult {
    swapEvents: SwapEvent[];                                                    // All swap events (entries and exits)
    trades: TradeEvent[];                                                       // Paired trades (entry + exit)
    equityCurve: EquityPoint[];                                                 // Equity curve points
    stateTransitions: StateTransitionEvent[];                                   // State transitions for debugging
    finalState: SimState;                                                       // Final state after simulation
    finalEquity: number;                                                        // Final equity
    stats: SimulatorStats;                                                      // Statistics about the simulation
}

export interface EquityPoint {
    timestamp: number;
    barIndex: number;
    equity: number;
    drawdownPct: number;
    position: SimState;
}

export interface SimulatorStats {
    eventsProcessed: number;
    deadEventsSkipped: number;
    entriesExecuted: number;
    exitsExecuted: number;
    slTriggered: number;
    tpTriggered: number;
    signalExits: number;
    timeoutsCompleted: number;
}

interface SimSnapshot {
    indicatorStates: Map<string, boolean>;                                      // Current indicator states (key → boolean)
    conditionMet: Map<ConditionType, boolean>;                                  // Current condition states
    currentPrice: number;                                                       // Current price (from last event)
    currentTimestamp: number;                                                   // Current timestamp
    currentBarIndex: number;                                                    // Current bar index
    equity: number;                                                             // Current equity
    peakEquity: number;                                                         // Peak equity (for drawdown calculation)
    currentDirection?: Direction;                                               // Direction of current POSITION (LONG or SHORT)
    entryPrice?: number;                                                        // Entry price of current position
    tradeId?: number;                                                           // Current trade ID
    positionSize?: number;                                                      // Position size in asset
    entryValue?: number;                                                        // Entry value in USD (amount invested at entry)
    pendingSlEventId?: string;                                                  // Pending SL event ID (for dead marking)
    pendingTpEventId?: string;                                                  // Pending TP event ID (for dead marking)
    timeoutDirection?: Direction;                                               // Direction we were in before TIMEOUT
    cooldownComplete?: boolean;                                                 // Whether minimum cooldown period has passed
    cooldownEndBar?: number;                                                    // Bar index when cooldown completes
}

/** Run event-driven simulation. Processes events from heap using unified loop with state machine. */
export function runEventDrivenSimulation(heap: EventHeap, candles: Candle[], config: EventSimulatorConfig): EventSimulatorResult {
    let state: SimState = "CASH";
    const snapshot = initializeSnapshot(config);
    const swapEvents: SwapEvent[] = [];
    const stateTransitions: StateTransitionEvent[] = [];
    const equityCurve: EquityPoint[] = [];
    const stats: SimulatorStats = { eventsProcessed: 0, deadEventsSkipped: 0, entriesExecuted: 0, exitsExecuted: 0, slTriggered: 0, tpTriggered: 0, signalExits: 0, timeoutsCompleted: 0 };

    const canGoLong = config.algoParams.type === "LONG" || config.algoParams.type === "BOTH";
    const canGoShort = config.algoParams.type === "SHORT" || config.algoParams.type === "BOTH";
    const hasCooldown = config.algoParams.timeout.cooldownBars > 0;
    let nextTradeId = 1, nextSwapId = 1;

    while (!heap.isEmpty) {
        const event = heap.pop();
        if (!event) break;
        stats.eventsProcessed++;
        updateSnapshot(snapshot, event, candles);

        switch (state) {
            case "CASH": {
                // Only enter on actual ConditionMetEvent, not just when condition flag is true
                if (canGoLong && isConditionMetEvent(event) && event.conditionType === "LONG_ENTRY") {
                    if (config.tradesLimit && stats.entriesExecuted >= config.tradesLimit) break;
                    const tradeId = nextTradeId++;
                    const entrySwap = executeEntry("LONG", snapshot, config, tradeId, nextSwapId++);
                    swapEvents.push(entrySwap);
                    stats.entriesExecuted++;
                    snapshot.entryPrice = entrySwap.price;
                    snapshot.tradeId = tradeId;
                    snapshot.positionSize = entrySwap.toAmount;
                    snapshot.entryValue = entrySwap.fromAmount;
                    const sltp = scheduleSLTPEvents(snapshot, "LONG", config, candles, heap, tradeId);
                    snapshot.pendingSlEventId = sltp.slEventId;
                    snapshot.pendingTpEventId = sltp.tpEventId;
                    snapshot.currentDirection = "LONG";
                    stateTransitions.push(createStateTransition("CASH", "POSITION", event, tradeId, "ENTRY_SIGNAL"));
                    state = "POSITION";
                } else if (canGoShort && isConditionMetEvent(event) && event.conditionType === "SHORT_ENTRY") {
                    if (config.tradesLimit && stats.entriesExecuted >= config.tradesLimit) break;
                    const tradeId = nextTradeId++;
                    const entrySwap = executeEntry("SHORT", snapshot, config, tradeId, nextSwapId++);
                    swapEvents.push(entrySwap);
                    stats.entriesExecuted++;
                    snapshot.entryPrice = entrySwap.price;
                    snapshot.tradeId = tradeId;
                    snapshot.positionSize = entrySwap.toAmount;
                    snapshot.entryValue = entrySwap.fromAmount;
                    const sltp = scheduleSLTPEvents(snapshot, "SHORT", config, candles, heap, tradeId);
                    snapshot.pendingSlEventId = sltp.slEventId;
                    snapshot.pendingTpEventId = sltp.tpEventId;
                    snapshot.currentDirection = "SHORT";
                    stateTransitions.push(createStateTransition("CASH", "POSITION", event, tradeId, "ENTRY_SIGNAL"));
                    state = "POSITION";
                }
                break;
            }

            case "POSITION": {
                const direction = snapshot.currentDirection!;
                const exitConditionType: ConditionType = direction === "LONG" ? "LONG_EXIT" : "SHORT_EXIT";

                if (isSLTriggerEvent(event) || isTrailingTriggerEvent(event)) {
                    const exitSwap = executeExit(direction, snapshot, config, event, nextSwapId++, isSLTriggerEvent(event) ? "STOP_LOSS" : "TRAILING_STOP");
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.slTriggered++;
                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));
                    if (snapshot.pendingTpEventId) heap.markDead(snapshot.pendingTpEventId);
                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(createStateTransition("POSITION", nextState, event, snapshot.tradeId!, "STOP_LOSS"));
                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, direction, config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }
                    clearPositionState(snapshot);
                    state = nextState;
                } else if (isTPTriggerEvent(event)) {
                    const exitSwap = executeExit(direction, snapshot, config, event, nextSwapId++, "TAKE_PROFIT");
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.tpTriggered++;
                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));
                    if (snapshot.pendingSlEventId) heap.markDead(snapshot.pendingSlEventId);
                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(createStateTransition("POSITION", nextState, event, snapshot.tradeId!, "TAKE_PROFIT"));
                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, direction, config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }
                    clearPositionState(snapshot);
                    state = nextState;
                } else if (isConditionMetEvent(event) && event.conditionType === exitConditionType) {
                    const exitSwap = executeExit(direction, snapshot, config, event, nextSwapId++, "EXIT_SIGNAL");
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.signalExits++;
                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));
                    if (snapshot.pendingSlEventId) heap.markDead(snapshot.pendingSlEventId);
                    if (snapshot.pendingTpEventId) heap.markDead(snapshot.pendingTpEventId);
                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(createStateTransition("POSITION", nextState, event, snapshot.tradeId!, "EXIT_SIGNAL"));
                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, direction, config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }
                    clearPositionState(snapshot);
                    state = nextState;
                }
                break;
            }

            case "TIMEOUT": {
                const timeoutMode = config.algoParams.timeout.mode;
                if (isTimeoutExpiredEvent(event)) snapshot.cooldownComplete = true;
                if (snapshot.cooldownEndBar !== undefined && snapshot.currentBarIndex >= snapshot.cooldownEndBar) snapshot.cooldownComplete = true;

                if (timeoutMode === "COOLDOWN_ONLY") {
                    if (snapshot.cooldownComplete) {
                        const previousDirection = snapshot.timeoutDirection;
                        const sameDirectionEntry = previousDirection === "LONG" ? "LONG_ENTRY" : "SHORT_ENTRY";
                        const canEnterSameDirection = previousDirection === "LONG" ? canGoLong : canGoShort;
                        if (canEnterSameDirection && isConditionMetEvent(event) && event.conditionType === sameDirectionEntry) {
                            if (!config.tradesLimit || stats.entriesExecuted < config.tradesLimit) {
                                const direction: Direction = previousDirection ?? "LONG";
                                const tradeId = nextTradeId++;
                                const entrySwap = executeEntry(direction, snapshot, config, tradeId, nextSwapId++);
                                swapEvents.push(entrySwap);
                                stats.entriesExecuted++;
                                stats.timeoutsCompleted++;
                                snapshot.entryPrice = entrySwap.price;
                                snapshot.tradeId = tradeId;
                                snapshot.positionSize = entrySwap.toAmount;
                                snapshot.entryValue = entrySwap.fromAmount;
                                const sltp = scheduleSLTPEvents(snapshot, direction, config, candles, heap, tradeId);
                                snapshot.pendingSlEventId = sltp.slEventId;
                                snapshot.pendingTpEventId = sltp.tpEventId;
                                snapshot.currentDirection = direction;
                                stateTransitions.push(createStateTransition("TIMEOUT", "POSITION", event, tradeId, "ENTRY_SIGNAL"));
                                clearTimeoutState(snapshot);
                                state = "POSITION";
                            }
                        } else {
                            stats.timeoutsCompleted++;
                            stateTransitions.push(createStateTransition("TIMEOUT", "CASH", event, undefined, "EXIT_SIGNAL"));
                            clearTimeoutState(snapshot);
                            state = "CASH";
                        }
                    }
                } else if (timeoutMode === "REGULAR") {
                    if (snapshot.cooldownComplete) {
                        const sameDirectionEntry = snapshot.timeoutDirection === "LONG" ? "LONG_ENTRY" : "SHORT_ENTRY";
                        const oppositeDirectionEntry = snapshot.timeoutDirection === "LONG" ? "SHORT_ENTRY" : "LONG_ENTRY";
                        const canEnterOpposite = snapshot.timeoutDirection === "LONG" ? canGoShort : canGoLong;
                        if (canEnterOpposite && isConditionMetEvent(event) && event.conditionType === oppositeDirectionEntry) {
                            if (!config.tradesLimit || stats.entriesExecuted < config.tradesLimit) {
                                const direction: Direction = snapshot.timeoutDirection === "LONG" ? "SHORT" : "LONG";
                                const tradeId = nextTradeId++;
                                const entrySwap = executeEntry(direction, snapshot, config, tradeId, nextSwapId++);
                                swapEvents.push(entrySwap);
                                stats.entriesExecuted++;
                                stats.timeoutsCompleted++;
                                snapshot.entryPrice = entrySwap.price;
                                snapshot.tradeId = tradeId;
                                snapshot.positionSize = entrySwap.toAmount;
                                snapshot.entryValue = entrySwap.fromAmount;
                                const sltp = scheduleSLTPEvents(snapshot, direction, config, candles, heap, tradeId);
                                snapshot.pendingSlEventId = sltp.slEventId;
                                snapshot.pendingTpEventId = sltp.tpEventId;
                                snapshot.currentDirection = direction;
                                stateTransitions.push(createStateTransition("TIMEOUT", "POSITION", event, tradeId, "ENTRY_SIGNAL"));
                                clearTimeoutState(snapshot);
                                state = "POSITION";
                            }
                        } else if (!snapshot.conditionMet.get(sameDirectionEntry)) {
                            stats.timeoutsCompleted++;
                            stateTransitions.push(createStateTransition("TIMEOUT", "CASH", event, undefined, "EXIT_SIGNAL"));
                            clearTimeoutState(snapshot);
                            state = "CASH";
                        }
                    }
                } else if (timeoutMode === "STRICT") {
                    if (snapshot.cooldownComplete) {
                        const longEntryFalse = !snapshot.conditionMet.get("LONG_ENTRY");
                        const shortEntryFalse = !snapshot.conditionMet.get("SHORT_ENTRY");
                        if (longEntryFalse && shortEntryFalse) {
                            stats.timeoutsCompleted++;
                            stateTransitions.push(createStateTransition("TIMEOUT", "CASH", event, undefined, "EXIT_SIGNAL"));
                            clearTimeoutState(snapshot);
                            state = "CASH";
                        }
                    }
                }
                break;
            }
        }
    }

    if (config.closePositionOnExit && state === "POSITION") {
        const lastCandle = candles[candles.length - 1];
        const lastBarIndex = candles.length - 1;
        if (lastCandle) {
            const exitSwap = executeEndOfBacktestExit(snapshot.currentDirection!, snapshot, config, lastCandle, lastBarIndex, nextSwapId++);
            swapEvents.push(exitSwap);
            stats.exitsExecuted++;
            updateEquityAfterExit(snapshot, exitSwap);
            equityCurve.push(createEquityPoint(snapshot, "CASH"));
            stateTransitions.push(createStateTransition("POSITION", "CASH", null, snapshot.tradeId!, "END_OF_BACKTEST"));
            state = "CASH";
        }
    }

    return { swapEvents, trades: pairSwapsIntoTrades(swapEvents), equityCurve, stateTransitions, finalState: state, finalEquity: snapshot.equity, stats };
}

function initializeSnapshot(config: EventSimulatorConfig): SimSnapshot {
    return {
        indicatorStates: new Map(),
        conditionMet: new Map([["LONG_ENTRY", false], ["LONG_EXIT", false], ["SHORT_ENTRY", false], ["SHORT_EXIT", false]]),
        currentPrice: 0, currentTimestamp: 0, currentBarIndex: 0,
        equity: config.initialCapital, peakEquity: config.initialCapital,
    };
}

function updateSnapshot(snapshot: SimSnapshot, event: SimulationEvent, candles: Candle[]): void {
    snapshot.currentTimestamp = event.timestamp;
    snapshot.currentBarIndex = event.barIndex;
    const candle = candles[event.barIndex];
    if (candle) snapshot.currentPrice = candle.close;

    if (isSignalCrossingEvent(event)) snapshot.indicatorStates.set(event.indicatorKey, event.newValue);
    else if (isConditionMetEvent(event)) snapshot.conditionMet.set(event.conditionType, true);
    else if (isConditionUnmetEvent(event)) snapshot.conditionMet.set(event.conditionType, false);

    if (isSLTriggerEvent(event) || isTPTriggerEvent(event) || isTrailingTriggerEvent(event)) snapshot.currentPrice = event.triggerPrice;
}

function executeEntry(direction: Direction, snapshot: SimSnapshot, config: EventSimulatorConfig, _tradeId: number, swapId: number): SwapEvent {
    const price = snapshot.currentPrice;
    const positionValue = calculatePositionValue(snapshot.equity, config.algoParams.positionSize);
    const feeUSD = (positionValue * config.feeBps) / 10000;
    const slippageUSD = (positionValue * config.slippageBps) / 10000;
    const effectiveValue = positionValue - feeUSD - slippageUSD;
    const assetAmount = effectiveValue / price;
    return {
        id: `swap_${swapId}`, timestamp: snapshot.currentTimestamp, barIndex: snapshot.currentBarIndex,
        fromAsset: "USD", toAsset: config.symbol, fromAmount: positionValue, toAmount: assetAmount,
        price, feeUSD, slippageUSD, isEntry: true, tradeDirection: direction,
    };
}

function executeExit(direction: Direction, snapshot: SimSnapshot, config: EventSimulatorConfig, _event: SimulationEvent, swapId: number, _reason: string): SwapEvent {
    const price = snapshot.currentPrice;
    const assetAmount = snapshot.positionSize ?? 0;
    const grossValue = assetAmount * price;
    const feeUSD = (grossValue * config.feeBps) / 10000;
    const slippageUSD = (grossValue * config.slippageBps) / 10000;
    const netValue = grossValue - feeUSD - slippageUSD;
    return {
        id: `swap_${swapId}`, timestamp: snapshot.currentTimestamp, barIndex: snapshot.currentBarIndex,
        fromAsset: config.symbol, toAsset: "USD", fromAmount: assetAmount, toAmount: netValue,
        price, feeUSD, slippageUSD, isEntry: false, tradeDirection: direction,
    };
}

function executeEndOfBacktestExit(direction: Direction, snapshot: SimSnapshot, config: EventSimulatorConfig, lastCandle: Candle, lastBarIndex: number, swapId: number): SwapEvent {
    const price = lastCandle.close;
    const assetAmount = snapshot.positionSize ?? 0;
    const grossValue = assetAmount * price;
    const feeUSD = (grossValue * config.feeBps) / 10000;
    const slippageUSD = (grossValue * config.slippageBps) / 10000;
    const netValue = grossValue - feeUSD - slippageUSD;
    return {
        id: `swap_${swapId}`, timestamp: lastCandle.bucket, barIndex: lastBarIndex,
        fromAsset: config.symbol, toAsset: "USD", fromAmount: assetAmount, toAmount: netValue,
        price, feeUSD, slippageUSD, isEntry: false, tradeDirection: direction,
    };
}

function calculatePositionValue(equity: number, sizeConfig: ValueConfig): number {
    return sizeConfig.type === "ABS" ? Math.min(sizeConfig.value, equity) : equity * sizeConfig.value;
}

/** Update equity after exit. Equity = (previous equity - entry value) + exit value. */
function updateEquityAfterExit(snapshot: SimSnapshot, exitSwap: SwapEvent): void {
    const uninvestedCash = snapshot.equity - (snapshot.entryValue ?? 0);
    snapshot.equity = uninvestedCash + exitSwap.toAmount;
    if (snapshot.equity > snapshot.peakEquity) snapshot.peakEquity = snapshot.equity;
}

function clearPositionState(snapshot: SimSnapshot): void {
    snapshot.currentDirection = undefined;
    snapshot.entryPrice = undefined;
    snapshot.tradeId = undefined;
    snapshot.positionSize = undefined;
    snapshot.entryValue = undefined;
    snapshot.pendingSlEventId = undefined;
    snapshot.pendingTpEventId = undefined;
}

function clearTimeoutState(snapshot: SimSnapshot): void {
    snapshot.timeoutDirection = undefined;
    snapshot.cooldownComplete = undefined;
    snapshot.cooldownEndBar = undefined;
}

function setTimeoutState(snapshot: SimSnapshot, direction: Direction, cooldownBars: number): void {
    snapshot.timeoutDirection = direction;
    snapshot.cooldownComplete = false;
    snapshot.cooldownEndBar = snapshot.currentBarIndex + cooldownBars;
}

function createEquityPoint(snapshot: SimSnapshot, position: SimState): EquityPoint {
    const drawdownPct = snapshot.peakEquity > 0 ? ((snapshot.peakEquity - snapshot.equity) / snapshot.peakEquity) * 100 : 0;
    return { timestamp: snapshot.currentTimestamp, barIndex: snapshot.currentBarIndex, equity: snapshot.equity, drawdownPct, position };
}

function createStateTransition(fromState: SimState, toState: SimState, event: SimulationEvent | null, tradeId: number | undefined, reason: TransitionReason): StateTransitionEvent {
    return { type: "STATE_TRANSITION", timestamp: event?.timestamp ?? 0, barIndex: event?.barIndex ?? 0, fromState, toState, reason, tradeId };
}

function scheduleSLTPEvents(snapshot: SimSnapshot, direction: Direction, config: EventSimulatorConfig, candles: Candle[], heap: EventHeap, tradeId: number): { slEventId?: string; tpEventId?: string } {
    const exitCondition = direction === "LONG" ? config.algoParams.longExit : config.algoParams.shortExit;
    if (!exitCondition) return {};

    const result = scanForSLTPTriggers({
        entryBarIndex: snapshot.currentBarIndex, entryPrice: snapshot.entryPrice!, direction,
        slConfig: exitCondition.stopLoss, tpConfig: exitCondition.takeProfit,
        trailingEnabled: exitCondition.trailingSL, tradeId, candles,
        subBarCandlesMap: config.subBarCandlesMap,
        slValueFactorLookup: config.slValueFactorLookup, tpValueFactorLookup: config.tpValueFactorLookup,
    });

    let slEventId: string | undefined, tpEventId: string | undefined;
    if (result.slEvent) { slEventId = result.slEvent.id; heap.push(result.slEvent); }
    if (result.trailingEvent) { slEventId = result.trailingEvent.id; heap.push(result.trailingEvent); }
    if (result.tpEvent) { tpEventId = result.tpEvent.id; heap.push(result.tpEvent); }
    return { slEventId, tpEventId };
}

function scheduleTimeoutEvent(snapshot: SimSnapshot, config: EventSimulatorConfig, heap: EventHeap): void {
    const cooldownBars = config.algoParams.timeout.cooldownBars;
    const timeoutBarIndex = snapshot.currentBarIndex + cooldownBars;
    const timeoutTimestamp = snapshot.currentTimestamp + cooldownBars * config.barDurationSeconds;
    heap.push(createTimeoutExpiredEvent({ timestamp: timeoutTimestamp, barIndex: timeoutBarIndex, tradeId: snapshot.tradeId ?? 0, timeoutStartBar: snapshot.currentBarIndex, cooldownBars }));
}

function pairSwapsIntoTrades(swapEvents: SwapEvent[]): TradeEvent[] {
    const trades: TradeEvent[] = [];
    const pendingEntries: SwapEvent[] = [];
    for (const swap of swapEvents) {
        if (swap.isEntry) pendingEntries.push(swap);
        else {
            const entrySwap = pendingEntries.shift();
            if (entrySwap) {
                const pnlUSD = swap.toAmount - entrySwap.fromAmount;
                const pnlPct = (pnlUSD / entrySwap.fromAmount) * 100;
                trades.push({
                    tradeId: trades.length + 1, direction: entrySwap.tradeDirection!,
                    entrySwap, exitSwap: swap, pnlUSD, pnlPct,
                    durationBars: swap.barIndex - entrySwap.barIndex, durationSeconds: swap.timestamp - entrySwap.timestamp,
                });
            }
        }
    }
    return trades;
}
