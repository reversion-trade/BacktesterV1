/**
 * Configuration Types
 *
 * @module config/types
 * @description
 * Enhanced configuration types with versioning, timestamps, and change tracking.
 * Extends the core types with additional metadata for version management.
 *
 * @architecture
 * Three-Level Configuration:
 * 1. AlgoParams - Pure algorithm definition (immutable)
 * 2. AlgoConfig - AlgoParams + metadata (versioned, immutable once created)
 * 3. RunSettings - Runtime configuration (per-run, mutable status)
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 4: Versioned Configuration)
 * - Purpose: Provide enhanced types for version management
 */

import type { AlgoParams, AlgoConfig, RunSettings, RunStatus } from "../core/types.ts";

// Re-export core types
export type { AlgoParams, AlgoConfig, RunSettings, RunStatus };

// =============================================================================
// ENHANCED ALGO CONFIG
// =============================================================================

/**
 * Extended AlgoConfig with version metadata.
 * Adds timestamps and optional change notes for audit trail.
 */
export interface VersionedAlgoConfig extends AlgoConfig {
    /** Unix timestamp (seconds) when this version was created */
    createdAt: number;
    /** Optional description of what changed in this version */
    changeNotes?: string;
    /** Parent version (null for version 1) */
    parentVersion: number | null;
    /** Hash of params for quick equality check */
    paramsHash: string;
}

/**
 * Minimal input for creating a new AlgoConfig.
 */
export interface CreateAlgoConfigInput {
    /** User identifier */
    userID: string;
    /** Algorithm identifier (generated if not provided) */
    algoID?: string;
    /** Human-readable algorithm name */
    algoName: string;
    /** Algorithm parameters */
    params: AlgoParams;
    /** Optional change notes */
    changeNotes?: string;
}

/**
 * Input for updating an AlgoConfig (creates new version).
 */
export interface UpdateAlgoConfigInput {
    /** Existing config to update */
    existingConfig: VersionedAlgoConfig;
    /** New parameters */
    newParams: AlgoParams;
    /** Description of what changed */
    changeNotes?: string;
}

// =============================================================================
// ENHANCED RUN SETTINGS
// =============================================================================

/**
 * Extended RunSettings with tracking metadata.
 */
export interface TrackedRunSettings extends RunSettings {
    /** Unix timestamp when run was created */
    createdAt: number;
    /** Unix timestamp when run started executing */
    startedAt?: number;
    /** Unix timestamp when run completed */
    completedAt?: number;
    /** Error message if run failed */
    errorMessage?: string;
    /** Reference to the backtest output (if completed) */
    outputRef?: string;
}

/**
 * Minimal input for creating RunSettings.
 */
export interface CreateRunSettingsInput {
    /** User identifier */
    userID: string;
    /** Algorithm identifier */
    algoID: string;
    /** Algorithm version */
    version: number;
    /** Whether this is a backtest */
    isBacktest: boolean;
    /** Coin symbol (optional, uses AlgoParams.coinSymbol if set) */
    coinSymbol?: string;
    /** Exchange identifier */
    exchangeID: string;
    /** Start time (required for backtest) */
    startTime?: number;
    /** End time (required for backtest) */
    endTime?: number;
    /** Capital scaler (default: 1) */
    capitalScaler?: number;
    /** Trade limit (optional) */
    tradesLimit?: number;
    /** Close position on exit (default: true) */
    closePositionOnExit?: boolean;
}

// =============================================================================
// VERSION HISTORY
// =============================================================================

/**
 * Summary of a version for display purposes.
 */
export interface VersionSummary {
    /** Version number */
    version: number;
    /** When created */
    createdAt: number;
    /** Change notes */
    changeNotes?: string;
    /** Parent version */
    parentVersion: number | null;
    /** Quick summary of key params */
    paramsSummary: {
        type: string;
        hasLongEntry: boolean;
        hasShortEntry: boolean;
        positionSizeType: string;
        startingCapitalUSD: number;
    };
}

/**
 * Complete version history for an algorithm.
 */
export interface AlgoVersionHistory {
    /** Algorithm identifier */
    algoID: string;
    /** Algorithm name (from latest version) */
    algoName: string;
    /** User identifier */
    userID: string;
    /** All versions in order */
    versions: VersionSummary[];
    /** Latest version number */
    latestVersion: number;
    /** When the algorithm was first created */
    firstCreatedAt: number;
    /** When the algorithm was last updated */
    lastUpdatedAt: number;
}

// =============================================================================
// COMPARISON TYPES
// =============================================================================

/**
 * Type of change between two values.
 */
export type ChangeType = "added" | "removed" | "modified" | "unchanged";

/**
 * A single difference between two configs.
 */
export interface ConfigDiff {
    /** Path to the changed value (e.g., "params.longEntry.required[0].type") */
    path: string;
    /** Type of change */
    changeType: ChangeType;
    /** Old value (undefined if added) */
    oldValue?: unknown;
    /** New value (undefined if removed) */
    newValue?: unknown;
}

/**
 * Full comparison result between two versions.
 */
export interface VersionComparison {
    /** First version being compared */
    versionA: number;
    /** Second version being compared */
    versionB: number;
    /** Algorithm identifier */
    algoID: string;
    /** All differences found */
    differences: ConfigDiff[];
    /** Summary counts */
    summary: {
        added: number;
        removed: number;
        modified: number;
        unchanged: number;
    };
    /** Whether the configs are identical */
    isIdentical: boolean;
}

// =============================================================================
// RUN COMPARISON
// =============================================================================

/**
 * Metrics comparison between two runs.
 */
export interface RunMetricsComparison {
    /** First run identifier */
    runA: string;
    /** Second run identifier */
    runB: string;
    /** Whether comparing backtest vs live */
    isBacktestVsLive: boolean;
    /** Key metrics comparison */
    metrics: {
        name: string;
        valueA: number;
        valueB: number;
        difference: number;
        percentChange: number;
    }[];
    /** Summary */
    summary: {
        betterMetrics: number;
        worseMetrics: number;
        similarMetrics: number;
    };
}

// =============================================================================
// STORAGE TYPES
// =============================================================================

/**
 * In-memory storage structure for version manager.
 * In production, this would be backed by a database.
 */
export interface ConfigStore {
    /** Map of algoID -> version -> VersionedAlgoConfig */
    configs: Map<string, Map<number, VersionedAlgoConfig>>;
    /** Map of runID -> TrackedRunSettings */
    runs: Map<string, TrackedRunSettings>;
}

/**
 * Query options for listing configs.
 */
export interface ListConfigsOptions {
    /** Filter by user */
    userID?: string;
    /** Filter by algo */
    algoID?: string;
    /** Maximum results */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
    /** Sort order */
    sortBy?: "createdAt" | "version" | "algoName";
    /** Sort direction */
    sortOrder?: "asc" | "desc";
}

/**
 * Query options for listing runs.
 */
export interface ListRunsOptions {
    /** Filter by user */
    userID?: string;
    /** Filter by algo */
    algoID?: string;
    /** Filter by version */
    version?: number;
    /** Filter by status */
    status?: RunStatus;
    /** Filter by backtest/live */
    isBacktest?: boolean;
    /** Maximum results */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
}
