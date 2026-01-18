/**
 * Event-Driven Simulator - Unified Loop with State Machine
 *
 * @module simulation/event-simulator
 * @description
 * The core event-driven simulation engine. Processes events from a priority
 * heap using a unified loop with a centralized switch statement for all states.
 *
 * @architecture
 * Key principles (from Yurii's feedback):
 * 1. Simulation loop and state machine are ONE unified thing
 * 2. All states visible in one switch statement
 * 3. Synchronous execution - no async/await
 * 4. Snapshot updated BEFORE switch statement
 * 5. Equity curve built inline during loop
 *
 * State Machine:
 * ```
 * CASH → LONG/SHORT (on entry signal)
 * LONG/SHORT → TIMEOUT or CASH (on exit: SL/TP/signal)
 * TIMEOUT → CASH (on timeout expiry)
 * ```
 *
 * @performance
 * Expected: ~1,000 events vs ~400,000 bar iterations
 * ~400x fewer iterations for typical backtests
 *
 * @audit-trail
 * - Created: 2026-01-09 (Event-Driven Simulation Implementation)
 * - Purpose: Replace bar-by-bar iteration with heap-based event processing
 */

import type { Candle, AlgoParams, Direction, ValueConfig, AlgoType } from "../core/types.ts";
import type { ConditionType, SwapEvent, TradeEvent, TransitionReason } from "../events/types.ts";
import type { StateTransitionEvent } from "../events/types.ts";
import {
    type SimState,
    type SimulationEvent,
    type AnySimulationEvent,
    type SignalCrossingEvent,
    type ConditionMetEvent,
    type ConditionUnmetEvent,
    type SLTriggerEvent,
    type TPTriggerEvent,
    type TrailingTriggerEvent,
    type TimeoutExpiredEvent,
    isSignalCrossingEvent,
    isConditionMetEvent,
    isConditionUnmetEvent,
    isSLTriggerEvent,
    isTPTriggerEvent,
    isTrailingTriggerEvent,
    isTimeoutExpiredEvent,
    createTimeoutExpiredEvent,
    generateEventId,
} from "../events/simulation-events.ts";
import { EventHeap } from "./event-heap.ts";
import { scanForSLTPTriggers } from "./sl-tp-scanner.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for the event-driven simulator.
 */
export interface EventSimulatorConfig {
    /** Algorithm parameters */
    algoParams: AlgoParams;

    /** Initial capital in USD */
    initialCapital: number;

    /** Asset symbol (e.g., "BTC") */
    symbol: string;

    /** Trading fee in basis points */
    feeBps: number;

    /** Slippage in basis points */
    slippageBps: number;

    /** Whether to close position at end of simulation */
    closePositionOnExit: boolean;

    /** Bar duration in seconds (e.g., 60 for 1m bars, 300 for 5m bars) */
    barDurationSeconds: number;

    /** Maximum trades allowed (undefined = unlimited) */
    tradesLimit?: number;

    /** Sub-bar candles map for SL/TP scanning */
    subBarCandlesMap?: Map<number, Candle[]>;

    /** SL value factor lookup for DYN SL */
    slValueFactorLookup?: (timestamp: number) => number | undefined;

    /** TP value factor lookup for DYN TP */
    tpValueFactorLookup?: (timestamp: number) => number | undefined;
}

/**
 * Result of event-driven simulation.
 */
export interface EventSimulatorResult {
    /** All swap events (entries and exits) */
    swapEvents: SwapEvent[];

    /** Paired trades (entry + exit) */
    trades: TradeEvent[];

    /** Equity curve points */
    equityCurve: EquityPoint[];

    /** State transitions for debugging */
    stateTransitions: StateTransitionEvent[];

    /** Final state after simulation */
    finalState: SimState;

    /** Final equity */
    finalEquity: number;

    /** Statistics about the simulation */
    stats: SimulatorStats;
}

/**
 * Equity curve point.
 */
export interface EquityPoint {
    timestamp: number;
    barIndex: number;
    equity: number;
    drawdownPct: number;
    position: SimState;
}

