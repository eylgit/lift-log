/**
 * E2 — the sawtooth, and the numbers under it.
 *
 * Two halves, the same split as the history tests. The first is geometry: given
 * a series, does every point land where the picture needs it, and do the shapes
 * that divide by zero — one session, a run at one weight — come out as
 * something a renderer can draw? The second opens a real database and asks the
 * question a fixture cannot: does deleting a session take its point off the
 * chart (INV-3), which is the other half of Part E's exit criteria.
 *
 * Nothing here reads the clock. The engine's own stats are trusted rather than
 * re-checked — `chartSeries`, `estimated1RM` and `personalBest` have their own
 * tests in `stats.test.ts`, and repeating them here would be a second opinion
 * about a number that is only allowed to have one (INV-2).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { openDexieRepo } from "../src/db/dexie-repo";
import { rebuildState } from "../src/db/replay";
import type { Repo } from "../src/db/repo";
import type { ChartPoint, EngineState, Exercise, PersonalBest, Session, SetLog } from "../src/engine";
import { PLOT_GUTTER, PLOT_HEIGHT, PLOT_WIDTH, loadProgress, plot, statsFor } from "../src/progress";

/* ------------------------------------------------------------- fixtures */

const TODAY = "2026-08-24";

const EXERCISE: Exercise = {
  id: "split-squat",
  name: "Bulgarian Split Squat",
  pattern: "squat",
  videoQuery: "bulgarian split squat form",
  startKg: 10,
  weakSide: "left",
};

/** A series of weights, each one session, oldest first. */
function series(weights: readonly number[], over: Partial<ChartPoint> = {}): ChartPoint[] {
  let previous: number | null = null;
  let heaviest = Number.NEGATIVE_INFINITY;
  return weights.map((weightKg, i) => {
    const point: ChartPoint = {
      sessionId: `s${i}`,
      trainingDay: `2026-08-${String(i + 1).padStart(2, "0")}`,
      weightKg,
      // Epley over five reps, which is what the app prescribes.
      estimated1RM: Math.round(weightKg * (1 + 5 / 30) * 100) / 100,
      weightDropped: previous !== null && weightKg < previous,
      personalBest: weightKg >= heaviest,
      ...over,
    };
    previous = weightKg;
    if (weightKg > heaviest) heaviest = weightKg;
    return point;
  });
}

function sessionOf(over: Partial<Session> & { id: string }): Session {
  const trainingDay = over.trainingDay ?? TODAY;
  return {
    exerciseId: "split-squat",
    startedAt: `${trainingDay}T08:00:00.000Z`,
    finishedAt: `${trainingDay}T08:30:00.000Z`,
    trainingDay,
    prescribedKg: 20,
    actualKg: 20,
    status: "complete",
    note: null,
    deletedAt: null,
    ...over,
  };
}

function setsOf(sessionId: string, done: readonly number[], target = 5): SetLog[] {
  return done.map((doneReps, ordinal) => ({
    id: `${sessionId}-${ordinal}`,
    sessionId,
    ordinal,
    side: ordinal % 2 === 0 ? "left" : "right",
    targetReps: target,
    doneReps,
    loggedAt: `${TODAY}T08:0${ordinal}:00.000Z`,
  }));
}

const CLEAN = [5, 5, 5, 5, 5, 5];

/* ------------------------------------------------------------- geometry */

