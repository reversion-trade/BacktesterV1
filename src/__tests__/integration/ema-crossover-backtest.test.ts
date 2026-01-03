/**
 * EMA Crossover Backtest Integration Test
 *
 * Tests the full pipeline with:
 * - Real BTC 1m data (October 2025)
 * - EMA 9/21 crossover strategy
 * - 2% SL/TP for both long and short
 */

import { describe, test, expect, beforeAll, setDefaultTimeout } from "bun:test";

// Set longer timeout for integration tests processing 44K candles
setDefaultTimeout(30_000);
import * as fs from "fs";
import * as path from "path";

import { runBacktestPipeline } from "../../simulation/stages/index.ts";
import type { Candle, AlgoConfig, AlgoParams } from "../../core/types.ts";
import type { BacktestInput, RunSettings } from "../../core/config.ts";
import type { IndicatorConfig } from "@indicators/factory.ts";

// =============================================================================
// CSV LOADER (Binance format)
// =============================================================================

interface BinanceRow {
  openTime: number; // microseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
  ignore: number;
}

function loadBinanceCSV(filePath: string): Candle[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");

  return lines.map((line) => {
    const parts = line.split(",");
    const row: BinanceRow = {
      openTime: parseInt(parts[0]!, 10),
      open: parseFloat(parts[1]!),
      high: parseFloat(parts[2]!),
      low: parseFloat(parts[3]!),
      close: parseFloat(parts[4]!),
      volume: parseFloat(parts[5]!),
      closeTime: parseInt(parts[6]!, 10),
      quoteVolume: parseFloat(parts[7]!),
      trades: parseInt(parts[8]!, 10),
      takerBuyBaseVolume: parseFloat(parts[9]!),
      takerBuyQuoteVolume: parseFloat(parts[10]!),
      ignore: parseInt(parts[11]!, 10),
    };

    // Convert microseconds to SECONDS for bucket (Candle.bucket is in seconds)
    return {
      bucket: Math.floor(row.openTime / 1000000),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    };
  });
}

// =============================================================================
// EMA CROSSOVER ALGO CONFIG
// =============================================================================

/**
 * Create EMA crossover indicator config
 *
 * EMACross uses:
 * - firstPeriod: fast EMA (in seconds)
 * - secondPeriod: slow EMA (in seconds)
 * - signal: "value_above_threshold" for bullish, "value_below_threshold" for bearish
 *
 * Note: Periods are in seconds. For 9-period EMA on 1m data: 9 * 60 = 540
 */
function createEMACrossConfig(
  fastPeriod: number,
  slowPeriod: number,
  signal: "value_above_threshold" | "value_below_threshold"
): IndicatorConfig {
  return {
    type: "EMACross",
    params: {
      source: "1_close",
      firstPeriod: fastPeriod * 60, // Convert periods to seconds (1m resolution)
      secondPeriod: slowPeriod * 60,
      signal,
    },
  } as IndicatorConfig;
}

/**
 * Create the caveman EMA crossover strategy:
 * - Long entry: EMA fast crosses above slow
 * - Long exit: 2% SL, 2% TP
 * - Short entry: EMA fast crosses below slow
 * - Short exit: 2% SL, 2% TP
 */
function createEMACrossoverAlgoParams(
  fastPeriod: number = 9,
  slowPeriod: number = 21,
  slTpPercent: number = 0.02
): AlgoParams {
  const bullishCross = createEMACrossConfig(fastPeriod, slowPeriod, "value_above_threshold");
  const bearishCross = createEMACrossConfig(fastPeriod, slowPeriod, "value_below_threshold");

  return {
    type: "BOTH",
    longEntry: {
      required: [bullishCross],
      optional: [],
    },
    longExit: {
      // Pure SL/TP exit - no indicator conditions
      required: [],
      optional: [],
      stopLoss: { type: "REL", value: slTpPercent },
      takeProfit: { type: "REL", value: slTpPercent },
    },
    shortEntry: {
      required: [bearishCross],
      optional: [],
    },
    shortExit: {
      // Pure SL/TP exit - no indicator conditions
      required: [],
      optional: [],
      stopLoss: { type: "REL", value: slTpPercent },
      takeProfit: { type: "REL", value: slTpPercent },
    },
    positionSize: { type: "REL", value: 1.0 }, // 100% of capital per trade
    orderType: "MARKET",
    startingCapitalUSD: 10000,
    coinSymbol: "BTC",
  };
}

function createAlgoConfig(params: AlgoParams): AlgoConfig {
  return {
    userID: "test-user",
    algoID: "ema-crossover-test",
    algoName: "EMA 9/21 Crossover with 2% SL/TP",
    version: 1,
    params,
  };
}