/**
 * Statistics about the simulation.
 */
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

/**
 * Internal snapshot of simulation state.
 */
interface SimSnapshot {
    /** Current indicator states (key → boolean) */
    indicatorStates: Map<string, boolean>;

    /** Current condition states (condition type → met) */
    conditionMet: Map<ConditionType, boolean>;

    /** Current price (from last event) */
    currentPrice: number;

    /** Current timestamp */
    currentTimestamp: number;

    /** Current bar index */
    currentBarIndex: number;

    /** Current equity */
    equity: number;

    /** Peak equity (for drawdown calculation) */
    peakEquity: number;

    /** Entry price of current position */
    entryPrice?: number;

    /** Current trade ID */
    tradeId?: number;

    /** Position size in asset */
    positionSize?: number;

    /** Entry value in USD (amount invested at entry) */
    entryValue?: number;

    /** Pending SL event ID (for dead marking) */
    pendingSlEventId?: string;

    /** Pending TP event ID (for dead marking) */
    pendingTpEventId?: string;

    /** Direction we were in before entering TIMEOUT (for REGULAR mode) */
    timeoutDirection?: Direction;

    /** Whether the minimum cooldown period has passed */
    cooldownComplete?: boolean;

    /** Bar index when cooldown completes */
    cooldownEndBar?: number;
}

// =============================================================================
// MAIN SIMULATOR FUNCTION
// =============================================================================

/**
 * Run event-driven simulation.
 *
 * This is the core simulation function. It processes events from the heap
 * using a unified loop with a centralized switch statement for all states.
 *
 * @param heap - Priority heap of simulation events
 * @param candles - Candle data for price lookup
 * @param config - Simulation configuration
 * @returns EventSimulatorResult with all outputs
 *
 * @example
 * ```typescript
 * const heap = mergeIntoHeap(
 *     extractionResult.signalCrossingEvents,
 *     extractionResult.conditionMetEvents,
 *     extractionResult.conditionUnmetEvents
 * );
 *
 * const result = runEventDrivenSimulation(heap, candles, {
 *     algoParams,
 *     initialCapital: 10000,
 *     symbol: "BTC",
 *     feeBps: 10,
 *     slippageBps: 5,
 *     closePositionOnExit: true,
 * });
 *
 * console.log(`Trades: ${result.trades.length}`);
 * console.log(`Final equity: $${result.finalEquity}`);
 * ```
 */
