/**
 * E3 — a session done away from the phone.
 *
 * The claim under test is E3.2: a backfilled session goes through the same
 * engine path as a live one. "Same path" here means replay — the log folded
 * from the beginning by `applyOutcome` — and not the incremental fold
 * `closeSession` uses, because a live session is always the newest thing in the
 * log and a backfill usually is not. The tests that matter below are the two
 * that insert a session *into the middle* of a log and check that everything
 * standing on top of it was worked out again.
 *
 * `fake-indexeddb` provides the database (see vitest.config.ts).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { openDexieRepo } from "../src/db/dexie-repo";
import type { Repo } from "../src/db/repo";
import type { Exercise, Prescription } from "../src/engine";
import { SESSION_SCHEME } from "../src/engine";
import { loadDetail, loadHistory } from "../src/history";
import { loadProgress } from "../src/progress";
import type { Backfill } from "../src/session";
import {
  BACKFILL_NOTE,
  backfillSession,
  closeSession,
  logSide,
  startSession,
} from "../src/session";

const TODAY = "2026-08-24";

/** A backfill of one clean lift, with everything overridable. */
function draftOf(over: Partial<Backfill> = {}): Backfill {
  return {
    exerciseId: "split-squat",
    trainingDay: "2026-08-10",
    weightKg: 20,
    targetReps: 5,
    sets: [
      [5, 5],
      [5, 5],
      [5, 5],
    ],
    ...over,
  };
}

