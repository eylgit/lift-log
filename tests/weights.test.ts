/**
 * B7.1 and B7.2 for the weight arithmetic (B3).
 *
 * The unit tests are the cases a human would think to check. The property
 * tests are the ones a human would not: they run hundreds of step sizes and
 * weights looking for the float drift that this module exists to prevent.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { addStep, roundKg } from "../src/engine/weights";

/** The step sizes real kit produces, plus one deliberately awkward one. */
const STEPS = [0.5, 0.75, 1, 1.25, 2.5, 5];

describe("roundKg", () => {
  it("settles the classic float sum", () => {
    expect(roundKg(0.1 + 0.2)).toBe(0.3);
  });

  it("rounds the exact half-way case up, where the naive forms round it down", () => {
    expect(roundKg(1.005)).toBe(1.01);
    // What we would have shipped without thinking about it:
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(Number((1.005).toFixed(2))).toBe(1);
  });

  it("leaves weights that are already clean alone", () => {
    for (const kg of [0, 1, 2.5, 17.5, 100, 137.25]) {
      expect(roundKg(kg)).toBe(kg);
    }
  });

  it("collapses weights below half a hundredth to zero", () => {
    // These also happen to be the values JavaScript prints in exponent
    // notation, which the string shift inside roundKg cannot parse.
    expect(roundKg(1e-9)).toBe(0);
    expect(roundKg(0.004)).toBe(0);
    expect(roundKg(0.005)).toBe(0.01);
  });

  it("refuses a weight that is not a finite number, or not plausible", () => {
    expect(() => roundKg(Number.NaN)).toThrow(RangeError);
    expect(() => roundKg(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => roundKg(1e21)).toThrow(RangeError);
  });
});

describe("addStep", () => {
  it("adds one step", () => {
    expect(addStep(20, 2.5)).toBe(22.5);
    expect(addStep(4, 1)).toBe(5);
  });

  it("does not drift over a long run of clean sessions", () => {
    // 2.5 accumulated by repeated addition is where 17.5 stops being 17.5.
    let kg = 0;
    for (let i = 0; i < 200; i += 1) kg = addStep(kg, 2.5);
    expect(kg).toBe(500);
  });

  it("refuses a step that is zero, negative or not finite", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => addStep(20, bad)).toThrow(RangeError);
    }
  });
});

describe("properties (B7.2)", () => {
  const step = () => fc.constantFrom(...STEPS);
  /**
   * B7.2.1 ("every weight is a whole multiple of the step") and B7.2.2 (the
   * properties of `snapToStep`) were here. Both went with the grid: the step
   * is what the athlete intends to add, not a claim about which weights exist,
   * so there is nothing for a weight to be a multiple *of*. B7.2.4 is the
   * property that survived, and it is the one that mattered.
   */
  it("B7.2.4 — N clean sessions add exactly N steps, with no drift", () => {
    fc.assert(
      fc.property(step(), fc.integer({ min: 1, max: 365 }), (stepKg, sessions) => {
        const start = 20;
        let kg = start;
        for (let i = 0; i < sessions; i += 1) kg = addStep(kg, stepKg);
        expect(kg).toBe(roundKg(start + sessions * stepKg));
      }),
    );
  });

});
