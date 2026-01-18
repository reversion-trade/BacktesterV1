/**
 * Compare Last Trades - Outputs last 10 trades for each source
 */
import { runBacktestPipeline } from "../src/simulation/stages/index.ts";
import type { BacktestInput, RunSettings } from "../src/core/config.ts";
import type { AlgoConfig, AlgoParams, IndicatorConfig, Candle } from "../src/core/types.ts";
import * as fs from "fs";

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

function createEMACrossConfig(source: string, signal: "value_above_threshold" | "value_below_threshold"): IndicatorConfig {
    return {
        type: "EMACross",
        params: {
            source,
            firstPeriod: 10 * 60,
            secondPeriod: 23 * 60,
            signal,
        },
    } as IndicatorConfig;
}

function testSource(candles: Candle[], source: string) {
    const algoParams: AlgoParams = {
        type: "LONG",
        longEntry: { required: [createEMACrossConfig(source, "value_above_threshold")], optional: [] },
        longExit: { required: [createEMACrossConfig(source, "value_below_threshold")], optional: [] },
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
    return runBacktestPipeline(candles, input);
}

function formatTime(bucket: number): string {
    const date = new Date(bucket * 1000);
    return date.toISOString().replace("T", " ").slice(0, 19);
}

console.log("=".repeat(100));
console.log("LAST TRADES COMPARISON - Our Backtester vs TradingView");
console.log("=".repeat(100));

const candles = loadCandles();
console.log(`\nLoaded ${candles.length} candles`);
console.log(`End time: ${formatTime(candles[candles.length - 1].bucket)}`);

const sources = [
    { ours: "1_close", tv: "close" },
    { ours: "1_open", tv: "open" },
    { ours: "1_high", tv: "high" },
    { ours: "1_low", tv: "low" },
    { ours: "1_volume", tv: "volume" },
    { ours: "1_average", tv: "ohlc4" },
    { ours: "1_middle", tv: "hl2" },
    { ours: "1_typical", tv: "hlc3" },
];

for (const { ours, tv } of sources) {
    console.log("\n" + "=".repeat(100));
    console.log(`SOURCE: ${ours} (TradingView: ${tv})`);
    console.log("=".repeat(100));

    const output = testSource(candles, ours);
    const trades = output.trades;

    console.log(`Total trades: ${trades.length}`);
    console.log(`\nLast 10 trades:`);
    console.log("Trade#".padEnd(8) + "Entry Time".padEnd(22) + "Exit Time".padEnd(22) + "Entry Bar".padEnd(12) + "Exit Bar".padEnd(12) + "P&L");
    console.log("-".repeat(100));

    for (const trade of trades.slice(-10)) {
        const entryBar = trade.entrySwap?.barIndex ?? -1;
        const exitBar = trade.exitSwap?.barIndex ?? -1;
        const entryBucket = candles[0].bucket + (entryBar * 60);
        const exitBucket = candles[0].bucket + (exitBar * 60);

        console.log(
            String(trade.tradeId).padEnd(8) +
            formatTime(entryBucket).padEnd(22) +
            formatTime(exitBucket).padEnd(22) +
            String(entryBar).padEnd(12) +
            String(exitBar).padEnd(12) +
            `$${trade.pnlUSD.toFixed(2)}`
        );
    }
}

// Summary
console.log("\n" + "=".repeat(100));
console.log("END-OF-BACKTEST SUMMARY");
console.log("=".repeat(100));
console.log("\nSource".padEnd(15) + "Total".padEnd(10) + "Last Entry Bar".padEnd(18) + "Last Exit Bar".padEnd(18) + "Last Entry Time".padEnd(22) + "Last Exit Time");
console.log("-".repeat(110));

for (const { ours, tv } of sources) {
    const output = testSource(candles, ours);
    const lastTrade = output.trades[output.trades.length - 1];
    const entryBar = lastTrade?.entrySwap?.barIndex ?? -1;
    const exitBar = lastTrade?.exitSwap?.barIndex ?? -1;
    const entryBucket = candles[0].bucket + (entryBar * 60);
    const exitBucket = candles[0].bucket + (exitBar * 60);

    console.log(
        ours.padEnd(15) +
        String(output.trades.length).padEnd(10) +
        String(entryBar).padEnd(18) +
        String(exitBar).padEnd(18) +
        formatTime(entryBucket).padEnd(22) +
        formatTime(exitBucket)
    );
}
