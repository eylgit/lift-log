/**
 * What just happened, and what happens next (D4).
 *
 * The whole screen is one sentence about the past and one about the future, and
 * the second one is the reason the app exists: "next time, 35 kg" is the number
 * the athlete came for.
 *
 * The deload is announced, not offered (D4.3, B5.3.1). The engine has already
 * dropped the weight — three sessions short is unambiguous enough that being
 * asked is friction rather than control — and anyone who disagrees taps the
 * number back. Saying *why* is not optional, though: a weight that moves down
 * without explanation reads as a bug, and a number nobody understands is a
 * number nobody trusts.
 */

import type { OutcomeResult } from "../engine";
import { isClean } from "../engine";
import type { SessionView } from "../session";
import type { Units } from "../units";
import { unitLabel, weight, weightValue } from "../units";

export function SummaryScreen({
  view,
  outcome,
  units,
  onDismiss,
}: {
  view: SessionView;
  outcome: OutcomeResult;
  units: Units;
  onDismiss: () => void;
}) {
  const { session, exercise, sets } = view;
  // The engine's own reading of the session, not a second one. `isClean` is
  // false for anything walked out of, whatever its sets say (B5.7).
  const clean = isClean(session, sets);
  const everySide = sets.length === view.totalSets * 2;
  const shortBy = sets.reduce((short, set) => short + Math.max(0, set.targetReps - set.doneReps), 0);

  return (
    <>
      <span className="eyebrow">{exercise.name}</span>

      <h1 className="lift">{headline(everySide, clean)}</h1>
      <p className="change">{recap(view, everySide, clean, shortBy, units)}</p>

      <div className="rule" />

      <p className="eyebrow">NEXT TIME</p>
      <div className="load">
        <span className="kg">{weightValue(outcome.state.currentKg, units)}</span>
        <span className="unit">{unitLabel(units)}</span>
      </div>
      <p className="change">{nextLine(view, outcome, units)}</p>

      {outcome.deload !== null && (
        <p className="notice">
          You have been stuck at {weight(outcome.deload.fromKg, units)} for{" "}
          {outcome.deload.stallCount} sessions, so the weight has come down to{" "}
          {weight(outcome.deload.toKg, units)}.{" "}
          {outcome.deload.basis === "history"
            ? "That is a weight you actually lifted six sessions ago."
            : "The log was too short to find a weight to go back to, so it is about 15% off."}{" "}
          Climb back up — you will come through this number.
        </p>
      )}

      <div className="grow" />

      <button className="done" onClick={onDismiss}>
        Done
      </button>
    </>
  );
}

function headline(everySide: boolean, clean: boolean): string {
  if (!everySide) return "Session ended";
  return clean ? "Clean session" : "Session logged";
}

/* The recap below never counts days or sessions missed. There is no such
   number anywhere in this app, by design (INV-6, §5). */

function recap(
  view: SessionView,
  everySide: boolean,
  clean: boolean,
  shortBy: number,
  units: Units,
): string {
  const { sets, session, totalSets } = view;
  const done = Math.floor(sets.length / 2);

  if (!everySide) {
    return sets.length === 0
      ? `walked out before the first set, at ${weight(session.actualKg, units)}`
      : `${done} of ${totalSets} sets at ${weight(session.actualKg, units)}, then walked out`;
  }
  return clean
    ? `every rep of ${totalSets} sets at ${weight(session.actualKg, units)}`
    : `${totalSets} sets at ${weight(session.actualKg, units)}, ${shortBy} ${shortBy === 1 ? "rep" : "reps"} short`;
}

/**
 * Why the next weight is what it is.
 *
 * The same comparison the Today card makes, against the weight actually lifted
 * rather than the weight prescribed (D1.2). It is written out here rather than
 * imported because the two screens are asking different questions — this one
 * compares against the session the athlete has just finished, which it holds,
 * and Today compares against the last one it can find.
 */
function nextLine(view: SessionView, outcome: OutcomeResult, units: Units): string {
  const from = view.session.actualKg;
  const to = outcome.state.currentKg;

  if (outcome.deload !== null) {
    return `down from ${weight(from, units)} after three short sessions`;
  }
  if (to > from) return `one step up from the ${weight(from, units)} you just lifted`;
  if (to < from) return `down from the ${weight(from, units)} you just lifted`;
  return view.sets.length === 0
    ? "unchanged — the engine learns nothing from a session that did not happen"
    : "the same weight again, until it goes clean";
}
