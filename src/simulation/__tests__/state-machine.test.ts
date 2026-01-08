/**
 * State Machine Tests (4-State Model)
 *
 * Tests for TradingStateMachine covering:
 * - State transitions (CASH ↔ LONG ↔ TIMEOUT ↔ CASH)
 * - TIMEOUT state with different modes
 * - AlgoType restrictions
 * - Error cases for invalid transitions
 * - Transition history tracking
 */

import { describe, test, expect } from "bun:test";
import { TradingStateMachine, createStateMachine, type TimeoutContext } from "../state-machine.ts";
import type { TimeoutConfig } from "../../core/types.ts";

// Helper to create default timeout config
const defaultTimeout: TimeoutConfig = { mode: "COOLDOWN_ONLY", cooldownBars: 0 };

describe("TradingStateMachine", () => {
    describe("Initial State", () => {
        test("starts in CASH state", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            expect(sm.getState()).toBe("CASH");
            expect(sm.isCash()).toBe(true);
            expect(sm.isInPosition()).toBe(false);
            expect(sm.isTimeout()).toBe(false);
        });

        test("starts with empty transition history", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            expect(sm.getTransitions()).toHaveLength(0);
            expect(sm.getLastTransition()).toBeUndefined();
        });

        test("starts with no timeout context", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            expect(sm.getTimeoutContext()).toBeNull();
        });
    });

    describe("LONG Transitions", () => {
        test("can enter LONG from CASH when algoType is BOTH", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            expect(sm.canEnterLong()).toBe(true);

            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");
            expect(sm.isCash()).toBe(false);
            expect(sm.isInPosition()).toBe(true);
            expect(sm.getCurrentDirection()).toBe("LONG");
        });

        test("can enter LONG from CASH when algoType is LONG", () => {
            const sm = createStateMachine("LONG", defaultTimeout);
            expect(sm.canEnterLong()).toBe(true);

            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");
        });

        test("cannot enter LONG when algoType is SHORT", () => {
            const sm = createStateMachine("SHORT", defaultTimeout);
            expect(sm.canEnterLong()).toBe(false);

            expect(() => sm.enterLong(1000)).toThrow();
        });

        test("exits from LONG to TIMEOUT", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);

            expect(sm.canExit()).toBe(true);
            sm.exitToTimeout(2000);

            expect(sm.getState()).toBe("TIMEOUT");
            expect(sm.isTimeout()).toBe(true);
            expect(sm.getTimeoutContext()?.reason).toBe("POST_TRADE");
            expect(sm.getTimeoutContext()?.previousDirection).toBe("LONG");
        });

        test("cannot enter LONG when already in LONG", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);

            expect(sm.canEnterLong()).toBe(false);
            expect(() => sm.enterLong(2000)).toThrow();
        });
    });

    describe("SHORT Transitions", () => {
        test("can enter SHORT from CASH when algoType is BOTH", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            expect(sm.canEnterShort()).toBe(true);

            sm.enterShort(1000);
            expect(sm.getState()).toBe("SHORT");
            expect(sm.isInPosition()).toBe(true);
            expect(sm.getCurrentDirection()).toBe("SHORT");
        });

        test("can enter SHORT from CASH when algoType is SHORT", () => {
            const sm = createStateMachine("SHORT", defaultTimeout);
            expect(sm.canEnterShort()).toBe(true);

            sm.enterShort(1000);
            expect(sm.getState()).toBe("SHORT");
        });

        test("cannot enter SHORT when algoType is LONG", () => {
            const sm = createStateMachine("LONG", defaultTimeout);
            expect(sm.canEnterShort()).toBe(false);

            expect(() => sm.enterShort(1000)).toThrow();
        });

        test("exits from SHORT to TIMEOUT", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterShort(1000);

            sm.exitToTimeout(2000);
            expect(sm.getState()).toBe("TIMEOUT");
            expect(sm.getTimeoutContext()?.previousDirection).toBe("SHORT");
        });

        test("cannot enter SHORT when already in SHORT", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterShort(1000);

            expect(sm.canEnterShort()).toBe(false);
            expect(() => sm.enterShort(2000)).toThrow();
        });
    });

    describe("Cross-Direction Restrictions", () => {
        test("cannot enter SHORT when in LONG position", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);

            expect(sm.canEnterShort()).toBe(false);
            expect(() => sm.enterShort(2000)).toThrow();
        });

        test("cannot enter LONG when in SHORT position", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterShort(1000);

            expect(sm.canEnterLong()).toBe(false);
            expect(() => sm.enterLong(2000)).toThrow();
        });

        test("must go through TIMEOUT before reversing direction", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);

            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");

            sm.exitToTimeout(2000);
            expect(sm.getState()).toBe("TIMEOUT");

            // With COOLDOWN_ONLY mode and cooldownBars=0, immediately goes to CASH
            const nextState = sm.evaluateTimeoutExit(false, false);
            expect(nextState).toBe("CASH");

            sm.exitTimeout("CASH", 2500);
            expect(sm.getState()).toBe("CASH");

            sm.enterShort(3000);
            expect(sm.getState()).toBe("SHORT");
        });
    });

    describe("TIMEOUT State - COOLDOWN_ONLY Mode", () => {
        test("exits TIMEOUT immediately when cooldownBars is 0", () => {
            const sm = createStateMachine("BOTH", { mode: "COOLDOWN_ONLY", cooldownBars: 0 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            const nextState = sm.evaluateTimeoutExit(false, false);
            expect(nextState).toBe("CASH");
        });

        test("respects cooldownBars count", () => {
            const sm = createStateMachine("BOTH", { mode: "COOLDOWN_ONLY", cooldownBars: 3 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            // Bars 0, 1, 2 - still in timeout
            expect(sm.evaluateTimeoutExit(false, false)).toBe("TIMEOUT");
            sm.tickTimeout();
            expect(sm.evaluateTimeoutExit(false, false)).toBe("TIMEOUT");
            sm.tickTimeout();
            expect(sm.evaluateTimeoutExit(false, false)).toBe("TIMEOUT");
            sm.tickTimeout();

            // Bar 3 - can exit
            expect(sm.evaluateTimeoutExit(false, false)).toBe("CASH");
        });

        test("ignores signal states in COOLDOWN_ONLY mode", () => {
            const sm = createStateMachine("BOTH", { mode: "COOLDOWN_ONLY", cooldownBars: 0 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            // Even with signals true, still goes to CASH
            expect(sm.evaluateTimeoutExit(true, false)).toBe("CASH");
            expect(sm.evaluateTimeoutExit(false, true)).toBe("CASH");
            expect(sm.evaluateTimeoutExit(true, true)).toBe("CASH");
        });
    });

    describe("TIMEOUT State - REGULAR Mode", () => {
        test("allows opposite direction entry immediately after cooldown", () => {
            const sm = createStateMachine("BOTH", { mode: "REGULAR", cooldownBars: 0 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            // Short signal active, came from LONG - can enter SHORT
            expect(sm.evaluateTimeoutExit(false, true)).toBe("SHORT");
        });

        test("blocks same direction re-entry when signal still true", () => {
            const sm = createStateMachine("BOTH", { mode: "REGULAR", cooldownBars: 0 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            // Long signal still true, came from LONG - stay in TIMEOUT
            expect(sm.evaluateTimeoutExit(true, false)).toBe("TIMEOUT");
        });

        test("goes to CASH when same direction signal becomes false", () => {
            const sm = createStateMachine("BOTH", { mode: "REGULAR", cooldownBars: 0 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            // Long signal false, no short signal - go to CASH
            expect(sm.evaluateTimeoutExit(false, false)).toBe("CASH");
        });

        test("prefers opposite entry over going to CASH", () => {
            const sm = createStateMachine("BOTH", { mode: "REGULAR", cooldownBars: 0 });
            sm.enterShort(1000);
            sm.exitToTimeout(2000);

            // Long signal active after exiting SHORT - enter LONG
            expect(sm.evaluateTimeoutExit(true, false)).toBe("LONG");
        });
    });

    describe("TIMEOUT State - STRICT Mode", () => {
        test("requires both signals false to exit", () => {
            const sm = createStateMachine("BOTH", { mode: "STRICT", cooldownBars: 0 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            // Either signal true - stay in TIMEOUT
            expect(sm.evaluateTimeoutExit(true, false)).toBe("TIMEOUT");
            expect(sm.evaluateTimeoutExit(false, true)).toBe("TIMEOUT");
            expect(sm.evaluateTimeoutExit(true, true)).toBe("TIMEOUT");

            // Both false - go to CASH
            expect(sm.evaluateTimeoutExit(false, false)).toBe("CASH");
        });

        test("respects cooldown before checking signals", () => {
            const sm = createStateMachine("BOTH", { mode: "STRICT", cooldownBars: 2 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            // Cooldown not met - stay in TIMEOUT even with signals false
            expect(sm.evaluateTimeoutExit(false, false)).toBe("TIMEOUT");
            sm.tickTimeout();
            expect(sm.evaluateTimeoutExit(false, false)).toBe("TIMEOUT");
            sm.tickTimeout();

            // Cooldown met and signals false - go to CASH
            expect(sm.evaluateTimeoutExit(false, false)).toBe("CASH");
        });
    });

    describe("TIMEOUT State - Ambiguity Resolution", () => {
        test("enters ambiguity TIMEOUT from CASH", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);

            sm.enterAmbiguityTimeout(1000);
            expect(sm.getState()).toBe("TIMEOUT");
            expect(sm.getTimeoutContext()?.reason).toBe("AMBIGUITY");
            expect(sm.getTimeoutContext()?.previousDirection).toBeUndefined();
        });

        test("stays in TIMEOUT while both signals true", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            expect(sm.evaluateTimeoutExit(true, true)).toBe("TIMEOUT");
        });

        test("resolves to LONG when short signal drops", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            expect(sm.evaluateTimeoutExit(true, false)).toBe("LONG");
        });

        test("resolves to SHORT when long signal drops", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            expect(sm.evaluateTimeoutExit(false, true)).toBe("SHORT");
        });

        test("resolves to CASH when both signals drop", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            expect(sm.evaluateTimeoutExit(false, false)).toBe("CASH");
        });

        test("respects algoType restrictions during ambiguity resolution", () => {
            const sm = createStateMachine("LONG", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            // Even if short signal is the only one true, can't enter SHORT
            // So it should go to CASH
            expect(sm.evaluateTimeoutExit(false, true)).toBe("CASH");
        });
    });

    describe("Exit TIMEOUT Transitions", () => {
        test("exitTimeout to CASH works", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            sm.exitTimeout("CASH", 3000);
            expect(sm.getState()).toBe("CASH");
            expect(sm.getTimeoutContext()).toBeNull();
        });

        test("exitTimeout to LONG works", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            sm.exitTimeout("LONG", 2000);
            expect(sm.getState()).toBe("LONG");
        });

        test("exitTimeout to SHORT works", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            sm.exitTimeout("SHORT", 2000);
            expect(sm.getState()).toBe("SHORT");
        });

        test("exitTimeout respects algoType restrictions", () => {
            const sm = createStateMachine("LONG", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);

            expect(() => sm.exitTimeout("SHORT", 2000)).toThrow();
        });

        test("cannot exitTimeout when not in TIMEOUT state", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);

            expect(() => sm.exitTimeout("CASH", 1000)).toThrow();
        });
    });

    describe("Exit Restrictions", () => {
        test("cannot exit from CASH state", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            expect(sm.canExit()).toBe(false);
            expect(() => sm.exitToTimeout(1000)).toThrow();
        });

        test("cannot exit from TIMEOUT state", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterAmbiguityTimeout(1000);
            expect(sm.canExit()).toBe(false);
        });
    });

    describe("Transition History", () => {
        test("records LONG entry transition", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);

            const transitions = sm.getTransitions();
            expect(transitions).toHaveLength(1);
            expect(transitions[0]).toMatchObject({
                from: "CASH",
                to: "LONG",
                timestamp: 1000,
                direction: "LONG",
            });
        });

        test("records SHORT entry transition", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterShort(1000);

            expect(sm.getLastTransition()).toMatchObject({
                from: "CASH",
                to: "SHORT",
                timestamp: 1000,
                direction: "SHORT",
            });
        });

        test("records exit to TIMEOUT with context", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            const last = sm.getLastTransition();
            expect(last?.from).toBe("LONG");
            expect(last?.to).toBe("TIMEOUT");
            expect(last?.timestamp).toBe(2000);
            expect(last?.timeoutContext?.reason).toBe("POST_TRADE");
            expect(last?.timeoutContext?.previousDirection).toBe("LONG");
        });

        test("tracks multiple transitions", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);

            sm.enterLong(1000);
            sm.exitToTimeout(2000);
            sm.exitTimeout("CASH", 2500);
            sm.enterShort(3000);
            sm.exitToTimeout(4000);

            const transitions = sm.getTransitions();
            expect(transitions).toHaveLength(5);

            expect(transitions[0]).toMatchObject({ from: "CASH", to: "LONG" });
            expect(transitions[1]).toMatchObject({ from: "LONG", to: "TIMEOUT" });
            expect(transitions[2]).toMatchObject({ from: "TIMEOUT", to: "CASH" });
            expect(transitions[3]).toMatchObject({ from: "CASH", to: "SHORT" });
            expect(transitions[4]).toMatchObject({ from: "SHORT", to: "TIMEOUT" });
        });
    });

    describe("Reset", () => {
        test("reset returns to CASH state", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");

            sm.reset();
            expect(sm.getState()).toBe("CASH");
        });

        test("reset clears transition history", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);
            sm.exitToTimeout(2000);
            expect(sm.getTransitions()).toHaveLength(2);

            sm.reset();
            expect(sm.getTransitions()).toHaveLength(0);
        });

        test("reset clears timeout context", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.enterLong(1000);
            sm.exitToTimeout(2000);
            expect(sm.getTimeoutContext()).not.toBeNull();

            sm.reset();
            expect(sm.getTimeoutContext()).toBeNull();
        });
    });

    describe("Factory Function", () => {
        test("createStateMachine creates valid machine for BOTH", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            expect(sm.canEnterLong()).toBe(true);
            expect(sm.canEnterShort()).toBe(true);
        });

        test("createStateMachine creates valid machine for LONG", () => {
            const sm = createStateMachine("LONG", defaultTimeout);
            expect(sm.canEnterLong()).toBe(true);
            expect(sm.canEnterShort()).toBe(false);
        });

        test("createStateMachine creates valid machine for SHORT", () => {
            const sm = createStateMachine("SHORT", defaultTimeout);
            expect(sm.canEnterLong()).toBe(false);
            expect(sm.canEnterShort()).toBe(true);
        });
    });

    describe("Timeout Tick", () => {
        test("tickTimeout increments barsInTimeout", () => {
            const sm = createStateMachine("BOTH", { mode: "COOLDOWN_ONLY", cooldownBars: 5 });
            sm.enterLong(1000);
            sm.exitToTimeout(2000);

            expect(sm.getTimeoutContext()?.barsInTimeout).toBe(0);

            sm.tickTimeout();
            expect(sm.getTimeoutContext()?.barsInTimeout).toBe(1);

            sm.tickTimeout();
            expect(sm.getTimeoutContext()?.barsInTimeout).toBe(2);

            sm.tickTimeout();
            expect(sm.getTimeoutContext()?.barsInTimeout).toBe(3);
        });

        test("tickTimeout does nothing when not in TIMEOUT", () => {
            const sm = createStateMachine("BOTH", defaultTimeout);
            sm.tickTimeout(); // Should not throw
            expect(sm.getTimeoutContext()).toBeNull();
        });
    });
});
