/**
 * The prescription (B4).
 *
 * Three functions, and none of them is clever — which is the point. The hard
 * thinking happened in `weights.ts`: because a weight only ever got where it is
 * by adding whole steps to a weight that already was one, "what should I lift
 * today" is addition and a struct literal. Nothing here snaps, clamps or
 * corrects, because there is nothing left to correct.
 *
 * Below the prescription sit the session outcome rules (B5): what a finished
 * session does to the weight, and when the engine offers to back off.
 *
 * INV-2: the prescribed weight is derived by replaying the log. It is never
 * stored as an opinion, and this module never reads storage to find it.
 */

import type {
  Equipment,
  EngineState,
  Exercise,
  ExerciseId,
  Prescription,
  Session,
  SetLog,
} from "./types";
import { addStep, roundKg } from "./weights";

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
 * Where a lift stands before it has ever been trained.
 *
 * This is replay's opening balance (C3.1). `rebuildState()` starts every
 * exercise here and folds the whole log in from the beginning, which is only
 * possible because `startKg` is stored on the exercise rather than in the cache
 * being rebuilt — see the note on `EngineState`.
 *
 * It belongs in the engine rather than in `src/db/` because "where does a lift
 * start" is a progression question. Keeping it here leaves the replay as glue —
 * read, fold, write — with no arithmetic of its own to get wrong.
 *
 * The weight goes through `roundKg` for the same reason every other weight
 * does: a hand-typed start weight is the one number in the system a human
 * enters directly, and it should be stored at the precision everything else
 * compares at. What is *not* done here is clamping a very light start up to one
 * step (`lift-log-design.md` §6.6) — that edge case is about what gets
 * prescribed, and no weight is clamped anywhere yet.
 */
export function initialState(exercise: Exercise): EngineState {
  return {
    exerciseId: exercise.id,
    currentKg: roundKg(exercise.startKg),
    stallCount: 0,
  };
}

/**
 * What to do today: the weight, the session shape, and which side goes first.
 *
 * The weight is `state.currentKg` passed straight through — no rounding, no
 * snapping, no clamping. The step is what the athlete intends to add, not a
 * claim about which weights exist (see `Equipment`), so there is no grid to
 * correct the number onto and nothing here to correct it with.
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
    // (`lift-log-design.md` §6.4). Read from the exercise, which is where the
    // athlete set it — the state carries only what replay can recompute.
    weakSide: exercise.weakSide,
  };
}

/* ------------------------------------------------------- session outcomes */

/**
 * Consecutive stalled sessions before the engine proposes backing off. Fixed,
 * not a setting: each exercise comes round every five days, so three stalls is
 * about a fortnight of being stuck — the right amount of patience, and not a
 * dial anyone should be turning while frustrated.
 */
export const STALLS_BEFORE_DELOAD = 3;

/**
 * How far back a deload reaches, counted in **sessions of that exercise, not
 * calendar days**. After a two-week break, four weeks of calendar might be two
 * sessions, which would make the deload far too shallow. Six sessions is
 * roughly four weeks when you are consistent, and still correct when you are
 * not (`lift-log-design.md` §6.3).
 */
export const DELOAD_LOOKBACK_SESSIONS = 6;

/** Used only when the log is too short to answer honestly. */
export const DELOAD_FALLBACK_FACTOR = 0.85;

/**
 * A deload that has happened. Not a question — the engine drops the weight
 * itself, and this is what it did, so the UI can say so on the Today card.
 *
 * The build plan (B5.3) and `lift-log-design.md` §6.3 both have the engine
 * *propose* and the athlete accept or decline. The project owner has since
 * decided against the prompt: three stalls is unambiguous enough that being
 * asked is friction rather than control, and the weight is editable by hand
 * anyway (INV-7) — so anyone who disagrees with the drop can simply tap it
 * back. Both documents should be corrected to match.
 */
export type Deload = {
  readonly exerciseId: ExerciseId;
  /** The weight that had stopped moving. */
  readonly fromKg: number;
  /** What it dropped to, already on the grid. */
  readonly toKg: number;
  /**
   * `history` — a weight actually lifted six sessions ago, which is what the
   * method asks for. `fallback` — `× 0.85`, used when the log cannot answer.
   * Kept so the UI can say *why* the number moved.
   */
  readonly basis: "history" | "fallback";
  readonly stallCount: number;
};

