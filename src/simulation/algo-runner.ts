/**
 * AlgoRunner - Environment-Agnostic Trading Algorithm
 *
 * @module simulation/algo-runner
 * @description
 * This is the core trading algorithm that runs identically in backtest and live modes.
 * It uses injected interfaces (IExecutor, IDatabase, IIndicatorFeed) and has NO knowledge
 * of whether it's running in backtest or live mode.
 *
 * @architecture
 * The algo class should have NO conditional logic like
 * 'if is_backtesting: do X else do Y'.
 *
 * This class fulfills that requirement by:
 * - Using IExecutor for all trade execution
 * - Using IDatabase for all event logging
 * - Using IIndicatorFeed for all signal access
 * - Having ZERO awareness of the execution environment
 *
 * @audit-trail
 * - Created: 2026-01-01 (Phase 6 Completion: Dependency Injection Integration)
 * - Purpose: Implement environment-agnostic trading logic using injected interfaces
 */

import type {
  Candle,
  AlgoParams,
  Direction,
  PositionState,
} from "../core/types.ts";
import type { IExecutor, Position } from "../interfaces/executor.ts";
import type { IDatabase } from "../interfaces/database.ts";
import type { IIndicatorFeed } from "../interfaces/indicator-feed.ts";
import type {
  ConditionType,
  StateTransitionEvent,
  ConditionChangeEvent,
} from "../events/types.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for AlgoRunner.
 */
export interface AlgoRunnerConfig {
  /** Algorithm parameters */
  algoParams: AlgoParams;
  /** Asset symbol */
  symbol: string;
  /** Enter on first signal without waiting for edge */
  assumePositionImmediately?: boolean;
  /** Maximum trades allowed (undefined = unlimited) */
  tradesLimit?: number;
  /** Number of warmup bars to skip */
  warmupBars?: number;
}

/**
 * Result of processing a single bar.
 */
export interface BarResult {
  /** Bar index processed */
  barIndex: number;
  /** Timestamp of bar */
  timestamp: number;
  /** Current position state after processing */
  positionState: PositionState;
  /** Whether an entry occurred */
  entryOccurred: boolean;
  /** Whether an exit occurred */
  exitOccurred: boolean;
  /** Current equity */
  equity: number;
}

/**
 * State tracked by the algo runner.
 */
interface AlgoState {
  positionState: PositionState;
  tradeCount: number;
  currentBarIndex: number;
}

// =============================================================================
// ALGO RUNNER CLASS
// =============================================================================

/**
 * Environment-agnostic trading algorithm runner.
 *
 * This class implements the core trading logic using injected interfaces.
 * It can be used with:
 * - Backtest: FakeExecutor + FakeDatabase + PreCalculatedFeed
 * - Live: RealExecutor + RealDatabase + RealTimeFeed
 *
 * @example
 * ```typescript
 * // Create with backtest environment
 * const env = createBacktestEnvironment({...});
 * const algo = new AlgoRunner(
 *   env.executor,
 *   env.database,
 *   env.indicatorFeed,
 *   { algoParams, symbol: "BTC" }
 * );
 *
 * // Process each bar
 * for (const candle of candles) {
 *   await algo.onBar(candle, barIndex);
 * }
 *
 * // Or with live environment (same code!)
 * const liveEnv = createLiveEnvironment({...});
 * const liveAlgo = new AlgoRunner(
 *   liveEnv.executor,
 *   liveEnv.database,
 *   liveEnv.indicatorFeed,
 *   { algoParams, symbol: "BTC" }
 * );
 * ```
 */
export class AlgoRunner {
  private executor: IExecutor;
  private database: IDatabase;
  private indicatorFeed: IIndicatorFeed;
  private config: AlgoRunnerConfig;
  private state: AlgoState;

  constructor(
    executor: IExecutor,
    database: IDatabase,
    indicatorFeed: IIndicatorFeed,
    config: AlgoRunnerConfig
  ) {
    this.executor = executor;
    this.database = database;
    this.indicatorFeed = indicatorFeed;
    this.config = {
      assumePositionImmediately: false,
      warmupBars: 0,
      ...config,
    };
    this.state = {
      positionState: "FLAT",
      tradeCount: 0,
      currentBarIndex: 0,
    };
  }

