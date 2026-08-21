/**
 * The IndexedDB schema (C1).
 *
 * Six tables, in two groups, and the split is the same one the engine makes
 * (see `src/engine/types.ts`):
 *
 *   Setup    exercise, equipment, settings — how this athlete is configured.
 *   Facts    session, setLog — what happened. Append-only, never edited.
 *   Cache    engineState — derived, droppable, rebuilt by replay (C3).
 *
 * Everything above `src/db/` talks to the repository interface (C2) and never
 * imports Dexie. This file and `dexie-repo.ts` are the only places that know
 * which database is underneath, which is what makes the eventual swap to
 * native SQLite (Part J) a day's work rather than a rewrite.
 */

import Dexie, { type EntityTable } from "dexie";

import type {
  EngineState,
  Equipment,
  Exercise,
  Session,
  SetLog,
} from "../engine";
import { DEFAULT_STEP_KG, SESSION_SCHEME, STALLS_BEFORE_DELOAD } from "../engine";

/* -------------------------------------------------------------- settings */

/** Kilograms are what gets stored; pounds are a display conversion (§6.6). */
export type Units = "kg" | "lb";

/**
 * The app's preferences. One row, and the row is the whole of it.
 *
 * `stallThreshold` duplicates the engine's `STALLS_BEFORE_DELOAD` constant on
 * purpose: the engine keeps a default it can reason about with no database
 * present, and this is where the athlete's override will live once the settings
 * screen exists (G3). Until then it is written with the engine's value and read
 * back unchanged.
 */
export type Settings = {
  readonly units: Units;
  readonly restTargetS: number;
  readonly stallThreshold: number;
  /** ISO instant of the last successful export, or null if never (F3). */
  readonly lastExportedAt: string | null;
  /** What version of this schema wrote the data. Also goes in the export (C4). */
  readonly schemaVersion: number;
};

/* ------------------------------------------------------------ singletons */

/**
 * `equipment` and `settings` hold exactly one row each, but IndexedDB has no
 * notion of a one-row table — every store needs a key. Rather than invent an
 * auto-incrementing id nobody will ever read, both rows are stored under a
 * fixed key, so "the settings" is always `settings.get(SINGLETON_ID)` and a
 * second row cannot quietly appear.
 */
export const SINGLETON_ID = 1;

type Singleton = { readonly id: typeof SINGLETON_ID };

export type EquipmentRow = Equipment & Singleton;
export type SettingsRow = Settings & Singleton;

/* --------------------------------------------------------------- version */

/**
 * Bump this whenever the stores or their indexes change, add a `.version()`
 * block below, and give it an `upgrade()` if existing rows need rewriting.
 *
 * The versioning is here from the first schema, with nothing yet to migrate,
 * because it is very cheap now and very expensive later (C1.3). By the time a
 * field needs renaming there is a year of real training data in the browser and
 * no appetite whatsoever for wiping it.
 */
export const SCHEMA_VERSION = 1;

/* --------------------------------------------------------------- indexes */

/**
 * Dexie index declarations. The leading entry is the primary key; the rest are
 * secondary indexes, and each one exists because a query in C2 needs it.
 *
 * `session.deletedAt` is indexed but *not* used to find live rows: IndexedDB
 * cannot index null, so tombstoned rows are the only ones the index contains.
 * Reads filter in code (INV-3, C2.4); the index makes "list what was deleted"
 * cheap for the export, which must include tombstones (C4.1).
 */
const V1_STORES = {
  exercise: "id, pattern",
  equipment: "id",
  settings: "id",
  session: "id, exerciseId, trainingDay, deletedAt, [exerciseId+trainingDay]",
  setLog: "id, sessionId, [sessionId+ordinal]",
  engineState: "exerciseId",
} as const;

/* -------------------------------------------------------------- database */

/**
 * The database handle.
 *
 * Typed with `EntityTable` so the row types above are enforced at compile time
 * rather than trusted; a `Session` written here is the same `Session` the
 * engine consumes, with no separate persistence model to keep in step.
 */
export class LiftLogDb extends Dexie {
  declare exercise: EntityTable<Exercise, "id">;
  declare equipment: EntityTable<EquipmentRow, "id">;
  declare settings: EntityTable<SettingsRow, "id">;
  declare session: EntityTable<Session, "id">;
  declare setLog: EntityTable<SetLog, "id">;
  declare engineState: EntityTable<EngineState, "exerciseId">;

  constructor(name = "lift-log") {
    super(name);
    this.version(SCHEMA_VERSION).stores(V1_STORES);
  }
}

/* -------------------------------------------------------------- defaults */

/** The equipment row a fresh install starts with (G1). */
export const DEFAULT_EQUIPMENT: EquipmentRow = {
  id: SINGLETON_ID,
  stepKg: DEFAULT_STEP_KG,
};

/** The settings row a fresh install starts with (G1). */
export const DEFAULT_SETTINGS: SettingsRow = {
  id: SINGLETON_ID,
  units: "kg",
  restTargetS: SESSION_SCHEME.restMinutes * 60,
  stallThreshold: STALLS_BEFORE_DELOAD,
  lastExportedAt: null,
  schemaVersion: SCHEMA_VERSION,
};

/**
 * Write the setup rows if they are absent, and leave them alone if they are
 * not. Safe to call on every startup: it is how a fresh database acquires its
 * defaults without a separate install step, and a no-op thereafter.
 */
export async function ensureDefaults(db: LiftLogDb): Promise<void> {
  await db.transaction("rw", db.equipment, db.settings, async () => {
    if ((await db.equipment.get(SINGLETON_ID)) === undefined) {
      await db.equipment.add(DEFAULT_EQUIPMENT);
    }
    if ((await db.settings.get(SINGLETON_ID)) === undefined) {
      await db.settings.add(DEFAULT_SETTINGS);
    }
  });
}
