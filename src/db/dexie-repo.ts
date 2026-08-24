/**
 * The Dexie implementation of the repository (C2.2).
 *
 * Together with `schema.ts` this is the only code in the project that knows the
 * data lives in IndexedDB. Everything above it holds a `Repo` (C2.3), so
 * replacing this file with a SQLite one for the native build (Part J) is a
 * day's work rather than a rewrite.
 *
 * Three things are done consistently here and are worth reading once:
 *
 *   Tombstones never escape. Every read drops sessions with a `deletedAt`, and
 *   a deleted session's sets go with it (INV-3, C2.4).
 *
 *   Order is decided here, not by the caller. Sessions come back oldest first,
 *   by training day and then by when they started; sets come back by ordinal.
 *   A screen that wants them newest first reverses them, and none of them has
 *   to remember how to sort a log correctly.
 *
 *   A write to a session that is missing or deleted throws. IndexedDB is happy
 *   to update nothing at all and report success, which turns a wrong id into a
 *   silent no-op — "why didn't my weight change" is a bad afternoon.
 */

import type {
  EngineState,
  Equipment,
  Exercise,
  ExerciseId,
  Instant,
  Session,
  SessionId,
  SetLog,
} from "../engine";
import { rebuildIfMigrated } from "./replay";
import type { LoggedSession, Repo, SessionOutcome, SessionQuery, Snapshot } from "./repo";
import type { EquipmentRow, SettingsRow } from "./schema";
import { LiftLogDb, SCHEMA_VERSION, SINGLETON_ID, ensureDefaults } from "./schema";
import type { Settings } from "./types";

/* --------------------------------------------------------------- helpers */

/**
 * Bounds for a `trainingDay` range query. Training days are `YYYY-MM-DD`
 * strings and IndexedDB compares strings lexicographically, so these sort
 * below and above every real day without needing a special key type.
 */
const FIRST_DAY = "0000-00-00";
const LAST_DAY = "9999-99-99";

/**
 * Above this many sessions, read the whole `setLog` table and group in memory
 * rather than seeking to each session's sets. See `setsOf`.
 *
 * The number is not tuned; it only has to sit above what a screen asks for and
 * below a year. Today (one session) and the history detail (one) are at the
 * bottom of the range, and the log reads that matter — the export, the chart,
 * replay — are hundreds.
 */
const SETS_BY_SCAN_FROM = 32;

/** INV-3: a session with a tombstone is not there as far as any read cares. */
function isLive(session: Session): boolean {
  return session.deletedAt === null;
}

/**
 * Log order. `trainingDay` first because that is the day the athlete means
 * (INV-5), `startedAt` to separate two sessions on one day, and the id last so
 * the order is total — an unstable sort would otherwise make the same log read
 * back in two different orders, and replay must be reproducible (C3.3).
 */
function chronologically(a: Session, b: Session): number {
  return (
    a.trainingDay.localeCompare(b.trainingDay) ||
    a.startedAt.localeCompare(b.startedAt) ||
    a.id.localeCompare(b.id)
  );
}

function byOrdinal(a: SetLog, b: SetLog): number {
  return a.ordinal - b.ordinal;
}

/** Drop the fixed key the singleton tables need; callers deal in the type itself. */
function withoutId<T>({ id: _id, ...rest }: T & { id: number }): T {
  return rest as unknown as T;
}

/* ------------------------------------------------------------ repository */

class DexieRepo implements Repo {
  constructor(private readonly db: LiftLogDb) {}

  /* ----------------------------------------------------------- the setup */

  async listExercises(): Promise<readonly Exercise[]> {
    const rows = await this.db.exercise.toArray();
    return rows.sort((a, b) => a.order - b.order).map(({ order: _order, ...e }) => e);
  }

