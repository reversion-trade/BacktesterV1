/**
 * Stage 4: Algo State Initialization
 *
 * @module simulation/stages/initialization
 * @description
 * Fourth stage in the backtester pipeline. Responsible for:
 * - Initializing the EventCollector with indicator metadata
 * - Setting up initial algo state (FLAT or in-position)
 * - Preparing special indicator factories
 * - Creating the initial simulation context
 *
 * @architecture
 * This stage bridges the pre-computation phases (Stages 1-3) with
 * the simulation loop (Stage 5). It ensures all state is properly
 * initialized before the forward pass begins.
 *
 * Input: DataLoadingResult + ResamplingResult
 * Output: InitializationResult with ready-to-use simulation state
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 2: Modularize Architecture)
 * - Purpose: Extract initialization logic from runSimulation()
 * - Handles assumePositionImmediately flag from RunSettings
 * - Follows architecture principle: "Stages should be separate and explicit"
 */

import type {
  AlgoParams,
  Direction,
  PositionState,
  EntryCondition,
  ExitCondition,
} from "../../core/types.ts";
import type { BacktestInput } from "../../core/config.ts";
import { makeIndicator } from "@indicators/factory.ts";
import {
  EventCollector,
  type IndicatorInfo,
  type ConditionType,
} from "../../events/index.ts";
import type { DataLoadingResult } from "./data-loading.ts";
import type { ResamplingResult } from "./resampling.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of Stage 4: Algo State Initialization
 *
 * Contains initialized state ready for simulation loop.
 */
export interface InitializationResult {
  /** Initialized EventCollector with registered indicators */
  collector: EventCollector;

  /** Map of indicator keys to their metadata */
  indicatorInfoMap: Map<string, IndicatorInfo>;

  /** Initial position state */
  initialState: PositionState;

  /** Initial capital in USD */
  initialCapital: number;

  /** Whether to assume position immediately on first signal */
  assumePositionImmediately: boolean;

  /** Whether to close position at end of backtest */
  closePositionOnExit: boolean;

  /** Maximum number of trades (optional) */
  tradesLimit?: number;

  /** Fee in basis points */
  feeBps: number;

  /** Slippage in basis points */
  slippageBps: number;

  /** Asset symbol being traded */
  symbol: string;

  /** Number of warmup bars to skip */
  warmupBars: number;

  /** Algo parameters for the simulation */
  algoParams: AlgoParams;
}

/**
 * Input for Stage 4.
 */
export interface InitializationInput {
  /** Result from Stage 1 */
  dataResult: DataLoadingResult;

  /** Result from Stage 3 (for warmup info) */
  resamplingResult: ResamplingResult;
}

// =============================================================================
// STAGE 4: INITIALIZATION
// =============================================================================

/**
 * Execute Stage 4: Initialize algo state for simulation.
 *
 * @param input - Initialization input (data result + resampling result)
 * @returns InitializationResult with ready simulation state
 *
 * @example
 * ```typescript
 * const initResult = executeInitialization({
 *   dataResult,
 *   resamplingResult,
 * });
 *
 * // Now ready for Stage 5 (simulation loop)
 * const collector = initResult.collector;
 * const initialState = initResult.initialState;
 * ```
 *
 * @audit-note
 * The EventCollector is created here with full indicator registration.
 * This ensures consistent event tracking throughout the simulation.
 */
