# Backtester-v2 Architecture

Comprehensive design document for the event-driven backtester. This document serves as the source of truth for implementation.

---

## Table of Contents

1. [Overview](#overview)
2. [Core Principles](#core-principles)
3. [Resolution Strategy](#resolution-strategy)
4. [Indicator Precomputation](#indicator-precomputation)
5. [Special Indicators](#special-indicators)
6. [Simulation Loop](#simulation-loop)
7. [State Machine](#state-machine)
8. [Trade Recording](#trade-recording)
9. [Equity & Drawdown Processing](#equity--drawdown-processing)
10. [Performance Optimizations](#performance-optimizations)
11. [File Structure](#file-structure)
12. [Implementation Checklist](#implementation-checklist)

---

## Overview

The backtester simulates trading algorithms against historical price data to evaluate performance. It uses an **event-driven architecture** with a **single forward pass** through the data.

### Key Design Decisions

1. **Single Forward Pass**: No backtracking. TP/SL/Balance are calculated in parallel with exit conditions.
2. **Special Indicators**: TP, SL, Trailing Stop, and Balance are treated as stateful indicator-like objects.
3. **Batch Processing**: Price data is fed to special indicators in batches (1000+ candles) for efficiency.
4. **Resolution Hierarchy**: Indicators compute at natural resolutions, then interpolate to a common simulation resolution.
5. **Reuse Indicator Machinery**: Special indicators leverage existing operator/indicator patterns from the indicators library.

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INPUT                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  - Historical price data (1m candles minimum)                               │
│  - Algorithm config (AlgoParams with entry/exit conditions)                 │
│  - Backtest config (capital, fees, slippage, time range)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRECOMPUTATION PHASE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Calculate all indicators at their natural resolutions                   │
│  2. Resample/interpolate to common simulation resolution (1m floor)         │
│  3. Store in SignalCache for O(1) lookup                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SIMULATION PHASE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Single forward loop at simulation resolution:                              │
│  - Check entry conditions (from SignalCache)                                │
│  - On entry: create special indicators (TP/SL/Balance)                      │
│  - Batch-feed price data to special indicators                              │
│  - Check exits: first of (SL hit, TP hit, exit condition) wins              │
│  - On exit: destroy special indicators, record trade                        │
│  - Track equity at every simulation step                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         POST-PROCESSING PHASE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Denoise equity curve (least squares)                                    │
│  2. Calculate drawdown from equity curve                                    │
│  3. Denoise drawdown (max operator)                                         │
│  4. Downsample both curves for storage                                      │
│  5. Calculate performance metrics                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTPUT                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  - BacktestResult with:                                                     │
│    - Summary metrics (total P&L, Sharpe, Sortino, win rate, etc.)           │
│    - Performance breakdown by direction                                     │
│    - List of all trades (TradeRecord[])                                     │
│    - Trades analysis (statistics, P&L analysis, duration)                   │
│    - Equity curve (downsampled)                                             │
│    - Drawdown curve (downsampled)                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Principles

### Why Single Forward Pass?

**Previous approach (inefficient):**
```
Pass 1: Loop forward, find exit condition events
Pass 2: Backtrack between entry and exit, check if TP/SL hit first
```

**Current approach (efficient):**
```
Single Pass: Loop forward once
  - Calculate TP/SL in parallel with exit conditions
  - First exit event wins (SL, TP, or signal)
  - No backtracking needed
```

### Why Special Indicators?

TP/SL/Balance are NOT precomputed for the entire dataset because:
1. They depend on trade entry price (unknown until entry happens)
2. They are stateful (trailing stop tracks highest price)
3. They only exist during an open position

By treating them as indicator-like objects, we:
1. Reuse existing indicator machinery (calculate, batch processing)
2. Keep clean separation of concerns
3. Enable future optimizations (Zig migration)

### Why Batch Processing?

Instead of processing one candle at a time:
```typescript
for (const price of prices) {
  checkTP(price);
  checkSL(price);
}
```

We batch 1000+ candles:
```typescript
const results = tpIndicator.calculate(priceBatch); // 1000 at once
```

Benefits:
- More cache-friendly memory access
- Fewer function call overhead
- Prepares for compiled language migration (Zig)

---

## Resolution Strategy

### The Problem

Different indicators use different timeframes:
- EMA(1h) might compute at 5m resolution
- RSI(15m) might compute at 1m resolution
- MACD(4h) might compute at 5m resolution

But the simulation needs a consistent resolution to:
1. Check all conditions at the same timestamps
2. Track TP/SL accurately
3. Build accurate equity curves

### The Solution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Compute indicators at natural resolutions                          │
│                                                                             │
│  Each indicator uses roundingRule() to determine its resolution based on   │
│  its period parameters. See indicators library BaseIndicator.ts.           │
│                                                                             │
│  Example:                                                                   │
│  - EMA(period=3600s/1h) → resolution = 300s (5m)                            │
│  - RSI(period=900s/15m) → resolution = 60s (1m)                             │
│  - MACD(firstPeriod=14400s/4h) → resolution = 300s (5m)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Determine simulation resolution                                    │
│                                                                             │
│  simulation_resolution = max(60, next_lower_bucket(min_indicator_res))      │
│                                                                             │
│  Available buckets: [15, 60, 300] seconds (15s, 1m, 5m)                     │
│  User-facing minimum: 60s (1m)                                              │
│                                                                             │
│  Example:                                                                   │
│  - Min indicator resolution = 60s (1m)                                      │
│  - Next lower bucket = 15s, but floor is 60s                                │
│  - Simulation resolution = 60s (1m)                                         │
│                                                                             │
│  Example 2:                                                                 │
│  - Min indicator resolution = 300s (5m)                                     │
│  - Next lower bucket = 60s (1m)                                             │
│  - Simulation resolution = 60s (1m)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Resample/interpolate all indicators to simulation resolution      │
│                                                                             │
│  All indicator signals are resampled to the common simulation resolution   │
│  so that at every simulation step, we have signal values for all           │
│  indicators.                                                                │
│                                                                             │
│  This uses the existing indicator machinery for interpolation.             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Finer Resolution for Simulation?

The simulation runs at a finer resolution than the indicators to:

1. **Accurate TP/SL detection**: If indicators are at 5m but we only check TP/SL at 5m intervals, we might miss a TP/SL hit that occurred mid-candle.

2. **Accurate drawdown tracking**: Drawdown is the peak-to-trough decline. Missing intermediate prices means missing the true maximum drawdown.

3. **Accurate equity curves**: For visualization and risk metrics, we need granular equity tracking.

---

## Indicator Precomputation

### Current Implementation (calculator.ts)

```typescript
function calculateIndicators(candles: Candle[], configs: IndicatorConfig[]): CalculationResult {
  // 1. Deduplicate indicators by cache key
  // 2. For each unique indicator:
  //    - Get warmup requirements
  //    - Convert candles to ChartPoints at indicator's source resolution
  //    - Calculate indicator over all data
  //    - Extract boolean signals, pad with false for warmup period
  // 3. Return SignalCache + max warmup
}
```

### What Needs to Be Added

1. **Resolution collection**: Get each indicator's resolution via `getPointRequirements().resolution`
2. **Simulation resolution determination**: `max(60, next_lower_bucket(min_resolution))`
3. **Resampling to simulation resolution**: Interpolate all signals to common resolution

### Signal Lookup

After precomputation, signals are stored in a `SignalCache`:

```typescript
interface SignalCache {
  get(key: string): boolean[] | undefined;  // Get signals by indicator cache key
  has(key: string): boolean;
  keys(): string[];
}
```

During simulation, we look up signals by candle index (at simulation resolution).

---

## Special Indicators

Special indicators are stateful objects created at trade entry and destroyed at trade exit. They are NOT precomputed.

### Common Interface

```typescript
interface SpecialIndicator<T> {
  /**
   * Reset the indicator for a new trade
   * @param entryPrice - Price at which position was opened
   * @param entryTime - Timestamp of entry
   */
  reset(entryPrice: number, entryTime: number): void;

  /**
   * Process a batch of prices
   * @param prices - Array of prices at simulation resolution
   * @param times - Array of timestamps corresponding to prices
   * @returns Array of results (one per price)
   */
  calculate(prices: number[], times: number[]): T[];

  /**
   * Check if the indicator has triggered
   */
  isTriggered(): boolean;

  /**
   * Get the price at which trigger occurred (if triggered)
   */
  getTriggerPrice(): number | undefined;

  /**
   * Get the time at which trigger occurred (if triggered)
   */
  getTriggerTime(): number | undefined;
}
```

### TakeProfitIndicator

```typescript
class TakeProfitIndicator implements SpecialIndicator<boolean> {
  private entryPrice: number;
  private tpPrice: number;
  private isHit: boolean = false;
  private hitPrice: number | undefined;
  private hitTime: number | undefined;
  private direction: Direction;

  constructor(
    direction: Direction,      // "LONG" or "SHORT"
    tpConfig: ValueConfig      // { type: "ABS" | "REL", value: number }
  ) {
    this.direction = direction;
    this.tpConfig = tpConfig;
  }

  reset(entryPrice: number, entryTime: number): void {
    this.entryPrice = entryPrice;
    this.isHit = false;
    this.hitPrice = undefined;
    this.hitTime = undefined;

    // Calculate TP price based on config
    if (this.tpConfig.type === "REL") {
      // Relative: e.g., 0.02 = 2% profit target
      if (this.direction === "LONG") {
        this.tpPrice = entryPrice * (1 + this.tpConfig.value);
      } else {
        this.tpPrice = entryPrice * (1 - this.tpConfig.value);
      }
    } else {
      // Absolute: e.g., $100 profit target
      if (this.direction === "LONG") {
        this.tpPrice = entryPrice + this.tpConfig.value;
      } else {
        this.tpPrice = entryPrice - this.tpConfig.value;
      }
    }
  }

  calculate(prices: number[], times: number[]): boolean[] {
    const results: boolean[] = [];

    for (let i = 0; i < prices.length; i++) {
      if (!this.isHit) {
        const price = prices[i];
        const hitCondition = this.direction === "LONG"
          ? price >= this.tpPrice
          : price <= this.tpPrice;

        if (hitCondition) {
          this.isHit = true;
          this.hitPrice = this.tpPrice; // Exit at TP price, not market price
          this.hitTime = times[i];
        }
      }
      results.push(this.isHit);
    }

    return results;
  }

  isTriggered(): boolean { return this.isHit; }
  getTriggerPrice(): number | undefined { return this.hitPrice; }
  getTriggerTime(): number | undefined { return this.hitTime; }
  getTPPrice(): number { return this.tpPrice; }
}
```

### StopLossIndicator

```typescript
class StopLossIndicator implements SpecialIndicator<boolean> {
  private entryPrice: number;
  private slPrice: number;
  private isHit: boolean = false;
  private hitPrice: number | undefined;
  private hitTime: number | undefined;
  private direction: Direction;

  constructor(
    direction: Direction,
    slConfig: ValueConfig
  ) {
    this.direction = direction;
    this.slConfig = slConfig;
  }

  reset(entryPrice: number, entryTime: number): void {
    this.entryPrice = entryPrice;
    this.isHit = false;
    this.hitPrice = undefined;
    this.hitTime = undefined;

    if (this.slConfig.type === "REL") {
      if (this.direction === "LONG") {
        this.slPrice = entryPrice * (1 - this.slConfig.value);
      } else {
        this.slPrice = entryPrice * (1 + this.slConfig.value);
      }
    } else {
      if (this.direction === "LONG") {
        this.slPrice = entryPrice - this.slConfig.value;
      } else {
        this.slPrice = entryPrice + this.slConfig.value;
      }
    }
  }

  calculate(prices: number[], times: number[]): boolean[] {
    const results: boolean[] = [];

    for (let i = 0; i < prices.length; i++) {
      if (!this.isHit) {
        const price = prices[i];
        const hitCondition = this.direction === "LONG"
          ? price <= this.slPrice
          : price >= this.slPrice;

        if (hitCondition) {
          this.isHit = true;
          this.hitPrice = this.slPrice;
          this.hitTime = times[i];
        }
      }
      results.push(this.isHit);
    }

    return results;
  }

  isTriggered(): boolean { return this.isHit; }
  getTriggerPrice(): number | undefined { return this.hitPrice; }
  getTriggerTime(): number | undefined { return this.hitTime; }
  getSLPrice(): number { return this.slPrice; }
}
```

### TrailingStopIndicator

```typescript
class TrailingStopIndicator implements SpecialIndicator<boolean> {
  private entryPrice: number;
  private extremePrice: number;    // Highest (long) or lowest (short) price seen
  private currentSLPrice: number;
  private isHit: boolean = false;
  private hitPrice: number | undefined;
  private hitTime: number | undefined;
  private direction: Direction;
  private trailingOffset: number;  // As decimal (0.02 = 2%)

  constructor(
    direction: Direction,
    trailingConfig: ValueConfig  // The offset from extreme
  ) {
    this.direction = direction;
    this.trailingConfig = trailingConfig;
  }

  reset(entryPrice: number, entryTime: number): void {
    this.entryPrice = entryPrice;
    this.extremePrice = entryPrice;
    this.isHit = false;
    this.hitPrice = undefined;
    this.hitTime = undefined;

    // Initial SL at entry price minus offset
    this.trailingOffset = this.trailingConfig.type === "REL"
      ? this.trailingConfig.value
      : this.trailingConfig.value / entryPrice;

    this.updateSLPrice();
  }

  private updateSLPrice(): void {
    if (this.direction === "LONG") {
      this.currentSLPrice = this.extremePrice * (1 - this.trailingOffset);
    } else {
      this.currentSLPrice = this.extremePrice * (1 + this.trailingOffset);
    }
  }

  calculate(prices: number[], times: number[]): boolean[] {
    const results: boolean[] = [];

    for (let i = 0; i < prices.length; i++) {
      if (!this.isHit) {
        const price = prices[i];

        // Update extreme price (ratchet effect)
        if (this.direction === "LONG" && price > this.extremePrice) {
          this.extremePrice = price;
          this.updateSLPrice();
        } else if (this.direction === "SHORT" && price < this.extremePrice) {
          this.extremePrice = price;
          this.updateSLPrice();
        }

        // Check if SL hit
        const hitCondition = this.direction === "LONG"
          ? price <= this.currentSLPrice
          : price >= this.currentSLPrice;

        if (hitCondition) {
          this.isHit = true;
          this.hitPrice = this.currentSLPrice;
          this.hitTime = times[i];
        }
      }
      results.push(this.isHit);
    }

    return results;
  }

  isTriggered(): boolean { return this.isHit; }
  getTriggerPrice(): number | undefined { return this.hitPrice; }
  getTriggerTime(): number | undefined { return this.hitTime; }
  getCurrentSLPrice(): number { return this.currentSLPrice; }
  getExtremePrice(): number { return this.extremePrice; }
}
```

### BalanceIndicator

```typescript
interface BalanceResult {
  balance: number;      // Current portfolio value
  unrealizedPnL: number; // Current unrealized P&L
}

class BalanceIndicator implements SpecialIndicator<BalanceResult> {
  private entryPrice: number;
  private positionSize: number;  // In base currency (e.g., 0.5 BTC)
  private cashBalance: number;   // Cash after opening position
  private direction: Direction;

  constructor(
    direction: Direction,
    initialCapital: number,
    positionSizeConfig: ValueConfig,
    feeBps: number,
    slippageBps: number
  ) {
    this.direction = direction;
    this.initialCapital = initialCapital;
    this.positionSizeConfig = positionSizeConfig;
    this.feeBps = feeBps;
    this.slippageBps = slippageBps;
  }

  reset(entryPrice: number, entryTime: number): void {
    this.entryPrice = entryPrice;

    // Calculate position size
    const positionValue = this.positionSizeConfig.type === "REL"
      ? this.initialCapital * this.positionSizeConfig.value
      : this.positionSizeConfig.value;

    // Apply slippage to entry price
    const slippageMultiplier = 1 + (this.slippageBps / 10000);
    const effectiveEntryPrice = this.direction === "LONG"
      ? entryPrice * slippageMultiplier
      : entryPrice / slippageMultiplier;

    // Calculate position size in base currency
    this.positionSize = positionValue / effectiveEntryPrice;

    // Calculate fees
    const entryFee = positionValue * (this.feeBps / 10000);

    // Cash remaining after entry
    this.cashBalance = this.initialCapital - positionValue - entryFee;
  }

  calculate(prices: number[], times: number[]): BalanceResult[] {
    const results: BalanceResult[] = [];

    for (const price of prices) {
      // Current position value
      const positionValue = this.positionSize * price;

      // Unrealized P&L
      const entryValue = this.positionSize * this.entryPrice;
      const unrealizedPnL = this.direction === "LONG"
        ? positionValue - entryValue
        : entryValue - positionValue;

      // Total balance
      const balance = this.cashBalance + positionValue;

      results.push({ balance, unrealizedPnL });
    }

    return results;
  }

  // These don't apply to BalanceIndicator in the same way
  isTriggered(): boolean { return false; }
  getTriggerPrice(): number | undefined { return undefined; }
  getTriggerTime(): number | undefined { return undefined; }

  getPositionSize(): number { return this.positionSize; }
  getCashBalance(): number { return this.cashBalance; }
}
```

---

## Simulation Loop

### Main Loop Structure

```typescript
function runBacktest(
  candles: Candle[],
  config: BacktestConfig,
  signalCache: SignalCache,
  simulationResolution: number
): BacktestResult {
  // State
  let state: PositionState = "FLAT";
  let currentCapital = config.startingCapitalUSD;
  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];

  // Special indicators (null when FLAT)
  let tpIndicator: TakeProfitIndicator | null = null;
  let slIndicator: StopLossIndicator | null = null;
  let trailingIndicator: TrailingStopIndicator | null = null;
  let balanceIndicator: BalanceIndicator | null = null;

  // Current trade info
  let currentTrade: Partial<TradeRecord> | null = null;

  // Get prices at simulation resolution
  const prices = candles.map(c => c.close);
  const times = candles.map(c => c.bucket);

  // Batch processing
  const BATCH_SIZE = 1000;

  for (let batchStart = 0; batchStart < candles.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, candles.length);
    const priceBatch = prices.slice(batchStart, batchEnd);
    const timeBatch = times.slice(batchStart, batchEnd);

    // If in position, calculate special indicators for this batch
    let tpResults: boolean[] | null = null;
    let slResults: boolean[] | null = null;
    let trailingResults: boolean[] | null = null;
    let balanceResults: BalanceResult[] | null = null;

    if (state !== "FLAT") {
      tpResults = tpIndicator?.calculate(priceBatch, timeBatch) ?? null;
      slResults = slIndicator?.calculate(priceBatch, timeBatch) ?? null;
      trailingResults = trailingIndicator?.calculate(priceBatch, timeBatch) ?? null;
      balanceResults = balanceIndicator?.calculate(priceBatch, timeBatch) ?? null;
    }

    // Process each candle in the batch
    for (let i = 0; i < priceBatch.length; i++) {
      const globalIndex = batchStart + i;
      const price = priceBatch[i];
      const time = timeBatch[i];

      if (state === "FLAT") {
        // Check entry conditions
        const longEntry = checkEntryCondition(config.algoParams.longEntry, globalIndex, signalCache);
        const shortEntry = checkEntryCondition(config.algoParams.shortEntry, globalIndex, signalCache);

        if (longEntry && config.algoParams.type !== "SHORT") {
          state = "LONG";
          currentTrade = openPosition("LONG", price, time, globalIndex, currentCapital, config);
          initializeSpecialIndicators("LONG", price, time, currentCapital, config);
        } else if (shortEntry && config.algoParams.type !== "LONG") {
          state = "SHORT";
          currentTrade = openPosition("SHORT", price, time, globalIndex, currentCapital, config);
          initializeSpecialIndicators("SHORT", price, time, currentCapital, config);
        }

        // Track equity when flat
        equityCurve.push({ time, equity: currentCapital, drawdownPct: 0, runupPct: 0 });

      } else {
        // In position - check exits
        const direction = state as Direction;

        // Check exit conditions (in priority order)
        let exitReason: ExitReason | null = null;
        let exitPrice = price;

        // 1. Stop Loss (highest priority - risk management)
        if (slResults?.[i] || trailingResults?.[i]) {
          exitReason = trailingResults?.[i] ? "TRAILING_STOP" : "STOP_LOSS";
          exitPrice = trailingIndicator?.getTriggerPrice() ?? slIndicator?.getTriggerPrice() ?? price;
        }
        // 2. Take Profit
        else if (tpResults?.[i]) {
          exitReason = "TAKE_PROFIT";
          exitPrice = tpIndicator?.getTriggerPrice() ?? price;
        }
        // 3. Signal-based exit
        else {
          const exitCondition = direction === "LONG"
            ? config.algoParams.longExit
            : config.algoParams.shortExit;
          if (checkExitCondition(exitCondition, globalIndex, signalCache)) {
            exitReason = "SIGNAL";
          }
        }

        // Track equity during position
        if (balanceResults) {
          const { balance, unrealizedPnL } = balanceResults[i];
          equityCurve.push({
            time,
            equity: balance,
            drawdownPct: 0, // Calculated in post-processing
            runupPct: 0     // Calculated in post-processing
          });
        }

        // Execute exit if triggered
        if (exitReason) {
          const completedTrade = closePosition(
            currentTrade!,
            exitPrice,
            time,
            globalIndex,
            exitReason,
            config
          );
          trades.push(completedTrade);
          currentCapital = completedTrade.equityAfterTrade;

          // Cleanup
          state = "FLAT";
          currentTrade = null;
          destroySpecialIndicators();
        }
      }
    }
  }

  // Force close any open position at end
  if (state !== "FLAT" && currentTrade) {
    const lastPrice = prices[prices.length - 1];
    const lastTime = times[times.length - 1];
    const completedTrade = closePosition(
      currentTrade,
      lastPrice,
      lastTime,
      candles.length - 1,
      "END_OF_BACKTEST",
      config
    );
    trades.push(completedTrade);
  }

  // Post-process and return results
  return buildBacktestResult(config, trades, equityCurve);
}
```

### Helper Functions

```typescript
function checkEntryCondition(
  condition: EntryCondition | undefined,
  candleIndex: number,
  cache: SignalCache
): boolean {
  if (!condition) return false;
  return evaluateCondition(condition, candleIndex, cache);
}

function checkExitCondition(
  condition: ExitCondition | undefined,
  candleIndex: number,
  cache: SignalCache
): boolean {
  if (!condition) return false;
  // Only check indicator-based exits, not TP/SL (handled separately)
  return evaluateCondition(condition, candleIndex, cache);
}

function openPosition(
  direction: Direction,
  price: number,
  time: number,
  candleIndex: number,
  capital: number,
  config: BacktestConfig
): Partial<TradeRecord> {
  // Apply slippage
  const slippageMult = 1 + (config.slippageBps / 10000);
  const entryPrice = direction === "LONG"
    ? price * slippageMult
    : price / slippageMult;

  // Calculate position size
  const positionValue = config.positionSize.type === "REL"
    ? capital * config.positionSize.value
    : config.positionSize.value;

  const qty = positionValue / entryPrice;

  return {
    direction,
    entryTime: time,
    entryPrice,
    qty,
    // Exit fields filled on close
  };
}

function closePosition(
  trade: Partial<TradeRecord>,
  price: number,
  time: number,
  candleIndex: number,
  exitReason: ExitReason,
  config: BacktestConfig
): TradeRecord {
  // Apply slippage to exit
  const slippageMult = 1 + (config.slippageBps / 10000);
  const exitPrice = trade.direction === "LONG"
    ? price / slippageMult
    : price * slippageMult;

  // Calculate P&L
  const entryValue = trade.qty! * trade.entryPrice!;
  const exitValue = trade.qty! * exitPrice;
  const grossPnL = trade.direction === "LONG"
    ? exitValue - entryValue
    : entryValue - exitValue;

  // Apply fees
  const entryFee = entryValue * (config.feeBps / 10000);
  const exitFee = exitValue * (config.feeBps / 10000);
  const pnlUSD = grossPnL - entryFee - exitFee;
  const pnlPct = pnlUSD / entryValue;

  return {
    ...trade,
    tradeId: generateTradeId(),
    exitTime: time,
    exitPrice,
    pnlUSD,
    pnlPct,
    exitReason,
    durationSeconds: time - trade.entryTime!,
    // Other fields calculated from tracking data
  } as TradeRecord;
}
```

---

## State Machine

The state machine is intentionally simple and kept in a separate file for modularity.

### States

```typescript
type PositionState = "FLAT" | "LONG" | "SHORT";
```

### Transitions

```
        ┌─────────────────────────────────────────┐
        │                                         │
        ▼                                         │
┌───────────────┐    Long Entry    ┌───────────────┐
│               │ ───────────────► │               │
│     FLAT      │                  │     LONG      │
│               │ ◄─────────────── │               │
└───────────────┘    Long Exit     └───────────────┘
        │                                         ▲
        │                                         │
        │  Short Entry                            │
        ▼                                         │
┌───────────────┐                                 │
│               │                                 │
│    SHORT      │ ────────────────────────────────┘
│               │         (via FLAT)
└───────────────┘
        │
        │  Short Exit
        │
        └─────────────► FLAT
```

### Implementation

```typescript
// src/simulation/state-machine.ts

interface StateMachineConfig {
  algoType: AlgoType;  // "LONG" | "SHORT" | "BOTH"
}

class TradingStateMachine {
  private state: PositionState = "FLAT";
  private config: StateMachineConfig;

  constructor(config: StateMachineConfig) {
    this.config = config;
  }

  getState(): PositionState {
    return this.state;
  }

  canEnterLong(): boolean {
    return this.state === "FLAT" && this.config.algoType !== "SHORT";
  }

  canEnterShort(): boolean {
    return this.state === "FLAT" && this.config.algoType !== "LONG";
  }

  canExit(): boolean {
    return this.state !== "FLAT";
  }

  enterLong(): void {
    if (!this.canEnterLong()) {
      throw new Error(`Cannot enter LONG from state ${this.state}`);
    }
    this.state = "LONG";
  }

  enterShort(): void {
    if (!this.canEnterShort()) {
      throw new Error(`Cannot enter SHORT from state ${this.state}`);
    }
    this.state = "SHORT";
  }

  exit(): void {
    if (!this.canExit()) {
      throw new Error(`Cannot exit from state ${this.state}`);
    }
    this.state = "FLAT";
  }

  reset(): void {
    this.state = "FLAT";
  }
}
```

---

## Trade Recording

### TradeRecord Fields

Each completed trade records:

```typescript
interface TradeRecord {
  // Identification
  tradeId: number;
  direction: Direction;

  // Entry
  entryTime: number;
  entryPrice: number;

  // Exit
  exitTime: number;
  exitPrice: number;
  exitReason: ExitReason;

  // Position
  qty: number;

  // P&L
  pnlUSD: number;
  pnlPct: number;

  // Intra-trade extremes (from BalanceIndicator tracking)
  runUpUSD: number;
  runUpPct: number;
  drawdownUSD: number;
  drawdownPct: number;

  // Duration
  durationSeconds: number;
  durationBars: number;

  // Running totals
  cumulativePnlUSD: number;
  equityAfterTrade: number;

  // Risk levels (what was set)
  stopLossPrice?: number;
  takeProfitPrice?: number;
}
```

### Intra-Trade Tracking

During a position, we track:
- **Run-up**: Maximum unrealized profit
- **Drawdown**: Maximum unrealized loss

These are calculated from the BalanceIndicator results during the position.

---

## Equity & Drawdown Processing

### Pipeline

```
Raw equity curve (1m resolution)
        │
        ▼
┌───────────────────────────────────────┐
│  Least Squares Denoising              │
│  - Smooths noise while preserving     │
│    trend and major movements          │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Calculate Drawdown                   │
│  - Track running maximum              │
│  - Drawdown = (current - max) / max   │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Max Operator Denoising (Drawdown)    │
│  - Preserves peak drawdowns           │
│  - Reduces noise between peaks        │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Downsampling                         │
│  - Take every Nth point               │
│  - Reduces storage/visualization      │
│    overhead                           │
└───────────────────────────────────────┘
        │
        ▼
Store to database
```

### Implementation

```typescript
// src/output/equity-curve.ts

function processEquityCurve(rawEquity: EquityPoint[]): EquityPoint[] {
  // Extract values
  const values = rawEquity.map(p => p.equity);
  const times = rawEquity.map(p => p.time);

  // Denoise with least squares
  const denoisedValues = leastSquaresSmooth(values);

  // Calculate drawdown
  let runningMax = denoisedValues[0];
  const drawdowns: number[] = [];
  const runups: number[] = [];
  let runningMin = denoisedValues[0];

  for (const value of denoisedValues) {
    // Drawdown from peak
    runningMax = Math.max(runningMax, value);
    const drawdownPct = (value - runningMax) / runningMax;
    drawdowns.push(drawdownPct);

    // Runup from trough
    runningMin = Math.min(runningMin, value);
    const runupPct = (value - runningMin) / runningMin;
    runups.push(runupPct);
  }

  // Denoise drawdown with max operator
  const denoisedDrawdown = maxOperatorSmooth(drawdowns);

  // Combine
  const processed: EquityPoint[] = denoisedValues.map((equity, i) => ({
    time: times[i],
    equity,
    drawdownPct: denoisedDrawdown[i],
    runupPct: runups[i]
  }));

  return processed;
}

function downsample(points: EquityPoint[], factor: number = 4): EquityPoint[] {
  return points.filter((_, i) => i % factor === 0);
}
```

---

## Performance Optimizations

### Current Optimizations

1. **Batch processing**: Feed 1000+ candles to special indicators at once
2. **Signal caching**: Precompute and cache all indicator signals
3. **Single forward pass**: No backtracking

### Future Optimizations

1. **Zig migration**: Move heavy calculations to compiled language
   - 5-10x speedup from cache-friendly memory layout
   - No heap allocation per number

2. **SIMD operations**: Vectorized arithmetic for batch calculations

3. **Web Workers**: Parallelize multiple backtests

---

## File Structure

```
src/
├── index.ts                    # Entry point, exports runBacktest()
├── core/
│   ├── types.ts                # Core types (done)
│   ├── config.ts               # BacktestConfig with Zod (done)
│   └── constants.ts            # Constants (done)
├── indicators/
│   ├── calculator.ts           # Precompute indicator signals (done)
│   ├── evaluator.ts            # Evaluate conditions (done)
│   └── resampler.ts            # Resample to simulation resolution (TODO)
├── simulation/
│   ├── state-machine.ts        # Position state machine (TODO)
│   ├── loop.ts                 # Main simulation loop (TODO)
│   └── special-indicators/
│       ├── types.ts            # SpecialIndicator interface (TODO)
│       ├── take-profit.ts      # TakeProfitIndicator (TODO)
│       ├── stop-loss.ts        # StopLossIndicator (TODO)
│       ├── trailing-stop.ts    # TrailingStopIndicator (TODO)
│       └── balance.ts          # BalanceIndicator (TODO)
├── output/
│   ├── types.ts                # Output types (done)
│   ├── metrics.ts              # Calculate performance metrics (TODO)
│   ├── equity-curve.ts         # Equity processing (TODO)
│   └── trade-recorder.ts       # Trade recording helpers (TODO)
└── utils/
    ├── denoising.ts            # Least squares, max operator (TODO)
    └── downsampling.ts         # Downsampling utilities (TODO)
```

---

## Implementation Checklist

### Phase 1: Foundation (Current)
- [x] Core types (types.ts)
- [x] Backtest config with Zod (config.ts)
- [x] Constants (constants.ts)
- [x] Indicator precomputation (calculator.ts)
- [x] Condition evaluation (evaluator.ts)
- [x] Output types (output/types.ts)

### Phase 2: Simulation Core
- [ ] Resampler for simulation resolution
- [ ] State machine (state-machine.ts)
- [ ] Special indicator interface
- [ ] TakeProfitIndicator
- [ ] StopLossIndicator
- [ ] TrailingStopIndicator
- [ ] BalanceIndicator
- [ ] Main simulation loop (loop.ts)
- [ ] Trade recording helpers

### Phase 3: Post-Processing
- [ ] Least squares denoising
- [ ] Max operator denoising
- [ ] Downsampling
- [ ] Equity curve processing
- [ ] Metrics calculation (Sharpe, Sortino, etc.)

### Phase 4: Integration
- [ ] Main runBacktest() function
- [ ] Error handling
- [ ] Validation
- [ ] Tests

### Phase 5: Optimization (Future)
- [ ] Zig migration for hot paths
- [ ] SIMD operations
- [ ] Web Worker parallelization

---

## References

- Indicators library: `../indicators/src/`
- Output types: `src/output/types.ts`
