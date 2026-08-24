/**
 * E1.1 — the calendar heat map.
 *
 * Two halves, and they are different questions. The first is arithmetic: given
 * a handful of days and a date for "today", does the grid come out as whole
 * Monday-to-Sunday weeks with the right squares filled? The second opens a real
 * database and asks the thing that cannot be checked in a fixture — does a
 * square empty when its session is deleted (INV-3), and does a square stay
 * empty while its session is still open?
 *
 * Every case hands in its own `today`. Nothing here reads the clock, and a test
 * that had to freeze it would be testing the wrong module.
 *
 * `fake-indexeddb` provides the database (see vitest.config.ts).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { addDays, startOfWeek, weekdayIndex } from "../src/clock";
import { openDexieRepo } from "../src/db/dexie-repo";
import type { LoggedSession, Repo } from "../src/db/repo";
import type { Session, SetLog, TrainingDay } from "../src/engine";
import type { DayCell, DaySummary, HeatMap } from "../src/history";
import { buildHeatMap, loadHistory, summariseDays } from "../src/history";

/* ------------------------------------------------------------- fixtures */

/** A Monday, so that the week boundaries in these tests are obvious. */
const TODAY = "2026-08-24";

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

/** Sets for one session, one number per side, in the order they were logged. */
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

function logged(over: Partial<Session> & { id: string }, done = CLEAN): LoggedSession {
  const session = sessionOf(over);
  return { session, sets: setsOf(session.id, done) };
}

/** The square for one day, or undefined if it is outside the grid. */
function cellFor(heat: HeatMap, day: TrainingDay): DayCell | undefined {
  for (const week of heat.weeks) {
    for (const cell of week) if (cell !== null && cell.day === day) return cell;
  }
  return undefined;
}

function days(entries: readonly [TrainingDay, DaySummary][]): Map<TrainingDay, DaySummary> {
  return new Map(entries);
}

/* ------------------------------------------------- what a day's square says */

describe("summariseDays", () => {
  it("calls a session with every rep clean", () => {
    const summary = summariseDays([logged({ id: "s1" })]);

    expect(summary.get(TODAY)).toEqual({ outcome: "clean", sessions: 1 });
  });

  it("calls a session with a rep missing short", () => {
    // INV-4: four out of five is a near miss, and it is still not clean.
    const summary = summariseDays([logged({ id: "s1" }, [5, 5, 5, 4, 5, 5])]);

    expect(summary.get(TODAY)).toEqual({ outcome: "short", sessions: 1 });
  });

  it("calls a session nobody finished walked out", () => {
    const summary = summariseDays([logged({ id: "s1", status: "abandoned" }, [5, 5])]);

    expect(summary.get(TODAY)).toEqual({ outcome: "walked out", sessions: 1 });
  });

  it("leaves a session that is still open out of the grid", () => {
    // The session being trained right now. It has not happened yet, and the
    // square fills in when it is finished — the same rule `lastResultFor` uses.
    const summary = summariseDays([logged({ id: "s1", status: "planned" }, [5, 5])]);

    expect(summary.size).toBe(0);
  });

  it("describes a day by its best session, and counts them all", () => {
    // Two lifts in one day is what backfill (E3) makes possible. A day that
    // held one clean session is a day that was trained cleanly.
    const summary = summariseDays([
      logged({ id: "s1", status: "abandoned" }, [5, 5]),
      logged({ id: "s2" }),
    ]);

    expect(summary.get(TODAY)).toEqual({ outcome: "clean", sessions: 2 });
  });

  it("does not let a later worse session downgrade the day", () => {
    const summary = summariseDays([logged({ id: "s1" }), logged({ id: "s2" }, [5, 1, 5, 5, 5, 5])]);

    expect(summary.get(TODAY)).toEqual({ outcome: "clean", sessions: 2 });
  });
});

/* ----------------------------------------------------------- the grid shape */

