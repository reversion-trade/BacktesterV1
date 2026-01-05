/**
 * Run Manager
 *
 * @module config/run-manager
 * @description
 * Manages RunSettings for backtest and live trading runs.
 * Tracks run status, stores results, and enables comparison.
 *
 * @audit-trail
 * - Created: 2026-01-01 (Sprint 4: Versioned Configuration)
 * - Purpose: Manage run settings and tracking
 */

import type { RunStatus } from "../core/types.ts";
import type {
    TrackedRunSettings,
    CreateRunSettingsInput,
    ListRunsOptions,
    RunMetricsComparison,
    VersionedAlgoConfig,
} from "./types.ts";
import { generateRunID } from "./version-manager.ts";

// =============================================================================
// RUN MANAGER CLASS
// =============================================================================

/**
 * Manages run settings and run tracking.
 *
 * @example
 * ```typescript
 * const manager = new RunManager();
 *
 * // Create a backtest run
 * const run = manager.createRun({
 *   userID: "user123",
 *   algoID: "algo_abc123",
 *   version: 1,
 *   isBacktest: true,
 *   exchangeID: "simulation",
 *   startTime: 1704067200,
 *   endTime: 1704672000,
 * });
 *
 * // Update status
 * manager.updateStatus(run.runID, "RUNNING");
 * // ... run completes
 * manager.completeRun(run.runID, "output_ref_123");
 * ```
 */
export class RunManager {
    private runs: Map<string, TrackedRunSettings>;

    constructor() {
        this.runs = new Map();
    }

    // ===========================================================================
    // CREATE & UPDATE
    // ===========================================================================

    /**
     * Create a new run settings.
     */
    createRun(input: CreateRunSettingsInput, algoConfig?: VersionedAlgoConfig): TrackedRunSettings {
        const now = Math.floor(Date.now() / 1000);
        const runID = generateRunID();

        // Determine coin symbol (AlgoConfig takes precedence)
        const coinSymbol = algoConfig?.params.coinSymbol || input.coinSymbol || "";

        const run: TrackedRunSettings = {
            userID: input.userID,
            algoID: input.algoID,
            version: String(input.version),
            runID,
            isBacktest: input.isBacktest,
            coinSymbol,
            capitalScaler: input.capitalScaler ?? 1,
            startTime: input.startTime,
            endTime: input.endTime,
            tradesLimit: input.tradesLimit,
            assumePositionImmediately: input.assumePositionImmediately ?? false,
            closePositionOnExit: input.closePositionOnExit ?? true,
            launchTime: now,
            status: "NEW",
            exchangeID: input.exchangeID,
            createdAt: now,
        };

        this.runs.set(runID, run);
        return run;
    }

