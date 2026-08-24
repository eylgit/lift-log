/**
 * The Today card's data (D1.1).
 *
 * This is the join the engine deliberately does not do. `prescribe()` is handed
 * one lift and one state and answers for that lift; it never asks which day of
 * the rotation it is, because the rotation is a storage concern (INV-6, and the
 * note on `ExerciseRow` in `src/db/schema.ts`). Somebody has to pick the lift,
 * find its state and put the two together, and that somebody is here — above
 * the engine, above storage, and beneath the screen.
 *
 * It is a plain module rather than a hook so it can be tested without a
 * browser. `useToday` is the twenty lines that make it a screen.
 */

import type { EngineState, Exercise, Prescription } from "./engine";
import { initialState, prescribe } from "./engine";
import type { Repo } from "./db";

/**
 * What the Today card shows: the prescription, and where in the rotation it
 * came from.
 *
 * The position rides along because the card draws it — "Day 3 of 5", and the
 * five dots underneath. It is not part of the prescription: the engine has no
 * opinion about which day it is and should not start having one.
 */
export type Today = {
  readonly prescription: Prescription;
  /** Position in the rotation, from 0. Always inside the rotation. */
  readonly dayIndex: number;
  readonly rotationLength: number;
};

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
): Today {
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
 * Read what `prescribeDay` needs and call it.
 *
 * Two reads, in parallel, and no third: the prescription is derived from the
 * rotation and the cache alone. The log is not consulted, because the cache is
 * the log already folded up (INV-2) — and if the two ever disagree, `openRepo`
 * has already rebuilt the cache from the log before this runs (C3.2).
 */
export async function loadToday(repo: Repo, dayIndex: number): Promise<Today> {
  const [exercises, states] = await Promise.all([repo.listExercises(), repo.listEngineState()]);
  return prescribeDay(exercises, states, dayIndex);
}
