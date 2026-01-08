/**
 * Trading State Machine (4-State Model)
 *
 * Manages position lifecycle with 4 states:
 * - CASH: No position, ready for entries
 * - LONG: Long position open
 * - SHORT: Short position open
 * - TIMEOUT: Cooldown after trade or ambiguity resolution
 *
 * The TIMEOUT state handles:
 * 1. Post-trade cooldown (prevents immediate re-entry)
 * 2. Ambiguity resolution (when both LONG and SHORT signals are true)
 */

import type { PositionState, Direction, AlgoType, TimeoutConfig, TimeoutReason } from "../core/types.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for the state machine.
 */
export interface StateMachineConfig {
    /** What directions can the algo trade? */
    algoType: AlgoType;
    /** Timeout configuration */
    timeout: TimeoutConfig;
}

/**
 * Context tracked while in TIMEOUT state.
 */
export interface TimeoutContext {
    /** Why we entered TIMEOUT */
    reason: TimeoutReason;
    /** Previous direction (only for POST_TRADE) */
    previousDirection?: Direction;
    /** Number of bars spent in TIMEOUT */
    barsInTimeout: number;
}

/**
 * Event that caused a state transition.
 */
export interface StateTransition {
    /** Previous state */
    from: PositionState;
    /** New state */
    to: PositionState;
    /** Timestamp of transition */
    timestamp: number;
    /** Direction of trade (if entering position) */
    direction?: Direction;
    /** Timeout context (if entering TIMEOUT) */
    timeoutContext?: TimeoutContext;
}

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Trading state machine for position lifecycle management.
 *
 * States:
 * - CASH: No open position, ready for new entries
 * - LONG: Long position open (profit when price goes UP)
 * - SHORT: Short position open (profit when price goes DOWN)
 * - TIMEOUT: Cooldown period or ambiguity resolution
 *
 * State Diagram:
 * ```
 *              long only
 *     ┌──────────────────────┐
 *     │                      ▼
 *   CASH ────────────────► LONG
 *     │ ▲    short only       │
 *     │ │  ┌──────────────────┤ exit
 *     │ │  │                  ▼
 *     │ │  │              TIMEOUT ───┐
 *     │ │  │                  ▲      │ conditions met
 *     ▼ │  │  exit            │      ▼
 *  TIMEOUT │                  │   SHORT
 *     │    │                  │      │
 *     │    ▼                  │      │
 *     │ SHORT ────────────────┘      │
 *     │                              │
 *     └──────────────────────────────┘
 * ```
 *
 * TIMEOUT Modes:
 * - COOLDOWN_ONLY: Exit after cooldownBars, ignore signal states
 * - REGULAR: Exit when cooldown met AND same-direction signal is false
 * - STRICT: Exit when cooldown met AND both signals are false
 */
export class TradingStateMachine {
    private state: PositionState = "CASH";
    private readonly config: StateMachineConfig;
    private transitions: StateTransition[] = [];
    private timeoutContext: TimeoutContext | null = null;

    constructor(config: StateMachineConfig) {
        this.config = config;
    }

    // ---------------------------------------------------------------------------
    // State Queries
    // ---------------------------------------------------------------------------

    /**
     * Get the current position state.
     */
    getState(): PositionState {
        return this.state;
    }

    /**
     * Check if currently in CASH state (no position, ready for entries).
     */
    isCash(): boolean {
        return this.state === "CASH";
    }

    /**
     * Check if currently in TIMEOUT state.
     */
    isTimeout(): boolean {
        return this.state === "TIMEOUT";
    }

    /**
     * Check if currently in a position (LONG or SHORT).
     */
    isInPosition(): boolean {
        return this.state === "LONG" || this.state === "SHORT";
    }

    /**
     * Get the current direction if in position.
     * Returns undefined if CASH or TIMEOUT.
     */
    getCurrentDirection(): Direction | undefined {
        if (this.state === "LONG" || this.state === "SHORT") {
            return this.state as Direction;
        }
        return undefined;
    }

