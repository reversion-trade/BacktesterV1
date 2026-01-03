/**
 * Configuration Comparison
 *
 * @module config/comparison
 * @description
 * Compares different versions of AlgoConfig to identify changes.
 * Enables diff views and change tracking between versions.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 4: Versioned Configuration)
 * - Purpose: Enable version comparison and change tracking
 */

import type { AlgoParams } from "../core/types.ts";
import type {
  VersionedAlgoConfig,
  ConfigDiff,
  VersionComparison,
  ChangeType,
} from "./types.ts";

// =============================================================================
// DIFF UTILITIES
// =============================================================================

/**
 * Get the type of a value for display.
 */
function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Format a value for display.
 */
function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Deep compare two values and collect differences.
 */
function deepCompare(
  pathPrefix: string,
  oldValue: unknown,
  newValue: unknown,
  diffs: ConfigDiff[]
): void {
  // Both undefined/null
  if (oldValue === undefined && newValue === undefined) return;
  if (oldValue === null && newValue === null) return;

  // One is undefined/null
  if (oldValue === undefined || oldValue === null) {
    if (newValue !== undefined && newValue !== null) {
      diffs.push({
        path: pathPrefix,
        changeType: "added",
        oldValue: undefined,
        newValue,
      });
    }
    return;
  }

  if (newValue === undefined || newValue === null) {
    diffs.push({
      path: pathPrefix,
      changeType: "removed",
      oldValue,
      newValue: undefined,
    });
    return;
  }

  // Different types
  if (typeof oldValue !== typeof newValue) {
    diffs.push({
      path: pathPrefix,
      changeType: "modified",
      oldValue,
      newValue,
    });
    return;
  }

  // Primitives
  if (typeof oldValue !== "object") {
    if (oldValue !== newValue) {
      diffs.push({
        path: pathPrefix,
        changeType: "modified",
        oldValue,
        newValue,
      });
    }
    return;
  }

  // Arrays
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const maxLen = Math.max(oldValue.length, newValue.length);
    for (let i = 0; i < maxLen; i++) {
      deepCompare(
        `${pathPrefix}[${i}]`,
        oldValue[i],
        newValue[i],
        diffs
      );
    }
    return;
  }

  // Objects
  if (!Array.isArray(oldValue) && !Array.isArray(newValue)) {
    const oldObj = oldValue as Record<string, unknown>;
    const newObj = newValue as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
      const subPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      deepCompare(subPath, oldObj[key], newObj[key], diffs);
    }
    return;
  }

  // Fallback: type mismatch (array vs object)
  diffs.push({
    path: pathPrefix,
    changeType: "modified",
    oldValue,
    newValue,
  });
}

// =============================================================================
// COMPARISON FUNCTIONS
// =============================================================================

/**
 * Compare two AlgoParams and return differences.
 */
export function compareAlgoParams(
  paramsA: AlgoParams,
  paramsB: AlgoParams
): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  deepCompare("", paramsA, paramsB, diffs);
  return diffs;
}

/**
 * Compare two VersionedAlgoConfigs.
 */
export function compareConfigs(
  configA: VersionedAlgoConfig,
  configB: VersionedAlgoConfig
): VersionComparison {
  // Ensure we're comparing same algorithm
  if (configA.algoID !== configB.algoID) {
    throw new Error("Cannot compare configs from different algorithms");
  }

  // Compare params only (metadata changes don't count)
  const diffs = compareAlgoParams(configA.params, configB.params);

  // Count by change type
  const summary = {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: 0,
  };

  for (const diff of diffs) {
    summary[diff.changeType]++;
  }

  return {
    versionA: configA.version,
    versionB: configB.version,
    algoID: configA.algoID,
    differences: diffs,
    summary,
    isIdentical: diffs.length === 0,
  };
}

/**
 * Get a human-readable summary of changes.
 */
