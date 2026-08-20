/**
 * B7.1 for the prescription (B4).
 *
 * Two things are worth testing here and they are not the arithmetic — that is
 * `weights.test.ts`'s job. They are that a stall really does nothing, and that
 * a long run of clean sessions lands exactly where it should rather than
 * approximately there.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  SESSION_SCHEME,
  nextWeight,
  prescribe,
} from "../src/engine/progression";
import type { EngineState, Equipment, Exercise } from "../src/engine/types";

const PRESS: Exercise = {
  id: "press",
  name: "Single-Arm Shoulder Press",
  pattern: "vertical push",
  videoQuery: "single arm dumbbell shoulder press form",
};

const ROW: Exercise = {
  id: "row",
  name: "Single-Arm Row",
  pattern: "horizontal pull",
  videoQuery: "single arm dumbbell row form",
};

function stateFor(exercise: Exercise, currentKg: number): EngineState {
  return { exerciseId: exercise.id, currentKg, stallCount: 0, weakSide: "left" };
}

const kit = (stepKg: number): Equipment => ({ stepKg });

describe("nextWeight", () => {
  it("adds exactly one step for a clean session", () => {
    expect(nextWeight(stateFor(PRESS, 17.5), kit(2.5), true)).toBe(20);
    expect(nextWeight(stateFor(PRESS, 17.5), kit(1), true)).toBe(18.5);
  });

  it("holds the weight when the session was not clean", () => {
    expect(nextWeight(stateFor(PRESS, 17.5), kit(2.5), false)).toBe(17.5);
  });

  it("does not decay, half-step back, or otherwise get creative on a stall", () => {
    // Three stalls in a row is what triggers the deload proposal in B5. Until
    // then the weight is untouched — not nudged down to "try again lighter".
    let state = stateFor(PRESS, 40);
    for (let i = 0; i < 3; i += 1) {
      state = { ...state, currentKg: nextWeight(state, kit(2.5), false) };
    }
    expect(state.currentKg).toBe(40);
  });

  it("rejects a step that would make the arithmetic nonsense", () => {
    for (const bad of [0, -2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => nextWeight(stateFor(PRESS, 20), kit(bad), true)).toThrow(RangeError);
    }
  });

  it("does not touch the state it was given", () => {
    const state = stateFor(PRESS, 20);
    nextWeight(state, kit(2.5), true);
    expect(state).toEqual(stateFor(PRESS, 20));
  });

  describe("properties", () => {
    it("B7.2.4 — N clean sessions move the weight exactly N steps", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(0.5, 0.75, 1, 1.25, 2.5, 5),
          fc.integer({ min: 0, max: 400 }),
          (stepKg, sessions) => {
            const start = stepKg;
            let state = stateFor(PRESS, start);
            for (let i = 0; i < sessions; i += 1) {
              state = { ...state, currentKg: nextWeight(state, kit(stepKg), true) };
            }
            // Exactly, not "converges on": one number, no rounding in the loop.
            expect(state.currentKg - start).toBe(
              Number((sessions * stepKg).toFixed(2)),
            );
          },
        ),
      );
    });

    it("B7.2.1 — every weight it returns is a whole multiple of the step", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(0.5, 0.75, 1, 1.25, 2.5, 5),
          fc.integer({ min: 1, max: 200 }),
          fc.boolean(),
          (stepKg, steps, clean) => {
            const state = stateFor(PRESS, Number((steps * stepKg).toFixed(2)));
            const kg = nextWeight(state, kit(stepKg), clean);
            // In hundredths, so the divisibility check has no float in it.
            expect(Math.round(kg * 100) % Math.round(stepKg * 100)).toBe(0);
          },
        ),
      );
    });

    it("B7.2.3 — the weight never goes down", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(0.5, 1, 2.5, 5),
          fc.array(fc.boolean(), { maxLength: 100 }),
          (stepKg, outcomes) => {
            let state = stateFor(PRESS, stepKg);
            for (const clean of outcomes) {
              const next = nextWeight(state, kit(stepKg), clean);
              expect(next).toBeGreaterThanOrEqual(state.currentKg);
              state = { ...state, currentKg: next };
            }
          },
        ),
      );
    });
  });
});

describe("prescribe", () => {
  const state = stateFor(PRESS, 17.5);

  it("prescribes the current weight, unchanged", () => {
    expect(prescribe(state, PRESS).weightKg).toBe(17.5);
  });

  it("carries the hardcoded session shape", () => {
    const p = prescribe(state, PRESS);
    expect(p.repsPerSide).toBe(5);
    expect(p.sets).toBe(3);
    expect(p.restMinutes).toBe(5);
  });

  it("keeps the session shape and the constant in step", () => {
    // Guards against the shape being changed in one place and not the other.
    const p = prescribe(state, PRESS);
    expect({
      repsPerSide: p.repsPerSide,
      sets: p.sets,
      restMinutes: p.restMinutes,
    }).toEqual({ ...SESSION_SCHEME });
  });

  it("puts the weak side first", () => {
    expect(prescribe({ ...state, weakSide: "right" }, PRESS).weakSide).toBe("right");
    expect(prescribe({ ...state, weakSide: "left" }, PRESS).weakSide).toBe("left");
  });

  it("refuses a state belonging to another exercise", () => {
    // The one mistake here that would otherwise look plausible on screen:
    // the right lift shown at another lift's weight.
    expect(() => prescribe(state, ROW)).toThrow(RangeError);
  });

  it("passes an off-grid weight through rather than quietly tidying it", () => {
    // currentKg is a multiple of the step by construction, so this cannot
    // happen. If it ever does, the bug should be visible, not smoothed over.
    expect(prescribe(stateFor(PRESS, 17.3), PRESS).weightKg).toBe(17.3);
  });
});