    /**
     * Get the current timeout context (if in TIMEOUT state).
     */
    getTimeoutContext(): TimeoutContext | null {
        return this.timeoutContext;
    }

    // ---------------------------------------------------------------------------
    // Transition Queries
    // ---------------------------------------------------------------------------

    /**
     * Check if we can enter a LONG position.
     * Must be in CASH and algo must support LONG trades.
     */
    canEnterLong(): boolean {
        return this.state === "CASH" && this.config.algoType !== "SHORT";
    }

    /**
     * Check if we can enter a SHORT position.
     * Must be in CASH and algo must support SHORT trades.
     */
    canEnterShort(): boolean {
        return this.state === "CASH" && this.config.algoType !== "LONG";
    }

    /**
     * Check if we can exit the current position.
     * Must be in a position (LONG or SHORT).
     */
    canExit(): boolean {
        return this.state === "LONG" || this.state === "SHORT";
    }

    // ---------------------------------------------------------------------------
    // State Transitions
    // ---------------------------------------------------------------------------

    /**
     * Enter a LONG position from CASH.
     *
     * @param timestamp - When the entry occurred
     * @throws Error if cannot enter LONG from current state
     */
    enterLong(timestamp: number): void {
        if (!this.canEnterLong()) {
            throw new Error(`Cannot enter LONG from state ${this.state} (algoType: ${this.config.algoType})`);
        }

        this.recordTransition("CASH", "LONG", timestamp, "LONG");
        this.state = "LONG";
        this.timeoutContext = null;
    }

    /**
     * Enter a SHORT position from CASH.
     *
     * @param timestamp - When the entry occurred
     * @throws Error if cannot enter SHORT from current state
     */
    enterShort(timestamp: number): void {
        if (!this.canEnterShort()) {
            throw new Error(`Cannot enter SHORT from state ${this.state} (algoType: ${this.config.algoType})`);
        }

        this.recordTransition("CASH", "SHORT", timestamp, "SHORT");
        this.state = "SHORT";
        this.timeoutContext = null;
    }

    /**
     * Exit the current position and enter TIMEOUT state.
     *
     * @param timestamp - When the exit occurred
     * @throws Error if not in a position
     */
    exitToTimeout(timestamp: number): void {
        if (!this.canExit()) {
            throw new Error(`Cannot exit from state ${this.state}`);
        }

        const previousDirection = this.state as Direction;
        const context: TimeoutContext = {
            reason: "POST_TRADE",
            previousDirection,
            barsInTimeout: 0,
        };

        this.recordTransition(this.state, "TIMEOUT", timestamp, undefined, context);
        this.state = "TIMEOUT";
        this.timeoutContext = context;
    }

    /**
     * Enter TIMEOUT state due to ambiguity (both signals true in CASH).
     *
     * @param timestamp - When the ambiguity occurred
     * @throws Error if not in CASH state
     */
    enterAmbiguityTimeout(timestamp: number): void {
        if (this.state !== "CASH") {
            throw new Error(`Cannot enter ambiguity TIMEOUT from state ${this.state}`);
        }

        const context: TimeoutContext = {
            reason: "AMBIGUITY",
            barsInTimeout: 0,
        };

        this.recordTransition("CASH", "TIMEOUT", timestamp, undefined, context);
        this.state = "TIMEOUT";
        this.timeoutContext = context;
    }

    /**
     * Increment the bars counter while in TIMEOUT.
     * Should be called once per bar while in TIMEOUT state.
     */
    tickTimeout(): void {
        if (this.timeoutContext) {
            this.timeoutContext.barsInTimeout++;
        }
    }