export function getChangeSummary(comparison: VersionComparison): string[] {
  const lines: string[] = [];

  lines.push(`Comparing v${comparison.versionA} → v${comparison.versionB}`);

  if (comparison.isIdentical) {
    lines.push("No changes detected");
    return lines;
  }

  lines.push(
    `Changes: ${comparison.summary.added} added, ` +
    `${comparison.summary.removed} removed, ` +
    `${comparison.summary.modified} modified`
  );

  lines.push("");

  for (const diff of comparison.differences) {
    switch (diff.changeType) {
      case "added":
        lines.push(`+ ${diff.path}: ${formatValue(diff.newValue)}`);
        break;
      case "removed":
        lines.push(`- ${diff.path}: ${formatValue(diff.oldValue)}`);
        break;
      case "modified":
        lines.push(`~ ${diff.path}: ${formatValue(diff.oldValue)} → ${formatValue(diff.newValue)}`);
        break;
    }
  }

  return lines;
}

/**
 * Get key parameter changes (for quick overview).
 */
export function getKeyChanges(comparison: VersionComparison): string[] {
  const keyPaths = [
    "type",
    "positionSize.value",
    "positionSize.type",
    "startingCapitalUSD",
    "orderType",
    "longEntry",
    "longExit",
    "shortEntry",
    "shortExit",
    "longExit.stopLoss",
    "longExit.takeProfit",
    "shortExit.stopLoss",
    "shortExit.takeProfit",
  ];

  const changes: string[] = [];

  for (const diff of comparison.differences) {
    // Check if this diff affects a key path
    const isKeyChange = keyPaths.some(
      (kp) => diff.path === kp || diff.path.startsWith(`${kp}.`)
    );

    if (isKeyChange) {
      switch (diff.changeType) {
        case "added":
          changes.push(`Added ${diff.path}`);
          break;
        case "removed":
          changes.push(`Removed ${diff.path}`);
          break;
        case "modified":
          changes.push(`Changed ${diff.path}: ${formatValue(diff.oldValue)} → ${formatValue(diff.newValue)}`);
          break;
      }
    }
  }

  return changes;
}

// =============================================================================
// INDICATOR COMPARISON
// =============================================================================

/**
 * Extract indicator keys from AlgoParams.
 */
function extractIndicatorKeys(params: AlgoParams): Set<string> {
  const keys = new Set<string>();

  const addIndicators = (condition: { required?: unknown[]; optional?: unknown[] } | undefined) => {
    if (!condition) return;
    condition.required?.forEach((ind) => {
      const config = ind as { type?: string };
      if (config.type) {
        keys.add(`${config.type}:${JSON.stringify(ind)}`);
      }
    });
    condition.optional?.forEach((ind) => {
      const config = ind as { type?: string };
      if (config.type) {
        keys.add(`${config.type}:${JSON.stringify(ind)}`);
      }
    });
  };

  addIndicators(params.longEntry);
  addIndicators(params.longExit);
  addIndicators(params.shortEntry);
  addIndicators(params.shortExit);

  return keys;
}

/**
 * Compare indicators between two versions.
 */
export function compareIndicators(
  paramsA: AlgoParams,
  paramsB: AlgoParams
): {
  added: string[];
  removed: string[];
  unchanged: string[];
} {
  const keysA = extractIndicatorKeys(paramsA);
  const keysB = extractIndicatorKeys(paramsB);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const key of keysB) {
    if (keysA.has(key)) {
      unchanged.push(key);
    } else {
      added.push(key);
    }
  }

  for (const key of keysA) {
    if (!keysB.has(key)) {
      removed.push(key);
    }
  }

  return { added, removed, unchanged };
}

// =============================================================================
// MIGRATION HELPERS
// =============================================================================

/**
 * Check if config B is a superset of config A.
 * Useful for determining if a version adds features without removing any.
 */
export function isSuperset(
  configA: VersionedAlgoConfig,
  configB: VersionedAlgoConfig
): boolean {
  const comparison = compareConfigs(configA, configB);
  return comparison.summary.removed === 0;
}

/**
 * Check if a version change is backwards compatible.
 * Currently, any change is considered potentially breaking.
 */
export function isBackwardsCompatible(
  configA: VersionedAlgoConfig,
  configB: VersionedAlgoConfig
): boolean {
  const comparison = compareConfigs(configA, configB);
  // For now, only unchanged configs are backwards compatible
  return comparison.isIdentical;
}
