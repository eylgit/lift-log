/**
 * B7.3 — a virtual lifter, and a year of the real engine.
 *
 * The model here is deliberately thin: one number per lift, per day, for how
 * heavy a set of five the athlete could complete if asked. Everything else —
 * what to lift, when to add weight, when to back off — comes from
 * `src/engine/`, unmodified. That is the whole point. If the sawtooth in
 * `output/simulation.svg` looks right, it is because the engine produced it.
 *
 * ## The lifter
 *
 * Capacity grows on a fixed curve with two parts: a quick novice adaptation
 * that is mostly spent inside two months, and a steady long-term gain that is
 * still running at the end of the year. No noise, no randomness — the same run
 * every time, so the committed chart only changes when the engine does.
 *
 * The steady part is about 15 kg a year on every lift, which is a good year.
 * That is a choice, and it is worth being honest about why: the engine offers
 * one step per clean session, and each lift comes round every five days, so a
 * cycle of stall → deload → climb back takes about 35 days. A lifter gaining
 * less than one step per 35 days — under ~10 kg a year against the default
 * 1 kg step — tops out at the same weight cycle after cycle. The teeth of the
 * sawtooth stop rising and the chart goes flat.
 *
 * That is not a bug in the engine, and this simulation is not hiding it: it is
 * the plateau the engine cannot see (see `Equipment` in `src/engine/types.ts`,
 * and Part K). A simulation showing a lifter who never improves would be a
 * poor demonstration of a progression engine, so this one improves.
 *
 * ## The year
 *
 * 365 days, one lift a day, in rotation. Two things interrupt it, because a
 * year that goes perfectly proves less than one that does not:
 *
 *   - a ten-day holiday, to show the rotation is a position pointer and not a
 *     calendar — the lift after the break is the next one in the cycle, not
 *     whichever one the date lands on;
 *   - one abandoned session, to show it costs the athlete nothing (B5.7).
 */

import {
  DEFAULT_STEP_KG,
  applyOutcome,
  initialState,
  prescribe,
} from "../../src/engine";
import type {
  Deload,
  EngineState,
  Equipment,
  Exercise,
  ExerciseId,
  Session,
  SetLog,
  TrainingDay,
} from "../../src/engine";

/* ------------------------------------------------------------ the lifter */

/** Day one. Arbitrary, and fixed so the committed chart is reproducible. */
const FIRST_DAY_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

/** Days off, as day indices from zero. Ten days in early May. */
const HOLIDAY_FROM = 118;
const HOLIDAY_TO = 127;

/** The one session that gets walked away from. */
const ABANDONED_DAY = 200;

/**
 * How far above the starting weight the athlete already is on day one.
 * Enough that the first few sessions are clean, which is how a start weight is
 * meant to be chosen (G1.3).
 */
const HEADROOM_KG = 2;

/** The quick part of the curve: 12% of the start, most of it inside two months. */
const FAST_GAIN_FRACTION = 0.12;
const FAST_GAIN_TAU_DAYS = 45;

/** The slow part: a steady 15 kg a year, still running in December. */
const SLOW_GAIN_KG_PER_YEAR = 15;

/** The strong side is 6% ahead, so the weak side is what stalls first. */
const STRONG_SIDE_ADVANTAGE = 1.06;

/** Each set of the session is a little harder than the one before it. */
const FATIGUE_PER_SET = 0.03;

/**
 * How far over capacity costs a rep: 2.5%. On a 40 kg lift that is one step,
 * so a single step too far is a four-rep near miss and three steps is a
 * collapse — which is the distinction B5 exists to read (INV-4).
 */
const OVERLOAD_PER_REP = 0.025;

const TARGET_REPS = 5;
const SETS_PER_SESSION = 3;

/**
 * The rotation, with the start weights and weak sides the app ships as
 * suggestions.
 *
 * These used to be a `Lift` wrapper around the exercise, because `Exercise`
 * had nowhere to put them and `EngineState` was seeded by hand. Both now live
 * on the exercise itself (C3.0), so the wrapper is gone and this is the same
 * shape the app stores.
 */
const ROTATION: readonly Exercise[] = [
  {
    id: "split-squat",
    name: "Bulgarian Split Squat",
    pattern: "squat",
    videoQuery: "bulgarian split squat dumbbell form",
    startKg: 30,
    weakSide: "left",
  },
  {
    id: "press",
    name: "Single-Arm Shoulder Press",
    pattern: "vertical push",
    videoQuery: "single arm dumbbell shoulder press form",
    startKg: 17.5,
    weakSide: "left",
  },
  {
    id: "deadlift",
    name: "Single-Leg Deadlift",
    pattern: "hip hinge",
    videoQuery: "single leg romanian deadlift dumbbell form",
    startKg: 32.5,
    weakSide: "right",
  },
  {
    id: "bench",
    name: "Single-Arm Bench Press",
    pattern: "horizontal push",
    videoQuery: "single arm dumbbell bench press form",
    startKg: 22.5,
    weakSide: "left",
  },
  {
    id: "row",
    name: "Single-Arm Row",
    pattern: "horizontal pull",
    videoQuery: "single arm dumbbell row form",
    startKg: 27.5,
    weakSide: "left",
  },
];

/**
 * The heaviest weight this lift's weak side could complete five clean reps
 * with, on this day. The fixed curve, and the only thing the simulation knows
 * that the engine does not.
 */
function capacityKg(lift: Exercise, day: number): number {
  const start = lift.startKg + HEADROOM_KG;
  const fast = start * FAST_GAIN_FRACTION * (1 - Math.exp(-day / FAST_GAIN_TAU_DAYS));
  const slow = SLOW_GAIN_KG_PER_YEAR * (day / YEAR_DAYS);
  return start + fast + slow;
}

