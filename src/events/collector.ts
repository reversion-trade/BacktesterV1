/**
 * Event Collector
 *
 * Collects AlgoEvents and SwapEvents during simulation.
 * Tracks indicator and condition states to detect flips.
 * Pairs SwapEvents into TradeEvents.
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

/**
 * Configuration for indicator tracking
 */
export interface IndicatorInfo {
    indicatorKey: string;
    indicatorType: string;
    conditionType: ConditionType;
    isRequired: boolean;
}

/**
 * State tracked per condition
 */
interface ConditionState {
    /** Previous condition evaluation result */
    previousMet: boolean;
    /** Current indicator states (key → boolean) */
    indicatorStates: Map<string, boolean>;
    /** Required indicator keys */
    requiredKeys: string[];
    /** Optional indicator keys */
    optionalKeys: string[];
}

// =============================================================================
// EVENT COLLECTOR
// =============================================================================

/**
 * Collects events during simulation.
 *
 * Usage:
 * 1. Initialize with indicator info: collector.registerIndicators(...)
 * 2. Each bar: collector.updateIndicators(barIndex, timestamp, newStates)
 * 3. On swap: collector.emitSwap(...)
 * 4. On state change: collector.emitStateTransition(...)
 * 5. At end: collector.getResults()
 */
export class EventCollector {
    private algoEvents: AlgoEvent[] = [];
    private swapEvents: SwapEvent[] = [];
    private conditionStates: Map<ConditionType, ConditionState> = new Map();
    private currentPositionState: PositionState = "FLAT";
    private nextTradeId: number = 1;
    private nextSwapId: number = 1;
    private pendingEntrySwap: SwapEvent | null = null;
    private currentTradeId: number | null = null;
    private assetSymbol: string;

    constructor(assetSymbol: string) {
        this.assetSymbol = assetSymbol;
    }

    // ---------------------------------------------------------------------------
    // INITIALIZATION
    // ---------------------------------------------------------------------------

