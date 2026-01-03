/**
 * Version Manager
 *
 * @module config/version-manager
 * @description
 * Manages versioning of AlgoConfigs. Each parameter change creates
 * a new immutable version, enabling comparison and rollback.
 *
 * @architecture
 * Key principles:
 * - AlgoConfigs are immutable once created
 * - Version numbers auto-increment
 * - Parent version is tracked for history
 * - Params hash enables quick equality checks
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 4: Versioned Configuration)
 * - Purpose: Manage immutable config versioning
 */

import type { AlgoParams } from "../core/types.ts";
import type {
  VersionedAlgoConfig,
  CreateAlgoConfigInput,
  UpdateAlgoConfigInput,
  VersionSummary,
  AlgoVersionHistory,
  ConfigStore,
  ListConfigsOptions,
} from "./types.ts";

// =============================================================================
// HASH UTILITIES
// =============================================================================

/**
 * Generate a deterministic hash of AlgoParams.
 * Used for quick equality checks between versions.
 */
export function hashAlgoParams(params: AlgoParams): string {
  // Simple JSON-based hash (in production, use a proper hash function)
  const normalized = JSON.stringify(params, Object.keys(params).sort());
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Generate a unique algorithm ID.
 */
export function generateAlgoID(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `algo_${timestamp}_${random}`;
}

/**
 * Generate a unique run ID.
 */
export function generateRunID(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `run_${timestamp}_${random}`;
}

// =============================================================================
// VERSION MANAGER CLASS
// =============================================================================

/**
 * Manages algorithm configuration versions.
 *
 * @example
 * ```typescript
 * const manager = new VersionManager();
 *
 * // Create initial version
 * const v1 = manager.createConfig({
 *   userID: "user123",
 *   algoName: "My RSI Strategy",
 *   params: { ... },
 * });
 *
 * // Update creates new version
 * const v2 = manager.updateConfig({
 *   existingConfig: v1,
 *   newParams: { ...v1.params, startingCapitalUSD: 20000 },
 *   changeNotes: "Increased capital",
 * });
 *
 * // Get version history
 * const history = manager.getVersionHistory(v1.algoID);
 * ```
 */
export class VersionManager {
  private store: ConfigStore;

  constructor() {
    this.store = {
      configs: new Map(),
      runs: new Map(),
    };
  }

  // ===========================================================================
  // CREATE & UPDATE
  // ===========================================================================

  /**
   * Create a new algorithm configuration (version 1).
   */
  createConfig(input: CreateAlgoConfigInput): VersionedAlgoConfig {
    const algoID = input.algoID || generateAlgoID();
    const now = Math.floor(Date.now() / 1000);

    const config: VersionedAlgoConfig = {
      userID: input.userID,
      algoID,
      algoName: input.algoName,
      version: 1,
      params: { ...input.params },
      createdAt: now,
      changeNotes: input.changeNotes || "Initial version",
      parentVersion: null,
      paramsHash: hashAlgoParams(input.params),
    };

    // Store the config
    if (!this.store.configs.has(algoID)) {
      this.store.configs.set(algoID, new Map());
    }
    this.store.configs.get(algoID)!.set(1, config);

    return config;
  }

  /**
   * Update an algorithm configuration (creates new version).
   * The existing config remains unchanged.
   */
  updateConfig(input: UpdateAlgoConfigInput): VersionedAlgoConfig {
    const { existingConfig, newParams, changeNotes } = input;
    const now = Math.floor(Date.now() / 1000);

    // Check if params actually changed
    const newHash = hashAlgoParams(newParams);
    if (newHash === existingConfig.paramsHash) {
      // No actual change, return existing
      return existingConfig;
    }

    const newVersion = existingConfig.version + 1;

    const config: VersionedAlgoConfig = {
      userID: existingConfig.userID,
      algoID: existingConfig.algoID,
      algoName: existingConfig.algoName,
      version: newVersion,
      params: { ...newParams },
      createdAt: now,
      changeNotes: changeNotes || `Updated from version ${existingConfig.version}`,
      parentVersion: existingConfig.version,
      paramsHash: newHash,
    };

    // Store the new version
    const algoVersions = this.store.configs.get(existingConfig.algoID);
    if (!algoVersions) {
      throw new Error(`Algorithm ${existingConfig.algoID} not found`);
    }
    algoVersions.set(newVersion, config);

    return config;
  }

  /**
   * Rename an algorithm (creates new version with same params).
   */
  renameConfig(
    existingConfig: VersionedAlgoConfig,
    newName: string,
    changeNotes?: string
  ): VersionedAlgoConfig {
    const now = Math.floor(Date.now() / 1000);
    const newVersion = existingConfig.version + 1;

    const config: VersionedAlgoConfig = {
      ...existingConfig,
      algoName: newName,
      version: newVersion,
      createdAt: now,
      changeNotes: changeNotes || `Renamed to "${newName}"`,
      parentVersion: existingConfig.version,
    };

    const algoVersions = this.store.configs.get(existingConfig.algoID);
    if (!algoVersions) {
      throw new Error(`Algorithm ${existingConfig.algoID} not found`);
    }
    algoVersions.set(newVersion, config);

    return config;
  }

  // ===========================================================================
  // RETRIEVE
  // ===========================================================================

  /**
   * Get a specific version of an algorithm config.
   */
  getConfig(algoID: string, version?: number): VersionedAlgoConfig | null {
    const algoVersions = this.store.configs.get(algoID);
    if (!algoVersions || algoVersions.size === 0) {
      return null;
    }

    if (version !== undefined) {
      return algoVersions.get(version) || null;
    }

    // Return latest version
    const latestVersion = Math.max(...algoVersions.keys());
    return algoVersions.get(latestVersion) || null;
  }

  /**
   * Get all versions of an algorithm.
   */
  getAllVersions(algoID: string): VersionedAlgoConfig[] {
    const algoVersions = this.store.configs.get(algoID);
    if (!algoVersions) {
      return [];
    }

    return Array.from(algoVersions.values()).sort((a, b) => a.version - b.version);
  }

  /**
   * Get the latest version number for an algorithm.
   */
  getLatestVersion(algoID: string): number | null {
    const algoVersions = this.store.configs.get(algoID);
    if (!algoVersions || algoVersions.size === 0) {
      return null;
    }
    return Math.max(...algoVersions.keys());
  }

  /**
   * List all algorithm configs with optional filtering.
   */
  listConfigs(options?: ListConfigsOptions): VersionedAlgoConfig[] {
    let results: VersionedAlgoConfig[] = [];

    for (const [algoID, versions] of this.store.configs) {
      if (options?.algoID && algoID !== options.algoID) {
        continue;
      }

      // Get latest version of each algo
      const latestVersion = Math.max(...versions.keys());
      const config = versions.get(latestVersion);
      if (!config) continue;

      if (options?.userID && config.userID !== options.userID) {
        continue;
      }

      results.push(config);
    }

    // Sort
    const sortBy = options?.sortBy || "createdAt";
    const sortOrder = options?.sortOrder || "desc";
    results.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "createdAt":
          comparison = a.createdAt - b.createdAt;
          break;
        case "version":
          comparison = a.version - b.version;
          break;
        case "algoName":
          comparison = a.algoName.localeCompare(b.algoName);
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    // Pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || results.length;
    return results.slice(offset, offset + limit);
  }

  // ===========================================================================
  // VERSION HISTORY
  // ===========================================================================

  /**
   * Get a summary of a version (for display).
   */
  getVersionSummary(config: VersionedAlgoConfig): VersionSummary {
    return {
      version: config.version,
      createdAt: config.createdAt,
      changeNotes: config.changeNotes,
      parentVersion: config.parentVersion,
      paramsSummary: {
        type: config.params.type,
        hasLongEntry: !!config.params.longEntry,
        hasShortEntry: !!config.params.shortEntry,
        positionSizeType: config.params.positionSize.type,
        startingCapitalUSD: config.params.startingCapitalUSD,
      },
    };
  }

  /**
   * Get complete version history for an algorithm.
   */
  getVersionHistory(algoID: string): AlgoVersionHistory | null {
    const versions = this.getAllVersions(algoID);
    if (versions.length === 0) {
      return null;
    }

    const latest = versions[versions.length - 1]!;
    const first = versions[0]!;

    return {
      algoID,
      algoName: latest.algoName,
      userID: latest.userID,
      versions: versions.map((v) => this.getVersionSummary(v)),
      latestVersion: latest.version,
      firstCreatedAt: first.createdAt,
      lastUpdatedAt: latest.createdAt,
    };
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  /**
   * Check if two configs have identical params.
   */
  hasIdenticalParams(configA: VersionedAlgoConfig, configB: VersionedAlgoConfig): boolean {
    return configA.paramsHash === configB.paramsHash;
  }

  /**
   * Clone a config from another algorithm (creates new algo with version 1).
   */
  cloneConfig(
    sourceConfig: VersionedAlgoConfig,
    newUserID: string,
    newAlgoName: string
  ): VersionedAlgoConfig {
    return this.createConfig({
      userID: newUserID,
      algoName: newAlgoName,
      params: { ...sourceConfig.params },
      changeNotes: `Cloned from ${sourceConfig.algoID} v${sourceConfig.version}`,
    });
  }

  /**
   * Delete an algorithm and all its versions.
   * Returns true if deleted, false if not found.
   */
  deleteAlgo(algoID: string): boolean {
    return this.store.configs.delete(algoID);
  }

  /**
   * Get the internal store (for testing/debugging).
   */
  getStore(): ConfigStore {
    return this.store;
  }

  /**
   * Clear all stored data.
   */
  clear(): void {
    this.store.configs.clear();
    this.store.runs.clear();
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default version manager instance.
 * Use this for simple cases, or create your own instance.
 */
export const defaultVersionManager = new VersionManager();