export function runEventDrivenSimulation(
    heap: EventHeap,
    candles: Candle[],
    config: EventSimulatorConfig
): EventSimulatorResult {
    // Initialize state
    let state: SimState = "CASH";
    const snapshot = initializeSnapshot(config);
    const swapEvents: SwapEvent[] = [];
    const stateTransitions: StateTransitionEvent[] = [];
    const equityCurve: EquityPoint[] = [];

    // Statistics
    const stats: SimulatorStats = {
        eventsProcessed: 0,
        deadEventsSkipped: 0,
        entriesExecuted: 0,
        exitsExecuted: 0,
        slTriggered: 0,
        tpTriggered: 0,
        signalExits: 0,
        timeoutsCompleted: 0,
    };

    // Derived config
    const canGoLong = config.algoParams.type === "LONG" || config.algoParams.type === "BOTH";
    const canGoShort = config.algoParams.type === "SHORT" || config.algoParams.type === "BOTH";
    const hasCooldown = config.algoParams.timeout.cooldownBars > 0;

    // Trade counter
    let nextTradeId = 1;
    let nextSwapId = 1;

    // === THE UNIFIED LOOP ===
    while (!heap.isEmpty) {
        const event = heap.pop();
        if (!event) break;

        stats.eventsProcessed++;

        // Step 1: Update snapshot with event data
        updateSnapshot(snapshot, event, candles);

        // Step 2: State machine - ALL states visible here
        switch (state) {
            case "CASH": {
                // === CASH STATE: Look for entry signals ===
                // IMPORTANT: Only enter on the ConditionMetEvent itself, not just when
                // the condition flag is true. This prevents spurious re-entries when
                // the LONG_ENTRY condition was set while in LONG position and remains
                // true after exiting back to CASH.

                // Check for LONG entry - must be triggered by actual ConditionMetEvent
                if (canGoLong && isConditionMetEvent(event) && event.conditionType === "LONG_ENTRY") {
                    // Check trade limit
                    if (config.tradesLimit && stats.entriesExecuted >= config.tradesLimit) {
                        break;
                    }

                    // Execute entry
                    const tradeId = nextTradeId++;
                    const entrySwap = executeEntry(
                        "LONG",
                        snapshot,
                        config,
                        tradeId,
                        nextSwapId++
                    );
                    swapEvents.push(entrySwap);
                    stats.entriesExecuted++;

                    // Update snapshot
                    snapshot.entryPrice = entrySwap.price;
                    snapshot.tradeId = tradeId;
                    snapshot.positionSize = entrySwap.toAmount;
                    snapshot.entryValue = entrySwap.fromAmount;

                    // Schedule SL/TP events
                    const sltp = scheduleSLTPEvents(
                        snapshot,
                        "LONG",
                        config,
                        candles,
                        heap,
                        tradeId
                    );
                    snapshot.pendingSlEventId = sltp.slEventId;
                    snapshot.pendingTpEventId = sltp.tpEventId;

                    // Record state transition
                    stateTransitions.push(
                        createStateTransition("CASH", "LONG", event, tradeId, "ENTRY_SIGNAL")
                    );

                    state = "LONG";
                }
                // Check for SHORT entry - must be triggered by actual ConditionMetEvent
                else if (canGoShort && isConditionMetEvent(event) && event.conditionType === "SHORT_ENTRY") {
                    if (config.tradesLimit && stats.entriesExecuted >= config.tradesLimit) {
                        break;
                    }

                    const tradeId = nextTradeId++;
                    const entrySwap = executeEntry(
                        "SHORT",
                        snapshot,
                        config,
                        tradeId,
                        nextSwapId++
                    );
                    swapEvents.push(entrySwap);
                    stats.entriesExecuted++;

                    snapshot.entryPrice = entrySwap.price;
                    snapshot.tradeId = tradeId;
                    snapshot.positionSize = entrySwap.toAmount;
                    snapshot.entryValue = entrySwap.fromAmount;

                    const sltp = scheduleSLTPEvents(
                        snapshot,
                        "SHORT",
                        config,
                        candles,
                        heap,
                        tradeId
                    );
                    snapshot.pendingSlEventId = sltp.slEventId;
                    snapshot.pendingTpEventId = sltp.tpEventId;

                    stateTransitions.push(
                        createStateTransition("CASH", "SHORT", event, tradeId, "ENTRY_SIGNAL")
                    );

                    state = "SHORT";
                }
                break;
            }

            case "LONG": {
                // === LONG STATE: Check exit conditions ===

                // Priority 1: SL/TP triggers (highest priority)
                if (isSLTriggerEvent(event) || isTrailingTriggerEvent(event)) {
                    const exitSwap = executeExit(
                        "LONG",
                        snapshot,
                        config,
                        event,
                        nextSwapId++,
                        isSLTriggerEvent(event) ? "STOP_LOSS" : "TRAILING_STOP"
                    );
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.slTriggered++;

                    // Update equity
                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));

                    // Mark pending TP as dead
                    if (snapshot.pendingTpEventId) {
                        heap.markDead(snapshot.pendingTpEventId);
                    }

                    // Transition to TIMEOUT or CASH
                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(
                        createStateTransition("LONG", nextState, event, snapshot.tradeId!, "STOP_LOSS")
                    );

                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, "LONG", config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }

                    clearPositionState(snapshot);
                    state = nextState;
                }
                else if (isTPTriggerEvent(event)) {
                    const exitSwap = executeExit(
                        "LONG",
                        snapshot,
                        config,
                        event,
                        nextSwapId++,
                        "TAKE_PROFIT"
                    );
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.tpTriggered++;

                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));

                    if (snapshot.pendingSlEventId) {
                        heap.markDead(snapshot.pendingSlEventId);
                    }

                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(
                        createStateTransition("LONG", nextState, event, snapshot.tradeId!, "TAKE_PROFIT")
                    );

                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, "LONG", config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }

                    clearPositionState(snapshot);
                    state = nextState;
                }
                // Priority 2: Signal-based exit - must be triggered by actual ConditionMetEvent
                else if (isConditionMetEvent(event) && event.conditionType === "LONG_EXIT") {
                    const exitSwap = executeExit(
                        "LONG",
                        snapshot,
                        config,
                        event,
                        nextSwapId++,
                        "EXIT_SIGNAL"
                    );
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.signalExits++;

                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));

                    // Mark both SL and TP as dead
                    if (snapshot.pendingSlEventId) heap.markDead(snapshot.pendingSlEventId);
                    if (snapshot.pendingTpEventId) heap.markDead(snapshot.pendingTpEventId);

                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(
                        createStateTransition("LONG", nextState, event, snapshot.tradeId!, "EXIT_SIGNAL")
                    );

                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, "LONG", config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }

                    clearPositionState(snapshot);
                    state = nextState;
                }
                break;
            }

            case "SHORT": {
                // === SHORT STATE: Check exit conditions ===

                if (isSLTriggerEvent(event) || isTrailingTriggerEvent(event)) {
                    const exitSwap = executeExit(
                        "SHORT",
                        snapshot,
                        config,
                        event,
                        nextSwapId++,
                        isSLTriggerEvent(event) ? "STOP_LOSS" : "TRAILING_STOP"
                    );
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.slTriggered++;

                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));

                    if (snapshot.pendingTpEventId) heap.markDead(snapshot.pendingTpEventId);

                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(
                        createStateTransition("SHORT", nextState, event, snapshot.tradeId!, "STOP_LOSS")
                    );

                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, "SHORT", config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }

                    clearPositionState(snapshot);
                    state = nextState;
                }
                else if (isTPTriggerEvent(event)) {
                    const exitSwap = executeExit(
                        "SHORT",
                        snapshot,
                        config,
                        event,
                        nextSwapId++,
                        "TAKE_PROFIT"
                    );
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.tpTriggered++;

                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));

                    if (snapshot.pendingSlEventId) heap.markDead(snapshot.pendingSlEventId);

                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(
                        createStateTransition("SHORT", nextState, event, snapshot.tradeId!, "TAKE_PROFIT")
                    );

                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, "SHORT", config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }

                    clearPositionState(snapshot);
                    state = nextState;
                }
                else if (isConditionMetEvent(event) && event.conditionType === "SHORT_EXIT") {
                    const exitSwap = executeExit(
                        "SHORT",
                        snapshot,
                        config,
                        event,
                        nextSwapId++,
                        "EXIT_SIGNAL"
                    );
                    swapEvents.push(exitSwap);
                    stats.exitsExecuted++;
                    stats.signalExits++;

                    updateEquityAfterExit(snapshot, exitSwap);
                    equityCurve.push(createEquityPoint(snapshot, "CASH"));

                    if (snapshot.pendingSlEventId) heap.markDead(snapshot.pendingSlEventId);
                    if (snapshot.pendingTpEventId) heap.markDead(snapshot.pendingTpEventId);

                    const nextState = hasCooldown ? "TIMEOUT" : "CASH";
                    stateTransitions.push(
                        createStateTransition("SHORT", nextState, event, snapshot.tradeId!, "EXIT_SIGNAL")
                    );

                    if (nextState === "TIMEOUT") {
                        setTimeoutState(snapshot, "SHORT", config.algoParams.timeout.cooldownBars);
                        scheduleTimeoutEvent(snapshot, config, heap);
                    }

                    clearPositionState(snapshot);
                    state = nextState;
                }
                break;
            }

            case "TIMEOUT": {
                // === TIMEOUT STATE: Handle based on timeout mode ===
                // COOLDOWN_ONLY: Exit after X bars, ignore signal states
                // REGULAR: Exit when cooldown met AND same-direction signal is false
                //          (opposite direction can fire immediately after cooldown)
                // STRICT: Exit when cooldown met AND both signals are false

                const timeoutMode = config.algoParams.timeout.mode;

                // Check if cooldown period has completed
                if (isTimeoutExpiredEvent(event)) {
                    snapshot.cooldownComplete = true;
                }

                // Also check cooldown based on bar index (for events that arrive after cooldown)
                if (snapshot.cooldownEndBar !== undefined && snapshot.currentBarIndex >= snapshot.cooldownEndBar) {
                    snapshot.cooldownComplete = true;
                }

                // Handle based on timeout mode
                if (timeoutMode === "COOLDOWN_ONLY") {
                    // COOLDOWN_ONLY: Exit immediately when cooldown completes
                    // Also check for same-bar entry (matches Python behavior)
                    if (snapshot.cooldownComplete) {
                        // Check if the current event is an entry signal - enter immediately
                        const previousDirection = snapshot.timeoutDirection;
                        const sameDirectionEntry = previousDirection === "LONG" ? "LONG_ENTRY" : "SHORT_ENTRY";
                        const canEnterSameDirection = previousDirection === "LONG" ? canGoLong : canGoShort;

                        if (canEnterSameDirection && isConditionMetEvent(event) && event.conditionType === sameDirectionEntry) {
                            // Check trade limit
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

                                stateTransitions.push(
                                    createStateTransition("TIMEOUT", direction, event, tradeId, "ENTRY_SIGNAL")
                                );

                                clearTimeoutState(snapshot);
                                state = direction;
                            }
                        } else {
                            // No entry signal - just transition to CASH
                            stats.timeoutsCompleted++;
                            stateTransitions.push(
                                createStateTransition("TIMEOUT", "CASH", event, undefined, "EXIT_SIGNAL")
                            );
                            clearTimeoutState(snapshot);
                            state = "CASH";
                        }
                    }
                } else if (timeoutMode === "REGULAR") {
                    // REGULAR: After cooldown, can exit to CASH if same-direction entry is false
                    // OR can enter opposite direction immediately
                    if (snapshot.cooldownComplete) {
                        const sameDirectionEntry = snapshot.timeoutDirection === "LONG" ? "LONG_ENTRY" : "SHORT_ENTRY";
                        const oppositeDirectionEntry = snapshot.timeoutDirection === "LONG" ? "SHORT_ENTRY" : "LONG_ENTRY";
                        const canEnterOpposite = snapshot.timeoutDirection === "LONG" ? canGoShort : canGoLong;

                        // Check if opposite direction entry signal fires - can enter immediately
                        if (canEnterOpposite && isConditionMetEvent(event) && event.conditionType === oppositeDirectionEntry) {
                            // Check trade limit
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

                                stateTransitions.push(
                                    createStateTransition("TIMEOUT", direction, event, tradeId, "ENTRY_SIGNAL")
                                );

                                clearTimeoutState(snapshot);
                                state = direction;
                            }
                        }
                        // Check if same-direction entry is false - can exit to CASH
                        else if (!snapshot.conditionMet.get(sameDirectionEntry)) {
                            stats.timeoutsCompleted++;
                            stateTransitions.push(
                                createStateTransition("TIMEOUT", "CASH", event, undefined, "EXIT_SIGNAL")
                            );
                            clearTimeoutState(snapshot);
                            state = "CASH";
                        }
                    }
                } else if (timeoutMode === "STRICT") {
                    // STRICT: Exit only when cooldown met AND both entry signals are false
                    if (snapshot.cooldownComplete) {
                        const longEntryFalse = !snapshot.conditionMet.get("LONG_ENTRY");
                        const shortEntryFalse = !snapshot.conditionMet.get("SHORT_ENTRY");

                        if (longEntryFalse && shortEntryFalse) {
                            stats.timeoutsCompleted++;
                            stateTransitions.push(
                                createStateTransition("TIMEOUT", "CASH", event, undefined, "EXIT_SIGNAL")
                            );
                            clearTimeoutState(snapshot);
                            state = "CASH";
                        }
                    }
                }
                break;
            }
        }
    }

    // Handle end of simulation
    if (config.closePositionOnExit && (state === "LONG" || state === "SHORT")) {
        const lastCandle = candles[candles.length - 1];
        const lastBarIndex = candles.length - 1;
        if (lastCandle) {
            const exitSwap = executeEndOfBacktestExit(
                state as "LONG" | "SHORT",
                snapshot,
                config,
                lastCandle,
                lastBarIndex,
                nextSwapId++
            );
            swapEvents.push(exitSwap);
            stats.exitsExecuted++;

            updateEquityAfterExit(snapshot, exitSwap);
            equityCurve.push(createEquityPoint(snapshot, "CASH"));

            stateTransitions.push(
                createStateTransition(state, "CASH", null, snapshot.tradeId!, "END_OF_BACKTEST")
            );

            state = "CASH";
        }
    }

    // Pair swaps into trades
    const trades = pairSwapsIntoTrades(swapEvents);

    return {
        swapEvents,
        trades,
        equityCurve,
        stateTransitions,
        finalState: state,
        finalEquity: snapshot.equity,
        stats,
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Initialize simulation snapshot.
 */
function initializeSnapshot(config: EventSimulatorConfig): SimSnapshot {
    return {
        indicatorStates: new Map(),
        conditionMet: new Map([
            ["LONG_ENTRY", false],
            ["LONG_EXIT", false],
            ["SHORT_ENTRY", false],
            ["SHORT_EXIT", false],
        ]),
        currentPrice: 0,
        currentTimestamp: 0,
        currentBarIndex: 0,
        equity: config.initialCapital,
        peakEquity: config.initialCapital,
    };
}

/**
 * Update snapshot with event data.
 */
function updateSnapshot(snapshot: SimSnapshot, event: SimulationEvent, candles: Candle[]): void {
    snapshot.currentTimestamp = event.timestamp;
    snapshot.currentBarIndex = event.barIndex;

    // Update price from candle
    const candle = candles[event.barIndex];
    if (candle) {
        snapshot.currentPrice = candle.close;
    }

    // Update indicator and condition states based on event type
    if (isSignalCrossingEvent(event)) {
        snapshot.indicatorStates.set(event.indicatorKey, event.newValue);
    } else if (isConditionMetEvent(event)) {
        snapshot.conditionMet.set(event.conditionType, true);
    } else if (isConditionUnmetEvent(event)) {
        snapshot.conditionMet.set(event.conditionType, false);
    }

    // For price trigger events, use trigger price
    if (isSLTriggerEvent(event) || isTPTriggerEvent(event) || isTrailingTriggerEvent(event)) {
        snapshot.currentPrice = event.triggerPrice;
    }
}

/**
 * Execute an entry trade.
 */
function executeEntry(
    direction: Direction,
    snapshot: SimSnapshot,
    config: EventSimulatorConfig,
    _tradeId: number,
    swapId: number
): SwapEvent {
    const price = snapshot.currentPrice;
    const positionValue = calculatePositionValue(snapshot.equity, config.algoParams.positionSize);
    const feeUSD = (positionValue * config.feeBps) / 10000;
    const slippageUSD = (positionValue * config.slippageBps) / 10000;
    const effectiveValue = positionValue - feeUSD - slippageUSD;
    const assetAmount = effectiveValue / price;

    return {
        id: `swap_${swapId}`,
        timestamp: snapshot.currentTimestamp,
        barIndex: snapshot.currentBarIndex,
        fromAsset: "USD",
        toAsset: config.symbol,
        fromAmount: positionValue,
        toAmount: assetAmount,
        price,
        feeUSD,
        slippageUSD,
        isEntry: true,
        tradeDirection: direction,
    };
}

/**
 * Execute an exit trade.
 */
function executeExit(
    direction: Direction,
    snapshot: SimSnapshot,
    config: EventSimulatorConfig,
    _event: SimulationEvent,
    swapId: number,
    _reason: string
): SwapEvent {
    const price = snapshot.currentPrice;
    const assetAmount = snapshot.positionSize ?? 0;
    const grossValue = assetAmount * price;
    const feeUSD = (grossValue * config.feeBps) / 10000;
    const slippageUSD = (grossValue * config.slippageBps) / 10000;
    const netValue = grossValue - feeUSD - slippageUSD;

    return {
        id: `swap_${swapId}`,
        timestamp: snapshot.currentTimestamp,
        barIndex: snapshot.currentBarIndex,
        fromAsset: config.symbol,
        toAsset: "USD",
        fromAmount: assetAmount,
        toAmount: netValue,
        price,
        feeUSD,
        slippageUSD,
        isEntry: false,
        tradeDirection: direction,
    };
}

/**
 * Execute end-of-backtest exit.
 */
function executeEndOfBacktestExit(
    direction: Direction,
    snapshot: SimSnapshot,
    config: EventSimulatorConfig,
    lastCandle: Candle,
    lastBarIndex: number,
    swapId: number
): SwapEvent {
    const price = lastCandle.close;
    const assetAmount = snapshot.positionSize ?? 0;
    const grossValue = assetAmount * price;
    const feeUSD = (grossValue * config.feeBps) / 10000;
    const slippageUSD = (grossValue * config.slippageBps) / 10000;
    const netValue = grossValue - feeUSD - slippageUSD;

    return {
        id: `swap_${swapId}`,
        timestamp: lastCandle.bucket,
        barIndex: lastBarIndex,
        fromAsset: config.symbol,
        toAsset: "USD",
        fromAmount: assetAmount,
        toAmount: netValue,
        price,
        feeUSD,
        slippageUSD,
        isEntry: false,
        tradeDirection: direction,
    };
}

/**
 * Calculate position value from equity and size config.
 */
function calculatePositionValue(equity: number, sizeConfig: ValueConfig): number {
    if (sizeConfig.type === "ABS") {
        return Math.min(sizeConfig.value, equity);
    } else {
        // REL or DYN
        return equity * sizeConfig.value;
    }
}

/**
 * Update equity after exit.
 * Equity = (previous equity - entry value) + exit value
 * This preserves uninvested cash while updating the invested portion.
 */
function updateEquityAfterExit(snapshot: SimSnapshot, exitSwap: SwapEvent): void {
    // Calculate new equity: uninvested portion + exit proceeds
    const uninvestedCash = snapshot.equity - (snapshot.entryValue ?? 0);
    snapshot.equity = uninvestedCash + exitSwap.toAmount;

    // Update peak for drawdown
    if (snapshot.equity > snapshot.peakEquity) {
        snapshot.peakEquity = snapshot.equity;
    }
}

/**
 * Clear position-related state.
 */
function clearPositionState(snapshot: SimSnapshot): void {
    snapshot.entryPrice = undefined;
    snapshot.tradeId = undefined;
    snapshot.positionSize = undefined;
    snapshot.entryValue = undefined;
    snapshot.pendingSlEventId = undefined;
    snapshot.pendingTpEventId = undefined;
}

/**
 * Clear timeout-related state.
 */
function clearTimeoutState(snapshot: SimSnapshot): void {
    snapshot.timeoutDirection = undefined;
    snapshot.cooldownComplete = undefined;
    snapshot.cooldownEndBar = undefined;
}

/**
 * Set timeout state when entering TIMEOUT.
 */
function setTimeoutState(snapshot: SimSnapshot, direction: Direction, cooldownBars: number): void {
    snapshot.timeoutDirection = direction;
    snapshot.cooldownComplete = false;
    snapshot.cooldownEndBar = snapshot.currentBarIndex + cooldownBars;
}

/**
 * Create equity point.
 */
function createEquityPoint(snapshot: SimSnapshot, position: SimState): EquityPoint {
    const drawdownPct = snapshot.peakEquity > 0
        ? ((snapshot.peakEquity - snapshot.equity) / snapshot.peakEquity) * 100
        : 0;

    return {
        timestamp: snapshot.currentTimestamp,
        barIndex: snapshot.currentBarIndex,
        equity: snapshot.equity,
        drawdownPct,
        position,
    };
}

/**
 * Create state transition event.
 */
function createStateTransition(
    fromState: SimState,
    toState: SimState,
    event: SimulationEvent | null,
    tradeId: number | undefined,
    reason: TransitionReason
): StateTransitionEvent {
    return {
        type: "STATE_TRANSITION",
        timestamp: event?.timestamp ?? 0,
        barIndex: event?.barIndex ?? 0,
        fromState,
        toState,
        reason,
        tradeId,
    };
}

/**
 * Schedule SL/TP events for a new position.
 */
function scheduleSLTPEvents(
    snapshot: SimSnapshot,
    direction: Direction,
    config: EventSimulatorConfig,
    candles: Candle[],
    heap: EventHeap,
    tradeId: number
): { slEventId?: string; tpEventId?: string } {
    const exitCondition = direction === "LONG"
        ? config.algoParams.longExit
        : config.algoParams.shortExit;

    if (!exitCondition) {
        return {};
    }

    const result = scanForSLTPTriggers({
        entryBarIndex: snapshot.currentBarIndex,
        entryPrice: snapshot.entryPrice!,
        direction,
        slConfig: exitCondition.stopLoss,
        tpConfig: exitCondition.takeProfit,
        trailingEnabled: exitCondition.trailingSL,
        tradeId,
        candles,
        subBarCandlesMap: config.subBarCandlesMap,
        slValueFactorLookup: config.slValueFactorLookup,
        tpValueFactorLookup: config.tpValueFactorLookup,
    });

    let slEventId: string | undefined;
    let tpEventId: string | undefined;

    if (result.slEvent) {
        slEventId = result.slEvent.id;
        heap.push(result.slEvent);
    }
    if (result.trailingEvent) {
        slEventId = result.trailingEvent.id;
        heap.push(result.trailingEvent);
    }
    if (result.tpEvent) {
        tpEventId = result.tpEvent.id;
        heap.push(result.tpEvent);
    }

    return { slEventId, tpEventId };
}

/**
 * Schedule timeout expiry event.
 */
function scheduleTimeoutEvent(
    snapshot: SimSnapshot,
    config: EventSimulatorConfig,
    heap: EventHeap
): void {
    const cooldownBars = config.algoParams.timeout.cooldownBars;
    const timeoutBarIndex = snapshot.currentBarIndex + cooldownBars;
    const timeoutTimestamp = snapshot.currentTimestamp + cooldownBars * config.barDurationSeconds;

    const timeoutEvent = createTimeoutExpiredEvent({
        timestamp: timeoutTimestamp,
        barIndex: timeoutBarIndex,
        tradeId: snapshot.tradeId ?? 0,
        timeoutStartBar: snapshot.currentBarIndex,
        cooldownBars,
    });

    heap.push(timeoutEvent);
}

/**
 * Pair swap events into trades.
 */
function pairSwapsIntoTrades(swapEvents: SwapEvent[]): TradeEvent[] {
    const trades: TradeEvent[] = [];
    const pendingEntries: SwapEvent[] = [];

    for (const swap of swapEvents) {
        if (swap.isEntry) {
            pendingEntries.push(swap);
        } else {
            // Find matching entry
            const entrySwap = pendingEntries.shift();
            if (entrySwap) {
                const pnlUSD = swap.toAmount - entrySwap.fromAmount;
                const pnlPct = (pnlUSD / entrySwap.fromAmount) * 100;

                trades.push({
                    tradeId: trades.length + 1,
                    direction: entrySwap.tradeDirection!,
                    entrySwap,
                    exitSwap: swap,
                    pnlUSD,
                    pnlPct,
                    durationBars: swap.barIndex - entrySwap.barIndex,
                    durationSeconds: swap.timestamp - entrySwap.timestamp,
                });
            }
        }
    }

    return trades;
}
