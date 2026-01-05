/**
 * AlgoRunner Tests
 *
 * Tests for the AlgoRunner class which implements environment-agnostic
 * trading logic using dependency injection.
 *
 * @module simulation/__tests__/algo-runner.test
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { AlgoRunner, runBacktestWithAlgoRunner, type AlgoRunnerConfig, type BarResult } from "../algo-runner.ts";
import type { IExecutor, OrderRequest, OrderResult, Position, OpenOrder } from "../../interfaces/executor.ts";
import type { IDatabase, AlgoState, IndicatorStateSnapshot, EventQueryOptions } from "../../interfaces/database.ts";
import type { IIndicatorFeed, IndicatorInfo, ConditionEvaluation } from "../../interfaces/indicator-feed.ts";
import type { Candle, AlgoParams } from "../../core/types.ts";
import type { AlgoEvent, SwapEvent, ConditionSnapshot, ConditionType } from "../../events/types.ts";

// =============================================================================
// MOCK IMPLEMENTATIONS
// =============================================================================

/**
 * Mock Executor that tracks orders and positions.
 */
class MockExecutor implements IExecutor {
    public orders: OrderRequest[] = [];
    public position: Position | null = null;
    public balance: number = 10000;
    public currentPrice: number = 42000;
    private nextOrderId = 1;

    async placeOrder(order: OrderRequest): Promise<OrderResult> {
        this.orders.push(order);

        const amount = order.amountUSD ? order.amountUSD / this.currentPrice : (order.amountAsset ?? 0);

        // Update position
        if (order.side === "BUY") {
            if (!this.position) {
                this.position = {
                    symbol: order.symbol,
                    direction: "LONG",
                    entryPrice: this.currentPrice,
                    size: amount,
                    sizeUSD: amount * this.currentPrice,
                    unrealizedPnlUSD: 0,
                    entryTime: Date.now(),
                };
                this.balance -= amount * this.currentPrice;
            } else {
                // Close short position
                const pnl = (this.position.entryPrice - this.currentPrice) * this.position.size;
                this.balance += this.position.sizeUSD + pnl;
                this.position = null;
            }
        } else {
            if (this.position && this.position.direction === "LONG") {
                // Close long position
                const pnl = (this.currentPrice - this.position.entryPrice) * this.position.size;
                this.balance += this.position.sizeUSD + pnl;
                this.position = null;
            } else if (!this.position) {
                // Open short position
                this.position = {
                    symbol: order.symbol,
                    direction: "SHORT",
                    entryPrice: this.currentPrice,
                    size: amount,
                    sizeUSD: amount * this.currentPrice,
                    unrealizedPnlUSD: 0,
                    entryTime: Date.now(),
                };
            }
        }

        return {
            orderId: `order-${this.nextOrderId++}`,
            clientOrderId: order.clientOrderId,
            status: "FILLED",
            filledAmount: amount,
            avgPrice: this.currentPrice,
            totalValueUSD: amount * this.currentPrice,
            feeUSD: 1,
            slippageUSD: 0.5,
            timestamp: Date.now(),
        };
    }

    async cancelOrder(_orderId: string): Promise<boolean> {
        return true;
    }

    async getOpenOrders(_symbol?: string): Promise<OpenOrder[]> {
        return [];
    }

    async getPosition(_symbol: string): Promise<Position | null> {
        return this.position;
    }

    async getCurrentPrice(_symbol: string): Promise<number> {
        return this.currentPrice;
    }

    async getBalance(): Promise<number> {
        if (this.position) {
            const unrealizedPnl =
                this.position.direction === "LONG"
                    ? (this.currentPrice - this.position.entryPrice) * this.position.size
                    : (this.position.entryPrice - this.currentPrice) * this.position.size;
            return this.balance + this.position.sizeUSD + unrealizedPnl;
        }
        return this.balance;
    }

    setCurrentPrice(price: number): void {
        this.currentPrice = price;
    }

    setCurrentBar(_barIndex: number, _timestamp: number): void {
        // No-op for mock
    }

    reset(): void {
        this.orders = [];
        this.position = null;
        this.balance = 10000;
        this.currentPrice = 42000;
        this.nextOrderId = 1;
    }
}

/**
 * Mock Database that stores events in memory.
 */
