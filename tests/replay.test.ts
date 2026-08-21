/**
 * C3.1 — `rebuildState()` puts the cache back from the log.
 *
 * These are the mechanics: the seed, the fold, and the four cases where the
 * log holds something a naive fold would choke on. The headline test — take a
 * snapshot, drop the table, rebuild, assert identical — is C3.3, in
 * `rebuild.test.ts`, and it is the one that proves the architecture rather
 * than the function.
 *
 * Written against `Repo` for the same reason `repo.test.ts` is: the day a
 * SQLite implementation arrives, this suite should pass unchanged.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createDexieRepo, openDexieRepo } from "../src/db/dexie-repo";
import { rebuildIfMigrated, rebuildState } from "../src/db/replay";
import type { Repo } from "../src/db/repo";
import { LiftLogDb, SCHEMA_VERSION } from "../src/db/schema";
import type { Exercise, Session, SetLog } from "../src/engine";
import { STALLS_BEFORE_DELOAD } from "../src/engine";

/* ------------------------------------------------------------- fixtures */

const PRESS: Exercise = {
  id: "press",
  name: "Single-Arm Shoulder Press",
  pattern: "vertical push",
  videoQuery: "press",
  startKg: 17.5,
  weakSide: "left",
};

const ROW: Exercise = {
  id: "row",
  name: "Single-Arm Row",
  pattern: "horizontal pull",
  videoQuery: "row",
  startKg: 27.5,
  weakSide: "right",
};

const STEP = 2.5;

/** Day n of the log. Sequential so the replay order is never in doubt. */
function dayOf(n: number): string {
  return `2026-0${1 + Math.floor(n / 28)}-${String((n % 28) + 1).padStart(2, "0")}`;
}

type Logged = { readonly session: Session; readonly sets: readonly SetLog[] };

/**
 * One finished session, all three sets, both sides.
 *
 * `doneReps` below five on any set is what makes it a stall — the engine has
 * no tolerance, so one short rep anywhere is the whole difference (B5).
 */
function logged(
  n: number,
  over: Partial<Session> & { readonly doneReps?: number } = {},
): Logged {
  const { doneReps = 5, ...sessionOver } = over;
  const trainingDay = dayOf(n);
  const id = `s${n}`;
  const exerciseId = sessionOver.exerciseId ?? PRESS.id;
  const weightKg = sessionOver.actualKg ?? sessionOver.prescribedKg ?? 20;
  const session: Session = {
    id,
    exerciseId,
    startedAt: `${trainingDay}T08:00:00.000Z`,
    finishedAt: `${trainingDay}T08:40:00.000Z`,
    trainingDay,
    prescribedKg: weightKg,
    actualKg: weightKg,
    status: "complete",
    note: null,
    deletedAt: null,
    ...sessionOver,
  };
  const sets: SetLog[] = Array.from({ length: 6 }, (_, ordinal) => ({
    id: `${id}-${ordinal}`,
    sessionId: id,
    ordinal,
    side: ordinal % 2 === 0 ? "left" : "right",
    targetReps: 5,
    // Only the last set falls short, which is what a real near miss looks
    // like and still counts as a stall.
    doneReps: ordinal === 5 ? doneReps : 5,
    loggedAt: `${trainingDay}T08:${String(10 + ordinal * 5).padStart(2, "0")}:00.000Z`,
  }));
  return { session, sets };
}

let repo: Repo;
let dbCount = 0;

beforeEach(async () => {
  repo = await openDexieRepo(`lift-log-replay-${(dbCount += 1)}`);
  await repo.saveRotation([PRESS, ROW]);
  await repo.saveEquipment({ stepKg: STEP });
});

/** Write a log in the order given, and rebuild from it. */
async function replay(entries: readonly Logged[]) {
  for (const { session, sets } of entries) {
    await repo.appendSession(session);
    if (sets.length > 0) await repo.appendSets(sets);
  }
  return rebuildState(repo);
}

const stateOf = async (id: string) => repo.getEngineState(id);

/* ------------------------------------------------------------- the seed */

describe("the seed", () => {
  it("starts every lift at its start weight when the log is empty", async () => {
    const rebuilt = await replay([]);

    expect(rebuilt).toEqual([
      { exerciseId: "press", currentKg: 17.5, stallCount: 0 },
      { exerciseId: "row", currentKg: 27.5, stallCount: 0 },
    ]);
  });

  it("seeds a lift that has a rotation slot but no sessions", async () => {
    await replay([logged(0)]);

    // The press trained; the row did not, and still knows where it starts.
    await expect(stateOf("row")).resolves.toEqual({
      exerciseId: "row",
      currentKg: 27.5,
      stallCount: 0,
    });
  });

  it("writes the result to the cache, not only to the caller", async () => {
    const rebuilt = await replay([logged(0)]);

    await expect(repo.listEngineState()).resolves.toEqual(rebuilt);
  });
});

