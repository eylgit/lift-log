/**
 * Display units (G3.1, INV-1, §6.6).
 *
 * Three things are worth testing and they are in increasing order of value.
 *
 * The conversion, which is arithmetic. The *screens*, because the whole point
 * of the change is that no line of text anywhere still says "kg" when the
 * athlete has asked for pounds — and the five helpers below were exported and
 * untested before this, which is how a `${x} kg` survives a units feature.
 *
 * And a guard, in the manner of `db-boundary.test.ts`: nothing under `src/` may
 * interpolate a value straight into the letters `kg` again. That is the exact
 * shape of the bug this part fixes, and nothing but a test stops it coming
 * back the next time somebody adds a screen.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { changeLine, lastLine, progressLine } from "../src/screens/Today";
import { gain, label } from "../src/screens/Progress";
import type { ChartPoint } from "../src/engine";
import type { ProgressStats } from "../src/progress";
import type { LastResult, WeightChange } from "../src/today";
import {
  KG_PER_LB,
  displayStep,
  displayWeight,
  fromDisplay,
  signedWeight,
  stepChoices,
  toDisplay,
  weight,
} from "../src/units";

/* ------------------------------------------------------------- the maths */

describe("converting (INV-1)", () => {
  it("uses the exact definition of a pound, not an approximation", () => {
    // 0.45359237 has been the definition since 1959. 2.2 or 2.205 would put a
    // visible error on the screen at gym weights.
    expect(KG_PER_LB).toBe(0.45359237);
    expect(toDisplay(100, "lb")).toBeCloseTo(220.462, 3);
  });

  it("leaves kilograms alone, because kilograms are what is stored", () => {
    expect(toDisplay(42.5, "kg")).toBe(42.5);
    expect(fromDisplay(42.5, "kg")).toBe(42.5);
  });

  it("round-trips a weight an athlete could actually choose", () => {
    for (const shown of [5, 10, 22.5, 45, 100]) {
      expect(toDisplay(fromDisplay(shown, "lb"), "lb")).toBeCloseTo(shown, 1);
    }
  });

  it("stores a converted weight at the same two decimals as everything else", () => {
    // A 5 lb step is 2.267961850 kg. Carrying seventeen significant figures into
    // the database would make two equal weights fail to compare equal (B3.1).
    expect(fromDisplay(5, "lb")).toBe(2.27);
  });
});

describe("spelling a weight", () => {
  it("trims trailing zeros — a card at arm's length wants a weight, not a sum", () => {
    expect(weight(40, "kg")).toBe("40 kg");
    expect(weight(42.5, "kg")).toBe("42.5 kg");
  });

  it("shows one decimal in pounds and two in kilograms", () => {
    // A tenth of a pound is 45 grams and a hundredth of a kilo is ten, so both
    // round at about the same physical precision.
    expect(weight(40, "lb")).toBe("88.2 lb");
    expect(weight(2.27, "kg")).toBe("2.27 kg");
  });

  it("signs a gain, and never writes a bare minus as a hyphen", () => {
    expect(signedWeight(5, "kg")).toBe("+5 kg");
    expect(signedWeight(-2.5, "kg")).toBe("−2.5 kg");
    expect(signedWeight(0, "kg")).toBe("0 kg");
  });
});