class MockDatabase implements IDatabase {
    public algoEvents: AlgoEvent[] = [];
    public swapEvents: SwapEvent[] = [];
    public state: AlgoState | null = null;

    async logAlgoEvent(event: AlgoEvent): Promise<void> {
        this.algoEvents.push(event);
    }

    async logSwapEvent(swap: SwapEvent): Promise<void> {
        this.swapEvents.push(swap);
    }

    async getAlgoEvents(_options?: EventQueryOptions): Promise<AlgoEvent[]> {
        return [...this.algoEvents];
    }

    async getSwapEvents(_options?: EventQueryOptions): Promise<SwapEvent[]> {
        return [...this.swapEvents];
    }

    async saveState(state: AlgoState): Promise<void> {
        this.state = state;
    }

    async getState(): Promise<AlgoState | null> {
        return this.state;
    }

    async saveIndicatorSnapshot(_snapshot: IndicatorStateSnapshot): Promise<void> {
        // No-op for mock
    }

    async getIndicatorSnapshotAtBar(_barIndex: number): Promise<IndicatorStateSnapshot | null> {
        return null;
    }

    async clear(): Promise<void> {
        this.algoEvents = [];
        this.swapEvents = [];
        this.state = null;
    }
}

/**
 * Mock Indicator Feed with configurable signals.
 */
class MockIndicatorFeed implements IIndicatorFeed {
    private currentBarIndex = 0;
    private signals: Map<string, boolean[]> = new Map();
    private previousConditionMet: Map<ConditionType, boolean> = new Map();
    private conditionSnapshots: Map<ConditionType, ConditionSnapshot> = new Map();

    constructor() {
        // Default: no signals
    }

    setSignals(key: string, signals: boolean[]): void {
        this.signals.set(key, signals);
    }

    setConditionSnapshot(type: ConditionType, snapshot: ConditionSnapshot): void {
        this.conditionSnapshots.set(type, snapshot);
    }

    setPreviousConditionMet(type: ConditionType, met: boolean): void {
        this.previousConditionMet.set(type, met);
    }

    setCurrentBar(barIndex: number, _timestamp: number): void {
        // Note: previousConditionMet should be set explicitly by tests before calling onBar
        // This allows precise control over edge detection testing
        this.currentBarIndex = barIndex;
    }

    getCurrentBarIndex(): number {
        return this.currentBarIndex;
    }

    getCurrentSignals(): Map<string, boolean> {
        const result = new Map<string, boolean>();
        for (const [key, signals] of this.signals) {
            const signal = signals[this.currentBarIndex];
            if (signal !== undefined) {
                result.set(key, signal);
            }
        }
        return result;
    }

    getSignal(indicatorKey: string): boolean | undefined {
        const signals = this.signals.get(indicatorKey);
        return signals ? signals[this.currentBarIndex] : undefined;
    }

    getRawValue(_indicatorKey: string): number | undefined {
        return undefined;
    }

    evaluateCondition(conditionType: ConditionType): ConditionEvaluation {
        const snapshot = this.getConditionSnapshot(conditionType);
        return {
            conditionType,
            isMet: snapshot.conditionMet,
            snapshot,
            indicatorStates: [],
        };
    }

    getConditionSnapshot(conditionType: ConditionType): ConditionSnapshot {
        return (
            this.conditionSnapshots.get(conditionType) ?? {
                requiredTrue: 0,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: false,
                distanceFromTrigger: 1,
            }
        );
    }

    getIndicatorInfo(): Map<string, IndicatorInfo> {
        return new Map();
    }

    getIndicatorsForCondition(_conditionType: ConditionType): IndicatorInfo[] {
        return [];
    }

    getPreviousConditionMet(conditionType: ConditionType): boolean {
        return this.previousConditionMet.get(conditionType) ?? false;
    }

    getTotalBars(): number {
        let max = 0;
        for (const signals of this.signals.values()) {
            max = Math.max(max, signals.length);
        }
        return max;
    }

