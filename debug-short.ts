import * as fs from "fs";
import * as path from "path";

import { executeDataLoading } from "./src/simulation/stages/data-loading.ts";
import { executeIndicatorCalculation, createIndicatorInputFromDataResult } from "./src/simulation/stages/indicator-calculation.ts";
import { executeResampling, createResamplingInput } from "./src/simulation/stages/resampling.ts";
import { executeInitialization } from "./src/simulation/stages/initialization.ts";
import { createBacktestEnvironment } from "./src/factory/backtest-factory.ts";
import type { Candle, AlgoConfig, AlgoParams } from "./src/core/types.ts";
import type { BacktestInput, RunSettings } from "./src/core/config.ts";
import type { IndicatorConfig } from "./src/indicators/factory.ts";

// CSV loader
function loadBinanceCSV(filePath: string): Candle[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.map((line) => {
    const parts = line.split(",");
    return {
      bucket: Math.floor(parseInt(parts[0]!, 10) / 1000000),
      open: parseFloat(parts[1]!),
      high: parseFloat(parts[2]!),
      low: parseFloat(parts[3]!),
      close: parseFloat(parts[4]!),
      volume: parseFloat(parts[5]!),
    };
  });
}

const csvPath = path.join(process.cwd(), "BTCUSDT-1m-2025-10.csv");
const candles = loadBinanceCSV(csvPath).slice(0, 500);

const bullishCross: IndicatorConfig = {
  type: "EMACross",
  params: { source: "1_close", firstPeriod: 540, secondPeriod: 1260, signal: "value_above_threshold" },
} as IndicatorConfig;

const bearishCross: IndicatorConfig = {
  type: "EMACross",
  params: { source: "1_close", firstPeriod: 540, secondPeriod: 1260, signal: "value_below_threshold" },
} as IndicatorConfig;

const algoParams: AlgoParams = {
  type: "BOTH",
  longEntry: { required: [bullishCross], optional: [] },
  longExit: { required: [], optional: [], stopLoss: { type: "REL", value: 0.02 }, takeProfit: { type: "REL", value: 0.02 } },
  shortEntry: { required: [bearishCross], optional: [] },
  shortExit: { required: [], optional: [], stopLoss: { type: "REL", value: 0.02 }, takeProfit: { type: "REL", value: 0.02 } },
  positionSize: { type: "REL", value: 1.0 },
  orderType: "MARKET",
  startingCapitalUSD: 10000,
  coinSymbol: "BTC",
};

const algoConfig: AlgoConfig = { userID: "test", algoID: "test", algoName: "Test", version: 1, params: algoParams };
const runSettings: RunSettings = {
  userID: "test", algoID: "test", version: "1", runID: "test", isBacktest: true, coinSymbol: "BTC",
  capitalScaler: 1, startTime: candles[0]!.bucket, endTime: candles[candles.length - 1]!.bucket,
  assumePositionImmediately: true, closePositionOnExit: true, launchTime: Date.now(), status: "NEW", exchangeID: "backtest",
};

const input: BacktestInput = { algoConfig, runSettings };

// Stage 1
const dataResult = executeDataLoading(candles, input);

// Stage 2
const indicatorInput = createIndicatorInputFromDataResult(dataResult);
const indicatorResult = executeIndicatorCalculation(indicatorInput);

console.log("=== Signal Cache Keys ===");
for (const key of indicatorResult.signalCache.keys()) {
  const signals = indicatorResult.signalCache.get(key)!;
  const trueCount = signals.filter(s => s).length;
  console.log(key + ": " + trueCount + "/" + signals.length + " true");
}

// Stage 3
const resamplingInput = createResamplingInput(dataResult.filteredCandles, indicatorResult);
const resamplingResult = executeResampling(resamplingInput);

console.log("\n=== Resampled Signal Keys ===");
for (const key of resamplingResult.resampledSignals.keys()) {
  const signals = resamplingResult.resampledSignals.get(key)!;
  const trueCount = signals.filter(s => s).length;
  console.log(key + ": " + trueCount + "/" + signals.length + " true");
}

// Stage 4
const initResult = executeInitialization({ dataResult, resamplingResult });

console.log("\n=== Indicator Info Map ===");
for (const [key, info] of initResult.indicatorInfoMap) {
  console.log(key + " => { key: " + info.indicatorKey + ", conditionType: " + info.conditionType + ", isRequired: " + info.isRequired + " }");
}

// Create env
const signalCacheMap = new Map<string, boolean[]>();
for (const key of resamplingResult.resampledSignals.keys()) {
  const signals = resamplingResult.resampledSignals.get(key);
  if (signals) signalCacheMap.set(key, signals);
}

const indicatorInfoForFeed = new Map();
for (const [key, info] of initResult.indicatorInfoMap) {
  indicatorInfoForFeed.set(key, {
    key: info.indicatorKey,
    type: info.indicatorType,
    conditionType: info.conditionType,
    isRequired: info.isRequired,
  });
}

const env = createBacktestEnvironment({
  algoConfig, candles: dataResult.filteredCandles, signalCache: signalCacheMap,
  indicatorInfoMap: indicatorInfoForFeed, feeBps: 10, slippageBps: 5,
});

console.log("\n=== Feed Signal Cache Keys ===");
console.log(env.indicatorFeed.getIndicatorKeys());

console.log("\n=== Feed Indicator Info ===");
for (const [key, info] of env.indicatorFeed.getIndicatorInfo()) {
  console.log(key + " => conditionType: " + info.conditionType + ", key: " + info.key);
}

// Check condition at bar 200
env.indicatorFeed.setCurrentBar(200, candles[200]!.bucket);
const longEntry = env.indicatorFeed.getConditionSnapshot("LONG_ENTRY");
const shortEntry = env.indicatorFeed.getConditionSnapshot("SHORT_ENTRY");

console.log("\n=== Condition Snapshots at Bar 200 ===");
console.log("LONG_ENTRY:", longEntry);
console.log("SHORT_ENTRY:", shortEntry);

const longIndicators = env.indicatorFeed.getIndicatorsForCondition("LONG_ENTRY");
const shortIndicators = env.indicatorFeed.getIndicatorsForCondition("SHORT_ENTRY");

console.log("\n=== Indicators for Conditions ===");
console.log("LONG_ENTRY indicators:", longIndicators.map(i => ({ key: i.key, isRequired: i.isRequired })));
console.log("SHORT_ENTRY indicators:", shortIndicators.map(i => ({ key: i.key, isRequired: i.isRequired })));

// Check signal lookup
for (const ind of longIndicators) {
  const signal = env.indicatorFeed.getSignal(ind.key);
  console.log("\nLONG_ENTRY signal for " + ind.key + ": " + signal);
}
for (const ind of shortIndicators) {
  const signal = env.indicatorFeed.getSignal(ind.key);
  console.log("SHORT_ENTRY signal for " + ind.key + ": " + signal);
}
