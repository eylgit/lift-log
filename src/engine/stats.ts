/**
 * Derived statistics (B6) — the numbers the History and Progress screens draw.
 *
 * Every function here takes the log as an argument and returns numbers. None of
 * them reads storage, and none of them knows what day it is: where a function
 * needs today's date it is passed in as a `TrainingDay`, because a clock is I/O
 * and the engine has none (INV-9). That is also what makes these testable
 * without freezing time.
 *
 * Nothing here is stored. Like the prescription, these are recomputed from the
 * facts whenever a screen needs them (INV-2).
 */

import type {
  ExerciseId,
  Session,
  SetLog,
  TrainingDay,
} from "./types";
import { roundKg } from "./weights";

/**
 * Only complete, undeleted sessions count toward any statistic.
 *
 * Abandoned sessions are facts and stay in the log and the export, but they are
 * not achievements: a walked-away-from session on the chart would put a spike
 * at a weight that was never really lifted. Deleted ones are filtered on read
 * everywhere (INV-3).
 */
function completed(history: readonly Session[]): Session[] {
  return history.filter((s) => s.status === "complete" && s.deletedAt === null);
}

/** Oldest first, which is the order a chart wants and a PB search does not mind. */
function chronological(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) =>
    a.trainingDay === b.trainingDay
      ? a.startedAt.localeCompare(b.startedAt)
      : a.trainingDay.localeCompare(b.trainingDay),
  );
}

/* ------------------------------------------------------------ B6.1 · 1RM */

/**
 * Estimated one-rep max, Epley: `w × (1 + reps/30)`.
 *
 * A single number for "how strong is this, really", so that 30 kg × 5 and
 * 35 kg × 3 can be compared at all. It is an estimate and drifts badly above
 * ten reps or so; at the three-to-five this app deals in it is fine.
 *
 * Every lift here is single-sided, so this is a per-hand figure. Do not double
 * it for display — it is not a barbell number and pretending otherwise would
 * flatter the athlete by exactly 100%.
 *
 * One rep is returned as-is rather than through the formula. Epley would make a
 * single at 40 kg into a 41.33 kg max, which says the athlete can do more than
 * the thing they just did.
 */
export function estimated1RM(weightKg: number, reps: number): number {
  if (!Number.isFinite(reps) || reps < 0) {
    throw new RangeError(`reps must be a non-negative number, got ${reps}`);
  }
  if (reps === 0) return 0;
  if (reps === 1) return roundKg(weightKg);
  return roundKg(weightKg * (1 + reps / 30));
}

/* ---------------------------------------------------------- B6.2 · chart */

/** One session, as the sawtooth chart needs it. */
export type ChartPoint = {
  readonly sessionId: string;
  readonly trainingDay: TrainingDay;
  /** What was actually lifted. The sawtooth itself. */
  readonly weightKg: number;
  /** Epley over the best set of the session. The line beneath the sawtooth (E2.2). */
  readonly estimated1RM: number;
  /**
   * The weight went down from the previous session.
   *
   * Named for what it observes rather than what usually caused it. In practice
   * a drop is a deload and E2.3 can mark it as one, but the log does not record
   * *who* dropped it — the engine after three stalls, or the athlete by hand.
   * Telling those apart needs the provenance work in K1.1; until then, saying
   * "the weight went down here" is the true statement.
   */
  readonly weightDropped: boolean;
  /** Equal to or above every weight before it. The PB markers on the chart. */
  readonly personalBest: boolean;
};

/**
 * The points for one exercise's sawtooth, oldest first (B6.2).
 *
 * Takes the exercise explicitly and filters, rather than trusting the caller to
 * have done it: two exercises' weights on one line would look like a plausible
 * chart rather than an obvious bug.
 *
 * `sets` may be every set in the log; only those belonging to these sessions
 * are read. A session with no sets recorded falls back to a single rep — it
 * cannot happen through the app, and a zero would put a hole in the 1RM line.
 */
