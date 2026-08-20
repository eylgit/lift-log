/**
 * The prescription (B4).
 *
 * Two functions, and neither is clever — which is the point. The hard thinking
 * happened in `weights.ts`: because a weight only ever got where it is by
 * adding whole steps to a weight that already was one, "what should I lift
 * today" is addition and a struct literal. Nothing here snaps, clamps or
 * corrects, because there is nothing left to correct.
 *
 * The session *outcome* rules — stall counting, the deload proposal, overrides
 * — are B5 and are not here yet.
 *
 * INV-2: the prescribed weight is derived by replaying the log. It is never
 * stored as an opinion, and this module never reads storage to find it.
 */

import type { Equipment, EngineState, Exercise, Prescription } from "./types";
import { addStep } from "./weights";

/**
 * The session shape, hardcoded for v1 (see `lift-log-build-plan.md`,
 * "Session structure").
 *
 * 5 reps on one side, then 5 on the other, is **one set**; the rest goes
 * between sets and never between the two sides. This differs from the source
 * guide, which rests between sides too — the grouping is deliberate, see
 * `lift-log-design.md` §1.
 *
 * It is a constant rather than a setting because a v1 that lets these move
 * has to explain what they do, and the answer is "nothing the engine reads".
 * The progression rule only ever asks whether the target reps were met.
 */
export const SESSION_SCHEME = {
  repsPerSide: 5,
  sets: 3,
  restMinutes: 5,
} as const;

/**
 * The weight for the next session of this exercise.
 *
 * The whole progression rule: a clean session earns one step, anything else
 * repeats the weight. There is no partial credit and no tolerance — four reps
 * of a target five is a stall, and B5 is where that judgement is made.
 *
 * `clean` is a parameter rather than something worked out here because this
 * function has no sets to look at. B5's `applyOutcome` reads the set log,
 * decides, and passes the answer down. (The build plan writes the signature as
 * `(state, equipment)`; without a third argument the function cannot tell its
 * two cases apart, and would collapse into `addStep`.)
 *
 * Note what does *not* happen on a stall: nothing. No decay, no half-step
 * back, no "try again lighter". Repeating a weight until it moves is the
 * method.
 */
export function nextWeight(
  state: EngineState,
  equipment: Equipment,
  clean: boolean,
): number {
  return clean ? addStep(state.currentKg, equipment.stepKg) : state.currentKg;
}

/**
 * What to do today: the weight, the session shape, and which side goes first.
 *
 * The weight is `state.currentKg` passed straight through. It is already a
 * multiple of the step — that is the invariant `EngineState.currentKg`
 * documents and `snapToStep` defends at the two places a weight can arrive
 * off-grid. Snapping here would be machinery that never fires, and would hide
 * it if the invariant ever broke.
 */
export function prescribe(state: EngineState, exercise: Exercise): Prescription {
  if (state.exerciseId !== exercise.id) {
    // Worth a throw rather than a shrug: the two arguments disagreeing is the
    // one mistake at this call site that produces a plausible-looking
    // prescription — the right lift at another lift's weight.
    throw new RangeError(
      `state is for ${state.exerciseId}, not ${exercise.id}`,
    );
  }
  return {
    exercise,
    weightKg: state.currentKg,
    repsPerSide: SESSION_SCHEME.repsPerSide,
    sets: SESSION_SCHEME.sets,
    restMinutes: SESSION_SCHEME.restMinutes,
    // Weak side first, while fresh, and it sets the standard for both
    // (`lift-log-design.md` §6.4).
    weakSide: state.weakSide,
  };
}
