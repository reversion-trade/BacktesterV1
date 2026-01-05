/**
 * State Machine Tests
 *
 * Tests for TradingStateMachine covering:
 * - State transitions (FLAT ↔ LONG ↔ FLAT, FLAT ↔ SHORT ↔ FLAT)
 * - AlgoType restrictions
 * - Error cases for invalid transitions
 * - Transition history tracking
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { TradingStateMachine, createStateMachine, type StateMachineConfig } from "../state-machine.ts";

describe("TradingStateMachine", () => {
    describe("Initial State", () => {
        test("starts in FLAT state", () => {
            const sm = createStateMachine("BOTH");
            expect(sm.getState()).toBe("FLAT");
            expect(sm.isFlat()).toBe(true);
            expect(sm.isInPosition()).toBe(false);
        });

        test("starts with empty transition history", () => {
            const sm = createStateMachine("BOTH");
            expect(sm.getTransitions()).toHaveLength(0);
            expect(sm.getLastTransition()).toBeUndefined();
        });
    });

    describe("LONG Transitions", () => {
        test("can enter LONG from FLAT when algoType is BOTH", () => {
            const sm = createStateMachine("BOTH");
            expect(sm.canEnterLong()).toBe(true);

            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");
            expect(sm.isFlat()).toBe(false);
            expect(sm.isInPosition()).toBe(true);
            expect(sm.getCurrentDirection()).toBe("LONG");
        });

        test("can enter LONG from FLAT when algoType is LONG", () => {
            const sm = createStateMachine("LONG");
            expect(sm.canEnterLong()).toBe(true);

            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");
        });

        test("cannot enter LONG when algoType is SHORT", () => {
            const sm = createStateMachine("SHORT");
            expect(sm.canEnterLong()).toBe(false);

            expect(() => sm.enterLong(1000)).toThrow();
        });

        test("can exit from LONG to FLAT", () => {
            const sm = createStateMachine("BOTH");
            sm.enterLong(1000);

            expect(sm.canExit()).toBe(true);
            sm.exit(2000);

            expect(sm.getState()).toBe("FLAT");
            expect(sm.isFlat()).toBe(true);
            expect(sm.getCurrentDirection()).toBeUndefined();
        });

        test("cannot enter LONG when already in LONG", () => {
            const sm = createStateMachine("BOTH");
            sm.enterLong(1000);

            expect(sm.canEnterLong()).toBe(false);
            expect(() => sm.enterLong(2000)).toThrow();
        });
    });

    describe("SHORT Transitions", () => {
        test("can enter SHORT from FLAT when algoType is BOTH", () => {
            const sm = createStateMachine("BOTH");
            expect(sm.canEnterShort()).toBe(true);

            sm.enterShort(1000);
            expect(sm.getState()).toBe("SHORT");
            expect(sm.isInPosition()).toBe(true);
            expect(sm.getCurrentDirection()).toBe("SHORT");
        });

        test("can enter SHORT from FLAT when algoType is SHORT", () => {
            const sm = createStateMachine("SHORT");
            expect(sm.canEnterShort()).toBe(true);

            sm.enterShort(1000);
            expect(sm.getState()).toBe("SHORT");
        });

        test("cannot enter SHORT when algoType is LONG", () => {
            const sm = createStateMachine("LONG");
            expect(sm.canEnterShort()).toBe(false);

            expect(() => sm.enterShort(1000)).toThrow();
        });

        test("can exit from SHORT to FLAT", () => {
            const sm = createStateMachine("BOTH");
            sm.enterShort(1000);

            sm.exit(2000);
            expect(sm.getState()).toBe("FLAT");
        });

        test("cannot enter SHORT when already in SHORT", () => {
            const sm = createStateMachine("BOTH");
            sm.enterShort(1000);

            expect(sm.canEnterShort()).toBe(false);
            expect(() => sm.enterShort(2000)).toThrow();
        });
    });

    describe("Cross-Direction Restrictions", () => {
        test("cannot enter SHORT when in LONG position", () => {
            const sm = createStateMachine("BOTH");
            sm.enterLong(1000);

            expect(sm.canEnterShort()).toBe(false);
            expect(() => sm.enterShort(2000)).toThrow();
        });

        test("cannot enter LONG when in SHORT position", () => {
            const sm = createStateMachine("BOTH");
            sm.enterShort(1000);

            expect(sm.canEnterLong()).toBe(false);
            expect(() => sm.enterLong(2000)).toThrow();
        });

        test("must exit to FLAT before reversing direction", () => {
            const sm = createStateMachine("BOTH");

            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");

            sm.exit(2000);
            expect(sm.getState()).toBe("FLAT");

            sm.enterShort(3000);
            expect(sm.getState()).toBe("SHORT");
        });
    });

    describe("Exit Restrictions", () => {
        test("cannot exit from FLAT state", () => {
            const sm = createStateMachine("BOTH");
            expect(sm.canExit()).toBe(false);
            expect(() => sm.exit(1000)).toThrow();
        });
    });

    describe("Transition History", () => {
        test("records LONG entry transition", () => {
            const sm = createStateMachine("BOTH");
            sm.enterLong(1000);

            const transitions = sm.getTransitions();
            expect(transitions).toHaveLength(1);
            expect(transitions[0]).toEqual({
                from: "FLAT",
                to: "LONG",
                timestamp: 1000,
                direction: "LONG",
            });
        });

        test("records SHORT entry transition", () => {
            const sm = createStateMachine("BOTH");
            sm.enterShort(1000);

            expect(sm.getLastTransition()).toEqual({
                from: "FLAT",
                to: "SHORT",
                timestamp: 1000,
                direction: "SHORT",
            });
        });

        test("records exit transition without direction", () => {
            const sm = createStateMachine("BOTH");
            sm.enterLong(1000);
            sm.exit(2000);

            const last = sm.getLastTransition();
            expect(last).toEqual({
                from: "LONG",
                to: "FLAT",
                timestamp: 2000,
                direction: undefined,
            });
        });

        test("tracks multiple transitions", () => {
            const sm = createStateMachine("BOTH");

            sm.enterLong(1000);
            sm.exit(2000);
            sm.enterShort(3000);
            sm.exit(4000);

            const transitions = sm.getTransitions();
            expect(transitions).toHaveLength(4);

            expect(transitions[0]).toMatchObject({ from: "FLAT", to: "LONG" });
            expect(transitions[1]).toMatchObject({ from: "LONG", to: "FLAT" });
            expect(transitions[2]).toMatchObject({ from: "FLAT", to: "SHORT" });
            expect(transitions[3]).toMatchObject({ from: "SHORT", to: "FLAT" });
        });
    });

    describe("Reset", () => {
        test("reset returns to FLAT state", () => {
            const sm = createStateMachine("BOTH");
            sm.enterLong(1000);
            expect(sm.getState()).toBe("LONG");

            sm.reset();
            expect(sm.getState()).toBe("FLAT");
        });

        test("reset clears transition history", () => {
            const sm = createStateMachine("BOTH");
            sm.enterLong(1000);
            sm.exit(2000);
            expect(sm.getTransitions()).toHaveLength(2);

            sm.reset();
            expect(sm.getTransitions()).toHaveLength(0);
        });
    });

    describe("Factory Function", () => {
        test("createStateMachine creates valid machine for BOTH", () => {
            const sm = createStateMachine("BOTH");
            expect(sm.canEnterLong()).toBe(true);
            expect(sm.canEnterShort()).toBe(true);
        });

        test("createStateMachine creates valid machine for LONG", () => {
            const sm = createStateMachine("LONG");
            expect(sm.canEnterLong()).toBe(true);
            expect(sm.canEnterShort()).toBe(false);
        });

        test("createStateMachine creates valid machine for SHORT", () => {
            const sm = createStateMachine("SHORT");
            expect(sm.canEnterLong()).toBe(false);
            expect(sm.canEnterShort()).toBe(true);
        });
    });
});
