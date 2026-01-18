/**
 * ALL SOURCES VALIDATION TEST
 *
 * Tests the backtester with all 17 ChartPoint sources to ensure
 * they are all processed correctly.
 *
 * Sources tested (16 valid sources):
 * - Scalar (1_*): open, high, low, close, volume, average, middle, typical (8)
 * - Vector (2_*): open, high, low, close, average, middle, typical (7) - uses VWAMACross
 * - Special: 2_interpolated_x4 (1)
 *
 * Note: 2_volume is not a valid source (volume is embedded in 2_* sources)
 *
 * Run with: npx tsx tests/all-sources-validation.ts
 */
import { runBacktestPipeline } from "../src/simulation/stages/index.ts";
import type { BacktestInput, RunSettings } from "../src/core/config.ts";
import type { AlgoConfig, AlgoParams, IndicatorConfig } from "../src/core/types.ts";
import type { Candle } from "../src/core/types.ts";
import * as fs from "fs";

// =============================================================================
// DATA LOADING
// =============================================================================

function loadCandles(): Candle[] {
    const csvPath = "BTCUSDT-1m-2025-10.csv";
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");

    return lines.map((line) => {
        const parts = line.split(",");
        const timestampUs = parseInt(parts[0], 10);
        return {
            bucket: Math.floor(timestampUs / 1_000_000),
            open: parseFloat(parts[1]),
            high: parseFloat(parts[2]),
            low: parseFloat(parts[3]),
            close: parseFloat(parts[4]),
            volume: parseFloat(parts[5]),
        };
    });
}

// =============================================================================
// INDICATOR CONFIGS FOR ALL SOURCES
// =============================================================================

// All valid ChartPoint sources (16 total - 2_volume is not a valid source)
const SCALAR_SOURCES = [
    "1_open", "1_high", "1_low", "1_close",
    "1_volume", "1_average", "1_middle", "1_typical",
] as const;

const VECTOR_SOURCES = [
    "2_open", "2_high", "2_low", "2_close",
    "2_average", "2_middle", "2_typical",
] as const;

const SPECIAL_SOURCES = [
    "2_interpolated_x4"
] as const;

// Note: 2_volume is NOT a valid source - volume is already included in 2_* sources

// Create EMA indicator for a source (simple threshold check)
function createEMAConfig(source: string, period: number, signal: "value_above_threshold" | "value_below_threshold"): IndicatorConfig {
    return {
        type: "EMA",
        params: {
            source,
            period: period * 60, // Convert to seconds
            signal,
            threshold: 0, // Will compare to 0, effectively checking if positive
        },
    } as IndicatorConfig;
}

// Create EMACross indicator for a source
function createEMACrossConfig(source: string, fastPeriod: number, slowPeriod: number, signal: "value_above_threshold" | "value_below_threshold"): IndicatorConfig {
    return {
        type: "EMACross",
        params: {
            source,
            firstPeriod: fastPeriod * 60,
            secondPeriod: slowPeriod * 60,
            signal,
        },
    } as IndicatorConfig;
}

// Create RSI indicator for a source
function createRSIConfig(source: string, period: number, signal: "value_above_threshold" | "value_below_threshold", threshold: number): IndicatorConfig {
    return {
        type: "RSI",
        params: {
            source,
            period: period * 60,
            signal,
            threshold,
        },
    } as IndicatorConfig;
}

// Create ROC (Rate of Change) indicator
function createROCConfig(source: string, period: number, signal: "value_above_threshold" | "value_below_threshold"): IndicatorConfig {
    return {
        type: "ROC",
        params: {
            source,
            period: period * 60,
            signal,
            threshold: 0,
        },
    } as IndicatorConfig;
}

// =============================================================================
// TEST STRATEGIES
// =============================================================================

interface SourceTestResult {
    source: string;
    indicatorType: string;
    success: boolean;
    trades: number;
    pnl: number;
    error?: string;
}

