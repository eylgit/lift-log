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
import type { Settings } from "./types";

/** Re-exported so `schema.ts` remains the one import for anything row-shaped. */
export type { Settings, Units } from "./types";

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

/* -------------------------------------------------------------- rotation */

/**
 * An exercise, plus where it sits in the rotation.
 *
 * The position is stored here rather than on the engine's `Exercise` because
 * the engine never asks what day it is — it is handed one lift and a history
 * and answers for that lift (INV-6, §6). Which lift comes next is the shell's
 * question, so the answer lives at the storage boundary.
 *
 * `order` is not indexed and does not need to be: five rows sort in memory
 * faster than IndexedDB can open a cursor. That also means adding this field
 * needed no schema version bump — IndexedDB stores whole objects and only the
 * declared indexes are part of the version.
 */
export type ExerciseRow = Exercise & { readonly order: number };

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
  declare exercise: EntityTable<ExerciseRow, "id">;
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

/**
 * The rotation a fresh install starts with (G1).
 *
 * Five lifts, one per movement pattern, in the order they come round. Every
 * `startKg` is one step, which is what onboarding will default them to and for
 * the same reason: the only start weight that cannot be wrong is one that is
 * absurdly light (G1.2, and the note on `Exercise.startKg`). The athlete moves
 * it, either through onboarding or by tapping the weight on the Today card
 * (INV-7, D5) — until then the card honestly reads `1 kg` and says the lift has
 * never been trained.
 *
 * The weak sides are a guess for the same reason and flip with a tap. Left is
 * the default because it is the non-dominant side for most people, which is the
 * same answer onboarding gives to "I don't know".
 *
 * This exists because Part D has to run on *something* and Part G is where the
 * athlete is actually asked. `saveRotation` replaces the lot, so nothing here
 * survives onboarding — it is a starting position, not a preference.
 */
export const DEFAULT_ROTATION: readonly ExerciseRow[] = [
  { id: "split-squat", name: "Bulgarian Split Squat",     pattern: "squat",           videoQuery: "bulgarian split squat form",     startKg: DEFAULT_STEP_KG, weakSide: "left",  order: 0 },
  { id: "press",       name: "Single-Arm Shoulder Press", pattern: "vertical push",   videoQuery: "single arm dumbbell press form", startKg: DEFAULT_STEP_KG, weakSide: "left",  order: 1 },
  { id: "deadlift",    name: "Single-Leg Deadlift",       pattern: "hip hinge",       videoQuery: "single leg romanian deadlift",   startKg: DEFAULT_STEP_KG, weakSide: "left",  order: 2 },
  { id: "bench",       name: "Single-Arm Bench Press",    pattern: "horizontal push", videoQuery: "single arm dumbbell bench press",startKg: DEFAULT_STEP_KG, weakSide: "left",  order: 3 },
  { id: "row",         name: "Single-Arm Row",            pattern: "horizontal pull", videoQuery: "single arm dumbbell row form",   startKg: DEFAULT_STEP_KG, weakSide: "left",  order: 4 },
];

/** The equipment row a fresh install starts with (G1). */
export const DEFAULT_EQUIPMENT: EquipmentRow = {
  id: SINGLETON_ID,
  stepKg: DEFAULT_STEP_KG,
};

/**
 * The settings row a fresh install starts with (G1).
 *
 * Fields have been added here since v1 — `lastNudgedAt` in F3 — with no schema
 * version bump, for the reason `ExerciseRow` gives above: IndexedDB stores whole
 * objects and only the declared indexes are part of the version. A row written
 * by an older build simply lacks the field, which reads as `undefined`; every
 * caller treats that as null, and the next `saveSettings` writes it properly.
 */
export const DEFAULT_SETTINGS: SettingsRow = {
  id: SINGLETON_ID,
  units: "kg",
  restTargetS: SESSION_SCHEME.restMinutes * 60,
  stallThreshold: STALLS_BEFORE_DELOAD,
  lastExportedAt: null,
  lastNudgedAt: null,
  schemaVersion: SCHEMA_VERSION,
};

/**
 * Write the setup rows if they are absent, and leave them alone if they are
 * not. Safe to call on every startup: it is how a fresh database acquires its
 * defaults without a separate install step, and a no-op thereafter.
 *
 * The rotation is seeded on the same terms, and the test is "is the table
 * empty" rather than "is this lift missing". Merging row by row would put a
 * lift back after the athlete dropped it from the rotation, on the next open,
 * with no way to refuse — `saveRotation` says array position is rotation
 * position and a five-row table is the whole statement (C2.1). An empty table
 * is the one state that cannot be a decision anyone made.
 */
export async function ensureDefaults(db: LiftLogDb): Promise<void> {
  await db.transaction("rw", db.exercise, db.equipment, db.settings, async () => {
    if ((await db.exercise.count()) === 0) {
      await db.exercise.bulkAdd([...DEFAULT_ROTATION]);
    }
    if ((await db.equipment.get(SINGLETON_ID)) === undefined) {
      await db.equipment.add(DEFAULT_EQUIPMENT);
    }
    if ((await db.settings.get(SINGLETON_ID)) === undefined) {
      await db.settings.add(DEFAULT_SETTINGS);
    }
  });
}