    /**
     * Evaluate if we should exit TIMEOUT state.
     *
     * @param longSignal - Current LONG_ENTRY condition state
     * @param shortSignal - Current SHORT_ENTRY condition state
     * @returns The state to transition to, or "TIMEOUT" to stay
     */
    evaluateTimeoutExit(longSignal: boolean, shortSignal: boolean): PositionState {
        if (this.state !== "TIMEOUT" || !this.timeoutContext) {
            return this.state;
        }

        const { mode, cooldownBars } = this.config.timeout;
        const { reason, previousDirection, barsInTimeout } = this.timeoutContext;

        // Handle AMBIGUITY timeout
        if (reason === "AMBIGUITY") {
            // Both still true → stay in TIMEOUT
            if (longSignal && shortSignal) {
                return "TIMEOUT";
            }
            // One resolved → can enter that direction
            if (longSignal && !shortSignal && this.config.algoType !== "SHORT") {
                return "LONG";
            }
            if (shortSignal && !longSignal && this.config.algoType !== "LONG") {
                return "SHORT";
            }
            // Both false → go to CASH
            return "CASH";
        }

        // Handle POST_TRADE timeout
        const cooldownMet = barsInTimeout >= cooldownBars;

        if (!cooldownMet) {
            return "TIMEOUT";
        }

        switch (mode) {
            case "COOLDOWN_ONLY":
                // Just need cooldown to be met
                return "CASH";

            case "REGULAR":
                // Cooldown met, opposite can fire immediately
                if (previousDirection === "LONG" && shortSignal && this.config.algoType !== "LONG") {
                    return "SHORT";
                }
                if (previousDirection === "SHORT" && longSignal && this.config.algoType !== "SHORT") {
                    return "LONG";
                }
                // Same direction must be false to go to CASH
                if (previousDirection === "LONG" && !longSignal) {
                    return "CASH";
                }
                if (previousDirection === "SHORT" && !shortSignal) {
                    return "CASH";
                }
                // Same direction still true → stay in TIMEOUT
                return "TIMEOUT";

            case "STRICT":
                // Both signals must be false
                if (!longSignal && !shortSignal) {
                    return "CASH";
                }
                return "TIMEOUT";

            default:
                return "CASH";
        }
    }

    /**
     * Exit TIMEOUT state to a new state.
     *
     * @param newState - The state to transition to (CASH, LONG, or SHORT)
     * @param timestamp - When the transition occurred
     * @throws Error if not in TIMEOUT or invalid target state
     */
    exitTimeout(newState: "CASH" | "LONG" | "SHORT", timestamp: number): void {
        if (this.state !== "TIMEOUT") {
            throw new Error(`Cannot exit TIMEOUT from state ${this.state}`);
        }

        if (newState === "LONG" && this.config.algoType === "SHORT") {
            throw new Error(`Cannot enter LONG with algoType SHORT`);
        }
        if (newState === "SHORT" && this.config.algoType === "LONG") {
            throw new Error(`Cannot enter SHORT with algoType LONG`);
        }

        const direction = newState === "LONG" ? "LONG" : newState === "SHORT" ? "SHORT" : undefined;
        this.recordTransition("TIMEOUT", newState, timestamp, direction);
        this.state = newState;
        this.timeoutContext = null;
    }

    /**
     * Reset the state machine to initial state.
     * Clears transition history.
     */
    reset(): void {
        this.state = "CASH";
        this.transitions = [];
        this.timeoutContext = null;
    }

    // ---------------------------------------------------------------------------
    // History
    // ---------------------------------------------------------------------------

    /**
     * Get all state transitions that have occurred.
     */
    getTransitions(): readonly StateTransition[] {
        return this.transitions;
    }

    /**
     * Get the last transition that occurred.
     */
    getLastTransition(): StateTransition | undefined {
        return this.transitions[this.transitions.length - 1];
    }

    // ---------------------------------------------------------------------------
    // Private Helpers
    // ---------------------------------------------------------------------------

    private recordTransition(
        from: PositionState,
        to: PositionState,
        timestamp: number,
        direction?: Direction,
        timeoutContext?: TimeoutContext
    ): void {
        this.transitions.push({ from, to, timestamp, direction, timeoutContext });
    }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new trading state machine.
 *
 * @param algoType - What directions the algo can trade
 * @param timeout - Timeout configuration
 * @returns Configured state machine
 */
export function createStateMachine(algoType: AlgoType, timeout: TimeoutConfig): TradingStateMachine {
    return new TradingStateMachine({ algoType, timeout });
}