/**
 * The engine's answer to a finished session: the new state, and a note of
 * whether a deload was part of getting there.
 *
 * The build plan writes `applyOutcome` as returning `EngineState` alone. The
 * deload is already applied to that state, so the second field changes nothing
 * about the weight — it exists because "you dropped to 27.5 after three stalls"
 * and "you are at 27.5" are different things to put on a screen, and the state
 * cannot carry the first.
 */
export type OutcomeResult = {
  readonly state: EngineState;
  /** Non-null only on the session where the drop happened. */
  readonly deload: Deload | null;
};

/**
 * Did every set make its target, on both sides?
 *
 * Binary, with no tolerance: four reps of a target five is a stall, exactly as
 * much as one rep is. Partial credit is what turns a linear progression into a
 * negotiation.
 *
 * The comparison is `>=`, not `===`. The build plan (B5.1) writes it as strict
 * equality, but `lift-log-design.md` §6.3 says "any set **short of** 5 reps",
 * and the design is the source of truth where the two disagree. An extra rep
 * is not a failed session, and `===` would score six reps of a target five as a
 * stall. In practice the UI cannot even produce that — a miss is a 0–4 picker
 * (D2.2.1) — but the rule should say what it means.
 *
 * An abandoned session is never clean, whatever its sets say (B5.7). Neither is
 * a session with no sets recorded: `status` claims every set was logged and the
 * sets disagree, and the conservative reading of contradictory data is the one
 * that does not hand out weight.
 */
export function isClean(session: Session, sets: readonly SetLog[]): boolean {
  if (session.status !== "complete") return false;
  if (sets.length === 0) return false;
  return sets.every((set) => set.doneReps >= set.targetReps);
}

/**
 * Fold one finished session into the engine state (B5).
 *
 * The rules, all of them:
 *
 *   clean         weight += one step, stall count back to zero      (B5.1)
 *   short         weight holds, stall count up one                  (B5.2)
 *   third stall   the above, and a deload *proposal* is attached    (B5.3)
 *   abandoned     weight untouched, stall count up one              (B5.7)
 *
 * There is no separate branch for a hand-typed weight (B5.6). Progression is
 * measured from `session.actualKg` — what was on the dumbbell — and not from
 * what the engine asked for, so an override is already accounted for: lift a
 * clean session at a weight you chose yourself and the next one is a step above
 * *that*. This is INV-7 falling out of the arithmetic instead of being a case,
 * and it is why an override can never be silently discarded.
 *
 * `equipment` is not in the build plan's signature, which B5.1 nonetheless
 * writes in terms of `equipment.stepKg`. It has to come from somewhere.
 *
 * Throws when the *arguments* disagree with each other — a session for another
 * exercise, sets belonging to another session, a session that has not been
 * trained yet or has been deleted. Those are wiring mistakes at the call site,
 * and each produces a plausible-looking wrong answer rather than an obvious
 * one. Odd *data* is never a throw: replay (C3) has to survive whatever is
 * already in the log, so it takes the conservative branch instead.
 */
export function applyOutcome(
  state: EngineState,
  equipment: Equipment,
  session: Session,
  sets: readonly SetLog[],
  history: readonly Session[],
): OutcomeResult {
  if (state.exerciseId !== session.exerciseId) {
    throw new RangeError(
      `state is for ${state.exerciseId}, session is for ${session.exerciseId}`,
    );
  }
  if (session.deletedAt !== null) {
    throw new RangeError(`session ${session.id} is deleted and cannot count (INV-3)`);
  }
  if (session.status === "planned") {
    throw new RangeError(`session ${session.id} has not been trained yet`);
  }
  const stray = sets.find((set) => set.sessionId !== session.id);
  if (stray !== undefined) {
    throw new RangeError(`set ${stray.id} belongs to session ${stray.sessionId}`);
  }

  if (session.status === "abandoned") {
    // Walked away from, so the engine learns nothing: the weight stays, the
    // stall count stays, and the next session is the same as this one would
    // have been (B5.7).
    //
    // It is tempting to count this as a stall — three walk-outs in a row is a
    // real signal that something is wrong. But now that the deload happens by
    // itself rather than being offered, a wrong guess here silently takes
    // weight off the bar, and people abandon sessions for reasons that have
    // nothing to do with strength: the gym closing, a phone call, a child.
    // Doing nothing is both the safer reading and the smaller one.
    return { state, deload: null };
  }

  if (isClean(session, sets)) {
    return {
      state: {
        ...state,
        currentKg: addStep(session.actualKg, equipment.stepKg),
        stallCount: 0,
      },
      deload: null,
    };
  }

  const stalled: EngineState = {
    ...state,
    currentKg: session.actualKg,
    stallCount: state.stallCount + 1,
  };
  if (stalled.stallCount < STALLS_BEFORE_DELOAD) return { state: stalled, deload: null };

  const deload = computeDeload(stalled, equipment, session, history);
  return {
    state: { ...stalled, currentKg: deload.toKg, stallCount: 0 },
    deload,
  };
}

