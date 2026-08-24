/**
 * The history screen's data — the calendar (E1.1) and the log beneath it (E1.2).
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
 * The list is the same four outcomes read a second way. A square answers "what
 * happened on the 12th"; a row answers "what did I lift, and how did it go", and
 * tapping one opens every set of it (E1.2). Both are built from one read of the
 * log, because they are two views of it rather than two questions.
 *
 * Like `today.ts` this is a plain module, not a hook, and today's date is
 * handed in rather than read. Both are so it can be tested without a browser
 * and without freezing time (see the header of `src/clock.ts`).
 */

import { addDays, daysBetween, startOfWeek } from "./clock";
import type { LoggedSession, Repo } from "./db";
import type {
  Exercise,
  ExerciseId,
  Instant,
  SessionId,
  SessionStatus,
  SetLog,
  Side,
  TrainingDay,
} from "./engine";
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

/**
 * One row of the log (E1.2).
 *
 * Four things and no more: when, which lift, what was on the dumbbell, and how
 * it went. Everything else a session holds — every set, both sides, the target
 * it was measured against — is one tap away in `SessionDetail`, and putting any
 * of it here would turn a list you can scan into a wall you have to read.
 *
 * `weightKg` is `actualKg`, what was lifted rather than what was asked for
 * (INV-7). The prescription is kept and the detail shows both, but a list of
 * weights that were never on the dumbbell would be a list of the wrong numbers.
 */
export type SessionRow = {
  readonly id: SessionId;
  readonly trainingDay: TrainingDay;
  /** The lift's name, or its id if it has since left the rotation. */
  readonly exercise: string;
  /** What was actually lifted (INV-7). */
  readonly weightKg: number;
  readonly outcome: DayOutcome;
  /**
   * Reps missing across every side logged, from `doneReps` rather than a
   * pass/fail flag (INV-4). Zero unless `outcome` is `short` — the same figure
   * `LastResult` carries on the Today card, for the same reason: "short" on its
   * own does not say whether it was one rep or ten.
   */
  readonly repsShort: number;
};

/**
 * One set of a past session: the weak side, then the other (D2.4).
 *
 * `sides` is an array rather than a left/right pair because a set can be
 * half-logged — the athlete walked out between the two sides — and a pair would
 * have to invent a zero for the side that was never done. One entry per row in
 * the log, and no entry for a row that is not there.
 */
export type LoggedSet = {
  /** 1-based, because it is read on the screen. */
  readonly setNumber: number;
  readonly sides: readonly LoggedSide[];
};

export type LoggedSide = {
  readonly side: Side;
  readonly targetReps: number;
  readonly doneReps: number;
};

/**
 * One session, all the way down to every set (E1.2).
 *
 * The detail is the only screen in the app that shows `prescribedKg` beside
 * `actualKg`. Everywhere else the actual weight is the only one that matters,
 * because it is the one progression is measured from (§6.2) — but this screen
 * is where somebody asks "why did the weight not go up", and the answer is
 * sometimes that they overrode it (INV-7). Hiding the pair here would make the
 * log less able to explain itself than the log actually is.
 */
export type SessionDetail = {
  readonly id: SessionId;
  readonly trainingDay: TrainingDay;
  /** The lift's name, or its id if it has since left the rotation. */
  readonly exercise: string;
  readonly status: SessionStatus;
  /** null while the session is still open, which is when it has no result yet. */
  readonly outcome: DayOutcome | null;
  /** What the engine asked for. Kept so a stall is explicable later. */
  readonly prescribedKg: number;
  /** What was actually lifted (INV-7). */
  readonly actualKg: number;
  readonly sets: readonly LoggedSet[];
  /** Reps completed across every side logged. */
  readonly reps: number;
  /** The target those sides were measured against. */
  readonly targetReps: number;
  readonly startedAt: Instant;
  readonly finishedAt: Instant | null;
  /**
   * Anything else true about this session. Written by backfill and by nothing
   * else today (E3.1, and `BACKFILL_NOTE` in `src/session.ts`).
   */
  readonly note: string | null;
};

