/**
 * The storage layer's public surface (C2.3), and the app's one way in.
 *
 * `src/engine/index.ts` does the same job for the engine: everything above this
 * folder imports from here and never from a file inside it. That is what keeps
 * the name of the database out of the rest of the app — a screen that says
 * `openDexieRepo` has named the thing Part J is going to replace, even though
 * it only wanted a `Repo`.
 *
 * Nothing here is a re-export for its own sake. `openRepo` is a different
 * function from the one it wraps, and the types below are the vocabulary the
 * screens need to hold what it hands back.
 */

import type { Repo } from "./repo";
import { openDexieRepo } from "./dexie-repo";

export type { LoggedSession, Repo, SessionOutcome, SessionQuery, Snapshot } from "./repo";
export type { Settings, Units } from "./types";
export type { ExportDocument, ImportPreview, ImportResult } from "./transfer";
export { EXPORT_FORMAT, exportCsv, exportJson, importJson, previewJson } from "./transfer";
export { rebuildState } from "./replay";

/**
 * The open database, opened once.
 *
 * Every caller gets the same promise, and the memo holds the *promise* rather
 * than the resolved repository so that two callers racing at startup — React
 * mounting two components, or an effect running twice under StrictMode — join
 * the same open instead of starting a second one. Opening twice is not fatal,
 * but it seeds defaults twice and rebuilds the cache twice, and a schema
 * upgrade running against two handles at once is the kind of thing that only
 * fails on someone else's phone.
 *
 * A failed open is not cached: the memo is cleared so the next caller tries
 * again. A browser can refuse IndexedDB for reasons that pass — a private
 * window, a storage prompt, another tab holding an upgrade — and an app that
 * remembered the first "no" forever would need a reload to recover from a
 * situation that had already resolved itself.
 *
 * There is no `name` parameter, on purpose. The app opens one database; a test
 * that wants its own calls `openDexieRepo` directly, and so cannot accidentally
 * share this memo with another test.
 */
let opening: Promise<Repo> | undefined;

export function openRepo(): Promise<Repo> {
  opening ??= openDexieRepo().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}