export function executeInitialization(
  input: InitializationInput
): InitializationResult {
  const { dataResult, resamplingResult } = input;
  const { validatedInput, initialCapital } = dataResult;
  const { algoConfig, runSettings, feeBps, slippageBps } = validatedInput;

  // Step 1: Build indicator info map from algo parameters
  const indicatorInfoMap = buildIndicatorInfoMap(algoConfig.params);

  // Step 2: Initialize EventCollector
  const collector = new EventCollector(runSettings.coinSymbol);
  collector.registerIndicators(Array.from(indicatorInfoMap.values()));

  // Step 3: Determine initial state
  // Currently always start FLAT; assumePositionImmediately affects edge detection
  const initialState: PositionState = "FLAT";

  // Step 4: Extract run settings
  const assumePositionImmediately = runSettings.assumePositionImmediately ?? false;
  const closePositionOnExit = runSettings.closePositionOnExit ?? true;
  const tradesLimit = runSettings.tradesLimit;

  return {
    collector,
    indicatorInfoMap,
    initialState,
    initialCapital,
    assumePositionImmediately,
    closePositionOnExit,
    tradesLimit,
    feeBps,
    slippageBps,
    symbol: runSettings.coinSymbol,
    warmupBars: resamplingResult.warmupBars,
    algoParams: algoConfig.params,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build indicator info map from algo parameters.
 *
 * Maps each indicator's cache key to its metadata (type, condition, required status).
 *
 * @param algoParams - Algorithm parameters
 * @returns Map of indicator key → IndicatorInfo
 *
 * @audit-note
 * This function is extracted from loop.ts buildIndicatorInfoMap() to enable
 * testing and reuse. The logic is identical.
 */
export function buildIndicatorInfoMap(
  algoParams: AlgoParams
): Map<string, IndicatorInfo> {
  const infoMap = new Map<string, IndicatorInfo>();

  const processCondition = (
    condition: EntryCondition | ExitCondition | undefined,
    conditionType: ConditionType
  ) => {
    if (!condition) return;

    for (const config of condition.required) {
      const indicator = makeIndicator(config);
      const indicatorKey = indicator.getCacheKey();
      // Use composite key: conditionType + indicatorKey
      // This allows the same indicator to be used for multiple conditions
      const mapKey = `${conditionType}:${indicatorKey}`;
      infoMap.set(mapKey, {
        indicatorKey,
        indicatorType: config.type,
        conditionType,
        isRequired: true,
      });
    }

    for (const config of condition.optional) {
      const indicator = makeIndicator(config);
      const indicatorKey = indicator.getCacheKey();
      // Use composite key: conditionType + indicatorKey
      const mapKey = `${conditionType}:${indicatorKey}`;
      infoMap.set(mapKey, {
        indicatorKey,
        indicatorType: config.type,
        conditionType,
        isRequired: false,
      });
    }
  };

  processCondition(algoParams.longEntry, "LONG_ENTRY");
  processCondition(algoParams.longExit, "LONG_EXIT");
  processCondition(algoParams.shortEntry, "SHORT_ENTRY");
  processCondition(algoParams.shortExit, "SHORT_EXIT");

  return infoMap;
}

/**
 * Get all indicator keys from the info map.
 *
 * @param indicatorInfoMap - Map from buildIndicatorInfoMap()
 * @returns Array of indicator cache keys
 */
export function getIndicatorKeys(
  indicatorInfoMap: Map<string, IndicatorInfo>
): string[] {
  return Array.from(indicatorInfoMap.keys());
}

/**
 * Get indicators for a specific condition type.
 *
 * @param indicatorInfoMap - Map from buildIndicatorInfoMap()
 * @param conditionType - Condition type to filter by
 * @returns Array of IndicatorInfo for that condition
 */
export function getIndicatorsForCondition(
  indicatorInfoMap: Map<string, IndicatorInfo>,
  conditionType: ConditionType
): IndicatorInfo[] {
  return Array.from(indicatorInfoMap.values()).filter(
    (info) => info.conditionType === conditionType
  );
}

/**
 * Get required indicator count for a condition.
 *
 * @param indicatorInfoMap - Map from buildIndicatorInfoMap()
 * @param conditionType - Condition type to check
 * @returns Count of required indicators
 */
export function getRequiredIndicatorCount(
  indicatorInfoMap: Map<string, IndicatorInfo>,
  conditionType: ConditionType
): number {
  return getIndicatorsForCondition(indicatorInfoMap, conditionType).filter(
    (info) => info.isRequired
  ).length;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate initialization result.
 *
 * @param result - Initialization result to validate
 * @returns Validation report
 */
export function validateInitializationResult(result: InitializationResult): {
  isValid: boolean;
  issues: string[];
  summary: {
    indicatorCount: number;
    longEntryIndicators: number;
    longExitIndicators: number;
    shortEntryIndicators: number;
    shortExitIndicators: number;
    initialCapital: number;
    warmupBars: number;
  };
} {
  const issues: string[] = [];

  // Check initial capital
  if (result.initialCapital <= 0) {
    issues.push(`Invalid initial capital: ${result.initialCapital}`);
  }

  // Check warmup
  if (result.warmupBars < 0) {
    issues.push(`Invalid warmup bars: ${result.warmupBars}`);
  }

  // Check fees
  if (result.feeBps < 0) {
    issues.push(`Invalid fee bps: ${result.feeBps}`);
  }

  if (result.slippageBps < 0) {
    issues.push(`Invalid slippage bps: ${result.slippageBps}`);
  }

  // Check algo type consistency
  const { algoParams } = result;
  if (algoParams.type === "LONG" && !algoParams.longEntry) {
    issues.push("Algo type is LONG but no longEntry condition defined");
  }
  if (algoParams.type === "SHORT" && !algoParams.shortEntry) {
    issues.push("Algo type is SHORT but no shortEntry condition defined");
  }
  if (algoParams.type === "BOTH") {
    if (!algoParams.longEntry && !algoParams.shortEntry) {
      issues.push("Algo type is BOTH but no entry conditions defined");
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    summary: {
      indicatorCount: result.indicatorInfoMap.size,
      longEntryIndicators: getIndicatorsForCondition(result.indicatorInfoMap, "LONG_ENTRY").length,
      longExitIndicators: getIndicatorsForCondition(result.indicatorInfoMap, "LONG_EXIT").length,
      shortEntryIndicators: getIndicatorsForCondition(result.indicatorInfoMap, "SHORT_ENTRY").length,
      shortExitIndicators: getIndicatorsForCondition(result.indicatorInfoMap, "SHORT_EXIT").length,
      initialCapital: result.initialCapital,
      warmupBars: result.warmupBars,
    },
  };
}
