/**
 * Debug the full pipeline step by step
 */

import { describe, test, expect, beforeAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { executeDataLoading } from "../../simulation/stages/data-loading.ts";
import {
    executeIndicatorCalculation,
    createIndicatorInputFromDataResult,
} from "../../simulation/stages/indicator-calculation.ts";
import { executeResampling, createResamplingInput } from "../../simulation/stages/resampling.ts";
import { executeInitialization } from "../../simulation/stages/initialization.ts";
import { runBacktestWithAlgoRunner } from "../../simulation/algo-runner.ts";
import { createBacktestEnvironment } from "../../factory/backtest-factory.ts";
import type { Candle, AlgoConfig, AlgoParams } from "../../core/types.ts";
import type { BacktestInput, RunSettings } from "../../core/config.ts";
import type { IndicatorConfig } from "@indicators/factory.ts";

// CSV loader
function loadBinanceCSV(filePath: string): Candle[] {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");

    return lines.map((line) => {
        const parts = line.split(",");
        return {
            bucket: Math.floor(parseInt(parts[0]!, 10) / 1000000), // microsec to SECONDS
            open: parseFloat(parts[1]!),
            high: parseFloat(parts[2]!),
            low: parseFloat(parts[3]!),
            close: parseFloat(parts[4]!),
            volume: parseFloat(parts[5]!),
        };
    });
}

describe("Debug Full Pipeline", () => {
    let candles: Candle[];
    const csvPath = path.join(process.cwd(), "BTCUSDT-1m-2025-10.csv");

    beforeAll(() => {
        candles = loadBinanceCSV(csvPath).slice(0, 1000); // First 1000 candles only
    });

    test("trace through pipeline with logging", async () => {
        // Create indicator configs
        const bullishCross: IndicatorConfig = {
            type: "EMACross",
            params: {
                source: "1_close",
                firstPeriod: 9 * 60,
                secondPeriod: 21 * 60,
                signal: "value_above_threshold",
            },
        } as IndicatorConfig;

        const bearishCross: IndicatorConfig = {
            type: "EMACross",
            params: {
                source: "1_close",
                firstPeriod: 9 * 60,
                secondPeriod: 21 * 60,
                signal: "value_below_threshold",
            },
        } as IndicatorConfig;

        const algoParams: AlgoParams = {
            type: "BOTH",
            longEntry: { required: [bullishCross], optional: [] },
            longExit: {
                required: [],
                optional: [],
                stopLoss: { type: "REL", value: 0.02 },
                takeProfit: { type: "REL", value: 0.02 },
            },
            shortEntry: { required: [bearishCross], optional: [] },
            shortExit: {
                required: [],
                optional: [],
                stopLoss: { type: "REL", value: 0.02 },
                takeProfit: { type: "REL", value: 0.02 },
            },
            positionSize: { type: "REL", value: 1.0 },
            orderType: "MARKET",
            startingCapitalUSD: 10000,
            coinSymbol: "BTC",
            timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 },
        };

        const algoConfig: AlgoConfig = {
            userID: "test",
            algoID: "test",
            algoName: "Test",
            version: 1,
            params: algoParams,
        };

        const runSettings: RunSettings = {
            userID: "test",
            algoID: "test",
            version: "1",
            runID: "test-run",
            isBacktest: true,
            coinSymbol: "BTC",
            capitalScaler: 1,
            startTime: candles[0]!.bucket,
            endTime: candles[candles.length - 1]!.bucket,
            closePositionOnExit: true,
            launchTime: Date.now(),
            status: "NEW",
            exchangeID: "backtest",
        };

        const input: BacktestInput = { algoConfig, runSettings, feeBps: 10, slippageBps: 5 };

        // Stage 1
        const dataResult = executeDataLoading(candles, input);
        console.log("\n=== Stage 1: Data Loading ===");
        console.log(`Candles: ${dataResult.filteredCandles.length}`);
        console.log(`Initial capital: $${dataResult.initialCapital}`);

        // Stage 2
        const indicatorInput = createIndicatorInputFromDataResult(dataResult);
        const indicatorResult = executeIndicatorCalculation(indicatorInput);
        console.log("\n=== Stage 2: Indicator Calculation ===");
        console.log(`Indicator configs: ${indicatorResult.indicatorConfigs.length}`);
        console.log(`Indicator keys:`, indicatorResult.indicatorKeys);
        console.log(`Warmup candles: ${indicatorResult.warmupCandles}`);

        // Check signals
        for (const key of indicatorResult.indicatorKeys) {
            const signals = indicatorResult.signalCache.get(key)!;
            const trueCount = signals.filter((s) => s).length;
            console.log(`  ${key.substring(0, 50)}... ${trueCount}/${signals.length} true`);
        }

        // Stage 3
        const resamplingInput = createResamplingInput(dataResult.filteredCandles, indicatorResult);
        const resamplingResult = executeResampling(resamplingInput);
        console.log("\n=== Stage 3: Resampling ===");
        console.log(`Warmup bars: ${resamplingResult.warmupBars}`);
        console.log(`Total simulation bars: ${resamplingResult.totalSimulationBars}`);

        // Stage 4
        const initResult = executeInitialization({
            dataResult,
            resamplingResult,
        });
        console.log("\n=== Stage 4: Initialization ===");
        console.log(`Indicator info map size: ${initResult.indicatorInfoMap.size}`);
        for (const [key, info] of initResult.indicatorInfoMap) {
            console.log(`  ${info.conditionType}: ${info.indicatorType} (required: ${info.isRequired})`);
        }

        // Stage 5: Create environment and run
        const signalCacheMap = new Map<string, boolean[]>();
        for (const key of resamplingResult.resampledSignals.keys()) {
            const signals = resamplingResult.resampledSignals.get(key);
            if (signals) signalCacheMap.set(key, signals);
        }

        const indicatorInfoForFeed = new Map<string, import("../../interfaces/indicator-feed.ts").IndicatorInfo>();
        for (const [key, info] of initResult.indicatorInfoMap) {
            indicatorInfoForFeed.set(key, {
                key: info.indicatorKey,
                type: info.indicatorType,
                conditionType: info.conditionType,
                isRequired: info.isRequired,
            });
        }

        console.log("\n=== Stage 5: Creating Environment ===");
        console.log(`Signal cache size: ${signalCacheMap.size}`);
        console.log(`Indicator info for feed size: ${indicatorInfoForFeed.size}`);

        const env = createBacktestEnvironment({
            algoConfig,
            candles: dataResult.filteredCandles,
            signalCache: signalCacheMap,
            indicatorInfoMap: indicatorInfoForFeed,
            feeBps: initResult.feeBps,
            slippageBps: initResult.slippageBps,
        });

        // Check first few bars of signals
        console.log("\n=== Signal values at key bars ===");
        const keys = Array.from(signalCacheMap.keys());
        for (let bar = 0; bar < Math.min(200, candles.length); bar += 50) {
            console.log(`Bar ${bar}:`);
            for (const key of keys) {
                const signals = signalCacheMap.get(key)!;
                console.log(`  ${key.includes("above") ? "BULLISH" : "BEARISH"}: ${signals[bar]}`);
            }
        }

        // Manually check condition snapshot at bar 168 (first after warmup)
        console.log("\n=== Condition check at bar 168 ===");
        env.indicatorFeed.setCurrentBar(168, candles[168]!.bucket);
        const longEntrySnapshot = env.indicatorFeed.getConditionSnapshot("LONG_ENTRY");
        const shortEntrySnapshot = env.indicatorFeed.getConditionSnapshot("SHORT_ENTRY");
        console.log("LONG_ENTRY:", longEntrySnapshot);
        console.log("SHORT_ENTRY:", shortEntrySnapshot);

        // Run the simulation
        console.log("\n=== Stage 5: Running Simulation ===");
        const algoResult = await runBacktestWithAlgoRunner(
            env.executor,
            env.database,
            env.indicatorFeed,
            dataResult.filteredCandles,
            {
                algoParams: initResult.algoParams,
                symbol: initResult.symbol,
                tradesLimit: initResult.tradesLimit,
                warmupBars: resamplingResult.warmupBars,
            },
            initResult.closePositionOnExit
        );

        console.log(`\nTotal trades: ${algoResult.totalTrades}`);
        console.log(`Final equity: $${algoResult.finalEquity}`);
        console.log(`Final position: ${algoResult.finalPositionState}`);

        // Check bar results for entries/exits
        let entriesCount = 0;
        let exitsCount = 0;
        for (const result of algoResult.barResults) {
            if (result.entryOccurred) {
                entriesCount++;
                if (entriesCount <= 5) {
                    console.log(`Entry at bar ${result.barIndex}, position: ${result.positionState}`);
                }
            }
            if (result.exitOccurred) {
                exitsCount++;
                if (exitsCount <= 5) {
                    console.log(`Exit at bar ${result.barIndex}, position: ${result.positionState}`);
                }
            }
        }
        console.log(`Total entries: ${entriesCount}, exits: ${exitsCount}`);

        // Check swap events - FakeExecutor creates them, NOT FakeDatabase
        const swapEventsFromDb = await env.database.getSwapEvents();
        console.log(`\nSwap events (from database - should be 0): ${swapEventsFromDb.length}`);

        // Get swap events from executor where they're actually created
        const executor = env.executor as import("../../simulation/fakes/fake-executor.ts").FakeExecutor;
        const swapEventsFromExecutor = executor.getSwapEvents();
        console.log(`Swap events (from executor): ${swapEventsFromExecutor.length}`);
        for (const swap of swapEventsFromExecutor.slice(0, 5)) {
            console.log(`  ${swap.fromAsset} -> ${swap.toAsset}: ${swap.fromAmount} -> ${swap.toAmount}`);
        }

        expect(algoResult).toBeDefined();
    });
});
