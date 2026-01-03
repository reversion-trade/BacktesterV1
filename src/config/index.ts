/**
 * Configuration Module
 *
 * @module config
 * @description
 * Central export point for configuration management.
 * Provides version management, validation, and comparison capabilities.
 *
 * @architecture
 * Three-Level Configuration:
 * 1. AlgoParams - Pure algorithm definition (immutable)
 * 2. AlgoConfig - AlgoParams + metadata (versioned)
 * 3. RunSettings - Runtime configuration (per-run)
 *
 * > "AlgoParams are read-only - new versions must be created for changes"
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 4: Versioned Configuration)
 * - Purpose: Provide clean exports for config management
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  // Core types (re-exported from core/types)
  AlgoParams,
  AlgoConfig,
  RunSettings,
  RunStatus,
  // Enhanced types
  VersionedAlgoConfig,
  CreateAlgoConfigInput,
  UpdateAlgoConfigInput,
  TrackedRunSettings,
  CreateRunSettingsInput,
  VersionSummary,
  AlgoVersionHistory,
  // Comparison types
  ChangeType,
  ConfigDiff,
  VersionComparison,
  RunMetricsComparison,
  // Storage types
  ConfigStore,
  ListConfigsOptions,
  ListRunsOptions,
} from "./types.ts";

// =============================================================================
// VERSION MANAGER
// =============================================================================

export {
  VersionManager,
  defaultVersionManager,
  hashAlgoParams,
  generateAlgoID,
  generateRunID,
} from "./version-manager.ts";

// =============================================================================
// VALIDATION
// =============================================================================

export {
  validateAlgoParams,
  validateAlgoConfig,
  validateRunSettings,
  validateBacktestSetup,
} from "./validation.ts";

export type {
  ValidationSeverity,
  ValidationIssue,
  ValidationResult,
} from "./validation.ts";

// =============================================================================
// COMPARISON
// =============================================================================

export {
  compareAlgoParams,
  compareConfigs,
  getChangeSummary,
  getKeyChanges,
  compareIndicators,
  isSuperset,
  isBackwardsCompatible,
} from "./comparison.ts";

// =============================================================================
// RUN MANAGER
// =============================================================================

export {
  RunManager,
  defaultRunManager,
} from "./run-manager.ts";
