/**
 * Configuration Validation
 *
 * @module config/validation
 * @description
 * Validates AlgoParams, AlgoConfig, and RunSettings for correctness.
 * Catches configuration errors before they cause runtime issues.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 4: Versioned Configuration)
 * - Purpose: Ensure configuration correctness
 */

import type {
  AlgoParams,
  AlgoConfig,
  RunSettings,
  EntryCondition,
  ExitCondition,
  ValueConfig,
} from "../core/types.ts";
import type { VersionedAlgoConfig, CreateRunSettingsInput } from "./types.ts";

// =============================================================================
// VALIDATION RESULT TYPES
// =============================================================================

/**
 * Severity of a validation issue.
 */
export type ValidationSeverity = "error" | "warning" | "info";

/**
 * A single validation issue.
 */
export interface ValidationIssue {
  /** Path to the problematic field */
  path: string;
  /** Severity level */
  severity: ValidationSeverity;
  /** Human-readable message */
  message: string;
  /** Error code for programmatic handling */
  code: string;
}

/**
 * Complete validation result.
 */
export interface ValidationResult {
  /** Whether the config is valid (no errors) */
  isValid: boolean;
  /** All issues found */
  issues: ValidationIssue[];
  /** Count by severity */
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Create a validation issue.
 */
function issue(
  path: string,
  severity: ValidationSeverity,
  message: string,
  code: string
): ValidationIssue {
  return { path, severity, message, code };
}

/**
 * Create an empty validation result.
 */
function emptyResult(): ValidationResult {
  return {
    isValid: true,
    issues: [],
    summary: { errors: 0, warnings: 0, infos: 0 },
  };
}

/**
 * Finalize a validation result.
 */
function finalizeResult(issues: ValidationIssue[]): ValidationResult {
  const summary = { errors: 0, warnings: 0, infos: 0 };
  for (const i of issues) {
    summary[`${i.severity}s` as keyof typeof summary]++;
  }

  return {
    isValid: summary.errors === 0,
    issues,
    summary,
  };
}

// =============================================================================
// VALUE CONFIG VALIDATION
// =============================================================================

/**
 * Validate a ValueConfig.
 */
function validateValueConfig(
  config: ValueConfig | undefined,
  path: string,
  required: boolean,
  issues: ValidationIssue[]
): void {
  if (!config) {
    if (required) {
      issues.push(issue(path, "error", "Value config is required", "REQUIRED_VALUE"));
    }
    return;
  }

  if (!["ABS", "REL", "DYN"].includes(config.type)) {
    issues.push(issue(`${path}.type`, "error", `Invalid value type: ${config.type}`, "INVALID_VALUE_TYPE"));
  }

  if (typeof config.value !== "number" || isNaN(config.value)) {
    issues.push(issue(`${path}.value`, "error", "Value must be a number", "INVALID_VALUE"));
  }

  if (config.type === "REL" && (config.value < 0 || config.value > 1)) {
    issues.push(issue(`${path}.value`, "warning", "REL value should be between 0 and 1 (percentage)", "REL_VALUE_RANGE"));
  }

  if (config.type === "ABS" && config.value < 0) {
    issues.push(issue(`${path}.value`, "error", "ABS value cannot be negative", "NEGATIVE_ABS_VALUE"));
  }

  if (config.type === "DYN" && !config.valueFactor) {
    issues.push(issue(`${path}.valueFactor`, "warning", "DYN type should have valueFactor for modulation", "MISSING_VALUE_FACTOR"));
  }
}

// =============================================================================
// CONDITION VALIDATION
// =============================================================================

/**
 * Validate an EntryCondition.
 */
function validateEntryCondition(
  condition: EntryCondition | undefined,
  path: string,
  required: boolean,
  issues: ValidationIssue[]
): void {
  if (!condition) {
    if (required) {
      issues.push(issue(path, "error", "Entry condition is required", "REQUIRED_CONDITION"));
    }
    return;
  }

  if (!condition.required || condition.required.length === 0) {
    issues.push(issue(`${path}.required`, "error", "At least one required indicator is needed", "NO_REQUIRED_INDICATORS"));
  }

  // Validate each indicator has a type
  condition.required?.forEach((ind, idx) => {
    if (!ind.type) {
      issues.push(issue(`${path}.required[${idx}].type`, "error", "Indicator type is required", "MISSING_INDICATOR_TYPE"));
    }
  });

  condition.optional?.forEach((ind, idx) => {
    if (!ind.type) {
      issues.push(issue(`${path}.optional[${idx}].type`, "error", "Indicator type is required", "MISSING_INDICATOR_TYPE"));
    }
  });
}

/**
 * Validate an ExitCondition.
 */
function validateExitCondition(
  condition: ExitCondition | undefined,
  path: string,
  required: boolean,
  issues: ValidationIssue[]
): void {
  if (!condition) {
    if (required) {
      issues.push(issue(path, "error", "Exit condition is required", "REQUIRED_CONDITION"));
    }
    return;
  }

  // Exit can have no signal indicators if using SL/TP
  const hasSignalIndicators = (condition.required?.length ?? 0) > 0 || (condition.optional?.length ?? 0) > 0;
  const hasSLTP = condition.stopLoss || condition.takeProfit;

  if (!hasSignalIndicators && !hasSLTP) {
    issues.push(issue(path, "warning", "Exit has no indicators and no SL/TP - will never exit", "NO_EXIT_MECHANISM"));
  }

  // Validate SL/TP
  if (condition.stopLoss) {
    validateValueConfig(condition.stopLoss, `${path}.stopLoss`, false, issues);
  }

  if (condition.takeProfit) {
    validateValueConfig(condition.takeProfit, `${path}.takeProfit`, false, issues);
  }

  if (condition.trailingSL && !condition.stopLoss) {
    issues.push(issue(`${path}.trailingSL`, "error", "Trailing SL requires stopLoss to be set", "TRAILING_WITHOUT_SL"));
  }

  // Validate indicators
  condition.required?.forEach((ind, idx) => {
    if (!ind.type) {
      issues.push(issue(`${path}.required[${idx}].type`, "error", "Indicator type is required", "MISSING_INDICATOR_TYPE"));
    }
  });
}

// =============================================================================
// ALGO PARAMS VALIDATION
// =============================================================================

/**
 * Validate AlgoParams.
 */
export function validateAlgoParams(params: AlgoParams): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate type
  if (!["LONG", "SHORT", "BOTH"].includes(params.type)) {
    issues.push(issue("type", "error", `Invalid algo type: ${params.type}`, "INVALID_ALGO_TYPE"));
  }