/**
 * Where to drop back to (B5.4). Only ever called on the third stall.
 *
 * The rule reads the log rather than doing arithmetic: it resolves to a weight
 * actually lifted six sessions ago, which is more honest than a percentage and
 * is what the method asks for. The build plan says "the prescribed weight from
 * six sessions ago"; `lift-log-design.md` §6.3 says "a weight you actually
 * used", and the design wins — so this reads `actualKg`. The two differ only
 * where that session was itself overridden by hand, and there the weight on the
 * dumbbell is the one that means something.
 *
 * It is returned exactly as it was lifted. Rounding it to a multiple of the
 * step would be inventing a constraint the engine does not have, and could name
 * a weight the athlete has never once had on the bar.
 *
 * Only **complete** sessions are counted back through. An abandoned session may
 * have been walked away from before anything was lifted, and a deload should
 * land on a weight that was genuinely finished. The three stalls that triggered
 * this are themselves complete sessions — logged in full, just short of the
 * target — so counting six back reaches past the whole plateau.
 */
function computeDeload(
  state: EngineState,
  equipment: Equipment,
  session: Session,
  history: readonly Session[],
): Deload {
  const earlier = history
    .filter(
      (s) =>
        s.exerciseId === state.exerciseId &&
        s.id !== session.id &&
        s.deletedAt === null &&
        s.status === "complete",
    )
    // Newest first. `startedAt` is ISO 8601 in UTC, so it sorts as text.
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));

  const past = earlier[DELOAD_LOOKBACK_SESSIONS - 1];
  // A deload that raises the weight is not a deload. It happens when the
  // athlete has already dropped the weight by hand since then — six sessions
  // ago is genuinely heavier than today — and the fallback is the only honest
  // answer left.
  if (past !== undefined && past.actualKg < state.currentKg) {
    return {
      exerciseId: state.exerciseId,
      fromKg: state.currentKg,
      toKg: roundKg(past.actualKg),
      basis: "history",
      stallCount: state.stallCount,
    };
  }

  return {
    exerciseId: state.exerciseId,
    fromKg: state.currentKg,
    toKg: fallbackDeloadKg(state.currentKg, equipment.stepKg),
    basis: "fallback",
    stallCount: state.stallCount,
  };
}

/**
 * The deload for when the log cannot answer: back off by about 15%, expressed
 * as a whole number of steps.
 *
 * Whole steps, rather than `× 0.85` snapped to a multiple of the step, because
 * there is no grid to snap to. Moving in steps from where the athlete already
 * is keeps the number on their own ladder: start at 22 with a 2.5 step and the
 * weights are 22, 24.5, 27 — a grid anchored at zero would drop them onto 27.5,
 * a weight they have never lifted.
 *
 * The drop rounds **up** to the next whole step, so the deload is at least as
 * deep as the percentage asks. Never below one step, and never nothing: a
 * deload that does not move is not a deload.
 */
function fallbackDeloadKg(currentKg: number, stepKg: number): number {
  const wanted = currentKg * (1 - DELOAD_FALLBACK_FACTOR);
  const steps = Math.max(1, Math.ceil(wanted / stepKg));
  return Math.max(roundKg(stepKg), roundKg(currentKg - steps * stepKg));
}