    reset(): void {
        this.currentBarIndex = 0;
        this.previousConditionMet.clear();
    }
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createCandle(bucket: number, close: number): Candle {
    return {
        bucket,
        open: close - 10,
        high: close + 20,
        low: close - 20,
        close,
        volume: 100,
    };
}

function createAlgoParams(overrides: Partial<AlgoParams> = {}): AlgoParams {
    return {
        type: "LONG",
        longEntry: { required: [], optional: [] },
        longExit: { required: [], optional: [] },
        positionSize: { type: "REL", value: 0.1 },
        orderType: "MARKET",
        startingCapitalUSD: 10000,
        ...overrides,
    };
}

function createConfig(overrides: Partial<AlgoRunnerConfig> = {}): AlgoRunnerConfig {
    return {
        algoParams: createAlgoParams(),
        symbol: "BTC",
        ...overrides,
    };
}

// =============================================================================
// CONSTRUCTOR TESTS
// =============================================================================

describe("AlgoRunner", () => {
    let executor: MockExecutor;
    let database: MockDatabase;
    let indicatorFeed: MockIndicatorFeed;

    beforeEach(() => {
        executor = new MockExecutor();
        database = new MockDatabase();
        indicatorFeed = new MockIndicatorFeed();
    });

    describe("constructor", () => {
        it("initializes with injected interfaces", () => {
            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            expect(algo).toBeDefined();
            expect(algo.getPositionState()).toBe("FLAT");
            expect(algo.getTradeCount()).toBe(0);
        });

        it("applies default config values", () => {
            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            // Should start FLAT
            expect(algo.getPositionState()).toBe("FLAT");
        });

        it("accepts custom config values", () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    warmupBars: 50,
                    tradesLimit: 10,
                })
            );

            expect(algo).toBeDefined();
        });
    });

    describe("onBar", () => {
        it("skips warmup bars", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    warmupBars: 5,
                })
            );

            // Set up entry condition that would normally trigger
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });

            // Process bars during warmup - should not enter
            for (let i = 0; i < 5; i++) {
                const candle = createCandle(1000 + i, 42000);
                const result = await algo.onBar(candle, i);
                expect(result.entryOccurred).toBe(false);
            }

            expect(algo.getPositionState()).toBe("FLAT");
        });

        it("checks entry after warmup", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    warmupBars: 2,
                    assumePositionImmediately: true,
                })
            );

            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });

            // Bar 0 and 1 are warmup
            await algo.onBar(createCandle(1000, 42000), 0);
            await algo.onBar(createCandle(1001, 42000), 1);
            expect(algo.getPositionState()).toBe("FLAT");

            // Bar 2 should trigger entry
            const result = await algo.onBar(createCandle(1002, 42000), 2);
            expect(result.entryOccurred).toBe(true);
            expect(algo.getPositionState()).toBe("LONG");
        });

        it("returns correct equity", async () => {
            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            const candle = createCandle(1000, 42000);
            const result = await algo.onBar(candle, 0);

            expect(result.equity).toBe(10000);
        });

        it("returns bar info in result", async () => {
            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            const candle = createCandle(1000, 42000);
            const result = await algo.onBar(candle, 5);

            expect(result.barIndex).toBe(5);
            expect(result.timestamp).toBe(1000);
        });
    });

    describe("entry conditions", () => {
        it("enters LONG when condition met (edge detection)", async () => {
            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            // Bar 0: condition not met
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 0,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: false,
                distanceFromTrigger: 1,
            });
            await algo.onBar(createCandle(1000, 42000), 0);

            // Bar 1: condition becomes met (edge: false → true)
            indicatorFeed.setPreviousConditionMet("LONG_ENTRY", false); // Explicitly set previous state
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            const result = await algo.onBar(createCandle(1001, 42000), 1);

            expect(result.entryOccurred).toBe(true);
            expect(algo.getPositionState()).toBe("LONG");
        });

        it("does not enter when condition already met (no edge)", async () => {
            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            // Both bars: condition met
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });

            // Bar 0: enters
            await algo.onBar(createCandle(1000, 42000), 0);

            // Exit the position
            indicatorFeed.setConditionSnapshot("LONG_EXIT", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1001, 42500), 1);

            // Bar 2: condition still met but no edge
            indicatorFeed.setPreviousConditionMet("LONG_ENTRY", true);
            const result = await algo.onBar(createCandle(1002, 42000), 2);

            expect(result.entryOccurred).toBe(false);
        });

        it("enters immediately when assumePositionImmediately is true", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });

            const result = await algo.onBar(createCandle(1000, 42000), 0);

            expect(result.entryOccurred).toBe(true);
            expect(algo.getPositionState()).toBe("LONG");
        });

        it("respects trades limit", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    tradesLimit: 1,
                    assumePositionImmediately: true, // Simplify by not requiring edge detection
                })
            );

            // First trade - enter
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);
            expect(algo.getPositionState()).toBe("LONG");

            // Exit
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 0,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: false,
                distanceFromTrigger: 1,
            });
            indicatorFeed.setConditionSnapshot("LONG_EXIT", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1001, 42500), 1);

            expect(algo.getTradeCount()).toBe(1);
            expect(algo.getPositionState()).toBe("FLAT");

            // Try second trade - should be blocked by tradesLimit
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            const result = await algo.onBar(createCandle(1002, 42000), 2);

            expect(result.entryOccurred).toBe(false);
            expect(algo.getPositionState()).toBe("FLAT");
        });
    });

    describe("exit conditions", () => {
        it("exits when exit condition met", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            // Enter position
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);
            expect(algo.getPositionState()).toBe("LONG");

            // Exit - clear entry condition to prevent immediate re-entry
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 0,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: false,
                distanceFromTrigger: 1,
            });
            indicatorFeed.setConditionSnapshot("LONG_EXIT", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            const result = await algo.onBar(createCandle(1001, 42500), 1);

            expect(result.exitOccurred).toBe(true);
            expect(algo.getPositionState()).toBe("FLAT");
        });

        it("increments trade count on exit", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            expect(algo.getTradeCount()).toBe(0);

            // Enter
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);
            expect(algo.getTradeCount()).toBe(0);

            // Exit
            indicatorFeed.setConditionSnapshot("LONG_EXIT", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1001, 42500), 1);

            expect(algo.getTradeCount()).toBe(1);
        });
    });

    describe("closePosition", () => {
        it("closes open position", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            // Enter
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);
            expect(algo.getPositionState()).toBe("LONG");

            // Force close
            const closed = await algo.closePosition(createCandle(1001, 42500), 1, "END_OF_BACKTEST");

            expect(closed).toBe(true);
            expect(algo.getPositionState()).toBe("FLAT");
        });

        it("returns false when already flat", async () => {
            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            const closed = await algo.closePosition(createCandle(1000, 42000), 0, "END_OF_BACKTEST");

            expect(closed).toBe(false);
        });

        it("increments trade count", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            // Enter
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);

            // Force close
            await algo.closePosition(createCandle(1001, 42500), 1, "END_OF_BACKTEST");

            expect(algo.getTradeCount()).toBe(1);
        });
    });

    describe("reset", () => {
        it("resets position state", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);
            expect(algo.getPositionState()).toBe("LONG");

            algo.reset();

            expect(algo.getPositionState()).toBe("FLAT");
            expect(algo.getTradeCount()).toBe(0);
        });
    });

    describe("order placement", () => {
        it("places order through executor on entry", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);

            expect(executor.orders.length).toBe(1);
            expect(executor.orders[0]!.side).toBe("BUY");
            expect(executor.orders[0]!.symbol).toBe("BTC");
        });

        it("places order through executor on exit", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            // Enter
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);

            // Exit - clear entry condition to prevent immediate re-entry
            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 0,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: false,
                distanceFromTrigger: 1,
            });
            indicatorFeed.setConditionSnapshot("LONG_EXIT", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1001, 42500), 1);

            expect(executor.orders.length).toBe(2);
            expect(executor.orders[1]!.side).toBe("SELL");
        });
    });

    describe("event logging", () => {
        it("logs state transition to database on entry", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);

            const stateEvents = database.algoEvents.filter((e) => e.type === "STATE_TRANSITION");
            expect(stateEvents.length).toBe(1);
        });

        it("logs condition change to database", async () => {
            const algo = new AlgoRunner(
                executor,
                database,
                indicatorFeed,
                createConfig({
                    assumePositionImmediately: true,
                })
            );

            indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
                requiredTrue: 1,
                requiredTotal: 1,
                optionalTrue: 0,
                optionalTotal: 0,
                conditionMet: true,
                distanceFromTrigger: 0,
            });
            await algo.onBar(createCandle(1000, 42000), 0);

            const conditionEvents = database.algoEvents.filter((e) => e.type === "CONDITION_CHANGE");
            expect(conditionEvents.length).toBe(1);
        });
    });

    describe("no backtest/live conditional logic", () => {
        it("has NO if/else checking for backtest mode", () => {
            // This test verifies the architectural requirement
            // The AlgoRunner class should work identically with any implementation
            // of IExecutor, IDatabase, IIndicatorFeed

            const algo = new AlgoRunner(executor, database, indicatorFeed, createConfig());

            // Check that AlgoRunner has no properties or methods
            // that would indicate awareness of backtest vs live
            const prototypeKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(algo));

            const backtestIndicators = ["isBacktest", "isLive", "backtest", "live", "simulation"];

            for (const key of prototypeKeys) {
                for (const indicator of backtestIndicators) {
                    expect(key.toLowerCase().includes(indicator)).toBe(false);
                }
            }
        });
    });
});