/* ------------------------------------------------------------- the fold */

describe("the fold", () => {
  it("adds one step per clean session, from the weight actually lifted", async () => {
    const rebuilt = await replay([
      logged(0, { actualKg: 20 }),
      logged(1, { actualKg: 22.5 }),
      logged(2, { actualKg: 25 }),
    ]);

    expect(rebuilt[0]).toEqual({ exerciseId: "press", currentKg: 27.5, stallCount: 0 });
  });

  it("holds the weight and counts the stall when a set falls short", async () => {
    const rebuilt = await replay([
      logged(0, { actualKg: 20 }),
      logged(1, { actualKg: 22.5, doneReps: 4 }),
    ]);

    expect(rebuilt[0]).toEqual({ exerciseId: "press", currentKg: 22.5, stallCount: 1 });
  });

  it("keeps each lift's history to itself", async () => {
    await replay([
      logged(0, { exerciseId: "press", actualKg: 20 }),
      logged(1, { exerciseId: "row", actualKg: 30, doneReps: 2 }),
      logged(2, { exerciseId: "press", actualKg: 22.5 }),
    ]);

    await expect(stateOf("press")).resolves.toEqual({
      exerciseId: "press",
      currentKg: 25,
      stallCount: 0,
    });
    await expect(stateOf("row")).resolves.toEqual({
      exerciseId: "row",
      currentKg: 30,
      stallCount: 1,
    });
  });

  it("reaches a deload, counting back through the sessions it replayed", async () => {
    // Eight clean sessions to build a history, then three stalls. The deload
    // needs the earlier sessions to count back through, which is the whole
    // reason the fold accumulates history rather than only a weight.
    const clean = Array.from({ length: 8 }, (_, i) => logged(i, { actualKg: 20 + i * STEP }));
    const stuck = 20 + 8 * STEP;
    const stalls = Array.from({ length: STALLS_BEFORE_DELOAD }, (_, i) =>
      logged(8 + i, { actualKg: stuck, doneReps: 3 }),
    );

    const rebuilt = await replay([...clean, ...stalls]);

    // Six sessions back from the third stall, by `actualKg`: two stalls at 40
    // and then 37.5, 35, 32.5, 30. The stall counter resets on the drop.
    expect(rebuilt[0]).toEqual({ exerciseId: "press", currentKg: 30, stallCount: 0 });
  });

  it("replays in log order, not in the order rows were written", async () => {
    // The same three sessions, appended newest first. Chronological order is
    // the repository's job, and getting it wrong here would silently produce a
    // different weight from the same facts.
    const forwards = [
      logged(0, { actualKg: 20 }),
      logged(1, { actualKg: 22.5, doneReps: 1 }),
      logged(2, { actualKg: 22.5 }),
    ];
    const backwards = [...forwards].reverse();

    const rebuilt = await replay(backwards);

    expect(rebuilt[0]).toEqual({ exerciseId: "press", currentKg: 25, stallCount: 0 });
  });
});

/* --------------------------------------------- what the log throws at it */