/** Everything the history screen draws. */
export type History = {
  readonly heat: HeatMap;
  /** Every session that reached an end, newest first (E1.2). */
  readonly log: readonly SessionRow[];
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
 * How a session went, or null if it has not gone yet.
 *
 * The one place that decision is made, so a square, a row and a detail heading
 * cannot disagree about the same session. `isClean` comes from the engine
 * rather than being re-derived here, which is the same rule one level down
 * (INV-2, and the header of this file).
 *
 * A session still `planned` has no outcome, for the reason `lastResultFor`
 * skips them: it is either the session being trained right now or one nobody
 * closed, and neither is a result.
 */
export function outcomeOf({ session, sets }: LoggedSession): DayOutcome | null {
  if (session.status === "planned") return null;
  if (session.status === "abandoned") return "walked out";
  return isClean(session, sets) ? "clean" : "short";
}

/**
 * Reps missing against what was asked for, across every side logged (INV-4).
 *
 * Sides that were never logged contribute nothing. A session walked out of
 * after one set is short by what that set missed, not by the four sets that
 * never happened — the walking out is already the outcome, and counting the
 * absent sets as missed reps would charge for it twice.
 */
export function repsShortIn(sets: readonly SetLog[]): number {
  return sets.reduce((short, set) => short + Math.max(0, set.targetReps - set.doneReps), 0);
}

/**
 * Fold the log into one entry per day.
 *
 * Sessions with no outcome are skipped. Today's square fills in when the
 * session is finished, which is the moment it becomes true.
 */
export function summariseDays(
  log: readonly LoggedSession[],
): ReadonlyMap<TrainingDay, DaySummary> {
  const days = new Map<TrainingDay, DaySummary>();

  for (const entry of log) {
    const outcome = outcomeOf(entry);
    if (outcome === null) continue;
    const { session } = entry;

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

/* --------------------------------------------------------- the list (E1.2) */

/**
 * The lift's name, falling back to its id.
 *
 * A session whose exercise has left the rotation has no name to show — the
 * rotation is the only table that holds one, and `saveRotation` replaces it
 * wholesale (see `Repo.saveRotation`). Nothing in the app drops a lift today,
 * but an imported file can carry a session for one, and a row reading
 * `undefined` would be worse than a row reading `split-squat`.
 */
function nameOf(exercises: readonly Exercise[], id: ExerciseId): string {
  return exercises.find((exercise) => exercise.id === id)?.name ?? id;
}

/**
 * The log as rows, newest first (E1.2).
 *
 * `readLog` hands them over oldest first in a total order (see `chronologically`
 * in `src/db/dexie-repo.ts`), so reversing is the whole of the sort — and it is
 * stable, which matters for two sessions on one day: they keep the order they
 * were trained in, newest at the top.
 *
 * Sessions with no outcome are left out, the same ones the grid leaves out. An
 * open session is not history yet, and the app already has a screen for it.
 *
 * Every session is listed, however far back it goes. The grid is clamped to
 * `MAX_WEEKS` because it must draw a square for every day in its window; the
 * list draws one row per session, so a mistyped year costs one row rather than
 * fifty thousand squares.
 */
export function listLog(
  log: readonly LoggedSession[],
  exercises: readonly Exercise[],
): readonly SessionRow[] {
  const rows: SessionRow[] = [];

  for (const entry of log) {
    const outcome = outcomeOf(entry);
    if (outcome === null) continue;
    const { session, sets } = entry;
    rows.push({
      id: session.id,
      trainingDay: session.trainingDay,
      exercise: nameOf(exercises, session.exerciseId),
      weightKg: session.actualKg,
      outcome,
      repsShort: outcome === "short" ? repsShortIn(sets) : 0,
    });
  }

  return rows.reverse();
}

/**
 * Fold logged sides into sets.
 *
 * A new set starts on an even ordinal, because that is what the session runner
 * writes: the weak side is ordinal 0, the other is 1, and set two starts at 2
 * (`sideAt` in `src/session.ts`). Reading the boundary off the ordinal rather
 * than counting in pairs is what lets a half-logged set stay half a set — a
 * session walked out of between sides has an odd number of rows, and the last
 * one belongs to a set of its own rather than being paired with whatever comes
 * next.
 *
 * The side shown is the one recorded on the row, not the one `sideAt` would
 * have predicted. They differ when the athlete corrected it mid-session (D5.5),
 * and the log is the record of what happened.
 */
export function groupSets(sets: readonly SetLog[]): readonly LoggedSet[] {
  const grouped: LoggedSet[] = [];

  for (const set of [...sets].sort((a, b) => a.ordinal - b.ordinal)) {
    const side: LoggedSide = {
      side: set.side,
      targetReps: set.targetReps,
      doneReps: set.doneReps,
    };
    const open = grouped[grouped.length - 1];
    if (open === undefined || set.ordinal % 2 === 0) {
      grouped.push({ setNumber: grouped.length + 1, sides: [side] });
    } else {
      grouped[grouped.length - 1] = { ...open, sides: [...open.sides, side] };
    }
  }

  return grouped;
}

/** One session, all the way down to every set (E1.2). */
export function detailOf(
  { session, sets }: LoggedSession,
  exercises: readonly Exercise[],
): SessionDetail {
  return {
    id: session.id,
    trainingDay: session.trainingDay,
    exercise: nameOf(exercises, session.exerciseId),
    status: session.status,
    outcome: outcomeOf({ session, sets }),
    prescribedKg: session.prescribedKg,
    actualKg: session.actualKg,
    sets: groupSets(sets),
    reps: sets.reduce((total, set) => total + set.doneReps, 0),
    targetReps: sets.reduce((total, set) => total + set.targetReps, 0),
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    note: session.note,
  };
}

/* ------------------------------------------------------------- the reads */

/**
 * Read the log and build both views of it.
 *
 * `readLog()` rather than `listSessions()` plus a set read per session: the
 * outcome of a day is `isClean`, `isClean` needs the sets, and asking for them
 * one session at a time is the standard way to make a fast local database feel
 * slow (see `LoggedSession` in `src/db/repo.ts`). One read serves the grid and
 * the list both, which is the reason they are built in the same function rather
 * than by two screens that each go to storage. Tombstoned sessions never arrive
 * here at all — every read on `Repo` filters them (INV-3) — so deleting a
 * session empties its square and drops its row without this file knowing that
 * deletion exists.
 */
export async function loadHistory(repo: Repo, today: TrainingDay): Promise<History> {
  const [log, exercises] = await Promise.all([repo.readLog(), repo.listExercises()]);
  return {
    heat: buildHeatMap(summariseDays(log), today),
    log: listLog(log, exercises),
  };
}

/**
 * Read one session and everything in it, or null if it is not there.
 *
 * Null rather than a throw, because the honest reason for a miss is that the
 * session was deleted — from this very screen (E1.3), or on another device
 * before an import — and every read on `Repo` filters tombstones (INV-3). A row
 * tapped from a list that has since gone stale is not a fault; it is a session
 * that is no longer in the log, and the screen can say so.
 */
export async function loadDetail(repo: Repo, id: SessionId): Promise<SessionDetail | null> {
  const [session, exercises] = await Promise.all([repo.getSession(id), repo.listExercises()]);
  if (session === undefined) return null;
  const sets = await repo.listSets(id);
  return detailOf({ session, sets }, exercises);
}
