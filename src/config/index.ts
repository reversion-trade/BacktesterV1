/**
 * Configuration Module
 *
 * Central export point for configuration management.
 * Provides validation capabilities.
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
    AlgoParams,
    AlgoConfig,
    RunSettings,
    RunStatus,
    CreateAlgoConfigInput,
    CreateRunSettingsInput,
} from "./types.ts";

// =============================================================================
// VALIDATION
// =============================================================================

export { validateAlgoParams, validateAlgoConfig, validateRunSettings, validateBacktestSetup } from "./validation.ts";

export type { ValidationSeverity, ValidationIssue, ValidationResult } from "./validation.ts";
