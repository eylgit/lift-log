/**
 * One session from the log, all the way down to every set (E1.2).
 *
 * The screen a row on the History list opens. It answers two questions the list
 * deliberately does not: what happened set by set, and — when the two numbers
 * differ — what the engine asked for against what actually went on the dumbbell.
 * That second pair is the answer to "why did the weight not go up", and it is
 * only shown when it is an answer: a session lifted at exactly the prescribed
 * weight has nothing to explain, and printing the same number twice would turn
 * the interesting case into noise (INV-7, §6.2).
 *
 * It is also where a session gets deleted (E1.3). The confirm is held here in
 * `useState` rather than in the app's state machine, which is the same line the
 * session runner draws: state about *what is open at the screen* lives at the
 * screen, and nothing is written until the second tap.
 *
 * A `TrainingDay` is a label rather than an instant, so the date is spelled out
 * from the string itself and never handed to `toLocaleDateString` — parsing
 * `2026-08-24` gives UTC midnight, which renders as the 23rd anywhere west of
 * Greenwich (INV-5, and the calendar arithmetic in `src/clock.ts`). The clock
 * times below it are real instants and are formatted as such.
 */

import { useState } from "react";

import { weekdayIndex } from "../clock";
import type { TrainingDay } from "../engine";
import type { LoggedSet, SessionDetail } from "../history";

const DAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday",
] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function DetailScreen({
  detail,
  onDelete,
  onBack,
}: {
  detail: SessionDetail;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const overridden = detail.actualKg !== detail.prescribedKg;

  return (
    <>
      <div className="row">
        <span className="eyebrow">Session</span>
        <button className="quiet" onClick={onBack}>
          Back
        </button>
      </div>

      <h1 className="lift">{detail.exercise}</h1>
      <p className="change">{fullDay(detail.trainingDay)}</p>

      <div className="load">
        <span className="kg">{detail.actualKg}</span>
        <span className="unit">kg</span>
      </div>
      <p className="scheme">{result(detail)}</p>

      <div className="rule" />

      {detail.sets.length === 0 ? (
        <p className="notice">
          No sets were logged. The session was opened and left before the first
          side went down.
        </p>
      ) : (
        <div className="sets">
          {detail.sets.map((set) => (
            <div key={set.setNumber} className="kv">
              <span className="k">SET {set.setNumber}</span>
              <span className="v">{sides(set)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rule" />

      {overridden && (
        <div className="kv">
          <span className="k">PRESCRIBED</span>
          <span className="v">{detail.prescribedKg} kg</span>
        </div>
      )}
      <div className="kv">
        <span className="k">STARTED</span>
        <span className="v">{clockTime(detail.startedAt)}</span>
      </div>
      {took(detail) !== null && (
        <div className="kv">
          <span className="k">TOOK</span>
          <span className="v">{took(detail)}</span>
        </div>
      )}

      <div className="grow" />

      {confirming ? (
        <>
          <p className="prompt">Delete this session?</p>
          {/* Every consequence, said plainly, because this is the one action in
              the app that takes something away. The last sentence is INV-3
              seen from the outside: the tombstone is what stops a restored
              backup putting the session back. */}
          <p className="hint">
            It goes from the calendar, the list and the chart, and the weight
            for this lift is worked out again without it. Your backups keep a
            note that it was deleted, so restoring one will not bring it back.
          </p>
          <div className="picker choice">
            <button className="pick" onClick={() => setConfirming(false)}>
              Keep it
            </button>
            <button className="pick drop" onClick={onDelete}>
              Delete
            </button>
          </div>
        </>
      ) : (
        <>
          {overridden && (
            <p className="hint">
              The weight was changed during the session. Progress is measured
              from what was lifted, not from what was asked for.
            </p>
          )}
          {/* Small, and at the far end of the screen from Back. */}
          <button className="missed" onClick={() => setConfirming(true)}>
            Delete this session
          </button>
        </>
      )}
    </>
  );
}

/**
 * The one-line verdict, with the reps behind it.
 *
 * A clean session is stated and left alone — every rep was there, and "30 of 30"
 * invites a comparison that has nothing to compare. Anything else names both
 * numbers, because the gap is the whole of what happened (INV-4).
 */
export function result(detail: SessionDetail): string {
  const reps =
    detail.reps === detail.targetReps
      ? `${detail.reps} reps`
      : `${detail.reps} of ${detail.targetReps} reps`;

  if (detail.outcome === null) return `still open · ${reps}`;
  return `${detail.outcome} · ${reps}`;
}

/**
 * A set's two sides.
 *
 * The target rides along only where it was missed. On a clean set every number
 * is the same number, and repeating it turns a column you can scan into one you
 * have to read.
 */
export function sides(set: LoggedSet): string {
  return set.sides
    .map((side) =>
      side.doneReps === side.targetReps
        ? `${side.side} ${side.doneReps}`
        : `${side.side} ${side.doneReps} of ${side.targetReps}`,
    )
    .join(" · ");
}

/** `2026-08-24` → `Monday 24 August 2026`. Built from the label, never parsed. */
export function fullDay(day: TrainingDay): string {
  const [year, month, date] = day.split("-");
  const weekday = DAYS[weekdayIndex(day)] ?? "";
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${weekday} ${Number(date)} ${name} ${year}`;
}

/** An instant as a wall clock, in the reader's own timezone. */
function clockTime(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * How long the session took, or null if it never closed.
 *
 * Rounded to the minute and never to zero: a session logged in under thirty
 * seconds — a backfill, most likely (E3) — reads as "under a minute" rather
 * than as "0 min", which looks like a bug in the timer.
 */
export function took(detail: SessionDetail): string | null {
  if (detail.finishedAt === null) return null;
  const ms = Date.parse(detail.finishedAt) - Date.parse(detail.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  return minutes === 0 ? "under a minute" : `${minutes} min`;
}
