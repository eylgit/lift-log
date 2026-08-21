/**
 * C3.3 — the architectural test.
 *
 * `lift-log-design.md` §7 states it plainly: *if you can delete a table and
 * rebuild it exactly from the log, the architecture is honest.* This file is
 * that sentence, executed.
 *
 * The log it runs on is the simulated year from B7.3 — 355 sessions across
 * five lifts, with several deload cycles, a ten-day holiday and one abandoned
 * session. It is used here for a reason beyond size. The simulation builds its
 * engine state the way the app will: one session at a time, folding each
 * outcome in as it happens. So the state it ends the year with is an
 * *incrementally* maintained cache, and `rebuildState()` derives the same
 * numbers in one pass from the facts alone. The test is that those two agree.
 *
 * They can disagree in exactly one way — the log stops being the whole truth,
 * because something crept into the cache that no session put there. That is
 * the failure this file exists to catch, and it is the failure C3.0 had to fix
 * before the test could be written at all.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createDexieRepo } from "../src/db/dexie-repo";
import { rebuildState } from "../src/db/replay";
import type { Repo } from "../src/db/repo";
import { LiftLogDb, ensureDefaults } from "../src/db/schema";
import type { EngineState } from "../src/engine";
import { simulate } from "./simulation/lifter";

/** One run, shared by every test — the simulation is deterministic. */
const run = simulate();

const EXERCISES = run.lifts.map((lift) => lift.exercise);

/** The cache as the app would have built it: session by session, over a year. */
const asBuilt: readonly EngineState[] = EXERCISES.map(
  (exercise) => run.finalState.get(exercise.id)!,
);

let repo: Repo;
let dbCount = 0;

/**
 * A fresh database holding the whole year, per test.
 *
 * The sessions go in through Dexie rather than through `appendSession`, which
 * is the one place this file reaches past the repository interface. It is a
 * fixture concern, not a shortcut around what is being tested: 355 separate
 * `add` calls are 355 separate IndexedDB transactions, and seeding took longer
 * than the rebuild it exists to measure. Everything the tests actually assert
 * on still goes through `Repo`.
 */
beforeEach(async () => {
  const db = new LiftLogDb(`lift-log-rebuild-${(dbCount += 1)}`);
  await db.open();
  await ensureDefaults(db);
  await db.session.bulkAdd([...run.sessions]);
  await db.setLog.bulkAdd([...run.sets]);

  repo = createDexieRepo(db);
  await repo.saveRotation(EXERCISES);
  await repo.saveEquipment(run.equipment);
  await repo.putEngineState(asBuilt);
});

const byId = (a: EngineState, b: EngineState) => a.exerciseId.localeCompare(b.exerciseId);

/** listEngineState in rotation order, so two snapshots compare directly. */
async function snapshot(): Promise<readonly EngineState[]> {
  const states = await repo.listEngineState();
  const byId = new Map(states.map((state) => [state.exerciseId, state]));
  return EXERCISES.map((exercise) => byId.get(exercise.id)!).filter(Boolean);
}

describe("drop the table and rebuild it", () => {
  it("reproduces the cache exactly", async () => {
    const before = await snapshot();
    expect(before).toEqual(asBuilt);

    await repo.clearEngineState();
    await expect(repo.listEngineState()).resolves.toEqual([]);
    await rebuildState(repo);

    expect(await snapshot()).toEqual(before);
  });

  it("reproduces it from the log alone, whatever the cache said", async () => {
    // Not merely idempotent: the rebuild must not be reading the rows it is
    // about to replace. Poison every one of them and the answer is the same.
    await repo.putEngineState(
      EXERCISES.map((exercise) => ({
        exerciseId: exercise.id,
        currentKg: 999,
        stallCount: 99,
      })),
    );

    await rebuildState(repo);

    expect(await snapshot()).toEqual(asBuilt);
  });

  it("gives the same answer twice", async () => {
    await rebuildState(repo);
    const once = await snapshot();
    await rebuildState(repo);

    expect(await snapshot()).toEqual(once);
  });

  it("returns what it wrote", async () => {
    const returned = await rebuildState(repo);
    const stored = await repo.listEngineState();

    // Compared by id, not by position: `listEngineState` promises no order,
    // and the rebuild hands its states back in rotation order.
    expect([...stored].sort(byId)).toEqual([...returned].sort(byId));
  });

  it("survives the year having ended on an abandoned session", async () => {
    // The simulation abandons one session on purpose (B5.7). A replay that
    // treated it as a stall, or as clean, would land somewhere else.
    const abandoned = run.sessions.filter((s) => s.status === "abandoned");
    expect(abandoned).toHaveLength(1);

    await rebuildState(repo);

    expect(await snapshot()).toEqual(asBuilt);
  });
});

describe("what the rebuild is reading", () => {
  it("moves when a session is deleted, because it reads the log", async () => {
    // The other half of the claim. If the numbers came back identical after a
    // fact was removed, the rebuild would be copying something rather than
    // deriving it. INV-3: the tombstoned session stops counting.
    const press = EXERCISES[1]!;
    const last = [...run.sessions].reverse().find((s) => s.exerciseId === press.id)!;
    await repo.softDeleteSession(last.id, "2027-01-01T00:00:00.000Z");

    await rebuildState(repo);

    const after = await repo.getEngineState(press.id);
    expect(after).not.toEqual(run.finalState.get(press.id));
  });

  it("touches only the lift whose session was deleted", async () => {
    const press = EXERCISES[1]!;
    const last = [...run.sessions].reverse().find((s) => s.exerciseId === press.id)!;
    await repo.softDeleteSession(last.id, "2027-01-01T00:00:00.000Z");

    await rebuildState(repo);

    for (const exercise of EXERCISES) {
      if (exercise.id === press.id) continue;
      await expect(repo.getEngineState(exercise.id)).resolves.toEqual(
        run.finalState.get(exercise.id),
      );
    }
  });

  it("holds a year of sessions and rebuilds from all of them", async () => {
    // Guards the fixture rather than the code: a rebuild that agreed with the
    // cache because the log was empty would prove nothing.
    await expect(repo.listSessions()).resolves.toHaveLength(run.sessions.length);
    expect(run.sessions.length).toBeGreaterThan(300);
    expect(run.deloads.length).toBeGreaterThan(0);
  });
});
