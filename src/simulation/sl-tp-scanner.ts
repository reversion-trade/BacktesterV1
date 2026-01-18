/**
 * SL/TP Scanner - Pre-calculate Stop Loss and Take Profit Trigger Times
 *
 * @module simulation/sl-tp-scanner
 * @description
 * Scans forward from a trade entry to find when SL/TP would trigger.
 * This enables pre-scheduling of price trigger events for the heap.
 *
 * @architecture
 * Forward Scanning Algorithm:
 * 1. Calculate initial SL/TP levels from entry price and config
 * 2. For each bar after entry, get price checkpoints (sub-bar precision)
 * 3. Check each checkpoint against SL/TP levels
 * 4. Return first trigger found (if any)
 *
 * DYN SL/TP Support:
 * - Uses pre-calculated valueFactor from Stage 1.6
 * - Lookup factor at each checkpoint timestamp
 * - Recalculate level with updated factor
 *
 * @performance
 * - O(n) where n = bars until trigger or end of data
 * - Early exit on first trigger
 * - Sub-bar precision for accurate trigger times
 *
 * @audit-trail
 * - Created: 2026-01-09 (Event-Driven Simulation Implementation)
 * - Purpose: Enable heap-based SL/TP event scheduling
 */

import type { Candle, Direction, ValueConfig } from "../core/types.ts";
import {
    createSLTriggerEvent,
    createTPTriggerEvent,
    createTrailingTriggerEvent,
    type SLTriggerEvent,
    type TPTriggerEvent,
    type TrailingTriggerEvent,
} from "../events/simulation-events.ts";
import {
    generatePriceCheckpoints,
    simulateSubBarPath,
    type PriceCheckpoint,
} from "./subbar-simulator.ts";
import { calculateTargetPrice, isPriceLevelHit } from "./special-indicators/types.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for SL/TP scanning.
 */
export interface SLTPScanInput {
    /** Bar index where entry occurred */
    entryBarIndex: number;

    /** Entry price */
    entryPrice: number;

    /** Position direction */
    direction: Direction;

    /** Stop loss configuration (optional) */
    slConfig?: ValueConfig;

    /** Take profit configuration (optional) */
    tpConfig?: ValueConfig;

    /** Whether trailing stop is enabled */
    trailingEnabled?: boolean;

    /** Trade ID for the events */
    tradeId: number;

    /** Parent candles for the simulation period */
    candles: Candle[];

    /** Sub-bar candles map: parent bar index → sub-bar candles */
    subBarCandlesMap?: Map<number, Candle[]>;

    /** Lookup function for DYN SL value factor by timestamp */
    slValueFactorLookup?: (timestamp: number) => number | undefined;

    /** Lookup function for DYN TP value factor by timestamp */
    tpValueFactorLookup?: (timestamp: number) => number | undefined;

    /** Maximum bars to scan (for limiting search in long backtests) */
    maxBarsToScan?: number;
}

/**
 * Result of SL/TP scanning.
 */
export interface SLTPScanResult {
    /** SL trigger event (if SL would trigger before TP or exit) */
    slEvent?: SLTriggerEvent;

    /** TP trigger event (if TP would trigger before SL or exit) */
    tpEvent?: TPTriggerEvent;

    /** Trailing stop trigger event (if trailing enabled and triggers) */
    trailingEvent?: TrailingTriggerEvent;

    /** Whether any trigger was found */
    hasTriggger: boolean;

    /** Scanning statistics */
    stats: ScanStats;
}

/**
 * Statistics about the scanning process.
 */
export interface ScanStats {
    /** Number of bars scanned */
    barsScanned: number;

    /** Number of price checkpoints evaluated */
    checkpointsEvaluated: number;

    /** Which trigger was found first (or null) */
    firstTrigger: "SL" | "TP" | "TRAILING" | null;

    /** Bar index of first trigger (or -1) */
    triggerBarIndex: number;
}

/**
 * Internal state for tracking trailing stop.
 */
interface TrailingState {
    /** Current extreme price (high for LONG, low for SHORT) */
    extremePrice: number;

    /** Current trailing stop level */
    currentLevel: number;
}

// =============================================================================
// MAIN SCANNER FUNCTION
// =============================================================================

