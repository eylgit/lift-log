/**
 * The history calendar (E1.1).
 *
 * One square per day, driven by `trainingDay` and nothing else. That is worth
 * being precise about, because it is the same distinction the rotation pointer
 * makes (INV-6): the grid is a picture of the *calendar*, and the rotation is
 * not on a calendar at all. Skip a fortnight and the grid shows a fortnight of
 * empty squares — it does not show a debt, a broken streak, or a run of days
 * you owe. There is no number anywhere in this file that goes down when you do
 * not train (§5: guilt is friction, and friction is the enemy).
 *
 * What a square says is what happened, not how hard it was. Four outcomes and
 * no scale of effort: nothing logged, walked out, short, clean. "Clean" is
 * `isClean` from the engine rather than a second reading of the set log here,
 * for the reason INV-2 exists — one answer to "was that clean", so a square can
 * never disagree with the weight the card prescribes above it.
 *
 * Like `today.ts` this is a plain module, not a hook, and today's date is
 * handed in rather than read. Both are so it can be tested without a browser
 * and without freezing time (see the header of `src/clock.ts`).
 */

import { addDays, daysBetween, startOfWeek } from "./clock";
import type { LoggedSession, Repo } from "./db";
import type { TrainingDay } from "./engine";
import { isClean } from "./engine";

/**
 * What became of a day's training.
 *
 * The same three words the Today card uses for the last session (`LastResult`),
 * because they are the same question asked of a different row. A day with
 * nothing logged has no outcome at all rather than a fourth word — it is not a
 * result, it is the absence of one.
 */
export type DayOutcome = "clean" | "short" | "walked out";

/** A day's training, folded down from however many sessions it holds. */
export type DaySummary = {
  readonly outcome: DayOutcome;
  readonly sessions: number;
};

/** One square. */
export type DayCell = {
  readonly day: TrainingDay;
  /** null when nothing was logged that day. */
  readonly outcome: DayOutcome | null;
  /**
   * How many sessions the day holds. Normally one — the app prescribes one lift
   * a day — but backfill (E3) can put a second one on a day that was trained
   * away from the phone, and the square should not pretend otherwise.
   */
  readonly sessions: number;
  readonly isToday: boolean;
};

/**
 * The grid: whole weeks, Monday first, oldest at the top.
 *
 * Weeks are rows rather than columns. The familiar arrangement — GitHub's —
 * puts weeks across and weekdays down, which needs fifty-odd columns of
 * horizontal room; this app is 520 px wide at most and never scrolls sideways.
 * Seven across and a row per week is a wall calendar, which is also what
 * somebody looking for "did I train on Tuesday" already knows how to read.
 *
 * A `null` is a day outside the window: the days after today in the final row,
 * and any before the first row's Monday. They are holes rather than empty
 * squares, because an empty square means "did not train" and tomorrow has not
 * had the chance.
 */
export type HeatMap = {
  /** Rows of exactly seven, Monday to Sunday. */
  readonly weeks: readonly (readonly (DayCell | null)[])[];
  /** The Monday the grid opens on. */
  readonly from: TrainingDay;
  /** Today. The last square that can be filled. */
  readonly to: TrainingDay;
  /** Days in the window with at least one session. */
  readonly trainedDays: number;
  /** Sessions in the window. Days with two count twice. */
  readonly sessions: number;
};

/** Everything the history screen draws. The list (E1.2) joins this. */
export type History = {
  readonly heat: HeatMap;
};

/**
 * The shortest grid worth drawing, in weeks.
 *
 * A fresh log would otherwise be a single row with one square in it, which
 * reads as an error rather than as a beginning.
 */
const MIN_WEEKS = 4;

/**
 * The longest, in weeks — a little over five years.
 *
 * Not a limit anyone will meet by training. It is there because a training day
 * is a string, an imported file can carry a mistyped one, and `1926-08-24`
 * would otherwise ask the screen for fifty thousand squares. The cap loses
 * nothing that is not already wrong, and the list in E1.2 shows every session
 * whether or not its day fits here.
 */
