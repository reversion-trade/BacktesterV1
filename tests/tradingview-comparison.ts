/**
 * Detailed TradingView vs Our Backtester Comparison
 */
import { runBacktestPipeline } from "../src/simulation/stages/index.ts";
import type { BacktestInput, RunSettings } from "../src/core/config.ts";
import type { AlgoConfig, AlgoParams, IndicatorConfig, Candle } from "../src/core/types.ts";
import * as fs from "fs";

const OCT1_TIMESTAMP_SEC = 1759276800;

interface TVTrade {
    tradeNum: number;
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
}

function loadCandles(): Candle[] {
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

function loadTradingViewCSV(filename: string): TVTrade[] {
    let content = fs.readFileSync(`tradingview outputs/${filename}`, "utf-8");
    // Remove BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    const lines = content.trim().split("\n").slice(1); // Skip header

    // Group rows by trade number (CSV has Exit before Entry for same trade)
    const tradeData = new Map<number, { entry?: { time: string; price: number }; exit?: { time: string; price: number; pnl: number } }>();

    for (const line of lines) {
        const parts = line.split(",");
        const tradeNum = parseInt(parts[0], 10);
        const type = parts[1]; // "Entry long" or "Exit long"
        const dateTime = parts[2];
        const price = parseFloat(parts[4]);
        const pnl = parseFloat(parts[7]);

        if (!tradeData.has(tradeNum)) {
            tradeData.set(tradeNum, {});
        }
        const trade = tradeData.get(tradeNum)!;

        if (type === "Entry long") {
            trade.entry = { time: dateTime, price };
        } else if (type === "Exit long") {
            trade.exit = { time: dateTime, price, pnl };
        }
    }

    // Convert to array sorted by trade number
    const trades: TVTrade[] = [];
    const sortedNums = Array.from(tradeData.keys()).sort((a, b) => a - b);

    for (const tradeNum of sortedNums) {
        const data = tradeData.get(tradeNum)!;
        if (data.entry && data.exit) {
            trades.push({
                tradeNum,
                entryTime: data.entry.time,
                exitTime: data.exit.time,
                entryPrice: data.entry.price,
                exitPrice: data.exit.price,
                pnl: data.exit.pnl,
            });
        }
    }

    return trades;
}

function runOurBacktest(candles: Candle[], source: string): { entryTime: string; exitTime: string; pnl: number }[] {
    const oct1Index = candles.findIndex(c => c.bucket >= OCT1_TIMESTAMP_SEC);
    const startTime = candles[oct1Index]!.bucket;
    const endTime = candles[candles.length - 1]!.bucket;

    const algoParams: AlgoParams = {
        type: "LONG",
        longEntry: {
            required: [{
                type: "EMACross",
                params: { source, firstPeriod: 10 * 60, secondPeriod: 23 * 60, signal: "value_above_threshold" },
            } as IndicatorConfig],
            optional: []
        },
        longExit: {
            required: [{
                type: "EMACross",
                params: { source, firstPeriod: 10 * 60, secondPeriod: 23 * 60, signal: "value_below_threshold" },
            } as IndicatorConfig],
            optional: []
        },
        positionSize: { type: "ABS", value: 1000 },
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        timeout: { mode: "COOLDOWN_ONLY", cooldownBars: 0 }
    };

    const input: BacktestInput = {
        algoConfig: { userID: "test", algoID: "tv-compare", algoName: "TV Compare", version: 1, params: algoParams },
        runSettings: {
            userID: "test", algoID: "tv-compare", version: "1", runID: "tv-1",
            isBacktest: true, coinSymbol: "BTCUSD", capitalScaler: 1,
            startTime, endTime, closePositionOnExit: true,
            launchTime: Date.now(), status: "NEW", exchangeID: "test"
        }
    };

    const output = runBacktestPipeline(candles, input);

    return output.trades.map(t => ({
        entryTime: new Date((t.entrySwap?.timestamp ?? 0) * 1000).toISOString().replace("T", " ").slice(0, 16),
        exitTime: new Date((t.exitSwap?.timestamp ?? 0) * 1000).toISOString().replace("T", " ").slice(0, 16),
        pnl: t.pnlUSD
    }));
}

// Main comparison
const candles = loadCandles();

const sources = [
    { ours: "1_volume", tvFile: "source_Test_vol.csv", tvName: "volume" },
];

console.log("=".repeat(120));
console.log("TRADINGVIEW vs OUR BACKTESTER - DETAILED COMPARISON");
console.log("=".repeat(120));

for (const { ours, tvFile, tvName } of sources) {
    console.log(`\n${"=".repeat(120)}`);
    console.log(`SOURCE: ${tvName}`);
    console.log("=".repeat(120));

    const tvTrades = loadTradingViewCSV(tvFile);
    const ourTrades = runOurBacktest(candles, ours);

    console.log(`TradingView trades: ${tvTrades.length}`);
    console.log(`Our trades: ${ourTrades.length}`);
    console.log(`Difference: ${ourTrades.length - tvTrades.length}`);

    // Side-by-side comparison of first 15 trades
    console.log("\n" + "-".repeat(120));
    console.log("SIDE-BY-SIDE COMPARISON (First 15 trades)");
    console.log("-".repeat(120));
    console.log(
        "#".padEnd(4) +
        "TV Entry".padEnd(18) +
        "TV Exit".padEnd(18) +
        "TV P&L".padEnd(12) +
        "Our Entry".padEnd(18) +
        "Our Exit".padEnd(18) +
        "Our P&L".padEnd(12) +
        "Match?"
    );
    console.log("-".repeat(120));

    const maxTrades = Math.max(tvTrades.length, ourTrades.length);
    let matchCount = 0;
    let closeMatchCount = 0;

    for (let i = 0; i < Math.min(15, maxTrades); i++) {
        const tv = tvTrades[i];
        const our = ourTrades[i];

        const tvEntry = tv?.entryTime ?? "-";
        const tvExit = tv?.exitTime ?? "-";
        const tvPnl = tv ? `$${tv.pnl.toFixed(2)}` : "-";

        const ourEntry = our?.entryTime ?? "-";
        const ourExit = our?.exitTime ?? "-";
        const ourPnl = our ? `$${our.pnl.toFixed(2)}` : "-";

        // Check if times match (within 2 minutes)
        let match = "";
        if (tv && our) {
            const tvEntryMin = tv.entryTime.slice(14, 16);
            const ourEntryMin = ourEntry.slice(14, 16);
            const tvExitMin = tv.exitTime.slice(14, 16);
            const ourExitMin = ourExit.slice(14, 16);

            if (tv.entryTime === ourEntry && tv.exitTime === ourExit) {
                match = "✓ EXACT";
                matchCount++;
            } else if (Math.abs(parseInt(tvEntryMin) - parseInt(ourEntryMin)) <= 2 &&
                       Math.abs(parseInt(tvExitMin) - parseInt(ourExitMin)) <= 3) {
                match = "~ CLOSE";
                closeMatchCount++;
            } else {
                match = "✗ DIFF";
            }
        }

        console.log(
            String(i + 1).padEnd(4) +
            tvEntry.padEnd(18) +
            tvExit.padEnd(18) +
            tvPnl.padEnd(12) +
            ourEntry.padEnd(18) +
            ourExit.padEnd(18) +
            ourPnl.padEnd(12) +
            match
        );
    }

    // Calculate total P&L
    const tvTotalPnl = tvTrades.reduce((sum, t) => sum + t.pnl, 0);
    const ourTotalPnl = ourTrades.reduce((sum, t) => sum + t.pnl, 0);

    console.log("\n" + "-".repeat(120));
    console.log("SUMMARY");
    console.log("-".repeat(120));
    console.log(`Trade Count:    TV=${tvTrades.length}, Ours=${ourTrades.length}, Diff=${ourTrades.length - tvTrades.length}`);
    console.log(`Total P&L:      TV=$${tvTotalPnl.toFixed(2)}, Ours=$${ourTotalPnl.toFixed(2)}, Diff=$${(ourTotalPnl - tvTotalPnl).toFixed(2)}`);
    console.log(`Exact Matches:  ${matchCount}/15 first trades`);
    console.log(`Close Matches:  ${closeMatchCount}/15 first trades (within 2-3 min)`);

    // Analysis: Compare TV trade 1 with our trade 2 (we have an extra pre-warming trade)
    console.log("\n" + "-".repeat(120));
    console.log("ALIGNMENT ANALYSIS (TV trade N vs Our trade N+1 - accounting for pre-warming extra trade)");
    console.log("-".repeat(120));
    console.log(
        "#".padEnd(4) +
        "TV Entry".padEnd(18) +
        "TV Exit".padEnd(18) +
        "Our Entry".padEnd(18) +
        "Our Exit".padEnd(18) +
        "Entry Diff".padEnd(12) +
        "Exit Diff"
    );
    console.log("-".repeat(120));

    for (let i = 0; i < Math.min(10, tvTrades.length); i++) {
        const tv = tvTrades[i]!;
        const our = ourTrades[i + 1]; // Offset by 1 due to pre-warming extra trade
        if (!our) continue;

        // Parse times and calculate minute difference
        const tvEntryTime = tv.entryTime;
        const ourEntryTime = our.entryTime;
        const tvExitTime = tv.exitTime;
        const ourExitTime = our.exitTime;

        const entryDiff = calcMinuteDiff(tvEntryTime, ourEntryTime);
        const exitDiff = calcMinuteDiff(tvExitTime, ourExitTime);

        console.log(
            String(i + 1).padEnd(4) +
            tvEntryTime.padEnd(18) +
            tvExitTime.padEnd(18) +
            ourEntryTime.padEnd(18) +
            ourExitTime.padEnd(18) +
            `${entryDiff > 0 ? '+' : ''}${entryDiff}m`.padEnd(12) +
            `${exitDiff > 0 ? '+' : ''}${exitDiff}m`
        );
    }
}

function calcMinuteDiff(time1: string, time2: string): number {
    // Format: "2025-10-01 00:36"
    const [d1, t1] = time1.split(" ");
    const [d2, t2] = time2.split(" ");
    if (d1 !== d2) return 9999; // Different days

    const [h1, m1] = t1!.split(":").map(Number);
    const [h2, m2] = t2!.split(":").map(Number);

    return (h2! * 60 + m2!) - (h1! * 60 + m1!);
}
