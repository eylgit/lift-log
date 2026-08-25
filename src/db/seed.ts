/**
 * Filling the database, and emptying it (G2).
 *
 * Two whole-database writes live here, and they are here rather than in
 * `src/sample.ts` for the reason C2.3 gives about every other file in this
 * folder: they need `DEFAULT_ROTATION` and `DEFAULT_SETTINGS`, which are in
 * `schema.ts`, which imports Dexie. The generator that makes the sample log
 * knows nothing about storage and must keep knowing nothing.
 *
 * Both go through `repo.restore()` — the same path an import takes (C4.3) — and
 * both end with `rebuildState`. That is not incidental. `restore` clears
 * `engineState` and does not refill it, deliberately, because a cache built from
 * a log that no longer exists is exactly the silent wrongness INV-2 exists to
 * prevent. Whoever replaces the log owns rebuilding the cache from it.
 */

import type { Equipment, Exercise } from "../engine";
import { rebuildState } from "./replay";
import type { Repo, Snapshot } from "./repo";
import {
  DEFAULT_EQUIPMENT,
  DEFAULT_ROTATION,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
} from "./schema";
import type { Settings } from "./types";

/** The shipped rotation without its storage-only `order` column. */
function defaultRotation(): readonly Exercise[] {
  return DEFAULT_ROTATION.map(({ order: _order, ...exercise }) => exercise);
}

/** The shipped settings without the singleton key `Repo` never exposes. */
function defaultSettings(): Settings {
  const { id: _id, ...settings } = DEFAULT_SETTINGS;
  return settings;
}

/** Likewise the equipment row: one number, and the key is storage's business. */
function defaultEquipment(): Equipment {
  const { id: _id, ...equipment } = DEFAULT_EQUIPMENT;
  return equipment;
}

/**
 * Replace the whole database, and rebuild the cache from what was written.
 *
 * `schemaVersion` is stamped here rather than trusted from the snapshot, the
 * same way `importJson` stamps it: these rows are being written by *this*
 * build, whatever wrote the values.
 */
export async function replaceAll(repo: Repo, snapshot: Snapshot): Promise<void> {
  await repo.restore({
    ...snapshot,
    settings: { ...snapshot.settings, schemaVersion: SCHEMA_VERSION },
  });
  await rebuildState(repo);
}

/**
 * Put the database back to a fresh install (G2.2, G3.1).
 *
 * Everything: the log, the rotation, the step and the settings. What it does
 * *not* do is preserve a single field across the wipe, and that is the whole
 * design of it — "start real" means the athlete gets the app a stranger gets,
 * including being asked the three setup questions again, because the answers
 * they are throwing away belonged to somebody fictional.
 *
 * The one thing worth stating plainly: this is the only destructive operation
 * in the app that is not a session delete, and it is unrecoverable. INV-3 says
 * facts are never removed — that is a rule about *editing* the log, and this
 * does not edit it, it discards the whole database. The screens that reach it
 * confirm first and say so in those words.
 */
export async function resetToDefaults(repo: Repo): Promise<void> {
  await replaceAll(repo, {
    exercises: defaultRotation(),
    equipment: defaultEquipment(),
    settings: defaultSettings(),
    sessions: [],
    sets: [],
  });
}
