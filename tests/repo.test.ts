/**
 * C2.2 and C2.4 — the Dexie repository does what the interface promises.
 *
 * These tests are written against `Repo`, not against `DexieRepo`, and they
 * never touch a Dexie table except in the two places that check a tombstone is
 * still on disk after a delete. That is deliberate: when the native SQLite
 * implementation arrives (Part J) this file should be the suite it has to pass,
 * with the type annotation being the only thing that changes.
 *
 * `fake-indexeddb` provides the database (see vitest.config.ts) — the real
 * IndexedDB algorithm in memory, so what passes here works in Chrome.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createDexieRepo, openDexieRepo } from "../src/db/dexie-repo";
import type { Repo } from "../src/db/repo";
import { DEFAULT_EQUIPMENT, DEFAULT_SETTINGS, LiftLogDb } from "../src/db/schema";
import type { EngineState, Exercise, Session, SetLog } from "../src/engine";

/* ------------------------------------------------------------- fixtures */

const ROTATION: readonly Exercise[] = [
  // `startKg` and `weakSide` are onboarding's answers and ride on the exercise
  // row, because the cache they used to live in gets dropped by replay (C3.0).
  { id: "split-squat", name: "Bulgarian Split Squat", pattern: "squat", videoQuery: "split squat", startKg: 30, weakSide: "left" },
  { id: "press", name: "Single-Arm Shoulder Press", pattern: "vertical push", videoQuery: "press", startKg: 17.5, weakSide: "left" },
  { id: "deadlift", name: "Single-Leg Deadlift", pattern: "hip hinge", videoQuery: "sldl", startKg: 32.5, weakSide: "right" },
];

/** A session as the app writes it at Start: planned, nothing logged yet. */
function session(over: Partial<Session> = {}): Session {
  const trainingDay = over.trainingDay ?? "2026-08-20";
  return {
    id: "s1",
    exerciseId: "press",
    startedAt: `${trainingDay}T08:00:00.000Z`,
    finishedAt: null,
    trainingDay,
    prescribedKg: 20,
    actualKg: 20,
    status: "planned",
    note: null,
    deletedAt: null,
    ...over,
  };
}

/** Both sides of one set, in the order the session screen writes them. */
function setsFor(sessionId: string, ordinals: readonly number[]): SetLog[] {
  return ordinals.map((ordinal) => ({
    id: `${sessionId}-${ordinal}`,
    sessionId,
    ordinal,
    side: ordinal % 2 === 0 ? "left" : "right",
    targetReps: 5,
    doneReps: 5,
    loggedAt: "2026-08-20T08:10:00.000Z",
  }));
}

const AT = "2026-08-20T09:00:00.000Z";

let repo: Repo;
let db: LiftLogDb;
let dbCount = 0;

beforeEach(async () => {
  // A database per test, under a name no other test uses.
  //
  // The tempting alternative — assigning a fresh `IDBFactory` to
  // `globalThis.indexedDB` — silently does nothing: Dexie reads the global once,
  // when the module is imported, and holds on to it. Every test would keep
  // sharing the first factory, and each one would start with the previous
  // test's sessions still in the log.
  const name = `lift-log-test-${(dbCount += 1)}`;
  db = new LiftLogDb(name);
  repo = await openDexieRepo(name);
});

/* ---------------------------------------------------------------- setup */

