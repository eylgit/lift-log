/**
 * B7.1 for the derived statistics (B6).
 *
 * These functions have no rules to get wrong in the way the progression rules
 * do — they mostly count things. What they can get wrong is the boundaries:
 * which sessions are allowed to count, what happens either side of a month end,
 * and what an empty log does. That is most of what is here.
 */

import { describe, expect, it } from "vitest";

import {
  chartSeries,
  estimated1RM,
  personalBest,
  sessionsThisMonth,
  streak,
} from "../src/engine/stats";
import type { Session, SetLog } from "../src/engine/types";

const PRESS = "press";
const ROW = "row";

function session(over: Partial<Session> & { id: string }): Session {
  const day = over.trainingDay ?? "2026-08-20";
  return {
    exerciseId: PRESS,
    startedAt: `${day}T08:00:00.000Z`,
    finishedAt: `${day}T08:30:00.000Z`,
    trainingDay: day,
    prescribedKg: over.actualKg ?? 20,
    actualKg: 20,
    status: "complete",
    note: null,
    deletedAt: null,
    ...over,
  };
}

/** Sessions on consecutive days at the given weights, oldest first. */
function run(weights: number[], startDay = 1): Session[] {
  return weights.map((kg, i) =>
    session({
      id: `s${startDay + i}`,
      trainingDay: `2026-08-${String(startDay + i).padStart(2, "0")}`,
      actualKg: kg,
    }),
  );
}

function setsFor(sessionId: string, reps: number[]): SetLog[] {
  return reps.map((doneReps, i) => ({
    id: `${sessionId}-${i}`,
    sessionId,
    ordinal: i,
    side: i % 2 === 0 ? "left" : "right",
    targetReps: 5,
    doneReps,
    loggedAt: "2026-08-20T08:00:00.000Z",
  }));
}

describe("estimated1RM (B6.1)", () => {
  it("applies Epley", () => {
    // 30 × (1 + 5/30) = 35
    expect(estimated1RM(30, 5)).toBe(35);
    // 40 × (1 + 3/30) = 44
    expect(estimated1RM(40, 3)).toBe(44);
  });

  it("makes 30 × 5 and 35 × 3 comparable, which is the entire point", () => {
    // 30 × 5 estimates 35; 35 × 3 estimates 38.5. The heavier triple is the
    // stronger performance, which is not obvious by eye and is why this exists.
    expect(estimated1RM(35, 3)).toBeGreaterThan(estimated1RM(30, 5));
  });

  it("returns a single as itself rather than inflating it", () => {
    // Epley would call a 40 kg single a 41.33 kg max.
    expect(estimated1RM(40, 1)).toBe(40);
  });

  it("is zero for a set that produced no reps", () => {
    expect(estimated1RM(40, 0)).toBe(0);
  });

  it("refuses a rep count that is not a non-negative number", () => {
    expect(() => estimated1RM(40, -1)).toThrow(RangeError);
    expect(() => estimated1RM(40, Number.NaN)).toThrow(RangeError);
  });
});

