/**
 * The Today card's data (D1).
 *
 * This is the join the engine deliberately does not do. `prescribe()` is handed
 * one lift and one state and answers for that lift; it never asks which day of
 * the rotation it is, because the rotation is a storage concern (INV-6, and the
 * note on `ExerciseRow` in `src/db/schema.ts`). Somebody has to pick the lift,
 * find its state and put the two together, and that somebody is here — above
 * the engine, above storage, and beneath the screen.
 *
 * Everything here returns numbers and shapes, never sentences. The English is
 * the card's job (`App.tsx`), which keeps the wording out of the tests and lets
 * it be rewritten without touching a rule.
 *
 * It is a plain module rather than a hook so it can be tested without a
 * browser. `useToday` is the twenty lines that make it a screen.
 */

import type {
  EngineState,
  Exercise,
  ExerciseId,
  Prescription,
  Session,
  TrainingDay,
} from "./engine";
import { initialState, isClean, prescribe, roundKg } from "./engine";
import type { Repo } from "./db";

/**
 * Which lift, and at what weight — the part that needs no history.
 *
 * The position rides along because the card draws it — "Day 3 of 5", and the
 * five dots underneath. It is not part of the prescription: the engine has no
 * opinion about which day it is and should not start having one.
 */
export type RotationDay = {
  readonly prescription: Prescription;
  /** Position in the rotation, from 0. Always inside the rotation. */
  readonly dayIndex: number;
  readonly rotationLength: number;
};

/**
 * How the last session of this lift actually went (D1.2).
 *
 * A summary of facts, not a judgement: the day, the weight that was really on
 * the dumbbell, and what became of the session. `outcome` is decided by the
 * engine's own `isClean` rather than by a second reading of the set log here —
 * the whole point of INV-2 is that there is one answer to "was that clean",
 * and a card that worked it out for itself could disagree with the weight
 * printed above it.
 */
export type LastResult = {
  readonly trainingDay: TrainingDay;
  /** What was lifted, not what was asked for (INV-7). */
  readonly weightKg: number;
  readonly outcome: "clean" | "short" | "walked out";
  /**
   * Reps missing across every side logged, from `doneReps` rather than a
   * pass/fail flag (INV-4). Zero unless `outcome` is `short`.
   */
  readonly repsShort: number;
};

/**
 * Why today's weight is what it is (D1.2).
 *
 * This is the slot the build plan calls the "load breakdown" — originally
 * *which plates to put on*. The app cannot answer that and never will: asking
 * what kit the athlete owns was rejected outright, twice and at length
 * (`lift-log-design.md` §6.5 and §14.6 — "ask one number: the smallest jump
 * you can make"). The two lines in §5 that still promise a plate breakdown are
 * an older draft the rest of the document overrules, and they are wrong.
 *
 * What goes there instead is the question a breakdown was really answering:
 * *what do I do differently to the dumbbell than last time?* It costs no new
 * setting, because it is two numbers already in the log subtracted from one
 * another.
 *
 * Note what is compared: today's prescription against the weight actually
 * lifted last time. Not against `prescribedKg` — an override is a fact and the
 * card should reflect the dumbbell, not the plan (INV-7). And not re-derived
 * from the progression rules: a subtraction cannot drift out of step with the
 * engine, whereas a second copy of "clean means one step" certainly can.
 */
export type WeightChange =
  /** This lift has never been trained. The weight is its start weight. */
  | { readonly kind: "first" }
  | { readonly kind: "same"; readonly fromKg: number }
  | {
      readonly kind: "up" | "down";
      readonly fromKg: number;
      /** Always positive. The direction is in `kind`. */
      readonly byKg: number;
      /** Exactly one step, which is what a clean session earns. */
      readonly oneStep: boolean;
    };

/** Everything the card draws. */
export type Today = RotationDay & {
  readonly last: LastResult | null;
  readonly change: WeightChange;
  /**
   * How long to rest between sets, in seconds.
   *
   * From settings rather than from `prescription.restMinutes`, and the two are
   * not a contradiction: the engine's `SESSION_SCHEME` is the default that
   * seeded the settings row (see `DEFAULT_SETTINGS`), and settings is where the
   * athlete's own answer lives once they change it (G3.1, D5.4). Rest is the
   * one part of the session shape the engine has no opinion about — it never
   * reads it — so there is no second answer to disagree with.
   */
  readonly restTargetS: number;
};

/**
 * Where the rotation has got to (D1.3).
 *
 * The pointer is **a position, not a date** (INV-6). It is the lift after the
 * last one that was finished, and nothing else goes into it: not today's date,
 * not how long ago that session was, not how many days were skipped. Miss a
 * week and the next lift is still simply the next lift. There is no catch-up,
 * no debt, and no screen anywhere that counts what was missed — the design is
 * explicit that guilt is friction and friction is the enemy (§5).
 *
 * Like everything else in the app the pointer is derived rather than stored
 * (INV-2). A stored "current day" would be one more thing that can disagree
 * with the log, and it would have to be repaired after an import.
 *
 * Only **complete** sessions move it. A session that was walked out of teaches
 * the engine nothing (B5.7) and it should not quietly cost the athlete a lift
 * either: they open the app, see the same lift, and do it. That is not debt —
 * nothing is owed and nothing accumulates — it is just a lift that has not
 * happened yet. Repeating it is also escapable in one tap, because the lift
 * itself is editable on Today (D5.4).
 *
 * A completed session for a lift that has since left the rotation is stepped
 * over rather than counted. Its position no longer exists, so there is no "next
 * one along" to name.
 */
