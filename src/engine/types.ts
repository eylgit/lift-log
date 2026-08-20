/**
 * The engine's data model (B2).
 *
 * Two kinds of thing live here, and the split is the design:
 *
 *   Facts     Session, SetLog — what happened. Append-only, never edited.
 *   Derived   Prescription, EngineState — what to do next. Computed by
 *             replaying the facts, never treated as a source of truth (INV-2).
 *
 * Exercise and Equipment are neither: they describe the athlete's setup.
 *
 * Nothing here imports from the shell. See tests/engine-purity.test.ts.
 */

/* ------------------------------------------------------------------ ids */

/** Opaque identifiers. Strings so they survive JSON export unchanged (C4). */
export type ExerciseId = string;
export type SessionId = string;
export type SetLogId = string;

/**
 * An instant, ISO 8601, UTC. Use this for *when something happened*.
 * Never derive the training day from one of these — see TrainingDay.
 */
export type Instant = string;

/**
 * The local calendar day a session belongs to, `YYYY-MM-DD`, with a 3 a.m.
 * cutoff so a late-night session counts as the day it felt like (INV-5).
 * It is its own field precisely so it never has to be recovered from a UTC
 * timestamp in another timezone.
 */
export type TrainingDay = string;

/* -------------------------------------------------------------- exercise */

/** The five movement patterns of the rotation. One lift a day, in order. */
export type MovementPattern =
  | "squat"
  | "hip hinge"
  | "vertical push"
  | "horizontal push"
  | "horizontal pull";

/**
 * Every lift is single-sided, so every set has a side. The weaker side is
 * trained first, while fresh, and it sets the standard for both.
 */
export type Side = "left" | "right";

/**
 * One lift in the rotation.
 *
 * Note what is *not* here: a per-exercise increment. How much to add on a clean
 * session is the athlete's step, the same for every lift (see Equipment, and
 * `lift-log-design.md` §6.1). A hinge would absorb a bigger jump than an
 * overhead press does, but buying that costs a second number that disagrees
 * with the one on the screen.
 */
export type Exercise = {
  readonly id: ExerciseId;
  readonly name: string;
  readonly pattern: MovementPattern;
  /** Search text for a form demo. The engine never fetches anything (INV-9). */
  readonly videoQuery: string;
};

/* ------------------------------------------------------------- equipment */

/**
 * The default step, and so the default rate of progress: one of these per clean
 * session. Overridable in settings (G3.1), and nothing else about the athlete's
 * kit is asked for.
 */
export const DEFAULT_STEP_KG = 1;

/**
 * The one thing the engine needs to know about the athlete's kit: the smallest
 * jump they can make.
 *
 * It is also the increment: a clean session adds exactly one step (B3). The
 * reachable weights are therefore the multiples of `stepKg` — 2.5 gives 2.5, 5,
 * 7.5, 17.5, 20, and so on. They are anchored at zero rather than at a separate
 * "lightest weight", because a lightest weight that is not itself a multiple of
 * the step puts every familiar number off the grid: a 1 kg minimum with a 2.5 kg
 * step yields 1, 3.5, 6, 8.5 and never 17.5. Anchoring at zero stays on-grid at
 * any step size, and makes the lightest weight one step.
 *
 * The price of one number instead of two: the athlete cannot progress in
 * increments smaller than their lightest plate. Micro-plates are cheaper than
 * the machinery that would avoid this.
 *
 * Deliberately not a union over dumbbell types. One number describes a rack, an
 * adjustable dumbbell and a loaded bar equally well for the only question the
 * engine asks: which weights exist? A plate inventory is a settings screen that
 * buys nothing (G1.1, G3.2).
 */
export type Equipment = {
  readonly stepKg: number;
};

/* ----------------------------------------------------------------- facts */

/**
 * One set, on one side, as it actually went. A fact: written once, never
 * edited. A correction is a new fact, not an overwrite.
 */
export type SetLog = {
  readonly id: SetLogId;
  readonly sessionId: SessionId;
  /** Position within the session, from 0. Both sides of set one, then set two. */
  readonly ordinal: number;
  readonly side: Side;
  readonly targetReps: number;
  /**
   * Reps completed — a number, not a pass/fail flag (INV-4). Four reps is a
   * near miss and one rep is a collapse; the engine can only tell them apart
   * if the difference was written down.
   */
  readonly doneReps: number;
  readonly loggedAt: Instant;
};

export type SessionStatus =
  /** Prescribed, not yet started. */
  | "planned"
  /** Every set logged. Only these count toward progression. */
  | "complete"
  /** Started and walked away from. Kept as a fact; never silently discarded. */
  | "abandoned";

/**
 * One training day for one lift. The sets belong to it. A fact, like SetLog.
 */
export type Session = {
  readonly id: SessionId;
  readonly exerciseId: ExerciseId;
  readonly startedAt: Instant;
  /** null while planned or abandoned mid-session. */
  readonly finishedAt: Instant | null;
  readonly trainingDay: TrainingDay;
  /** What the engine asked for, in kg. Kept so a stall is explicable later. */
  readonly prescribedKg: number;
  /** What was actually lifted. Differs when the athlete overrode it (INV-7). */
  readonly actualKg: number;
  readonly status: SessionStatus;
  readonly note: string | null;
  /**
   * Tombstone (INV-3). Deleting sets this; every read filters it out. The
   * record stays in the log and in the export, because a fact that happened
   * cannot be made not to have happened.
   */
  readonly deletedAt: Instant | null;
};

/* --------------------------------------------------------------- derived */

/**
 * What to do today. Computed from the log every time it is needed and never
 * stored (INV-2) — storing it would create a second answer that could drift
 * from the log.
 */
export type Prescription = {
  readonly exercise: Exercise;
  /** Kilograms, and always a weight the equipment can actually make. */
  readonly weightKg: number;
  readonly repsPerSide: number;
  readonly sets: number;
  readonly restMinutes: number;
  /** Trained first, while fresh. */
  readonly weakSide: Side;
};

/**
 * A derived cache, not a source of truth.
 *
 * Everything here can be rebuilt by replaying the whole log, and C3 does
 * exactly that after every import and migration. If a rebuild ever disagrees
 * with the cache, the cache is wrong — never the log.
 */
export type EngineState = {
  readonly exerciseId: ExerciseId;
  /**
   * The weight to prescribe next, in kg. Always a whole multiple of the step,
   * because it only ever got here by adding steps to a weight that already was
   * — the two exceptions go through `snapToStep` (B3.2). What the engine says
   * and what the athlete loads are the same number.
   */
  readonly currentKg: number;
  /** Consecutive failed sessions. Three triggers the deload (B5). */
  readonly stallCount: number;
  readonly weakSide: Side;
};