describe("buildHeatMap", () => {
  it("lays every row out as seven days, Monday first", () => {
    const heat = buildHeatMap(days([]), "2026-08-27");

    for (const week of heat.weeks) expect(week).toHaveLength(7);
    expect(weekdayIndex(heat.weeks[0]![0]!.day)).toBe(0);
    expect(heat.from).toBe(startOfWeek(heat.weeks[0]![0]!.day));
  });

  it("draws four weeks for a log with nothing in it", () => {
    // One row with one square in it reads as an error rather than a beginning.
    const heat = buildHeatMap(days([]), TODAY);

    expect(heat.weeks).toHaveLength(4);
    expect(heat.to).toBe(TODAY);
    expect(heat.sessions).toBe(0);
    expect(heat.trainedDays).toBe(0);
  });

  it("marks today, and only today", () => {
    const heat = buildHeatMap(days([]), TODAY);
    const marked = heat.weeks.flat().filter((cell) => cell?.isToday);

    expect(marked).toHaveLength(1);
    expect(marked[0]!.day).toBe(TODAY);
  });

  it("leaves the days after today as holes rather than empty squares", () => {
    // A hole is "has not happened"; an empty square is "did not train". The
    // rest of this week has not had its chance yet.
    const heat = buildHeatMap(days([]), "2026-08-26");
    const lastWeek = heat.weeks[heat.weeks.length - 1]!;

    expect(lastWeek.slice(0, 3).every((cell) => cell !== null)).toBe(true);
    expect(lastWeek.slice(3)).toEqual([null, null, null, null]);
  });

  it("opens on the week of the first session when the log is older than that", () => {
    const heat = buildHeatMap(days([["2026-05-13", { outcome: "clean", sessions: 1 }]]), TODAY);

    expect(heat.from).toBe("2026-05-11");
    expect(cellFor(heat, "2026-05-13")).toEqual({
      day: "2026-05-13",
      outcome: "clean",
      sessions: 1,
      isToday: false,
    });
  });

  it("shows a gap in the middle as plain empty squares", () => {
    // Three weeks off is three weeks of nothing. Not a broken streak, not a
    // debt, not a different colour — the same square as any other rest day.
    const heat = buildHeatMap(
      days([
        ["2026-07-27", { outcome: "clean", sessions: 1 }],
        [TODAY, { outcome: "clean", sessions: 1 }],
      ]),
      TODAY,
    );

    for (let offset = 1; offset < 28; offset += 1) {
      const cell = cellFor(heat, addDays("2026-07-27", offset));
      expect(cell?.outcome).toBeNull();
      expect(cell?.sessions).toBe(0);
    }
  });

  it("counts only what the grid is showing", () => {
    // The caption sits under the grid. If it counted a session the squares
    // above it cannot show, it would be describing a different log.
    const heat = buildHeatMap(
      days([
        [addDays(TODAY, -1), { outcome: "clean", sessions: 2 }],
        [addDays(TODAY, -3000), { outcome: "clean", sessions: 4 }],
      ]),
      TODAY,
    );

    expect(heat.trainedDays).toBe(1);
    expect(heat.sessions).toBe(2);
  });

  it("refuses to draw fifty thousand squares for one mistyped date", () => {
    // An imported file can carry anything. The cap loses nothing that is not
    // already wrong, and the session list (E1.2) still shows it.
    const heat = buildHeatMap(days([["1926-08-24", { outcome: "clean", sessions: 1 }]]), TODAY);

    expect(heat.weeks).toHaveLength(270);
    expect(cellFor(heat, "1926-08-24")).toBeUndefined();
    expect(heat.trainedDays).toBe(0);
  });

  it("holds one square per day across a whole year, with no gaps or repeats", () => {
    const heat = buildHeatMap(days([[addDays(TODAY, -364), { outcome: "clean", sessions: 1 }]]), TODAY);
    const laid = heat.weeks.flat().filter((cell): cell is DayCell => cell !== null);

    expect(new Set(laid.map((cell) => cell.day)).size).toBe(laid.length);
    for (let i = 1; i < laid.length; i += 1) {
      expect(laid[i]!.day).toBe(addDays(laid[i - 1]!.day, 1));
    }
  });
});

/* ------------------------------------------------- against a real database */

describe("the calendar reads the log", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`lift-log-history-${(dbCount += 1)}`);
  });

  async function write(session: Session, done: readonly number[]) {
    await repo.appendSession(session);
    if (done.length > 0) await repo.appendSets(setsOf(session.id, done));
  }

  it("fills the square for a session that was trained", async () => {
    await write(sessionOf({ id: "s1", trainingDay: addDays(TODAY, -2) }), CLEAN);

    const { heat } = await loadHistory(repo, TODAY);

    expect(cellFor(heat, addDays(TODAY, -2))?.outcome).toBe("clean");
    expect(heat.sessions).toBe(1);
  });

  it("empties the square when the session is deleted (INV-3)", async () => {
    await write(sessionOf({ id: "s1", trainingDay: addDays(TODAY, -2) }), CLEAN);
    await repo.softDeleteSession("s1", `${TODAY}T09:00:00.000Z`);

    const { heat } = await loadHistory(repo, TODAY);

    // Nothing in `history.ts` knows what a tombstone is. Every read on the
    // repository filters them, so the square empties on its own.
    expect(cellFor(heat, addDays(TODAY, -2))?.outcome).toBeNull();
    expect(heat.sessions).toBe(0);
  });

  it("draws an empty four-week grid for a log with nothing in it", async () => {
    const { heat } = await loadHistory(repo, TODAY);

    expect(heat.weeks).toHaveLength(4);
    expect(heat.weeks.flat().every((cell) => cell === null || cell.outcome === null)).toBe(true);
  });
});
