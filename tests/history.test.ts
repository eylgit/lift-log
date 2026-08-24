/**
 * E1.1 — the calendar heat map, E1.2 — the log beneath it, E1.3 — deleting.
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
import { rebuildState } from "../src/db/replay";
import type { LoggedSession, Repo } from "../src/db/repo";
import type { Exercise, Session, SetLog, TrainingDay } from "../src/engine";
import type { DayCell, DaySummary, HeatMap } from "../src/history";
import {
  buildHeatMap,
  detailOf,
  groupSets,
  listLog,
  loadDetail,
  loadHistory,
  summariseDays,
} from "../src/history";

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

/** The rotation, as far as anything here cares: one lift with a name. */
const ROTATION: readonly Exercise[] = [
  {
    id: "split-squat",
    name: "Bulgarian Split Squat",
    pattern: "squat",
    videoQuery: "bulgarian split squat form",
    startKg: 1,
    weakSide: "left",
  },
];

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

/* ------------------------------------------------------------ the list (E1.2) */

describe("listLog", () => {
  it("puts the newest session at the top", () => {
    // `readLog` hands them over oldest first. The list is the other way round,
    // because the question a list answers is "what did I do lately".
    const rows = listLog(
      [
        logged({ id: "old", trainingDay: addDays(TODAY, -4) }),
        logged({ id: "new", trainingDay: TODAY }),
      ],
      ROTATION,
    );

    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("keeps two sessions on one day in the order they were trained", () => {
    // Reversing a total order is still a total order. The later of the two is
    // the more recent, so it goes above the earlier one.
    const rows = listLog(
      [
        logged({ id: "first", startedAt: `${TODAY}T08:00:00.000Z` }),
        logged({ id: "second", startedAt: `${TODAY}T18:00:00.000Z` }),
      ],
      ROTATION,
    );

    expect(rows.map((row) => row.id)).toEqual(["second", "first"]);
  });

  it("leaves a session that is still open out of the list", () => {
    // The same rule the grid applies. An open session has not happened yet.
    expect(listLog([logged({ id: "s1", status: "planned" }, [5, 5])], ROTATION)).toEqual([]);
  });

  it("shows what was lifted, not what was asked for (INV-7)", () => {
    const [row] = listLog([logged({ id: "s1", prescribedKg: 22, actualKg: 20 })], ROTATION);

    expect(row!.weightKg).toBe(20);
  });

  it("names the lift from the rotation", () => {
    const [row] = listLog([logged({ id: "s1" })], ROTATION);

    expect(row!.exercise).toBe("Bulgarian Split Squat");
  });

  it("falls back to the id for a lift that has left the rotation", () => {
    // Nothing in the app drops a lift, but an imported file can carry a session
    // for one. A row reading `undefined` would be worse than a row reading the
    // id it actually has.
    const [row] = listLog([logged({ id: "s1", exerciseId: "front-squat" })], ROTATION);

    expect(row!.exercise).toBe("front-squat");
  });

  it("says how short a short session was (INV-4)", () => {
    // Two reps missing on one side, one on another. "short" alone does not say
    // whether that was a near miss or a collapse.
    const [row] = listLog([logged({ id: "s1" }, [5, 3, 4, 5, 5, 5])], ROTATION);

    expect(row!.outcome).toBe("short");
    expect(row!.repsShort).toBe(3);
  });

  it("charges a walked-out session for the reps it missed, not the sets it never did", () => {
    // One set of a planned three, both sides clean, then the athlete left. The
    // walking out is already the outcome; counting the four absent sides as
    // twenty missed reps would charge for it twice.
    const [row] = listLog([logged({ id: "s1", status: "abandoned" }, [5, 5])], ROTATION);

    expect(row!.outcome).toBe("walked out");
    expect(row!.repsShort).toBe(0);
  });

  it("lists a session the grid is too short to show", () => {
    // The grid stops at 270 weeks because it must draw a square for every day
    // in its window. The list draws one row per session, so a mistyped year
    // costs one row.
    const rows = listLog([logged({ id: "s1", trainingDay: "1926-08-24" })], ROTATION);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.trainingDay).toBe("1926-08-24");
  });
});

/* ------------------------------------------------ sets, folded back into sets */

describe("groupSets", () => {
  it("pairs the two sides of each set", () => {
    const sets = groupSets(setsOf("s1", CLEAN));

    expect(sets.map((set) => set.setNumber)).toEqual([1, 2, 3]);
    expect(sets.every((set) => set.sides.length === 2)).toBe(true);
  });

  it("leaves a half-logged set as half a set", () => {
    // Walked out between the two sides. Inventing a zero for the side that was
    // never done would be recording a rep count nobody performed.
    const sets = groupSets(setsOf("s1", [5, 5, 5]));

    expect(sets).toHaveLength(2);
    expect(sets[1]!.sides).toHaveLength(1);
    expect(sets[1]!.sides[0]!.side).toBe("left");
  });

  it("shows the side that was recorded, not the one the rotation predicted", () => {
    // D5.5: the athlete corrected the side mid-session. The log is the record
    // of what happened, and the screen reads the row.
    const rows = setsOf("s1", [5, 5]).map((set, i) =>
      i === 0 ? { ...set, side: "right" as const } : set,
    );

    expect(groupSets(rows)[0]!.sides.map((side) => side.side)).toEqual(["right", "right"]);
  });

  it("sorts by ordinal rather than trusting the order it was handed", () => {
    const sets = groupSets([...setsOf("s1", CLEAN)].reverse());

    expect(sets[0]!.sides[0]!.doneReps).toBe(5);
    expect(sets.map((set) => set.setNumber)).toEqual([1, 2, 3]);
  });

  it("has nothing to say about a session with no sets", () => {
    expect(groupSets([])).toEqual([]);
  });
});

/* -------------------------------------------------------- one session (E1.2) */

describe("detailOf", () => {
  it("totals the reps against what they were measured by", () => {
    const detail = detailOf(logged({ id: "s1" }, [5, 3, 5, 5, 5, 5]), ROTATION);

    expect(detail.reps).toBe(28);
    expect(detail.targetReps).toBe(30);
    expect(detail.outcome).toBe("short");
  });

  it("keeps the prescription beside the weight that was lifted (INV-7)", () => {
    // The one screen that shows both. It is where "why did the weight not go
    // up" gets answered, and sometimes the answer is that it was overridden.
    const detail = detailOf(logged({ id: "s1", prescribedKg: 22, actualKg: 20 }), ROTATION);

    expect(detail.prescribedKg).toBe(22);
    expect(detail.actualKg).toBe(20);
  });

  it("gives an open session no outcome at all", () => {
    const detail = detailOf(logged({ id: "s1", status: "planned" }, [5, 5]), ROTATION);

    expect(detail.outcome).toBeNull();
    expect(detail.status).toBe("planned");
  });
});

/* -------------------------------------------- the list against a real database */

describe("the list reads the log", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`lift-log-log-${(dbCount += 1)}`);
  });

  async function write(session: Session, done: readonly number[]) {
    await repo.appendSession(session);
    if (done.length > 0) await repo.appendSets(setsOf(session.id, done));
  }

  it("lists a session with the name the rotation gives it", async () => {
    await write(sessionOf({ id: "s1", trainingDay: addDays(TODAY, -2) }), CLEAN);

    const { log } = await loadHistory(repo, TODAY);

    expect(log).toHaveLength(1);
    expect(log[0]!.exercise).toBe("Bulgarian Split Squat");
    expect(log[0]!.outcome).toBe("clean");
  });

  it("drops a deleted session from the list (INV-3)", async () => {
    await write(sessionOf({ id: "s1" }), CLEAN);
    await repo.softDeleteSession("s1", `${TODAY}T09:00:00.000Z`);

    const { log } = await loadHistory(repo, TODAY);

    expect(log).toEqual([]);
  });

  it("opens one session down to every set", async () => {
    await write(sessionOf({ id: "s1" }), [5, 5, 5, 4, 5, 5]);

    const detail = await loadDetail(repo, "s1");

    expect(detail?.exercise).toBe("Bulgarian Split Squat");
    expect(detail?.sets).toHaveLength(3);
    expect(detail?.sets[1]!.sides[1]!.doneReps).toBe(4);
    expect(detail?.outcome).toBe("short");
  });

  it("has nothing to show for a session that was deleted (INV-3)", async () => {
    // Reachable by tapping a row on a list built before the delete. Null rather
    // than a throw: the session is not there, which is not a fault.
    await write(sessionOf({ id: "s1" }), CLEAN);
    await repo.softDeleteSession("s1", `${TODAY}T09:00:00.000Z`);

    expect(await loadDetail(repo, "s1")).toBeNull();
  });

  it("has nothing to show for a session that never existed", async () => {
    expect(await loadDetail(repo, "nobody")).toBeNull();
  });
});