describe("plot", () => {
  it("has nothing to draw for a lift with no sessions", () => {
    // Null rather than an empty plot: "no line" and "no chart" are different
    // things and the screen says something different for each.
    expect(plot([])).toBeNull();
  });

  it("puts a single session in the middle rather than against the frame", () => {
    // Nowhere to spread across, and the alternative divides by zero.
    const drawn = plot(series([20]))!;

    expect(drawn.points).toHaveLength(1);
    expect(drawn.points[0]!.x).toBeGreaterThan(PLOT_GUTTER);
    expect(drawn.points[0]!.x).toBeLessThan(PLOT_WIDTH);
  });

  it("spreads the sessions from the gutter to the far edge", () => {
    const drawn = plot(series([20, 21, 22, 23]))!;

    expect(drawn.points[0]!.x).toBe(PLOT_GUTTER);
    expect(drawn.points[3]!.x).toBeLessThan(PLOT_WIDTH);
    expect(drawn.points[3]!.x).toBeGreaterThan(PLOT_WIDTH - 20);
    // Evenly, because the axis is the session and not the date.
    const gaps = drawn.points.slice(1).map((at, i) => at.x - drawn.points[i]!.x);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 6);
  });

  it("ignores the days between sessions entirely", () => {
    // Three weeks off is not three weeks of flat line. It is not on this axis
    // at all (§5 — nothing here counts what was missed).
    const close = series([20, 21, 22]);
    const apart = close.map((point, i) => ({ ...point, trainingDay: `2026-0${i + 1}-01` }));

    expect(plot(apart)!.points.map((at) => at.x)).toEqual(plot(close)!.points.map((at) => at.x));
  });

  it("puts the lightest weight at the floor and the best estimate at the ceiling", () => {
    const drawn = plot(series([20, 24, 22]))!;

    expect(Math.min(...drawn.points.map((at) => at.y))).toBeGreaterThan(0);
    expect(drawn.points[0]!.y).toBe(drawn.floorY);
    expect(drawn.points[1]!.y1RM).toBe(drawn.ceilingY);
    expect(drawn.floorKg).toBe(20);
    expect(drawn.ceilingKg).toBe(28);
  });

  it("keeps the estimate above the weight it came from, on every point", () => {
    // One scale, on purpose: Epley multiplies by at least one, so the two lines
    // can never cross and the gap between them means something.
    const drawn = plot(series([20, 24, 22, 19, 25]))!;

    for (const at of drawn.points) expect(at.y1RM).toBeLessThanOrEqual(at.y);
  });

  it("draws a flat line for a run of sessions at one weight", () => {
    // Every number the same is a range of zero, which divides by zero. The
    // scale is given a kilogram either side and the line comes out flat.
    const flat = series([20, 20, 20]).map((point) => ({ ...point, estimated1RM: 20 }));
    const drawn = plot(flat)!;

    expect(drawn.floorKg).toBe(19);
    expect(drawn.ceilingKg).toBe(21);
    expect(new Set(drawn.points.map((at) => at.y)).size).toBe(1);
    expect(drawn.points[0]!.y).toBeCloseTo((PLOT_HEIGHT - 12 + 12) / 2, 6);
  });

  it("marks where the weight went down", () => {
    const drawn = plot(series([20, 21, 18, 19]))!;

    expect(drawn.points.map((at) => at.dropped)).toEqual([false, false, true, false]);
  });

  it("marks the one session it is asked to mark", () => {
    // Every rising session is a personal best by `chartSeries`'s reckoning, so
    // a marker on each is a marker on none. The screen asks for the heaviest.
    const drawn = plot(series([20, 21, 22, 21]), "s2")!;

    expect(drawn.bestAt).toBe(2);
  });

  it("marks nothing when the best is not one of these points", () => {
    expect(plot(series([20, 21]), "elsewhere")!.bestAt).toBeNull();
    expect(plot(series([20, 21]), null)!.bestAt).toBeNull();
  });

  it("holds two hundred sessions inside the frame", () => {
    const many = series(Array.from({ length: 200 }, (_, i) => 20 + i * 0.5));
    const drawn = plot(many, "s199")!;

    expect(drawn.points).toHaveLength(200);
    for (const at of drawn.points) {
      expect(at.x).toBeGreaterThanOrEqual(PLOT_GUTTER);
      expect(at.x).toBeLessThanOrEqual(PLOT_WIDTH);
      expect(at.y1RM).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThanOrEqual(PLOT_HEIGHT);
    }
  });
});

/* ---------------------------------------------------------- the stat row */

