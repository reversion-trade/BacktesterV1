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

import type { Candle, AlgoParams, Direction, PositionState } from "../core/types.ts";
import type { IExecutor, Position } from "../interfaces/executor.ts";
import type { IDatabase } from "../interfaces/database.ts";
import type { IIndicatorFeed } from "../interfaces/indicator-feed.ts";
import type { ConditionType, StateTransitionEvent, ConditionChangeEvent, IndicatorFlipEvent } from "../events/types.ts";
import { StopLossIndicator, TakeProfitIndicator, TrailingStopIndicator } from "./special-indicators/index.ts";
import type { IndicatorFlip } from "./fakes/pre-calculated-feed.ts";

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
    /** Active stop loss indicator (created on entry) */
    stopLoss: StopLossIndicator | null;
    /** Active take profit indicator (created on entry) */
    takeProfit: TakeProfitIndicator | null;
    /** Active trailing stop indicator (created on entry) */
    trailingStop: TrailingStopIndicator | null;
    /** Entry price of current position */
    entryPrice: number;
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

    constructor(executor: IExecutor, database: IDatabase, indicatorFeed: IIndicatorFeed, config: AlgoRunnerConfig) {
        this.executor = executor;
        this.database = database;
        this.indicatorFeed = indicatorFeed;
        this.config = {
            warmupBars: 0,
            ...config,
        };
        this.state = {
            positionState: "CASH",
            tradeCount: 0,
            currentBarIndex: 0,
            stopLoss: null,
            takeProfit: null,
            trailingStop: null,
            entryPrice: 0,
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

        this.indicatorFeed.setCurrentBar(barIndex, candle.bucket);
        await this.logIndicatorFlips(barIndex, candle.bucket);

        let entryOccurred = false;
        let exitOccurred = false;

        const isWarmupPeriod = barIndex < (this.config.warmupBars ?? 0);

        if (this.state.positionState !== "CASH") {
            const exitResult = await this.checkExit(candle, barIndex);
            if (exitResult) {
                exitOccurred = true;
                if ("setCurrentPrice" in this.executor) {
                    (this.executor as { setCurrentPrice: (p: number) => void }).setCurrentPrice(candle.close);
                }
            }
        }

        if (this.state.positionState === "CASH" && !isWarmupPeriod) {
            const entryResult = await this.checkEntry(candle, barIndex);
            if (entryResult) {
                entryOccurred = true;
            }
        }

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
        if (this.state.positionState === "CASH") {
            return false;
        }

        const position = await this.executor.getPosition(this.config.symbol);
        if (!position) {
            return false;
        }

        const positionDirection = this.state.positionState as Direction;
        const side = this.state.positionState === "LONG" ? "SELL" : "BUY";
        await this.executor.placeOrder({
            clientOrderId: `close-${barIndex}`,
            symbol: this.config.symbol,
            side,
            type: "MARKET",
            amountAsset: position.size,
            isEntry: false,
            tradeDirection: positionDirection,
        });

        await this.logStateTransition(
            barIndex,
            candle.bucket,
            this.state.positionState,
            "CASH",
            reason as "END_OF_BACKTEST" | "EXIT_SIGNAL"
        );

        this.state.positionState = "CASH";
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
            positionState: "CASH",
            tradeCount: 0,
            currentBarIndex: 0,
            stopLoss: null,
            takeProfit: null,
            trailingStop: null,
            entryPrice: 0,
        };
    }

    // ===========================================================================
    // PRIVATE METHODS
    // ===========================================================================

    private async checkEntry(candle: Candle, barIndex: number): Promise<boolean> {
        if (this.config.tradesLimit !== undefined && this.state.tradeCount >= this.config.tradesLimit) {
            return false;
        }

        const algoType = this.config.algoParams.type;

        if (algoType !== "SHORT") {
            const shouldEnterLong = this.checkConditionTrigger("LONG_ENTRY");
            if (shouldEnterLong) {
                await this.enterPosition("LONG", candle, barIndex);
                return true;
            }
        }

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
        const prices = [candle.open, candle.high, candle.low, candle.close];
        const times = [candle.bucket, candle.bucket, candle.bucket, candle.bucket];

        let slTriggered = false;
        let tpTriggered = false;
        let trailingTriggered = false;

        if (this.state.trailingStop) {
            this.state.trailingStop.calculate(prices, times);
            trailingTriggered = this.state.trailingStop.isTriggered();
        }

        if (this.state.stopLoss && !trailingTriggered) {
            this.state.stopLoss.calculate(prices, times);
            slTriggered = this.state.stopLoss.isTriggered();
        }

        if (this.state.takeProfit && !trailingTriggered && !slTriggered) {
            this.state.takeProfit.calculate(prices, times);
            tpTriggered = this.state.takeProfit.isTriggered();
        }

        if (trailingTriggered) {
            const exitPrice = this.state.trailingStop?.getCurrentLevel();
            await this.exitPosition(candle, barIndex, "TRAILING_STOP", exitPrice);
            return true;
        }
        if (slTriggered) {
            const exitPrice = this.state.stopLoss?.getStopLossPrice();
            await this.exitPosition(candle, barIndex, "STOP_LOSS", exitPrice);
            return true;
        }
        if (tpTriggered) {
            const exitPrice = this.state.takeProfit?.getTakeProfitPrice();
            await this.exitPosition(candle, barIndex, "TAKE_PROFIT", exitPrice);
            return true;
        }

        const exitConditionType: ConditionType = this.state.positionState === "LONG" ? "LONG_EXIT" : "SHORT_EXIT";

        const shouldExit = this.checkConditionTrigger(exitConditionType);

        if (shouldExit) {
            await this.exitPosition(candle, barIndex, "EXIT_SIGNAL");
            return true;
        }

        return false;
    }

    private checkConditionTrigger(conditionType: ConditionType): boolean {
        // Edge detection is removed - TIMEOUT state handles re-entry control
        // For now, just return the current condition state
        // Phase 2-4 will implement proper TIMEOUT state handling
        const snapshot = this.indicatorFeed.getConditionSnapshot(conditionType);
        return snapshot.conditionMet;
    }

    private async enterPosition(direction: Direction, candle: Candle, barIndex: number): Promise<void> {
        const positionSizeUSD = this.calculatePositionSize();

        const side = direction === "LONG" ? "BUY" : "SELL";
        await this.executor.placeOrder({
            clientOrderId: `entry-${barIndex}`,
            symbol: this.config.symbol,
            side,
            type: "MARKET",
            amountUSD: positionSizeUSD,
            isEntry: true,
            tradeDirection: direction,
        });

        const newState: PositionState = direction === "LONG" ? "LONG" : "SHORT";
        await this.logStateTransition(barIndex, candle.bucket, "CASH", newState, "ENTRY_SIGNAL");
        this.state.positionState = newState;
        this.state.entryPrice = candle.close;

        const exitConfig = direction === "LONG" ? this.config.algoParams.longExit : this.config.algoParams.shortExit;

        if (exitConfig?.stopLoss) {
            this.state.stopLoss = new StopLossIndicator({
                direction,
                stopLoss: exitConfig.stopLoss,
            });
            this.state.stopLoss.reset(candle.close, candle.bucket);
        }

        if (exitConfig?.takeProfit) {
            this.state.takeProfit = new TakeProfitIndicator({
                direction,
                takeProfit: exitConfig.takeProfit,
            });
            this.state.takeProfit.reset(candle.close, candle.bucket);
        }

        if (exitConfig?.trailingSL && exitConfig?.stopLoss) {
            this.state.trailingStop = new TrailingStopIndicator({
                direction,
                trailingOffset: exitConfig.stopLoss,
            });
            this.state.trailingStop.reset(candle.close, candle.bucket);
        }

        const conditionType: ConditionType = direction === "LONG" ? "LONG_ENTRY" : "SHORT_ENTRY";
        await this.logConditionChange(barIndex, candle.bucket, conditionType, true);
    }

    private async exitPosition(
        candle: Candle,
        barIndex: number,
        reason: "EXIT_SIGNAL" | "STOP_LOSS" | "TAKE_PROFIT" | "TRAILING_STOP",
        triggerPrice?: number
    ): Promise<void> {
        const position = await this.executor.getPosition(this.config.symbol);
        if (!position) {
            return;
        }

        if (triggerPrice && "setCurrentPrice" in this.executor) {
            (this.executor as { setCurrentPrice: (p: number) => void }).setCurrentPrice(triggerPrice);
        }

        const positionDirection = this.state.positionState as Direction;
        const side = this.state.positionState === "LONG" ? "SELL" : "BUY";
        await this.executor.placeOrder({
            clientOrderId: `exit-${barIndex}`,
            symbol: this.config.symbol,
            side,
            type: "MARKET",
            amountAsset: position.size,
            isEntry: false,
            tradeDirection: positionDirection,
        });

        await this.logStateTransition(barIndex, candle.bucket, this.state.positionState, "CASH", reason);

        const conditionType: ConditionType = this.state.positionState === "LONG" ? "LONG_EXIT" : "SHORT_EXIT";
        await this.logConditionChange(barIndex, candle.bucket, conditionType, true);

        this.state.positionState = "CASH";
        this.state.tradeCount++;

        this.state.stopLoss = null;
        this.state.takeProfit = null;
        this.state.trailingStop = null;
        this.state.entryPrice = 0;
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

    private async logIndicatorFlips(barIndex: number, timestamp: number): Promise<void> {
        const feedWithFlips = this.indicatorFeed as unknown as { getLastFlips?: () => IndicatorFlip[] };
        const hasGetLastFlips = typeof feedWithFlips.getLastFlips === "function";
        if (hasGetLastFlips && feedWithFlips.getLastFlips) {
            const flips = feedWithFlips.getLastFlips();
            for (const flip of flips) {
                const info = this.indicatorFeed.getIndicatorInfo().get(flip.indicatorKey);
                if (info) {
                    const snapshot = this.indicatorFeed.getConditionSnapshot(info.conditionType);
                    const event: IndicatorFlipEvent = {
                        type: "INDICATOR_FLIP",
                        timestamp,
                        barIndex,
                        indicatorKey: flip.indicatorKey,
                        indicatorType: info.type,
                        conditionType: info.conditionType,
                        isRequired: info.isRequired,
                        previousValue: flip.previousValue,
                        newValue: flip.newValue,
                        conditionSnapshot: snapshot,
                    };
                    await this.database.logAlgoEvent(event);
                }
            }
        }
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

    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i]!;
        const isLastCandle = i === candles.length - 1;

        if ("setCurrentBar" in executor) {
            (executor as { setCurrentBar: (b: number, t: number) => void }).setCurrentBar(i, candle.bucket);
        }
        if ("setCurrentPrice" in executor) {
            (executor as { setCurrentPrice: (p: number) => void }).setCurrentPrice(candle.close);
        }

        const result = await algo.onBar(candle, i);
        barResults.push(result);

        if (isLastCandle && closePositionOnExit && algo.getPositionState() !== "CASH") {
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
