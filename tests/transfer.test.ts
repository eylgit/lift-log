/**
 * C4.1, C4.2 and C4.3 — the export is a whole database in a file, a spreadsheet
 * beside it, and a way back in.
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
import {
  EXPORT_FORMAT,
  type ExportDocument,
  exportCsv,
  exportJson,
  importJson,
  previewJson,
} from "../src/db/transfer";
import type { EngineState, Exercise, Session, SetLog } from "../src/engine";

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

/* ------------------------------------------------------------------- csv */

/** The CSV as rows of fields, header included. Naive on purpose — see below. */
function rows(csv: string): string[][] {
  return csv
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => line.split(","));
}

describe("the spreadsheet (C4.2)", () => {
  it("is one row per logged set, under a header", async () => {
    const table = rows(await exportCsv(repo));

    expect(table[0]?.slice(0, 4)).toEqual(["trainingDay", "exercise", "exerciseId", "side"]);
    expect(table).toHaveLength(1 + 4);
  });

  it("repeats the session's columns on each of its rows, because nothing can join", async () => {
    const table = rows(await exportCsv(repo));
    const header = table[0]!;
    const column = (row: string[], name: string) => row[header.indexOf(name)];

    for (const row of table.slice(1, 3)) {
      expect(column(row, "trainingDay")).toBe("2026-08-18");
      expect(column(row, "exercise")).toBe("Single-Arm Shoulder Press");
      expect(column(row, "weightKg")).toBe("20");
      expect(column(row, "status")).toBe("complete");
      expect(column(row, "sessionId")).toBe("s1");
    }
  });

  it("counts the set per side, so an abandoned half-set does not shift it", async () => {
    // Ordinals 0 and 1 are set one, left then right; 2 is set two's left side
    // and the athlete stopped there. Dividing the ordinal by two would call
    // that row set two either way — this counts left-side sets, so it is right
    // for the same reason on a session that ends mid-set.
    await repo.appendSession(session({ id: "s3", trainingDay: "2026-08-22", status: "abandoned" }));
    await repo.appendSets(setsFor("s3", [0, 1, 2]));
    const table = rows(await exportCsv(repo));
    const s3 = table.filter((row) => row.includes("s3"));

    expect(s3.map((row) => [row[3], row[4]])).toEqual([
      ["left", "1"],
      ["right", "1"],
      ["left", "2"],
    ]);
  });

  it("includes a session that is still open, and says so", async () => {
    await repo.appendSession(session({ id: "s4", trainingDay: "2026-08-23", status: "planned" }));
    await repo.appendSets(setsFor("s4", [0]));
    const table = rows(await exportCsv(repo));
    const open = table.find((row) => row.includes("s4"));

    // The set was lifted. Hiding it until the session is closed would make
    // today's training missing from the file the athlete just downloaded.
    expect(open).toBeDefined();
    expect(open).toContain("planned");
  });

  it("leaves deleted sessions out, unlike the JSON (INV-3)", async () => {
    await repo.softDeleteSession("s1", AT);

    const csv = await exportCsv(repo);
    const doc = await exported();

    // The two files answer different questions. The backup must remember the
    // deletion; the spreadsheet is analysis, and a deleted session is not there.
    expect(csv).not.toContain("s1-0");
    expect(doc.sets.map((s) => s.id)).toContain("s1-0");
  });

  it("quotes a field with a comma or a quote in it (RFC 4180)", async () => {
    await repo.saveRotation([
      { ...ROTATION[0]!, name: 'Split Squat, "rear foot" elevated' },
      ROTATION[1]!,
    ]);
    await repo.appendSession(
      session({ id: "s5", exerciseId: "split-squat", trainingDay: "2026-08-24", note: "felt, odd" }),
    );
    await repo.appendSets(setsFor("s5", [0]));
    const csv = await exportCsv(repo);

    expect(csv).toContain('"Split Squat, ""rear foot"" elevated"');
    expect(csv).toContain('"felt, odd"');
    // The naive splitter above would mangle this row, which is the point of the
    // test: the file is only readable because the quoting is there.
    expect(csv.split("\r\n").filter((l) => l !== "")).toHaveLength(1 + 5);
  });

  it("leaves the name blank for a lift that has left the rotation", async () => {
    // Its sessions survive — see `rebuildState` — so the row must still export.
    // The id is in the next column; inventing a name would be worse than blank.
    await repo.saveRotation([ROTATION[0]!]);
    const table = rows(await exportCsv(repo));
    const row = table.find((r) => r.includes("s1"))!;

    expect(row[1]).toBe("");
    expect(row[2]).toBe("press");
  });

  it("ends every line CRLF, which is what a spreadsheet expects", async () => {
    const csv = await exportCsv(repo);

    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("is empty but for the header when nothing has been logged", async () => {
    const fresh = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);
    await fresh.saveRotation(ROTATION);

    expect(rows(await exportCsv(fresh))).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- import */

/**
 * A document with one field changed, for the validator tests. Re-indented like
 * the real thing so a test can also reach in and edit the text.
 */
async function tampered(change: (doc: Record<string, unknown>) => void): Promise<string> {
  const doc = JSON.parse(await exportJson(repo, AT)) as Record<string, unknown>;
  change(doc);
  return JSON.stringify(doc, null, 2);
}

describe("restoring a backup (C4.3)", () => {
  it("puts back what was exported", async () => {
    const json = await exportJson(repo, AT);
    const wiped = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);

    await importJson(wiped, json);

    expect(await exportJson(wiped, AT)).toBe(json);
  });

  it("replaces what was there rather than merging with it", async () => {
    const json = await exportJson(repo, AT);
    const other = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);
    await other.saveRotation([{ ...ROTATION[0]!, id: "rows-of-its-own" }]);
    await other.appendSession(session({ id: "not-in-the-backup" }));

    await importJson(other, json);

    // The athlete asked to restore a backup. A merge would leave behind the
    // very session they were trying to get rid of, with no rule for the case
    // where both sides hold the same id.
    await expect(other.getSession("not-in-the-backup")).resolves.toBeUndefined();
    expect((await other.listExercises()).map((e) => e.id)).toEqual(ROTATION.map((e) => e.id));
  });

  it("brings a deleted session back deleted", async () => {
    await repo.softDeleteSession("s1", AT);
    const json = await exportJson(repo, AT);
    const wiped = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);

    await importJson(wiped, json);

    await expect(wiped.getSession("s1")).resolves.toBeUndefined();
    expect((await wiped.snapshot()).sessions.find((s) => s.id === "s1")?.deletedAt).toBe(AT);
  });

  it("rebuilds the engine cache from the log it just wrote", async () => {
    const json = await exportJson(repo, AT);
    const wiped = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);
    // A cache from the database this one used to be. Nothing in the document
    // can contradict it, because the document has no cache in it — so if the
    // import did not rebuild, this poison would survive.
    await wiped.putEngineState([{ exerciseId: "press", currentKg: 999, stallCount: 99 }]);

    const result = await importJson(wiped, json);

    // Sorted, because `listEngineState` promises no order and the rebuild
    // hands its states back in rotation order.
    const byId = (a: EngineState, b: EngineState) => a.exerciseId.localeCompare(b.exerciseId);
    expect([...result.state].sort(byId)).toEqual([...(await wiped.listEngineState())].sort(byId));
    expect((await wiped.getEngineState("press"))?.currentKg).not.toBe(999);
  });

  it("reports what it restored", async () => {
    const json = await exportJson(repo, AT);
    const wiped = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);

    const result = await importJson(wiped, json);

    expect(result).toMatchObject({
      exportedAt: AT,
      schemaVersion: SCHEMA_VERSION,
      exercises: 2,
      sessions: 2,
      sets: 4,
    });
  });

  it("marks the restored database as current, whatever the file said", async () => {
    const json = await tampered((doc) => {
      (doc["settings"] as Record<string, unknown>)["schemaVersion"] = 1;
    });
    const wiped = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);

    await importJson(wiped, json);

    // The rebuild has just run under this version's rules, so saying the
    // database is behind would make the next open rebuild it again for nothing.
    expect((await wiped.getSettings()).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe("refusing a file it cannot trust", () => {
  it("refuses something that is not JSON", async () => {
    await expect(importJson(repo, "sorry, wrong file")).rejects.toThrow(/not JSON/);
  });

  it("refuses another app's JSON, before complaining about fields", async () => {
    await expect(importJson(repo, '{"users":[],"posts":[]}')).rejects.toThrow(
      new RegExp(EXPORT_FORMAT),
    );
  });

  it("refuses a backup from a newer version of the app", async () => {
    const json = await tampered((doc) => {
      doc["schemaVersion"] = SCHEMA_VERSION + 1;
    });

    // Guessing at rows whose shape has not been invented yet is how a field
    // goes quietly missing. "Update the app" is something the athlete can act on.
    await expect(importJson(repo, json)).rejects.toThrow(/newer version/);
  });

  it("names the field that is wrong", async () => {
    const json = await tampered((doc) => {
      (doc["sessions"] as Record<string, unknown>[])[1]!["actualKg"] = "twenty";
    });

    await expect(importJson(repo, json)).rejects.toThrow(/sessions\[1\]\.actualKg/);
  });

  it("refuses a weight that parses to Infinity", async () => {
    // JSON has no Infinity literal, but `1e999` parses to one, and it would
    // poison every weight derived from it.
    const json = (await tampered(() => {})).replace('"actualKg": 20', '"actualKg": 1e999');

    await expect(importJson(repo, json)).rejects.toThrow(/actualKg/);
  });

  it("refuses two rows with the same id", async () => {
    const json = await tampered((doc) => {
      const sets = doc["sets"] as Record<string, unknown>[];
      sets.push({ ...sets[0]! });
    });

    await expect(importJson(repo, json)).rejects.toThrow(/share the id/);
  });

  it("refuses a status it does not know", async () => {
    const json = await tampered((doc) => {
      (doc["sessions"] as Record<string, unknown>[])[0]!["status"] = "sort of finished";
    });

    await expect(importJson(repo, json)).rejects.toThrow(/status/);
  });

  it("writes nothing at all when the file is bad", async () => {
    const before = await exportJson(repo, AT);
    const json = await tampered((doc) => {
      doc["sets"] = "not a list";
    });

    await expect(importJson(repo, json)).rejects.toThrow();

    // The athlete running an import has already lost their data once. Every
    // check happens before the first write for exactly this reason.
    expect(await exportJson(repo, AT)).toBe(before);
  });
});

/* ------------------------------------------------- looking before leaping (F4.1) */

describe("checking a file without writing anything", () => {
  it("says what is in a good file", async () => {
    const json = await exportJson(repo, AT);

    expect(previewJson(json)).toEqual({
      exportedAt: AT,
      schemaVersion: SCHEMA_VERSION,
      exercises: 2,
      sessions: 2,
      sets: 4,
    });
  });

  it("refuses a bad file with the same words the import would use", async () => {
    // The confirm should never be reached by a file the restore would then
    // reject: the athlete would have agreed to replace their log and then been
    // told the file was unreadable, which is the worst screen in the app.
    const json = await tampered((doc) => {
      (doc["sessions"] as Record<string, unknown>[])[1]!["actualKg"] = "twenty";
    });

    expect(() => previewJson(json)).toThrow(/sessions\[1\]\.actualKg/);
    await expect(importJson(repo, json)).rejects.toThrow(/sessions\[1\]\.actualKg/);
  });

  it("refuses a newer app's backup before the confirm, not after", async () => {
    const json = await tampered((doc) => {
      doc["schemaVersion"] = SCHEMA_VERSION + 1;
    });

    expect(() => previewJson(json)).toThrow(/newer version/);
  });

  it("touches the database not at all", async () => {
    const before = await exportJson(repo, AT);
    const bad = await tampered((doc) => {
      doc["sets"] = "not a list";
    });

    expect(() => previewJson(bad)).toThrow();
    previewJson(await exportJson(repo, AT));

    expect(await exportJson(repo, AT)).toBe(before);
  });
});

/* ------------------------------------------- a file older than a field (F3, F4) */

describe("a backup written before a field existed", () => {
  /** An export with `settings.lastNudgedAt` removed, as a pre-F3 file would be. */
  async function withoutNudgeField(): Promise<string> {
    return tampered((doc) => {
      delete (doc["settings"] as Record<string, unknown>)["lastNudgedAt"];
    });
  }

  it("checks out, because an absent field is an older file and not a broken one", async () => {
    const json = await withoutNudgeField();

    expect(json).not.toContain("lastNudgedAt");
    expect(() => previewJson(json)).not.toThrow();
  });

  it("restores with the default a fresh install would have had", async () => {
    // This is the promise the export format makes and the one worth keeping:
    // a backup taken last year still restores next year. Refusing it because
    // this year's app grew a field would break it at the one moment it counts.
    const wiped = await openDexieRepo(`lift-log-transfer-${(dbCount += 1)}`);

    await importJson(wiped, await withoutNudgeField());

    const settings = await wiped.getSettings();
    expect(settings.lastNudgedAt).toBeNull();
    expect(settings.units).toBe("kg");
  });

  it("still refuses a field of the wrong type, absent or not", async () => {
    // Tolerating absence is not tolerating nonsense.
    const json = await tampered((doc) => {
      (doc["settings"] as Record<string, unknown>)["lastNudgedAt"] = 7;
    });

    expect(() => previewJson(json)).toThrow(/settings\.lastNudgedAt/);
  });
});