describe("chartSeries (B6.2)", () => {
  it("returns one point per session, oldest first", () => {
    const points = chartSeries(PRESS, run([20, 22.5, 25]), []);
    expect(points.map((p) => p.weightKg)).toEqual([20, 22.5, 25]);
    expect(points.map((p) => p.trainingDay)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("sorts a log that arrives out of order", () => {
    const [first, second, third] = run([20, 22.5, 25]) as [Session, Session, Session];
    expect(
      chartSeries(PRESS, [third, first, second], []).map((p) => p.weightKg),
    ).toEqual([20, 22.5, 25]);
  });

  it("leaves out other exercises, rather than drawing them on the same line", () => {
    const history = [
      ...run([20, 22.5]),
      session({ id: "row-1", exerciseId: ROW, actualKg: 90, trainingDay: "2026-08-03" }),
    ];
    expect(chartSeries(PRESS, history, []).map((p) => p.weightKg)).toEqual([20, 22.5]);
  });

  it("leaves out abandoned and deleted sessions", () => {
    const history = [
      ...run([20, 22.5]),
      session({ id: "gone", actualKg: 99, trainingDay: "2026-08-03", status: "abandoned" }),
      session({ id: "dead", actualKg: 99, trainingDay: "2026-08-04", deletedAt: "2026-08-05T00:00:00.000Z" }),
    ];
    expect(chartSeries(PRESS, history, []).map((p) => p.weightKg)).toEqual([20, 22.5]);
  });

  it("takes the 1RM from the best set of each session", () => {
    const history = run([30]);
    const sets = setsFor("s1", [5, 5, 5, 5, 5, 3]);
    // The best set is 5 reps, not the last one: 30 × (1 + 5/30) = 35.
    expect(chartSeries(PRESS, history, sets)[0]?.estimated1RM).toBe(35);
  });

  it("reads only the sets belonging to its own sessions", () => {
    const history = run([30]);
    const sets = [...setsFor("s1", [3]), ...setsFor("elsewhere", [5])];
    // 30 × (1 + 3/30) = 33, not the 35 the foreign set would give.
    expect(chartSeries(PRESS, history, sets)[0]?.estimated1RM).toBe(33);
  });

  it("marks where the weight went down", () => {
    const points = chartSeries(PRESS, run([20, 22.5, 25, 20, 22.5]), []);
    expect(points.map((p) => p.weightDropped)).toEqual([false, false, false, true, false]);
  });

  it("never marks the first session as a drop", () => {
    expect(chartSeries(PRESS, run([20]), [])[0]?.weightDropped).toBe(false);
  });

  it("marks every session that equals or beats everything before it", () => {
    //                                      20     22.5   20     22.5   25
    const points = chartSeries(PRESS, run([20, 22.5, 20, 22.5, 25]), []);
    expect(points.map((p) => p.personalBest)).toEqual([true, true, false, true, true]);
  });

  it("is empty for an exercise with no history", () => {
    expect(chartSeries(PRESS, [], [])).toEqual([]);
  });
});

describe("streak (B6.3)", () => {
  it("counts consecutive days ending today", () => {
    expect(streak(run([20, 20, 20], 18), "2026-08-20")).toBe(3);
  });

  it("does not break just because today has not been trained yet", () => {
    // Trained the 18th, 19th and 20th; it is now the 21st and the day is young.
    expect(streak(run([20, 20, 20], 18), "2026-08-21")).toBe(3);
  });

  it("breaks once a whole day has been missed", () => {
    expect(streak(run([20, 20, 20], 18), "2026-08-22")).toBe(0);
  });

  it("stops at the gap rather than counting everything in the log", () => {
    const history = [...run([20, 20], 10), ...run([20, 20, 20], 18)];
    expect(streak(history, "2026-08-20")).toBe(3);
  });

  it("counts a day once, however many sessions it holds", () => {
    const history = [
      session({ id: "a", trainingDay: "2026-08-20" }),
      session({ id: "b", trainingDay: "2026-08-20", exerciseId: ROW }),
    ];
    expect(streak(history, "2026-08-20")).toBe(1);
  });

  it("counts every exercise, because the question is whether you turned up", () => {
    const history = [
      session({ id: "a", trainingDay: "2026-08-19" }),
      session({ id: "b", trainingDay: "2026-08-20", exerciseId: ROW }),
    ];
    expect(streak(history, "2026-08-20")).toBe(2);
  });

  it("ignores abandoned and deleted days", () => {
    const history = [
      session({ id: "a", trainingDay: "2026-08-19", status: "abandoned" }),
      session({ id: "b", trainingDay: "2026-08-20" }),
    ];
    expect(streak(history, "2026-08-20")).toBe(1);
  });

  it("crosses a month end, and a leap day", () => {
    const across = [
      session({ id: "a", trainingDay: "2026-07-30" }),
      session({ id: "b", trainingDay: "2026-07-31" }),
      session({ id: "c", trainingDay: "2026-08-01" }),
    ];
    expect(streak(across, "2026-08-01")).toBe(3);

    const leap = [
      session({ id: "a", trainingDay: "2028-02-28" }),
      session({ id: "b", trainingDay: "2028-02-29" }),
      session({ id: "c", trainingDay: "2028-03-01" }),
    ];
    expect(streak(leap, "2028-03-01")).toBe(3);
  });

  it("is zero for an empty log", () => {
    expect(streak([], "2026-08-20")).toBe(0);
  });

  it("refuses a day that is not YYYY-MM-DD", () => {
    expect(() => streak([], "20 Aug 2026")).toThrow(RangeError);
  });
});

describe("sessionsThisMonth (B6.3)", () => {
  it("counts only the month today falls in", () => {
    const history = [...run([20, 20], 30).map((s) => ({ ...s, trainingDay: s.trainingDay.replace("-08-", "-07-") })), ...run([20, 20, 20], 1)];
    expect(sessionsThisMonth(history, "2026-08-20")).toBe(3);
  });

  it("counts every exercise", () => {
    const history = [
      session({ id: "a", trainingDay: "2026-08-01" }),
      session({ id: "b", trainingDay: "2026-08-02", exerciseId: ROW }),
    ];
    expect(sessionsThisMonth(history, "2026-08-20")).toBe(2);
  });

  it("counts sessions, not days", () => {
    const history = [
      session({ id: "a", trainingDay: "2026-08-01" }),
      session({ id: "b", trainingDay: "2026-08-01", exerciseId: ROW }),
    ];
    expect(sessionsThisMonth(history, "2026-08-20")).toBe(2);
  });

  it("ignores abandoned and deleted sessions", () => {
    const history = [
      session({ id: "a", trainingDay: "2026-08-01", status: "abandoned" }),
      session({ id: "b", trainingDay: "2026-08-02", deletedAt: "2026-08-03T00:00:00.000Z" }),
      session({ id: "c", trainingDay: "2026-08-03" }),
    ];
    expect(sessionsThisMonth(history, "2026-08-20")).toBe(1);
  });

  it("is zero for an empty log", () => {
    expect(sessionsThisMonth([], "2026-08-20")).toBe(0);
  });
});

describe("personalBest (B6.4)", () => {
  it("finds the heaviest weight completed", () => {
    expect(personalBest(PRESS, run([20, 25, 22.5]))?.weightKg).toBe(25);
  });

  it("reports the day it was first reached, not the last time it was matched", () => {
    const history = run([20, 25, 22.5, 25]);
    expect(personalBest(PRESS, history)?.trainingDay).toBe("2026-08-02");
  });

  it("does not look at other exercises", () => {
    const history = [
      ...run([20, 25]),
      session({ id: "row-1", exerciseId: ROW, actualKg: 90, trainingDay: "2026-08-03" }),
    ];
    expect(personalBest(PRESS, history)?.weightKg).toBe(25);
  });

  it("ignores abandoned and deleted sessions", () => {
    const history = [
      ...run([20, 25]),
      session({ id: "gone", actualKg: 99, trainingDay: "2026-08-03", status: "abandoned" }),
      session({ id: "dead", actualKg: 99, trainingDay: "2026-08-04", deletedAt: "2026-08-05T00:00:00.000Z" }),
    ];
    expect(personalBest(PRESS, history)?.weightKg).toBe(25);
  });

  it("is null when the exercise has never been trained", () => {
    expect(personalBest(PRESS, [])).toBeNull();
    expect(personalBest(PRESS, [session({ id: "row-1", exerciseId: ROW })])).toBeNull();
  });
});
