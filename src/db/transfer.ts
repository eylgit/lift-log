/**
 * Export and import (C4).
 *
 * This is the escape hatch, and it is written now — before there is an app
 * worth backing up — because the day it is needed nobody wants to be debugging
 * it (C4.5, §9.4). Browser storage can be evicted; a phone can be lost. The
 * answer to both is a file the athlete keeps, and a way to read it back.
 *
 * Two properties are worth more than anything clever this file could do.
 *
 *   It is readable by a stranger. JSON, one key per table, ISO dates, weights
 *   in kilograms and nothing encoded (§14.4). In five years the most likely
 *   reader is a script nobody has written yet, so the document says what it is
 *   at the top — `format`, `schemaVersion`, `exportedAt` — and never relies on
 *   the reader knowing this codebase (§9.4).
 *
 *   It restores what was there, not what looks right. Tombstones travel
 *   (INV-3): a session that was deleted comes back deleted, because losing that
 *   record would resurrect it on the next restore. `engineState` does not
 *   travel: it is a cache, and the import rebuilds it from the log it just
 *   wrote (C3.1). See `Snapshot` in `repo.ts` for that argument in full.
 *
 * Everything here goes through `Repo` — no Dexie, no file system, no DOM. A
 * string comes out of `exportJson` and a string goes into `importJson`; making
 * that string into a download or reading it off a picked file is the shell's
 * job (F1, F4), and keeping it out of here is what lets the whole path be
 * tested without a browser.
 */

import type {
  EngineState,
  Equipment,
  Exercise,
  ExerciseId,
  Instant,
  Session,
  SetLog,
} from "../engine";
import { rebuildState } from "./replay";
import type { Repo, Snapshot } from "./repo";
import { SCHEMA_VERSION } from "./schema";
import type { Settings } from "./types";

/* -------------------------------------------------------------- the file */

/**
 * The first thing in the document, and the reason a reader can trust the rest.
 *
 * A plain marker rather than a MIME type or a magic number: the import checks
 * it so that pointing the restore at some other app's JSON fails with "this is
 * not a Lift Log export" instead of writing half a database (C4.3).
 */
export const EXPORT_FORMAT = "lift-log-export";

/**
 * A whole database as a file.
 *
 * The tables are the `Snapshot` (C4.1) with a header on top. `schemaVersion` is
 * the header's copy and the one an importer must read; `settings.schemaVersion`
 * is the settings row as it stood, carried faithfully like every other field,
 * and the import rewrites it rather than trusting it.
 */
export type ExportDocument = Snapshot & {
  readonly format: typeof EXPORT_FORMAT;
  /** Which version of the schema wrote these rows (C1.4). */
  readonly schemaVersion: number;
  /** When the export was taken, ISO 8601, UTC. */
  readonly exportedAt: Instant;
};

/* -------------------------------------------------------------- exporting */

/**
 * Everything in the database, as a JSON document (C4.1).
 *
 * Indented on purpose. It roughly doubles the file — a year of training is a
 * few hundred kilobytes either way — and buys a backup somebody can open in a
 * text editor, diff against last month's, and read when something has gone
 * wrong. That is the entire point of the file.
 *
 * The clock is a defaulted parameter, as it is in `trainingDay` (INV-5): tests
 * pass an instant so two exports of the same data are the same bytes.
 *
 * It writes nothing. `settings.lastExportedAt` is the backup nudge's business
 * and it is the caller that knows whether the file actually reached the
 * athlete's disk (F3) — a document that had been generated and then dropped by
 * a cancelled save dialog must not count as a backup.
 */
