/**
 * B7.1 and B7.2 for the weight arithmetic (B3).
 *
 * The unit tests are the cases a human would think to check. The property
 * tests are the ones a human would not: they run hundreds of step sizes and
 * weights looking for the float drift that this module exists to prevent.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { addStep, roundKg, snapToStep } from "../src/engine/weights";

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

describe("snapToStep", () => {
  it("takes the largest multiple of the step at or below the weight", () => {
    expect(snapToStep(21, 2.5)).toBe(20);
    expect(snapToStep(20, 2.5)).toBe(20);
    expect(snapToStep(19.9, 2.5)).toBe(17.5);
    expect(snapToStep(4.4, 1)).toBe(4);
  });

  it("never returns less than one step, however light the weight", () => {
    expect(snapToStep(0, 2.5)).toBe(2.5);
    expect(snapToStep(1, 2.5)).toBe(2.5);
    expect(snapToStep(-40, 2.5)).toBe(2.5);
  });

  it("does not lose a step to division error", () => {
    // 17.5 / 2.5 can arrive as 6.999999999999999; flooring that gives 15.
    expect(snapToStep(17.5, 2.5)).toBe(17.5);
    expect(snapToStep(2.25, 0.75)).toBe(2.25);
    expect(snapToStep(0.3, 0.1)).toBe(0.3);
  });

  it("handles the deload fallback, which is the reason it exists (B5.4)", () => {
    expect(snapToStep(roundKg(40 * 0.85), 2.5)).toBe(32.5); // 34 -> 32.5
    expect(snapToStep(roundKg(22 * 0.85), 1)).toBe(18); // 18.7 -> 18
  });

  it("refuses a step that is zero, negative or not finite", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => snapToStep(20, bad)).toThrow(RangeError);
    }
  });
});

describe("properties (B7.2)", () => {
  const step = () => fc.constantFrom(...STEPS);
  /**
   * Weights at storage precision — two decimals — because that is the domain.
   * Ranging over arbitrary doubles instead finds "counterexamples" like
   * 499.99999999999005, which differ from a real weight by less than the error
   * in multiplying by 100. No implementation can both absorb that error and
   * respect it, and a value a hundred-billionth of a kilo below 500 is not a
   * weight anyone can load — it is a double.
   */
  const weight = () => fc.integer({ min: 0, max: 50_000 }).map((h) => h / 100);

  it("B7.2.1 — every weight the engine returns is a whole multiple of the step", () => {
    fc.assert(
      fc.property(step(), weight(), (stepKg, kg) => {
        const snapped = snapToStep(kg, stepKg);
        expect(roundKg(snapped / stepKg) % 1).toBe(0);
        expect(roundKg(addStep(snapped, stepKg) / stepKg) % 1).toBe(0);
      }),
    );
  });

  it("B7.2.2 — snapToStep never goes above the weight, nor below one step", () => {
    fc.assert(
      fc.property(step(), weight(), (stepKg, kg) => {
        const snapped = snapToStep(kg, stepKg);
        expect(snapped).toBeGreaterThanOrEqual(stepKg);
        if (kg >= stepKg) expect(snapped).toBeLessThanOrEqual(kg);
      }),
    );
  });

  it("B7.2.4 — N clean sessions add exactly N steps, with no drift", () => {
    fc.assert(
      fc.property(step(), fc.integer({ min: 1, max: 365 }), (stepKg, sessions) => {
        const start = snapToStep(20, stepKg);
        let kg = start;
        for (let i = 0; i < sessions; i += 1) kg = addStep(kg, stepKg);
        expect(kg).toBe(roundKg(start + sessions * stepKg));
      }),
    );
  });

  it("snapping is idempotent — a weight on the grid stays put", () => {
    fc.assert(
      fc.property(step(), weight(), (stepKg, kg) => {
        const once = snapToStep(kg, stepKg);
        expect(snapToStep(once, stepKg)).toBe(once);
      }),
    );
  });
});
