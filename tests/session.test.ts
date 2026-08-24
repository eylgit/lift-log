/**
 * D2 — the session flow.
 *
 * The claim this file is really testing is the one in the header of
 * `src/session.ts`: there is no cursor. Where a session has got to is read off
 * the sets already logged, so "persist after every side" and "resume on the
 * exact side after a force-quit" are the same fact stated twice, and neither
 * needs code of its own. Several tests below are written as force-quits — the
 * view is thrown away and rebuilt from the database — because that is the only
 * honest way to check it.
 *
 * `fake-indexeddb` provides the database (see vitest.config.ts).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { openDexieRepo } from "../src/db/dexie-repo";
import type { Repo } from "../src/db/repo";
import type { Exercise, Prescription, Session, SetLog } from "../src/engine";
import { DEFAULT_STEP_KG, SESSION_SCHEME, STALLS_BEFORE_DELOAD } from "../src/engine";
import {
  buildView,
  restAt,
  setReps,
  setTotalSets,
  closeSession,
  isFinished,
  loadSession,
  logSide,
  resumeSession,
  setWeight,
  sideAt,
  startSession,
} from "../src/session";
import type { SessionView } from "../src/session";
import { loadToday } from "../src/today";

/* ------------------------------------------------------------- fixtures */

const PRESS: Exercise = {
  id: "press",
  name: "Single-Arm Shoulder Press",
  pattern: "vertical push",
  videoQuery: "press",
  startKg: 17.5,
  weakSide: "left",
};

function prescriptionFor(exercise: Exercise, weightKg: number): Prescription {
  return {
    exercise,
    weightKg,
    repsPerSide: SESSION_SCHEME.repsPerSide,
    sets: SESSION_SCHEME.sets,
    restMinutes: SESSION_SCHEME.restMinutes,
    weakSide: exercise.weakSide,
  };
}

function sessionOf(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    exerciseId: "press",
    startedAt: "2026-08-24T08:00:00.000Z",
    finishedAt: null,
    trainingDay: "2026-08-24",
    prescribedKg: 20,
    actualKg: 20,
    status: "planned",
    note: null,
    deletedAt: null,
    ...over,
  };
}

function setOf(ordinal: number, over: Partial<SetLog> = {}): SetLog {
  return {
    id: `s1-${ordinal}`,
    sessionId: "s1",
    ordinal,
    side: ordinal % 2 === 0 ? "left" : "right",
    targetReps: 5,
    doneReps: 5,
    loggedAt: `2026-08-24T08:${String(10 + ordinal).padStart(2, "0")}:00.000Z`,
    ...over,
  };
}

/** A view with `n` sides already logged. */
function viewWith(n: number, over: Partial<Session> = {}): SessionView {
  const sets = Array.from({ length: n }, (_, i) => setOf(i));
  return buildView(sessionOf(over), PRESS, sets);
}

/* ------------------------------------------------------------ the order */

describe("which side, and when (D2.4)", () => {
  it("puts the weak side first, every set", () => {
    expect([0, 1, 2, 3, 4, 5].map((o) => sideAt(o, "left"))).toEqual([
      "left", "right", "left", "right", "left", "right",
    ]);
  });

  it("follows the athlete's weak side rather than a fixed one", () => {
    expect([0, 1, 2, 3].map((o) => sideAt(o, "right"))).toEqual([
      "right", "left", "right", "left",
    ]);
  });
});

/* ------------------------------------------------------------- the view */

describe("where the session has got to", () => {
  it("starts on set 1, weak side", () => {
    const { step } = viewWith(0);

    expect(step).toMatchObject({ ordinal: 0, setNumber: 1, side: "left", isWeakSide: true });
  });

  it("moves to the other side of the same set", () => {
    const { step } = viewWith(1);

    expect(step).toMatchObject({ ordinal: 1, setNumber: 1, side: "right", isWeakSide: false });
  });

  it("moves to the next set after both sides", () => {
    const { step } = viewWith(2);

    expect(step).toMatchObject({ ordinal: 2, setNumber: 2, side: "left", isWeakSide: true });
  });

  it("knows the last side of the last set", () => {
    expect(viewWith(5).step?.isLastSide).toBe(true);
    expect(viewWith(4).step?.isLastSide).toBe(false);
  });

  it("has nothing left to do when every side is logged", () => {
    const view = viewWith(SESSION_SCHEME.sets * 2);

    expect(view.step).toBeNull();
    expect(isFinished(view)).toBe(true);
  });

  it("prescribes the weight that is actually on the dumbbell", () => {
    expect(viewWith(0, { prescribedKg: 20, actualKg: 25 }).step?.weightKg).toBe(25);
  });

  it("half-fills a bar after the first side of a set (D2.3)", () => {
    expect(viewWith(0).bars).toEqual([0, 0, 0]);
    expect(viewWith(1).bars).toEqual([0.5, 0, 0]);
    expect(viewWith(2).bars).toEqual([1, 0, 0]);
    expect(viewWith(3).bars).toEqual([1, 0.5, 0]);
    expect(viewWith(6).bars).toEqual([1, 1, 1]);
  });
});

