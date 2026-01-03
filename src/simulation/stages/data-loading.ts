/**
 * Stage 1: Data Loading
 *
 * @module simulation/stages/data-loading
 * @description
 * First stage in the backtester pipeline. Responsible for:
 * - Validating and parsing backtest configuration
 * - Filtering candle data to the requested time range
 * - Extracting data requirements from algo configuration
 *
 * @architecture
 * This is a pure function stage with no side effects.
 * Input: Raw candles + BacktestInput
 * Output: DataLoadingResult containing validated config and filtered candles
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Purpose: Extract data loading logic from index.ts into explicit stage
 * - Follows architecture principle: "Stages should be separate and explicit"
 */

import type { Candle, AlgoParams } from "../../core/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import { BacktestInputSchema } from "../../core/config.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of Stage 1: Data Loading
 *
 * Contains all data needed for subsequent stages.
 */
export interface DataLoadingResult {
  /** Validated and parsed backtest input */
  validatedInput: BacktestInput;

  /** Candles filtered to the requested time range */
  filteredCandles: Candle[];

  /** Actual start time (first candle timestamp) */
  actualStartTime: number;

  /** Actual end time (last candle timestamp) */
  actualEndTime: number;

  /** Computed initial capital (base * scaler) */
  initialCapital: number;

  /** Whether the result is empty (no candles in range) */
  isEmpty: boolean;
}

/**
 * Data requirements extracted from algo configuration.
 * Used for determining what data needs to be loaded.
 */
export interface DataRequirements {
  /** Required symbols (currently single symbol) */
  symbols: string[];

  /** Required timeframes based on indicator configurations */
  timeframes: string[];

  /** Start timestamp */
  startTime: number;

  /** End timestamp */
  endTime: number;

  /** Estimated warmup period in candles */
  estimatedWarmupCandles: number;
}

// =============================================================================
// STAGE 1: DATA LOADING
// =============================================================================

/**
 * Execute Stage 1: Load and validate data.
 *
 * @param candles - Raw historical price data (typically 1m candles)
 * @param input - Backtest input configuration
 * @returns DataLoadingResult with validated config and filtered candles
 *
 * @example
 * ```typescript
 * const result = executeDataLoading(candles, input);
 * if (result.isEmpty) {
 *   return createEmptyOutput();
 * }
 * // Continue to Stage 2...
 * ```
 */
export function executeDataLoading(
  candles: Candle[],
  input: BacktestInput
): DataLoadingResult {
  // Step 1: Validate input schema
  const validatedInput = BacktestInputSchema.parse(input);
  const { algoConfig, runSettings } = validatedInput;

  // Step 2: Filter candles to requested time range
  const filteredCandles = filterCandlesToRange(
    candles,
    runSettings.startTime!,
    runSettings.endTime!
  );

  // Step 3: Determine actual time bounds
  const isEmpty = filteredCandles.length === 0;
  const actualStartTime = isEmpty
    ? runSettings.startTime!
    : filteredCandles[0]!.bucket;
  const actualEndTime = isEmpty
    ? runSettings.endTime!
    : filteredCandles[filteredCandles.length - 1]!.bucket;

  // Step 4: Calculate initial capital
  const initialCapital =
    algoConfig.params.startingCapitalUSD * runSettings.capitalScaler;

  return {
    validatedInput,
    filteredCandles,
    actualStartTime,
    actualEndTime,
    initialCapital,
    isEmpty,
  };
}

/**
 * Filter candles to a specific time range.
 *
 * @param candles - All available candles
 * @param startTime - Start timestamp (inclusive)
 * @param endTime - End timestamp (inclusive)
 * @returns Candles within the time range
 */
export function filterCandlesToRange(
  candles: Candle[],
  startTime: number,
  endTime: number
): Candle[] {
  return candles.filter((c) => c.bucket >= startTime && c.bucket <= endTime);
}

/**
 * Extract data requirements from algo configuration.
 *
 * Used for determining what data needs to be loaded before
 * the backtest can run. This supports future optimizations
 * where we load only required data.
 *
 * @param algoParams - Algorithm parameters
 * @param runSettings - Run settings with time range
 * @returns Data requirements specification
 */
export function extractDataRequirements(
  algoParams: AlgoParams,
  startTime: number,
  endTime: number
): DataRequirements {
  // Extract timeframes from all indicator configurations
  const timeframes = new Set<string>();
  const processCondition = (condition: { required: any[]; optional: any[] } | undefined) => {
    if (!condition) return;
    for (const config of [...condition.required, ...condition.optional]) {
      if (config.timeframe) {
        timeframes.add(config.timeframe);
      }
    }
  };

  processCondition(algoParams.longEntry);
  processCondition(algoParams.longExit);
  processCondition(algoParams.shortEntry);
  processCondition(algoParams.shortExit);

  // Default to 1m if no timeframes specified
  if (timeframes.size === 0) {
    timeframes.add("1m");
  }

  // Estimate warmup based on indicator periods
  // This is a rough estimate; actual warmup is calculated during indicator computation
  const estimatedWarmupCandles = estimateWarmupPeriod(algoParams);

  return {
    symbols: [], // Symbol comes from runSettings, not algoParams
    timeframes: Array.from(timeframes),
    startTime,
    endTime,
    estimatedWarmupCandles,
  };
}

/**
 * Estimate warmup period from algo parameters.
 *
 * Scans all indicator configurations to find the maximum period
 * that would require warmup data.
 *
 * @param algoParams - Algorithm parameters
 * @returns Estimated warmup candles needed
 */
function estimateWarmupPeriod(algoParams: AlgoParams): number {
  let maxPeriod = 0;

  const scanCondition = (condition: { required: any[]; optional: any[] } | undefined) => {
    if (!condition) return;
    for (const config of [...condition.required, ...condition.optional]) {
      // Look for period-like parameters
      if (typeof config.period === "number") {
        maxPeriod = Math.max(maxPeriod, config.period);
      }
      if (typeof config.fastPeriod === "number") {
        maxPeriod = Math.max(maxPeriod, config.fastPeriod);
      }
      if (typeof config.slowPeriod === "number") {
        maxPeriod = Math.max(maxPeriod, config.slowPeriod);
      }
      if (typeof config.signalPeriod === "number") {
        maxPeriod = Math.max(maxPeriod, config.signalPeriod);
      }
    }
  };

  scanCondition(algoParams.longEntry);
  scanCondition(algoParams.longExit);
  scanCondition(algoParams.shortEntry);
  scanCondition(algoParams.shortExit);

  // Add buffer for indicator calculations
  return Math.max(maxPeriod * 2, 50);
}
