import * as fs from "fs";
import { runBacktestPipeline } from "./src/simulation/stages/index.ts";
import type { Candle, AlgoParams, AlgoConfig } from "./src/core/types.ts";
import type { BacktestInput, RunSettings } from "./src/core/config.ts";
import type { IndicatorConfig } from "./src/indicators/factory.ts";

const content = fs.readFileSync("BTCUSDT-1m-2025-10.csv", "utf-8");
const lines = content.trim().split("\n").slice(0, 5000);
const candles: Candle[] = lines.map((line) => {
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

const algoParams: AlgoParams = {
  type: "BOTH",
  longEntry: {
    required: [{
      type: "EMACross",
      params: { source: "1_close", firstPeriod: 540, secondPeriod: 1260, signal: "value_above_threshold" },
    } as IndicatorConfig],
    optional: [],
  },
  longExit: { required: [], optional: [], stopLoss: { type: "REL", value: 0.02 }, takeProfit: { type: "REL", value: 0.02 } },
  shortEntry: {
    required: [{
      type: "EMACross",
      params: { source: "1_close", firstPeriod: 540, secondPeriod: 1260, signal: "value_below_threshold" },
    } as IndicatorConfig],
    optional: [],
  },
  shortExit: { required: [], optional: [], stopLoss: { type: "REL", value: 0.02 }, takeProfit: { type: "REL", value: 0.02 } },
  positionSize: { type: "REL", value: 1.0 },
  orderType: "MARKET",
  startingCapitalUSD: 10000,
  coinSymbol: "BTC",
};

const algoConfig: AlgoConfig = { userID: "test", algoID: "ema-test", algoName: "EMA Test", version: 1, params: algoParams };
const runSettings: RunSettings = {
  userID: "test", algoID: "ema-test", version: "1", runID: "run-1", isBacktest: true, coinSymbol: "BTC",
  capitalScaler: 1, startTime: candles[0]!.bucket, endTime: candles[candles.length - 1]!.bucket,
  assumePositionImmediately: true, closePositionOnExit: true, launchTime: Math.floor(Date.now() / 1000), status: "NEW", exchangeID: "backtest",
};

const input: BacktestInput = { algoConfig, runSettings };

async function run() {
  const output = await runBacktestPipeline(candles, input);

  console.log("\n=== KEY METRICS ===");
  console.log("Total Trades:", output.swapMetrics.totalTrades);
  console.log("Win Rate:", (output.swapMetrics.winRate * 100).toFixed(2) + "%");
  console.log("Total P&L: $" + output.swapMetrics.totalPnlUSD.toFixed(2));
  console.log("Max Drawdown:", (output.swapMetrics.maxDrawdownPct * 100).toFixed(2) + "%");
  console.log("Max Drawdown USD: $" + output.swapMetrics.maxDrawdownUSD.toFixed(2));
  console.log("Sharpe Ratio:", output.swapMetrics.sharpeRatio.toFixed(2));
  console.log("Sortino Ratio:", output.swapMetrics.sortinoRatio.toFixed(2));
  console.log("Calmar Ratio:", output.swapMetrics.calmarRatio.toFixed(2));
  console.log("Profit Factor:", output.swapMetrics.profitFactor.toFixed(2));

  // Check equity curve
  const minEquity = Math.min(...output.equityCurve.map(e => e.equity));
  const maxEquity = Math.max(...output.equityCurve.map(e => e.equity));
  console.log("\nEquity Range: $" + minEquity.toFixed(2) + " - $" + maxEquity.toFixed(2));

  // Check first few equity points
  console.log("\nFirst 10 equity points:");
  output.equityCurve.slice(0, 10).forEach((p, i) => {
    console.log("  " + i + ": equity=$" + p.equity.toFixed(2) + ", dd=" + (p.drawdownPct * 100).toFixed(2) + "%");
  });

  console.log("\n=== ALGO METRICS ===");
  console.log("Event Counts:", JSON.stringify(output.algoMetrics.eventCounts));
  console.log("Exit Breakdown:", JSON.stringify(output.algoMetrics.exitReasonBreakdown));
  console.log("Condition Triggers:", JSON.stringify(output.algoMetrics.conditionTriggerCounts));

  console.log("\n=== INDICATOR ANALYSIS ===");
  for (const ind of output.algoMetrics.indicatorAnalysis) {
    console.log(`\n[${ind.conditionType}] ${ind.indicatorType} (${ind.isRequired ? "REQUIRED" : "optional"})`);
    console.log(`  Key: ${ind.indicatorKey.substring(0, 60)}...`);
    console.log(`  Flip Count: ${ind.flipCount}`);
    console.log(`  % Time True: ${(ind.pctTimeTrue * 100).toFixed(1)}%`);
    console.log(`  Avg Duration True: ${ind.avgDurationTrueBars.toFixed(1)} bars`);
    console.log(`  Avg Duration False: ${ind.avgDurationFalseBars.toFixed(1)} bars`);
    console.log(`  Triggering Flips: ${ind.triggeringFlipCount} (times this indicator triggered the condition)`);
    console.log(`  Blocking Count: ${ind.blockingCount} (times this was the only blocker)`);
    console.log(`  Usefulness Score: ${ind.usefulnessScore}/100`);
  }

  console.log("\n=== NEAR MISS ANALYSIS ===");
  for (const nm of output.algoMetrics.nearMissAnalysis) {
    console.log(`\n[${nm.conditionType}]`);
    console.log(`  Total Evaluations: ${nm.totalEvaluations}`);
    console.log(`  Trigger Count: ${nm.triggerCount}`);
    console.log(`  Closest Approach Without Trigger: ${nm.closestApproachWithoutTrigger}`);
    console.log(`  Distance Histogram:`, nm.distanceHistogram);
  }

  console.log("\n=== STATE DISTRIBUTION ===");
  const sd = output.algoMetrics.stateDistribution;
  console.log(`  Time FLAT: ${(sd.pctTimeFlat * 100).toFixed(1)}% (avg ${sd.avgTimeFlatBars.toFixed(1)} bars)`);
  console.log(`  Time LONG: ${(sd.pctTimeLong * 100).toFixed(1)}% (avg ${sd.avgTimeLongBars.toFixed(1)} bars)`);
  console.log(`  Time SHORT: ${(sd.pctTimeShort * 100).toFixed(1)}% (avg ${sd.avgTimeShortBars.toFixed(1)} bars)`);
}

run();
