/**
 * D1 — the Today card reads the log instead of a constant.
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
import { describeChange, lastResultFor, loadToday, prescribeDay } from "../src/today";
import type { LastResult } from "../src/today";

/* ------------------------------------------------------------- fixtures */

const ROTATION: readonly Exercise[] = [
  { id: "split-squat", name: "Bulgarian Split Squat", pattern: "squat", videoQuery: "split squat", startKg: 30, weakSide: "left" },
  { id: "press", name: "Single-Arm Shoulder Press", pattern: "vertical push", videoQuery: "press", startKg: 17.5, weakSide: "left" },
  { id: "deadlift", name: "Single-Leg Deadlift", pattern: "hip hinge", videoQuery: "sldl", startKg: 32.5, weakSide: "right" },
];

function state(exerciseId: string, currentKg: number, stallCount = 0): EngineState {
  return { exerciseId, currentKg, stallCount };
}

/** A finished session, as the app will have written it by the end of D2. */
function sessionOf(over: Partial<Session> & { id: string }): Session {
  const trainingDay = over.trainingDay ?? "2026-08-24";
  return {
    exerciseId: "split-squat",
    startedAt: `${trainingDay}T08:00:00.000Z`,
    finishedAt: `${trainingDay}T08:30:00.000Z`,
    trainingDay,
    prescribedKg: 20,
    actualKg: 20,
    status: "complete",
    note: null,
    deletedAt: null,
    ...over,
  };
}

/**
 * Three sets, both sides each, in the order the session screen writes them.
 * `done` is per side, so `[5, 5, 5, 5, 5, 3]` is a last set that fell short on
 * the second side.
 */
function setsOf(sessionId: string, done: readonly number[]): SetLog[] {
  return done.map((doneReps, ordinal) => ({
    id: `${sessionId}-${ordinal}`,
    sessionId,
    ordinal,
    side: ordinal % 2 === 0 ? "left" : "right",
    targetReps: SESSION_SCHEME.repsPerSide,
    doneReps,
    loggedAt: `2026-08-24T08:${String(10 + ordinal).padStart(2, "0")}:00.000Z`,
  }));
}

const CLEAN = [5, 5, 5, 5, 5, 5] as const;

function lastOf(over: Partial<LastResult> = {}): LastResult {
  return { trainingDay: "2026-08-19", weightKg: 20, outcome: "clean", repsShort: 0, ...over };
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
    await log(sessionOf({ id: "s1", actualKg: 20 }), CLEAN);

    const today = await loadToday(repo, 0);

    // 20 kg lifted clean, plus one step. Not the prescribed weight — what was
    // actually on the dumbbell (INV-7).
    expect(today.prescription.weightKg).toBe(20 + DEFAULT_STEP_KG);
  });

  /* ------------------------------------------------------- D1.2, on the card */

  it("says a lift has never been trained rather than inventing a last time", async () => {
    const today = await loadToday(repo, 0);

    expect(today.last).toBeNull();
    expect(today.change).toEqual({ kind: "first" });
  });

  it("reports the last session and the step it earned", async () => {
    await log(sessionOf({ id: "s1", trainingDay: "2026-08-19", actualKg: 20 }), CLEAN);

    const today = await loadToday(repo, 0);

    expect(today.last).toEqual({
      trainingDay: "2026-08-19",
      weightKg: 20,
      outcome: "clean",
      repsShort: 0,
    });
    expect(today.change).toEqual({ kind: "up", fromKg: 20, byKg: DEFAULT_STEP_KG, oneStep: true });
  });

  it("reports a short session, and a weight that did not move", async () => {
    await log(
      sessionOf({ id: "s1", trainingDay: "2026-08-19", actualKg: 20 }),
      [5, 5, 5, 4, 5, 3],
    );

    const today = await loadToday(repo, 0);

    expect(today.last).toEqual({
      trainingDay: "2026-08-19",
      weightKg: 20,
      outcome: "short",
      repsShort: 3,
    });
    expect(today.change).toEqual({ kind: "same", fromKg: 20 });
  });

  it("reports a session that was walked out of, and a weight that ignored it", async () => {
    // B5.7: the engine learns nothing from a session nobody finished, so the
    // weight stays where the clean session before it left it.
    await log(sessionOf({ id: "s1", trainingDay: "2026-08-14", actualKg: 20 }), CLEAN);
    await log(
      sessionOf({
        id: "s2",
        trainingDay: "2026-08-19",
        actualKg: 20 + DEFAULT_STEP_KG,
        status: "abandoned",
      }),
      [5, 5],
    );

    const today = await loadToday(repo, 0);

    expect(today.last?.outcome).toBe("walked out");
    expect(today.prescription.weightKg).toBe(20 + DEFAULT_STEP_KG);
    expect(today.change).toEqual({ kind: "same", fromKg: 20 + DEFAULT_STEP_KG });
  });

  it("looks past a session that is still open", async () => {
    // The athlete pressed Start and never finished. That is not a result, and
    // the one before it still is.
    await log(sessionOf({ id: "s1", trainingDay: "2026-08-14", actualKg: 20 }), CLEAN);
    await repo.appendSession(
      sessionOf({ id: "s2", trainingDay: "2026-08-19", status: "planned", finishedAt: null }),
    );

    await expect(lastResultFor(repo, "split-squat")).resolves.toMatchObject({
      trainingDay: "2026-08-14",
      outcome: "clean",
    });
  });

  it("looks past a session that was deleted (INV-3)", async () => {
    await log(sessionOf({ id: "s1", trainingDay: "2026-08-14", actualKg: 20 }), CLEAN);
    await log(sessionOf({ id: "s2", trainingDay: "2026-08-19", actualKg: 25 }), CLEAN);
    await repo.softDeleteSession("s2", "2026-08-20T09:00:00.000Z");

    await expect(lastResultFor(repo, "split-squat")).resolves.toMatchObject({
      trainingDay: "2026-08-14",
      weightKg: 20,
    });
  });

  it("reports the last session of this lift, not of another one", async () => {
    await log(sessionOf({ id: "s1", trainingDay: "2026-08-14", actualKg: 20 }), CLEAN);
    await log(
      sessionOf({ id: "s2", exerciseId: "press", trainingDay: "2026-08-19", actualKg: 99 }),
      CLEAN,
    );

    await expect(lastResultFor(repo, "split-squat")).resolves.toMatchObject({ weightKg: 20 });
  });

  it("finds the last session of a lift with a long history", async () => {
    // Enough sessions that a "read the last few" shortcut would be tempting,
    // and enough open ones on top of it to make the shortcut wrong.
    for (let i = 0; i < 40; i += 1) {
      await log(sessionOf({ id: `h${i}`, trainingDay: dayOfJune(i), actualKg: 20 + i }), CLEAN);
    }
    for (let i = 0; i < 5; i += 1) {
      await repo.appendSession(
        sessionOf({
          id: `open${i}`,
          trainingDay: dayOfJune(40 + i),
          status: "planned",
          finishedAt: null,
        }),
      );
    }

    // The 40th session, not the 40th row written: the log comes back in
    // training-day order, and the five open ones sit on top of it.
    await expect(lastResultFor(repo, "split-squat")).resolves.toMatchObject({
      trainingDay: dayOfJune(39),
      weightKg: 59,
    });
  });

  /** `n` days after 1 June 2026, as a training day. Rolls into July. */
  function dayOfJune(n: number): string {
    return new Date(Date.UTC(2026, 5, 1 + n)).toISOString().slice(0, 10);
  }

  /** Write a finished session and its sets, the way D2 will. */
  async function log(session: Session, done: readonly number[]) {
    await repo.appendSession(session);
    if (done.length > 0) await repo.appendSets(setsOf(session.id, done));
    await rebuildState(repo);
  }
});