  // Validate conditions based on type
  if (params.type === "LONG" || params.type === "BOTH") {
    validateEntryCondition(params.longEntry, "longEntry", true, issues);
    validateExitCondition(params.longExit, "longExit", true, issues);
  }

  if (params.type === "SHORT" || params.type === "BOTH") {
    validateEntryCondition(params.shortEntry, "shortEntry", true, issues);
    validateExitCondition(params.shortExit, "shortExit", true, issues);
  }

  // Validate position size
  validateValueConfig(params.positionSize, "positionSize", true, issues);

  // Validate order type
  if (!["MARKET", "TWAP", "SMART", "LIMIT"].includes(params.orderType)) {
    issues.push(issue("orderType", "error", `Invalid order type: ${params.orderType}`, "INVALID_ORDER_TYPE"));
  }

  // Validate starting capital
  if (typeof params.startingCapitalUSD !== "number" || params.startingCapitalUSD <= 0) {
    issues.push(issue("startingCapitalUSD", "error", "Starting capital must be positive", "INVALID_CAPITAL"));
  }

  // Check for ABS SL/TP without coinSymbol
  const needsSymbol =
    params.longExit?.stopLoss?.type === "ABS" ||
    params.longExit?.takeProfit?.type === "ABS" ||
    params.shortExit?.stopLoss?.type === "ABS" ||
    params.shortExit?.takeProfit?.type === "ABS";

  if (needsSymbol && !params.coinSymbol) {
    issues.push(issue("coinSymbol", "warning", "coinSymbol recommended when using ABS stop loss/take profit", "MISSING_COIN_SYMBOL"));
  }

  return finalizeResult(issues);
}

// =============================================================================
// ALGO CONFIG VALIDATION
// =============================================================================

/**
 * Validate AlgoConfig (includes AlgoParams validation).
 */