  async saveRotation(exercises: readonly Exercise[]): Promise<void> {
    const rows = exercises.map((exercise, order) => ({ ...exercise, order }));
    await this.db.transaction("rw", this.db.exercise, async () => {
      // Replace rather than merge: array position *is* rotation position, so a
      // lift dropped from the array is gone from the rotation, not left behind
      // at whatever position it used to hold.
      await this.db.exercise.clear();
      await this.db.exercise.bulkAdd(rows);
    });
  }

  async getEquipment(): Promise<Equipment> {
    const row = await this.db.equipment.get(SINGLETON_ID);
    if (row === undefined) throw new Error(missingSetup("equipment"));
    return withoutId(row);
  }

  async saveEquipment(equipment: Equipment): Promise<void> {
    const row: EquipmentRow = { ...equipment, id: SINGLETON_ID };
    await this.db.equipment.put(row);
  }

  async getSettings(): Promise<Settings> {
    const row = await this.db.settings.get(SINGLETON_ID);
    if (row === undefined) throw new Error(missingSetup("settings"));
    return withoutId(row);
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.db.transaction("rw", this.db.settings, async () => {
      const row = await this.db.settings.get(SINGLETON_ID);
      if (row === undefined) throw new Error(missingSetup("settings"));
      const merged: SettingsRow = { ...row, ...patch, id: SINGLETON_ID };
      await this.db.settings.put(merged);
      return withoutId(merged);
    });
  }

  /* ------------------------------------------------------------- the log */

  async appendSession(session: Session): Promise<void> {
    // `add`, not `put`: reusing an id would overwrite a fact.
    await this.db.session.add(session);
  }

  async setActualKg(id: SessionId, actualKg: number): Promise<void> {
    await this.amend(id, { actualKg }, "set the weight");
  }

  async finishSession(id: SessionId, outcome: SessionOutcome): Promise<void> {
    const { status, finishedAt, note } = outcome;
    await this.amend(
      id,
      note === undefined ? { status, finishedAt } : { status, finishedAt, note },
      "finish",
    );
  }

  async appendSets(sets: readonly SetLog[]): Promise<void> {
    await this.db.setLog.bulkAdd(sets);
  }

  async softDeleteSession(id: SessionId, deletedAt: Instant): Promise<void> {
    await this.db.transaction("rw", this.db.session, async () => {
      const session = await this.db.session.get(id);
      if (session === undefined) throw new Error(`Cannot delete session ${id}: it does not exist.`);
      // Already tombstoned: keep the first timestamp. Overwriting it would
      // misreport when the athlete actually deleted the session.
      if (!isLive(session)) return;
      await this.db.session.update(id, { deletedAt });
    });
  }

  async getSession(id: SessionId): Promise<Session | undefined> {
    const session = await this.db.session.get(id);
    return session !== undefined && isLive(session) ? session : undefined;
  }

  async getActiveSession(): Promise<Session | undefined> {
    // Newest first, stopping at the first match — the common case is that the
    // most recent session is the open one, or that there is no open one and
    // this walks a handful of rows.
    return this.db.session
      .orderBy("trainingDay")
      .reverse()
      .filter((s) => isLive(s) && s.status === "planned")
      .first();
  }

  async listSessions(query: SessionQuery = {}): Promise<readonly Session[]> {
    const rows = await this.select(query);
    const live = rows.filter(isLive).sort(chronologically);
    const { limit } = query;
    return limit === undefined ? live : live.slice(Math.max(0, live.length - limit));
  }

  async listSets(sessionId: SessionId): Promise<readonly SetLog[]> {
    const session = await this.db.session.get(sessionId);
    if (session === undefined || !isLive(session)) return [];
    const bySession = await this.setsOf([sessionId]);
    return bySession.get(sessionId) ?? [];
  }

  async readLog(query: SessionQuery = {}): Promise<readonly LoggedSession[]> {
    const sessions = await this.listSessions(query);
    if (sessions.length === 0) return [];
    const bySession = await this.setsOf(sessions.map((s) => s.id));
    return sessions.map((session) => ({ session, sets: bySession.get(session.id) ?? [] }));
  }

  /* ---------------------------------------------------------- the backup */

