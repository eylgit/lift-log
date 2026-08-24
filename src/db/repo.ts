/**
 * The repository interface (C2).
 *
 * This is the only vocabulary the rest of the app has for talking about stored
 * data. Screens, the session runner and the replay in C3 all call these
 * methods; none of them knows whether a browser's IndexedDB, a native SQLite
 * file or a plain array is answering. `dexie-repo.ts` is the implementation
 * that exists today, and swapping it is the point of the exercise (§8.1).
 *
 * Two rules make that swap cheap, and they are worth stating before the
 * methods:
 *
 *   1. Nothing here mentions Dexie — not in a parameter, not in a return type,
 *      not in an import. The types are the engine's own, plus `Settings`.
 *      `tests/db-boundary.test.ts` fails the build if that ever slips.
 *   2. Every read filters out tombstones (INV-3, C2.4). A soft-deleted session
 *      is gone as far as this interface is concerned; it survives only in the
 *      export, which is `snapshot()` below and its own method precisely because
 *      it is the one caller that wants the deleted rows back (C4.1).
 *
 * On "append-only" (INV-2). `setLog` rows are never touched after they are
 * written: a correction is a new fact, not an edit. A `session` row is opened
 * when the athlete presses Start and closed when they finish, so three of its
 * fields — `actualKg`, and then `status`/`finishedAt` — are written after the
 * insert. That is a record being completed, not history being rewritten, and
 * the methods below are deliberately narrow so nothing else can be changed.
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
  TrainingDay,
} from "../engine";
import type { Settings } from "./types";

/* ---------------------------------------------------------------- queries */

/**
 * Which sessions to read. Every field is optional; an empty query means the
 * whole live log, which is what replay wants (C3.1).
 */
export type SessionQuery = {
  readonly exerciseId?: ExerciseId;
  /** Inclusive lower bound on `trainingDay`, `YYYY-MM-DD`. */
  readonly from?: TrainingDay;
  /** Inclusive upper bound on `trainingDay`. */
  readonly to?: TrainingDay;
  /**
   * Keep only the most recent N — applied last, after every other filter.
   * The result stays in chronological order; "most recent" describes which
   * sessions come back, not how they are sorted.
   */
  readonly limit?: number;
};

/**
 * A session with the sets that belong to it, in ordinal order.
 *
 * Replay and the history detail screen both want the pair, and asking for the
 * sets one session at a time is the classic way to make a fast local database
 * feel slow. Reading the log in a single call keeps that mistake out of the
 * screens rather than relying on everyone to remember it.
 */
export type LoggedSession = {
  readonly session: Session;
  readonly sets: readonly SetLog[];
};

/**
 * The whole database, minus the cache — everything an export must carry and an
 * import must put back (C4).
 *
 * It exists because this is the one caller that wants what every other read
 * here refuses to give it. `listSessions` filters tombstones (INV-3, C2.4);
 * a backup that did the same would quietly lose the record that a session was
 * deleted, and restoring it would resurrect the session. `sessions` below is
 * therefore the only read in this interface that includes them.
 *
 * `engineState` is missing, and that is the point. It is derived, and an import
 * rebuilds it from these rows (C3.1, C4.3), so putting it in the document would
 * be shipping a second answer next to the log it was computed from — with no
 * way to tell which one a future reader should believe. The build plan says
 * "every table"; this is every table that holds a fact.
 *
 * `exercises` is in rotation order, because that is where the order is kept
 * (see `listExercises`).
 */
export type Snapshot = {
  readonly exercises: readonly Exercise[];
  readonly equipment: Equipment;
  readonly settings: Settings;
  /** Every session ever written, tombstones included. */
  readonly sessions: readonly Session[];
  /** Every set, including those belonging to a deleted session. */
  readonly sets: readonly SetLog[];
};

/**
 * How a session ended. `planned` is missing on purpose: this closes a session,
 * and reopening one is not a thing the app does.
 */
export type SessionOutcome = {
  readonly status: "complete" | "abandoned";
  readonly finishedAt: Instant;
  readonly note?: string | null;
};

/* ------------------------------------------------------------- repository */

export interface Repo {
  /* ----------------------------------------------------------- the setup */

  /**
   * The five lifts, in rotation order (INV-6).
   *
   * That order is a storage concern rather than an engine one, which is why
   * `Exercise` carries no position field: the engine is asked "what is next for
   * *this* lift" and never needs to know which day of the rotation it is. The
   * order is kept alongside the row here and the array below is what defines it.
   */
  listExercises(): Promise<readonly Exercise[]>;