export function validateAlgoConfig(config: AlgoConfig | VersionedAlgoConfig): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate metadata
  if (!config.userID || config.userID.trim() === "") {
    issues.push(issue("userID", "error", "User ID is required", "MISSING_USER_ID"));
  }

  if (!config.algoID || config.algoID.trim() === "") {
    issues.push(issue("algoID", "error", "Algo ID is required", "MISSING_ALGO_ID"));
  }

  if (!config.algoName || config.algoName.trim() === "") {
    issues.push(issue("algoName", "error", "Algo name is required", "MISSING_ALGO_NAME"));
  }

  if (typeof config.version !== "number" || config.version < 1) {
    issues.push(issue("version", "error", "Version must be a positive integer", "INVALID_VERSION"));
  }

  // Validate params
  const paramsResult = validateAlgoParams(config.params);
  for (const i of paramsResult.issues) {
    issues.push({
      ...i,
      path: `params.${i.path}`,
    });
  }

  return finalizeResult(issues);
}

// =============================================================================
// RUN SETTINGS VALIDATION
// =============================================================================

/**
 * Validate RunSettings.
 */
export function validateRunSettings(
  settings: RunSettings | CreateRunSettingsInput,
  algoConfig?: AlgoConfig
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate required fields
  if (!settings.userID || settings.userID.trim() === "") {
    issues.push(issue("userID", "error", "User ID is required", "MISSING_USER_ID"));
  }

  if (!settings.algoID || settings.algoID.trim() === "") {
    issues.push(issue("algoID", "error", "Algo ID is required", "MISSING_ALGO_ID"));
  }

  if (!settings.exchangeID || settings.exchangeID.trim() === "") {
    issues.push(issue("exchangeID", "error", "Exchange ID is required", "MISSING_EXCHANGE_ID"));
  }

  // Validate backtest requirements
  if (settings.isBacktest) {
    if (!settings.startTime) {
      issues.push(issue("startTime", "error", "Start time is required for backtest", "MISSING_START_TIME"));
    }
    if (!settings.endTime) {
      issues.push(issue("endTime", "error", "End time is required for backtest", "MISSING_END_TIME"));
    }
    if (settings.startTime && settings.endTime && settings.startTime >= settings.endTime) {
      issues.push(issue("endTime", "error", "End time must be after start time", "INVALID_TIME_RANGE"));
    }
  }

  // Validate capital scaler
  const scaler = (settings as RunSettings).capitalScaler ?? settings.capitalScaler ?? 1;
  if (scaler <= 0) {
    issues.push(issue("capitalScaler", "error", "Capital scaler must be positive", "INVALID_SCALER"));
  }
  if (scaler > 10) {
    issues.push(issue("capitalScaler", "warning", "Capital scaler > 10 may indicate a mistake", "HIGH_SCALER"));
  }

  // Validate coin symbol consistency
  if (algoConfig && algoConfig.params.coinSymbol) {
    const settingsSymbol = (settings as RunSettings).coinSymbol ?? settings.coinSymbol;
    if (settingsSymbol && settingsSymbol !== algoConfig.params.coinSymbol) {
      issues.push(issue("coinSymbol", "warning", "Coin symbol differs from AlgoConfig (will use AlgoConfig value)", "SYMBOL_MISMATCH"));
    }
  }

  return finalizeResult(issues);
}

// =============================================================================
// COMBINED VALIDATION
// =============================================================================

/**
 * Validate everything needed for a backtest run.
 */
export function validateBacktestSetup(
  config: AlgoConfig | VersionedAlgoConfig,
  settings: RunSettings | CreateRunSettingsInput
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Validate config
  const configResult = validateAlgoConfig(config);
  for (const i of configResult.issues) {
    issues.push({
      ...i,
      path: `config.${i.path}`,
    });
  }

  // Validate settings
  const settingsResult = validateRunSettings(settings, config);
  for (const i of settingsResult.issues) {
    issues.push({
      ...i,
      path: `settings.${i.path}`,
    });
  }

  // Cross-validation
  if (settings.algoID !== config.algoID) {
    issues.push(issue("settings.algoID", "error", "Settings algoID doesn't match config", "ALGO_ID_MISMATCH"));
  }

  return finalizeResult(issues);
}
