/**
 * Test Utilities for Pipeline Stages
 *
 * Validation and formatting functions used only in tests.
 * Extracted from stage files to keep production code lean.
 */

import type { BacktestOutput, SwapMetrics, AlgoMetrics } from "../../../events/types.ts";
import type { IndicatorCalculationResult } from "../indicator-calculation.ts";
import type { ResamplingResult, ResampledSignalCache } from "../resampling.ts";
import type { InitializationResult } from "../initialization.ts";
import type { MipMapBuildingResult } from "../mipmap-building.ts";
import type { SubBarLoadingResult } from "../subbar-loading.ts";
import type { ValueFactorLoadingResult } from "../valuefactor-loading.ts";
import type { ConditionType } from "../../../events/types.ts";
import type { IndicatorInfo } from "../../../events/collector.ts";
import type { Candle } from "../../../core/types.ts";
import type { SignalCache } from "../../../indicators/calculator.ts";
import { MIN_SIMULATION_RESOLUTION } from "../../../indicators/resampler.ts";
import { getExpectedSubBarCount } from "../subbar-loading.ts";

// =============================================================================
// INDICATOR CALCULATION VALIDATION
// =============================================================================

export function validateIndicatorResult(result: IndicatorCalculationResult): {
    isValid: boolean;
    issues: string[];
    summary: {
        configCount: number;
        uniqueCount: number;
        warmupCandles: number;
        duplicatesRemoved: number;
    };
} {
    const issues: string[] = [];

    if (result.indicatorConfigs.length === 0) {
        issues.push("No indicator configurations found");
    }

    for (const key of result.indicatorKeys) {
        const signals = result.signalCache.get(key);
        if (!signals) {
            issues.push(`Missing signals for key: ${key}`);
        } else if (signals.length === 0) {
            issues.push(`Empty signal array for key: ${key}`);
        }
    }

    if (result.warmupCandles < 0) {
        issues.push(`Invalid warmup candles: ${result.warmupCandles}`);
    }

    return {
        isValid: issues.length === 0,
        issues,
        summary: {
            configCount: result.indicatorConfigs.length,
            uniqueCount: result.uniqueIndicatorCount,
            warmupCandles: result.warmupCandles,
            duplicatesRemoved: result.indicatorConfigs.length - result.uniqueIndicatorCount,
        },
    };
}

export function getSignalAtBar(signalCache: SignalCache, key: string, barIndex: number): boolean | undefined {
    const signals = signalCache.get(key);
    if (!signals || barIndex < 0 || barIndex >= signals.length) {
        return undefined;
    }
    return signals[barIndex];
}

// =============================================================================
// RESAMPLING VALIDATION
// =============================================================================

export function validateResamplingResult(result: ResamplingResult): {
    isValid: boolean;
    issues: string[];
    summary: {
        simulationResolution: number;
        totalBars: number;
        indicatorsProcessed: number;
        upsampled: number;
        downsampled: number;
    };
} {
    const issues: string[] = [];

    if (result.simulationResolution < MIN_SIMULATION_RESOLUTION) {
        issues.push(
            `Simulation resolution (${result.simulationResolution}s) below minimum (${MIN_SIMULATION_RESOLUTION}s)`
        );
    }

    if (result.simulationTimestamps.length !== result.totalSimulationBars) {
        issues.push(
            `Timestamp count (${result.simulationTimestamps.length}) doesn't match totalSimulationBars (${result.totalSimulationBars})`
        );
    }

    for (const key of result.resampledSignals.keys()) {
        const signals = result.resampledSignals.get(key);
        if (signals && signals.length !== result.totalSimulationBars) {
            issues.push(
                `Resampled signal "${key}" has ${signals.length} points, expected ${result.totalSimulationBars}`
            );
        }
    }

    if (result.warmupBars < 0) {
        issues.push(`Invalid warmup bars: ${result.warmupBars}`);
    }

    if (result.warmupBars >= result.totalSimulationBars && result.totalSimulationBars > 0) {
        issues.push(`Warmup (${result.warmupBars}) >= total bars (${result.totalSimulationBars})`);
    }

    return {
        isValid: issues.length === 0,
        issues,
        summary: {
            simulationResolution: result.simulationResolution,
            totalBars: result.totalSimulationBars,
            indicatorsProcessed: result.resamplingStats.indicatorsResampled,
            upsampled: result.resamplingStats.upsampledCount,
            downsampled: result.resamplingStats.downsampledCount,
        },
    };
}

export function getResampledSignalAtBar(
    resampledCache: ResampledSignalCache,
    key: string,
    simBarIndex: number
): boolean | undefined {
    const signals = resampledCache.get(key);
    if (!signals || simBarIndex < 0 || simBarIndex >= signals.length) {
        return undefined;
    }
    return signals[simBarIndex];
}

export function getTimestampForBar(result: ResamplingResult, simBarIndex: number): number | undefined {
    if (simBarIndex < 0 || simBarIndex >= result.simulationTimestamps.length) {
        return undefined;
    }
    return result.simulationTimestamps[simBarIndex];
}