  /**
   * Process a single bar/candle.
   *
   * This is the main entry point called for each bar. It:
   * 1. Updates indicator feed with current bar
   * 2. Checks for exit conditions (if in position)
   * 3. Checks for entry conditions (if flat)
   * 4. Logs all events to database
   *
   * @param candle - The current candle data
   * @param barIndex - The bar index
   */
  async onBar(candle: Candle, barIndex: number): Promise<BarResult> {
    this.state.currentBarIndex = barIndex;

    // Update indicator feed with current bar
    this.indicatorFeed.setCurrentBar(barIndex, candle.bucket);

    let entryOccurred = false;
    let exitOccurred = false;

    // Skip warmup period
    const isWarmupPeriod = barIndex < (this.config.warmupBars ?? 0);

    // Check for exit if in position
    if (this.state.positionState !== "FLAT") {
      const exitResult = await this.checkExit(candle, barIndex);
      if (exitResult) {
        exitOccurred = true;
      }
    }

    // Check for entry if flat and past warmup
    if (this.state.positionState === "FLAT" && !isWarmupPeriod) {
      const entryResult = await this.checkEntry(candle, barIndex);
      if (entryResult) {
        entryOccurred = true;
      }
    }

    // Get current equity from executor
    const equity = await this.executor.getBalance();

    return {
      barIndex,
      timestamp: candle.bucket,
      positionState: this.state.positionState,
      entryOccurred,
      exitOccurred,
      equity,
    };
  }

  /**
   * Force close any open position.
   * Called at end of backtest or when stopping live trading.
   */
  async closePosition(candle: Candle, barIndex: number, reason: string): Promise<boolean> {
    if (this.state.positionState === "FLAT") {
      return false;
    }

    const position = await this.executor.getPosition(this.config.symbol);
    if (!position) {
      return false;
    }

    // Place closing order
    const side = this.state.positionState === "LONG" ? "SELL" : "BUY";
    await this.executor.placeOrder({
      clientOrderId: `close-${barIndex}`,
      symbol: this.config.symbol,
      side,
      type: "MARKET",
      amountAsset: position.size,
    });

    // Log state transition
    await this.logStateTransition(
      barIndex,
      candle.bucket,
      this.state.positionState,
      "FLAT",
      reason as "END_OF_BACKTEST" | "EXIT_SIGNAL"
    );

    this.state.positionState = "FLAT";
    this.state.tradeCount++;

    return true;
  }

  /**
   * Get current position state.
   */
  getPositionState(): PositionState {
    return this.state.positionState;
  }

  /**
   * Get current trade count.
   */
  getTradeCount(): number {
    return this.state.tradeCount;
  }

