/**
 * Debug signal generation for EMA crossover
 */

import { describe, test, expect, beforeAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { executeDataLoading } from "../../simulation/stages/data-loading.ts";
import { executeIndicatorCalculation, createIndicatorInputFromDataResult } from "../../simulation/stages/indicator-calculation.ts";
import { executeResampling, createResamplingInput } from "../../simulation/stages/resampling.ts";
import type { Candle, AlgoConfig, AlgoParams } from "../../core/types.ts";
import type { BacktestInput, RunSettings } from "../../core/config.ts";
import type { IndicatorConfig } from "@indicators/factory.ts";
import { makeIndicator } from "@indicators/factory.ts";

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

describe("Debug Signal Generation", () => {
  let candles: Candle[];
  const csvPath = path.join(process.cwd(), "BTCUSDT-1m-2025-10.csv");

  beforeAll(() => {
    candles = loadBinanceCSV(csvPath);
  });

  test("check indicator config creation", () => {
    const config: IndicatorConfig = {
      type: "EMACross",
      params: {
        source: "1_close",
        firstPeriod: 9 * 60,  // 540 seconds
        secondPeriod: 21 * 60, // 1260 seconds
        signal: "value_above_threshold",
      },
    } as IndicatorConfig;

    // Try to create the indicator
    const indicator = makeIndicator(config);
    console.log("Indicator created:", indicator.getCacheKey());
    console.log("Warmup:", indicator.getPointRequirements());

    expect(indicator).toBeDefined();
  });

  test("check signal calculation", () => {
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

    // Create algo params
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
      assumePositionImmediately: true,
      closePositionOnExit: true,
      launchTime: Date.now(),
      status: "NEW",
      exchangeID: "backtest",
    };

    const input: BacktestInput = { algoConfig, runSettings };

    // Stage 1
    const dataResult = executeDataLoading(candles, input);
    console.log("Stage 1: Loaded", dataResult.filteredCandles.length, "candles");

    // Stage 2
    const indicatorInput = createIndicatorInputFromDataResult(dataResult);
    console.log("Stage 2 input algoParams type:", indicatorInput.algoParams.type);

    const indicatorResult = executeIndicatorCalculation(indicatorInput);
    console.log("Stage 2: Warmup candles:", indicatorResult.warmupCandles);
    console.log("Stage 2: Indicator configs:", indicatorResult.indicatorConfigs.length);
    console.log("Signal cache keys:", indicatorResult.indicatorKeys);

    // Check signal values
    for (const key of indicatorResult.indicatorKeys) {
      const signals = indicatorResult.signalCache.get(key)!;
      const trueCount = signals.filter(s => s).length;
      console.log(`Key ${key}: ${trueCount}/${signals.length} true signals`);

      // Show first 10 signal transitions
      let transitions = 0;
      for (let i = 1; i < signals.length && transitions < 10; i++) {
        if (signals[i] !== signals[i-1]) {
          console.log(`  Transition at bar ${i}: ${signals[i-1]} -> ${signals[i]}`);
          transitions++;
        }
      }
    }

    // Stage 3
    const resamplingInput = createResamplingInput(dataResult.filteredCandles, indicatorResult);
    const resamplingResult = executeResampling(resamplingInput);
    console.log("\nStage 3: Warmup bars:", resamplingResult.warmupBars);
    console.log("Resampled signal keys:", resamplingResult.resampledSignals.keys());

    for (const key of resamplingResult.resampledSignals.keys()) {
      const signals = resamplingResult.resampledSignals.get(key)!;
      const trueCount = signals.filter(s => s).length;
      console.log(`Resampled ${key}: ${trueCount}/${signals.length} true signals`);
    }

    expect(indicatorResult.indicatorKeys.length).toBeGreaterThan(0);
  });
});