export function formatResamplingDebugInfo(result: ResamplingResult): string {
    const { resamplingStats: stats } = result;

    return [
        "=== Resampling Summary ===",
        `Simulation Resolution: ${result.simulationResolution}s`,
        `Total Simulation Bars: ${result.totalSimulationBars}`,
        `Warmup Bars: ${result.warmupBars}`,
        `Min Indicator Resolution: ${result.minIndicatorResolution}s`,
        "",
        "=== Indicator Statistics ===",
        `Total Indicators: ${stats.indicatorsResampled}`,
        `  - Upsampled: ${stats.upsampledCount}`,
        `  - Downsampled: ${stats.downsampledCount}`,
        `  - No Change: ${stats.noResampleCount}`,
        "",
        "=== Signal Points ===",
        `Original: ${stats.originalSignalPoints}`,
        `Resampled: ${stats.resampledSignalPoints}`,
    ].join("\n");
}

// =============================================================================
// INITIALIZATION VALIDATION
// =============================================================================

export function getIndicatorKeys(indicatorInfoMap: Map<string, IndicatorInfo>): string[] {
    return Array.from(indicatorInfoMap.keys());
}

export function getIndicatorsForCondition(
    indicatorInfoMap: Map<string, IndicatorInfo>,
    conditionType: ConditionType
): IndicatorInfo[] {
    return Array.from(indicatorInfoMap.values()).filter((info) => info.conditionType === conditionType);
}

export function getRequiredIndicatorCount(
    indicatorInfoMap: Map<string, IndicatorInfo>,
    conditionType: ConditionType
): number {
    return getIndicatorsForCondition(indicatorInfoMap, conditionType).filter((info) => info.isRequired).length;
}

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

    if (result.initialCapital <= 0) {
        issues.push(`Invalid initial capital: ${result.initialCapital}`);
    }

    if (result.warmupBars < 0) {
        issues.push(`Invalid warmup bars: ${result.warmupBars}`);
    }

    if (result.feeBps < 0) {
        issues.push(`Invalid fee bps: ${result.feeBps}`);
    }

    if (result.slippageBps < 0) {
        issues.push(`Invalid slippage bps: ${result.slippageBps}`);
    }

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

// =============================================================================
// OUTPUT VALIDATION
// =============================================================================

export function validateBacktestOutput(output: BacktestOutput): {
    isValid: boolean;
    issues: string[];
    summary: {
        totalTrades: number;
        totalPnlUSD: number;
        winRate: number;
        maxDrawdownPct: number;
        durationMs: number;
    };
} {
    const issues: string[] = [];

    if (!output.config.algoId) {
        issues.push("Missing algoId in config");
    }
    if (!output.config.symbol) {
        issues.push("Missing symbol in config");
    }

    if (output.trades.length !== output.swapMetrics.totalTrades) {
        issues.push(
            `Trade count mismatch: ${output.trades.length} trades but swapMetrics.totalTrades = ${output.swapMetrics.totalTrades}`
        );
    }

    if (output.trades.length > 0 && output.equityCurve.length === 0) {
        issues.push("Trades exist but equity curve is empty");
    }

    if (output.config.startTime > output.config.endTime) {
        issues.push("startTime > endTime");
    }

    return {
        isValid: issues.length === 0,
        issues,
        summary: {
            totalTrades: output.swapMetrics.totalTrades,
            totalPnlUSD: output.swapMetrics.totalPnlUSD,
            winRate: output.swapMetrics.winRate,
            maxDrawdownPct: output.swapMetrics.maxDrawdownPct,
            durationMs: output.durationMs,
        },
    };
}

export function formatOutputSummary(output: BacktestOutput): string {
    const { swapMetrics, algoMetrics, config } = output;

    const startDate = new Date(config.startTime * 1000).toISOString();
    const endDate = new Date(config.endTime * 1000).toISOString();

    return [
        "=== Backtest Output Summary ===",
        `Symbol: ${config.symbol}`,
        `Period: ${startDate} to ${endDate}`,
        `Starting Capital: $${config.startingCapitalUSD.toFixed(2)}`,
        "",
        "=== Performance ===",
        `Total Trades: ${swapMetrics.totalTrades}`,
        `Win Rate: ${(swapMetrics.winRate * 100).toFixed(1)}%`,
        `Total P&L: $${swapMetrics.totalPnlUSD.toFixed(2)}`,
        `Max Drawdown: ${(swapMetrics.maxDrawdownPct * 100).toFixed(2)}%`,
        `Sharpe Ratio: ${swapMetrics.sharpeRatio.toFixed(2)}`,
        `Profit Factor: ${swapMetrics.profitFactor.toFixed(2)}`,
        "",
        "=== Algo Metrics ===",
        `Indicator Flips: ${algoMetrics.eventCounts.indicatorFlips}`,
        `State Transitions: ${algoMetrics.eventCounts.stateTransitions}`,
        `Time Flat: ${(algoMetrics.stateDistribution.pctTimeFlat * 100).toFixed(1)}%`,
        `Time Long: ${(algoMetrics.stateDistribution.pctTimeLong * 100).toFixed(1)}%`,
        `Time Short: ${(algoMetrics.stateDistribution.pctTimeShort * 100).toFixed(1)}%`,
        "",
        `Duration: ${output.durationMs}ms`,
        `Bars Processed: ${output.totalBarsProcessed}`,
    ].join("\n");
}

