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
 *      export, which C4 will add as its own method precisely because it is the
 *      one caller that wants the deleted rows back.
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
