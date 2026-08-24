/**
 * The progress screen's data (E2).
 *
 * The engine already answers every question this screen asks — `chartSeries`
 * for the sawtooth and the 1RM line, `personalBest` for the best — so nothing
 * here re-derives a number. What this module contributes is the same two things
 * `history.ts` contributes: the join (a lift, its state and its log, put
 * together) and the geometry (points on a 320×150 grid). Both are plain
 * functions taking plain values, so the arithmetic that decides where a line
 * goes can be tested without a browser.
 *
 * **The x axis is the session, not the date.** A fortnight off would otherwise
 * be a fortnight of flat line, which is a picture of not training — and the
 * design is explicit that nothing in this app counts what was missed (§5,
 * INV-6). The calendar upstairs already shows time honestly, square by square.
 * Down here the question is "what has this lift done over its sessions", and
 * spacing them evenly is what makes a sawtooth read as one.
 *
 * The 1RM line shares the sawtooth's scale rather than getting its own. Epley
 * multiplies by at least one, so it always sits above the weight it came from;
 * two axes would let the reader mistake a gap for a crossing, and the gap
 * between "what I lifted" and "what that is worth" is the thing worth seeing.
 */

import type {
  ChartPoint,
  EngineState,
  Exercise,
  ExerciseId,
  PersonalBest,
  Session,
  SetLog,
  TrainingDay,
} from "./engine";
import { chartSeries, initialState, personalBest, roundKg } from "./engine";
import type { Repo } from "./db";

/* --------------------------------------------------------------- the stats */

/**
 * The stat row (E2.4).
 *
 * Every field is null when the lift has never been trained, except the two that
 * are facts about the setup rather than about the log. A lift with no sessions
 * has a start weight and a current weight — they are the same number — and no
 * best, no estimate and no gain, because none of those has happened.
 */
export type ProgressStats = {
  /** What the engine will prescribe next. The cache, which is the log folded up. */
  readonly currentKg: number;
  /** Where this lift began, before any of it was logged. */
  readonly startKg: number;
  /** `currentKg` less `startKg`. Negative after a deload, and shown as such. */
  readonly gainKg: number;
  /** The heaviest completed session, or null if there has not been one. */
  readonly bestKg: number | null;
  /** The day that weight was first reached. */
  readonly bestDay: TrainingDay | null;
  /** Which session it was, so the chart can put a marker on that point. */
  readonly bestSessionId: string | null;
  /** The best estimated 1RM across every session — not necessarily the best day. */
  readonly best1RM: number | null;
  /**
   * How many times the weight went down.
   *
   * The build plan calls this "deload cycles" and it is not quite that. The log
   * records that the weight came down, not who brought it down — the engine
   * after three stalls, or the athlete correcting an unloadable number (INV-7).
   * Telling those apart needs the provenance work in K1.1. Until then the true
   * statement is the smaller one, and the screen says the smaller one.
   */
  readonly drops: number;
  readonly sessions: number;
};

/** Everything the progress screen draws. */
export type Progress = {
  readonly exercise: Exercise;
  /** In rotation order, for the switcher (E2.5). */
  readonly rotation: readonly Exercise[];
  readonly points: readonly ChartPoint[];
  readonly stats: ProgressStats;
};

/* ------------------------------------------------------------ the geometry */

/** The grid the chart is drawn on. The screen scales it to whatever it has. */
export const PLOT_WIDTH = 320;
export const PLOT_HEIGHT = 150;

/**
 * The strip down the left that carries the two weights of the scale.
 *
 * The labels are drawn inside the picture rather than beside it so that they
 * cannot drift out of line with the edges they name — the SVG scales to
 * whatever width the phone gives it, and HTML text alongside would have to be
 * positioned against a box whose height nobody knows until it has been laid out.
 */
export const PLOT_GUTTER = 40;

/**
 * Room for a stroke and a marker at the edges.
 *
 * Without it the first and last sessions are half-drawn against the frame, and
 * a personal best on the last session — which is the common case — loses the
 * outer half of its dot.
 */
const PAD_X = 8;
export const PLOT_PAD_Y = 12;

/** One session, placed. */
export type PlotPoint = {
  readonly sessionId: string;
  readonly trainingDay: TrainingDay;
  readonly weightKg: number;
  readonly estimated1RM: number;
  readonly x: number;
  /** The sawtooth. */
  readonly y: number;
  /** The estimate, on the same scale — so always at or above `y`. */
  readonly y1RM: number;
  /** The weight went down from the session before. */
  readonly dropped: boolean;
};

export type Plot = {
  readonly width: number;
  readonly height: number;
  readonly points: readonly PlotPoint[];
  /** The bottom and top of the scale, in kg. Both are rounded weights. */
  readonly floorKg: number;
  readonly ceilingKg: number;
  /** Where those two weights sit, so the labels line up with the edges. */
  readonly floorY: number;
  readonly ceilingY: number;
  /** Index of the personal best, or null if there is none to mark. */
  readonly bestAt: number | null;
};

