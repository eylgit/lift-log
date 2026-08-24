/**
 * What day it is (INV-5).
 *
 * One function, and it is in the shell rather than in `src/engine/` for a
 * reason the engine states about itself: *a clock is I/O and the engine has
 * none* (see the header of `src/engine/stats.ts`, INV-9). Every engine function
 * that needs today's date is handed one, which is what lets the whole of B be
 * tested without freezing time. Reading the actual clock has to happen
 * somewhere, and this is that somewhere — the one place in the app that calls
 * `new Date()` with no argument.
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
