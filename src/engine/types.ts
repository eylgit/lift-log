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

export type Exercise = {
  readonly id: ExerciseId;
  readonly name: string;
  readonly pattern: MovementPattern;
  /**
   * How much to add on a clean session. Kilograms (INV-1), and per-exercise:
   * a hinge absorbs 5 kg happily, an overhead press does not.
   *
   * This is what the engine *wants* to add. What it can actually add depends
   * on the equipment — see the weight ladder (B3).
   */
  readonly incrementKg: number;
  /** Search text for a form demo. The engine never fetches anything (INV-9). */
  readonly videoQuery: string;
};

/* ------------------------------------------------------------- equipment */

/** One size of plate, and how many pairs of it the athlete owns. */
export type Plate = {
  readonly massKg: number;
  readonly pairs: number;
};

/**
 * What the athlete can actually load, which decides which weights exist for
 * them. Knowing to add 2.5 kg is useless if 21 kg is not a number their kit
 * can make; the ladder (B3) turns this into the list of reachable weights.
 *
 * Discriminated on `kind`, so a `switch` over it is exhaustive.
 */
export type Equipment =
  /** The v1 default: a lightest weight and a fixed step, unbounded above. */
  | { readonly kind: "simple"; readonly minKg: number; readonly stepKg: number }
  /** A dial-a-weight dumbbell: same, but with a ceiling. */
  | {
      readonly kind: "adjustable";
      readonly minKg: number;
      readonly maxKg: number;
      readonly stepKg: number;
    }
  /** A rack of fixed dumbbells. Only these weights exist. */
  | { readonly kind: "fixed"; readonly weightsKg: readonly number[] }
  /**
   * A bar and plates. Reachable weights are the bar plus symmetric pairs.
   * The type is defined now so nothing downstream changes when B3 implements
   * it; until then the ladder may reject it.
   */
  | {
      readonly kind: "loadable";
      readonly barKg: number;
      readonly collarKg: number;
      readonly plates: readonly Plate[];
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
   * The weight the engine is working toward. It is *virtual*: it may sit
   * between two weights the equipment can make, and the ladder rounds it to
   * something loadable at prescription time. Keeping the target exact stops
   * repeated rounding from eating the increment.
   */
  readonly targetKg: number;
  /** Consecutive failed sessions. Three triggers the deload (B5). */
  readonly stallCount: number;
  readonly weakSide: Side;
};
