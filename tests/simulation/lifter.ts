/**
 * B7.3 — a year of the real engine.
 *
 * The lifter itself moved to `src/sample.ts` in G2, because the sample data a
 * first-time visitor sees is the same thing at a different length: fourteen
 * weeks instead of fifty-two. Two runs of one model, not two models. What is
 * left here is the year's parameters and nothing else — this file is the
 * *fixture*, and the model it drives is now shipped code, which is a better
 * guarantee than a test-only copy ever was.
 *
 * ## The lifter
 *
 * Capacity grows on a fixed curve with two parts: a quick novice adaptation
 * that is mostly spent inside two months, and a steady long-term gain that is
 * still running at the end of the year. No noise, no randomness — the same run
 * every time, so the committed chart only changes when the engine does.
 *
 * The steady part is about 15 kg a year on every lift, which is a good year.
 * That is a choice, and it is worth being honest about why: the engine offers
 * one step per clean session, and each lift comes round every five days, so a
 * cycle of stall → deload → climb back takes about 35 days. A lifter gaining
 * less than one step per 35 days — under ~10 kg a year against the default
 * 1 kg step — tops out at the same weight cycle after cycle. The teeth of the
 * sawtooth stop rising and the chart goes flat.
 *
 * That is not a bug in the engine, and this simulation is not hiding it: it is
 * the plateau the engine cannot see (see `Equipment` in `src/engine/types.ts`,
 * and Part K). A simulation showing a lifter who never improves would be a
 * poor demonstration of a progression engine, so this one improves.
 *
 * ## The year
 *
 * 365 days, one lift a day, in rotation. Two things interrupt it, because a
 * year that goes perfectly proves less than one that does not:
 *
 *   - a ten-day holiday, to show the rotation is a position pointer and not a
 *     calendar — the lift after the break is the next one in the cycle, not
 *     whichever one the date lands on;
 *   - one abandoned session, to show it costs the athlete nothing (B5.7).
 */

import { DEFAULT_STEP_KG } from "../../src/engine";
import type { Equipment, Exercise, TrainingDay } from "../../src/engine";
import { run } from "../../src/sample";
import type { RunDeload, RunLift, RunResult } from "../../src/sample";

/** Kept as the names the rest of the suite already imports. */
export type SimDeload = RunDeload;
export type SimLift = RunLift;
export type SimResult = RunResult;

/* ------------------------------------------------------------- the year */

/** Day one. Arbitrary, and fixed so the committed chart is reproducible. */
const FIRST_DAY: TrainingDay = "2026-01-01";
const FIRST_DAY_UTC = Date.parse(`${FIRST_DAY}T00:00:00.000Z`);
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

/** Days off, as day indices from zero. Ten days in early May. */
const HOLIDAY_FROM = 118;
const HOLIDAY_TO = 127;

/** The one session that gets walked away from. */
const ABANDONED_DAY = 200;

/**
 * How far above the starting weight the athlete already is on day one.
 * Enough that the first few sessions are clean, which is how a start weight is
 * meant to be chosen (G1.2).
 */
const HEADROOM_KG = 2;

/**
 * The rotation, with the start weights and weak sides the app ships as
 * suggestions.
 *
 * These used to be a `Lift` wrapper around the exercise, because `Exercise`
 * had nowhere to put them and `EngineState` was seeded by hand. Both now live
 * on the exercise itself (C3.0), so the wrapper is gone and this is the same
 * shape the app stores.
 *
 * Kept here rather than shared with `SAMPLE_ROTATION`, which holds the same
 * five lifts at the same weights. They are the same today by coincidence and
 * not by rule: one is a fixture chosen to make a year-long chart legible, the
 * other is product data chosen to look like somebody's real log, and tying them
 * together would mean a change to what a visitor sees rewriting the committed
 * simulation.
 */
const ROTATION: readonly Exercise[] = [
  {
    id: "split-squat",
    name: "Bulgarian Split Squat",
    pattern: "squat",
    videoQuery: "bulgarian split squat dumbbell form",
    startKg: 30,
    weakSide: "left",
  },
  {
    id: "press",
    name: "Single-Arm Shoulder Press",
    pattern: "vertical push",
    videoQuery: "single arm dumbbell shoulder press form",
    startKg: 17.5,
    weakSide: "left",
  },
  {
    id: "deadlift",
    name: "Single-Leg Deadlift",
    pattern: "hip hinge",
    videoQuery: "single leg romanian deadlift dumbbell form",
    startKg: 32.5,
    weakSide: "right",
  },
  {
    id: "bench",
    name: "Single-Arm Bench Press",
    pattern: "horizontal push",
    videoQuery: "single arm dumbbell bench press form",
    startKg: 22.5,
    weakSide: "left",
  },
  {
    id: "row",
    name: "Single-Arm Row",
    pattern: "horizontal pull",
    videoQuery: "single arm dumbbell row form",
    startKg: 27.5,
    weakSide: "left",
  },
];

/** Day index back out of a training day, so the chart can place a session. */
export function dayIndexOf(day: TrainingDay): number {
  return Math.round((Date.parse(`${day}T00:00:00.000Z`) - FIRST_DAY_UTC) / DAY_MS);
}

/**
 * Run the year.
 *
 * The lifter does exactly what the engine says, every time: no hand-edited
 * weights anywhere in the model. That is what lets the test assert that every
 * drop on the chart is a deload — there is nothing else it could be.
 */
export function simulate(equipment: Equipment = { stepKg: DEFAULT_STEP_KG }): SimResult {
  return run({
    rotation: ROTATION,
    equipment,
    days: YEAR_DAYS,
    firstDay: FIRST_DAY,
    headroomKg: HEADROOM_KG,
    restFrom: HOLIDAY_FROM,
    restTo: HOLIDAY_TO,
    abandonedDay: ABANDONED_DAY,
    idPrefix: "sim-",
  });
}