/**
 * How many reps come out of one set, given what is in the hand.
 *
 * At or under capacity, all five. Over it, reps fall away smoothly — and the
 * third set of the session is measured against a slightly lower capacity than
 * the first, so a session that is only just too heavy fails at the end rather
 * than at the start. That is what a real near miss looks like.
 */
function repsFor(weightKg: number, capacity: number): number {
  const overload = weightKg / capacity - 1;
  if (overload <= 0) return TARGET_REPS;
  const reps = Math.round(TARGET_REPS - overload / OVERLOAD_PER_REP);
  return Math.min(TARGET_REPS, Math.max(0, reps));
}

/* --------------------------------------------------------------- the run */

/** A deload, with enough context to find it on the chart. */
export type SimDeload = Deload & {
  readonly trainingDay: TrainingDay;
  readonly sessionId: string;
};

export type SimLift = {
  readonly exercise: Exercise;
  /** The capacity curve, sampled on every day of the year. For the chart. */
  readonly capacityKg: readonly number[];
};

export type SimResult = {
  readonly equipment: Equipment;
  readonly lifts: readonly SimLift[];
  readonly sessions: readonly Session[];
  readonly sets: readonly SetLog[];
  readonly deloads: readonly SimDeload[];
  readonly finalState: ReadonlyMap<ExerciseId, EngineState>;
  readonly firstDay: TrainingDay;
  readonly lastDay: TrainingDay;
  readonly days: number;
};

function dayOf(index: number): TrainingDay {
  return new Date(FIRST_DAY_UTC + index * DAY_MS).toISOString().slice(0, 10);
}

/** Day index back out of a training day, so the chart can place a session. */
export function dayIndexOf(day: TrainingDay): number {
  return Math.round((Date.parse(`${day}T00:00:00.000Z`) - FIRST_DAY_UTC) / DAY_MS);
}

function trained(day: number): boolean {
  return day < HOLIDAY_FROM || day > HOLIDAY_TO;
}

/**
 * Run the year.
 *
 * The lifter does exactly what the engine says, every time: no hand-edited
 * weights anywhere in here. That is what lets the test assert that every drop
 * on the chart is a deload — there is nothing else it could be.
 */
export function simulate(
  equipment: Equipment = { stepKg: DEFAULT_STEP_KG },
): SimResult {
  // The same seed the app uses: replay starts every lift here (C3.1).
  const states = new Map<ExerciseId, EngineState>(
    ROTATION.map((lift) => [lift.id, initialState(lift)]),
  );

  const sessions: Session[] = [];
  const sets: SetLog[] = [];
  const deloads: SimDeload[] = [];

  // The rotation is a position, not a calendar (INV-6): it advances only when
  // a session happens, so the holiday shifts the whole cycle rather than
  // skipping the lifts that fell inside it.
  let position = 0;

  for (let day = 0; day < YEAR_DAYS; day += 1) {
    if (!trained(day)) continue;

    const lift = ROTATION[position % ROTATION.length]!;
    position += 1;

    const state = states.get(lift.id)!;
    const prescription = prescribe(state, lift);
    const weightKg = prescription.weightKg;

    const trainingDay = dayOf(day);
    const sessionId = `sim-${day}`;
    const abandoned = day === ABANDONED_DAY;

    const weakCapacity = capacityKg(lift, day);
    const strongCapacity = weakCapacity * STRONG_SIDE_ADVANTAGE;

    const sessionSets: SetLog[] = [];
    // Both sides of set one, then set two: the weak side leads every set,
    // while fresh (`lift-log-design.md` §6.4).
    const logged = abandoned ? 2 : SETS_PER_SESSION * 2;
    for (let ordinal = 0; ordinal < logged; ordinal += 1) {
      const setIndex = Math.floor(ordinal / 2);
      const weak = ordinal % 2 === 0;
      const fatigue = 1 - FATIGUE_PER_SET * setIndex;
      const capacity = (weak ? weakCapacity : strongCapacity) * fatigue;
      sessionSets.push({
        id: `${sessionId}-${ordinal}`,
        sessionId,
        ordinal,
        side: weak ? lift.weakSide : lift.weakSide === "left" ? "right" : "left",
        targetReps: TARGET_REPS,
        doneReps: repsFor(weightKg, capacity),
        loggedAt: `${trainingDay}T08:${String(2 + ordinal * 5).padStart(2, "0")}:00.000Z`,
      });
    }

    const session: Session = {
      id: sessionId,
      exerciseId: lift.id,
      startedAt: `${trainingDay}T08:00:00.000Z`,
      finishedAt: abandoned ? null : `${trainingDay}T08:32:00.000Z`,
      trainingDay,
      prescribedKg: weightKg,
      actualKg: weightKg,
      status: abandoned ? "abandoned" : "complete",
      note: abandoned ? "Gym closed early." : null,
      deletedAt: null,
    };

    const history = sessions.filter((s) => s.exerciseId === lift.id);
    const outcome = applyOutcome(state, equipment, session, sessionSets, history);

    sessions.push(session);
    sets.push(...sessionSets);
    if (outcome.deload !== null) {
      deloads.push({ ...outcome.deload, trainingDay, sessionId });
    }
    states.set(lift.id, outcome.state);
  }

  return {
    equipment,
    lifts: ROTATION.map((lift) => ({
      exercise: lift,
      capacityKg: Array.from({ length: YEAR_DAYS }, (_, day) => capacityKg(lift, day)),
    })),
    sessions,
    sets,
    deloads,
    finalState: states,
    firstDay: dayOf(0),
    lastDay: dayOf(YEAR_DAYS - 1),
    days: YEAR_DAYS,
  };
}
