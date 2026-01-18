/** SL/TP Scanner - Scans forward from trade entry to find when SL/TP would trigger. Enables pre-scheduling price events for heap. */

import type { Candle, Direction, ValueConfig } from "../core/types.ts";
import {
    createSLTriggerEvent, createTPTriggerEvent, createTrailingTriggerEvent,
    type SLTriggerEvent, type TPTriggerEvent, type TrailingTriggerEvent,
} from "../events/simulation-events.ts";
import { generatePriceCheckpoints, simulateSubBarPath, type PriceCheckpoint } from "./subbar-simulator.ts";
import { calculateTargetPrice, isPriceLevelHit } from "./special-indicators/types.ts";

export interface SLTPScanInput {
    entryBarIndex: number;                                                      // Bar index where entry occurred
    entryPrice: number;                                                         // Entry price
    direction: Direction;                                                       // Position direction
    slConfig?: ValueConfig;                                                     // Stop loss configuration (optional)
    tpConfig?: ValueConfig;                                                     // Take profit configuration (optional)
    trailingEnabled?: boolean;                                                  // Whether trailing stop is enabled
    tradeId: number;                                                            // Trade ID for the events
    candles: Candle[];                                                          // Parent candles for the simulation period
    subBarCandlesMap?: Map<number, Candle[]>;                                   // Parent bar index → sub-bar candles
    slValueFactorLookup?: (timestamp: number) => number | undefined;            // Lookup function for DYN SL value factor
    tpValueFactorLookup?: (timestamp: number) => number | undefined;            // Lookup function for DYN TP value factor
    maxBarsToScan?: number;                                                     // Maximum bars to scan (limits search in long backtests)
}

export interface SLTPScanResult {
    slEvent?: SLTriggerEvent;                                                   // SL trigger event (if SL triggers first)
    tpEvent?: TPTriggerEvent;                                                   // TP trigger event (if TP triggers first)
    trailingEvent?: TrailingTriggerEvent;                                       // Trailing stop trigger event
    hasTriggger: boolean;                                                       // Whether any trigger was found
    stats: ScanStats;                                                           // Scanning statistics
}

export interface ScanStats {
    barsScanned: number;                                                        // Number of bars scanned
    checkpointsEvaluated: number;                                               // Number of price checkpoints evaluated
    firstTrigger: "SL" | "TP" | "TRAILING" | null;                              // Which trigger was found first
    triggerBarIndex: number;                                                    // Bar index of first trigger (or -1)
}

interface TrailingState {
    extremePrice: number;                                                       // Current extreme price (high for LONG, low for SHORT)
    currentLevel: number;                                                       // Current trailing stop level
}

/** Scan forward from entry to find SL/TP trigger times. O(n) where n = bars until trigger or end. */
export function scanForSLTPTriggers(input: SLTPScanInput): SLTPScanResult {
    const {
        entryBarIndex, entryPrice, direction, slConfig, tpConfig,
        trailingEnabled = false, tradeId, candles, subBarCandlesMap,
        slValueFactorLookup, tpValueFactorLookup, maxBarsToScan = Infinity,
    } = input;

    const stats: ScanStats = { barsScanned: 0, checkpointsEvaluated: 0, firstTrigger: null, triggerBarIndex: -1 };
    if (!slConfig && !tpConfig) return { hasTriggger: false, stats };           // No SL or TP configured

    let slLevel = slConfig ? calculateSLLevel(entryPrice, slConfig, direction, 1) : undefined;
    let tpLevel = tpConfig ? calculateTPLevel(entryPrice, tpConfig, direction, 1) : undefined;

    let trailingState: TrailingState | undefined;
    if (trailingEnabled && slConfig) trailingState = { extremePrice: entryPrice, currentLevel: slLevel! };

    const startBar = entryBarIndex + 1;                                         // Start from bar after entry
    const endBar = Math.min(candles.length, startBar + maxBarsToScan);

    for (let barIndex = startBar; barIndex < endBar; barIndex++) {
        stats.barsScanned++;
        const candle = candles[barIndex];
        if (!candle) continue;

        const checkpoints = getCheckpointsForBar(barIndex, candle, subBarCandlesMap);

        for (const checkpoint of checkpoints) {
            stats.checkpointsEvaluated++;

            if (slConfig?.type === "DYN" && slValueFactorLookup) {              // Update DYN SL level
                const factor = slValueFactorLookup(checkpoint.timestamp);
                if (factor !== undefined) {
                    slLevel = calculateSLLevel(entryPrice, slConfig, direction, factor);
                    if (trailingState) trailingState.currentLevel = calculateTrailingLevel(trailingState.extremePrice, slConfig, direction, factor);
                }
            }

            if (tpConfig?.type === "DYN" && tpValueFactorLookup) {              // Update DYN TP level
                const factor = tpValueFactorLookup(checkpoint.timestamp);
                if (factor !== undefined) tpLevel = calculateTPLevel(entryPrice, tpConfig, direction, factor);
            }

            if (trailingState) updateTrailingState(trailingState, checkpoint.price, direction, slConfig!);

            if (slLevel !== undefined) {                                        // Check SL hit
                const hitLevel = trailingState ? trailingState.currentLevel : slLevel;
                if (isPriceLevelHit(checkpoint.price, hitLevel, direction, true)) {
                    stats.firstTrigger = trailingState ? "TRAILING" : "SL";
                    stats.triggerBarIndex = barIndex;
                    if (trailingState) {
                        return {
                            trailingEvent: createTrailingTriggerEvent({
                                timestamp: checkpoint.timestamp, barIndex, triggerPrice: checkpoint.price,
                                entryPrice, direction, tradeId, trailingLevel: trailingState.currentLevel,
                                peakPrice: trailingState.extremePrice, subBarIndex: checkpoint.subBarIndex,
                                checkpointIndex: checkpoint.checkpointIndex,
                            }),
                            hasTriggger: true, stats,
                        };
                    }
                    return {
                        slEvent: createSLTriggerEvent({
                            timestamp: checkpoint.timestamp, barIndex, triggerPrice: checkpoint.price,
                            entryPrice, direction, tradeId, slLevel,
                            subBarIndex: checkpoint.subBarIndex, checkpointIndex: checkpoint.checkpointIndex,
                        }),
                        hasTriggger: true, stats,
                    };
                }
            }

            if (tpLevel !== undefined && isPriceLevelHit(checkpoint.price, tpLevel, direction, false)) {
                stats.firstTrigger = "TP";
                stats.triggerBarIndex = barIndex;
                return {
                    tpEvent: createTPTriggerEvent({
                        timestamp: checkpoint.timestamp, barIndex, triggerPrice: checkpoint.price,
                        entryPrice, direction, tradeId, tpLevel,
                        subBarIndex: checkpoint.subBarIndex, checkpointIndex: checkpoint.checkpointIndex,
                    }),
                    hasTriggger: true, stats,
                };
            }
        }
    }

    return { hasTriggger: false, stats };                                       // No trigger found within scan range
}