  /**
   * Everything, tombstones included (C4.1).
   *
   * Both tables are read whole rather than through an index. That is the right
   * shape here for the reason `setsOf` explains at length: the export wants
   * every row, and a year of them is a few hundred (§7).
   *
   * The ordering is not decoration. Two exports of the same database must be
   * the same bytes, or a diff between yesterday's backup and today's is
   * unreadable — so sessions come back in log order and each session's sets
   * follow it, by ordinal. Sets whose session has vanished sort last; nothing
   * should produce one, and dropping them silently is how a backup loses a fact.
   */
  async snapshot(): Promise<Snapshot> {
    const [exercises, equipment, settings, sessions, sets] = await Promise.all([
      this.listExercises(),
      this.getEquipment(),
      this.getSettings(),
      this.db.session.toArray(),
      this.db.setLog.toArray(),
    ]);

    sessions.sort(chronologically);
    const position = new Map(sessions.map((session, index) => [session.id, index]));
    const place = (set: SetLog) => position.get(set.sessionId) ?? sessions.length;
    sets.sort(
      (a, b) =>
        place(a) - place(b) ||
        a.sessionId.localeCompare(b.sessionId) ||
        a.ordinal - b.ordinal ||
        a.id.localeCompare(b.id),
    );

    return { exercises, equipment, settings, sessions, sets };
  }

  /**
   * Replace every table with the snapshot's rows (C4.3).
   *
   * One transaction over all six stores, so a restore that fails partway leaves
   * the database as it was. That is the whole reason this is a repository method
   * rather than a loop over the existing writers: `saveRotation`, `appendSession`
   * and `appendSets` would do the same work in four transactions, and a crash
   * between two of them would leave sessions with no sets and no way to tell.
   *
   * `bulkAdd`, not `bulkPut`, on tables that were just cleared: a duplicate id
   * inside the document should fail loudly here rather than silently keep the
   * last of the pair. `importJson` catches most of those first, with a better
   * message; this is the backstop that makes it safe to be wrong about that.
   *
   * `engineState` is cleared and not refilled. The snapshot has no cache in it,
   * and leaving the old one behind — built from a log that no longer exists — is
   * exactly the silent wrongness INV-2 exists to prevent. `importJson` rebuilds
   * it immediately; until then the table is honestly empty.
   */
  async restore(snapshot: Snapshot): Promise<void> {
    const { exercises, equipment, settings, sessions, sets } = snapshot;
    const tables = [
      this.db.exercise,
      this.db.equipment,
      this.db.settings,
      this.db.session,
      this.db.setLog,
      this.db.engineState,
    ];
    await this.db.transaction("rw", tables, async () => {
      for (const table of tables) await table.clear();
      await this.db.exercise.bulkAdd(exercises.map((exercise, order) => ({ ...exercise, order })));
      await this.db.equipment.add({ ...equipment, id: SINGLETON_ID });
      await this.db.settings.add({ ...settings, id: SINGLETON_ID });
      await this.db.session.bulkAdd([...sessions]);
      await this.db.setLog.bulkAdd([...sets]);
    });
  }

  /* ----------------------------------------------------------- the cache */

  async getEngineState(exerciseId: ExerciseId): Promise<EngineState | undefined> {
    return this.db.engineState.get(exerciseId);
  }

  async listEngineState(): Promise<readonly EngineState[]> {
    return this.db.engineState.toArray();
  }

  async putEngineState(states: readonly EngineState[]): Promise<void> {
    await this.db.engineState.bulkPut(states);
  }

  async clearEngineState(): Promise<void> {
    await this.db.engineState.clear();
  }

  /* --------------------------------------------------------- internals */