describe("the setup", () => {
  it("hands back the seeded settings and equipment", async () => {
    await expect(repo.getSettings()).resolves.toEqual({
      units: DEFAULT_SETTINGS.units,
      restTargetS: DEFAULT_SETTINGS.restTargetS,
      stallThreshold: DEFAULT_SETTINGS.stallThreshold,
      lastExportedAt: DEFAULT_SETTINGS.lastExportedAt,
      lastNudgedAt: DEFAULT_SETTINGS.lastNudgedAt,
      schemaVersion: DEFAULT_SETTINGS.schemaVersion,
    });
    await expect(repo.getEquipment()).resolves.toEqual({ stepKg: DEFAULT_EQUIPMENT.stepKg });
  });

  it("does not leak the singleton key", async () => {
    expect(await repo.getSettings()).not.toHaveProperty("id");
    expect(await repo.getEquipment()).not.toHaveProperty("id");
  });

  it("merges a settings patch and leaves the rest alone", async () => {
    const saved = await repo.saveSettings({ units: "lb" });

    expect(saved.units).toBe("lb");
    expect(saved.restTargetS).toBe(DEFAULT_SETTINGS.restTargetS);
    await expect(repo.getSettings()).resolves.toEqual(saved);
    await expect(db.settings.count()).resolves.toBe(1);
  });

  it("saves equipment without adding a second row", async () => {
    await repo.saveEquipment({ stepKg: 2.5 });

    await expect(repo.getEquipment()).resolves.toEqual({ stepKg: 2.5 });
    await expect(db.equipment.count()).resolves.toBe(1);
  });

  it("keeps the rotation in the order it was given", async () => {
    await repo.saveRotation(ROTATION);

    await expect(repo.listExercises()).resolves.toEqual(ROTATION);
  });

  it("stores no rotation position on the exercise itself", async () => {
    await repo.saveRotation(ROTATION);

    const [first] = await repo.listExercises();
    expect(first).not.toHaveProperty("order");
  });

  it("replaces the rotation rather than merging into it", async () => {
    await repo.saveRotation(ROTATION);
    const reordered = [ROTATION[2]!, ROTATION[0]!];

    await repo.saveRotation(reordered);

    await expect(repo.listExercises()).resolves.toEqual(reordered);
  });
});

/* ------------------------------------------------------------------ log */

