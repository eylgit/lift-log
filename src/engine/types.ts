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
 * One lift in the rotation, and the athlete's setup for it.
 *
 * The last two fields are the answers onboarding collects (G1.2, G1.3), and
 * they are here rather than in `EngineState` for a reason worth stating once.
 *
 * `EngineState` is a cache: replay drops it and rebuilds it from the log (C3,
 * INV-2). Neither of these values can be rebuilt that way. A start weight is
 * the opening balance — replaying a log of additions without one gives the
 * wrong total, and an untrained lift has no log at all to replay. A weak side
 * is not a total of anything: no session changes it, and the engine only ever
 * reads it. Both were homeless, and a cache is the one place a fact that
 * cannot be recomputed must never live.
 *
 * They belong here because this type is already the athlete's setup rather
 * than a fact or a derivation — see the header of this file. Storing them here
 * is what lets `rebuildState()` mean what it says.
 *
 * Note what is still *not* here: a per-exercise increment. How much to add on a
 * clean session is the athlete's step, the same for every lift (see Equipment,
 * and `lift-log-design.md` §6.1). A hinge would absorb a bigger jump than an
 * overhead press does, but buying that costs a second number that disagrees
 * with the one on the screen.
 */
export type Exercise = {
  readonly id: ExerciseId;
  readonly name: string;
  readonly pattern: MovementPattern;
  /** Search text for a form demo. The engine never fetches anything (INV-9). */
  readonly videoQuery: string;
  /**
   * Where this lift starts, in kg, until a session has been logged for it.
   *
   * Onboarding defaults all five to a single step and says start absurdly light
   * (G1.2); it is tap-editable like every other weight (INV-7). After the first
   * completed session it stops mattering — the log takes over — but it is kept
   * rather than consumed, because replay starts from the beginning every time.
   */
  readonly startKg: number;
  /**
   * Trained first, while fresh, and it sets the standard for both sides
   * (`lift-log-design.md` §6.4). Onboarding asks, with "I don't know" defaulting
   * to the left, and tapping it flips it (INV-7).
   */
  readonly weakSide: Side;
};

/* ------------------------------------------------------------- equipment */

/**
 * The default step, and so the default rate of progress: one of these per clean
 * session. Overridable in settings (G3.1), and nothing else about the athlete's
 * kit is asked for.
 */
export const DEFAULT_STEP_KG = 1;

/**
 * How much the athlete *intends* to add on a clean session. One number, set in
 * settings (G3.1), and the only thing the engine knows about their kit.
 *
 * It is an aspiration, not a constraint. `stepKg` makes no claim about which
 * weights can be loaded, and the engine never rounds a weight to fit it. That
 * distinction is the whole of this comment, so it is worth being clear about
 * why the obvious reading was dropped.
 *
 * The obvious reading is that the reachable weights are the multiples of the
 * step, so every number the engine produces should be snapped onto that grid.
 * It does not survive contact with real kit. A fixed dumbbell rack runs 5, 10,
 * 12.5, 15, 17.5, 20, 22.5 — gaps of 2.5 low down and 5 higher up. No single
 * number describes that, which is exactly why a plate inventory was rejected
 * (G1.1, G3.2). Snapping to multiples of the step therefore produced weights
 * that *looked* loadable with no guarantee they were: false confidence, paid
 * for in machinery.
 *
 * So the engine states a target and the athlete reconciles it with the rack.
 * Every weight is tap-to-edit (INV-7) and progression is measured from what was
 * actually lifted, so a correction is absorbed rather than fought — lift a
 * clean session at a weight you chose and the next one is a step above that.
 *
 * The cost is a plateau the engine cannot see: a 2.5 kg step against 5 kg
 * plates means the target is never loadable, the athlete repeats a weight
 * forever, and the sets stay clean so the stall counter never moves. The old
 * grid did not solve this either — it would name 37.5 just the same — it only
 * hid it. The fix is a warning, not a rule (Part K).
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
  /**
   * Kilograms. A target, not a promise: the engine does not know what the rack
   * holds, so this is what to aim for and the athlete adjusts it if the number
   * is not loadable (see Equipment, INV-7).
   */
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
 * Every field here can be rebuilt from the exercise's `startKg` and the log,
 * and C3 does exactly that after every import and migration. If a rebuild ever
 * disagrees with the cache, the cache is wrong — never the log.
 *
 * `weakSide` used to be here and is now on `Exercise`. It never belonged: no
 * session moves it, `applyOutcome` only ever copied it through, and a value
 * that cannot be recomputed cannot live in the table replay throws away. Its
 * one reader, `prescribe`, is handed the exercise anyway. The rule this leaves
 * behind is worth keeping: nothing joins this type unless replay can produce
 * it, because everything here is deleted on a regular basis.
 */
export type EngineState = {
  readonly exerciseId: ExerciseId;
  /**
   * The weight to prescribe next, in kg.
   *
   * It is not snapped to anything. It is a start weight, or a weight the
   * athlete actually lifted, plus or minus whole steps — so it stays in their
   * own vocabulary rather than on a grid anchored at zero (see Equipment).
   */
  readonly currentKg: number;
  /** Consecutive failed sessions. Three triggers the deload (B5). */
  readonly stallCount: number;
};