describe("statsFor", () => {
  const state: EngineState = { exerciseId: "split-squat", currentKg: 30, stallCount: 0 };
  const best: PersonalBest = {
    exerciseId: "split-squat",
    weightKg: 29,
    trainingDay: "2026-08-03",
    sessionId: "s2",
  };

  it("says nothing it does not know about a lift never trained", () => {
    const stats = statsFor(EXERCISE, { ...state, currentKg: EXERCISE.startKg }, [], null);

    expect(stats).toEqual({
      currentKg: 10,
      startKg: 10,
      gainKg: 0,
      bestKg: null,
      bestDay: null,
      bestSessionId: null,
      best1RM: null,
      drops: 0,
      sessions: 0,
    });
  });

  it("measures the gain against the start weight, not against last session", () => {
    expect(statsFor(EXERCISE, state, series([20, 29]), best).gainKg).toBe(20);
  });

  it("reports a gain below the start weight as the negative it is", () => {
    // Deep in a deload. Calling it zero would be flattering the log.
    const stats = statsFor(EXERCISE, { ...state, currentKg: 7 }, series([10, 7]), null);

    expect(stats.gainKg).toBe(-3);
  });

  it("takes the best estimate from the best set, wherever it happened", () => {
    // Not necessarily the heaviest day: a lighter session with more reps can
    // estimate higher, and the row shows both numbers for exactly that reason.
    const stats = statsFor(EXERCISE, state, series([20, 29]), best);

    expect(stats.bestKg).toBe(29);
    expect(stats.best1RM).toBe(33.83);
  });

  it("counts the times the weight went down", () => {
    expect(statsFor(EXERCISE, state, series([20, 21, 18, 19, 17]), best).drops).toBe(2);
  });
});

/* ------------------------------------------------- against a real database */

describe("the chart reads the log", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`lift-log-progress-${(dbCount += 1)}`);
  });

  async function write(session: Session, done: readonly number[] = CLEAN) {
    await repo.appendSession(session);
    await repo.appendSets(setsOf(session.id, done));
  }

  it("charts the lift it was asked for and no other", async () => {
    // Two exercises on one line would look like a plausible chart rather than
    // an obvious bug, which is why `chartSeries` filters for itself.
    await write(sessionOf({ id: "a", actualKg: 20 }));
    await write(sessionOf({ id: "b", exerciseId: "row", actualKg: 50 }));

    const progress = await loadProgress(repo, "split-squat");

    expect(progress.exercise.id).toBe("split-squat");
    expect(progress.points.map((p) => p.weightKg)).toEqual([20]);
  });

  it("hands back the rotation in order, for the switcher", async () => {
    const { rotation } = await loadProgress(repo, "split-squat");

    expect(rotation.map((e) => e.id)).toEqual([
      "split-squat",
      "press",
      "deadlift",
      "bench",
      "row",
    ]);
  });

  it("takes a deleted session off the chart (INV-3)", async () => {
    // The other half of Part E's exit criteria. Nothing in `progress.ts` knows
    // what a tombstone is; every read on the repository filters them.
    await write(sessionOf({ id: "a", trainingDay: "2026-08-01", actualKg: 20 }));
    await write(sessionOf({ id: "b", trainingDay: "2026-08-03", actualKg: 21 }));
    await write(sessionOf({ id: "c", trainingDay: "2026-08-05", actualKg: 22 }));

    await repo.softDeleteSession("c", `${TODAY}T09:00:00.000Z`);
    await rebuildState(repo);
    const progress = await loadProgress(repo, "split-squat");

    expect(progress.points.map((p) => p.weightKg)).toEqual([20, 21]);
    expect(progress.stats.bestKg).toBe(21);
    expect(progress.stats.sessions).toBe(2);
    // And the weight it earned went with it, which is what E1.3 rebuilds for.
    expect(progress.stats.currentKg).toBe(22);
  });

  it("leaves a session that was walked out of off the chart", async () => {
    // A spike at a weight that was never really finished. `chartSeries` drops
    // them and the stat row inherits that.
    await write(sessionOf({ id: "a", actualKg: 20 }));
    await write(sessionOf({ id: "b", status: "abandoned", actualKg: 40 }), [5, 5]);

    const progress = await loadProgress(repo, "split-squat");

    expect(progress.points.map((p) => p.weightKg)).toEqual([20]);
    expect(progress.stats.bestKg).toBe(20);
  });

  it("has a chart-shaped nothing for a lift never trained", async () => {
    const progress = await loadProgress(repo, "press");

    expect(progress.points).toEqual([]);
    expect(plot(progress.points)).toBeNull();
    expect(progress.stats.currentKg).toBe(progress.stats.startKg);
  });

  it("falls back to the first of the rotation for a lift that is not in it", async () => {
    // A screen with no wrong answer available: better the first lift's chart
    // than a throw the athlete cannot act on.
    const progress = await loadProgress(repo, "front-squat");

    expect(progress.exercise.id).toBe("split-squat");
  });
});