    /**
     * Update run status.
     */
    updateStatus(runID: string, status: RunStatus): TrackedRunSettings | null {
        const run = this.runs.get(runID);
        if (!run) {
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        run.status = status;

        if (status === "RUNNING" && !run.startedAt) {
            run.startedAt = now;
        }

        if (status === "DONE" && !run.completedAt) {
            run.completedAt = now;
        }

        return run;
    }

    /**
     * Mark run as completed with output reference.
     */
    completeRun(runID: string, outputRef?: string): TrackedRunSettings | null {
        const run = this.runs.get(runID);
        if (!run) {
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        run.status = "DONE";
        run.completedAt = now;
        if (outputRef) {
            run.outputRef = outputRef;
        }

        return run;
    }

    /**
     * Mark run as failed with error message.
     */
    failRun(runID: string, errorMessage: string): TrackedRunSettings | null {
        const run = this.runs.get(runID);
        if (!run) {
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        run.status = "DONE"; // Still "DONE" but with error
        run.completedAt = now;
        run.errorMessage = errorMessage;

        return run;
    }

    // ===========================================================================
    // RETRIEVE
    // ===========================================================================

    /**
     * Get a run by ID.
     */
    getRun(runID: string): TrackedRunSettings | null {
        return this.runs.get(runID) || null;
    }

    /**
     * List runs with optional filtering.
     */
    listRuns(options?: ListRunsOptions): TrackedRunSettings[] {
        let results = Array.from(this.runs.values());

        // Apply filters
        if (options?.userID) {
            results = results.filter((r) => r.userID === options.userID);
        }
        if (options?.algoID) {
            results = results.filter((r) => r.algoID === options.algoID);
        }
        if (options?.version !== undefined) {
            results = results.filter((r) => r.version === String(options.version));
        }
        if (options?.status) {
            results = results.filter((r) => r.status === options.status);
        }
        if (options?.isBacktest !== undefined) {
            results = results.filter((r) => r.isBacktest === options.isBacktest);
        }

        // Sort by creation time (newest first)
        results.sort((a, b) => b.createdAt - a.createdAt);

        // Pagination
        const offset = options?.offset || 0;
        const limit = options?.limit || results.length;
        return results.slice(offset, offset + limit);
    }

    /**
     * Get all runs for a specific algorithm version.
     */
    getRunsForVersion(algoID: string, version: number): TrackedRunSettings[] {
        return this.listRuns({ algoID, version });
    }

    /**
     * Get the latest run for an algorithm.
     */
    getLatestRun(algoID: string): TrackedRunSettings | null {
        const runs = this.listRuns({ algoID, limit: 1 });
        return runs[0] || null;
    }

    /**
     * Get completed runs for an algorithm.
     */
    getCompletedRuns(algoID: string): TrackedRunSettings[] {
        return this.listRuns({ algoID, status: "DONE" }).filter((r) => !r.errorMessage);
    }

    // ===========================================================================
    // COMPARISON
    // ===========================================================================

    /**
     * Compare metrics between two runs.
     * Requires external metrics data to be provided.
     */
    compareRunMetrics(
        runA: TrackedRunSettings,
        runB: TrackedRunSettings,
        metricsA: Record<string, number>,
        metricsB: Record<string, number>
    ): RunMetricsComparison {
        const isBacktestVsLive = runA.isBacktest !== runB.isBacktest;

        const allMetricNames = new Set([...Object.keys(metricsA), ...Object.keys(metricsB)]);

        const metrics: RunMetricsComparison["metrics"] = [];
        let better = 0;
        let worse = 0;
        let similar = 0;

        // Metrics where higher is better
        const higherIsBetter = new Set([
            "totalPnlUSD",
            "winRate",
            "profitFactor",
            "sharpeRatio",
            "sortinoRatio",
            "calmarRatio",
        ]);

        // Metrics where lower is better
        const lowerIsBetter = new Set(["maxDrawdownPct", "maxDrawdownUSD", "totalFeesUSD", "totalSlippageUSD"]);

        for (const name of allMetricNames) {
            const valueA = metricsA[name] ?? 0;
            const valueB = metricsB[name] ?? 0;
            const difference = valueB - valueA;
            const percentChange = valueA !== 0 ? (difference / Math.abs(valueA)) * 100 : 0;

            metrics.push({
                name,
                valueA,
                valueB,
                difference,
                percentChange,
            });

            // Determine if better/worse/similar
            const threshold = 0.01; // 1% threshold for "similar"
            const absChange = Math.abs(percentChange);

            if (absChange < threshold) {
                similar++;
            } else if (higherIsBetter.has(name)) {
                if (difference > 0) better++;
                else worse++;
            } else if (lowerIsBetter.has(name)) {
                if (difference < 0) better++;
                else worse++;
            } else {
                similar++;
            }
        }

        return {
            runA: runA.runID,
            runB: runB.runID,
            isBacktestVsLive,
            metrics,
            summary: {
                betterMetrics: better,
                worseMetrics: worse,
                similarMetrics: similar,
            },
        };
    }

    /**
     * Find runs that can be compared (same algo, different versions).
     */
    findComparableRuns(algoID: string): { version: number; runs: TrackedRunSettings[] }[] {
        const runs = this.listRuns({ algoID });
        const byVersion = new Map<number, TrackedRunSettings[]>();

        for (const run of runs) {
            const version = parseInt(run.version, 10);
            if (!byVersion.has(version)) {
                byVersion.set(version, []);
            }
            byVersion.get(version)!.push(run);
        }

        return Array.from(byVersion.entries())
            .map(([version, runs]) => ({ version, runs }))
            .sort((a, b) => a.version - b.version);
    }

    // ===========================================================================
    // UTILITY
    // ===========================================================================

    /**
     * Delete a run.
     */
    deleteRun(runID: string): boolean {
        return this.runs.delete(runID);
    }

    /**
     * Delete all runs for an algorithm.
     */
    deleteRunsForAlgo(algoID: string): number {
        let deleted = 0;
        for (const [runID, run] of this.runs) {
            if (run.algoID === algoID) {
                this.runs.delete(runID);
                deleted++;
            }
        }
        return deleted;
    }

    /**
     * Get run duration in seconds.
     */
    getRunDuration(run: TrackedRunSettings): number | null {
        if (!run.startedAt) return null;
        const endTime = run.completedAt || Math.floor(Date.now() / 1000);
        return endTime - run.startedAt;
    }

    /**
     * Clear all stored runs.
     */
    clear(): void {
        this.runs.clear();
    }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Default run manager instance.
 */
export const defaultRunManager = new RunManager();