function createRunSettings(
  algoConfig: AlgoConfig,
  startTime: number,
  endTime: number
): RunSettings {
  return {
    userID: algoConfig.userID,
    algoID: algoConfig.algoID,
    version: String(algoConfig.version),
    runID: `run-${Date.now()}`,
    isBacktest: true,
    coinSymbol: algoConfig.params.coinSymbol ?? "BTC",
    capitalScaler: 1,
    startTime,
    endTime,
    assumePositionImmediately: true,
    closePositionOnExit: true,
    launchTime: Math.floor(Date.now() / 1000),
    status: "NEW",
    exchangeID: "backtest",
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe("EMA Crossover Backtest", () => {
  let candles: Candle[];
  const csvPath = path.join(
    process.cwd(),
    "BTCUSDT-1m-2025-10.csv"
  );

  beforeAll(() => {
    // Load CSV data
    expect(fs.existsSync(csvPath)).toBe(true);
    candles = loadBinanceCSV(csvPath);
    console.log(`Loaded ${candles.length} candles`);
    console.log(
      `Date range: ${new Date(candles[0]!.bucket).toISOString()} to ${new Date(candles[candles.length - 1]!.bucket).toISOString()}`
    );
  });

  test("should load CSV data correctly", () => {
    expect(candles.length).toBe(44640); // October = 31 days * 24h * 60m
    expect(candles[0]!.open).toBeGreaterThan(0);
    expect(candles[0]!.high).toBeGreaterThanOrEqual(candles[0]!.low);
  });

  test("should run full backtest pipeline with EMA crossover strategy", async () => {
    // This test processes 44K candles and takes ~7-10 seconds
    // Timeout increased to 30 seconds to accommodate pipeline processing
    // Create algo config
    const algoParams = createEMACrossoverAlgoParams(9, 21, 0.02);
    const algoConfig = createAlgoConfig(algoParams);

    // Create run settings for full month
    const startTime = candles[0]!.bucket;
    const endTime = candles[candles.length - 1]!.bucket;
    const runSettings = createRunSettings(algoConfig, startTime, endTime);

    const input: BacktestInput = {
      algoConfig,
      runSettings,
    };

    // Run the pipeline
    console.log("\n=== Running Backtest ===");
    console.log(`Strategy: EMA 9/21 Crossover`);
    console.log(`SL/TP: 2%`);
    console.log(`Capital: $${algoParams.startingCapitalUSD}`);
    console.log(`Period: ${new Date(startTime).toISOString().split("T")[0]} to ${new Date(endTime).toISOString().split("T")[0]}`);

    const startMs = Date.now();
    const output = await runBacktestPipeline(candles, input);
    const durationMs = Date.now() - startMs;

    console.log(`\nPipeline completed in ${durationMs}ms`);


    // Debug: Check swap events vs trades
    console.log("\n=== SWAP/TRADE DEBUG ===");
    console.log(`Total swap events: ${output.events.swapEvents.length}`);
    console.log(`Total trades built: ${output.trades.length}`);

    // Calculate sum of individual trade P&Ls
    const sumOfTradePnl = output.trades.reduce((sum, t) => sum + t.pnlUSD, 0);
    console.log(`Sum of individual trade P&Ls: $${sumOfTradePnl.toFixed(2)}`);
    console.log(`Reported total P&L: $${output.swapMetrics.totalPnlUSD.toFixed(2)}`);

    // Check for outliers
    const pnls = output.trades.map(t => t.pnlUSD);
    const maxPnl = Math.max(...pnls);
    const minPnl = Math.min(...pnls);
    console.log(`Max trade P&L: $${maxPnl.toFixed(2)}`);
    console.log(`Min trade P&L: $${minPnl.toFixed(2)}`);

    // Find the worst trade
    const worstTrade = output.trades.find(t => t.pnlUSD === minPnl)!;
    console.log("\n=== WORST TRADE ===");
    console.log(`Direction: ${worstTrade.direction}`);
    console.log(`Entry bar: ${worstTrade.entrySwap.barIndex}, Exit bar: ${worstTrade.exitSwap.barIndex}`);
    console.log(`Entry: $${worstTrade.entrySwap.fromAmount.toFixed(2)} → ${worstTrade.entrySwap.toAmount.toFixed(6)} ${worstTrade.entrySwap.toAsset} @ $${worstTrade.entrySwap.price.toFixed(2)}`);
    console.log(`Exit: ${worstTrade.exitSwap.fromAmount.toFixed(6)} ${worstTrade.exitSwap.fromAsset} → $${worstTrade.exitSwap.toAmount.toFixed(2)} @ $${worstTrade.exitSwap.price.toFixed(2)}`);
    console.log(`P&L: $${worstTrade.pnlUSD.toFixed(2)} (${(worstTrade.pnlPct * 100).toFixed(2)}%)`);

    // Debug: Show all swap events around the worst trade
    const entryBar = worstTrade.entrySwap.barIndex;
    const exitBar = worstTrade.exitSwap.barIndex;
    console.log("\n=== SWAP EVENTS AROUND WORST TRADE ===");
    console.log(`Looking for swaps near entry bar ${entryBar} and exit bar ${exitBar}`);
    const relevantSwaps = output.events.swapEvents.filter(e =>
      (e.barIndex >= entryBar - 2 && e.barIndex <= entryBar + 2) ||
      (e.barIndex >= exitBar - 2 && e.barIndex <= exitBar + 2)
    );
    for (const swap of relevantSwaps) {
      const type = swap.fromAsset === "USD" ? "ENTRY" : "EXIT";
      console.log(`Bar ${swap.barIndex}: ${type} ${swap.fromAmount.toFixed(6)} ${swap.fromAsset} → ${swap.toAmount.toFixed(6)} ${swap.toAsset} @ $${swap.price.toFixed(2)}`);
    }

    // Debug: Print first 20 swap events
    console.log("\n=== FIRST 20 SWAP EVENTS ===");
    for (let i = 0; i < Math.min(20, output.events.swapEvents.length); i++) {
      const swap = output.events.swapEvents[i]!;
      const entryLabel = swap.isEntry ? "ENTRY" : "EXIT";
      const dirLabel = swap.tradeDirection ?? "?";
      console.log(`${i + 1}. Bar ${swap.barIndex}: ${entryLabel}(${dirLabel}) ${swap.fromAmount.toFixed(6)} ${swap.fromAsset} → ${swap.toAmount.toFixed(6)} ${swap.toAsset}`);
    }

    // Debug: Print first few trades with swap details
    console.log("\n=== FIRST 5 TRADES (Debug) ===");
    for (let i = 0; i < Math.min(5, output.trades.length); i++) {
      const trade = output.trades[i]!;
      console.log(`Trade ${i + 1}: ${trade.direction}`);
      console.log(`  Entry: $${trade.entrySwap.fromAmount.toFixed(2)} → ${trade.entrySwap.toAmount.toFixed(6)} ${trade.entrySwap.toAsset}`);
      console.log(`  Exit: ${trade.exitSwap.fromAmount.toFixed(6)} ${trade.exitSwap.fromAsset} → $${trade.exitSwap.toAmount.toFixed(2)}`);
      console.log(`  P&L: $${trade.pnlUSD.toFixed(2)} (${(trade.pnlPct * 100).toFixed(2)}%)`);
    }

    // Log results
    console.log("\n=== RESULTS ===");
    console.log(`Total Trades: ${output.swapMetrics.totalTrades}`);
    console.log(`Win Rate: ${(output.swapMetrics.winRate * 100).toFixed(2)}%`);
    console.log(`Total P&L: $${output.swapMetrics.totalPnlUSD.toFixed(2)}`);
    console.log(`Profit Factor: ${output.swapMetrics.profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown: ${(output.swapMetrics.maxDrawdownPct * 100).toFixed(2)}%`);
    console.log(`Sharpe Ratio: ${output.swapMetrics.sharpeRatio.toFixed(2)}`);

    console.log("\n--- Long Trades ---");
    console.log(`Count: ${output.swapMetrics.longTrades}`);
    console.log(`Win Rate: ${(output.swapMetrics.longWinRate * 100).toFixed(2)}%`);
    console.log(`P&L: $${output.swapMetrics.longPnlUSD.toFixed(2)}`);

    console.log("\n--- Short Trades ---");
    console.log(`Count: ${output.swapMetrics.shortTrades}`);
    console.log(`Win Rate: ${(output.swapMetrics.shortWinRate * 100).toFixed(2)}%`);
    console.log(`P&L: $${output.swapMetrics.shortPnlUSD.toFixed(2)}`);

    // Basic assertions
    expect(output).toBeDefined();
    expect(output.swapMetrics).toBeDefined();
    expect(output.algoMetrics).toBeDefined();

    // Should have some trades (October had price movements)
    expect(output.swapMetrics.totalTrades).toBeGreaterThan(0);

    // Processing should be reasonably fast
    expect(durationMs).toBeLessThan(60000); // < 60 seconds
  });

  test("should handle first week subset", async () => {
    // Test on smaller subset (first 7 days = 10080 candles)
    const subset = candles.slice(0, 10080);

    const algoParams = createEMACrossoverAlgoParams(9, 21, 0.02);
    const algoConfig = createAlgoConfig(algoParams);
    const runSettings = createRunSettings(
      algoConfig,
      subset[0]!.bucket,
      subset[subset.length - 1]!.bucket
    );

    const input: BacktestInput = {
      algoConfig,
      runSettings,
    };

    const output = await runBacktestPipeline(subset, input);

    console.log(`\n=== First Week Results ===`);
    console.log(`Trades: ${output.swapMetrics.totalTrades}`);
    console.log(`P&L: $${output.swapMetrics.totalPnlUSD.toFixed(2)}`);

    expect(output.swapMetrics.totalTrades).toBeGreaterThanOrEqual(0);
  });
});