/* ------------------------------------------------------------- the rest */

describe("when to rest (D2.4, D3.1)", () => {
  it("does not rest between the two sides of one set", () => {
    expect(viewWith(1).restStartedAt).toBeNull();
    expect(viewWith(3).restStartedAt).toBeNull();
  });

  it("rests after a set, from the instant the set was logged", () => {
    const view = viewWith(2);

    expect(view.restStartedAt).toBe(setOf(1).loggedAt);
  });

  it("does not rest before the first set", () => {
    expect(viewWith(0).restStartedAt).toBeNull();
  });

  it("does not rest after the last set", () => {
    expect(viewWith(6).restStartedAt).toBeNull();
  });
});

/* ------------------------------------------------------- tap to edit (D5) */

describe("changing the session as it runs", () => {
  it("changes the target for the sides still to come", () => {
    const view = setReps(viewWith(2), 3);

    expect(view.step?.targetReps).toBe(3);
  });

  it("leaves the sides already logged at the target they were attempted against", () => {
    // A set done at a target of five that got four is short. It does not become
    // clean because the target moved afterwards (INV-2).
    const view = setReps(viewWith(2), 3);

    expect(view.sets.map((s) => s.targetReps)).toEqual([5, 5]);
  });

  it("reads the reps back off the log after a force-quit", () => {
    // No shape passed, which is what `loadSession` does: the target on the last
    // side logged is the answer.
    const sets = [setOf(0, { targetReps: 3 }), setOf(1, { targetReps: 3 })];
    const view = buildView(sessionOf(), PRESS, sets);

    expect(view.step?.targetReps).toBe(3);
  });

  it("refuses a rep target that is not a whole number of reps", () => {
    expect(() => setReps(viewWith(0), 0)).toThrow(RangeError);
    expect(() => setReps(viewWith(0), 2.5)).toThrow(RangeError);
  });

  it("adds a set", () => {
    const view = setTotalSets(viewWith(6), 4);

    expect(view.totalSets).toBe(4);
    expect(view.step).toMatchObject({ ordinal: 6, setNumber: 4, side: "left" });
    expect(view.bars).toEqual([1, 1, 1, 0]);
  });

  it("reads an added set back off the log after a force-quit", () => {
    // Seven logged sides cannot mean three sets, whatever the default says.
    const sets = Array.from({ length: 7 }, (_, i) => setOf(i));
    const view = buildView(sessionOf(), PRESS, sets);

    expect(view.totalSets).toBe(4);
    expect(view.step?.ordinal).toBe(7);
  });

  it("will not drop a set that has anything logged in it", () => {
    const view = setTotalSets(viewWith(5), 1);

    // Two full sets and half of a third are on the record. Removing them would
    // be deleting facts, not changing a plan.
    expect(view.totalSets).toBe(3);
  });

  it("refuses a session of no sets at all", () => {
    expect(() => setTotalSets(viewWith(0), 0)).toThrow(RangeError);
  });
});

/* ------------------------------------------------------- the rest clock */

describe("the rest clock reads the wall clock (D3.1)", () => {
  const started = "2026-08-24T08:10:00.000Z";
  const after = (seconds: number) => new Date(Date.parse(started) + seconds * 1000);

  it("counts down from the target", () => {
    expect(restAt(started, 300, after(0))).toMatchObject({ remainingS: 300, over: false });
    expect(restAt(started, 300, after(60))).toMatchObject({ remainingS: 240, over: false });
  });

  it("is over on the second the target is reached", () => {
    expect(restAt(started, 300, after(299)).over).toBe(false);
    expect(restAt(started, 300, after(300)).over).toBe(true);
  });

  it("keeps counting up rather than going negative", () => {
    // Resting long is not a failure state (D3.3). The screen shows the overrun.
    const rest = restAt(started, 300, after(420));

    expect(rest.remainingS).toBe(0);
    expect(rest.elapsedS).toBe(420);
    expect(rest.over).toBe(true);
  });

  it("is right after the phone has been locked for ten minutes", () => {
    // The point of the whole design: nothing was counting while the screen was
    // off, so nothing could be throttled or suspended into the wrong answer.
    expect(restAt(started, 300, after(600))).toMatchObject({ elapsedS: 600, over: true });
  });

  it("does not read a backwards clock as a rest that has not started", () => {
    expect(restAt(started, 300, after(-30))).toMatchObject({ elapsedS: 0, remainingS: 300 });
  });
});