/** Get price checkpoints for a bar. Uses sub-bar candles if available, otherwise OHLC simulation. */
function getCheckpointsForBar(barIndex: number, candle: Candle, subBarCandlesMap?: Map<number, Candle[]>): PriceCheckpoint[] {
    if (subBarCandlesMap) {
        const subBarCandles = subBarCandlesMap.get(barIndex);
        if (subBarCandles && subBarCandles.length > 0) return generatePriceCheckpoints(subBarCandles);
    }
    const path = simulateSubBarPath(candle);                                    // Fall back to OHLC simulation
    const duration = 60;                                                        // Default to 60 seconds if unknown
    return path.map((price, i) => ({ price, timestamp: candle.bucket + Math.floor((duration * i) / 4), subBarIndex: 0, checkpointIndex: i }));
}

function calculateSLLevel(entryPrice: number, config: ValueConfig, direction: Direction, factor: number): number {
    return calculateTargetPrice(entryPrice, config, direction, true, factor);
}

function calculateTPLevel(entryPrice: number, config: ValueConfig, direction: Direction, factor: number): number {
    return calculateTargetPrice(entryPrice, config, direction, false, factor);
}

/** Calculate trailing stop level from extreme price (not entry price). */
function calculateTrailingLevel(extremePrice: number, config: ValueConfig, direction: Direction, factor: number): number {
    return calculateTargetPrice(extremePrice, config, direction, true, factor);
}

function updateTrailingState(state: TrailingState, price: number, direction: Direction, slConfig: ValueConfig): void {
    if (direction === "LONG" && price > state.extremePrice) {                   // Price moved favorably
        state.extremePrice = price;
        state.currentLevel = calculateTrailingLevel(price, slConfig, direction, 1);
    } else if (direction === "SHORT" && price < state.extremePrice) {
        state.extremePrice = price;
        state.currentLevel = calculateTrailingLevel(price, slConfig, direction, 1);
    }
}

/** Quick check if SL would trigger at a specific price. */
export function wouldSLTrigger(price: number, entryPrice: number, slConfig: ValueConfig, direction: Direction, factor: number = 1): boolean {
    return isPriceLevelHit(price, calculateSLLevel(entryPrice, slConfig, direction, factor), direction, true);
}

/** Quick check if TP would trigger at a specific price. */
export function wouldTPTrigger(price: number, entryPrice: number, tpConfig: ValueConfig, direction: Direction, factor: number = 1): boolean {
    return isPriceLevelHit(price, calculateTPLevel(entryPrice, tpConfig, direction, factor), direction, false);
}

/** Get SL/TP levels without scanning. Useful for debugging and display. */
export function getLevels(entryPrice: number, slConfig?: ValueConfig, tpConfig?: ValueConfig, direction: Direction = "LONG", slFactor: number = 1, tpFactor: number = 1): { slLevel?: number; tpLevel?: number } {
    return {
        slLevel: slConfig ? calculateSLLevel(entryPrice, slConfig, direction, slFactor) : undefined,
        tpLevel: tpConfig ? calculateTPLevel(entryPrice, tpConfig, direction, tpFactor) : undefined,
    };
}