describe("backfilling a session", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`lift-log-backfill-${(dbCount += 1)}`);
  });

  const at = (day: number, minute = 0) => new Date(Date.UTC(2026, 7, day, 8, minute));

  /** A prescription for one named lift, so the rotation pointer cannot pick. */
  async function prescriptionFor(id: string, weightKg: number): Promise<Prescription> {
    const exercise = (await repo.listExercises()).find((e) => e.id === id) as Exercise;
    return {
      exercise,
      weightKg,
      repsPerSide: SESSION_SCHEME.repsPerSide,
      sets: SESSION_SCHEME.sets,
      restMinutes: SESSION_SCHEME.restMinutes,
      weakSide: exercise.weakSide,
    };
  }

  /** Train one named lift live, all the way to a closed session. */
  async function live(id: string, weightKg: number, reps: readonly number[], day: number) {
    const rx = await prescriptionFor(id, weightKg);
    let view = await startSession(repo, rx, { actualKg: weightKg }, at(day));
    for (const [i, done] of reps.entries()) view = await logSide(repo, view, done, at(day, i + 1));
    await closeSession(repo, view, "complete", at(day, 40));
    return view;
  }

  /* --------------------------------------------------- the rows it writes */

  it("writes the same rows a live session writes", async () => {
    const id = await backfillSession(repo, draftOf(), at(24));

    const sessions = await repo.listSessions();
    const sets = await repo.listSets(id);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id,
      exerciseId: "split-squat",
      trainingDay: "2026-08-10",
      status: "complete",
      // Nobody prescribed this session, so there is nothing for the weight to
      // differ from — a phantom override would show on the detail screen.
      prescribedKg: 20,
      actualKg: 20,
      note: BACKFILL_NOTE,
      deletedAt: null,
    });
    expect(sets).toHaveLength(6);
    expect(sets.map((set) => set.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sets.every((set) => set.targetReps === 5 && set.doneReps === 5)).toBe(true);
  });

  it("writes the weak side first, all the way down", async () => {
    // D2.4, and the same `sideAt` the runner uses. The default rotation's split
    // squat has the left as its weak side.
    const id = await backfillSession(repo, draftOf(), at(24));

    expect((await repo.listSets(id)).map((set) => set.side)).toEqual([
      "left", "right", "left", "right", "left", "right",
    ]);
  });

  it("follows the weak side when it has been flipped", async () => {
    const rotation = await repo.listExercises();
    await repo.saveRotation(
      rotation.map((e) => (e.id === "split-squat" ? { ...e, weakSide: "right" as const } : e)),
    );

    const id = await backfillSession(repo, draftOf(), at(24));

    expect((await repo.listSets(id)).map((set) => set.side).slice(0, 2)).toEqual(["right", "left"]);
  });

  it("carries a session that was cut short as the reps it actually did", async () => {
    // There is no "abandoned" on this form and there does not need to be: what
    // the engine reads is the rep count (INV-4).
    const id = await backfillSession(repo, draftOf({ sets: [[5, 5], [5, 2]] }), at(24));

    const detail = await loadDetail(repo, id);
    expect(detail?.outcome).toBe("short");
    expect(detail?.reps).toBe(17);
    expect(detail?.targetReps).toBe(20);
  });

  it("records no duration, because it does not know one", async () => {
    // `startedAt === finishedAt` is what tells the detail screen not to print a
    // start time for a session that was typed in rather than trained.
    const id = await backfillSession(repo, draftOf(), at(24));
    const session = await repo.getSession(id);

    expect(session?.startedAt).toBe(session?.finishedAt);
  });

  /* --------------------------------------------- the same engine path (E3.2) */

  it("moves the weight exactly as a live clean session would", async () => {
    await backfillSession(repo, draftOf({ weightKg: 20 }), at(24));

    const state = await repo.getEngineState("split-squat");
    expect(state?.currentKg).toBe(21);
  });

  it("teaches the engine nothing when the reps were short", async () => {
    await backfillSession(repo, draftOf({ sets: [[5, 5], [5, 5], [5, 4]] }), at(24));

    const state = await repo.getEngineState("split-squat");
    expect(state).toMatchObject({ currentKg: 20, stallCount: 1 });
  });

  it("replays the whole log when the session lands in the middle of it", async () => {
    // The reason this rebuilds rather than folding one session in. Two clean
    // sessions have taken the lift to 22; dropping a third in between them
    // means everything after it was standing on a different weight.
    await live("split-squat", 20, [5, 5, 5, 5, 5, 5], 5);
    await live("split-squat", 21, [5, 5, 5, 5, 5, 5], 7);
    expect((await repo.getEngineState("split-squat"))?.currentKg).toBe(22);

    await backfillSession(repo, draftOf({ trainingDay: "2026-08-06", weightKg: 30 }), at(24));

    // Three clean sessions, the last of them at 21 kg by training day, so the
    // weight is a step above that — not a step above the 30 that was inserted.
    const log = await repo.readLog({ exerciseId: "split-squat" });
    expect(log.map((entry) => entry.session.actualKg)).toEqual([20, 30, 21]);
    expect((await repo.getEngineState("split-squat"))?.currentKg).toBe(22);
  });

  it("undoes a stall that a forgotten session turns out to explain", async () => {
    // The case backfill exists for. A short session put the lift on a stall;
    // remembering the clean one that came after it clears the stall, and only a
    // replay can see that.
    await live("split-squat", 20, [5, 5, 5, 5, 5, 3], 5);
    expect((await repo.getEngineState("split-squat"))?.stallCount).toBe(1);

    await backfillSession(repo, draftOf({ trainingDay: "2026-08-06" }), at(24));

    expect(await repo.getEngineState("split-squat")).toMatchObject({
      currentKg: 21,
      stallCount: 0,
    });
  });

  it("leaves the other lifts alone", async () => {
    // The replay touches every lift's row, so "alone" means the row comes back
    // saying what the log for that lift says — which is nothing.
    await live("press", 40, [5, 5, 5, 5, 5, 5], 5);
    const press = (await repo.listExercises()).find((e) => e.id === "press")!;

    await backfillSession(repo, draftOf(), at(24));

    expect(await repo.getEngineState("press")).toMatchObject({ currentKg: 41 });
    expect(await repo.getEngineState("deadlift")).toMatchObject({ currentKg: press.startKg });
  });

  /* -------------------------------------------------- and it shows up (E3) */

  it("fills the square, the row and the chart at once", async () => {
    const id = await backfillSession(repo, draftOf({ trainingDay: "2026-08-10" }), at(24));

    const { heat, log } = await loadHistory(repo, TODAY);
    const progress = await loadProgress(repo, "split-squat");
    const square = heat.weeks.flat().find((cell) => cell?.day === "2026-08-10");

    expect(square?.outcome).toBe("clean");
    expect(log.map((row) => row.id)).toEqual([id]);
    expect(progress.points.map((point) => point.trainingDay)).toEqual(["2026-08-10"]);
  });

  /* --------------------------------------------------------- what it refuses */

  it("refuses a day that is not a day", async () => {
    await expect(backfillSession(repo, draftOf({ trainingDay: "last Tuesday" }))).rejects.toThrow(
      /YYYY-MM-DD/,
    );
  });

  it("refuses a weight of nothing", async () => {
    await expect(backfillSession(repo, draftOf({ weightKg: 0 }))).rejects.toThrow(/above zero/);
  });

  it("refuses a session with no sides in it", async () => {
    await expect(backfillSession(repo, draftOf({ sets: [] }))).rejects.toThrow(/not a session/);
    await expect(backfillSession(repo, draftOf({ sets: [[]] }))).rejects.toThrow(/not a session/);
  });

  it("refuses half a rep", async () => {
    await expect(backfillSession(repo, draftOf({ sets: [[5, 2.5]] }))).rejects.toThrow(/whole/);
  });

  it("refuses a lift that is not in the rotation", async () => {
    await expect(backfillSession(repo, draftOf({ exerciseId: "front-squat" }))).rejects.toThrow(
      /rotation/,
    );
  });

  it("writes nothing at all when it refuses", async () => {
    await expect(backfillSession(repo, draftOf({ weightKg: -1 }))).rejects.toThrow();

    expect(await repo.listSessions()).toEqual([]);
  });
});
