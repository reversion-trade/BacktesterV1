/**
 * Event Collector - Collects AlgoEvents and SwapEvents during simulation.
 * Tracks indicator and condition states to detect flips. Pairs SwapEvents into TradeEvents.
 */

import type { Direction, PositionState } from "../core/types.ts";
import type {
    SwapEvent,
    TradeEvent,
    AlgoEvent,
    IndicatorFlipEvent,
    ConditionChangeEvent,
    StateTransitionEvent,
    SpecialIndicatorEvent,
    ConditionSnapshot,
    ConditionType,
    TransitionReason,
} from "./types.ts";

// =============================================================================
// TYPES
// =============================================================================

export interface IndicatorInfo {
    indicatorKey: string;
    indicatorType: string;
    conditionType: ConditionType;
    isRequired: boolean;
}

interface ConditionState {
    previousMet: boolean;                      // Previous condition evaluation result
    indicatorStates: Map<string, boolean>;     // Current indicator states (key → boolean)
    requiredKeys: string[];                    // Required indicator keys
    optionalKeys: string[];                    // Optional indicator keys
}

// =============================================================================
// EVENT COLLECTOR
// =============================================================================

/**
 * Collects events during simulation.
 * 1. Initialize: collector.registerIndicators(...)
 * 2. Each bar: collector.updateIndicators(barIndex, timestamp, newStates)
 * 3. On swap: collector.emitEntrySwap/emitExitSwap(...)
 * 4. On state change: collector.emitStateTransition(...)
 * 5. At end: collector.getEvents()
 */
export class EventCollector {
    private algoEvents: AlgoEvent[] = [];
    private swapEvents: SwapEvent[] = [];
    private conditionStates: Map<ConditionType, ConditionState> = new Map();
    private currentPositionState: PositionState = "CASH";
    private nextTradeId: number = 1;
    private nextSwapId: number = 1;
    private pendingEntrySwap: SwapEvent | null = null;
    private currentTradeId: number | null = null;
    private assetSymbol: string;

    constructor(assetSymbol: string) {
        this.assetSymbol = assetSymbol;
    }

    // -------------------------------------------------------------------------
    // INITIALIZATION
    // -------------------------------------------------------------------------

    registerIndicators(indicators: IndicatorInfo[]): void { // Register all indicators before simulation starts
        const byCondition = new Map<ConditionType, IndicatorInfo[]>();

        for (const info of indicators) {
            const existing = byCondition.get(info.conditionType) ?? [];
            existing.push(info);
            byCondition.set(info.conditionType, existing);
        }

        for (const [conditionType, infos] of byCondition) {
            const requiredKeys = infos.filter((i) => i.isRequired).map((i) => i.indicatorKey);
            const optionalKeys = infos.filter((i) => !i.isRequired).map((i) => i.indicatorKey);

            this.conditionStates.set(conditionType, {
                previousMet: false,
                indicatorStates: new Map(),
                requiredKeys,
                optionalKeys,
            });
        }
    }

    // -------------------------------------------------------------------------
    // INDICATOR UPDATES
    // -------------------------------------------------------------------------

    updateIndicators( // Update indicator states for a bar, detect flips, emit events
        barIndex: number,
        timestamp: number,
        states: Map<string, boolean>,
        indicatorInfoMap: Map<string, IndicatorInfo>
    ): void {
        if (barIndex === 0) { // Warn about unregistered indicators on first bar only
            for (const key of states.keys()) {
                if (!indicatorInfoMap.has(key)) {
                    console.warn(`[EventCollector] Indicator "${key}" not registered, won't be tracked.`);
                }
            }
        }

        const conditionsToCheck = new Set<ConditionType>();

        for (const [key, newValue] of states) {
            const info = indicatorInfoMap.get(key);
            if (!info) continue;

            const condState = this.conditionStates.get(info.conditionType);
            if (!condState) continue;

            const previousValue = condState.indicatorStates.get(key) ?? false;

            if (previousValue !== newValue) {
                condState.indicatorStates.set(key, newValue);
                const snapshot = this.calculateConditionSnapshot(info.conditionType);

                const flipEvent: IndicatorFlipEvent = {
                    type: "INDICATOR_FLIP",
                    timestamp,
                    barIndex,
                    indicatorKey: key,
                    indicatorType: info.indicatorType,
                    previousValue,
                    newValue,
                    conditionType: info.conditionType,
                    isRequired: info.isRequired,
                    conditionSnapshot: snapshot,
                };
                this.algoEvents.push(flipEvent);
                conditionsToCheck.add(info.conditionType);
            } else {
                condState.indicatorStates.set(key, newValue);
            }
        }

        for (const conditionType of conditionsToCheck) {
            this.checkConditionChange(barIndex, timestamp, conditionType);
        }
    }

