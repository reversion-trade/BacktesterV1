/**
 * Expanding Window Operators Tests
 *
 * Tests for expanding window operators used by special indicators:
 * - ExpandingMaxOperator (for trailing stops on LONG)
 * - ExpandingMinOperator (for trailing stops on SHORT)
 * - ExpandingRangeOperator (for intra-trade extremes)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
    ExpandingMaxOperator,
    ExpandingMinOperator,
    ExpandingRangeOperator,
} from "../../src/simulation/special-indicators/operators.ts";

describe("ExpandingMaxOperator", () => {
    let op: ExpandingMaxOperator;

    beforeEach(() => {
        op = new ExpandingMaxOperator();
        op.reset();
    });

    describe("Basic Operations", () => {
        test("tracks maximum from feed", () => {
            const results = op.feed([100, 105, 103, 110, 108]);
            expect(results).toEqual([100, 105, 105, 110, 110]);
            expect(op.getMax()).toBe(110);
        });

        test("handles single value", () => {
            const results = op.feed(100);
            expect(results).toEqual([100]);
            expect(op.getMax()).toBe(100);
        });

        test("handles empty array", () => {
            const results = op.feed([]);
            expect(results).toEqual([]);
        });
    });

    describe("Reset", () => {
        test("reset clears max to -Infinity", () => {
            op.feed([100, 200]);
            op.reset();
            expect(op.getMax()).toBe(-Infinity);
        });

        test("resetWithValue sets initial max", () => {
            op.resetWithValue(50);
            expect(op.getMax()).toBe(50);

            const results = op.feed([40, 60, 55]);
            expect(results).toEqual([50, 60, 60]);
            expect(op.getMax()).toBe(60);
        });
    });

    describe("Warmup", () => {
        test("has zero warmup (expanding window)", () => {
            expect(op.warmup).toBe(0);
        });
    });
});

describe("ExpandingMinOperator", () => {
    let op: ExpandingMinOperator;

    beforeEach(() => {
        op = new ExpandingMinOperator();
        op.reset();
    });

    describe("Basic Operations", () => {
        test("tracks minimum from feed", () => {
            const results = op.feed([100, 95, 97, 90, 92]);
            expect(results).toEqual([100, 95, 95, 90, 90]);
            expect(op.getMin()).toBe(90);
        });

        test("handles single value", () => {
            const results = op.feed(100);
            expect(results).toEqual([100]);
            expect(op.getMin()).toBe(100);
        });

        test("handles empty array", () => {
            const results = op.feed([]);
            expect(results).toEqual([]);
        });
    });

    describe("Reset", () => {
        test("reset clears min to Infinity", () => {
            op.feed([100, 50]);
            op.reset();
            expect(op.getMin()).toBe(Infinity);
        });

        test("resetWithValue sets initial min", () => {
            op.resetWithValue(100);
            expect(op.getMin()).toBe(100);

            const results = op.feed([110, 90, 95]);
            expect(results).toEqual([100, 90, 90]);
            expect(op.getMin()).toBe(90);
        });
    });
});

describe("ExpandingRangeOperator", () => {
    let op: ExpandingRangeOperator;

    beforeEach(() => {
        op = new ExpandingRangeOperator();
        op.reset();
    });

    describe("Basic Operations", () => {
        test("tracks both min and max", () => {
            op.feed([100, 110, 95, 105]);
            expect(op.getMax()).toBe(110);
            expect(op.getMin()).toBe(95);
        });

        test("returns range as output", () => {
            const results = op.feed([100, 110, 95, 105]);
            // Range at each step:
            // 100: range 0 (100-100)
            // 110: range 10 (110-100)
            // 95: range 15 (110-95)
            // 105: range 15 (110-95)
            expect(results).toEqual([0, 10, 15, 15]);
        });

        test("handles monotonically increasing", () => {
            op.resetWithValue(100);
            const results = op.feed([105, 110, 115]);
            expect(results).toEqual([5, 10, 15]);
            expect(op.getMin()).toBe(100);
            expect(op.getMax()).toBe(115);
        });

        test("handles monotonically decreasing", () => {
            op.resetWithValue(100);
            const results = op.feed([95, 90, 85]);
            expect(results).toEqual([5, 10, 15]);
            expect(op.getMin()).toBe(85);
            expect(op.getMax()).toBe(100);
        });
    });

    describe("Reset", () => {
        test("resetWithValue sets both min and max", () => {
            op.resetWithValue(100);
            expect(op.getMin()).toBe(100);
            expect(op.getMax()).toBe(100);
        });
    });
});