describe("the awkward rows", () => {
  it("ignores a session that is still open", async () => {
    // Replay runs while the app is in use — after an import, say, with a
    // session already started. A planned session has no outcome, and asking
    // the engine for one throws.
    const open = logged(1, { status: "planned", finishedAt: null, actualKg: 22.5 });

    const rebuilt = await replay([logged(0, { actualKg: 20 }), open]);

    expect(rebuilt[0]).toEqual({ exerciseId: "press", currentKg: 22.5, stallCount: 0 });
  });

  it("does not count a deleted session", async () => {
    const entries = [logged(0, { actualKg: 20 }), logged(1, { actualKg: 22.5 })];
    await replay(entries);
    await repo.softDeleteSession("s1", "2026-02-01T00:00:00.000Z");

    const rebuilt = await rebuildState(repo);

    // Only the first session survives, so the weight is one step above it
    // rather than two (INV-3).
    expect(rebuilt[0]).toEqual({ exerciseId: "press", currentKg: 22.5, stallCount: 0 });
  });

  it("counts an abandoned session as nothing at all", async () => {
    const rebuilt = await replay([
      logged(0, { actualKg: 20 }),
      logged(1, { actualKg: 22.5 }),
      logged(2, { status: "abandoned", finishedAt: null, actualKg: 25 }),
    ]);

    // Session two was clean, session three was walked out of: B5.7 says the
    // weight stays where the clean session left it.
    expect(rebuilt[0]).toEqual({ exerciseId: "press", currentKg: 25, stallCount: 0 });
  });

  it("skips a session whose lift has left the rotation", async () => {
    await replay([logged(0, { exerciseId: "bench", actualKg: 40 })]);

    // Nothing to prescribe it from and nowhere to key it, so no state is
    // invented. The session itself is untouched and still in the log.
    await expect(repo.listEngineState()).resolves.toHaveLength(2);
    await expect(repo.getSession("s0")).resolves.toBeDefined();
  });

  it("clears the state of a lift that has left the rotation", async () => {
    await replay([logged(0, { actualKg: 20 })]);
    await repo.saveRotation([ROW]);

    const rebuilt = await rebuildState(repo);

    expect(rebuilt.map((s) => s.exerciseId)).toEqual(["row"]);
    await expect(stateOf("press")).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------- C3.2 · the seam */

describe("rebuilding after a migration", () => {
  it("does nothing when the database is already current", async () => {
    await replay([logged(0, { actualKg: 20 })]);
    // A cache that disagrees with the log, left alone on purpose: nothing has
    // migrated, so nothing is rebuilt, and the wrong row survives to prove it.
    await repo.putEngineState([{ exerciseId: "press", currentKg: 999, stallCount: 7 }]);

    await expect(rebuildIfMigrated(repo, SCHEMA_VERSION)).resolves.toBeNull();
    await expect(stateOf("press")).resolves.toMatchObject({ currentKg: 999 });
  });

  it("rebuilds when the data was written by an older version", async () => {
    await replay([logged(0, { actualKg: 20 })]);
    await repo.putEngineState([{ exerciseId: "press", currentKg: 999, stallCount: 7 }]);
    // As if the app had just been updated over an older install.
    await repo.saveSettings({ schemaVersion: SCHEMA_VERSION - 1 });

    const rebuilt = await rebuildIfMigrated(repo, SCHEMA_VERSION);

    expect(rebuilt).not.toBeNull();
    await expect(stateOf("press")).resolves.toEqual({
      exerciseId: "press",
      currentKg: 22.5,
      stallCount: 0,
    });
  });

  it("records the new version, so the next open is a no-op", async () => {
    await repo.saveSettings({ schemaVersion: SCHEMA_VERSION - 1 });

    await rebuildIfMigrated(repo, SCHEMA_VERSION);

    await expect(repo.getSettings()).resolves.toMatchObject({
      schemaVersion: SCHEMA_VERSION,
    });
    await expect(rebuildIfMigrated(repo, SCHEMA_VERSION)).resolves.toBeNull();
  });

  it("runs on open, so nothing has to remember to call it", async () => {
    // The same database, closed and opened again the way the app does it.
    const name = `lift-log-replay-reopen-${(dbCount += 1)}`;
    const first = await openDexieRepo(name);
    await first.saveRotation([PRESS, ROW]);
    await first.saveEquipment({ stepKg: STEP });
    const { session, sets } = logged(0, { actualKg: 20 });
    await first.appendSession(session);
    await first.appendSets(sets);
    await first.putEngineState([{ exerciseId: "press", currentKg: 999, stallCount: 7 }]);
    await first.saveSettings({ schemaVersion: SCHEMA_VERSION - 1 });

    const reopened = await openDexieRepo(name);

    await expect(reopened.getEngineState("press")).resolves.toEqual({
      exerciseId: "press",
      currentKg: 22.5,
      stallCount: 0,
    });
  });

  it("leaves the version behind when the rebuild fails", async () => {
    // A repository whose cache write throws, standing in for a database that
    // fails mid-rebuild. The version must not move: the next open has to try
    // again rather than trust a cache that was never finished.
    const broken: Repo = {
      ...createDexieRepo(new LiftLogDb(`lift-log-replay-broken-${(dbCount += 1)}`)),
      getSettings: repo.getSettings.bind(repo),
      saveSettings: repo.saveSettings.bind(repo),
      listExercises: repo.listExercises.bind(repo),
      getEquipment: repo.getEquipment.bind(repo),
      readLog: repo.readLog.bind(repo),
      clearEngineState: async () => {},
      putEngineState: async () => {
        throw new Error("disk is full");
      },
    };
    await repo.saveSettings({ schemaVersion: SCHEMA_VERSION - 1 });

    await expect(rebuildIfMigrated(broken, SCHEMA_VERSION)).rejects.toThrow(/disk is full/);

    await expect(repo.getSettings()).resolves.toMatchObject({
      schemaVersion: SCHEMA_VERSION - 1,
    });
  });
});
