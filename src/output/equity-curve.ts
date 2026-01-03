/**
 * Equity Curve Processing
 *
 * Pipeline for processing raw equity data into storage-ready curves.
 * Handles downsampling to reduce data size.
 */

import type { EquityPoint } from "./types.ts";
import {
  downsampleWithPeaks,
  downsamplePreserveDrawdownPeaks,
} from "../utils/downsampling.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for equity curve processing.
 */
export interface EquityCurveConfig {
  /** Target number of points after downsampling (0 = no downsampling) */
  targetPoints?: number;
  /** Whether to preserve drawdown peaks during downsampling */
  preserveDrawdownPeaks?: boolean;
}

/**
 * Default processing configuration.
 */
const DEFAULT_CONFIG: Required<EquityCurveConfig> = {
  targetPoints: 500,
  preserveDrawdownPeaks: true,
};

// =============================================================================
// PROCESSING PIPELINE
// =============================================================================

/**
 * Process raw equity curve for storage.
 * Downsamples to reduce data size while preserving important features.
 *
 * @param rawCurve - Raw equity points from simulation
 * @param config - Processing configuration
 * @returns Processed equity curve ready for storage
 */
export function processEquityCurve(
  rawCurve: EquityPoint[],
  config: EquityCurveConfig = {}
): EquityPoint[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (rawCurve.length === 0) return [];

  let processed = rawCurve;

  // Downsample for storage
  if (cfg.targetPoints > 0 && processed.length > cfg.targetPoints) {
    processed = cfg.preserveDrawdownPeaks
      ? downsamplePreserveDrawdownPeaks(processed, cfg.targetPoints)
      : downsampleWithPeaks(processed, cfg.targetPoints);
  }

  return processed;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get summary statistics from an equity curve.
 */
export function getEquityCurveStats(curve: EquityPoint[]): {
  startEquity: number;
  endEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  maxRunupPct: number;
} {
  if (curve.length === 0) {
    return {
      startEquity: 0,
      endEquity: 0,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      maxRunupPct: 0,
    };
  }

  const startEquity = curve[0]!.equity;
  const endEquity = curve[curve.length - 1]!.equity;
  const totalReturnPct =
    startEquity > 0 ? (endEquity - startEquity) / startEquity : 0;

  const maxDrawdownPct = Math.max(...curve.map((p) => p.drawdownPct));
  const maxRunupPct = Math.max(...curve.map((p) => p.runupPct));

  return {
    startEquity,
    endEquity,
    totalReturnPct,
    maxDrawdownPct,
    maxRunupPct,
  };
}
