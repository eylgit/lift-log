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
import type { LoggedSession, Repo, SessionOutcome, SessionQuery } from "./repo";
import type { EquipmentRow, SettingsRow } from "./schema";
import { LiftLogDb, SINGLETON_ID, ensureDefaults } from "./schema";
import type { Settings } from "./types";

/* --------------------------------------------------------------- helpers */

/**
 * Bounds for a `trainingDay` range query. Training days are `YYYY-MM-DD`
 * strings and IndexedDB compares strings lexicographically, so these sort
 * below and above every real day without needing a special key type.
 */
const FIRST_DAY = "0000-00-00";
const LAST_DAY = "9999-99-99";

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

  /** The sets of several sessions in one query, grouped and ordered. */
  private async setsOf(sessionIds: readonly SessionId[]): Promise<Map<SessionId, SetLog[]>> {
    const sets = await this.db.setLog
      .where("sessionId")
      .anyOf(sessionIds)
      .toArray();
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
 * Open the database, seed the setup rows if this is a fresh install, and hand
 * back the repository. This is the app's one entry point to storage; nothing
 * else should ever construct a `LiftLogDb`.
 */
export async function openDexieRepo(name?: string): Promise<Repo> {
  const db = new LiftLogDb(name);
  await db.open();
  await ensureDefaults(db);
  return createDexieRepo(db);
}