/* -------------------------------------------------- against a real database */

describe("running a session", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`lift-log-session-${(dbCount += 1)}`);
  });

  const at = (minute: number) => new Date(Date.UTC(2026, 7, 24, 8, minute));

  it("opens a session for today's prescription", async () => {
    const today = await loadToday(repo);

    const view = await startSession(repo, today.prescription, {}, at(0));

    expect(view.session).toMatchObject({
      exerciseId: today.prescription.exercise.id,
      status: "planned",
      prescribedKg: today.prescription.weightKg,
      actualKg: today.prescription.weightKg,
      trainingDay: "2026-08-24",
      finishedAt: null,
    });
  });

  it("writes one row per side, in order", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));
    view = await logSide(repo, view, 5, at(1));
    view = await logSide(repo, view, 4, at(2));

    const sets = await repo.listSets(view.session.id);
    expect(sets.map((s) => [s.ordinal, s.side, s.doneReps])).toEqual([
      [0, "left", 5],
      [1, "right", 4],
    ]);
  });

  it("resumes on the exact side after a force-quit (D2.5)", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));
    view = await logSide(repo, view, 5, at(1));
    view = await logSide(repo, view, 5, at(2));
    view = await logSide(repo, view, 5, at(8));

    // The app dies here. Everything in memory is gone; only the log survives.
    const resumed = await resumeSession(repo);

    expect(resumed?.session.id).toBe(view.session.id);
    expect(resumed?.step).toMatchObject({ ordinal: 3, setNumber: 2, side: "right" });
    expect(resumed?.bars).toEqual([1, 0.5, 0]);
  });

  it("has nothing to resume when no session is open", async () => {
    await expect(resumeSession(repo)).resolves.toBeNull();
  });

  it("has nothing to resume once the session is closed", async () => {
    const view = await run(prescriptionFor(PRESS, 20), [5, 5, 5, 5, 5, 5]);
    await closeSession(repo, view, "complete", at(30));

    await expect(resumeSession(repo)).resolves.toBeNull();
  });

  it("refuses a seventh side", async () => {
    const view = await run(prescriptionFor(PRESS, 20), [5, 5, 5, 5, 5, 5]);

    await expect(logSide(repo, view, 5, at(30))).rejects.toThrow(/every side logged/);
  });

  it("refuses a rep count that is not a whole number of reps", async () => {
    const view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));

    await expect(logSide(repo, view, 4.5, at(1))).rejects.toThrow(RangeError);
    await expect(logSide(repo, view, -1, at(1))).rejects.toThrow(RangeError);
  });

  it("records reps as a number rather than a flag (INV-4)", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));
    view = await logSide(repo, view, 4, at(1));
    view = await logSide(repo, view, 1, at(2));

    const sets = await repo.listSets(view.session.id);
    // A near miss and a collapse are different facts, and both survive.
    expect(sets.map((s) => s.doneReps)).toEqual([4, 1]);
  });

  /* ------------------------------------------------------- closing it */

  it("moves the weight up after a clean session", async () => {
    const view = await run(prescriptionFor(PRESS, 20), [5, 5, 5, 5, 5, 5]);

    const outcome = await closeSession(repo, view, "complete", at(30));

    expect(outcome.state.currentKg).toBe(20 + DEFAULT_STEP_KG);
    expect(outcome.state.stallCount).toBe(0);
    await expect(repo.getEngineState("press")).resolves.toMatchObject({
      currentKg: 20 + DEFAULT_STEP_KG,
    });
  });

  it("holds the weight and counts a stall after a short session", async () => {
    const view = await run(prescriptionFor(PRESS, 20), [5, 5, 5, 5, 5, 3]);

    const outcome = await closeSession(repo, view, "complete", at(30));

    expect(outcome.state).toMatchObject({ currentKg: 20, stallCount: 1 });
  });

  it("keeps the session incomplete when the weak side misses (D2.6)", async () => {
    // The weak side goes first and falls short; the other side makes all five.
    const view = await run(prescriptionFor(PRESS, 20), [4, 5, 5, 5, 5, 5]);

    const outcome = await closeSession(repo, view, "complete", at(30));

    expect(outcome.state).toMatchObject({ currentKg: 20, stallCount: 1 });
  });

  it("learns nothing from a session that was walked out of (B5.7)", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));
    view = await logSide(repo, view, 5, at(1));

    const outcome = await closeSession(repo, view, "abandoned", at(5));

    // The press has never been trained, so it is still at its start weight.
    expect(outcome.state).toMatchObject({ currentKg: PRESS.startKg, stallCount: 0 });
  });

  it("closes the session on the way", async () => {
    const view = await run(prescriptionFor(PRESS, 20), [5, 5, 5, 5, 5, 5]);

    await closeSession(repo, view, "complete", at(30));

    await expect(repo.getSession(view.session.id)).resolves.toMatchObject({
      status: "complete",
      finishedAt: at(30).toISOString(),
    });
  });

  it("drops back after three stalls, without being asked (B5.3.1)", async () => {
    for (let i = 0; i < STALLS_BEFORE_DELOAD; i += 1) {
      const view = await run(prescriptionFor(PRESS, 20), [5, 5, 5, 5, 5, 2]);
      const outcome = await closeSession(repo, view, "complete", at(30 + i));
      if (i < STALLS_BEFORE_DELOAD - 1) expect(outcome.deload).toBeNull();
      else {
        expect(outcome.deload).toMatchObject({ fromKg: 20, basis: "fallback" });
        expect(outcome.state.currentKg).toBeLessThan(20);
        expect(outcome.state.stallCount).toBe(0);
      }
    }
  });

  /* -------------------------------------------------- correcting the weight */

  it("records a weight the athlete chose, and progresses from it (INV-7)", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));

    // The rack does not do 20. It does 22.5.
    view = await setWeight(repo, view, 22.5);
    for (const reps of [5, 5, 5, 5, 5, 5]) view = await logSide(repo, view, reps, at(1));
    const outcome = await closeSession(repo, view, "complete", at(30));

    expect(view.session.prescribedKg).toBe(20);
    expect(view.session.actualKg).toBe(22.5);
    // A step above what was lifted, not above what was asked for.
    expect(outcome.state.currentKg).toBe(22.5 + DEFAULT_STEP_KG);
  });

  it("shows the corrected weight on the very next side", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));
    view = await logSide(repo, view, 5, at(1));

    view = await setWeight(repo, view, 22.5);

    expect(view.step?.weightKg).toBe(22.5);
  });

  it("survives a force-quit with the corrected weight (INV-7, D2.5)", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));
    view = await setWeight(repo, view, 22.5);
    view = await logSide(repo, view, 5, at(1));

    const resumed = await loadSession(repo, view.session.id);

    expect(resumed?.session.actualKg).toBe(22.5);
    expect(resumed?.step?.weightKg).toBe(22.5);
  });

  it("logs the side the athlete says they did, not the one offered (D5.5)", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));

    // The weak side is the left and the app offered it; they did the right.
    view = await logSide(repo, view, 5, at(1), "right");

    const sets = await repo.listSets(view.session.id);
    expect(sets[0]).toMatchObject({ ordinal: 0, side: "right" });
    // The next side is still the one the ordinal says, which is now the left.
    expect(view.step?.side).toBe("right");
  });

  it("carries a changed rep target into the rows it writes", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), { repsPerSide: 3 }, at(0));
    view = await logSide(repo, view, 3, at(1));
    view = await logSide(repo, view, 3, at(2));

    const sets = await repo.listSets(view.session.id);
    expect(sets.map((s) => s.targetReps)).toEqual([3, 3]);
  });

  it("counts three of three as clean at whatever target was set", async () => {
    let view = await startSession(repo, prescriptionFor(PRESS, 20), { repsPerSide: 3 }, at(0));
    for (let i = 0; i < 6; i += 1) view = await logSide(repo, view, 3, at(i + 1));

    const outcome = await closeSession(repo, view, "complete", at(30));

    expect(outcome.state.currentKg).toBe(20 + DEFAULT_STEP_KG);
  });

  it("starts at the weight the athlete chose on Today (D5.4)", async () => {
    const view = await startSession(repo, prescriptionFor(PRESS, 20), { actualKg: 25 }, at(0));

    expect(view.session).toMatchObject({ prescribedKg: 20, actualKg: 25 });
    expect(view.step?.weightKg).toBe(25);
  });

  it("refuses a weight that is not a weight", async () => {
    const view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));

    await expect(setWeight(repo, view, 0)).rejects.toThrow(RangeError);
    await expect(setWeight(repo, view, Number.NaN)).rejects.toThrow(RangeError);
  });

  /* ---------------------------------------------------------- loading it */

  it("gives back nothing for a session that does not exist", async () => {
    await expect(loadSession(repo, "no-such-session")).resolves.toBeNull();
  });

  it("gives back nothing for a session whose lift left the rotation", async () => {
    const view = await startSession(repo, prescriptionFor(PRESS, 20), {}, at(0));
    const rotation = await repo.listExercises();
    await repo.saveRotation(rotation.filter((e) => e.id !== "press"));

    await expect(loadSession(repo, view.session.id)).resolves.toBeNull();
  });

  /** Start a session and log every side of it. */
  async function run(prescription: Prescription, reps: readonly number[]): Promise<SessionView> {
    let view = await startSession(repo, prescription, {}, at(0));
    for (const [i, done] of reps.entries()) view = await logSide(repo, view, done, at(i + 1));
    return view;
  }
});
