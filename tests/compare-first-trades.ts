/**
 * Compare First Trades - Outputs first 10 trades for each source
 * for comparison with TradingView outputs
 */
import { runBacktestPipeline } from "../src/simulation/stages/index.ts";
import type { BacktestInput, RunSettings } from "../src/core/config.ts";
import type { AlgoConfig, AlgoParams, IndicatorConfig, Candle } from "../src/core/types.ts";
import * as fs from "fs";

// October 1st timestamp (trading period start, pre-warming data is before this)
const OCT1_TIMESTAMP_SEC = 1759276800; // Oct 1, 2025 00:00:00 UTC

function loadCandles(): Candle[] {
    // Continuous data file: Sep 25 - Oct 31, 2025
    const csvPath = "BTCUSD_251226-1m-continuous-sep25-oct31.csv";
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

function getOctoberBounds(candles: Candle[]): { startTime: number; endTime: number } {
    // Find October start (first candle at or after Oct 1)
    const oct1Index = candles.findIndex(c => c.bucket >= OCT1_TIMESTAMP_SEC);
    const startTime = candles[oct1Index]?.bucket ?? OCT1_TIMESTAMP_SEC;

    // End time is last candle
    const endTime = candles[candles.length - 1].bucket;

    console.log(`October range: index ${oct1Index} to ${candles.length - 1}`);
    console.log(`Pre-warming bars (Sep): ${oct1Index}`);

    return { startTime, endTime };
}

function createEMACrossConfig(source: string, signal: "value_above_threshold" | "value_below_threshold"): IndicatorConfig {
    return {
        type: "EMACross",
        params: {
            source,
            firstPeriod: 10 * 60,  // 10 minutes in seconds
            secondPeriod: 23 * 60, // 23 minutes in seconds
            signal,
        },
    } as IndicatorConfig;
}

function testSource(candles: Candle[], source: string, startTime: number, endTime: number) {
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
        coinSymbol: "BTCUSD",
        capitalScaler: 1,
        startTime,  // October 1st (trading starts here)
        endTime,    // October 31st end
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
    return date.toISOString().replace("T", " ").slice(0, 16);
}

console.log("=".repeat(100));
console.log("FIRST TRADES COMPARISON - Our Backtester vs TradingView");
console.log("=".repeat(100));

const candles = loadCandles();
console.log(`\nLoaded ${candles.length} candles (Sep 25 - Oct 31)`);
console.log(`Full range: ${formatTime(candles[0].bucket)} to ${formatTime(candles[candles.length - 1].bucket)}`);

// Get October bounds for trading period
const { startTime, endTime } = getOctoberBounds(candles);
console.log(`Trading period: ${formatTime(startTime)} to ${formatTime(endTime)}`);

// Map our sources to TradingView source names
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

    const output = testSource(candles, ours, startTime, endTime);

    console.log(`Total trades: ${output.trades.length}`);
    console.log(`\nFirst 10 trades:`);
    console.log("Trade#".padEnd(8) + "Entry Time".padEnd(22) + "Exit Time".padEnd(22) + "Entry Bar".padEnd(12) + "Exit Bar".padEnd(12) + "P&L");
    console.log("-".repeat(90));

    for (const trade of output.trades.slice(0, 10)) {
        const entryBar = trade.entrySwap?.barIndex ?? -1;
        const exitBar = trade.exitSwap?.barIndex ?? -1;
        // Use actual timestamps stored in trade, not calculated
        const entryTimestamp = trade.entrySwap?.timestamp ?? 0;
        const exitTimestamp = trade.exitSwap?.timestamp ?? 0;

        console.log(
            String(trade.tradeId).padEnd(8) +
            formatTime(entryTimestamp).padEnd(22) +
            formatTime(exitTimestamp).padEnd(22) +
            String(entryBar).padEnd(12) +
            String(exitBar).padEnd(12) +
            `$${trade.pnlUSD.toFixed(2)}`
        );
    }
}

// Summary comparison table
console.log("\n" + "=".repeat(100));
console.log("SUMMARY COMPARISON");
console.log("=".repeat(100));
console.log("\nSource".padEnd(15) + "Our Trades".padEnd(15) + "First Entry Bar".padEnd(20) + "First Entry Time");
console.log("-".repeat(80));

for (const { ours, tv } of sources) {
    const output = testSource(candles, ours, startTime, endTime);
    const firstTrade = output.trades[0];
    const entryBar = firstTrade?.entrySwap?.barIndex ?? -1;
    // Use actual timestamp stored in trade
    const entryTimestamp = firstTrade?.entrySwap?.timestamp ?? 0;

    console.log(
        ours.padEnd(15) +
        String(output.trades.length).padEnd(15) +
        String(entryBar).padEnd(20) +
        formatTime(entryTimestamp)
    );
}
