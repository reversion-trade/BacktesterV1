/**
 * Special Indicators Tests
 *
 * Tests for all special indicators:
 * - StopLossIndicator
 * - TakeProfitIndicator
 * - TrailingStopIndicator
 * - BalanceIndicator
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  StopLossIndicator,
  createStopLoss,
  TakeProfitIndicator,
  createTakeProfit,
  TrailingStopIndicator,
  createTrailingStop,
  BalanceIndicator,
  createBalance,
  createBalanceWithDefaults,
  createSpecialIndicator,
  getSpecialIndicatorNames,
  getSpecialIndicatorsByTag,
} from "../special-indicators/index.ts";

// =============================================================================
// STOP LOSS INDICATOR
// =============================================================================

describe("StopLossIndicator", () => {
  describe("LONG Position", () => {
    test("triggers when price falls below stop level (REL)", () => {
      const sl = createStopLoss("LONG", { type: "REL", value: 0.02 });
      sl.reset(50000, 1000);

      // SL = 50000 * (1 - 0.02) = 49000
      expect(sl.getStopLossPrice()).toBe(49000);

      const results = sl.calculate([49500, 49200, 48900], [1001, 1002, 1003]);
      expect(results).toEqual([false, false, true]);
      expect(sl.isTriggered()).toBe(true);
      expect(sl.getTriggerPrice()).toBe(48900);
      expect(sl.getTriggerTime()).toBe(1003);
    });

    test("triggers when price equals stop level exactly", () => {
      const sl = createStopLoss("LONG", { type: "ABS", value: 1000 });
      sl.reset(50000, 1000);

      // SL = 50000 - 1000 = 49000
      expect(sl.getStopLossPrice()).toBe(49000);

      const results = sl.calculate([49000], [1001]);
      expect(results).toEqual([true]);
    });

    test("does not trigger when price stays above stop", () => {
      const sl = createStopLoss("LONG", { type: "REL", value: 0.02 });
      sl.reset(50000, 1000);

      const results = sl.calculate([50000, 51000, 49500], [1001, 1002, 1003]);
      expect(results).toEqual([false, false, false]);
      expect(sl.isTriggered()).toBe(false);
    });

    test("stays triggered once hit", () => {
      const sl = createStopLoss("LONG", { type: "REL", value: 0.02 });
      sl.reset(50000, 1000);

      const results = sl.calculate(
        [48000, 50000, 51000],
        [1001, 1002, 1003]
      );
      // First price triggers, subsequent stay true even if price recovers
      expect(results).toEqual([true, true, true]);
    });
  });

  describe("SHORT Position", () => {
    test("triggers when price rises above stop level (REL)", () => {
      const sl = createStopLoss("SHORT", { type: "REL", value: 0.02 });
      sl.reset(50000, 1000);

      // SL = 50000 * (1 + 0.02) = 51000
      expect(sl.getStopLossPrice()).toBe(51000);

      const results = sl.calculate([50500, 50800, 51100], [1001, 1002, 1003]);
      expect(results).toEqual([false, false, true]);
    });

    test("triggers with ABS offset", () => {
      const sl = createStopLoss("SHORT", { type: "ABS", value: 500 });
      sl.reset(50000, 1000);

      // SL = 50000 + 500 = 50500
      expect(sl.getStopLossPrice()).toBe(50500);

      const results = sl.calculate([50600], [1001]);
      expect(results).toEqual([true]);
    });
  });

  describe("Reset", () => {
    test("clears trigger state on reset", () => {
      const sl = createStopLoss("LONG", { type: "REL", value: 0.02 });
      sl.reset(50000, 1000);
      sl.calculate([48000], [1001]);
      expect(sl.isTriggered()).toBe(true);

      sl.reset(60000, 2000);
      expect(sl.isTriggered()).toBe(false);
      expect(sl.getTriggerPrice()).toBeUndefined();
      expect(sl.getEntryPrice()).toBe(60000);
      expect(sl.getStopLossPrice()).toBe(58800); // 60000 * 0.98
    });
  });
});

// =============================================================================
// TAKE PROFIT INDICATOR
// =============================================================================

describe("TakeProfitIndicator", () => {
  describe("LONG Position", () => {
    test("triggers when price rises above target (REL)", () => {
      const tp = createTakeProfit("LONG", { type: "REL", value: 0.05 });
      tp.reset(50000, 1000);

      // TP = 50000 * (1 + 0.05) = 52500
      expect(tp.getTakeProfitPrice()).toBe(52500);

      const results = tp.calculate([51000, 52000, 53000], [1001, 1002, 1003]);
      expect(results).toEqual([false, false, true]);
      expect(tp.isTriggered()).toBe(true);
      expect(tp.getTriggerPrice()).toBe(53000);
    });

    test("triggers with ABS offset", () => {
      const tp = createTakeProfit("LONG", { type: "ABS", value: 2000 });
      tp.reset(50000, 1000);

      // TP = 50000 + 2000 = 52000
      expect(tp.getTakeProfitPrice()).toBe(52000);

      const results = tp.calculate([52000], [1001]);
      expect(results).toEqual([true]);
    });
  });

  describe("SHORT Position", () => {
    test("triggers when price falls below target (REL)", () => {
      const tp = createTakeProfit("SHORT", { type: "REL", value: 0.05 });
      tp.reset(50000, 1000);

      // TP = 50000 * (1 - 0.05) = 47500
      expect(tp.getTakeProfitPrice()).toBe(47500);

      const results = tp.calculate([49000, 48000, 47000], [1001, 1002, 1003]);
      expect(results).toEqual([false, false, true]);
    });

    test("triggers with ABS offset", () => {
      const tp = createTakeProfit("SHORT", { type: "ABS", value: 3000 });
      tp.reset(50000, 1000);

      // TP = 50000 - 3000 = 47000
      expect(tp.getTakeProfitPrice()).toBe(47000);

      const results = tp.calculate([47000], [1001]);
      expect(results).toEqual([true]);
    });
  });

  describe("Edge Cases", () => {
    test("stays triggered once hit", () => {
      const tp = createTakeProfit("LONG", { type: "REL", value: 0.05 });
      tp.reset(50000, 1000);

      const results = tp.calculate([55000, 50000, 48000], [1001, 1002, 1003]);
      expect(results).toEqual([true, true, true]);
    });
  });
});

// =============================================================================
// TRAILING STOP INDICATOR
// =============================================================================

describe("TrailingStopIndicator", () => {
  describe("LONG Position", () => {
    test("ratchets up with price and triggers on pullback", () => {
      const ts = createTrailingStop("LONG", { type: "REL", value: 0.03 });
      ts.reset(50000, 1000);

      // Initial: extreme = 50000, SL = 48500 (3% below)
      expect(ts.getExtremePrice()).toBe(50000);
      expect(ts.getCurrentLevel()).toBeCloseTo(48500, 0);

      const results = ts.calculate(
        [51000, 52000, 51500, 50000],
        [1001, 1002, 1003, 1004]
      );

      // Price rises to 52000, SL ratchets to 50440
      // Then price drops to 50000 which is below 50440, so triggers
      expect(results[0].hit).toBe(false);
      expect(results[1].hit).toBe(false);
      expect(results[2].hit).toBe(false);
      expect(results[3].hit).toBe(true);

      expect(results[1].extremePrice).toBe(52000);
      expect(results[1].currentLevel).toBeCloseTo(50440, 0);
    });

    test("does not trigger when price stays above trailing level", () => {
      const ts = createTrailingStop("LONG", { type: "REL", value: 0.02 });
      ts.reset(50000, 1000);

      const results = ts.calculate(
        [51000, 52000, 53000],
        [1001, 1002, 1003]
      );

      expect(results.every((r) => r.hit === false)).toBe(true);
      expect(ts.isTriggered()).toBe(false);
    });

    test("works with ABS offset", () => {
      const ts = createTrailingStop("LONG", { type: "ABS", value: 1000 });
      ts.reset(50000, 1000);

      // Initial SL = 49000
      expect(ts.getCurrentLevel()).toBe(49000);

      const results = ts.calculate([52000, 50500], [1001, 1002]);
      // Extreme rises to 52000, SL = 51000
      // Price drops to 50500 which is below 51000
      expect(results[0].hit).toBe(false);
      expect(results[1].hit).toBe(true);
    });
  });

  describe("SHORT Position", () => {
    test("ratchets down with price and triggers on rally", () => {
      const ts = createTrailingStop("SHORT", { type: "REL", value: 0.03 });
      ts.reset(50000, 1000);

      // Initial: extreme = 50000, SL = 51500 (3% above)
      expect(ts.getExtremePrice()).toBe(50000);
      expect(ts.getCurrentLevel()).toBeCloseTo(51500, 0);

      const results = ts.calculate(
        [49000, 48000, 48500, 50000],
        [1001, 1002, 1003, 1004]
      );

      // Price falls to 48000, SL ratchets to 49440
      // Then price rises to 50000 which is above 49440, so triggers
      expect(results[0].hit).toBe(false);
      expect(results[1].hit).toBe(false);
      expect(results[2].hit).toBe(false);
      expect(results[3].hit).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    test("stays triggered once hit", () => {
      const ts = createTrailingStop("LONG", { type: "REL", value: 0.02 });
      ts.reset(50000, 1000);

      const results = ts.calculate(
        [55000, 48000, 60000],
        [1001, 1002, 1003]
      );

      // After 55000: SL = 53900
      // 48000 triggers (below 53900)
      // 60000 stays triggered
      expect(results[0].hit).toBe(false);
      expect(results[1].hit).toBe(true);
      expect(results[2].hit).toBe(true);
    });
  });
});

// =============================================================================
// BALANCE INDICATOR
// =============================================================================

describe("BalanceIndicator", () => {
  describe("LONG Position", () => {
    test("calculates unrealized P&L correctly", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000); // Entry at $100

      const results = bal.calculate([110, 90, 100], [1001, 1002, 1003]);

      // Position size = 10000 / 100 = 100 units
      // At $110: P&L = 100 * (110 - 100) = 1000
      // At $90: P&L = 100 * (90 - 100) = -1000
      // At $100: P&L = 0
      expect(results[0].unrealizedPnL).toBeCloseTo(1000, 0);
      expect(results[1].unrealizedPnL).toBeCloseTo(-1000, 0);
      expect(results[2].unrealizedPnL).toBeCloseTo(0, 0);
    });

    test("calculates balance including P&L", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000);

      const results = bal.calculate([110], [1001]);

      // Balance = initial capital + unrealized P&L = 10000 + 1000 = 11000
      expect(results[0].balance).toBeCloseTo(11000, 0);
    });

    test("applies entry fee", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 100, // 1% fee
        slippageBps: 0,
      });
      bal.reset(100, 1000);

      // Entry fee = 10000 * 0.01 = 100
      // Value after entry = 10000 - 100 = 9900
      expect(bal.getValueAfterEntry()).toBeCloseTo(9900, 0);
      expect(bal.getEntryFeeUSD()).toBeCloseTo(100, 0);
    });

    test("applies entry slippage for LONG", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 0,
        slippageBps: 100, // 1% slippage
      });
      bal.reset(100, 1000);

      // LONG: we pay more (price slips up)
      // Effective entry = 100 * 1.01 = 101
      expect(bal.getEffectiveEntryPrice()).toBeCloseTo(101, 2);
    });

    test("tracks intra-trade extremes", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000);

      bal.calculate([110, 85, 100], [1001, 1002, 1003]);

      const extremes = bal.getExtremes();
      // Max run-up: at $110, P&L = 1000
      // Max drawdown: at $85, P&L = -1500
      expect(extremes.maxRunUpUSD).toBeCloseTo(1000, 0);
      expect(extremes.maxDrawdownUSD).toBeCloseTo(1500, 0);
    });
  });

  describe("SHORT Position", () => {
    test("calculates unrealized P&L correctly for SHORT", () => {
      const bal = createBalance({
        direction: "SHORT",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000);

      const results = bal.calculate([90, 110, 100], [1001, 1002, 1003]);

      // At $90: P&L = 100 * (100 - 90) = 1000 (SHORT profits when price falls)
      // At $110: P&L = 100 * (100 - 110) = -1000
      // At $100: P&L = 0
      expect(results[0].unrealizedPnL).toBeCloseTo(1000, 0);
      expect(results[1].unrealizedPnL).toBeCloseTo(-1000, 0);
      expect(results[2].unrealizedPnL).toBeCloseTo(0, 0);
    });

    test("applies entry slippage for SHORT", () => {
      const bal = createBalance({
        direction: "SHORT",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 0,
        slippageBps: 100, // 1% slippage
      });
      bal.reset(100, 1000);

      // SHORT: we sell lower (price slips down)
      // Effective entry = 100 * 0.99 = 99
      expect(bal.getEffectiveEntryPrice()).toBeCloseTo(99, 2);
    });
  });

  describe("Position Sizing", () => {
    test("handles REL position size", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 0.5 }, // 50%
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000);

      expect(bal.getPositionSizeUSD()).toBe(5000);
      expect(bal.getPositionSizeAsset()).toBe(50);
    });

    test("handles ABS position size", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "ABS", value: 3000 },
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000);

      expect(bal.getPositionSizeUSD()).toBe(3000);
      expect(bal.getPositionSizeAsset()).toBe(30);
    });

    test("caps position size at available capital", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "ABS", value: 20000 }, // More than capital
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000);

      // Should be capped at 10000
      expect(bal.getPositionSizeUSD()).toBe(10000);
    });
  });

  describe("Realized P&L Calculation", () => {
    test("calculates realized P&L for profitable LONG", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 10, // 0.1% fee
        slippageBps: 10, // 0.1% slippage
      });
      bal.reset(100, 1000);

      // Entry: effective = 100.1, position = ~99.9 units
      // Entry fee = ~10
      // Exit at 110: effective = 109.89, exit fee ~11
      // Gross P&L = ~99.9 * (109.89 - 100.1) = ~978.1
      // Net P&L = ~978.1 - 10 - 11 = ~957
      const realized = bal.calculateRealizedPnL(110);
      expect(realized).toBeGreaterThan(900);
      expect(realized).toBeLessThan(1000);
    });
  });

  describe("Never Triggers", () => {
    test("balance indicator never triggers", () => {
      const bal = createBalance({
        direction: "LONG",
        initialCapital: 10000,
        positionSize: { type: "REL", value: 1.0 },
        feeBps: 0,
        slippageBps: 0,
      });
      bal.reset(100, 1000);
      bal.calculate([200, 50, 100], [1001, 1002, 1003]);

      expect(bal.isTriggered()).toBe(false);
    });
  });

  describe("Factory Functions", () => {
    test("createBalanceWithDefaults uses default fees", () => {
      const bal = createBalanceWithDefaults(
        "LONG",
        10000,
        { type: "REL", value: 1.0 }
      );
      bal.reset(100, 1000);

      // Default fees are 10 bps each
      expect(bal.getEntryFeeUSD()).toBeCloseTo(10, 0);
    });
  });
});

// =============================================================================
// REGISTRY
// =============================================================================

describe("Special Indicator Registry", () => {
  test("returns all indicator names", () => {
    const names = getSpecialIndicatorNames();
    expect(names).toContain("StopLoss");
    expect(names).toContain("TakeProfit");
    expect(names).toContain("TrailingStop");
    expect(names).toContain("Balance");
  });

  test("finds indicators by tag", () => {
    const riskIndicators = getSpecialIndicatorsByTag("Risk Management");
    expect(riskIndicators).toContain("StopLoss");
    expect(riskIndicators).toContain("TrailingStop");
  });

  test("creates indicator via registry", () => {
    const sl = createSpecialIndicator("StopLoss", {
      direction: "LONG",
      stopLoss: { type: "REL", value: 0.02 },
    });

    expect(sl).toBeInstanceOf(StopLossIndicator);
    sl.reset(50000, 1000);
    expect(sl.getStopLossPrice()).toBe(49000);
  });
});

// =============================================================================
// BASE CLASS FUNCTIONALITY
// =============================================================================

describe("BaseSpecialIndicator", () => {
  test("getCacheKey returns unique key", () => {
    const sl1 = createStopLoss("LONG", { type: "REL", value: 0.02 });
    const sl2 = createStopLoss("LONG", { type: "REL", value: 0.03 });
    const sl3 = createStopLoss("SHORT", { type: "REL", value: 0.02 });

    expect(sl1.getCacheKey()).not.toBe(sl2.getCacheKey());
    expect(sl1.getCacheKey()).not.toBe(sl3.getCacheKey());
  });

  test("getClassName returns class name without Indicator suffix", () => {
    const sl = createStopLoss("LONG", { type: "REL", value: 0.02 });
    expect(sl.getClassName()).toBe("StopLoss");
  });

  test("getDirection returns configured direction", () => {
    const slLong = createStopLoss("LONG", { type: "REL", value: 0.02 });
    const slShort = createStopLoss("SHORT", { type: "REL", value: 0.02 });

    expect(slLong.getDirection()).toBe("LONG");
    expect(slShort.getDirection()).toBe("SHORT");
  });

  test("getConfig returns full config", () => {
    const config = { direction: "LONG" as const, stopLoss: { type: "REL" as const, value: 0.02 } };
    const sl = createStopLoss(config.direction, config.stopLoss);

    expect(sl.getConfig()).toEqual(config);
  });
});

// =============================================================================
// ZOD VALIDATION
// =============================================================================

describe("Zod Validation", () => {
  test("rejects invalid direction", () => {
    expect(() =>
      createSpecialIndicator("StopLoss", {
        direction: "INVALID" as any,
        stopLoss: { type: "REL", value: 0.02 },
      })
    ).toThrow();
  });

  test("rejects negative value", () => {
    expect(() =>
      createSpecialIndicator("StopLoss", {
        direction: "LONG",
        stopLoss: { type: "REL", value: -0.02 },
      })
    ).toThrow();
  });

  test("rejects invalid value type", () => {
    expect(() =>
      createSpecialIndicator("StopLoss", {
        direction: "LONG",
        stopLoss: { type: "INVALID" as any, value: 0.02 },
      })
    ).toThrow();
  });
});