    private calculateConditionSnapshot(conditionType: ConditionType): ConditionSnapshot {
        const condState = this.conditionStates.get(conditionType);
        if (!condState) {
            return { requiredTrue: 0, requiredTotal: 0, optionalTrue: 0, optionalTotal: 0, conditionMet: false, distanceFromTrigger: Infinity };
        }

        let requiredTrue = 0;
        for (const key of condState.requiredKeys) {
            if (condState.indicatorStates.get(key)) requiredTrue++;
        }

        let optionalTrue = 0;
        for (const key of condState.optionalKeys) {
            if (condState.indicatorStates.get(key)) optionalTrue++;
        }

        const requiredTotal = condState.requiredKeys.length;
        const optionalTotal = condState.optionalKeys.length;
        const allRequiredMet = requiredTrue === requiredTotal;
        const optionalSatisfied = optionalTotal === 0 || optionalTrue > 0;
        const conditionMet = allRequiredMet && optionalSatisfied;

        let distanceFromTrigger = 0;
        if (!allRequiredMet) distanceFromTrigger += requiredTotal - requiredTrue;
        if (optionalTotal > 0 && optionalTrue === 0) distanceFromTrigger += 1; // Need at least one optional

        return { requiredTrue, requiredTotal, optionalTrue, optionalTotal, conditionMet, distanceFromTrigger };
    }

    private checkConditionChange(barIndex: number, timestamp: number, conditionType: ConditionType): void {
        const condState = this.conditionStates.get(conditionType);
        if (!condState) return;

        const snapshot = this.calculateConditionSnapshot(conditionType);
        const previousMet = condState.previousMet;
        const newMet = snapshot.conditionMet;

        if (previousMet !== newMet) {
            let triggeringKey: string | undefined;
            for (let i = this.algoEvents.length - 1; i >= 0; i--) { // Find triggering indicator
                const evt = this.algoEvents[i]!;
                if (evt.type === "INDICATOR_FLIP" && evt.conditionType === conditionType && evt.barIndex === barIndex) {
                    triggeringKey = evt.indicatorKey;
                    break;
                }
            }

            const changeEvent: ConditionChangeEvent = {
                type: "CONDITION_CHANGE",
                timestamp,
                barIndex,
                conditionType,
                previousState: previousMet,
                newState: newMet,
                triggeringIndicatorKey: triggeringKey,
                snapshot,
            };
            this.algoEvents.push(changeEvent);
            condState.previousMet = newMet;
        }
    }

    getConditionSnapshot(conditionType: ConditionType): ConditionSnapshot | null { // Get snapshot without emitting events
        if (!this.conditionStates.has(conditionType)) return null;
        return this.calculateConditionSnapshot(conditionType);
    }

    getPreviousConditionMet(conditionType: ConditionType): boolean { // Single source of truth for condition state
        return this.conditionStates.get(conditionType)?.previousMet ?? false;
    }

    // -------------------------------------------------------------------------
    // STATE TRANSITIONS
    // -------------------------------------------------------------------------

    emitStateTransition(barIndex: number, timestamp: number, fromState: PositionState, toState: PositionState, reason: TransitionReason): void {
        const event: StateTransitionEvent = {
            type: "STATE_TRANSITION",
            timestamp,
            barIndex,
            fromState,
            toState,
            reason,
            tradeId: this.currentTradeId ?? undefined,
        };
        this.algoEvents.push(event);
        this.currentPositionState = toState;
    }

    // -------------------------------------------------------------------------
    // SWAP EVENTS
    // -------------------------------------------------------------------------