/* ------------------------------------------------------ why this weight */

describe("what changed since last time", () => {
  it("calls an untrained lift what it is", () => {
    expect(describeChange(1, null, 1)).toEqual({ kind: "first" });
  });

  it("names a step up as a step", () => {
    expect(describeChange(21, lastOf({ weightKg: 20 }), 1)).toEqual({
      kind: "up",
      fromKg: 20,
      byKg: 1,
      oneStep: true,
    });
  });

  it("does not call a bigger jump a step", () => {
    // The athlete moved the weight themselves (INV-7). Two and a half kilos is
    // not "one step" just because it went up.
    expect(describeChange(22.5, lastOf({ weightKg: 20 }), 1)).toEqual({
      kind: "up",
      fromKg: 20,
      byKg: 2.5,
      oneStep: false,
    });
  });

  it("survives the arithmetic that made the number", () => {
    // 32.5 - 30 is 2.5 in decimal and 2.5000000000000018 in binary floating
    // point. Without rounding the difference, the card says "up 2.5 kg" where
    // it should say "one step up".
    expect(describeChange(32.5, lastOf({ weightKg: 30 }), 2.5)).toEqual({
      kind: "up",
      fromKg: 30,
      byKg: 2.5,
      oneStep: true,
    });
  });

  it("reports a weight that held", () => {
    expect(describeChange(20, lastOf({ weightKg: 20, outcome: "short" }), 1)).toEqual({
      kind: "same",
      fromKg: 20,
    });
  });

  it("reports a deload as a drop from what was lifted", () => {
    expect(describeChange(27.5, lastOf({ weightKg: 32.5, outcome: "short" }), 2.5)).toEqual({
      kind: "down",
      fromKg: 32.5,
      byKg: 5,
      oneStep: false,
    });
  });

  it("compares against what was lifted, not what was asked for", () => {
    // The engine prescribed 20 and the athlete lifted 25 because that is what
    // the rack held. Today's 26 is one step above the dumbbell, and the card
    // has to say so or the arithmetic looks broken.
    expect(describeChange(26, lastOf({ weightKg: 25 }), 1)).toMatchObject({
      kind: "up",
      fromKg: 25,
      oneStep: true,
    });
  });
});