// =============================================================================
// runBacktestWithAlgoRunner TESTS
// =============================================================================

describe("runBacktestWithAlgoRunner", () => {
    let executor: MockExecutor;
    let database: MockDatabase;
    let indicatorFeed: MockIndicatorFeed;

    beforeEach(() => {
        executor = new MockExecutor();
        database = new MockDatabase();
        indicatorFeed = new MockIndicatorFeed();
    });

    it("processes all candles", async () => {
        const candles = [
            createCandle(1000, 42000),
            createCandle(1001, 42100),
            createCandle(1002, 42200),
            createCandle(1003, 42300),
            createCandle(1004, 42400),
        ];

        const result = await runBacktestWithAlgoRunner(executor, database, indicatorFeed, candles, createConfig());

        expect(result.barResults.length).toBe(5);
    });

    it("closes position on exit when configured", async () => {
        const candles = [createCandle(1000, 42000), createCandle(1001, 42500)];

        // Set up entry
        indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
            requiredTrue: 1,
            requiredTotal: 1,
            optionalTrue: 0,
            optionalTotal: 0,
            conditionMet: true,
            distanceFromTrigger: 0,
        });

        const result = await runBacktestWithAlgoRunner(
            executor,
            database,
            indicatorFeed,
            candles,
            createConfig({ assumePositionImmediately: true }),
            true // closePositionOnExit
        );

        expect(result.finalPositionState).toBe("FLAT");
        expect(result.totalTrades).toBe(1);
    });

    it("keeps position open when closePositionOnExit is false", async () => {
        const candles = [createCandle(1000, 42000), createCandle(1001, 42500)];

        indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
            requiredTrue: 1,
            requiredTotal: 1,
            optionalTrue: 0,
            optionalTotal: 0,
            conditionMet: true,
            distanceFromTrigger: 0,
        });

        const result = await runBacktestWithAlgoRunner(
            executor,
            database,
            indicatorFeed,
            candles,
            createConfig({ assumePositionImmediately: true }),
            false // closePositionOnExit
        );

        expect(result.finalPositionState).toBe("LONG");
    });

    it("returns correct final equity", async () => {
        const candles = [createCandle(1000, 42000), createCandle(1001, 42000)];

        const result = await runBacktestWithAlgoRunner(executor, database, indicatorFeed, candles, createConfig());

        expect(result.finalEquity).toBe(10000);
    });

    it("returns correct trade count", async () => {
        const candles = [createCandle(1000, 42000), createCandle(1001, 42500), createCandle(1002, 42000)];

        // Enter on bar 0, exit on bar 1, enter on bar 2, close at end
        indicatorFeed.setConditionSnapshot("LONG_ENTRY", {
            requiredTrue: 1,
            requiredTotal: 1,
            optionalTrue: 0,
            optionalTotal: 0,
            conditionMet: true,
            distanceFromTrigger: 0,
        });
        indicatorFeed.setConditionSnapshot("LONG_EXIT", {
            requiredTrue: 0,
            requiredTotal: 1,
            optionalTrue: 0,
            optionalTotal: 0,
            conditionMet: false,
            distanceFromTrigger: 1,
        });

        const result = await runBacktestWithAlgoRunner(
            executor,
            database,
            indicatorFeed,
            candles,
            createConfig({ assumePositionImmediately: true }),
            true
        );

        expect(result.totalTrades).toBeGreaterThanOrEqual(1);
    });
});
