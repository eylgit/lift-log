/**
 * History — the calendar (E1.1) and the log beneath it (E1.2).
 *
 * Two views of one read: a grid of squares saying which days were trained, and
 * a list saying what was lifted on them. It is deliberately not a dashboard:
 * there is no streak, no "this week" target and no percentage, because every one
 * of those is a number that falls when you rest and the design says plainly that
 * the app never does that (§5, and the header of `src/history.ts`).
 *
 * The list is the whole log rather than the last N. A row is four short strings
 * and two hundred of them is a page of text, which a phone scrolls through
 * faster than the athlete could decide what "the last twenty" should have meant.
 *
 * The wording lives here and the shapes live in `src/history.ts`, the same
 * split as Today — a sentence can be rewritten without touching a rule.
 */

import { Fragment } from "react";

import type { DayCell, DayOutcome, HeatMap, SessionRow } from "../history";
import type { SessionId, TrainingDay } from "../engine";
import type { Units } from "../units";
import { weight } from "../units";

/** Monday first, matching `weekdayIndex`. Initials, because seven must fit. */
export const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function HistoryScreen({
  heat,
  log,
  units,
  onOpen,
  onAdd,
  onBack,
}: {
  heat: HeatMap;
  log: readonly SessionRow[];
  units: Units;
  onOpen: (id: SessionId) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
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

      {log.length > 0 && (
        <>
          <div className="rule" />
          <span className="eyebrow">The log</span>

          <ul className="log">
            {log.map((row, i) => (
              <Fragment key={row.id}>
                {yearMark(log, i, heat.to) !== null && (
                  <li className="log-year mono">{yearMark(log, i, heat.to)}</li>
                )}
                <li>
                  <button className="log-row" onClick={() => onOpen(row.id)}>
                    <span className="log-when mono">{shortDay(row.trainingDay)}</span>
                    <span className="log-lift">{row.exercise}</span>
                    <span className="log-kg mono">{weight(row.weightKg, units)}</span>
                    <span className={`cal-cell ${MARK[row.outcome]}`} aria-hidden="true" />
                    <span className="log-mark mono">{result(row)}</span>
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>
        </>
      )}

      <div className="grow" />

      {/* E3 lives here rather than on the card: a gap in the log is something
          you notice while looking at the log. */}
      <button className="missed" onClick={onAdd}>
        Add a session I did elsewhere
      </button>

      <p className="hint">
        An empty square is a rest day and costs nothing. The rotation is a
        position, not a calendar — miss a week and the next lift is still simply
        the next lift.
      </p>
    </>
  );
}

/** The calendar's colours, so a row and its square say the same thing. */
const MARK: Record<DayOutcome, string> = {
  clean: "clean",
  short: "short",
  "walked out": "out",
};

/**
 * How the session went, in the width of a column.
 *
 * "short" alone does not say whether it was one rep or ten, so the deficit
 * rides with it (INV-4). A clean session needs no number: clean *is* the number.
 */
export function result(row: SessionRow): string {
  return row.outcome === "short" && row.repsShort > 0
    ? `short −${row.repsShort}`
    : row.outcome;
}

/** A row's date. The year is not in it — see `yearMark`. */
export function shortDay(day: TrainingDay): string {
  const [, month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? month}`;
}

/**
 * The year to write above a row, or null if the row needs none.
 *
 * A year on every row would repeat "2026" two hundred times and widen the date
 * column for the two rows that are not in it. A separator says the same thing
 * once, at the point where it changes something — reading down the list, that
 * is the moment a row could otherwise be taken for last week.
 *
 * The list runs newest first, so "the year before this one" is the row below in
 * the data and above on the screen. The first row is compared against today's
 * year instead, which is what puts a heading on a log that ended last year.
 */
export function yearMark(
  log: readonly SessionRow[],
  index: number,
  today: TrainingDay,
): string | null {
  const year = log[index]!.trainingDay.slice(0, 4);
  const above = index === 0 ? today.slice(0, 4) : log[index - 1]!.trainingDay.slice(0, 4);
  return year === above ? null : year;
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