const MAX_WEEKS = 270;

/** How much a day tells us, worst to best. A day is described by its best. */
const RANK: Record<DayOutcome, number> = { "walked out": 0, short: 1, clean: 2 };

/**
 * Fold the log into one entry per day.
 *
 * Sessions still `planned` are skipped, for the reason `lastResultFor` skips
 * them: one is either the session being trained right now or one nobody closed,
 * and neither is a result. Today's square fills in when the session is finished,
 * which is the moment it becomes true.
 */
export function summariseDays(
  log: readonly LoggedSession[],
): ReadonlyMap<TrainingDay, DaySummary> {
  const days = new Map<TrainingDay, DaySummary>();

  for (const { session, sets } of log) {
    if (session.status === "planned") continue;

    const outcome: DayOutcome =
      session.status === "abandoned" ? "walked out" : isClean(session, sets) ? "clean" : "short";

    const seen = days.get(session.trainingDay);
    days.set(session.trainingDay, {
      outcome: seen === undefined || RANK[outcome] > RANK[seen.outcome] ? outcome : seen.outcome,
      sessions: (seen?.sessions ?? 0) + 1,
    });
  }

  return days;
}

/**
 * Lay the days out as whole weeks.
 *
 * The window runs from the Monday of the week holding the first logged day to
 * the Sunday of the week holding today, widened to `MIN_WEEKS` and clamped to
 * `MAX_WEEKS`. Days after today are holes; days before the first session are
 * empty squares, because those are days that could have been trained and were
 * not, and hiding them would flatter the picture.
 */
export function buildHeatMap(
  days: ReadonlyMap<TrainingDay, DaySummary>,
  today: TrainingDay,
): HeatMap {
  const end = addDays(startOfWeek(today), 6);
  const shortest = addDays(startOfWeek(today), -(MIN_WEEKS - 1) * 7);
  const longest = addDays(startOfWeek(today), -(MAX_WEEKS - 1) * 7);

  let from = shortest;
  for (const day of days.keys()) {
    const monday = startOfWeek(day);
    if (daysBetween(monday, from) > 0) from = monday;
  }
  if (daysBetween(longest, from) < 0) from = longest;

  const weeks: (DayCell | null)[][] = [];
  const total = daysBetween(from, end) + 1;

  for (let offset = 0; offset < total; offset += 1) {
    const day = addDays(from, offset);
    if (offset % 7 === 0) weeks.push([]);
    const week = weeks[weeks.length - 1]!;

    // Beyond today is a hole, not an empty square. See `HeatMap`.
    if (daysBetween(day, today) < 0) {
      week.push(null);
      continue;
    }

    const found = days.get(day);
    week.push({
      day,
      outcome: found?.outcome ?? null,
      sessions: found?.sessions ?? 0,
      isToday: day === today,
    });
  }

  // Only days inside the window are counted, so the caption cannot claim
  // sessions the grid above it is not showing.
  let trainedDays = 0;
  let sessions = 0;
  for (const [day, found] of days) {
    if (daysBetween(from, day) < 0 || daysBetween(day, today) < 0) continue;
    trainedDays += 1;
    sessions += found.sessions;
  }

  return { weeks, from, to: today, trainedDays, sessions };
}

/**
 * Read the log and build the grid.
 *
 * `readLog()` rather than `listSessions()` plus a set read per session: the
 * outcome of a day is `isClean`, `isClean` needs the sets, and asking for them
 * one session at a time is the standard way to make a fast local database feel
 * slow (see `LoggedSession` in `src/db/repo.ts`). Tombstoned sessions never
 * arrive here at all — every read on `Repo` filters them (INV-3) — so deleting
 * a session empties its square without this file knowing that deletion exists.
 */
export async function loadHistory(repo: Repo, today: TrainingDay): Promise<History> {
  const log = await repo.readLog();
  return { heat: buildHeatMap(summariseDays(log), today) };
}