    emitEntrySwap(barIndex: number, timestamp: number, price: number, usdAmount: number, assetAmount: number, feeUSD: number, slippageUSD: number): number {
        const tradeId = this.nextTradeId++;
        this.currentTradeId = tradeId;

        const swap: SwapEvent = {
            id: `swap_${this.nextSwapId++}`,
            timestamp,
            barIndex,
            fromAsset: "USD",
            toAsset: this.assetSymbol,
            fromAmount: usdAmount,
            toAmount: assetAmount,
            price,
            feeUSD,
            slippageUSD,
        };

        this.swapEvents.push(swap);
        this.pendingEntrySwap = swap;
        return tradeId;
    }

    emitExitSwap(barIndex: number, timestamp: number, direction: Direction, price: number, assetAmount: number, usdAmount: number, feeUSD: number, slippageUSD: number): TradeEvent | null {
        const swap: SwapEvent = {
            id: `swap_${this.nextSwapId++}`,
            timestamp,
            barIndex,
            fromAsset: this.assetSymbol,
            toAsset: "USD",
            fromAmount: assetAmount,
            toAmount: usdAmount,
            price,
            feeUSD,
            slippageUSD,
        };

        this.swapEvents.push(swap);

        if (!this.pendingEntrySwap) {
            console.warn("Exit swap without entry swap");
            return null;
        }

        const entrySwap = this.pendingEntrySwap;
        const pnlUSD = swap.toAmount - entrySwap.fromAmount;

        const trade: TradeEvent = {
            tradeId: this.currentTradeId!,
            direction,
            entrySwap,
            exitSwap: swap,
            pnlUSD,
            pnlPct: pnlUSD / entrySwap.fromAmount,
            durationBars: swap.barIndex - entrySwap.barIndex,
            durationSeconds: swap.timestamp - entrySwap.timestamp,
        };

        this.pendingEntrySwap = null;
        this.currentTradeId = null;
        return trade;
    }

    // -------------------------------------------------------------------------
    // SPECIAL INDICATOR EVENTS
    // -------------------------------------------------------------------------

    emitSpecialIndicatorEvent(barIndex: number, timestamp: number, eventType: SpecialIndicatorEvent["type"], price: number, level: number, direction: Direction): void {
        const event: SpecialIndicatorEvent = {
            type: eventType,
            timestamp,
            barIndex,
            price,
            level,
            direction,
            tradeId: this.currentTradeId!,
        };
        this.algoEvents.push(event);
    }

    // -------------------------------------------------------------------------
    // RESULTS
    // -------------------------------------------------------------------------

    getEvents(): { algoEvents: AlgoEvent[]; swapEvents: SwapEvent[] } {
        return { algoEvents: [...this.algoEvents], swapEvents: [...this.swapEvents] };
    }

    buildTradeEvents(): TradeEvent[] { // Build TradeEvents from paired SwapEvents
        const trades: TradeEvent[] = [];
        let currentEntrySwap: SwapEvent | null = null;
        let tradeId = 1;

        for (const swap of this.swapEvents) {
            if (swap.fromAsset === "USD") {
                currentEntrySwap = swap;
            } else if (swap.toAsset === "USD" && currentEntrySwap) {
                const direction: Direction = swap.fromAsset === this.assetSymbol ? "LONG" : "SHORT";
                const pnlUSD = swap.toAmount - currentEntrySwap.fromAmount;

                trades.push({
                    tradeId: tradeId++,
                    direction,
                    entrySwap: currentEntrySwap,
                    exitSwap: swap,
                    pnlUSD,
                    pnlPct: pnlUSD / currentEntrySwap.fromAmount,
                    durationBars: swap.barIndex - currentEntrySwap.barIndex,
                    durationSeconds: swap.timestamp - currentEntrySwap.timestamp,
                });
                currentEntrySwap = null;
            }
        }
        return trades;
    }

    getCurrentState(): PositionState { return this.currentPositionState; }
    getCurrentTradeId(): number | null { return this.currentTradeId; }

    reset(): void {
        this.algoEvents = [];
        this.swapEvents = [];
        this.conditionStates.clear();
        this.currentPositionState = "CASH";
        this.nextTradeId = 1;
        this.nextSwapId = 1;
        this.pendingEntrySwap = null;
        this.currentTradeId = null;
    }
}