/**
 * Scan forward from entry to find SL/TP trigger times.
 *
 * @param input - Scan input configuration
 * @returns SLTPScanResult with trigger events
 *
 * @example
 * ```typescript
 * const result = scanForSLTPTriggers({
 *     entryBarIndex: 100,
 *     entryPrice: 50000,
 *     direction: "LONG",
 *     slConfig: { type: "REL", value: 0.02 },
 *     tpConfig: { type: "REL", value: 0.05 },
 *     tradeId: 1,
 *     candles: allCandles,
 *     subBarCandlesMap: subBarMap,
 * });
 *
 * if (result.slEvent) heap.push(result.slEvent);
 * if (result.tpEvent) heap.push(result.tpEvent);
 * ```
 */
export function scanForSLTPTriggers(input: SLTPScanInput): SLTPScanResult {
    const {
        entryBarIndex,
        entryPrice,
        direction,
        slConfig,
        tpConfig,
        trailingEnabled = false,
        tradeId,
        candles,
        subBarCandlesMap,
        slValueFactorLookup,
        tpValueFactorLookup,
        maxBarsToScan = Infinity,
    } = input;

    // Initialize result
    const stats: ScanStats = {
        barsScanned: 0,
        checkpointsEvaluated: 0,
        firstTrigger: null,
        triggerBarIndex: -1,
    };

    // If no SL or TP configured, nothing to scan
    if (!slConfig && !tpConfig) {
        return { hasTriggger: false, stats };
    }

    // Calculate initial levels
    let slLevel = slConfig ? calculateSLLevel(entryPrice, slConfig, direction, 1) : undefined;
    let tpLevel = tpConfig ? calculateTPLevel(entryPrice, tpConfig, direction, 1) : undefined;

    // Initialize trailing state
    let trailingState: TrailingState | undefined;
    if (trailingEnabled && slConfig) {
        trailingState = {
            extremePrice: entryPrice,
            currentLevel: slLevel!,
        };
    }

    // Scan forward from entry
    const startBar = entryBarIndex + 1; // Start from bar after entry
    const endBar = Math.min(candles.length, startBar + maxBarsToScan);

    for (let barIndex = startBar; barIndex < endBar; barIndex++) {
        stats.barsScanned++;

        const candle = candles[barIndex];
        if (!candle) continue;

        // Get price checkpoints for this bar
        const checkpoints = getCheckpointsForBar(barIndex, candle, subBarCandlesMap);

        // Check each checkpoint
        for (const checkpoint of checkpoints) {
            stats.checkpointsEvaluated++;

            // Update DYN levels if configured
            if (slConfig?.type === "DYN" && slValueFactorLookup) {
                const factor = slValueFactorLookup(checkpoint.timestamp);
                if (factor !== undefined) {
                    slLevel = calculateSLLevel(entryPrice, slConfig, direction, factor);
                    if (trailingState) {
                        trailingState.currentLevel = calculateTrailingLevel(
                            trailingState.extremePrice,
                            slConfig,
                            direction,
                            factor
                        );
                    }
                }
            }

            if (tpConfig?.type === "DYN" && tpValueFactorLookup) {
                const factor = tpValueFactorLookup(checkpoint.timestamp);
                if (factor !== undefined) {
                    tpLevel = calculateTPLevel(entryPrice, tpConfig, direction, factor);
                }
            }

            // Update trailing stop extreme
            if (trailingState) {
                updateTrailingState(trailingState, checkpoint.price, direction, slConfig!);
            }

            // Check SL hit
            if (slLevel !== undefined) {
                const hitLevel = trailingState ? trailingState.currentLevel : slLevel;
                if (isPriceLevelHit(checkpoint.price, hitLevel, direction, true)) {
                    stats.firstTrigger = trailingState ? "TRAILING" : "SL";
                    stats.triggerBarIndex = barIndex;

                    if (trailingState) {
                        return {
                            trailingEvent: createTrailingTriggerEvent({
                                timestamp: checkpoint.timestamp,
                                barIndex,
                                triggerPrice: checkpoint.price,
                                entryPrice,
                                direction,
                                tradeId,
                                trailingLevel: trailingState.currentLevel,
                                peakPrice: trailingState.extremePrice,
                                subBarIndex: checkpoint.subBarIndex,
                                checkpointIndex: checkpoint.checkpointIndex,
                            }),
                            hasTriggger: true,
                            stats,
                        };
                    }

                    return {
                        slEvent: createSLTriggerEvent({
                            timestamp: checkpoint.timestamp,
                            barIndex,
                            triggerPrice: checkpoint.price,
                            entryPrice,
                            direction,
                            tradeId,
                            slLevel,
                            subBarIndex: checkpoint.subBarIndex,
                            checkpointIndex: checkpoint.checkpointIndex,
                        }),
                        hasTriggger: true,
                        stats,
                    };
                }
            }

            // Check TP hit
            if (tpLevel !== undefined) {
                if (isPriceLevelHit(checkpoint.price, tpLevel, direction, false)) {
                    stats.firstTrigger = "TP";
                    stats.triggerBarIndex = barIndex;

                    return {
                        tpEvent: createTPTriggerEvent({
                            timestamp: checkpoint.timestamp,
                            barIndex,
                            triggerPrice: checkpoint.price,
                            entryPrice,
                            direction,
                            tradeId,
                            tpLevel,
                            subBarIndex: checkpoint.subBarIndex,
                            checkpointIndex: checkpoint.checkpointIndex,
                        }),
                        hasTriggger: true,
                        stats,
                    };
                }
            }
        }
    }

    // No trigger found within scan range
    return { hasTriggger: false, stats };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get price checkpoints for a bar.
 * Uses sub-bar candles if available, otherwise uses OHLC simulation.
 */
function getCheckpointsForBar(
    barIndex: number,
    candle: Candle,
    subBarCandlesMap?: Map<number, Candle[]>
): PriceCheckpoint[] {
    // Try sub-bar candles first
    if (subBarCandlesMap) {
        const subBarCandles = subBarCandlesMap.get(barIndex);
        if (subBarCandles && subBarCandles.length > 0) {
            return generatePriceCheckpoints(subBarCandles);
        }
    }

    // Fall back to OHLC simulation from parent candle
    const path = simulateSubBarPath(candle);
    const duration = 60; // Default to 60 seconds if unknown

    return path.map((price, i) => ({
        price,
        timestamp: candle.bucket + Math.floor((duration * i) / 4),
        subBarIndex: 0,
        checkpointIndex: i,
    }));
}

/**
 * Calculate SL level from config.
 */
function calculateSLLevel(
    entryPrice: number,
    config: ValueConfig,
    direction: Direction,
    factor: number
): number {
    return calculateTargetPrice(entryPrice, config, direction, true, factor);
}

/**
 * Calculate TP level from config.
 */
function calculateTPLevel(
    entryPrice: number,
    config: ValueConfig,
    direction: Direction,
    factor: number
): number {
    return calculateTargetPrice(entryPrice, config, direction, false, factor);
}

/**
 * Calculate trailing stop level from extreme price.
 */
function calculateTrailingLevel(
    extremePrice: number,
    config: ValueConfig,
    direction: Direction,
    factor: number
): number {
    // Trailing stop is calculated from peak price, not entry price
    return calculateTargetPrice(extremePrice, config, direction, true, factor);
}

/**
 * Update trailing state with new price.
 */
function updateTrailingState(
    state: TrailingState,
    price: number,
    direction: Direction,
    slConfig: ValueConfig
): void {
    // Update extreme if price moved favorably
    if (direction === "LONG" && price > state.extremePrice) {
        state.extremePrice = price;
        state.currentLevel = calculateTrailingLevel(price, slConfig, direction, 1);
    } else if (direction === "SHORT" && price < state.extremePrice) {
        state.extremePrice = price;
        state.currentLevel = calculateTrailingLevel(price, slConfig, direction, 1);
    }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick check if SL would trigger at a specific price.
 */
export function wouldSLTrigger(
    price: number,
    entryPrice: number,
    slConfig: ValueConfig,
    direction: Direction,
    factor: number = 1
): boolean {
    const slLevel = calculateSLLevel(entryPrice, slConfig, direction, factor);
    return isPriceLevelHit(price, slLevel, direction, true);
}

/**
 * Quick check if TP would trigger at a specific price.
 */
export function wouldTPTrigger(
    price: number,
    entryPrice: number,
    tpConfig: ValueConfig,
    direction: Direction,
    factor: number = 1
): boolean {
    const tpLevel = calculateTPLevel(entryPrice, tpConfig, direction, factor);
    return isPriceLevelHit(price, tpLevel, direction, false);
}

/**
 * Get SL/TP levels without scanning.
 * Useful for debugging and display.
 */
export function getLevels(
    entryPrice: number,
    slConfig?: ValueConfig,
    tpConfig?: ValueConfig,
    direction: Direction = "LONG",
    slFactor: number = 1,
    tpFactor: number = 1
): { slLevel?: number; tpLevel?: number } {
    return {
        slLevel: slConfig ? calculateSLLevel(entryPrice, slConfig, direction, slFactor) : undefined,
        tpLevel: tpConfig ? calculateTPLevel(entryPrice, tpConfig, direction, tpFactor) : undefined,
    };
}