/**
 * Place a series on the grid.
 *
 * Returns null for an empty series rather than an empty plot: there is a
 * difference between a chart with no line in it and no chart at all, and the
 * screen says something different in each case.
 *
 * Two degenerate shapes are handled here rather than left to the renderer, both
 * because they are arithmetic and both because they produce a division by zero.
 * A single session has nowhere to spread across, so it sits in the middle. A
 * run of sessions at one weight has no range to scale against — every point is
 * the same number — so the scale is given a kilogram of room either side and
 * the line comes out flat in the middle, which is what it is.
 */
export function plot(series: readonly ChartPoint[], bestSessionId?: string | null): Plot | null {
  if (series.length === 0) return null;

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const point of series) {
    low = Math.min(low, point.weightKg);
    high = Math.max(high, point.estimated1RM);
  }
  if (high - low < 1) {
    const middle = (high + low) / 2;
    low = middle - 1;
    high = middle + 1;
  }

  const span = high - low;
  const usableX = PLOT_WIDTH - PLOT_GUTTER - PAD_X;
  const usableY = PLOT_HEIGHT - 2 * PLOT_PAD_Y;
  const step = series.length === 1 ? 0 : usableX / (series.length - 1);
  const at = (kg: number) => PLOT_HEIGHT - PLOT_PAD_Y - ((kg - low) / span) * usableY;

  const points = series.map((point, i) => ({
    sessionId: point.sessionId,
    trainingDay: point.trainingDay,
    weightKg: point.weightKg,
    estimated1RM: point.estimated1RM,
    x: series.length === 1 ? PLOT_GUTTER + usableX / 2 : PLOT_GUTTER + i * step,
    y: at(point.weightKg),
    y1RM: at(point.estimated1RM),
    dropped: point.weightDropped,
  }));

  const bestAt = points.findIndex((point) => point.sessionId === bestSessionId);

  return {
    width: PLOT_WIDTH,
    height: PLOT_HEIGHT,
    points,
    floorKg: roundKg(low),
    ceilingKg: roundKg(high),
    floorY: PLOT_HEIGHT - PLOT_PAD_Y,
    ceilingY: PLOT_PAD_Y,
    bestAt: bestAt === -1 ? null : bestAt,
  };
}

/* ---------------------------------------------------------------- the join */

/** Fold a series and a lift's setup into the stat row. */
export function statsFor(
  exercise: Exercise,
  state: EngineState,
  series: readonly ChartPoint[],
  best: PersonalBest | null,
): ProgressStats {
  return {
    currentKg: state.currentKg,
    startKg: exercise.startKg,
    gainKg: roundKg(state.currentKg - exercise.startKg),
    bestKg: best?.weightKg ?? null,
    bestDay: best?.trainingDay ?? null,
    bestSessionId: best?.sessionId ?? null,
    best1RM:
      series.length === 0 ? null : series.reduce((top, p) => Math.max(top, p.estimated1RM), 0),
    drops: series.filter((point) => point.weightDropped).length,
    sessions: series.length,
  };
}

/**
 * Read one lift's progress.
 *
 * `readLog()` once, then flattened, because `chartSeries` wants the sessions and
 * the sets as two arrays and asking storage for them separately would be two
 * passes over the same rows. The whole log is read rather than this lift's
 * slice: it is a few hundred rows (§7), and the filtering `chartSeries` does for
 * itself is deliberate — see its header.
 *
 * A lift with no row in `engineState` starts at `initialState`, the same opening
 * balance replay uses (C3.0). That is the honest state of a lift that has never
 * been trained, not a defensive default.
 */
export async function loadProgress(repo: Repo, exerciseId: ExerciseId): Promise<Progress> {
  const [rotation, states, log] = await Promise.all([
    repo.listExercises(),
    repo.listEngineState(),
    repo.readLog(),
  ]);

  const exercise = rotation.find((e) => e.id === exerciseId) ?? rotation[0];
  if (exercise === undefined) {
    // Unreachable through the app — `ensureDefaults` seeds five lifts — but a
    // clear throw beats a screen rendering `undefined.name`.
    throw new RangeError("the rotation is empty; there is nothing to chart");
  }

  const sessions: Session[] = [];
  const sets: SetLog[] = [];
  for (const entry of log) {
    sessions.push(entry.session);
    sets.push(...entry.sets);
  }

  const state = states.find((s) => s.exerciseId === exercise.id) ?? initialState(exercise);
  const series = chartSeries(exercise.id, sessions, sets);

  return {
    exercise,
    rotation,
    points: series,
    stats: statsFor(exercise, state, series, personalBest(exercise.id, sessions)),
  };
}