  /**
   * Reset the runner state.
   */
  reset(): void {
    this.state = {
      positionState: "FLAT",
      tradeCount: 0,
      currentBarIndex: 0,
    };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private async checkEntry(candle: Candle, barIndex: number): Promise<boolean> {
    // Check trade limit
    if (this.config.tradesLimit !== undefined &&
        this.state.tradeCount >= this.config.tradesLimit) {
      return false;
    }

    const algoType = this.config.algoParams.type;

    // Check long entry
    if (algoType !== "SHORT") {
      const shouldEnterLong = this.checkConditionTrigger("LONG_ENTRY");
      if (shouldEnterLong) {
        await this.enterPosition("LONG", candle, barIndex);
        return true;
      }
    }

    // Check short entry
    if (algoType !== "LONG") {
      const shouldEnterShort = this.checkConditionTrigger("SHORT_ENTRY");
      if (shouldEnterShort) {
        await this.enterPosition("SHORT", candle, barIndex);
        return true;
      }
    }

    return false;
  }

  private async checkExit(candle: Candle, barIndex: number): Promise<boolean> {
    const exitConditionType: ConditionType =
      this.state.positionState === "LONG" ? "LONG_EXIT" : "SHORT_EXIT";

    const shouldExit = this.checkConditionTrigger(exitConditionType);

    if (shouldExit) {
      await this.exitPosition(candle, barIndex, "EXIT_SIGNAL");
      return true;
    }

    // TODO: Check stop loss, take profit, trailing stop
    // These would be handled by checking special indicator states

    return false;
  }

  private checkConditionTrigger(conditionType: ConditionType): boolean {
    const snapshot = this.indicatorFeed.getConditionSnapshot(conditionType);
    const previousMet = this.indicatorFeed.getPreviousConditionMet(conditionType);

    if (this.config.assumePositionImmediately) {
      // Enter immediately when condition is true
      return snapshot.conditionMet;
    } else {
      // Wait for edge: false → true transition
      return !previousMet && snapshot.conditionMet;
    }
  }

  private async enterPosition(
    direction: Direction,
    candle: Candle,
    barIndex: number
  ): Promise<void> {
    // Calculate position size
    const positionSizeUSD = this.calculatePositionSize();

    // Place order via executor
    const side = direction === "LONG" ? "BUY" : "SELL";
    await this.executor.placeOrder({
      clientOrderId: `entry-${barIndex}`,
      symbol: this.config.symbol,
      side,
      type: "MARKET",
      amountUSD: positionSizeUSD,
    });

    // Update state
    const newState: PositionState = direction === "LONG" ? "LONG" : "SHORT";
    await this.logStateTransition(barIndex, candle.bucket, "FLAT", newState, "ENTRY_SIGNAL");
    this.state.positionState = newState;

    // Log condition change
    const conditionType: ConditionType = direction === "LONG" ? "LONG_ENTRY" : "SHORT_ENTRY";
    await this.logConditionChange(barIndex, candle.bucket, conditionType, true);
  }

  private async exitPosition(
    candle: Candle,
    barIndex: number,
    reason: "EXIT_SIGNAL" | "STOP_LOSS" | "TAKE_PROFIT" | "TRAILING_STOP"
  ): Promise<void> {
    // Get current position
    const position = await this.executor.getPosition(this.config.symbol);
    if (!position) {
      return;
    }

    // Place closing order
    const side = this.state.positionState === "LONG" ? "SELL" : "BUY";
    await this.executor.placeOrder({
      clientOrderId: `exit-${barIndex}`,
      symbol: this.config.symbol,
      side,
      type: "MARKET",
      amountAsset: position.size,
    });

    // Log state transition
    await this.logStateTransition(
      barIndex,
      candle.bucket,
      this.state.positionState,
      "FLAT",
      reason
    );

    // Log condition change
    const conditionType: ConditionType =
      this.state.positionState === "LONG" ? "LONG_EXIT" : "SHORT_EXIT";
    await this.logConditionChange(barIndex, candle.bucket, conditionType, true);

    // Update state
    this.state.positionState = "FLAT";
    this.state.tradeCount++;
  }

  private calculatePositionSize(): number {
    const config = this.config.algoParams.positionSize;
    const capital = this.config.algoParams.startingCapitalUSD;

    if (config.type === "ABS") {
      return Math.min(config.value, capital);
    } else {
      // REL or DYN
      return capital * config.value;
    }
  }

  private async logStateTransition(
    barIndex: number,
    timestamp: number,
    fromState: PositionState,
    toState: PositionState,
    reason: "ENTRY_SIGNAL" | "EXIT_SIGNAL" | "STOP_LOSS" | "TAKE_PROFIT" | "TRAILING_STOP" | "END_OF_BACKTEST"
  ): Promise<void> {
    const event: StateTransitionEvent = {
      type: "STATE_TRANSITION",
      timestamp,
      barIndex,
      fromState,
      toState,
      reason,
    };
    await this.database.logAlgoEvent(event);
  }

  private async logConditionChange(
    barIndex: number,
    timestamp: number,
    conditionType: ConditionType,
    newState: boolean
  ): Promise<void> {
    const snapshot = this.indicatorFeed.getConditionSnapshot(conditionType);
    const previousState = this.indicatorFeed.getPreviousConditionMet(conditionType);
    const event: ConditionChangeEvent = {
      type: "CONDITION_CHANGE",
      timestamp,
      barIndex,
      conditionType,
      previousState,
      newState,
      snapshot,
    };
    await this.database.logAlgoEvent(event);
  }
}

// =============================================================================
// BACKTEST RUNNER
// =============================================================================

/**
 * Result of running a backtest with AlgoRunner.
 */
export interface AlgoRunnerBacktestResult {
  /** All bar results */
  barResults: BarResult[];
  /** Final trade count */
  totalTrades: number;
  /** Final equity */
  finalEquity: number;
  /** Final position state */
  finalPositionState: PositionState;
}

/**
 * Run a complete backtest using AlgoRunner with BacktestEnvironment.
 *
 * This function:
 * 1. Creates an AlgoRunner with the environment's interfaces
 * 2. Loops through all candles
 * 3. Calls onBar for each candle
 * 4. Handles end-of-backtest cleanup
 *
 * @param executor - IExecutor implementation (FakeExecutor for backtest)
 * @param database - IDatabase implementation (FakeDatabase for backtest)
 * @param indicatorFeed - IIndicatorFeed implementation (PreCalculatedFeed for backtest)
 * @param candles - Historical candle data
 * @param config - AlgoRunner configuration
 * @param closePositionOnExit - Whether to close position at end of backtest
 */
export async function runBacktestWithAlgoRunner(
  executor: IExecutor,
  database: IDatabase,
  indicatorFeed: IIndicatorFeed,
  candles: Candle[],
  config: AlgoRunnerConfig,
  closePositionOnExit: boolean = true
): Promise<AlgoRunnerBacktestResult> {
  const algo = new AlgoRunner(executor, database, indicatorFeed, config);
  const barResults: BarResult[] = [];

  // Process each candle
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const isLastCandle = i === candles.length - 1;

    // Update executor context (for FakeExecutor)
    if ("setCurrentBar" in executor) {
      (executor as { setCurrentBar: (b: number, t: number) => void }).setCurrentBar(i, candle.bucket);
    }
    if ("setCurrentPrice" in executor) {
      (executor as { setCurrentPrice: (p: number) => void }).setCurrentPrice(candle.close);
    }

    // Process bar
    const result = await algo.onBar(candle, i);
    barResults.push(result);

    // Handle end of backtest
    if (isLastCandle && closePositionOnExit && algo.getPositionState() !== "FLAT") {
      await algo.closePosition(candle, i, "END_OF_BACKTEST");
    }
  }

  const finalEquity = await executor.getBalance();

  return {
    barResults,
    totalTrades: algo.getTradeCount(),
    finalEquity,
    finalPositionState: algo.getPositionState(),
  };
}
