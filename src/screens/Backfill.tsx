/**
 * Backfill — a session done away from the phone (E3.1).
 *
 * The one screen in the app that asks for something rather than showing it, and
 * it is built from the same parts as everything else: the lift is the stepper
 * the Today card switches lifts with, every number is tap-to-edit (INV-7), and
 * the only native control is the date, because a date is the one value a phone
 * already has a better picker for than anything this app could draw.
 *
 * The draft lives here in `useState` rather than in the app's state machine.
 * The rule the machine follows is that every action is a write followed by a
 * read of what the log now says — and until Save there is nothing to write, so
 * there is nothing for it to hold. `Plan` on the Today card is in the machine
 * because the card underneath it is reloaded on every edit; this screen is not
 * reloaded until it is finished with.
 *
 * Changing the shape — reps per side, or how many sets — rewrites every side
 * back to the target. That loses a correction, which is deliberate: the shape
 * is what you set first and the corrections are what you make afterwards, and
 * the alternative is a rule about which of your previous edits survive that
 * nobody could predict from looking at the screen.
 */

import { useState } from "react";

import { TapChoice, TapNumber } from "../components/TapValue";
import type { Exercise, ExerciseId, TrainingDay } from "../engine";
import type { Backfill } from "../session";

/** What the screen needs before it can ask anything. */
export type BackfillSetup = {
  readonly rotation: readonly Exercise[];
  /** Today, as the latest day that can be chosen. */
  readonly today: TrainingDay;
  /**
   * What each lift is currently at, so the weight starts somewhere true.
   *
   * A lift with no entry has never been trained, and its own start weight is
   * the honest opening number for it — the same opening balance replay uses
   * (C3.0). It is a starting point, not a claim: like every weight in the app
   * it is tap-editable (INV-7).
   */
  readonly currentKg: ReadonlyMap<ExerciseId, number>;
  /** The athlete's step, which is what the weight stepper moves by. */
  readonly stepKg: number;
  /** Set while the write is in flight, so Save cannot be pressed twice. */
  readonly busy: boolean;
};

const DEFAULT_REPS = 5;
const DEFAULT_SETS = 3;

/** Every side at the target: the shape of a session that went to plan. */
function shapeOf(sets: number, reps: number): number[][] {
  return Array.from({ length: sets }, () => [reps, reps]);
}

export function BackfillScreen({
  setup,
  onSave,
  onBack,
}: {
  setup: BackfillSetup;
  onSave: (draft: Backfill) => void;
  onBack: () => void;
}) {
  const first = setup.rotation[0]!;
  const [exerciseId, setExerciseId] = useState<ExerciseId>(first.id);
  const [trainingDay, setTrainingDay] = useState<TrainingDay>(setup.today);
  const [weightKg, setWeightKg] = useState(setup.currentKg.get(first.id) ?? first.startKg);
  const [targetReps, setTargetReps] = useState(DEFAULT_REPS);
  const [sets, setSets] = useState<number[][]>(shapeOf(DEFAULT_SETS, DEFAULT_REPS));

  const names = new Map(setup.rotation.map((e) => [e.id, e.name] as const));
  const exercise = setup.rotation.find((e) => e.id === exerciseId) ?? first;
  const sides: readonly [string, string] =
    exercise.weakSide === "left" ? ["left", "right"] : ["right", "left"];

  // A different lift has a different weight, so the weight follows it. Keeping
  // the old one would silently record the press's weight for the deadlift —
  // the same reasoning `toToday` applies when the lift is changed on the card.
  const chooseLift = (id: ExerciseId) => {
    setExerciseId(id);
    const lift = setup.rotation.find((e) => e.id === id);
    setWeightKg(setup.currentKg.get(id) ?? lift?.startKg ?? setup.stepKg);
  };

  const chooseReps = (reps: number) => {
    setTargetReps(reps);
    setSets(shapeOf(sets.length, reps));
  };

  const chooseSets = (count: number) => setSets(shapeOf(count, targetReps));

  const chooseSide = (set: number, side: number, reps: number) =>
    setSets(sets.map((s, i) => (i === set ? s.map((r, j) => (j === side ? reps : r)) : s)));

  return (
    <>
      <div className="row">
        <span className="eyebrow">Add a session</span>
        <button className="quiet" onClick={onBack}>
          Back
        </button>
      </div>

      <h1 className="lift">
        <TapChoice
          value={exerciseId}
          options={setup.rotation.map((e) => e.id)}
          onChange={chooseLift}
          label="the lift"
          format={(id: ExerciseId) => names.get(id) ?? id}
        />
      </h1>

      <div className="load">
        <TapNumber
          value={weightKg}
          onChange={setWeightKg}
          step={setup.stepKg}
          min={setup.stepKg}
          label="the weight"
          format={(kg) => `${kg} kg`}
        />
      </div>
      <div className="scheme">
        <TapNumber
          value={targetReps}
          onChange={chooseReps}
          step={1}
          min={1}
          label="reps per side"
          format={(reps) => `${reps} reps per side`}
        />{" "}
        ×{" "}
        <TapNumber
          value={sets.length}
          onChange={chooseSets}
          step={1}
          min={1}
          label="sets"
          format={(count) => `${count} sets`}
        />
      </div>

      <div className="rule" />

      <div className="kv">
        <span className="k">WHEN</span>
        <span className="v">
          <input
            className="date mono"
            type="date"
            value={trainingDay}
            max={setup.today}
            onChange={(event) => setTrainingDay(event.target.value)}
            aria-label="the day it was trained"
          />
        </span>
      </div>

      {sets.map((set, i) => (
        <div className="kv" key={i}>
          <span className="k">SET {i + 1}</span>
          <span className="v">
            {set.map((reps, j) => (
              <span key={j}>
                {j > 0 && " · "}
                {sides[j]}{" "}
                <TapNumber
                  value={reps}
                  onChange={(next) => chooseSide(i, j, next)}
                  step={1}
                  min={0}
                  label={`${sides[j]} on set ${i + 1}`}
                  format={(next) => `${next}`}
                />
              </span>
            ))}
          </span>
        </div>
      ))}

      <p className="hint">
        {sides[0]} first, because that is the weak side for this lift. Every
        number here is tappable.
      </p>

      <div className="grow" />

      <button
        className="start"
        disabled={setup.busy || !valid(trainingDay, setup.today)}
        onClick={() => onSave({ exerciseId, trainingDay, weightKg, targetReps, sets })}
      >
        {setup.busy ? "Saving…" : "Save this session"}
      </button>
      <p className="footnote">{summary(trainingDay, setup.today)}</p>
    </>
  );
}

/**
 * A day that has not happened cannot have been trained.
 *
 * The date input carries `max`, which every browser this app runs in honours —
 * but the value can also be typed, and a log with tomorrow in it would put a
 * square on the calendar in a row that is meant to be holes (E1.1).
 */
export function valid(day: TrainingDay, today: TrainingDay): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today;
}

/** What the button is about to do, and why it might not. */
export function summary(day: TrainingDay, today: TrainingDay): string {
  if (!valid(day, today)) return "pick a day that has already happened";
  if (day === today) return "it will count from today";
  return "the weights after it are worked out again";
}
