/**
 * What day it is (INV-5).
 *
 * Reading the clock is one function, and it is in the shell rather than in
 * `src/engine/` for a reason the engine states about itself: *a clock is I/O
 * and the engine has none* (see the header of `src/engine/stats.ts`, INV-9).
 * Every engine function that needs today's date is handed one, which is what
 * lets the whole of B be tested without freezing time. Reading the clock has to
 * happen somewhere, and this is that somewhere — the one place in the app that
 * calls `new Date()` with no argument.
 *
 * The calendar arithmetic at the foot of the file reads no clock at all. It is
 * here because it is about the same thing — what a `YYYY-MM-DD` means — and
 * because the history grid needs one definition of "the next day" rather than
 * its own.
 */

import type { TrainingDay } from "./engine";

/**
 * The local training day, `YYYY-MM-DD`, with a 3 a.m. cutoff so a session
 * logged just after midnight belongs to the day it felt like.
 *
 * Local, and never derived from a UTC timestamp. An 11 p.m. session in London
 * is already tomorrow in UTC, and a log that recorded it as such would put the
 * session on a day the athlete did not train — which is why `Session` carries
 * this as its own field alongside `startedAt` rather than computing it back out
 * of one (see `TrainingDay` in `src/engine/types.ts`).
 */
export function trainingDay(now: Date = new Date()): TrainingDay {
  const d = new Date(now);
  if (d.getHours() < 3) d.setDate(d.getDate() - 1);
  return localDay(d);
}

/**
 * The local calendar date, `YYYY-MM-DD`, with no cutoff and no cleverness.
 *
 * This is the plain date, for things that are about the clock rather than about
 * training — a backup's filename, most of all. A file saved at half past
 * midnight belongs to the day the phone says it is, because that is the day the
 * athlete will look for it under.
 */
export function localDay(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/* ------------------------------------------------------ calendar arithmetic */

/**
 * `TrainingDay` arithmetic, done in UTC on purpose.
 *
 * A training day is a `YYYY-MM-DD` label, not an instant, and the only sensible
 * way to add a day to a label is to ignore timezones entirely. Parsing
 * `2026-03-29` as UTC midnight and adding 86,400,000 ms always lands on the
 * 30th; doing the same in local time lands on the 29th again in every country
 * that puts its clocks forward that night. Nothing here ever reads the clock —
 * these are string operations wearing a `Date` for the leap-year rules.
 */
const DAY_MS = 86_400_000;

function utcMidnight(day: TrainingDay): number {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new RangeError(`not a training day: ${day}`);
  return ms;
}

function dayOf(ms: number): TrainingDay {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day `count` days after `day`. Negative counts go backwards. */
export function addDays(day: TrainingDay, count: number): TrainingDay {
  return dayOf(utcMidnight(day) + count * DAY_MS);
}

/** How many days from `from` to `to`. Negative if `to` is the earlier one. */
export function daysBetween(from: TrainingDay, to: TrainingDay): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}

/**
 * Which day of the week, counting Monday as 0.
 *
 * Monday rather than Sunday because that is where a European week starts and
 * the athlete is in one. It is a display convention and lives here rather than
 * in the calendar itself so that the grid has one definition of a week.
 */
export function weekdayIndex(day: TrainingDay): number {
  return (new Date(utcMidnight(day)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `day`. */
export function startOfWeek(day: TrainingDay): TrainingDay {
  return addDays(day, -weekdayIndex(day));
}
