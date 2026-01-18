/**
 * TypeScript vs Python Backtester Comparison
 *
 * Runs EMA crossover backtest and outputs detailed trade data
 * for comparison with Python validation script.
 *
 * Run with: npx tsx tests/ts-python-comparison.ts
 */
import { runBacktestPipeline } from "../src/simulation/stages/index.ts";
import type { BacktestInput, RunSettings } from "../src/core/config.ts";
import type { AlgoConfig, AlgoParams } from "../src/core/types.ts";
import type { IndicatorConfig } from "@indicators/factory.ts";
import type { Candle } from "../src/core/types.ts";
import * as fs from "fs";

// Load candles from CSV
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

// Create algo params - LONG only, no SL/TP (pure crossover exits)
// Using 10/23 minute EMAs so minimum resolution = 60s (matches our 1-min data)
function createAlgoParams(): AlgoParams {
    const bullishCross = createEMACrossConfig(10, 23, "value_above_threshold");
    const bearishCross = createEMACrossConfig(10, 23, "value_below_threshold");

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
console.log("TYPESCRIPT BACKTESTER - EMA 10/23 CROSSOVER");
console.log("=".repeat(80));

console.log("\nLoading candles...");
const candles = loadCandles();
console.log("Loaded " + candles.length + " candles");
console.log("Date range: " + new Date(candles[0].bucket * 1000).toISOString() +
            " to " + new Date(candles[candles.length-1].bucket * 1000).toISOString());

const algoConfig: AlgoConfig = {
    userID: "test",
    algoID: "ema-crossover-comparison",
    algoName: "EMA 9/21 Crossover",
    version: 1,
    params: createAlgoParams()
};

const runSettings: RunSettings = {
    userID: "test",
    algoID: "ema-crossover-comparison",
    version: "1",
    runID: "ts-python-compare",
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

console.log("\nRunning backtester...");
const startTime = Date.now();
const output = runBacktestPipeline(candles, input);
const duration = Date.now() - startTime;

console.log("\n" + "=".repeat(80));
console.log("RESULTS");
console.log("=".repeat(80));

console.log("\nPerformance:");
console.log("  Duration: " + duration + "ms");
console.log("  Bars processed: " + output.totalBarsProcessed);

console.log("\nTrade Summary:");
console.log("  Total trades: " + output.swapMetrics.totalTrades);
console.log("  Win rate: " + (output.swapMetrics.winRate * 100).toFixed(2) + "%");
console.log("  Total P&L: $" + output.swapMetrics.totalPnlUSD.toFixed(2));
console.log("  Max drawdown: " + (output.swapMetrics.maxDrawdownPct * 100).toFixed(2) + "%");

// Output first 20 trades for comparison
console.log("\n" + "=".repeat(80));
console.log("FIRST 20 TRADES (for Python comparison)");
console.log("=".repeat(80));
console.log("\nFormat: Trade# | Entry Bar | Exit Bar | Direction | Entry Price | Exit Price | P&L");
console.log("-".repeat(90));

const trades = output.trades.slice(0, 20);
for (const trade of trades) {
    const entryBar = trade.entrySwap?.barIndex ?? -1;
    const exitBar = trade.exitSwap?.barIndex ?? -1;
    const entryPrice = trade.entrySwap?.price ?? 0;
    const exitPrice = trade.exitSwap?.price ?? 0;

    console.log(
        `  ${String(trade.tradeId).padStart(3)} | ` +
        `${String(entryBar).padStart(9)} | ` +
        `${String(exitBar).padStart(8)} | ` +
        `${trade.direction.padEnd(5)} | ` +
        `$${entryPrice.toFixed(2).padStart(10)} | ` +
        `$${exitPrice.toFixed(2).padStart(10)} | ` +
        `$${trade.pnlUSD.toFixed(2).padStart(8)}`
    );
}

// Output as JSON for easy Python comparison
console.log("\n" + "=".repeat(80));
console.log("TRADE DATA (JSON format for Python)");
console.log("=".repeat(80));

const tradeData = output.trades.slice(0, 20).map(t => ({
    id: t.tradeId,
    entryBar: t.entrySwap?.barIndex,
    exitBar: t.exitSwap?.barIndex,
    entryPrice: t.entrySwap?.price,
    exitPrice: t.exitSwap?.price,
    pnlUSD: t.pnlUSD,
    pnlPct: t.pnlPct,
}));

console.log("\nts_trades = " + JSON.stringify(tradeData, null, 2));

// Summary statistics
console.log("\n" + "=".repeat(80));
console.log("SUMMARY STATISTICS");
console.log("=".repeat(80));
console.log("\nswap_metrics = {");
console.log("    'totalTrades': " + output.swapMetrics.totalTrades + ",");
console.log("    'winningTrades': " + output.swapMetrics.winningTrades + ",");
console.log("    'losingTrades': " + output.swapMetrics.losingTrades + ",");
console.log("    'winRate': " + output.swapMetrics.winRate.toFixed(4) + ",");
console.log("    'totalPnlUSD': " + output.swapMetrics.totalPnlUSD.toFixed(2) + ",");
console.log("    'avgPnlUSD': " + output.swapMetrics.avgPnlUSD.toFixed(2) + ",");
console.log("    'maxDrawdownPct': " + output.swapMetrics.maxDrawdownPct.toFixed(4) + ",");
console.log("}");