export function chartSeries(
  exerciseId: ExerciseId,
  history: readonly Session[],
  sets: readonly SetLog[],
): readonly ChartPoint[] {
  const sessions = chronological(
    completed(history).filter((s) => s.exerciseId === exerciseId),
  );

  const bestReps = new Map<string, number>();
  for (const set of sets) {
    const seen = bestReps.get(set.sessionId) ?? 0;
    if (set.doneReps > seen) bestReps.set(set.sessionId, set.doneReps);
  }

  let previousKg: number | null = null;
  let heaviestKg = Number.NEGATIVE_INFINITY;

  return sessions.map((session) => {
    const reps = bestReps.get(session.id) ?? 1;
    const point: ChartPoint = {
      sessionId: session.id,
      trainingDay: session.trainingDay,
      weightKg: session.actualKg,
      estimated1RM: estimated1RM(session.actualKg, reps),
      weightDropped: previousKg !== null && session.actualKg < previousKg,
      personalBest: session.actualKg >= heaviestKg,
    };
    previousKg = session.actualKg;
    if (session.actualKg > heaviestKg) heaviestKg = session.actualKg;
    return point;
  });
}

/* ----------------------------------------------------------- B6.3 · habit */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day before this one.
 *
 * UTC is used deliberately and is not a violation of INV-5. That invariant
 * forbids *deriving* a training day from an instant, because the answer depends
 * on the reader's timezone. This is the opposite operation: the day has already
 * been decided and written down, and stepping back one square on a calendar
 * grid is arithmetic on that string. Doing it in UTC is what keeps it from
 * picking up a timezone at all — and it gets the ends of months and leap years
 * right, which hand-rolled string arithmetic would not.
 */
function dayBefore(day: TrainingDay): TrainingDay {
  if (!DAY_PATTERN.test(day)) {
    throw new RangeError(`trainingDay must be YYYY-MM-DD, got ${day}`);
  }
  const at =
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
    ) - 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Consecutive days trained, ending today (B6.3).
 *
 * Counts days, not sessions, and spans every exercise: it answers "did I turn
 * up", which is the only habit question worth asking when the rotation is one
 * lift a day.
 *
 * Today not being trained yet does not break the streak — the count simply
 * starts from yesterday. Otherwise every streak in the app would read zero
 * until the athlete had finished training, which is exactly when the number is
 * least useful and most discouraging.
 *
 * Note what this deliberately cannot express: a debt. It counts what was done
 * and stops. There is no "you owe two sessions" anywhere in it (INV-6).
 */
export function streak(history: readonly Session[], today: TrainingDay): number {
  if (!DAY_PATTERN.test(today)) {
    throw new RangeError(`trainingDay must be YYYY-MM-DD, got ${today}`);
  }
  const trained = new Set(completed(history).map((s) => s.trainingDay));
  let day = trained.has(today) ? today : dayBefore(today);
  let days = 0;
  while (trained.has(day)) {
    days += 1;
    day = dayBefore(day);
  }
  return days;
}

/**
 * Sessions completed in the calendar month `today` falls in (B6.3).
 *
 * Compares the `YYYY-MM` prefix of the training day, so it needs no date
 * arithmetic and cannot pick up a timezone (INV-5).
 */
export function sessionsThisMonth(
  history: readonly Session[],
  today: TrainingDay,
): number {
  if (!DAY_PATTERN.test(today)) {
    throw new RangeError(`trainingDay must be YYYY-MM-DD, got ${today}`);
  }
  const month = today.slice(0, 7);
  return completed(history).filter((s) => s.trainingDay.startsWith(month)).length;
}

/* -------------------------------------------------------------- B6.4 · PB */

export type PersonalBest = {
  readonly exerciseId: ExerciseId;
  readonly weightKg: number;
  readonly trainingDay: TrainingDay;
  readonly sessionId: string;
};

/**
 * The heaviest weight completed for this exercise, or null if it has none (B6.4).
 *
 * Heaviest weight, not best estimated 1RM. They are different questions and the
 * stat row (E2.4) shows both; this is the one an athlete means by "my best".
 *
 * A session counts if it was completed, whatever the rep count. Getting three
 * reps of a target five at 40 kg is a stall, and the engine treats it as one —
 * but 40 kg was still on the dumbbell and still went up. The chart shows the
 * rep quality alongside, so nothing is hidden by counting it.
 *
 * Ties go to the earliest session: it is the day the weight was first reached.
 */
export function personalBest(
  exerciseId: ExerciseId,
  history: readonly Session[],
): PersonalBest | null {
  let best: Session | null = null;
  for (const session of chronological(
    completed(history).filter((s) => s.exerciseId === exerciseId),
  )) {
    if (best === null || session.actualKg > best.actualKg) best = session;
  }
  if (best === null) return null;
  return {
    exerciseId,
    weightKg: best.actualKg,
    trainingDay: best.trainingDay,
    sessionId: best.id,
  };
}
