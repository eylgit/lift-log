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

import type { ExerciseId, Instant, SetLog } from "../engine";
import type { Repo, Snapshot } from "./repo";

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
