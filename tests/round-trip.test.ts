/**
 * C4.4 — export, wipe, import, rebuild, and it is all still there.
 *
 * This is the test the design asks for by name (§9.4, §12): the one that runs
 * in CI so that on the day the export is actually needed — a cleared browser, a
 * lost phone, a new laptop — nobody is debugging the restore path while also
 * being upset about it.
 *
 * It runs on the simulated year from B7.3 rather than a hand-made fixture, for
 * the same reason `rebuild.test.ts` does: 355 sessions across five lifts, with
 * deload cycles, a holiday and an abandoned session in them. A two-session
 * fixture round-trips whatever the code does. A year finds the field somebody
 * forgot to carry.
 *
 * The wipe is a database that has never existed, rather than one emptied
 * through the interface under test. That is both the stronger test — restoring
 * into a database you cleared yourself proves less than restoring into one with
 * nothing in it — and the truer picture of when this actually runs: a new
 * phone, a reinstalled browser, a laptop that is not the old laptop (§9.1).
 * Deleting an IndexedDB database is the browser's business and Dexie's; what is
 * being tested here is the file.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createDexieRepo, openDexieRepo } from "../src/db/dexie-repo";
import type { Repo } from "../src/db/repo";
import { LiftLogDb, ensureDefaults } from "../src/db/schema";
import { exportCsv, exportJson, importJson } from "../src/db/transfer";
import type { EngineState } from "../src/engine";
import { simulate } from "./simulation/lifter";

/** One run, shared by every test — the simulation is deterministic. */
const run = simulate();

const EXERCISES = run.lifts.map((lift) => lift.exercise);

/** The cache as the app built it, session by session, over the year. */
const asBuilt: readonly EngineState[] = EXERCISES.map(
  (exercise) => run.finalState.get(exercise.id)!,
);

/** A fixed instant, so two exports of the same data are the same bytes. */
const AT = "2027-01-02T09:00:00.000Z";

const byId = (a: EngineState, b: EngineState) => a.exerciseId.localeCompare(b.exerciseId);

let repo: Repo;
let dbCount = 0;

/** A database name no other test has used. */
function freshName(): string {
  return `lift-log-round-trip-${(dbCount += 1)}`;
}

/**
 * A database holding the whole year.
 *
 * Seeded through Dexie for the reason `rebuild.test.ts` gives — 355 separate
 * `appendSession` calls are 355 transactions, and the seeding took longer than
 * the thing being measured. Everything asserted on goes through `Repo`.
 */
beforeEach(async () => {
  const db = new LiftLogDb(freshName());
  await db.open();
  await ensureDefaults(db);
  await db.session.bulkAdd([...run.sessions]);
  await db.setLog.bulkAdd([...run.sets]);

  repo = createDexieRepo(db);
  await repo.saveRotation(EXERCISES);
  await repo.saveEquipment(run.equipment);
  await repo.putEngineState(asBuilt);
});

/** A database with nothing in it: the far side of the wipe. */
async function wiped(): Promise<Repo> {
  const repo = await openDexieRepo(freshName());
  // Guards the fixture. If this came back with sessions in it, every assertion
  // below would pass without the import having done anything.
  await expect(repo.listSessions()).resolves.toHaveLength(0);
  return repo;
}

describe("export → wipe → import (C4.4)", () => {
  it("puts back a year of training, byte for byte", async () => {
    const backup = await exportJson(repo, AT);

    const after = await wiped();
    const restored = await importJson(after, backup);

    expect(restored.sessions).toBe(run.sessions.length);
    expect(restored.sets).toBe(run.sets.length);
    // The strongest form of the claim available: re-exporting the restored
    // database produces the same file. A field that failed to travel, or
    // travelled and came back in a different order, shows up here.
    expect(await exportJson(after, AT)).toBe(backup);
  });

  it("rebuilds the cache the year actually produced", async () => {
    // The import carries no `engineState` at all (C4.1). These numbers can only
    // come from replaying the restored log through the engine — which is the
    // architectural claim of §7, made over a file that went out to disk and
    // back rather than over a table that never moved.
    const backup = await exportJson(repo, AT);

    const restored = await importJson(await wiped(), backup);

    expect([...restored.state].sort(byId)).toEqual([...asBuilt].sort(byId));
  });

  it("keeps a deleted session deleted across the round trip (INV-3)", async () => {
    const victim = run.sessions[100]!;
    await repo.softDeleteSession(victim.id, AT);
    const backup = await exportJson(repo, AT);

    const after = await wiped();
    await importJson(after, backup);

    // Present in the file, absent from every read, and — the part that would
    // be lost if tombstones did not travel — still absent after a second trip.
    await expect(after.getSession(victim.id)).resolves.toBeUndefined();
    expect((await after.snapshot()).sessions.find((s) => s.id === victim.id)?.deletedAt).toBe(AT);
    expect(await exportJson(after, AT)).toBe(backup);
  });

  it("survives a second round trip unchanged", async () => {
    // Restoring a restore is what actually happens over years: a backup taken
    // from a database that was itself restored. Anything the import normalises
    // silently would drift on each pass and show up here as a difference.
    const first = await exportJson(repo, AT);
    const once = await wiped();
    await importJson(once, first);

    const second = await exportJson(once, AT);
    const twice = await wiped();
    await importJson(twice, second);

    expect(second).toBe(first);
    expect(await exportJson(twice, AT)).toBe(first);
  });

  it("restores the setup, not only the log", async () => {
    const backup = await exportJson(repo, AT);

    const after = await wiped();
    await importJson(after, backup);

    // A fresh database has defaults in these two tables, so a restore that
    // forgot them would leave plausible-looking wrong values rather than gaps.
    expect(await after.listExercises()).toEqual(EXERCISES);
    expect(await after.getEquipment()).toEqual(run.equipment);
  });

  it("writes a spreadsheet of the same year", async () => {
    // Not a round trip — the CSV is one-way (C4.2) — but it runs over the year
    // here so that a file nobody parses is at least known to be produced, and
    // to hold one row per live set.
    const live = run.sessions.filter((s) => s.deletedAt === null).map((s) => s.id);
    const csv = await exportCsv(repo);
    const lines = csv.split("\r\n").filter((line) => line !== "");

    expect(lines).toHaveLength(1 + run.sets.filter((s) => live.includes(s.sessionId)).length);
  });
});
