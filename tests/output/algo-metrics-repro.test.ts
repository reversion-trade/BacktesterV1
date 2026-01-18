
import { describe, it, expect } from "bun:test";
import { calculateAlgoMetrics } from "../../src/output/algo-metrics.ts";
import type { IndicatorFlipEvent } from "../../src/events/types.ts";

describe("algo-metrics bug repro", () => {
    it("correctly handles indicator starting as TRUE", () => {
        const totalBars = 100;

        // Indicator starts TRUE, then flips to FALSE at bar 50
        const flipEvent: IndicatorFlipEvent = {
            type: "INDICATOR_FLIP",
            timestamp: 50 * 60,
            barIndex: 50,
            indicatorKey: "test-ind",
            indicatorType: "RSI",
            previousValue: true,
            newValue: false,
            conditionType: "LONG_ENTRY",
            isRequired: true,
            conditionSnapshot: {
                requiredTrue: 0,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: false,
                distanceFromTrigger: 1
            }
        };

        const result = calculateAlgoMetrics([flipEvent], totalBars);
        const analysis = result.indicatorAnalysis.find(a => a.indicatorKey === "test-ind");

        expect(analysis).toBeDefined();

        // If it started TRUE and flipped at 50, it was TRUE for 50 bars (0-50)
        // Then FALSE for 50 bars (50-100)
        // So pctTimeTrue should be 0.5
        console.log(`pctTimeTrue: ${analysis?.pctTimeTrue}`);
        expect(analysis?.pctTimeTrue).toBe(0.5);
    });
});
