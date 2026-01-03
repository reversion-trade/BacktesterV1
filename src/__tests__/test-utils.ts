/**
 * Test Utilities for Backtester-v2
 *
 * Provides mock factories, helpers, and common test setup functions.
 *
 * @module __tests__/test-utils
 */

import type { Candle } from "../core/types.ts";
import type {
  AlgoConfig,
  AlgoParams,
  Direction,
  PositionState,
  ValueConfig,
  EntryCondition,
  ExitCondition,
} from "../core/types.ts";
import type {
  SwapEvent,
  TradeEvent,
  AlgoEvent,
  ConditionSnapshot,
  SwapMetrics,
} from "../events/types.ts";

// =============================================================================
// CANDLE FACTORIES
// =============================================================================

/**
 * Options for generating mock candles
 */
export interface MockCandleOptions {
  /** Starting price (default: 10000) */
  startPrice?: number;
  /** Price volatility as percentage (default: 0.02 = 2%) */
  volatility?: number;
  /** Trend direction: 1 = up, -1 = down, 0 = sideways (default: 0) */
  trend?: number;
  /** Starting timestamp in ms (default: Date.now()) */
  startTime?: number;
  /** Candle interval in ms (default: 60000 = 1 minute) */
  interval?: number;
  /** Base volume (default: 100) */
  baseVolume?: number;
}

/**
 * Create an array of mock candles with configurable behavior
 */
