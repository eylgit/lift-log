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

import type { Instant } from "../engine";
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