/* ------------------------------------------------------ deleting one (E1.3) */

describe("deleting a session", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`lift-log-delete-${(dbCount += 1)}`);
  });

  /** Three clean sessions of the same lift, a step apart, oldest first. */
  async function threeCleanSessions() {
    for (const [i, kg] of [20, 21, 22].entries()) {
      const session = sessionOf({
        id: `s${i}`,
        trainingDay: addDays(TODAY, i - 4),
        prescribedKg: kg,
        actualKg: kg,
      });
      await repo.appendSession(session);
      await repo.appendSets(setsOf(session.id, CLEAN));
    }
  }

  it("puts the weight back where it was before that session", async () => {
    // The exit criterion for Part E, and the reason the delete rebuilds the
    // cache rather than only writing a tombstone. `engineState` is derived from
    // the log (INV-2); delete the session that earned the last step and the
    // weight it earned has to go with it.
    await threeCleanSessions();

    const before = await rebuildState(repo);
    expect(before.find((s) => s.exerciseId === "split-squat")?.currentKg).toBe(23);

    await repo.softDeleteSession("s2", `${TODAY}T09:00:00.000Z`);
    const after = await rebuildState(repo);

    expect(after.find((s) => s.exerciseId === "split-squat")?.currentKg).toBe(22);
  });

  it("takes it out of the calendar and the list at the same time", async () => {
    await threeCleanSessions();
    await repo.softDeleteSession("s2", `${TODAY}T09:00:00.000Z`);

    const { heat, log } = await loadHistory(repo, TODAY);

    expect(cellFor(heat, addDays(TODAY, -2))?.outcome).toBeNull();
    expect(log.map((row) => row.id)).toEqual(["s1", "s0"]);
    expect(heat.sessions).toBe(2);
  });

  it("leaves the sessions around it exactly as they were", async () => {
    // A tombstone is not a rewrite. Deleting the middle session must not
    // disturb what the others say about themselves.
    await threeCleanSessions();
    const before = await loadDetail(repo, "s0");

    await repo.softDeleteSession("s1", `${TODAY}T09:00:00.000Z`);

    expect(await loadDetail(repo, "s0")).toEqual(before);
    expect((await loadDetail(repo, "s2"))?.actualKg).toBe(22);
  });

  it("keeps the deletion in the backup, so a restore does not resurrect it", async () => {
    // What the confirm on the screen promises. The row stays and carries its
    // tombstone; `snapshot()` is the one read that returns it (INV-3, C4.1).
    await threeCleanSessions();
    await repo.softDeleteSession("s2", `${TODAY}T09:00:00.000Z`);

    const snapshot = await repo.snapshot();
    const deleted = snapshot.sessions.find((session) => session.id === "s2");

    expect(snapshot.sessions).toHaveLength(3);
    expect(deleted?.deletedAt).toBe(`${TODAY}T09:00:00.000Z`);
  });

  it("deletes the only session in the log without leaving a weight behind", async () => {
    // The lift goes back to never having been trained, which is its start
    // weight rather than the weight the deleted session earned.
    const session = sessionOf({ id: "only", prescribedKg: 20, actualKg: 20 });
    await repo.appendSession(session);
    await repo.appendSets(setsOf(session.id, CLEAN));
    await rebuildState(repo);

    await repo.softDeleteSession("only", `${TODAY}T09:00:00.000Z`);
    const after = await rebuildState(repo);

    const exercises = await repo.listExercises();
    const start = exercises.find((e) => e.id === "split-squat")!.startKg;
    expect(after.find((s) => s.exerciseId === "split-squat")?.currentKg).toBe(start);
    expect((await loadHistory(repo, TODAY)).log).toEqual([]);
  });
});
