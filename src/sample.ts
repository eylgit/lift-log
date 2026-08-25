/**
 * A virtual lifter, and a log made by running the real engine over them.
 *
 * This started life as `tests/simulation/lifter.ts`, the fixture behind B7.3's
 * year-long run and the sawtooth chart in the README. G2 needs the same thing
 * at a different length — fourteen weeks of plausible history, ending today, so
 * a first-time visitor lands on a full calendar and a real chart instead of an
 * empty grid and a form. Those are two runs of one model, not two models, so
 * the model moved here and the test fixture became a call into it with the
 * year's parameters.
 *
 * The model is deliberately thin: one number per lift, per day, for how heavy a
 * set of five the athlete's weak side could complete if asked. Everything else
 * — what to lift, when to add weight, when to back off — comes from
 * `src/engine/`, unmodified. That is the whole point, and it is what makes the
 * sample data worth showing: the deloads in it are not drawn, they are what the
 * shipped engine did when the shipped rules met a lifter who stalled.
 *
 * Nothing here reads a clock or touches storage. The caller says which day is
 * day zero and what to do with the result.
 */

import { applyOutcome, initialState, prescribe } from "./engine";
import type {
  Deload,
  EngineState,
  Equipment,
  Exercise,
  ExerciseId,
  Instant,
  Session,
  SetLog,
  TrainingDay,
} from "./engine";
import type { Settings, Snapshot } from "./db";
import { addDays } from "./clock";

/* ------------------------------------------------------------- the curve */

/** The quick part: 12% of the start, most of it spent inside two months. */
const FAST_GAIN_FRACTION = 0.12;
const FAST_GAIN_TAU_DAYS = 45;

/**
 * The slow part: a steady gain per *year*, prorated by day.
 *
 * Per year and not per run, which is the one thing that had to change when this
 * became parameterised. The year-long run divided by its own length, which is
 * the same arithmetic when the run is a year and badly wrong when it is
 * fourteen weeks — a sample athlete who put fifteen kilos on every lift in a
 * quarter would be a fantasy, and the sawtooth would be all teeth and no
 * plateau.
 */
const SLOW_GAIN_KG_PER_YEAR = 15;
const DAYS_IN_YEAR = 365;

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
 * The heaviest weight this lift's weak side could complete five clean reps
 * with, on this day. The fixed curve, and the only thing the simulation knows
 * that the engine does not.
 */