// =============================================================================
// MIPMAP VALIDATION
// =============================================================================

function formatResolution(seconds: number): string {
    if (seconds >= 86400) {
        return `${seconds / 86400}d`;
    }
    if (seconds >= 3600) {
        return `${seconds / 3600}h`;
    }
    if (seconds >= 60) {
        return `${seconds / 60}m`;
    }
    return `${seconds}s`;
}

export function formatMipMapBuildingResult(result: MipMapBuildingResult): string {
    if (result.isEmpty) {
        return "MIP-Map Building: Empty (no candles)";
    }

    const { stats, baseResolution, availableResolutions, indicatorConfigs, warnings } = result;

    const lines = [
        "=== Stage 1.5: MIP-Map Building ===",
        `Symbol: ${result.mipMap.symbol || "(not set)"}`,
        `Base Resolution: ${formatResolution(baseResolution)}`,
        `Levels Built: ${stats.levelsBuilt}`,
        `Resolutions: [${availableResolutions.map(formatResolution).join(", ")}]`,
        `Source Candles: ${stats.sourceCandles}`,
        `Total Candles: ${stats.totalCandles}`,
        `Memory Overhead: ${stats.overheadPct.toFixed(1)}%`,
        `Build Time: ${stats.buildTimeMs.toFixed(2)}ms`,
        `Indicator Configs: ${indicatorConfigs.length}`,
    ];

    if (warnings.length > 0) {
        lines.push("Warnings:");
        for (const warning of warnings) {
            lines.push(`  - ${warning}`);
        }
    }

    return lines.join("\n");
}

// =============================================================================
// SUBBAR VALIDATION
// =============================================================================

export function getTotalPriceCheckpoints(subBarResult: SubBarLoadingResult): number {
    return subBarResult.totalSubBarsLoaded * 4;
}

export function formatSubBarLoadingSummary(result: SubBarLoadingResult): string {
    if (!result.isSupported) {
        return `Sub-bar simulation not supported for ${result.parentTimeframe} timeframe`;
    }

    const checkpoints = getTotalPriceCheckpoints(result);
    const avgSubBarsPerBar =
        result.parentBarsWithData > 0
            ? (result.totalSubBarsLoaded / result.parentBarsWithData).toFixed(1)
            : "0";

    return [
        `Sub-bar data loaded: ${result.parentTimeframe} → ${result.subBarTimeframe}`,
        `  Parent bars: ${result.parentBarsWithData}`,
        `  Sub-bars: ${result.totalSubBarsLoaded} (avg ${avgSubBarsPerBar}/bar)`,
        `  Price checkpoints: ${checkpoints}`,
    ].join("\n");
}

export function validateSubBarData(
    subBarResult: SubBarLoadingResult,
    parentCandles: Candle[]
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!subBarResult.isSupported) {
        return { valid: true, errors: [] };
    }

    const expectedCount = getExpectedSubBarCount(subBarResult.parentTimeframe);

    for (const parentCandle of parentCandles) {
        const subBars = subBarResult.subBarCandlesMap.get(parentCandle.bucket);

        if (!subBars || subBars.length === 0) {
            errors.push(`Missing sub-bars for parent at ${parentCandle.bucket}`);
            continue;
        }

        if (subBars.length !== expectedCount) {
            errors.push(
                `Unexpected sub-bar count for parent at ${parentCandle.bucket}: ` +
                    `expected ${expectedCount}, got ${subBars.length}`
            );
        }

        for (let i = 1; i < subBars.length; i++) {
            if (subBars[i]!.bucket <= subBars[i - 1]!.bucket) {
                errors.push(
                    `Sub-bars not in chronological order for parent at ${parentCandle.bucket}`
                );
                break;
            }
        }

        if (subBars[0]!.bucket < parentCandle.bucket) {
            errors.push(
                `First sub-bar timestamp ${subBars[0]!.bucket} is before parent ${parentCandle.bucket}`
            );
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

// =============================================================================
// VALUEFACTOR VALIDATION
// =============================================================================

export function formatValueFactorLoadingSummary(result: ValueFactorLoadingResult): string {
    if (!result.hasDynamicExits) {
        return "No dynamic SL/TP configured";
    }

    const parts: string[] = ["ValueFactor loading complete:"];

    if (result.stopLossIndicatorName) {
        parts.push(`  Stop Loss: ${result.stopLossIndicatorName}`);
    }

    if (result.takeProfitIndicatorName) {
        parts.push(`  Take Profit: ${result.takeProfitIndicatorName}`);
    }

    parts.push(`  Warmup bars: ${result.warmupBars}`);
    parts.push(`  Total calculations: ${result.totalCalculations}`);

    return parts.join("\n");
}
