/**
 * Stage 2: Indicator Pre-Calculation
 *
 * @module simulation/stages/indicator-calculation
 * @description
 * Second stage in the backtester pipeline. Responsible for:
 * - Extracting indicator configurations from algo parameters
 * - Pre-calculating all indicator signals over the entire dataset
 * - Determining warmup periods for each indicator
 * - Building the signal cache for simulation consumption
 *
 * @architecture
 * This stage performs the "expensive" computation upfront.
 * All indicators are calculated once before simulation begins.
 * Input: DataLoadingResult (from Stage 1)
 * Output: IndicatorCalculationResult with signal cache
 *
 * @performance
 * - Indicators are deduplicated by cache key (same indicator in multiple
 *   conditions is only calculated once)
 * - This is CPU-intensive; runtime scales with indicator count and data size
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Purpose: Extract indicator calculation from runBacktestWithEvents()
 * - Wraps existing calculator.ts functions in explicit stage interface
 * - Follows architecture principle: "Stages should be separate and explicit"
 */

import type { Candle, AlgoParams, IndicatorConfig } from "../../core/types.ts";
import type { SignalCache, CalculationResult } from "../../indicators/calculator.ts";
import { calculateIndicators, collectIndicatorConfigs } from "../../indicators/calculator.ts";
import type { DataLoadingResult } from "./data-loading.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of Stage 2: Indicator Pre-Calculation
 *
 * Contains pre-calculated signals ready for simulation or resampling.
 */
export interface IndicatorCalculationResult {
    /** Pre-calculated signal cache keyed by indicator cache key */
    signalCache: SignalCache;

    /** Maximum warmup period across all indicators (in candles) */
    warmupCandles: number;

    /** All indicator configurations extracted from algo params */
    indicatorConfigs: IndicatorConfig[];

    /** Number of unique indicators (after deduplication) */
    uniqueIndicatorCount: number;

    /** Indicator cache keys for debugging/auditing */
    indicatorKeys: string[];
}

/**
 * Input for Stage 2.
 * Can be constructed from Stage 1 result or manually for testing.
 */
export interface IndicatorCalculationInput {
    /** Candles to calculate indicators over */
    candles: Candle[];

    /** Algorithm parameters containing indicator configs */
    algoParams: AlgoParams;
}

// =============================================================================
// STAGE 2: INDICATOR PRE-CALCULATION
// =============================================================================

/**
 * Execute Stage 2: Pre-calculate all indicator signals.
 *
 * @param input - Indicator calculation input (candles + algo params)
 * @returns IndicatorCalculationResult with signal cache and metadata
 *
 * @example
 * ```typescript
 * // From Stage 1 result:
 * const indicatorResult = executeIndicatorCalculation({
 *   candles: dataResult.filteredCandles,
 *   algoParams: dataResult.validatedInput.algoConfig.params,
 * });
 *
 * // Signals are now ready for Stage 3 (resampling)
 * const rsiSignals = indicatorResult.signalCache.get("rsi:14:close:60");
 * ```
 *
 * @audit-note
 * This function wraps the existing calculateIndicators() from calculator.ts.
 * It adds metadata tracking for auditability (config count, key list, etc.).
 */
export function executeIndicatorCalculation(input: IndicatorCalculationInput): IndicatorCalculationResult {
    const { candles, algoParams } = input;

    // Step 1: Extract all indicator configs from algo parameters
    const indicatorConfigs = collectIndicatorConfigs(algoParams);

    // Step 2: Calculate all indicators (deduplication happens internally)
    const { signals: signalCache, warmupCandles } = calculateIndicators(candles, indicatorConfigs);

    // Step 3: Gather metadata for auditing
    const indicatorKeys = signalCache.keys();
    const uniqueIndicatorCount = indicatorKeys.length;

    return {
        signalCache,
        warmupCandles,
        indicatorConfigs,
        uniqueIndicatorCount,
        indicatorKeys,
    };
}

/**
 * Create IndicatorCalculationInput from DataLoadingResult.
 *
 * Convenience function for stage chaining.
 *
 * @param dataResult - Result from Stage 1
 * @returns Input for Stage 2
 */
export function createIndicatorInputFromDataResult(dataResult: DataLoadingResult): IndicatorCalculationInput {
    return {
        candles: dataResult.filteredCandles,
        algoParams: dataResult.validatedInput.algoConfig.params,
    };
}

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validate indicator calculation result.
 *
 * Used for debugging and ensuring calculation integrity.
 *
 * @param result - Indicator calculation result to validate
 * @returns Validation report
 */
export function validateIndicatorResult(result: IndicatorCalculationResult): {
    isValid: boolean;
    issues: string[];
    summary: {
        configCount: number;
        uniqueCount: number;
        warmupCandles: number;
        duplicatesRemoved: number;
    };
} {
    const issues: string[] = [];

    // Check for empty results
    if (result.indicatorConfigs.length === 0) {
        issues.push("No indicator configurations found");
    }

    // Check signal cache consistency
    for (const key of result.indicatorKeys) {
        const signals = result.signalCache.get(key);
        if (!signals) {
            issues.push(`Missing signals for key: ${key}`);
        } else if (signals.length === 0) {
            issues.push(`Empty signal array for key: ${key}`);
        }
    }

    // Check warmup is reasonable
    if (result.warmupCandles < 0) {
        issues.push(`Invalid warmup candles: ${result.warmupCandles}`);
    }

    return {
        isValid: issues.length === 0,
        issues,
        summary: {
            configCount: result.indicatorConfigs.length,
            uniqueCount: result.uniqueIndicatorCount,
            warmupCandles: result.warmupCandles,
            duplicatesRemoved: result.indicatorConfigs.length - result.uniqueIndicatorCount,
        },
    };
}

/**
 * Get indicator signal at a specific candle index.
 *
 * Utility for debugging and verification.
 *
 * @param signalCache - The signal cache
 * @param key - Indicator cache key
 * @param barIndex - Candle index
 * @returns Signal value or undefined if not found
 */
export function getSignalAtBar(signalCache: SignalCache, key: string, barIndex: number): boolean | undefined {
    const signals = signalCache.get(key);
    if (!signals || barIndex < 0 || barIndex >= signals.length) {
        return undefined;
    }
    return signals[barIndex];
}