export function createMockCandles(
  count: number,
  options: MockCandleOptions = {}
): Candle[] {
  const {
    startPrice = 10000,
    volatility = 0.02,
    trend = 0,
    startTime = Date.now(),
    interval = 60000,
    baseVolume = 100,
  } = options;

  const candles: Candle[] = [];
  let currentPrice = startPrice;

  for (let i = 0; i < count; i++) {
    // Random price movement with trend
    const trendFactor = trend * volatility * 0.5;
    const randomMove = (Math.random() - 0.5) * 2 * volatility;
    const priceChange = currentPrice * (trendFactor + randomMove);

    const open = currentPrice;
    const close = currentPrice + priceChange;
    const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
    const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
    const volume = baseVolume * (0.5 + Math.random());

    candles.push({
      bucket: startTime + i * interval,
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Create a simple uptrend of candles
 */
export function createUptrendCandles(
  count: number,
  startPrice: number = 10000
): Candle[] {
  return createMockCandles(count, { startPrice, trend: 1, volatility: 0.01 });
}

/**
 * Create a simple downtrend of candles
 */
export function createDowntrendCandles(
  count: number,
  startPrice: number = 10000
): Candle[] {
  return createMockCandles(count, { startPrice, trend: -1, volatility: 0.01 });
}

/**
 * Create sideways/ranging candles
 */
export function createSidewaysCandles(
  count: number,
  startPrice: number = 10000
): Candle[] {
  return createMockCandles(count, { startPrice, trend: 0, volatility: 0.005 });
}

// =============================================================================
// ALGO CONFIG FACTORIES
// =============================================================================

/**
 * Create a mock entry condition
 */
export function createMockEntryCondition(
  overrides: Partial<EntryCondition> = {}
): EntryCondition {
  return {
    required: [{ type: "RSI", params: { length: 14, threshold: 30, direction: "ABOVE" } }],
    optional: [],
    ...overrides,
  };
}

/**
 * Create a mock exit condition
 */
export function createMockExitCondition(
  overrides: Partial<ExitCondition> = {}
): ExitCondition {
  return {
    required: [{ type: "RSI", params: { length: 14, threshold: 70, direction: "BELOW" } }],
    optional: [],
    ...overrides,
  };
}

/**
 * Create a mock ValueConfig
 */
export function createMockValueConfig(
  overrides: Partial<ValueConfig> = {}
): ValueConfig {
  return {
    type: "REL",
    value: 0.1, // 10%
    ...overrides,
  };
}

/**
 * Create a mock AlgoParams
 */
export function createMockAlgoParams(
  overrides: Partial<AlgoParams> = {}
): AlgoParams {
  return {
    type: "LONG",
    longEntry: createMockEntryCondition(),
    longExit: createMockExitCondition(),
    positionSize: createMockValueConfig(),
    orderType: "MARKET",
    startingCapitalUSD: 10000,
    ...overrides,
  };
}

/**
 * Create a mock AlgoConfig
 */
export function createMockAlgoConfig(
  overrides: Partial<AlgoConfig> = {}
): AlgoConfig {
  return {
    userID: "test-user",
    algoID: "test-algo",
    algoName: "Test Algorithm",
    version: 1,
    params: createMockAlgoParams(overrides.params),
    ...overrides,
  };
}

// =============================================================================
// EVENT FACTORIES
// =============================================================================

let swapIdCounter = 1;
let tradeIdCounter = 1;

/**
 * Reset ID counters (call in beforeEach)
 */
export function resetIdCounters(): void {
  swapIdCounter = 1;
  tradeIdCounter = 1;
}

/**
 * Create a mock SwapEvent
 */
export function createMockSwapEvent(
  overrides: Partial<SwapEvent> = {}
): SwapEvent {
  return {
    id: `swap-${swapIdCounter++}`,
    timestamp: Date.now(),
    barIndex: 0,
    fromAsset: "USD",
    toAsset: "BTC",
    fromAmount: 1000,
    toAmount: 0.1,
    price: 10000,
    feeUSD: 1,
    slippageUSD: 0.5,
    ...overrides,
  };
}

/**
 * Create an entry swap (USD -> Asset)
 */
export function createEntrySwap(
  price: number,
  amountUSD: number,
  barIndex: number,
  asset: string = "BTC"
): SwapEvent {
  return createMockSwapEvent({
    fromAsset: "USD",
    toAsset: asset,
    fromAmount: amountUSD,
    toAmount: amountUSD / price,
    price,
    barIndex,
    timestamp: barIndex * 60,
    feeUSD: amountUSD * 0.001,
    slippageUSD: amountUSD * 0.0005,
  });
}

/**
 * Create an exit swap (Asset -> USD)
 */
export function createExitSwap(
  price: number,
  amountAsset: number,
  barIndex: number,
  asset: string = "BTC"
): SwapEvent {
  const amountUSD = amountAsset * price;
  return createMockSwapEvent({
    fromAsset: asset,
    toAsset: "USD",
    fromAmount: amountAsset,
    toAmount: amountUSD,
    price,
    barIndex,
    timestamp: barIndex * 60,
    feeUSD: amountUSD * 0.001,
    slippageUSD: amountUSD * 0.0005,
  });
}

/**
 * Create a mock TradeEvent
 */
export function createMockTradeEvent(
  overrides: Partial<TradeEvent> = {}
): TradeEvent {
  const entrySwap = createEntrySwap(10000, 1000, 0);
  const exitSwap = createExitSwap(10500, 0.1, 10);

  return {
    tradeId: tradeIdCounter++,
    direction: "LONG" as Direction,
    entrySwap,
    exitSwap,
    pnlUSD: exitSwap.toAmount - entrySwap.fromAmount,
    pnlPct: (exitSwap.toAmount - entrySwap.fromAmount) / entrySwap.fromAmount,
    durationBars: exitSwap.barIndex - entrySwap.barIndex,
    durationSeconds: exitSwap.timestamp - entrySwap.timestamp,
    ...overrides,
  };
}

/**
 * Create a winning trade
 */
export function createWinningTrade(
  entryPrice: number,
  exitPrice: number,
  amountUSD: number,
  direction: Direction = "LONG"
): TradeEvent {
  const entryBar = 0;
  const exitBar = 10;

  if (direction === "LONG") {
    const entrySwap = createEntrySwap(entryPrice, amountUSD, entryBar);
    const exitSwap = createExitSwap(exitPrice, entrySwap.toAmount, exitBar);
    const pnlUSD = exitSwap.toAmount - entrySwap.fromAmount;

    return {
      tradeId: tradeIdCounter++,
      direction,
      entrySwap,
      exitSwap,
      pnlUSD,
      pnlPct: pnlUSD / entrySwap.fromAmount,
      durationBars: exitBar - entryBar,
      durationSeconds: (exitBar - entryBar) * 60,
    };
  } else {
    // SHORT: Entry is selling (Asset -> USD), exit is buying (USD -> Asset)
    const entrySwap = createMockSwapEvent({
      fromAsset: "BTC",
      toAsset: "USD",
      fromAmount: amountUSD / entryPrice,
      toAmount: amountUSD,
      price: entryPrice,
      barIndex: entryBar,
    });
    const exitSwap = createMockSwapEvent({
      fromAsset: "USD",
      toAsset: "BTC",
      fromAmount: (amountUSD / entryPrice) * exitPrice,
      toAmount: amountUSD / entryPrice,
      price: exitPrice,
      barIndex: exitBar,
    });
    const pnlUSD = entrySwap.toAmount - exitSwap.fromAmount;

    return {
      tradeId: tradeIdCounter++,
      direction,
      entrySwap,
      exitSwap,
      pnlUSD,
      pnlPct: pnlUSD / entrySwap.toAmount,
      durationBars: exitBar - entryBar,
      durationSeconds: (exitBar - entryBar) * 60,
    };
  }
}

/**
 * Create a losing trade
 */
export function createLosingTrade(
  entryPrice: number,
  exitPrice: number,
  amountUSD: number,
  direction: Direction = "LONG"
): TradeEvent {
  // For a losing LONG trade, exitPrice should be lower than entryPrice
  // For a losing SHORT trade, exitPrice should be higher than entryPrice
  return createWinningTrade(entryPrice, exitPrice, amountUSD, direction);
}

// =============================================================================
// CONDITION SNAPSHOT FACTORIES
// =============================================================================

/**
 * Create a mock ConditionSnapshot
 */
export function createMockConditionSnapshot(
  overrides: Partial<ConditionSnapshot> = {}
): ConditionSnapshot {
  return {
    requiredTrue: 1,
    requiredTotal: 2,
    optionalTrue: 0,
    optionalTotal: 1,
    conditionMet: false,
    distanceFromTrigger: 1,
    ...overrides,
  };
}

/**
 * Create a condition snapshot that is met
 */
export function createMetConditionSnapshot(): ConditionSnapshot {
  return createMockConditionSnapshot({
    requiredTrue: 2,
    requiredTotal: 2,
    optionalTrue: 1,
    optionalTotal: 1,
    conditionMet: true,
    distanceFromTrigger: 0,
  });
}

// =============================================================================
// SIGNAL CACHE FACTORIES
// =============================================================================

/**
 * Create a mock signal cache
 */
export function createMockSignalCache(
  indicators: Record<string, boolean[]>
): Map<string, boolean[]> {
  return new Map(Object.entries(indicators));
}

/**
 * Create a signal cache with alternating signals
 */
export function createAlternatingSignalCache(
  indicatorKey: string,
  length: number,
  startTrue: boolean = false
): Map<string, boolean[]> {
  const signals = Array.from({ length }, (_, i) => (i % 2 === 0) === startTrue);
  return new Map([[indicatorKey, signals]]);
}

/**
 * Create a signal cache with all true signals
 */
export function createAllTrueSignalCache(
  indicatorKey: string,
  length: number
): Map<string, boolean[]> {
  return new Map([[indicatorKey, Array(length).fill(true)]]);
}

/**
 * Create a signal cache with all false signals
 */
export function createAllFalseSignalCache(
  indicatorKey: string,
  length: number
): Map<string, boolean[]> {
  return new Map([[indicatorKey, Array(length).fill(false)]]);
}

// =============================================================================
// METRICS FACTORIES
// =============================================================================

/**
 * Create empty swap metrics
 */
export function createEmptySwapMetrics(): SwapMetrics {
  return {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    totalPnlUSD: 0,
    grossProfitUSD: 0,
    grossLossUSD: 0,
    avgPnlUSD: 0,
    avgWinUSD: 0,
    avgLossUSD: 0,
    largestWinUSD: 0,
    largestLossUSD: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdownPct: 0,
    maxDrawdownUSD: 0,
    calmarRatio: 0,
    longTrades: 0,
    shortTrades: 0,
    longWinRate: 0,
    shortWinRate: 0,
    longPnlUSD: 0,
    shortPnlUSD: 0,
    avgTradeDurationBars: 0,
    avgTradeDurationSeconds: 0,
    avgWinDurationBars: 0,
    avgLossDurationBars: 0,
    totalFeesUSD: 0,
    totalSlippageUSD: 0,
  };
}

// =============================================================================
// EQUITY CURVE FACTORIES
// =============================================================================

/**
 * Create a mock equity curve
 */
export function createMockEquityCurve(
  startEquity: number,
  changes: number[]
): Array<{ timestamp: number; barIndex: number; equity: number; drawdownPct: number }> {
  let equity = startEquity;
  let maxEquity = startEquity;

  return changes.map((change, i) => {
    equity += change;
    maxEquity = Math.max(maxEquity, equity);
    const drawdownPct = maxEquity > 0 ? (maxEquity - equity) / maxEquity : 0;

    return {
      timestamp: i * 60,
      barIndex: i,
      equity,
      drawdownPct,
    };
  });
}

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

/**
 * Assert two numbers are approximately equal
 */
export function assertApproxEqual(
  actual: number,
  expected: number,
  tolerance: number = 0.0001
): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      `Expected ${actual} to be approximately ${expected} (tolerance: ${tolerance}, diff: ${diff})`
    );
  }
}

/**
 * Assert a number is within a range
 */
export function assertInRange(
  value: number,
  min: number,
  max: number
): void {
  if (value < min || value > max) {
    throw new Error(`Expected ${value} to be in range [${min}, ${max}]`);
  }
}