  /**
   * The narrowest index that answers the query, then everything else is done in
   * memory. A year of training is a few hundred rows (§7), so the point of
   * using an index at all is to avoid reading a decade of them to draw one
   * exercise's chart — not to shave milliseconds off a sort.
   */
  private async select({ exerciseId, from, to }: SessionQuery): Promise<Session[]> {
    const lo = from ?? FIRST_DAY;
    const hi = to ?? LAST_DAY;
    const dayBounded = from !== undefined || to !== undefined;

    if (exerciseId !== undefined) {
      return dayBounded
        ? this.db.session
            .where("[exerciseId+trainingDay]")
            .between([exerciseId, lo], [exerciseId, hi], true, true)
            .toArray()
        : this.db.session.where("exerciseId").equals(exerciseId).toArray();
    }
    return dayBounded
      ? this.db.session.where("trainingDay").between(lo, hi, true, true).toArray()
      : this.db.session.toArray();
  }

  /**
   * The sets of several sessions in one query, grouped and ordered.
   *
   * Two strategies, because one of them falls off a cliff. `anyOf` reaches
   * straight to the rows it wants, which is what a screen showing one session
   * should do — but it repositions the cursor once per key, and asking for a
   * year at a time turns that into hundreds of seeks through a table small
   * enough to read whole. Measured on the B7.3 year (355 sessions, 2,126 sets)
   * under `fake-indexeddb`: `anyOf` took 5.4 seconds and reading the table took
   * 11 milliseconds. A real IndexedDB is faster at both, and the shape of the
   * difference is the same.
   *
   * That matters here rather than in theory: `readLog()` with no query is the
   * whole log, and replay asks for it on every import and every migration (C3).
   */
  private async setsOf(sessionIds: readonly SessionId[]): Promise<Map<SessionId, SetLog[]>> {
    const wanted = new Set(sessionIds);
    const sets =
      sessionIds.length > SETS_BY_SCAN_FROM
        ? (await this.db.setLog.toArray()).filter((set) => wanted.has(set.sessionId))
        : await this.db.setLog.where("sessionId").anyOf(sessionIds).toArray();
    const bySession = new Map<SessionId, SetLog[]>();
    for (const set of sets) {
      const existing = bySession.get(set.sessionId);
      if (existing === undefined) bySession.set(set.sessionId, [set]);
      else existing.push(set);
    }
    for (const group of bySession.values()) group.sort(byOrdinal);
    return bySession;
  }

  /**
   * Write the few session fields that are allowed to change after the insert
   * (see the note on append-only in `repo.ts`), refusing to touch a row that is
   * absent or tombstoned.
   */
  private async amend(id: SessionId, changes: Partial<Session>, what: string): Promise<void> {
    await this.db.transaction("rw", this.db.session, async () => {
      const session = await this.db.session.get(id);
      if (session === undefined) throw new Error(`Cannot ${what}: session ${id} does not exist.`);
      if (!isLive(session)) throw new Error(`Cannot ${what}: session ${id} was deleted.`);
      await this.db.session.update(id, changes);
    });
  }
}

function missingSetup(table: string): string {
  return `The ${table} row is missing. Open the database with openDexieRepo(), which seeds it.`;
}

/* -------------------------------------------------------------- factories */

/** Wrap an already-open database. The tests and C3's replay use this. */
export function createDexieRepo(db: LiftLogDb): Repo {
  return new DexieRepo(db);
}

/**
 * Open the database, seed the setup rows if this is a fresh install, rebuild
 * the engine cache if a migration has happened, and hand back the repository.
 * This is the app's one entry point to storage; nothing else should ever
 * construct a `LiftLogDb`.
 *
 * The rebuild is here rather than left to the caller because there is no
 * useful moment between opening the database and using it, and a cache built
 * by an older version of the progression rules is exactly the kind of wrong
 * that never announces itself (C3.2). On a fresh install and on every ordinary
 * open it is one read of the settings row and nothing else.
 */
export async function openDexieRepo(name?: string): Promise<Repo> {
  const db = new LiftLogDb(name);
  await db.open();
  await ensureDefaults(db);
  const repo = createDexieRepo(db);
  await rebuildIfMigrated(repo, SCHEMA_VERSION);
  return repo;
}