export function nextDayIndex(
  exercises: readonly Exercise[],
  sessions: readonly Session[],
): number {
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const session = sessions[i]!;
    if (session.status !== "complete") continue;
    const position = exercises.findIndex((e) => e.id === session.exerciseId);
    if (position !== -1) return position + 1;
  }
  // Nothing finished yet: the rotation starts at its first lift.
  return 0;
}

/**
 * The prescription for one position in the rotation.
 *
 * `dayIndex` wraps, in both directions, because the rotation is a ring: day
 * five is followed by day one and there is no last lift. Wrapping here rather
 * than at the call site is what lets the pointer in D1.3 be a plain count of
 * sessions that only ever goes up.
 *
 * A lift with no row in `engineState` starts at `initialState(exercise)` — the
 * same opening balance replay uses (C3.0). That is not a defensive default: it
 * is the honest state of a lift that has never been trained, and it is what a
 * fresh install has for all five. Reading the cache and finding nothing is the
 * expected case on day one, not a fault.
 */
export function prescribeDay(
  exercises: readonly Exercise[],
  states: readonly EngineState[],
  dayIndex: number,
): RotationDay {
  if (exercises.length === 0) {
    // Not reachable through the app — `ensureDefaults` seeds five lifts and
    // `saveRotation` is only ever handed a full rotation. Worth a clear throw
    // anyway: the alternative is a screen rendering `undefined.name`.
    throw new RangeError("the rotation is empty; there is nothing to prescribe");
  }
  if (!Number.isInteger(dayIndex)) {
    throw new RangeError(`dayIndex must be a whole number, got ${dayIndex}`);
  }

  const length = exercises.length;
  // `%` keeps the sign of its left operand in JavaScript, so a negative index
  // needs the second modulo to land back inside the array.
  const position = ((dayIndex % length) + length) % length;
  const exercise = exercises[position]!;
  const state = states.find((s) => s.exerciseId === exercise.id) ?? initialState(exercise);

  return {
    prescription: prescribe(state, exercise),
    dayIndex: position,
    rotationLength: length,
  };
}

/**
 * Today's weight against the last one actually lifted.
 *
 * `roundKg` on the difference rather than on the operands: both are already
 * rounded, and it is the subtraction that manufactures `1.0000000000000018`.
 * Without it a step up compares unequal to the step and the card says "up
 * 1 kg" where it should say "one step up".
 */
export function describeChange(
  weightKg: number,
  last: LastResult | null,
  stepKg: number,
): WeightChange {
  if (last === null) return { kind: "first" };

  const delta = roundKg(weightKg - last.weightKg);
  if (delta === 0) return { kind: "same", fromKg: last.weightKg };

  return {
    kind: delta > 0 ? "up" : "down",
    fromKg: last.weightKg,
    byKg: Math.abs(delta),
    oneStep: Math.abs(delta) === roundKg(stepKg),
  };
}

/**
 * The last session of this lift that reached an end, or null if there is none.
 *
 * Sessions still `planned` are skipped rather than reported. One is either an
 * abandoned session nobody closed or the session the athlete is in the middle
 * of right now, and neither is a *result* — resuming an open session is D2's
 * job, and the card would be reporting the future.
 *
 * Every session of the lift is read rather than the last few. A limit would
 * have to guess how many open sessions might sit on top of the last real one,
 * and guessing wrong shows "never trained" to somebody with a year of history.
 * One lift is around seventy sessions a year (§7), and only their sets are
 * fetched — one further read, for one session.
 */
export async function lastResultFor(
  repo: Repo,
  exerciseId: ExerciseId,
): Promise<LastResult | null> {
  const sessions = await repo.listSessions({ exerciseId });
  const finished = [...sessions].reverse().find((s) => s.status !== "planned");
  if (finished === undefined) return null;

  if (finished.status === "abandoned") {
    return {
      trainingDay: finished.trainingDay,
      weightKg: finished.actualKg,
      outcome: "walked out",
      repsShort: 0,
    };
  }

  const sets = await repo.listSets(finished.id);
  if (isClean(finished, sets)) {
    return {
      trainingDay: finished.trainingDay,
      weightKg: finished.actualKg,
      outcome: "clean",
      repsShort: 0,
    };
  }

  return {
    trainingDay: finished.trainingDay,
    weightKg: finished.actualKg,
    outcome: "short",
    repsShort: sets.reduce((short, set) => short + Math.max(0, set.targetReps - set.doneReps), 0),
  };
}

/**
 * Read what the card needs and assemble it.
 *
 * The rotation, the cache and the log come first because the last read depends
 * on which lift they name between them. The log is not consulted for the *weight* — the cache
 * is the log already folded up (INV-2), and `openRepo` has rebuilt it from the
 * log if the two could have drifted (C3.2). It is consulted for what happened
 * last time, which is a fact no cache holds.
 */
export async function loadToday(repo: Repo): Promise<Today> {
  const [exercises, states, equipment, settings, sessions] = await Promise.all([
    repo.listExercises(),
    repo.listEngineState(),
    repo.getEquipment(),
    repo.getSettings(),
    // The whole log, for the pointer. A year is a few hundred rows read in one
    // go (§7), and the alternative — asking for the last few and hoping the
    // most recent completed session is among them — is wrong exactly when
    // somebody comes back from a run of abandoned sessions.
    repo.listSessions(),
  ]);

  const day = prescribeDay(exercises, states, nextDayIndex(exercises, sessions));
  const last = await lastResultFor(repo, day.prescription.exercise.id);

  return {
    ...day,
    last,
    change: describeChange(day.prescription.weightKg, last, equipment.stepKg),
    restTargetS: settings.restTargetS,
  };
}
