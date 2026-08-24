/**
 * C4.1 — the export is a whole database in a file.
 *
 * The claims worth testing are not about JSON. They are: nothing is left out
 * (including the rows every other read hides), nothing derived is put in, and
 * the same database exports the same bytes twice. A backup that quietly drops a
 * table is worse than no backup, because it is discovered on the day it is
 * needed.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { openDexieRepo } from "../src/db/dexie-repo";
import type { Repo } from "../src/db/repo";
import { SCHEMA_VERSION } from "../src/db/schema";
import { EXPORT_FORMAT, type ExportDocument, exportJson } from "../src/db/transfer";
import type { Exercise, Session, SetLog } from "../src/engine";

/* ------------------------------------------------------------- fixtures */

const ROTATION: readonly Exercise[] = [
  { id: "split-squat", name: "Bulgarian Split Squat", pattern: "squat", videoQuery: "split squat", startKg: 30, weakSide: "left" },
  { id: "press", name: "Single-Arm Shoulder Press", pattern: "vertical push", videoQuery: "press", startKg: 17.5, weakSide: "right" },
];

function session(over: Partial<Session> = {}): Session {
  const trainingDay = over.trainingDay ?? "2026-08-20";
  return {
    id: "s1",
    exerciseId: "press",
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

const AT = "2026-08-21T09:00:00.000Z";

let repo: Repo;
let dbCount = 0;

beforeEach(async () => {
  repo = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);
  await repo.saveRotation(ROTATION);
  await repo.saveEquipment({ stepKg: 2.5 });
  await repo.appendSession(session({ id: "s1", trainingDay: "2026-08-18" }));
  await repo.appendSets(setsFor("s1", [0, 1]));
  await repo.appendSession(session({ id: "s2", trainingDay: "2026-08-20" }));
  await repo.appendSets(setsFor("s2", [0, 1]));
});

async function exported(): Promise<ExportDocument> {
  return JSON.parse(await exportJson(repo, AT)) as ExportDocument;
}

/* ---------------------------------------------------------------- tests */

describe("the header (C4.1)", () => {
  it("says what the file is, when it was taken, and what wrote it", async () => {
    const doc = await exported();

    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.exportedAt).toBe(AT);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("stamps the clock itself when nobody passes one", async () => {
    const before = new Date().toISOString();
    const doc = JSON.parse(await exportJson(repo)) as ExportDocument;

    expect(doc.exportedAt >= before).toBe(true);
    expect(doc.exportedAt <= new Date().toISOString()).toBe(true);
  });

  it("puts the header first, so a truncated file still identifies itself", async () => {
    const json = await exportJson(repo, AT);

    expect(json.slice(0, 200)).toContain(EXPORT_FORMAT);
    expect(Object.keys(JSON.parse(json) as object).slice(0, 3)).toEqual([
      "format",
      "schemaVersion",
      "exportedAt",
    ]);
  });
});

describe("what travels", () => {
  it("carries the setup", async () => {
    const doc = await exported();

    expect(doc.exercises).toEqual(ROTATION);
    expect(doc.equipment).toEqual({ stepKg: 2.5 });
    expect(doc.settings).toEqual(await repo.getSettings());
  });

  it("keeps the rotation in rotation order", async () => {
    const reversed = [...ROTATION].reverse();
    await repo.saveRotation(reversed);

    expect((await exported()).exercises).toEqual(reversed);
  });

  it("carries every session and every set", async () => {
    const doc = await exported();

    expect(doc.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(doc.sets.map((s) => s.id)).toEqual(["s1-0", "s1-1", "s2-0", "s2-1"]);
  });

  it("carries deleted sessions, and their sets with them (INV-3)", async () => {
    // The one read in the app that does not filter tombstones. If the backup
    // dropped them, restoring it would bring a deleted session back to life.
    await repo.softDeleteSession("s1", AT);
    const doc = await exported();

    expect(doc.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(doc.sessions[0]?.deletedAt).toBe(AT);
    expect(doc.sets.map((s) => s.id)).toContain("s1-0");
    // And the ordinary read still hides it, so this is the export's own doing.
    await expect(repo.listSessions()).resolves.toHaveLength(1);
  });

  it("leaves the engine cache out, because replay owns it", async () => {
    await repo.putEngineState([{ exerciseId: "press", currentKg: 22.5, stallCount: 1 }]);
    const doc = await exported() as ExportDocument & { engineState?: unknown };

    expect(doc.engineState).toBeUndefined();
    expect(Object.keys(doc)).toEqual([
      "format",
      "schemaVersion",
      "exportedAt",
      "exercises",
      "equipment",
      "settings",
      "sessions",
      "sets",
    ]);
  });
});

describe("the file itself", () => {
  it("is byte-identical for the same database", async () => {
    expect(await exportJson(repo, AT)).toBe(await exportJson(repo, AT));
  });

  it("orders sessions in log order and each session's sets after it", async () => {
    // A session written out of order must not export out of order: a backup
    // that reshuffles itself cannot be diffed against yesterday's.
    await repo.appendSession(session({ id: "s0", trainingDay: "2026-08-16" }));
    await repo.appendSets(setsFor("s0", [1, 0]));
    const doc = await exported();

    expect(doc.sessions.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(doc.sets.map((s) => s.id)).toEqual(["s0-0", "s0-1", "s1-0", "s1-1", "s2-0", "s2-1"]);
  });

  it("is indented, so a human can read it", async () => {
    const json = await exportJson(repo, AT);

    expect(json).toContain('\n  "format"');
    expect(json.endsWith("\n")).toBe(true);
  });

  it("survives a round trip through JSON unchanged", async () => {
    const json = await exportJson(repo, AT);

    expect(`${JSON.stringify(JSON.parse(json), null, 2)}\n`).toBe(json);
  });
});