describe("the step, in the athlete's own units (§6.6)", () => {
  it("offers lb-native sizes rather than converted kilos", () => {
    // 2.5 kg is 5.5 lb, which is not a thing any rack does. §6.6 asks for 5 lb
    // and 2.5 lb, so the two lists are separate on purpose.
    expect(stepChoices("lb")).toEqual([1, 1.25, 2.5, 5, 10]);
    expect(stepChoices("kg")).toEqual([0.5, 1, 1.25, 2, 2.5, 5]);
  });

  it("prints an offered size as itself, not as a round trip through kilos", () => {
    // 1.25 lb stored is 0.57 kg, and 0.57 kg shown is 1.3 lb. A button reading
    // "1.3 lb" beside a sentence about 1.25 lb micro-plates looks like a bug.
    expect(displayWeight(1.25, "lb")).toBe("1.25 lb");
    expect(displayWeight(2.5, "kg")).toBe("2.5 kg");
    expect(weight(fromDisplay(1.25, "lb"), "lb")).toBe("1.3 lb");
  });

  it("steps by a round number in whichever unit is on screen", () => {
    // Stepping a pound display by a quarter-kilo walks 88.2, 88.7, 89.3 — a
    // stepper that cannot land on a whole number.
    expect(displayStep("lb")).toBe(0.5);
    expect(displayStep("kg")).toBe(0.25);
  });

  it("keeps an lb step readable after many clean sessions", () => {
    // The drift B2.2.2 says not to engineer away: two decimals of storage means
    // a repeatedly-added lb step wanders slightly. It must stay small enough to
    // be invisible at one decimal place for a realistic run.
    const step = fromDisplay(5, "lb");
    let kg = fromDisplay(20, "lb");
    for (let i = 0; i < 40; i += 1) kg = Math.round((kg + step) * 100) / 100;
    const shown = toDisplay(kg, "lb");
    expect(Math.abs(shown - 220)).toBeLessThan(0.5);
  });
});

/* ----------------------------------------------------------- the screens */

describe("what the screens say (G3.1)", () => {
  const change: WeightChange = { kind: "up", fromKg: 40, byKg: 2.5, oneStep: true };
  const last: LastResult = {
    trainingDay: "2026-08-20",
    weightKg: 40,
    outcome: "clean",
    repsShort: 0,
  };

  it("writes the Today card's reason in the chosen unit", () => {
    expect(changeLine(change, last, "kg")).toContain("40 kg");
    const lb = changeLine(change, last, "lb");
    expect(lb).toContain("88.2 lb");
    expect(lb).not.toContain("kg");
  });

  it("writes last session's line in the chosen unit", () => {
    expect(lastLine(last, "kg")).toContain("40 kg");
    expect(lastLine(last, "lb")).not.toContain("kg");
  });

  it("writes the progress row in the chosen unit", () => {
    expect(progressLine(45, 40, "kg")).toBe("+5 kg since the start");
    expect(progressLine(45, 40, "lb")).not.toContain("kg");
  });

  it("writes the chart's gain and its screen-reader label in the chosen unit", () => {
    const stats = { sessions: 9, gainKg: 5, startKg: 40 } as ProgressStats;
    expect(gain(stats, "kg")).toBe("+5 kg from 40 kg");
    expect(gain(stats, "lb")).not.toContain("kg");

    const points = [
      { trainingDay: "2026-08-01", weightKg: 40 },
      { trainingDay: "2026-08-20", weightKg: 45 },
    ] as ChartPoint[];
    expect(label(points, "kg")).toContain("40 kg");
    expect(label(points, "lb")).not.toContain("kg");
  });

  it("still says something sensible when there is nothing to say", () => {
    expect(progressLine(40, 40, "lb")).toBe("see the chart");
    expect(lastLine(null, "lb")).toBe("never trained");
    expect(label([], "lb")).toBe("No sessions yet");
  });
});

/* ------------------------------------------------------------- the guard */

/**
 * No file under `src/` may glue a value onto the letters `kg` again.
 *
 * `${weightKg} kg` was the shape of every weight on every screen before G3, and
 * it is the shape a new screen will reach for. Prose about kilograms is fine —
 * the settings screen explains that kilograms are what is stored, and the setup
 * screen names 2.5 kg as a thing a rack does. What is banned is a *number*
 * becoming a kilogram without passing through `weight()`.
 */
describe("no screen spells a weight for itself", () => {
  const SRC = join(process.cwd(), "src");
  /** `${x} kg`, `${x}kg`, and the same with a JSX expression before it. */
  const INTERPOLATED_KG = /\}\s?kg\b/;

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  /** Strip comments, so a module discussed in prose does not fail the build. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  it("routes every weight through weight()", () => {
    const offenders = files(SRC)
      .filter((path) => path !== join(SRC, "units.ts"))
      .filter((path) => INTERPOLATED_KG.test(stripComments(readFileSync(path, "utf8"))))
      .map((path) => relative(SRC, path));

    expect(offenders, `interpolates a value into "kg" — use weight(kg, units)`).toEqual([]);
  });
});
