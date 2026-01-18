/**
 * Stage 1.5: Sub-Bar Data Loading
 *
 * @module simulation/stages/subbar-loading
 * @description
 * Pre-fetches lower-timeframe candles for accurate SL/TP simulation.
 * Runs after Stage 1 (Data Loading) and can run in parallel with Stage 2.
 *
 * Sub-bar candles provide granular price paths within each parent bar,
 * enabling accurate SL/TP trigger detection using "nearest extreme" logic.
 *
 * @architecture
 * - 5m parent → 5× 1m sub-bars (5 × 4 = 20 price checkpoints per bar)
 * - 15m parent → 3× 5m sub-bars
 * - 1h parent → 4× 15m sub-bars
 * - 4h parent → 4× 1h sub-bars
 * - 1d parent → 6× 4h sub-bars
 *
 * @audit-trail
 * - Created: 2026-01-08 (Sub-Bar Simulation Feature)
 * - Purpose: Mandatory sub-bar data loading for accurate SL/TP simulation
 */

import type { Candle } from "../../core/types.ts";
import type { ISubBarDataProvider } from "../../interfaces/subbar-data-provider.ts";
import {
    isSubBarSupported,
    getSubBarTimeframe,
    getSubBarCount,
} from "../../interfaces/subbar-data-provider.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of Stage 1.5: Sub-Bar Loading
 */
export interface SubBarLoadingResult {
    /** Map of parent bar timestamp → sub-bar candles */
    subBarCandlesMap: Map<number, Candle[]>;

    /** The sub-bar timeframe used (e.g., "1m" for 5m parent) */
    subBarTimeframe: string;

    /** Parent timeframe */
    parentTimeframe: string;

    /** Total number of sub-bars loaded */
    totalSubBarsLoaded: number;

    /** Number of parent bars with sub-bar data */
    parentBarsWithData: number;

    /** Whether sub-bar simulation is available for this timeframe */
    isSupported: boolean;
}

/**
 * Input for Stage 1.5
 */
export interface SubBarLoadingInput {
    /** Filtered candles from Stage 1 */
    filteredCandles: Candle[];

    /** Symbol being backtested */
    symbol: string;

    /** Parent timeframe (e.g., "5m", "1h") */
    parentTimeframe: string;

    /** Sub-bar data provider */
    subBarProvider: ISubBarDataProvider;
}

// =============================================================================
// STAGE 1.5: SUB-BAR LOADING
// =============================================================================

/**
 * Execute Stage 1.5: Load sub-bar candles for all parent bars.
 *
 * This stage batch-fetches all sub-bar candles needed for the backtest.
 * Pre-loading is more efficient than fetching during simulation.
 *
 * @param input - Sub-bar loading input
 * @returns SubBarLoadingResult with all sub-bar data
 *
 * @example
 * ```typescript
 * const subBarResult = await executeSubBarLoading({
 *   filteredCandles: dataResult.filteredCandles,
 *   symbol: "BTC",
 *   parentTimeframe: "5m",
 *   subBarProvider: apiSubBarProvider,
 * });
 * // subBarResult.subBarCandlesMap.get(parentTimestamp) → sub-bar candles
 * ```
 */
export function executeSubBarLoading(input: SubBarLoadingInput): SubBarLoadingResult {
    const { filteredCandles, symbol, parentTimeframe, subBarProvider } = input;

    // Check if sub-bar simulation is supported for this timeframe
    if (!isSubBarSupported(parentTimeframe)) {
        return createUnsupportedResult(parentTimeframe);
    }

    const subBarTimeframe = getSubBarTimeframe(parentTimeframe)!;

    // Extract all parent bar timestamps
    const parentTimestamps = filteredCandles.map((c) => c.bucket);

    // Batch fetch all sub-bar candles
    const subBarCandlesMap = subBarProvider.getSubBarCandlesBatch(
        symbol,
        parentTimestamps,
        parentTimeframe
    );

    // Calculate statistics
    let totalSubBarsLoaded = 0;
    let parentBarsWithData = 0;

    for (const [_timestamp, subBars] of subBarCandlesMap) {
        if (subBars.length > 0) {
            totalSubBarsLoaded += subBars.length;
            parentBarsWithData++;
        }
    }

    return {
        subBarCandlesMap,
        subBarTimeframe,
        parentTimeframe,
        totalSubBarsLoaded,
        parentBarsWithData,
        isSupported: true,
    };
}

/**
 * Create result for unsupported timeframes.
 *
 * For timeframes without sub-bar support (e.g., 1m), return empty result.
 * The simulation will fall back to parent bar OHLC for SL/TP checking.
 */
function createUnsupportedResult(parentTimeframe: string): SubBarLoadingResult {
    return {
        subBarCandlesMap: new Map(),
        subBarTimeframe: "",
        parentTimeframe,
        totalSubBarsLoaded: 0,
        parentBarsWithData: 0,
        isSupported: false,
    };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get sub-bar candles for a specific parent bar.
 *
 * Returns empty array if no sub-bars are available.
 */
export function getSubBarsForParent(
    subBarResult: SubBarLoadingResult,
    parentTimestamp: number
): Candle[] {
    return subBarResult.subBarCandlesMap.get(parentTimestamp) ?? [];
}

/**
 * Calculate expected number of sub-bars per parent bar.
 */
export function getExpectedSubBarCount(parentTimeframe: string): number {
    return getSubBarCount(parentTimeframe);
}

/**
 * Check if sub-bar data is available for a parent bar.
 */
export function hasSubBarsForParent(
    subBarResult: SubBarLoadingResult,
    parentTimestamp: number
): boolean {
    const subBars = subBarResult.subBarCandlesMap.get(parentTimestamp);
    return subBars !== undefined && subBars.length > 0;
}