export function capacityKg(lift: Exercise, day: number, headroomKg: number): number {
  const start = lift.startKg + headroomKg;
  const fast = start * FAST_GAIN_FRACTION * (1 - Math.exp(-day / FAST_GAIN_TAU_DAYS));
  const slow = SLOW_GAIN_KG_PER_YEAR * (day / DAYS_IN_YEAR);
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

/** Everything the run needs, and nothing it can read for itself. */
export type Run = {
  readonly rotation: readonly Exercise[];
  readonly equipment: Equipment;
  /** How many days to walk, and which day is day zero. */
  readonly days: number;
  readonly firstDay: TrainingDay;
  /**
   * How far above the starting weight the athlete already is on day one.
   *
   * This is the dial that decides how soon the first stall arrives, and so how
   * many deloads a short run contains. Generous headroom gives a long clean
   * climb; little or none puts the athlete at the edge of their capacity from
   * the first session, which is what a fourteen-week sample needs in order to
   * show the part of the method that is worth showing.
   */
  readonly headroomKg: number;
  /** An inclusive range of days not trained, or null. */
  readonly restFrom: number | null;
  readonly restTo: number | null;
  /** A day the athlete walked out of the session, or null (B5.7). */
  readonly abandonedDay: number | null;
  /** What session and set ids start with. */
  readonly idPrefix: string;
};

/** A deload, with enough context to find it on a chart. */
export type RunDeload = Deload & {
  readonly trainingDay: TrainingDay;
  readonly sessionId: string;
};

export type RunLift = {
  readonly exercise: Exercise;
  /** The capacity curve, sampled on every day of the run. For the chart. */
  readonly capacityKg: readonly number[];
};

export type RunResult = {
  readonly equipment: Equipment;
  readonly lifts: readonly RunLift[];
  readonly sessions: readonly Session[];
  readonly sets: readonly SetLog[];
  readonly deloads: readonly RunDeload[];
  readonly finalState: ReadonlyMap<ExerciseId, EngineState>;
  readonly firstDay: TrainingDay;
  readonly lastDay: TrainingDay;
  readonly days: number;
};

/**
 * Walk the days.
 *
 * The lifter does exactly what the engine says, every time: there is no
 * hand-edited weight anywhere in here. That is what lets B7.3 assert that every
 * drop on the chart is a deload — there is nothing else it could be — and it is
 * the same reason the sample log is worth putting in front of someone.
 */
export function run(options: Run): RunResult {
  const { rotation, equipment, days, firstDay, headroomKg, idPrefix } = options;

  // The same seed the app uses: replay starts every lift here (C3.1).
  const states = new Map<ExerciseId, EngineState>(
    rotation.map((lift) => [lift.id, initialState(lift)]),
  );

  const sessions: Session[] = [];
  const sets: SetLog[] = [];
  const deloads: RunDeload[] = [];

  // The rotation is a position, not a calendar (INV-6): it advances only when
  // a session happens, so a break shifts the whole cycle rather than skipping
  // the lifts that fell inside it.
  let position = 0;

  const trained = (day: number) =>
    options.restFrom === null ||
    options.restTo === null ||
    day < options.restFrom ||
    day > options.restTo;

  for (let day = 0; day < days; day += 1) {
    if (!trained(day)) continue;

    const lift = rotation[position % rotation.length]!;
    position += 1;

    const state = states.get(lift.id)!;
    const weightKg = prescribe(state, lift).weightKg;

    const trainingDay = addDays(firstDay, day);
    const sessionId = `${idPrefix}${day}`;
    const abandoned = day === options.abandonedDay;

    const weakCapacity = capacityKg(lift, day, headroomKg);
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
    lifts: rotation.map((lift) => ({
      exercise: lift,
      capacityKg: Array.from({ length: days }, (_, day) => capacityKg(lift, day, headroomKg)),
    })),
    sessions,
    sets,
    deloads,
    finalState: states,
    firstDay,
    lastDay: addDays(firstDay, days - 1),
    days,
  };
}

/* -------------------------------------------------------- the sample (G2) */

/** Fourteen weeks — long enough for a full calendar and more than one cycle. */
export const SAMPLE_WEEKS = 14;
export const SAMPLE_DAYS = SAMPLE_WEEKS * 7;

/** Sample rows are prefixed, so a glance at the database says what they are. */
export const SAMPLE_ID_PREFIX = "sample-";

/**
 * The athlete the sample log belongs to.
 *
 * Real-looking start weights rather than the app's one-step defaults, because
 * the whole job of the sample is to look like somebody's actual log. The step
 * is 2.5 kg — the commonest thing an adjustable dumbbell does — and the
 * deadlift's weak side is the right one, so the visitor sees that the field is
 * per-lift and not a global setting.
 */
export const SAMPLE_ROTATION: readonly Exercise[] = [
  { id: "split-squat", name: "Bulgarian Split Squat",     pattern: "squat",           videoQuery: "bulgarian split squat form",      startKg: 30,   weakSide: "left"  },
  { id: "press",       name: "Single-Arm Shoulder Press", pattern: "vertical push",   videoQuery: "single arm dumbbell press form",  startKg: 17.5, weakSide: "left"  },
  { id: "deadlift",    name: "Single-Leg Deadlift",       pattern: "hip hinge",       videoQuery: "single leg romanian deadlift",    startKg: 32.5, weakSide: "right" },
  { id: "bench",       name: "Single-Arm Bench Press",    pattern: "horizontal push", videoQuery: "single arm dumbbell bench press", startKg: 22.5, weakSide: "left"  },
  { id: "row",         name: "Single-Arm Row",            pattern: "horizontal pull", videoQuery: "single arm dumbbell row form",    startKg: 27.5, weakSide: "left"  },
];

export const SAMPLE_EQUIPMENT: Equipment = { stepKg: 2.5 };

/**
 * No headroom at all: the sample athlete starts at the edge of what they can
 * lift.
 *
 * That is not how a real athlete should choose a start weight — the method says
 * start absurdly light, and G1.2 does — but it is what makes fourteen weeks
 * show the method rather than a straight line. With headroom the first stall
 * is two months away and the sample log is a diagonal; without it the first
 * cycle stalls early and the visitor sees the thing worth seeing.
 */
export const SAMPLE_HEADROOM_KG = 0;

/** A week away in the middle, so the calendar has a hole and the log a gap. */
export const SAMPLE_REST_FROM = 52;
export const SAMPLE_REST_TO = 58;

/** One session walked out of, to show it costs nothing (B5.7). */
export const SAMPLE_ABANDONED_DAY = 79;

/**
 * Fourteen weeks of somebody else's training, ending today (G2.1).
 *
 * `today` is handed in rather than read, like every other date in the app
 * (INV-5, and the header of `src/clock.ts`). The run ends on it rather than
 * starting from a fixed date, because a sample log whose last session was in
 * January would put a stranger on a Today card that says the rotation has been
 * idle for months — which is a true statement about the wrong thing.
 */
export function sampleRun(today: TrainingDay): RunResult {
  return run({
    rotation: SAMPLE_ROTATION,
    equipment: SAMPLE_EQUIPMENT,
    days: SAMPLE_DAYS,
    firstDay: addDays(today, -(SAMPLE_DAYS - 1)),
    headroomKg: SAMPLE_HEADROOM_KG,
    restFrom: SAMPLE_REST_FROM,
    restTo: SAMPLE_REST_TO,
    abandonedDay: SAMPLE_ABANDONED_DAY,
    idPrefix: SAMPLE_ID_PREFIX,
  });
}

/**
 * The sample log as a whole database, ready to be written (G2.1).
 *
 * A `Snapshot` and not a list of sessions, because sample mode replaces
 * *everything*: the rotation has different start weights and a different weak
 * side, the step is 2.5 rather than 1, and a log full of 30 kg split squats
 * against a rotation that starts at 1 kg would replay into nonsense. Handing
 * back the whole database makes that one write instead of four, and it is the
 * same shape a restore takes.
 *
 * `settings` is the athlete's own row with three fields changed, not a fresh
 * one. Whatever they had set for rest length or units is theirs and survives
 * looking at the sample; what changes is the mark that says this is sample data,
 * and `onboardedAt`, because somebody who pressed "try it" has been shown the
 * app and should not be dropped back into setup on the next open.
 *
 * `lastExportedAt` is cleared for a reason worth stating: leaving a real
 * backup's timestamp on a log that is no longer the log it described would make
 * the Today card and the backup screen both claim a second copy exists of
 * training that is not in it.
 */
export function sampleSnapshot(
  today: TrainingDay,
  settings: Settings,
  now: Instant,
): Snapshot {
  const result = sampleRun(today);
  return {
    exercises: SAMPLE_ROTATION,
    equipment: SAMPLE_EQUIPMENT,
    settings: { ...settings, sampleDataAt: now, onboardedAt: now, lastExportedAt: null },
    sessions: result.sessions,
    sets: result.sets,
  };
}