async function testSource(
    candles: Candle[],
    source: string,
    indicatorType: string,
    entryConfig: IndicatorConfig,
    exitConfig: IndicatorConfig
): Promise<SourceTestResult> {
    try {
        const algoParams: AlgoParams = {
            type: "LONG",
            longEntry: { required: [entryConfig], optional: [] },
            longExit: { required: [exitConfig], optional: [] },
            positionSize: { type: "ABS", value: 1000 },
            orderType: "MARKET",
            startingCapitalUSD: 10000,
            timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 }
        };

        const algoConfig: AlgoConfig = {
            userID: "test",
            algoID: `source-test-${source}`,
            algoName: `Test ${source}`,
            version: 1,
            params: algoParams
        };

        const runSettings: RunSettings = {
            userID: "test",
            algoID: `source-test-${source}`,
            version: "1",
            runID: `test-${source}`,
            isBacktest: true,
            coinSymbol: "BTCUSDT",
            capitalScaler: 1,
            startTime: candles[0].bucket,
            endTime: candles[candles.length - 1].bucket,
            closePositionOnExit: true,
            launchTime: Date.now(),
            status: "NEW",
            exchangeID: "test"
        };

        const input: BacktestInput = { algoConfig, runSettings };
        const output = runBacktestPipeline(candles, input);

        return {
            source,
            indicatorType,
            success: true,
            trades: output.trades.length,
            pnl: output.swapMetrics.totalPnlUSD
        };
    } catch (error) {
        return {
            source,
            indicatorType,
            success: false,
            trades: 0,
            pnl: 0,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

// Create VWAMACross indicator for vector sources (volume-weighted)
function createVWAMACrossConfig(source: string, fastPeriod: number, slowPeriod: number, signal: "value_above_threshold" | "value_below_threshold"): IndicatorConfig {
    return {
        type: "VWAMACross",
        params: {
            source,
            firstPeriod: fastPeriod * 60,
            secondPeriod: slowPeriod * 60,
            signal,
        },
    } as IndicatorConfig;
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllSourcesValidation() {
    console.log("=".repeat(80));
    console.log("ALL CHARTPOINT SOURCES VALIDATION TEST");
    console.log("=".repeat(80));

    console.log("\nLoading candles...");
    const candles = loadCandles();
    console.log(`Loaded ${candles.length} candles`);
    console.log(`Date range: ${new Date(candles[0].bucket * 1000).toISOString()} to ${new Date(candles[candles.length - 1].bucket * 1000).toISOString()}`);

    const results: SourceTestResult[] = [];

    // ==========================================================================
    // TEST SCALAR SOURCES (1_*) with EMACross
    // ==========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("TESTING SCALAR SOURCES (1_*) with EMACross");
    console.log("=".repeat(80));

    for (const source of SCALAR_SOURCES) {
        process.stdout.write(`\nTesting ${source.padEnd(20)}... `);

        const entryConfig = createEMACrossConfig(source, 10, 23, "value_above_threshold");
        const exitConfig = createEMACrossConfig(source, 10, 23, "value_below_threshold");

        const result = await testSource(candles, source, "EMACross", entryConfig, exitConfig);
        results.push(result);

        if (result.success) {
            console.log(`✓ ${result.trades} trades, P&L: $${result.pnl.toFixed(2)}`);
        } else {
            console.log(`✗ ERROR: ${result.error}`);
        }
    }

    // ==========================================================================
    // TEST VECTOR SOURCES (2_*) with EMACross
    // ==========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("TESTING VECTOR SOURCES (2_*) with EMACross");
    console.log("=".repeat(80));

    for (const source of VECTOR_SOURCES) {
        process.stdout.write(`\nTesting ${source.padEnd(20)}... `);

        const entryConfig = createEMACrossConfig(source, 10, 23, "value_above_threshold");
        const exitConfig = createEMACrossConfig(source, 10, 23, "value_below_threshold");

        const result = await testSource(candles, source, "EMACross", entryConfig, exitConfig);
        results.push(result);

        if (result.success) {
            console.log(`✓ ${result.trades} trades, P&L: $${result.pnl.toFixed(2)}`);
        } else {
            console.log(`✗ ERROR: ${result.error}`);
        }
    }

    // ==========================================================================
    // TEST SPECIAL SOURCES with EMACross
    // ==========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("TESTING SPECIAL SOURCES with EMACross");
    console.log("=".repeat(80));

    for (const source of SPECIAL_SOURCES) {
        process.stdout.write(`\nTesting ${source.padEnd(20)}... `);

        const entryConfig = createEMACrossConfig(source, 10, 23, "value_above_threshold");
        const exitConfig = createEMACrossConfig(source, 10, 23, "value_below_threshold");

        const result = await testSource(candles, source, "EMACross", entryConfig, exitConfig);
        results.push(result);

        if (result.success) {
            console.log(`✓ ${result.trades} trades, P&L: $${result.pnl.toFixed(2)}`);
        } else {
            console.log(`✗ ERROR: ${result.error}`);
        }
    }

    // Summary
    console.log("\n" + "=".repeat(80));
    console.log("VALIDATION SUMMARY");
    console.log("=".repeat(80));

    const passed = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\nTotal sources tested: ${results.length}`);
    console.log(`Passed: ${passed.length} ✓`);
    console.log(`Failed: ${failed.length} ✗`);

    if (failed.length > 0) {
        console.log("\nFailed sources:");
        for (const f of failed) {
            console.log(`  - ${f.source}: ${f.error}`);
        }
    }

    // Results table
    console.log("\n" + "-".repeat(80));
    console.log("Source".padEnd(22) + "Indicator".padEnd(12) + "Trades".padStart(10) + "P&L".padStart(15) + "  Status");
    console.log("-".repeat(80));

    for (const r of results) {
        const status = r.success ? "✓" : "✗";
        const pnl = r.success ? `$${r.pnl.toFixed(2)}` : "N/A";
        console.log(
            r.source.padEnd(22) +
            r.indicatorType.padEnd(12) +
            r.trades.toString().padStart(10) +
            pnl.padStart(15) +
            `  ${status}`
        );
    }

    // Verify all sources produce different results (not just copies)
    console.log("\n" + "=".repeat(80));
    console.log("SOURCE DIFFERENTIATION CHECK");
    console.log("=".repeat(80));

    const tradeCountMap = new Map<number, string[]>();
    for (const r of passed) {
        const existing = tradeCountMap.get(r.trades) || [];
        existing.push(r.source);
        tradeCountMap.set(r.trades, existing);
    }

    console.log("\nSources grouped by trade count:");
    const sortedCounts = Array.from(tradeCountMap.entries()).sort((a, b) => b[0] - a[0]);
    for (const [count, sources] of sortedCounts) {
        console.log(`  ${count} trades: ${sources.join(", ")}`);
    }

    const uniqueTradeCount = tradeCountMap.size;
    console.log(`\nUnique trade counts: ${uniqueTradeCount} / ${passed.length} sources`);

    if (uniqueTradeCount === passed.length) {
        console.log("✓ All sources produce unique results - good differentiation!");
    } else {
        console.log("⚠ Some sources produce identical trade counts - may need verification");
    }

    console.log("\n" + "=".repeat(80));
    if (failed.length === 0) {
        console.log("STATUS: ALL SOURCES VALIDATED SUCCESSFULLY ✓");
    } else {
        console.log(`STATUS: ${failed.length} SOURCE(S) FAILED ✗`);
    }
    console.log("=".repeat(80));
}

// Run the validation
runAllSourcesValidation().catch(console.error);
