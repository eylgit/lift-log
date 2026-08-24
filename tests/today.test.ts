/**
 * D1.1 — the Today card reads the log instead of a constant.
 *
 * Two things are being checked and they are different. The first half is
 * `prescribeDay` on its own: given a rotation and a cache, does it pick the
 * right lift and hand back the engine's answer for it? The second half opens a
 * real database and asks the question that matters after the placeholder
 * rotation is gone — does a fresh install have anything to prescribe at all,
 * and does what it prescribes move when a session is logged?
 *
 * `fake-indexeddb` provides the database (see vitest.config.ts).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { openDexieRepo } from "../src/db/dexie-repo";
import { rebuildState } from "../src/db/replay";
import type { Repo } from "../src/db/repo";
import { DEFAULT_ROTATION } from "../src/db/schema";
import type { EngineState, Exercise, Session, SetLog } from "../src/engine";
import { DEFAULT_STEP_KG, SESSION_SCHEME } from "../src/engine";
import { loadToday, prescribeDay } from "../src/today";

/* ------------------------------------------------------------- fixtures */

const ROTATION: readonly Exercise[] = [
  { id: "split-squat", name: "Bulgarian Split Squat", pattern: "squat", videoQuery: "split squat", startKg: 30, weakSide: "left" },
  { id: "press", name: "Single-Arm Shoulder Press", pattern: "vertical push", videoQuery: "press", startKg: 17.5, weakSide: "left" },
  { id: "deadlift", name: "Single-Leg Deadlift", pattern: "hip hinge", videoQuery: "sldl", startKg: 32.5, weakSide: "right" },
];

function state(exerciseId: string, currentKg: number, stallCount = 0): EngineState {
  return { exerciseId, currentKg, stallCount };
}

/* ----------------------------------------------------------- the picking */

describe("which lift, and at what weight", () => {
  it("prescribes the lift at that position in the rotation", () => {
    const today = prescribeDay(ROTATION, [state("deadlift", 40)], 2);

    expect(today.prescription.exercise.id).toBe("deadlift");
    expect(today.prescription.weightKg).toBe(40);
    expect(today.dayIndex).toBe(2);
    expect(today.rotationLength).toBe(3);
  });

  it("takes the session shape from the engine", () => {
    const { prescription } = prescribeDay(ROTATION, [], 0);

    expect(prescription.repsPerSide).toBe(SESSION_SCHEME.repsPerSide);
    expect(prescription.sets).toBe(SESSION_SCHEME.sets);
    expect(prescription.restMinutes).toBe(SESSION_SCHEME.restMinutes);
  });

  it("puts the weak side first, read from the exercise", () => {
    expect(prescribeDay(ROTATION, [], 2).prescription.weakSide).toBe("right");
    expect(prescribeDay(ROTATION, [], 1).prescription.weakSide).toBe("left");
  });

  it("starts an untrained lift at its start weight rather than failing", () => {
    // A fresh install: five lifts in the rotation, nothing in the cache.
    const { prescription } = prescribeDay(ROTATION, [], 1);

    expect(prescription.weightKg).toBe(17.5);
  });

  it("ignores a cache row belonging to another lift", () => {
    const { prescription } = prescribeDay(ROTATION, [state("press", 99)], 0);

    expect(prescription.exercise.id).toBe("split-squat");
    expect(prescription.weightKg).toBe(30);
  });
});

/* ------------------------------------------------------------ the ring */

describe("the rotation is a ring", () => {
  it("wraps past the end", () => {
    expect(prescribeDay(ROTATION, [], 3).prescription.exercise.id).toBe("split-squat");
    expect(prescribeDay(ROTATION, [], 7).prescription.exercise.id).toBe("press");
  });

  it("wraps before the beginning", () => {
    expect(prescribeDay(ROTATION, [], -1).prescription.exercise.id).toBe("deadlift");
    expect(prescribeDay(ROTATION, [], -4).prescription.exercise.id).toBe("deadlift");
  });

  it("reports the wrapped position, so the card and the dots agree", () => {
    const today = prescribeDay(ROTATION, [], 7);

    expect(today.dayIndex).toBe(1);
    expect(today.rotationLength).toBe(3);
  });

  it("refuses a day that is not a whole number", () => {
    expect(() => prescribeDay(ROTATION, [], 1.5)).toThrow(RangeError);
    expect(() => prescribeDay(ROTATION, [], Number.NaN)).toThrow(RangeError);
  });

  it("refuses an empty rotation rather than rendering nothing", () => {
    expect(() => prescribeDay([], [], 0)).toThrow(/rotation is empty/);
  });
});

/* ------------------------------------------------- against a real database */

describe("a fresh install has something to prescribe", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`lift-log-today-${(dbCount += 1)}`);
  });

  it("seeds the five lifts in rotation order", async () => {
    const exercises = await repo.listExercises();

    expect(exercises.map((e) => e.id)).toEqual(DEFAULT_ROTATION.map((e) => e.id));
    expect(exercises).not.toHaveProperty("0.order");
  });

  it("starts every lift at one step, which is what onboarding will default to", async () => {
    const exercises = await repo.listExercises();

    expect(exercises.every((e) => e.startKg === DEFAULT_STEP_KG)).toBe(true);
  });

  it("prescribes from an empty cache on the very first open", async () => {
    // Nothing has run a replay yet: `engineState` is genuinely empty here, and
    // the start weight has to come off the exercise row.
    await expect(repo.listEngineState()).resolves.toEqual([]);

    const today = await loadToday(repo, 0);

    expect(today.prescription.exercise.id).toBe("split-squat");
    expect(today.prescription.weightKg).toBe(DEFAULT_STEP_KG);
    expect(today.rotationLength).toBe(5);
  });

  it("moves the weight after a clean session, because it reads the log", async () => {
    const session: Session = {
      id: "s1",
      exerciseId: "split-squat",
      startedAt: "2026-08-24T08:00:00.000Z",
      finishedAt: "2026-08-24T08:30:00.000Z",
      trainingDay: "2026-08-24",
      prescribedKg: DEFAULT_STEP_KG,
      actualKg: 20,
      status: "complete",
      note: null,
      deletedAt: null,
    };
    const sets: SetLog[] = [0, 1, 2, 3, 4, 5].map((ordinal) => ({
      id: `s1-${ordinal}`,
      sessionId: "s1",
      ordinal,
      side: ordinal % 2 === 0 ? "left" : "right",
      targetReps: SESSION_SCHEME.repsPerSide,
      doneReps: SESSION_SCHEME.repsPerSide,
      loggedAt: "2026-08-24T08:29:00.000Z",
    }));

    await repo.appendSession(session);
    await repo.appendSets(sets);
    await rebuildState(repo);

    const today = await loadToday(repo, 0);

    // 20 kg lifted clean, plus one step. Not the prescribed weight — what was
    // actually on the dumbbell (INV-7).
    expect(today.prescription.weightKg).toBe(20 + DEFAULT_STEP_KG);
  });
});