describe("the log", () => {
  it("reads back a session and its sets in ordinal order", async () => {
    await repo.appendSession(session());
    await repo.appendSets(setsFor("s1", [2, 3]));
    await repo.appendSets(setsFor("s1", [0, 1]));

    const sets = await repo.listSets("s1");
    expect(sets.map((s) => s.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it("refuses to overwrite a fact", async () => {
    await repo.appendSession(session());

    await expect(repo.appendSession(session({ prescribedKg: 99 }))).rejects.toThrow();
    await expect(repo.getSession("s1")).resolves.toMatchObject({ prescribedKg: 20 });
  });

  it("returns sessions oldest first, whatever order they were written in", async () => {
    await repo.appendSession(session({ id: "c", trainingDay: "2026-08-22" }));
    await repo.appendSession(session({ id: "a", trainingDay: "2026-08-20" }));
    await repo.appendSession(session({ id: "b", trainingDay: "2026-08-21" }));

    const sessions = await repo.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by exercise, by day range, and by both at once", async () => {
    await repo.appendSession(session({ id: "a", exerciseId: "press", trainingDay: "2026-08-20" }));
    await repo.appendSession(session({ id: "b", exerciseId: "row", trainingDay: "2026-08-21" }));
    await repo.appendSession(session({ id: "c", exerciseId: "press", trainingDay: "2026-08-22" }));

    const press = await repo.listSessions({ exerciseId: "press" });
    expect(press.map((s) => s.id)).toEqual(["a", "c"]);

    const week = await repo.listSessions({ from: "2026-08-21", to: "2026-08-22" });
    expect(week.map((s) => s.id)).toEqual(["b", "c"]);

    const both = await repo.listSessions({ exerciseId: "press", from: "2026-08-21" });
    expect(both.map((s) => s.id)).toEqual(["c"]);
  });

  it("treats a day range as inclusive at both ends", async () => {
    await repo.appendSession(session({ id: "a", trainingDay: "2026-08-20" }));
    await repo.appendSession(session({ id: "b", trainingDay: "2026-08-21" }));

    const both = await repo.listSessions({ from: "2026-08-20", to: "2026-08-21" });
    expect(both.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("limits to the most recent N, still oldest first", async () => {
    await repo.appendSession(session({ id: "a", trainingDay: "2026-08-20" }));
    await repo.appendSession(session({ id: "b", trainingDay: "2026-08-21" }));
    await repo.appendSession(session({ id: "c", trainingDay: "2026-08-22" }));

    const recent = await repo.listSessions({ limit: 2 });
    expect(recent.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("pairs every session with its own sets", async () => {
    await repo.appendSession(session({ id: "a", trainingDay: "2026-08-20" }));
    await repo.appendSession(session({ id: "b", trainingDay: "2026-08-21" }));
    await repo.appendSets(setsFor("a", [0, 1]));
    await repo.appendSets(setsFor("b", [0]));

    const log = await repo.readLog();
    expect(log.map((entry) => [entry.session.id, entry.sets.length])).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });

  it("returns a session with no sets rather than dropping it", async () => {
    await repo.appendSession(session());

    const log = await repo.readLog();
    expect(log).toEqual([{ session: await repo.getSession("s1"), sets: [] }]);
  });

  it("pairs them correctly for a log too long to seek through", async () => {
    // Past a threshold the implementation stops seeking to each session's sets
    // and reads the table instead (see `setsOf`). Same answer either way, and
    // this is the only test on the far side of it.
    const count = 40;
    for (let i = 0; i < count; i += 1) {
      const id = `x${String(i).padStart(2, "0")}`;
      await repo.appendSession(session({ id, trainingDay: `2026-09-${String(i + 1).padStart(2, "0")}` }));
      await repo.appendSets(setsFor(id, i % 2 === 0 ? [0, 1] : [0]));
    }
    await repo.softDeleteSession("x00", AT);

    const log = await repo.readLog();

    expect(log).toHaveLength(count - 1);
    expect(log.every((entry) => entry.sets.every((set) => set.sessionId === entry.session.id)))
      .toBe(true);
    expect(log.map((entry) => entry.sets.length)).toEqual(
      Array.from({ length: count - 1 }, (_, i) => ((i + 1) % 2 === 0 ? 2 : 1)),
    );
    // The tombstoned session's sets are not in anyone else's bucket either.
    expect(log.some((entry) => entry.session.id === "x00")).toBe(false);
  });
});

/* ------------------------------------------------- closing out a session */

describe("closing a session", () => {
  it("records the weight that was actually lifted", async () => {
    await repo.appendSession(session());

    await repo.setActualKg("s1", 22.5);

    await expect(repo.getSession("s1")).resolves.toMatchObject({
      prescribedKg: 20,
      actualKg: 22.5,
    });
  });

  it("writes the status and the finish time", async () => {
    await repo.appendSession(session());

    await repo.finishSession("s1", { status: "complete", finishedAt: AT });

    await expect(repo.getSession("s1")).resolves.toMatchObject({
      status: "complete",
      finishedAt: AT,
    });
  });

  it("leaves the note alone unless one is given", async () => {
    await repo.appendSession(session({ note: "left shoulder grumbling" }));

    await repo.finishSession("s1", { status: "abandoned", finishedAt: AT });

    await expect(repo.getSession("s1")).resolves.toMatchObject({
      note: "left shoulder grumbling",
    });
  });

  it("throws rather than quietly updating nothing", async () => {
    await expect(
      repo.finishSession("nope", { status: "complete", finishedAt: AT }),
    ).rejects.toThrow(/does not exist/);
    await expect(repo.setActualKg("nope", 25)).rejects.toThrow(/does not exist/);
  });

  it("resumes the session that was walked away from", async () => {
    await repo.appendSession(session({ id: "done", trainingDay: "2026-08-20" }));
    await repo.finishSession("done", { status: "complete", finishedAt: AT });
    await repo.appendSession(session({ id: "open", trainingDay: "2026-08-21" }));

    await expect(repo.getActiveSession()).resolves.toMatchObject({ id: "open" });
  });

  it("has no active session when everything is closed", async () => {
    await repo.appendSession(session());
    await repo.finishSession("s1", { status: "abandoned", finishedAt: AT });

    await expect(repo.getActiveSession()).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------ tombstones, C2.4 */

describe("soft delete (INV-3, C2.4)", () => {
  beforeEach(async () => {
    await repo.appendSession(session({ id: "keep", trainingDay: "2026-08-20" }));
    await repo.appendSession(session({ id: "gone", trainingDay: "2026-08-21" }));
    await repo.appendSets(setsFor("gone", [0, 1]));
    await repo.softDeleteSession("gone", AT);
  });

  it("keeps the row and the sets on disk", async () => {
    await expect(db.session.get("gone")).resolves.toMatchObject({ deletedAt: AT });
    await expect(db.setLog.where("sessionId").equals("gone").count()).resolves.toBe(2);
  });

  it("hides it from every read", async () => {
    await expect(repo.getSession("gone")).resolves.toBeUndefined();
    await expect(repo.listSets("gone")).resolves.toEqual([]);

    const sessions = await repo.listSessions();
    expect(sessions.map((s) => s.id)).toEqual(["keep"]);

    const log = await repo.readLog();
    expect(log.map((entry) => entry.session.id)).toEqual(["keep"]);
  });

  it("hides it from a filtered read as well", async () => {
    const press = await repo.listSessions({ exerciseId: "press", from: "2026-08-20" });
    expect(press.map((s) => s.id)).toEqual(["keep"]);
  });

  it("never counts as the session to resume", async () => {
    await expect(repo.getActiveSession()).resolves.toMatchObject({ id: "keep" });
  });

  it("refuses to be written to afterwards", async () => {
    await expect(repo.setActualKg("gone", 25)).rejects.toThrow(/was deleted/);
    await expect(
      repo.finishSession("gone", { status: "complete", finishedAt: AT }),
    ).rejects.toThrow(/was deleted/);
  });

  it("keeps the first timestamp when deleted twice", async () => {
    await repo.softDeleteSession("gone", "2026-09-01T00:00:00.000Z");

    await expect(db.session.get("gone")).resolves.toMatchObject({ deletedAt: AT });
  });

  it("throws when the session does not exist", async () => {
    await expect(repo.softDeleteSession("nope", AT)).rejects.toThrow(/does not exist/);
  });
});

/* ---------------------------------------------------------- engine state */

describe("the engine cache", () => {
  const state = (exerciseId: string, currentKg: number): EngineState => ({
    exerciseId,
    currentKg,
    stallCount: 0,
  });

  it("writes, reads back and overwrites by exercise", async () => {
    await repo.putEngineState([state("press", 20), state("row", 30)]);
    await repo.putEngineState([state("press", 21)]);

    await expect(repo.getEngineState("press")).resolves.toMatchObject({ currentKg: 21 });
    await expect(repo.listEngineState()).resolves.toHaveLength(2);
  });

  it("is droppable — it is a cache, not a fact (INV-2)", async () => {
    await repo.putEngineState([state("press", 20)]);

    await repo.clearEngineState();

    await expect(repo.listEngineState()).resolves.toEqual([]);
    await expect(repo.getEngineState("press")).resolves.toBeUndefined();
  });
});

/* ----------------------------------------------------------- the factory */

describe("createDexieRepo", () => {
  it("wraps a database that is already open", async () => {
    const wrapped = createDexieRepo(db);

    await wrapped.appendSession(session());

    await expect(repo.getSession("s1")).resolves.toBeDefined();
  });

  it("says which call seeds the setup when a row is missing", async () => {
    await db.open();
    await db.settings.clear();

    await expect(createDexieRepo(db).getSettings()).rejects.toThrow(/openDexieRepo/);
  });
});