  /**
   * Replace the rotation. **Array position is rotation position** — pass all
   * five, in order, every time, and changing one lift (D5.4) means reading the
   * rotation, swapping an entry and saving the lot. With five rows that is
   * cheaper than any scheme where the order can drift out of step with the rows.
   */
  saveRotation(exercises: readonly Exercise[]): Promise<void>;

  getEquipment(): Promise<Equipment>;
  saveEquipment(equipment: Equipment): Promise<void>;

  getSettings(): Promise<Settings>;
  /** Merge a partial change and return the settings as they now stand. */
  saveSettings(patch: Partial<Settings>): Promise<Settings>;

  /* ------------------------------------------------------------ the log */

  /** Write a new session. Its sets arrive afterwards, side by side (D2.5). */
  appendSession(session: Session): Promise<void>;

  /**
   * Record what is actually on the bar. Separate from `finishSession` because
   * the athlete can correct the weight mid-session (INV-7, D5.5), and
   * progression is measured from what was lifted rather than what was asked
   * for (§6.2).
   */
  setActualKg(id: SessionId, actualKg: number): Promise<void>;

  /** Close a session. The only call that writes `status` and `finishedAt`. */
  finishSession(id: SessionId, outcome: SessionOutcome): Promise<void>;

  /**
   * Append logged sets. Takes an array because a set is two sides and the
   * session screen writes after each one; one call, one transaction.
   */
  appendSets(sets: readonly SetLog[]): Promise<void>;

  /**
   * Tombstone a session (INV-3, C2.4). The row stays, `deletedAt` is written,
   * and every read here stops returning it — including its sets.
   */
  softDeleteSession(id: SessionId, deletedAt: Instant): Promise<void>;

  /** A single session, or undefined if it never existed or was deleted. */
  getSession(id: SessionId): Promise<Session | undefined>;

  /**
   * The session left open by a session that was walked out of, if there is
   * one — the newest with status `planned`. This is what lets the app resume
   * on the exact side after a force-quit (D2.5).
   */
  getActiveSession(): Promise<Session | undefined>;

  /** Live sessions, oldest first. */
  listSessions(query?: SessionQuery): Promise<readonly Session[]>;

  /** The sets of one session, in ordinal order. Empty if it was deleted. */
  listSets(sessionId: SessionId): Promise<readonly SetLog[]>;

  /** Sessions with their sets, oldest first. The input to replay (C3.1). */
  readLog(query?: SessionQuery): Promise<readonly LoggedSession[]>;

  /* -------------------------------------------------------- the backup */

  /**
   * Read everything, tombstones and all, for the export (C4.1).
   *
   * Separate from the reads above rather than a flag on them, because the
   * tombstone rule is not a default to be overridden — it is what those methods
   * mean. One method that openly returns the deleted rows is easier to audit
   * than seven that might.
   */
  snapshot(): Promise<Snapshot>;

  /**
   * Replace everything with the contents of a snapshot (C4.3).
   *
   * Replace, not merge. Merging two logs would need a rule for what to do when
   * both hold a session with the same id and different sets, and there is no
   * honest answer — the athlete asked to restore a backup, and a restore that
   * left yesterday's mistake in place would not be one. The whole database is
   * the unit here, which is also why the import path is a file rather than a
   * sync (§9.3).
   *
   * `engineState` is dropped rather than restored, because a snapshot does not
   * carry it. The caller must rebuild it before anything reads a prescription;
   * `importJson` does exactly that, and doing it here would make this method
   * depend on the engine (C4.3, C3.1).
   *
   * An implementation must make this atomic if it can. A half-written restore —
   * new sessions, old sets — is the one state from which nothing can recover.
   */
  restore(snapshot: Snapshot): Promise<void>;

  /* --------------------------------------------------------- the cache */

  /**
   * The derived state (INV-2). Everything below can be thrown away and rebuilt
   * from the log, and C3 does exactly that after an import or a migration. If
   * a rebuild ever disagrees with what is stored here, what is stored here is
   * wrong.
   */
  getEngineState(exerciseId: ExerciseId): Promise<EngineState | undefined>;
  listEngineState(): Promise<readonly EngineState[]>;
  putEngineState(states: readonly EngineState[]): Promise<void>;
  clearEngineState(): Promise<void>;
}
