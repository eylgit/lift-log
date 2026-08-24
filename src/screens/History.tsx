/**
 * History — the calendar (E1.1).
 *
 * The whole screen is one grid of squares and a sentence saying what they mean.
 * It is deliberately not a dashboard: there is no streak, no "this week" target
 * and no percentage, because every one of those is a number that falls when you
 * rest and the design says plainly that the app never does that (§5, and the
 * header of `src/history.ts`).
 *
 * The wording lives here and the shapes live in `src/history.ts`, the same
 * split as Today — a sentence can be rewritten without touching a rule.
 */

import type { DayCell, DayOutcome, HeatMap } from "../history";

/** Monday first, matching `weekdayIndex`. Initials, because seven must fit. */
export const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function HistoryScreen({ heat, onBack }: { heat: HeatMap; onBack: () => void }) {
  return (
    <>
      <div className="row">
        <span className="eyebrow">History</span>
        <button className="quiet" onClick={onBack}>
          Back
        </button>
      </div>

      <h1 className="lift">{headline(heat)}</h1>
      <p className="change">{caption(heat)}</p>

      <div className="rule" />

      <div className="cal" role="table" aria-label="Training calendar">
        <div className="cal-head" role="row">
          <span className="cal-month" />
          {WEEKDAYS.map((initial, i) => (
            <span key={i} className="cal-day" role="columnheader">
              {initial}
            </span>
          ))}
        </div>

        {heat.weeks.map((week, w) => (
          <div key={w} className="cal-week" role="row">
            <span className="cal-month" role="rowheader">
              {monthMark(week)}
            </span>
            {week.map((cell, i) =>
              cell === null ? (
                <span key={i} className="cal-cell hole" />
              ) : (
                <span
                  key={cell.day}
                  role="cell"
                  className={cellClass(cell)}
                  title={dayTitle(cell)}
                  aria-label={dayTitle(cell)}
                />
              ),
            )}
          </div>
        ))}
      </div>

      <div className="legend">
        <span className="cal-cell" /> rested
        <span className="cal-cell out" /> walked out
        <span className="cal-cell short" /> short
        <span className="cal-cell clean" /> clean
      </div>

      <div className="grow" />

      <p className="hint">
        An empty square is a rest day and costs nothing. The rotation is a
        position, not a calendar — miss a week and the next lift is still simply
        the next lift.
      </p>
    </>
  );
}

/** The one number worth a headline: days trained, not days missed. */
export function headline(heat: HeatMap): string {
  if (heat.sessions === 0) return "Nothing logged yet";
  const sessions = `${heat.sessions} ${heat.sessions === 1 ? "session" : "sessions"}`;
  return `${sessions} so far`;
}

/**
 * What the grid covers, said once so the count above it cannot be misread as
 * all-time when the window has been clamped.
 */
export function caption(heat: HeatMap): string {
  const weeks = heat.weeks.length;
  const span = `over ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  if (heat.sessions === 0) return `${span} — the first square is waiting for you`;
  const days = `${heat.trainedDays} ${heat.trainedDays === 1 ? "day" : "days"} trained`;
  return `${days} ${span}`;
}

function cellClass(cell: DayCell): string {
  const outcome =
    cell.outcome === "clean"
      ? " clean"
      : cell.outcome === "short"
        ? " short"
        : cell.outcome === "walked out"
          ? " out"
          : "";
  return `cal-cell${outcome}${cell.isToday ? " today" : ""}`;
}

/**
 * The square's label. Read out by a screen reader and shown on a long press,
 * which on a phone is the only way to ask a square what it is.
 */
export function dayTitle(cell: DayCell): string {
  const what = cell.outcome === null ? "rest" : describe(cell.outcome, cell.sessions);
  return `${cell.day} — ${what}${cell.isToday ? " (today)" : ""}`;
}

function describe(outcome: DayOutcome, sessions: number): string {
  return sessions > 1 ? `${sessions} sessions, best ${outcome}` : outcome;
}

/**
 * The month label in the gutter, on the row where a month starts.
 *
 * Anchored to the row holding the 1st rather than to the row where the month
 * has most of its days: the label then sits beside the square it names, which
 * is what makes a long grid scannable.
 */
export function monthMark(week: readonly (DayCell | null)[]): string {
  for (const cell of week) {
    if (cell === null) continue;
    const [year, month, day] = cell.day.split("-");
    if (day === "01") return month === "01" ? year! : MONTHS[Number(month) - 1]!;
  }
  return "";
}