    /**
     * Register all indicators that will be tracked.
     * Must be called before simulation starts.
     */
    registerIndicators(indicators: IndicatorInfo[]): void {
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

    // ---------------------------------------------------------------------------
    // INDICATOR UPDATES
    // ---------------------------------------------------------------------------

    /**
     * Update indicator states for a bar.
     * Detects flips and emits appropriate events.
     *
     * @param barIndex - Current bar index
     * @param timestamp - Current timestamp
     * @param states - Map of indicatorKey → current signal value
     * @param indicatorInfoMap - Map of indicatorKey → IndicatorInfo (for metadata)
     */
    updateIndicators(
        barIndex: number,
        timestamp: number,
        states: Map<string, boolean>,
        indicatorInfoMap: Map<string, IndicatorInfo>
    ): void {
        // Validate: warn if states has keys not in indicatorInfoMap (only on first bar)
        if (barIndex === 0) {
            for (const key of states.keys()) {
                if (!indicatorInfoMap.has(key)) {
                    console.warn(
                        `[EventCollector] Indicator key "${key}" in signalCache but not registered. ` +
                            `This indicator will not be tracked for events.`
                    );
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

    /**
     * Calculate current snapshot for a condition.
     */
    private calculateConditionSnapshot(conditionType: ConditionType): ConditionSnapshot {
        const condState = this.conditionStates.get(conditionType);
        if (!condState) {
            return {
                requiredTrue: 0,
                requiredTotal: 0,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: false,
                distanceFromTrigger: Infinity,
            };
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
        if (!allRequiredMet) {
            distanceFromTrigger += requiredTotal - requiredTrue;
        }
        if (optionalTotal > 0 && optionalTrue === 0) {
            distanceFromTrigger += 1; // Need at least one optional
        }

        return {
            requiredTrue,
            requiredTotal,
            optionalTrue,
            optionalTotal,
            conditionMet,
            distanceFromTrigger,
        };
    }

    /**
     * Check if a condition's overall state changed and emit event.
     */
    private checkConditionChange(barIndex: number, timestamp: number, conditionType: ConditionType): void {
        const condState = this.conditionStates.get(conditionType);
        if (!condState) return;

        const snapshot = this.calculateConditionSnapshot(conditionType);
        const previousMet = condState.previousMet;
        const newMet = snapshot.conditionMet;

        if (previousMet !== newMet) {
            let triggeringKey: string | undefined;
            for (let i = this.algoEvents.length - 1; i >= 0; i--) {
                const evt = this.algoEvents[i]!;
                if (evt.type === "INDICATOR_FLIP") {
                    if (evt.conditionType === conditionType && evt.barIndex === barIndex) {
                        triggeringKey = evt.indicatorKey;
                        break;
                    }
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

    /**
     * Get current condition snapshot without emitting events.
     * Used by simulation loop to check conditions.
     */
    getConditionSnapshot(conditionType: ConditionType): ConditionSnapshot | null {
        if (!this.conditionStates.has(conditionType)) return null;
        return this.calculateConditionSnapshot(conditionType);
    }

    /**
     * Get previous condition met state.
     * Used by simulation loop for edge detection (false → true transitions).
     * This is the single source of truth for condition state tracking.
     */
    getPreviousConditionMet(conditionType: ConditionType): boolean {
        const condState = this.conditionStates.get(conditionType);
        return condState?.previousMet ?? false;
    }

    // ---------------------------------------------------------------------------
    // STATE TRANSITIONS
    // ---------------------------------------------------------------------------

    /**
     * Emit a state transition event.
     */
    emitStateTransition(
        barIndex: number,
        timestamp: number,
        fromState: PositionState,
        toState: PositionState,
        reason: TransitionReason
    ): void {
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

    // ---------------------------------------------------------------------------
    // SWAP EVENTS
    // ---------------------------------------------------------------------------

    /**
     * Emit an entry swap (USD → Asset).
     * Starts a new trade.
     */
    emitEntrySwap(
        barIndex: number,
        timestamp: number,
        _direction: Direction,
        price: number,
        usdAmount: number,
        assetAmount: number,
        feeUSD: number,
        slippageUSD: number
    ): number {
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

    /**
     * Emit an exit swap (Asset → USD).
     * Completes the current trade.
     */
    emitExitSwap(
        barIndex: number,
        timestamp: number,
        direction: Direction,
        price: number,
        assetAmount: number,
        usdAmount: number,
        feeUSD: number,
        slippageUSD: number
    ): TradeEvent | null {
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

        // Create TradeEvent from paired swaps
        if (!this.pendingEntrySwap) {
            console.warn("Exit swap without entry swap");
            return null;
        }

        const entrySwap = this.pendingEntrySwap;
        const exitSwap = swap;

        const pnlUSD = exitSwap.toAmount - entrySwap.fromAmount;
        const pnlPct = pnlUSD / entrySwap.fromAmount;
        const durationBars = exitSwap.barIndex - entrySwap.barIndex;
        const durationSeconds = exitSwap.timestamp - entrySwap.timestamp;

        const trade: TradeEvent = {
            tradeId: this.currentTradeId!,
            direction,
            entrySwap,
            exitSwap,
            pnlUSD,
            pnlPct,
            durationBars,
            durationSeconds,
        };

        this.pendingEntrySwap = null;
        this.currentTradeId = null;

        return trade;
    }

    // ---------------------------------------------------------------------------
    // SPECIAL INDICATOR EVENTS
    // ---------------------------------------------------------------------------

    /**
     * Emit a special indicator event (SL/TP/Trailing).
     */
    emitSpecialIndicatorEvent(
        barIndex: number,
        timestamp: number,
        eventType: SpecialIndicatorEvent["type"],
        price: number,
        level: number,
        direction: Direction
    ): void {
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

    // ---------------------------------------------------------------------------
    // RESULTS
    // ---------------------------------------------------------------------------

    /**
     * Get all collected events.
     */
    getEvents(): { algoEvents: AlgoEvent[]; swapEvents: SwapEvent[] } {
        return {
            algoEvents: [...this.algoEvents],
            swapEvents: [...this.swapEvents],
        };
    }

    /**
     * Build TradeEvents from paired SwapEvents.
     */
    buildTradeEvents(): TradeEvent[] {
        const trades: TradeEvent[] = [];
        const entrySwaps = new Map<number, SwapEvent>();

        let swapPairIndex = 0;
        for (const swap of this.swapEvents) {
            if (swap.fromAsset === "USD") {
                entrySwaps.set(swapPairIndex, swap);
                swapPairIndex++;
            }
        }

        swapPairIndex = 0;
        let currentEntrySwap: SwapEvent | null = null;
        let tradeId = 1;

        for (const swap of this.swapEvents) {
            if (swap.fromAsset === "USD") {
                currentEntrySwap = swap;
            } else if (swap.toAsset === "USD" && currentEntrySwap) {
                const direction: Direction = swap.fromAsset === this.assetSymbol ? "LONG" : "SHORT";

                const pnlUSD = swap.toAmount - currentEntrySwap.fromAmount;
                const pnlPct = pnlUSD / currentEntrySwap.fromAmount;
                const durationBars = swap.barIndex - currentEntrySwap.barIndex;
                const durationSeconds = swap.timestamp - currentEntrySwap.timestamp;

                trades.push({
                    tradeId: tradeId++,
                    direction,
                    entrySwap: currentEntrySwap,
                    exitSwap: swap,
                    pnlUSD,
                    pnlPct,
                    durationBars,
                    durationSeconds,
                });

                currentEntrySwap = null;
            }
        }

        return trades;
    }

    /**
     * Get current position state.
     */
    getCurrentState(): PositionState {
        return this.currentPositionState;
    }

    /**
     * Get current trade ID (if in a position).
     */
    getCurrentTradeId(): number | null {
        return this.currentTradeId;
    }

    /**
     * Reset collector for a new simulation.
     */
    reset(): void {
        this.algoEvents = [];
        this.swapEvents = [];
        this.conditionStates.clear();
        this.currentPositionState = "FLAT";
        this.nextTradeId = 1;
        this.nextSwapId = 1;
        this.pendingEntrySwap = null;
        this.currentTradeId = null;
    }
}
