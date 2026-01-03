/**
 * Trading State Machine
 *
 * Simple plug-and-play state machine for position lifecycle management.
 * Handles transitions between FLAT, LONG, and SHORT states.
 *
 * Design: Kept intentionally simple for v1. May be extended with more
 * complex state logic later.
 */

import type { PositionState, Direction, AlgoType } from "../core/types.ts";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for the state machine.
 */
export interface StateMachineConfig {
  /** What directions can the algo trade? */
  algoType: AlgoType;
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
}

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Trading state machine for position lifecycle management.
 *
 * States:
 * - FLAT: No open position (waiting for entry signal)
 * - LONG: Long position open (profit when price goes UP)
 * - SHORT: Short position open (profit when price goes DOWN)
 *
 * Transitions:
 * - FLAT → LONG: Long entry condition met
 * - FLAT → SHORT: Short entry condition met
 * - LONG → FLAT: Long exit (signal, SL, TP, trailing)
 * - SHORT → FLAT: Short exit (signal, SL, TP, trailing)
 *
 * Note: Direct LONG ↔ SHORT transitions are not allowed.
 * Must exit to FLAT first.
 *
 * @example
 * const sm = new TradingStateMachine({ algoType: "BOTH" });
 * sm.getState(); // "FLAT"
 *
 * if (sm.canEnterLong()) {
 *   sm.enterLong(timestamp);
 * }
 * sm.getState(); // "LONG"
 *
 * sm.exit(timestamp);
 * sm.getState(); // "FLAT"
 */
export class TradingStateMachine {
  private state: PositionState = "FLAT";
  private readonly config: StateMachineConfig;
  private transitions: StateTransition[] = [];

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
   * Check if currently in FLAT state (no position).
   */
  isFlat(): boolean {
    return this.state === "FLAT";
  }

  /**
   * Check if currently in a position (LONG or SHORT).
   */
  isInPosition(): boolean {
    return this.state !== "FLAT";
  }

  /**
   * Get the current direction if in position.
   * Returns undefined if FLAT.
   */
  getCurrentDirection(): Direction | undefined {
    if (this.state === "FLAT") return undefined;
    return this.state as Direction;
  }

  // ---------------------------------------------------------------------------
  // Transition Queries
  // ---------------------------------------------------------------------------

  /**
   * Check if we can enter a LONG position.
   * Must be FLAT and algo must support LONG trades.
   */
  canEnterLong(): boolean {
    return this.state === "FLAT" && this.config.algoType !== "SHORT";
  }

  /**
   * Check if we can enter a SHORT position.
   * Must be FLAT and algo must support SHORT trades.
   */
  canEnterShort(): boolean {
    return this.state === "FLAT" && this.config.algoType !== "LONG";
  }

  /**
   * Check if we can exit the current position.
   * Must be in a position (not FLAT).
   */
  canExit(): boolean {
    return this.state !== "FLAT";
  }

  // ---------------------------------------------------------------------------
  // State Transitions
  // ---------------------------------------------------------------------------

  /**
   * Enter a LONG position.
   *
   * @param timestamp - When the entry occurred
   * @throws Error if cannot enter LONG from current state
   */
  enterLong(timestamp: number): void {
    if (!this.canEnterLong()) {
      throw new Error(
        `Cannot enter LONG from state ${this.state} ` +
        `(algoType: ${this.config.algoType})`
      );
    }

    this.recordTransition("FLAT", "LONG", timestamp, "LONG");
    this.state = "LONG";
  }

  /**
   * Enter a SHORT position.
   *
   * @param timestamp - When the entry occurred
   * @throws Error if cannot enter SHORT from current state
   */
  enterShort(timestamp: number): void {
    if (!this.canEnterShort()) {
      throw new Error(
        `Cannot enter SHORT from state ${this.state} ` +
        `(algoType: ${this.config.algoType})`
      );
    }

    this.recordTransition("FLAT", "SHORT", timestamp, "SHORT");
    this.state = "SHORT";
  }

  /**
   * Exit the current position.
   *
   * @param timestamp - When the exit occurred
   * @throws Error if not in a position
   */
  exit(timestamp: number): void {
    if (!this.canExit()) {
      throw new Error(`Cannot exit from state ${this.state}`);
    }

    this.recordTransition(this.state, "FLAT", timestamp);
    this.state = "FLAT";
  }

  /**
   * Reset the state machine to initial state.
   * Clears transition history.
   */
  reset(): void {
    this.state = "FLAT";
    this.transitions = [];
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
    direction?: Direction
  ): void {
    this.transitions.push({ from, to, timestamp, direction });
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new trading state machine.
 *
 * @param algoType - What directions the algo can trade
 * @returns Configured state machine
 */
export function createStateMachine(algoType: AlgoType): TradingStateMachine {
  return new TradingStateMachine({ algoType });
}
