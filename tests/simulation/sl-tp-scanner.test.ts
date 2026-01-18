/**
 * SL/TP Scanner Unit Tests
 *
 * Tests for pre-calculating stop loss and take profit trigger times.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
    scanForSLTPTriggers,
    wouldSLTrigger,
    wouldTPTrigger,
    getLevels,
} from "../../src/simulation/sl-tp-scanner.ts";
import { resetEventIdCounter } from "../../src/events/simulation-events.ts";
import type { Candle, ValueConfig } from "../../src/core/types.ts";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createCandle(bucket: number, open: number, high: number, low: number, close: number): Candle {
    return { bucket, open, high, low, close, volume: 100 };
}

function createSimpleCandles(startBucket: number, prices: number[]): Candle[] {
    return prices.map((price, i) => ({
        bucket: startBucket + i * 60,
        open: price,
        high: price + 10,
        low: price - 10,
        close: price,
        volume: 100,
    }));
}

// =============================================================================
// BASIC SCANNING
// =============================================================================

describe("SL/TP Scanner - Basic Scanning", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("returns no trigger when no SL/TP configured", () => {
        const candles = createSimpleCandles(0, [100, 100, 100, 100, 100]);

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(false);
        expect(result.slEvent).toBeUndefined();
        expect(result.tpEvent).toBeUndefined();
    });

    test("finds SL trigger for LONG when price drops", () => {
        // Entry at 100, SL at 2% = 98
        // Bar 1: low of 99, doesn't trigger
        // Bar 2: low of 97, triggers SL at 98
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 99, 100, 99, 99), // Low 99 > 98, no trigger
            createCandle(120, 97, 99, 97, 97), // Low of 97 < 98, triggers SL
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.02 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.slEvent).toBeDefined();
        expect(result.slEvent!.barIndex).toBe(2); // Triggers at bar 2 (low of 97 < SL at 98)
        expect(result.stats.firstTrigger).toBe("SL");
    });

    test("finds TP trigger for LONG when price rises", () => {
        // Entry at 100, TP at 5% = 105
        // Price rises: 100, 103, 106 (triggers at bar 2)
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 103, 103, 100, 103),
            createCandle(120, 106, 110, 105, 108), // High of 110 triggers TP at 105
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            tpConfig: { type: "REL", value: 0.05 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.tpEvent).toBeDefined();
        expect(result.tpEvent!.barIndex).toBe(2);
        expect(result.stats.firstTrigger).toBe("TP");
    });

    test("finds SL trigger for SHORT when price rises", () => {
        // Entry at 100, SL at 2% = 102
        // Price rises: 100, 101, 103 (triggers at bar 2)
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 101, 101, 100, 101),
            createCandle(120, 103, 105, 102, 104), // High of 105 triggers SL at 102
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "SHORT",
            slConfig: { type: "REL", value: 0.02 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.slEvent).toBeDefined();
        expect(result.stats.firstTrigger).toBe("SL");
    });

    test("finds TP trigger for SHORT when price drops", () => {
        // Entry at 100, TP at 5% = 95
        // Price drops: 100, 97, 94 (triggers at bar 2)
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 97, 100, 97, 97),
            createCandle(120, 94, 96, 93, 94), // Low of 93 triggers TP at 95
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "SHORT",
            tpConfig: { type: "REL", value: 0.05 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.tpEvent).toBeDefined();
        expect(result.stats.firstTrigger).toBe("TP");
    });
});

// =============================================================================
// SL/TP PRIORITY
// =============================================================================

describe("SL/TP Scanner - Priority", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("SL triggers before TP when SL hit first", () => {
        // Entry at 100, SL at 2% = 98, TP at 5% = 105
        // Price path: open=100, low=97 (hits SL), high=106 (would hit TP)
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 100, 106, 97, 100), // Low hit first due to open=100 closer to 97 than 106
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.02 },
            tpConfig: { type: "REL", value: 0.05 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.slEvent).toBeDefined();
        expect(result.tpEvent).toBeUndefined();
        expect(result.stats.firstTrigger).toBe("SL");
    });

    test("TP triggers before SL when TP hit first", () => {
        // Entry at 100, SL at 5% = 95, TP at 2% = 102
        // Price path: open=100, high=103 (hits TP), low=94 (would hit SL)
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 100, 103, 94, 100), // High closer to open, so TP hit first
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.05 },
            tpConfig: { type: "REL", value: 0.02 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.tpEvent).toBeDefined();
        expect(result.slEvent).toBeUndefined();
        expect(result.stats.firstTrigger).toBe("TP");
    });
});

// =============================================================================
// ABSOLUTE VALUES
// =============================================================================

describe("SL/TP Scanner - Absolute Values", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("handles ABS SL value correctly", () => {
        // Entry at 100, SL = $5 below = 95
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 98, 100, 94, 95), // Low of 94 triggers SL at 95
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "ABS", value: 5 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.slEvent).toBeDefined();
        expect(result.slEvent!.slLevel).toBe(95);
    });

    test("handles ABS TP value correctly", () => {
        // Entry at 100, TP = $10 above = 110
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 105, 112, 104, 108), // High of 112 triggers TP at 110
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            tpConfig: { type: "ABS", value: 10 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.tpEvent).toBeDefined();
        expect(result.tpEvent!.tpLevel).toBe(110);
    });
});

// =============================================================================
// TRAILING STOP
// =============================================================================

describe("SL/TP Scanner - Trailing Stop", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("trailing stop updates with favorable price movement", () => {
        // Entry at 100, trailing offset = 2%
        // Price rises to 110, then drops to 107 (triggers at 110 * 0.98 = 107.8)
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 105, 110, 105, 110), // Peak at 110
            createCandle(120, 108, 109, 107, 107), // Low of 107 triggers trailing at ~107.8
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.02 },
            trailingEnabled: true,
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.trailingEvent).toBeDefined();
        expect(result.trailingEvent!.peakPrice).toBe(110);
        expect(result.stats.firstTrigger).toBe("TRAILING");
    });

    test("trailing stop does not trigger with continued favorable movement", () => {
        // Price keeps rising, pullbacks never exceed trailing offset (2%)
        // Bar 1: high=110, trailing=107.8, low=109 (safe - 109 > 107.8)
        // Bar 2: high=115, trailing=112.7, low=114 (safe - 114 > 112.7)
        // Bar 3: high=120, trailing=117.6, low=118 (safe - 118 > 117.6)
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 108, 110, 109, 110), // Peak 110, low 109 > 107.8
            createCandle(120, 112, 115, 114, 115), // Peak 115, low 114 > 112.7
            createCandle(180, 118, 120, 118, 120), // Peak 120, low 118 > 117.6
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.02 },
            trailingEnabled: true,
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(false);
    });
});

// =============================================================================
// SUB-BAR PRECISION
// =============================================================================

describe("SL/TP Scanner - Sub-Bar Precision", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("uses sub-bar candles when provided", () => {
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 100, 110, 90, 100), // Parent bar shows both extremes
        ];

        // Sub-bar shows price dropped to 95 first (before rising)
        const subBarCandlesMap = new Map<number, Candle[]>();
        subBarCandlesMap.set(1, [
            createCandle(60, 100, 100, 95, 96), // Drops to 95 first
            createCandle(70, 96, 110, 96, 105), // Then rises to 110
        ]);

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.04 }, // SL at 96
            tpConfig: { type: "REL", value: 0.08 }, // TP at 108
            tradeId: 1,
            candles,
            subBarCandlesMap,
        });

        // SL should trigger first because sub-bar shows drop happened first
        expect(result.hasTriggger).toBe(true);
        expect(result.slEvent).toBeDefined();
        expect(result.stats.firstTrigger).toBe("SL");
    });

    test("event includes sub-bar index and checkpoint", () => {
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 100, 100, 95, 98),
        ];

        const subBarCandlesMap = new Map<number, Candle[]>();
        subBarCandlesMap.set(1, [
            createCandle(60, 100, 100, 99, 99),
            createCandle(70, 99, 99, 95, 96), // SL triggers here
        ]);

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.04 }, // SL at 96
            tradeId: 1,
            candles,
            subBarCandlesMap,
        });

        expect(result.slEvent).toBeDefined();
        expect(result.slEvent!.subBarIndex).toBeDefined();
        expect(result.slEvent!.checkpointIndex).toBeDefined();
    });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("SL/TP Scanner - Edge Cases", () => {
    beforeEach(() => {
        resetEventIdCounter();
    });

    test("handles entry at last bar", () => {
        const candles = createSimpleCandles(0, [100, 100, 100]);

        const result = scanForSLTPTriggers({
            entryBarIndex: 2, // Last bar
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.02 },
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(false);
        expect(result.stats.barsScanned).toBe(0);
    });

    test("respects maxBarsToScan limit", () => {
        // Create candles where SL only triggers at bar 5
        // SL at 4% = 96. Bars 1-4 stay above 96, bar 5 drops to 95
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),     // Entry bar
            createCandle(60, 100, 101, 99, 100),    // Low 99 > 96, no trigger
            createCandle(120, 100, 101, 98, 100),   // Low 98 > 96, no trigger
            createCandle(180, 100, 101, 97, 100),   // Low 97 > 96, no trigger
            createCandle(240, 100, 101, 97, 100),   // Low 97 > 96, no trigger
            createCandle(300, 95, 97, 95, 95),      // Low 95 < 96, triggers
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.04 }, // SL at 96
            tradeId: 1,
            candles,
            maxBarsToScan: 3, // Only scan bars 1, 2, 3 (not 4, 5)
        });

        expect(result.hasTriggger).toBe(false);
        expect(result.stats.barsScanned).toBe(3);
    });

    test("handles empty candles array", () => {
        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.02 },
            tradeId: 1,
            candles: [],
        });

        expect(result.hasTriggger).toBe(false);
    });

    test("SL triggered exactly at level", () => {
        const candles: Candle[] = [
            createCandle(0, 100, 100, 100, 100),
            createCandle(60, 100, 100, 98, 98), // Low exactly at SL level
        ];

        const result = scanForSLTPTriggers({
            entryBarIndex: 0,
            entryPrice: 100,
            direction: "LONG",
            slConfig: { type: "REL", value: 0.02 }, // SL at exactly 98
            tradeId: 1,
            candles,
        });

        expect(result.hasTriggger).toBe(true);
        expect(result.slEvent).toBeDefined();
    });
});

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

describe("SL/TP Scanner - Utilities", () => {
    test("wouldSLTrigger correctly checks SL", () => {
        const slConfig: ValueConfig = { type: "REL", value: 0.02 };

        expect(wouldSLTrigger(97, 100, slConfig, "LONG")).toBe(true);
        expect(wouldSLTrigger(99, 100, slConfig, "LONG")).toBe(false);
        expect(wouldSLTrigger(103, 100, slConfig, "SHORT")).toBe(true);
        expect(wouldSLTrigger(101, 100, slConfig, "SHORT")).toBe(false);
    });

    test("wouldTPTrigger correctly checks TP", () => {
        const tpConfig: ValueConfig = { type: "REL", value: 0.05 };

        expect(wouldTPTrigger(106, 100, tpConfig, "LONG")).toBe(true);
        expect(wouldTPTrigger(104, 100, tpConfig, "LONG")).toBe(false);
        expect(wouldTPTrigger(94, 100, tpConfig, "SHORT")).toBe(true);
        expect(wouldTPTrigger(96, 100, tpConfig, "SHORT")).toBe(false);
    });

    test("getLevels calculates correct levels", () => {
        const slConfig: ValueConfig = { type: "REL", value: 0.02 };
        const tpConfig: ValueConfig = { type: "REL", value: 0.05 };

        const longLevels = getLevels(100, slConfig, tpConfig, "LONG");
        expect(longLevels.slLevel).toBe(98);
        expect(longLevels.tpLevel).toBe(105);

        const shortLevels = getLevels(100, slConfig, tpConfig, "SHORT");
        expect(shortLevels.slLevel).toBe(102);
        expect(shortLevels.tpLevel).toBe(95);
    });

    test("getLevels handles undefined configs", () => {
        const levels = getLevels(100, undefined, undefined);
        expect(levels.slLevel).toBeUndefined();
        expect(levels.tpLevel).toBeUndefined();
    });
});
