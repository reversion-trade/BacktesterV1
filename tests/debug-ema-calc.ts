/**
 * Debug EMA Calculation - Trace what resolution and points are actually used
 */
import { runBacktestPipeline } from "../src/simulation/stages/index.ts";
import { executeDataLoading } from "../src/simulation/stages/data-loading.ts";
import { executeMipMapBuilding, createMipMapInputFromDataResult, getAvailableResolutions, lookupResolution } from "../src/simulation/stages/index.ts";
import { collectIndicatorConfigs } from "../src/indicators/calculator.ts";
import { makeIndicator } from "@indicators/factory.ts";
import type { BacktestInput, RunSettings } from "../src/core/config.ts";
import type { AlgoConfig, AlgoParams, IndicatorConfig } from "../src/core/types.ts";
import type { Candle } from "../src/core/types.ts";
import * as fs from "fs";

// Load candles
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

// Create EMA crossover indicator config
function createEMACrossConfig(
    fastPeriod: number,
    slowPeriod: number,
    signal: "value_above_threshold" | "value_below_threshold"
): IndicatorConfig {
    return {
        type: "EMACross",
        params: {
            source: "1_close",
            firstPeriod: fastPeriod * 60,
            secondPeriod: slowPeriod * 60,
            signal,
        },
    } as IndicatorConfig;
}

// Create algo params
function createAlgoParams(): AlgoParams {
    const bullishCross = createEMACrossConfig(9, 21, "value_above_threshold");
    const bearishCross = createEMACrossConfig(9, 21, "value_below_threshold");

    return {
        type: "LONG",
        longEntry: {
            required: [bullishCross],
            optional: []
        },
        longExit: {
            required: [bearishCross],
            optional: []
        },
        positionSize: { type: "ABS", value: 1000 },
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 }
    };
}

console.log("=".repeat(80));
console.log("DEBUG: EMA CALCULATION TRACE");
console.log("=".repeat(80));

const candles = loadCandles();
console.log(`\nLoaded ${candles.length} candles`);

const algoParams = createAlgoParams();
const indicatorConfigs = collectIndicatorConfigs(algoParams);

console.log("\n--- Indicator Analysis ---");
for (const config of indicatorConfigs) {
    const indicator = makeIndicator(config);
    const requirements = indicator.getPointRequirements();
    const cacheKey = indicator.getCacheKey();

    console.log(`\nIndicator: ${config.type}`);
    console.log(`  Cache Key: ${cacheKey}`);
    console.log(`  Point Requirements:`);
    console.log(`    Resolution: ${requirements.resolution}s (${requirements.resolution/60}m)`);
    console.log(`    Count: ${requirements.count}`);
    console.log(`  Params:`, JSON.stringify(config.params, null, 2).split('\n').map(l => '    ' + l).join('\n'));
}

// Build MIP-map to see what resolutions are available
const algoConfig: AlgoConfig = {
    userID: "test",
    algoID: "debug",
    algoName: "Debug",
    version: 1,
    params: algoParams
};

const runSettings: RunSettings = {
    userID: "test",
    algoID: "debug",
    version: "1",
    runID: "debug",
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
const dataResult = executeDataLoading(candles, input);
const mipMapInput = createMipMapInputFromDataResult(dataResult);
const mipMapResult = executeMipMapBuilding(mipMapInput);

console.log("\n--- MIP-Map Analysis ---");
console.log(`Base Resolution: ${mipMapResult.baseResolution}s`);
console.log(`Min Indicator Resolution: ${mipMapResult.minIndicatorResolution}s`);
console.log(`Resolutions Built: ${mipMapResult.resolutionsBuilt.map(r => r + 's').join(', ')}`);
console.log(`Available Resolutions: ${getAvailableResolutions(mipMapResult.mipMap).map(r => r + 's').join(', ')}`);

// Check what resolution each indicator actually gets
console.log("\n--- Resolution Lookups ---");
for (const config of indicatorConfigs) {
    const indicator = makeIndicator(config);
    const requirements = indicator.getPointRequirements();
    const lookup = lookupResolution(mipMapResult.mipMap, requirements.resolution);

    console.log(`\n${config.type}:`);
    console.log(`  Requested: ${lookup.requestedResolution}s`);
    console.log(`  Actual: ${lookup.actualResolution}s`);
    console.log(`  Exact Match: ${lookup.exactMatch}`);
    console.log(`  Candle Count: ${lookup.candleCount}`);
}

// Now run full backtest and print the warmupCandles
console.log("\n--- Full Backtest ---");
const output = runBacktestPipeline(candles, input);
console.log(`Total Bars Processed: ${output.totalBarsProcessed}`);
console.log(`Total Trades: ${output.swapMetrics.totalTrades}`);
console.log(`First Entry Bar: ${output.trades[0]?.entrySwap?.barIndex ?? 'N/A'}`);
console.log(`First Exit Bar: ${output.trades[0]?.exitSwap?.barIndex ?? 'N/A'}`);
