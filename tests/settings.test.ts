/**
 * Settings (G3).
 *
 * Only one thing on this screen has behaviour worth testing, and it is the one
 * that looks dangerous until you read `applyOutcome`: changing the step.
 *
 * The step is not stored on a session. `rebuildState` folds the whole log
 * against whatever `equipment.stepKg` says *now* (C3), so changing it and not
 * rebuilding leaves a cache that replay would disagree with — and INV-2 makes
 * replay the truth, so the disagreement would surface later, silently, on the
 * next import or migration.
 *
 * The reason that is safe rather than alarming is the shape of the fold. A
 * clean session sets `currentKg` to *that session's* `actualKg` plus one step —
 * not to a running total of every step ever added — so re-folding with a new
 * step moves the next prescription by the difference and leaves the history
 * that produced it alone. These tests are that claim, written down.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { openDexieRepo } from "../src/db/dexie-repo";
import { rebuildState } from "../src/db";
import type { Repo } from "../src/db";
import type { Exercise, Session, SetLog } from "../src/engine";

const ROTATION: readonly Exercise[] = [
  { id: "press", name: "Press", pattern: "vertical push", videoQuery: "press", startKg: 20, weakSide: "left" },
  { id: "row", name: "Row", pattern: "horizontal pull", videoQuery: "row", startKg: 20, weakSide: "left" },
];

/** A finished session at `actualKg`, with every side at `doneReps`. */
function logged(
  id: string,
  exerciseId: string,
  day: string,
  actualKg: number,
  doneReps: number,
): { session: Session; sets: SetLog[] } {
  return {
    session: {
      id,
      exerciseId,
      startedAt: `${day}T08:00:00.000Z`,
      finishedAt: `${day}T08:30:00.000Z`,
      trainingDay: day,
      prescribedKg: actualKg,
      actualKg,
      status: "complete",
      note: null,
      deletedAt: null,
    },
    sets: Array.from({ length: 6 }, (_, ordinal) => ({
      id: `${id}-${ordinal}`,
      sessionId: id,
      ordinal,
      side: ordinal % 2 === 0 ? ("left" as const) : ("right" as const),
      targetReps: 5,
      doneReps,
      loggedAt: `${day}T08:${String(2 + ordinal * 4).padStart(2, "0")}:00.000Z`,
    })),
  };
}

describe("changing the step (G3.1)", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`settings-test-${(dbCount += 1)}`);
    await repo.saveRotation(ROTATION);
    await repo.saveEquipment({ stepKg: 1 });

    // The press was clean at 40; the row was a rep short at 40.
    const clean = logged("a", "press", "2026-08-20", 40, 5);
    const short = logged("b", "row", "2026-08-21", 40, 4);
    for (const { session, sets } of [clean, short]) {
      await repo.appendSession(session);
      await repo.appendSets(sets);
    }
    await rebuildState(repo);
  });

  const currentKg = async (id: string) => (await repo.getEngineState(id))?.currentKg;

  it("starts where the old step left it", async () => {
    expect(await currentKg("press")).toBe(41);
    expect(await currentKg("row")).toBe(40);
  });

  it("moves the next weight by the new step, not by the whole history", async () => {
    await repo.saveEquipment({ stepKg: 2.5 });
    await rebuildState(repo);
    // 40 was lifted and 40 is still what was lifted. Only the increment moved.
    expect(await currentKg("press")).toBe(42.5);
  });

  it("leaves a lift alone when its last session was short", async () => {
    // A stall sets `currentKg` to what was actually lifted, and no step is
    // involved — so there is nothing for a new step to change.
    await repo.saveEquipment({ stepKg: 2.5 });
    await rebuildState(repo);
    expect(await currentKg("row")).toBe(40);
  });

  it("goes back exactly when the step goes back", async () => {
    await repo.saveEquipment({ stepKg: 5 });
    await rebuildState(repo);
    expect(await currentKg("press")).toBe(45);

    await repo.saveEquipment({ stepKg: 1 });
    await rebuildState(repo);
    expect(await currentKg("press")).toBe(41);
  });

  it("does not drift on a step that cannot be written in binary", async () => {
    await repo.saveEquipment({ stepKg: 1.25 });
    await rebuildState(repo);
    expect(await currentKg("press")).toBe(41.25);
  });

  it("writes no facts — the log is the same log afterwards", async () => {
    const before = await repo.listSessions();
    await repo.saveEquipment({ stepKg: 2.5 });
    await rebuildState(repo);
    expect(await repo.listSessions()).toEqual(before);
  });

  it("would disagree with replay if the rebuild were skipped", async () => {
    // The reason `setStep` rebuilds at all. Without it the cache still says 41
    // while replay says 42.5, and INV-2 makes replay the one that is right.
    await repo.saveEquipment({ stepKg: 2.5 });
    expect(await currentKg("press")).toBe(41);
    const replayed = await rebuildState(repo);
    expect(replayed.find((s) => s.exerciseId === "press")!.currentKg).toBe(42.5);
  });
});