export async function exportJson(
  repo: Repo,
  exportedAt: Instant = new Date().toISOString(),
): Promise<string> {
  const snapshot = await repo.snapshot();
  const document: ExportDocument = {
    format: EXPORT_FORMAT,
    schemaVersion: snapshot.settings.schemaVersion,
    exportedAt,
    ...snapshot,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/* ------------------------------------------------------------------- csv */

/**
 * The columns, in order (C4.2).
 *
 * One row per logged set, denormalised: the session's day, weight and status
 * repeat on each of its rows, because a spreadsheet cannot join and the whole
 * point of this file is that it opens in one. Weights are kilograms, as they
 * are everywhere else (INV-1, §14.4), and the column says so rather than
 * relying on a setting the file does not carry.
 */
const CSV_COLUMNS = [
  "trainingDay",
  "exercise",
  "exerciseId",
  "side",
  "set",
  "targetReps",
  "doneReps",
  "weightKg",
  "prescribedKg",
  "status",
  "loggedAt",
  "sessionId",
  "setId",
  "note",
] as const;

/**
 * RFC 4180: quote a field that contains a comma, a quote or a newline, and
 * double any quote inside it. Everything else goes out bare.
 *
 * There is a second escaping problem this deliberately does not solve. A note
 * beginning `=` or `+` is a formula to Excel, and the usual mitigation is to
 * prefix it with an apostrophe. That trades a threat nobody here faces — this
 * is one athlete's own log, opened in their own spreadsheet — for corrupting
 * every note that legitimately starts with a minus sign. The data wins.
 */
function csvField(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(fields: readonly (string | number | null)[]): string {
  return `${fields.map(csvField).join(",")}\r\n`;
}

/**
 * The log as one row per set, for a spreadsheet (C4.2).
 *
 * This is not the backup — `exportJson` is, and this is the file you open to
 * draw a graph the app does not draw. Two consequences follow from that and
 * are the only judgement calls here.
 *
 * Deleted sessions are left out. The JSON keeps tombstones because a restore
 * must not resurrect what was deleted; a spreadsheet has nothing to restore,
 * and INV-3 says a deleted session is not there. So this reads the ordinary
 * log, filters and all.
 *
 * Sessions still open are included, with `status` telling the truth about
 * them. The sets were lifted; leaving them out would make today's training
 * vanish from the file until the session was closed.
 *
 * `set` is counted per side rather than derived from the ordinal, so it stays
 * right when a session was abandoned between the two sides of a set — dividing
 * the ordinal by two assumes a pairing the data does not promise.
 */
export async function exportCsv(repo: Repo): Promise<string> {
  const [exercises, log] = await Promise.all([repo.listExercises(), repo.readLog()]);
  const nameOf = new Map<ExerciseId, string>(exercises.map((e) => [e.id, e.name]));

  let csv = csvRow(CSV_COLUMNS);
  for (const { session, sets } of log) {
    const setNumber = new Map<SetLog["side"], number>();
    for (const set of sets) {
      const n = (setNumber.get(set.side) ?? 0) + 1;
      setNumber.set(set.side, n);
      csv += csvRow([
        session.trainingDay,
        // An exercise dropped from the rotation keeps its sessions (see
        // `rebuildState`), so its name may be gone. The id is in the row either
        // way; an empty column is honest, an invented name is not.
        nameOf.get(session.exerciseId) ?? "",
        session.exerciseId,
        set.side,
        n,
        set.targetReps,
        set.doneReps,
        session.actualKg,
        session.prescribedKg,
        session.status,
        set.loggedAt,
        session.id,
        set.id,
        session.note,
      ]);
    }
  }
  return csv;
}

/* ------------------------------------------------------------- importing */

/**
 * What is in a file, before anything has been written (F4.1).
 *
 * The plan's order is picker → validate → confirm → replace, and this is the
 * validate. It parses and migrates and touches no storage, so a file that is
 * not a backup — or is a backup from a newer app — is refused while the
 * athlete's log is still exactly where it was. Being told "this is not a Lift
 * Log backup" *after* the restore has replaced everything would be the worst
 * screen in the app.
 *
 * It also gives the confirm something true to say. "Replace 214 sessions with
 * the 198 in a file from 3 August" is a decision; "replace everything?" is a
 * dice roll.
 */
export type ImportPreview = {
  /** When the file was taken. */
  readonly exportedAt: Instant;
  readonly schemaVersion: number;
  readonly exercises: number;
  readonly sessions: number;
  readonly sets: number;
};

/**
 * Read a file and say what is in it, writing nothing (F4.1).
 *
 * `importJson` parses again rather than taking the document this produced. That
 * is a few hundred kilobytes of redundant work at the one moment nobody is in a
 * hurry, and it buys something worth more: `importJson` keeps its own
 * "parse, check, replace, rebuild" order and cannot be handed a document that
 * was validated by an older copy of this code, or edited in between.
 */
export function previewJson(json: string): ImportPreview {
  const document = migrate(parseDocument(json));
  return {
    exportedAt: document.exportedAt,
    schemaVersion: document.schemaVersion,
    exercises: document.exercises.length,
    sessions: document.sessions.length,
    sets: document.sets.length,
  };
}

/** What was restored, for the screen that asked for it (F4). */
export type ImportResult = {
  /** When the file was taken — the thing to show, since it is what was lost. */
  readonly exportedAt: Instant;
  /** The version the file was written at, before any migration. */
  readonly schemaVersion: number;
  readonly exercises: number;
  readonly sessions: number;
  readonly sets: number;
  /** The cache as rebuilt from the restored log (C3.1). */
  readonly state: readonly EngineState[];
};

/**
 * Read a document and put it in the database, replacing what was there (C4.3).
 *
 * The order is: parse, check, replace, rebuild. Everything that can fail is
 * done before anything is written, because the athlete running this has already
 * lost their data once — an import that half-succeeded would be the second time.
 *
 * `rebuildState` is called unconditionally rather than through
 * `rebuildIfMigrated`. There is nothing to check: every fact in the database is
 * new, so every derived row is stale by definition, whatever version wrote them
 * (C3.2).
 *
 * The parameter is the file's text, not a `File`. Reading a picked file is the
 * shell's job (F4), and keeping the DOM out of here is what lets the restore
 * path be tested without a browser.
 */
export async function importJson(repo: Repo, json: string): Promise<ImportResult> {
  const document = migrate(parseDocument(json));
  await repo.restore({
    exercises: document.exercises,
    equipment: document.equipment,
    settings: { ...document.settings, schemaVersion: SCHEMA_VERSION },
    sessions: document.sessions,
    sets: document.sets,
  });
  const state = await rebuildState(repo);
  return {
    exportedAt: document.exportedAt,
    schemaVersion: document.schemaVersion,
    exercises: document.exercises.length,
    sessions: document.sessions.length,
    sets: document.sets.length,
    state,
  };
}

/**
 * Bring an older document up to the current schema (C4.3).
 *
 * There is nothing to do yet — there has only ever been one version — and the
 * function exists anyway, for the same reason Dexie's versioning was declared
 * with nothing to migrate (C1.3). The expensive moment is the one where a year
 * of real training data is sitting in a file written by last year's app, and by
 * then it is far too late to decide where the conversion goes.
 *
 * A document from a *newer* app is refused rather than guessed at. Reading rows
 * whose shape has not been invented yet cannot be done safely, and the failure
 * the athlete can act on — "update the app first" — is much better than a
 * database quietly missing a field.
 */
function migrate(document: ExportDocument): ExportDocument {
  const { schemaVersion } = document;
  if (schemaVersion === SCHEMA_VERSION) return document;
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This backup was made by a newer version of Lift Log (schema ${schemaVersion}; ` +
        `this app reads ${SCHEMA_VERSION}). Update the app and try again.`,
    );
  }
  // Each future version gets a step here, oldest first, each one taking a
  // document from version N to N + 1.
  throw new Error(`This backup's schema version (${schemaVersion}) is not one this app knows.`);
}

/* ----------------------------------------------------------- reading it */

/**
 * Everything below turns an unknown blob of JSON into an `ExportDocument`, or
 * throws saying which field was wrong.
 *
 * It is longer than the exporter, which is the correct proportion. The export
 * runs against a database whose shape TypeScript already guarantees; the import
 * runs against a file that has been off this machine — through a cloud drive, a
 * mail client, possibly a text editor — and the only thing standing between a
 * bad byte in it and a corrupted log is this code. TypeScript is no help at
 * all here: `JSON.parse` returns `any`, and a cast would be a lie that shows up
 * later as `undefined` in a chart.
 *
 * What it does not do is enforce meaning. A set pointing at a session that is
 * not in the file is kept, not rejected, because `snapshot()` keeps such a row
 * for the same reason — refusing to restore a backup on the strength of a row
 * the backup faithfully preserved would make the file useless at the one moment
 * it matters. Deciding what a fact means is the engine's business (INV-2);
 * this decides only that the file is a Lift Log backup and its fields are the
 * types they claim.
 */

/** The message a person reads when the file is wrong. Prefixed once, here. */
function fail(what: string): never {
  throw new Error(`This file is not a usable Lift Log backup: ${what}.`);
}

type Row = Record<string, unknown>;

function readRow(value: unknown, where: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} should be an object`);
  }
  return value as Row;
}

function readArray(row: Row, field: string, where: string): unknown[] {
  const value = row[field];
  if (!Array.isArray(value)) fail(`${where}.${field} should be a list`);
  return value;
}

function readString(row: Row, field: string, where: string): string {
  const value = row[field];
  if (typeof value !== "string") fail(`${where}.${field} should be text`);
  return value;
}

/** A string or null — `finishedAt`, `note` and `deletedAt` are all three. */
function readNullableString(row: Row, field: string, where: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") fail(`${where}.${field} should be text or null`);
  return value;
}

/**
 * A string, null, or absent — a field added to the app after this file was
 * written.
 *
 * The distinction from `readNullableString` is the whole point: a backup taken
 * last year does not have this year's fields, and refusing it would break the
 * one promise the export format makes. An absent field is not a malformed file,
 * it is an older one, and the default is what a fresh install would have had.
 *
 * This is deliberately *only* for fields whose absence has an obvious answer.
 * Anything load-bearing gets a step in `migrate` instead, where the conversion
 * can be written down and read.
 */
function readOptionalString(row: Row, field: string, where: string): string | null {
  if (!(field in row) || row[field] === undefined) return null;
  return readNullableString(row, field, where);
}

function readNumber(row: Row, field: string, where: string, min = -Infinity): number {
  const value = row[field];
  // `Number.isFinite` and not `typeof === "number"`: JSON has no NaN or
  // Infinity literal, but a hand-edited file can hold `1e999`, which parses to
  // Infinity and would poison every weight derived from it.
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    fail(`${where}.${field} should be a number${min === -Infinity ? "" : ` of at least ${min}`}`);
  }
  return value;
}

function readCount(row: Row, field: string, where: string): number {
  const value = readNumber(row, field, where, 0);
  if (!Number.isInteger(value)) fail(`${where}.${field} should be a whole number`);
  return value;
}

function readOneOf<T extends string>(
  row: Row,
  field: string,
  where: string,
  allowed: readonly T[],
): T {
  const value = readString(row, field, where);
  if (!(allowed as readonly string[]).includes(value)) {
    fail(`${where}.${field} should be one of ${allowed.join(", ")} (found "${value}")`);
  }
  return value as T;
}

/** Two rows with one id would make the second overwrite the first, silently. */
function readUnique<T>(items: readonly T[], id: (item: T) => string, what: string): readonly T[] {
  const seen = new Set<string>();
  for (const item of items) {
    const key = id(item);
    if (seen.has(key)) fail(`two ${what} share the id "${key}"`);
    seen.add(key);
  }
  return items;
}

function readExercise(value: unknown, index: number): Exercise {
  const where = `exercises[${index}]`;
  const row = readRow(value, where);
  return {
    id: readString(row, "id", where),
    name: readString(row, "name", where),
    pattern: readOneOf(row, "pattern", where, [
      "squat",
      "hip hinge",
      "vertical push",
      "horizontal push",
      "horizontal pull",
    ]),
    videoQuery: readString(row, "videoQuery", where),
    startKg: readNumber(row, "startKg", where, 0),
    weakSide: readOneOf(row, "weakSide", where, ["left", "right"]),
  };
}

function readSession(value: unknown, index: number): Session {
  const where = `sessions[${index}]`;
  const row = readRow(value, where);
  return {
    id: readString(row, "id", where),
    exerciseId: readString(row, "exerciseId", where),
    startedAt: readString(row, "startedAt", where),
    finishedAt: readNullableString(row, "finishedAt", where),
    trainingDay: readString(row, "trainingDay", where),
    prescribedKg: readNumber(row, "prescribedKg", where, 0),
    actualKg: readNumber(row, "actualKg", where, 0),
    status: readOneOf(row, "status", where, ["planned", "complete", "abandoned"]),
    note: readNullableString(row, "note", where),
    deletedAt: readNullableString(row, "deletedAt", where),
  };
}

function readSet(value: unknown, index: number): SetLog {
  const where = `sets[${index}]`;
  const row = readRow(value, where);
  return {
    id: readString(row, "id", where),
    sessionId: readString(row, "sessionId", where),
    ordinal: readCount(row, "ordinal", where),
    side: readOneOf(row, "side", where, ["left", "right"]),
    targetReps: readCount(row, "targetReps", where),
    doneReps: readCount(row, "doneReps", where),
    loggedAt: readString(row, "loggedAt", where),
  };
}

function readEquipment(value: unknown): Equipment {
  const row = readRow(value, "equipment");
  const stepKg = readNumber(row, "stepKg", "equipment", 0);
  // Zero is the one number that breaks the engine rather than merely looking
  // odd: progress would be adding nothing, forever. `assertStep` refuses it too.
  if (stepKg === 0) fail("equipment.stepKg should be more than zero");
  return { stepKg };
}

function readSettings(value: unknown): Settings {
  const row = readRow(value, "settings");
  return {
    units: readOneOf(row, "units", "settings", ["kg", "lb"]),
    restTargetS: readNumber(row, "restTargetS", "settings", 0),
    stallThreshold: readCount(row, "stallThreshold", "settings"),
    lastExportedAt: readNullableString(row, "lastExportedAt", "settings"),
    // Added in F3, so a backup taken before it simply has no such field.
    lastNudgedAt: readOptionalString(row, "lastNudgedAt", "settings"),
    schemaVersion: readCount(row, "schemaVersion", "settings"),
  };
}

/**
 * The file, checked (C4.3).
 *
 * `format` is tested first and on purpose: pointing the restore at some other
 * app's JSON should say so plainly, rather than working through the fields and
 * complaining that `exercises` is missing.
 */
function parseDocument(json: string): ExportDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("it is not JSON at all");
  }

  const document = readRow(parsed, "the file");
  if (document["format"] !== EXPORT_FORMAT) {
    fail(`it does not say "${EXPORT_FORMAT}" at the top`);
  }
  const schemaVersion = readCount(document, "schemaVersion", "the file");
  if (schemaVersion < 1) fail("its schemaVersion should be at least 1");

  return {
    format: EXPORT_FORMAT,
    schemaVersion,
    exportedAt: readString(document, "exportedAt", "the file"),
    exercises: readUnique(
      readArray(document, "exercises", "the file").map(readExercise),
      (exercise) => exercise.id,
      "exercises",
    ),
    equipment: readEquipment(document["equipment"]),
    settings: readSettings(document["settings"]),
    sessions: readUnique(
      readArray(document, "sessions", "the file").map(readSession),
      (session) => session.id,
      "sessions",
    ),
    sets: readUnique(readArray(document, "sets", "the file").map(readSet), (set) => set.id, "sets"),
  };
}
