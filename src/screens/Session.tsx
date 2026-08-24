/**
 * The session runner (D2, D3).
 *
 * One side on screen at a time (D2.1), one enormous button (D2.2), three bars
 * (D2.3). The constraint that shapes all of it is §14.9: sweaty, breathing
 * hard, phone on the floor at arm's length, possibly one-handed, possibly in a
 * dim room. So there is exactly one thing to press, it is the size of a
 * matchbox, and the second option is deliberately smaller and further away —
 * missing reps should never be one careless thumb from being logged.
 *
 * The screen holds three pieces of state and all three are about *this glance
 * at the screen*, never about what happened: whether the miss picker is open,
 * whether the rest has been dismissed, and how much extra rest was asked for.
 * Each is tied to the moment it belongs to — an ordinal, or a rest's start —
 * so it expires by itself when the session moves on, with no effect to reset
 * it and no way for it to leak into the next set.
 */

import { useState } from "react";

import type { Actions } from "../useApp";
import { asClock, useRest } from "../useRest";
import { useWakeLock } from "../useWakeLock";
import type { SessionView } from "../session";

export function SessionScreen({
  view,
  restTargetS,
  actions,
}: {
  view: SessionView;
  restTargetS: number;
  actions: Actions;
}) {
  const [missAt, setMissAt] = useState<number | null>(null);
  const [dismissedRest, setDismissedRest] = useState<string | null>(null);
  const [extra, setExtra] = useState<{ at: string; seconds: number } | null>(null);

  // Keep the screen on for as long as there is a session to run (D3.2).
  useWakeLock(true);

  const { step, bars, restStartedAt, exercise } = view;
  const extraS = extra !== null && extra.at === restStartedAt ? extra.seconds : 0;
  const rest = useRest(restStartedAt, restTargetS + extraS);
  const resting = restStartedAt !== null && dismissedRest !== restStartedAt;
  const missing = step !== null && missAt === step.ordinal;

  return (
    <>
      <div className="row">
        <span className="eyebrow">{exercise.name}</span>
        <button className="quiet" onClick={actions.abandon}>
          End session
        </button>
      </div>

      <div className="bars" aria-label={`${bars.filter((b) => b === 1).length} of ${bars.length} sets`}>
        {bars.map((filled, i) => (
          <span key={i} className="bar">
            <span className="fill" style={{ width: `${filled * 100}%` }} />
          </span>
        ))}
      </div>

      {step === null ? (
        <Finished onFinish={actions.finish} />
      ) : resting && rest !== null ? (
        <Resting
          rest={rest}
          nextSet={step.setNumber}
          onLonger={() =>
            setExtra({ at: restStartedAt, seconds: extraS + REST_LONGER_S })
          }
          onReady={() => setDismissedRest(restStartedAt)}
        />
      ) : (
        <>
          <p className="eyebrow" style={{ marginTop: 30 }}>
            Set {step.setNumber} of {view.totalSets}
          </p>
          <h1 className="side">{step.side.toUpperCase()}</h1>
          <p className="prescribed">
            {step.targetReps} reps @ {step.weightKg} kg
            {step.isWeakSide && <span className="tag">weak side</span>}
          </p>

          <div className="grow" />

          {missing ? (
            <MissPicker
              targetReps={step.targetReps}
              onPick={(reps) => {
                setMissAt(null);
                actions.logSide(reps);
              }}
              onCancel={() => setMissAt(null)}
            />
          ) : (
            <>
              <button className="done" onClick={() => actions.logSide(step.targetReps)}>
                Done
              </button>
              <button className="missed" onClick={() => setMissAt(step.ordinal)}>
                I missed some reps
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}

/** One tap of "rest longer" (D3.3). A minute is the smallest useful amount. */
const REST_LONGER_S = 60;

/**
 * The rest between sets (D3).
 *
 * The clock reads up as well as down. Running over is not a failure — it is
 * what happens when you are talking to somebody, and an app that scolds you for
 * it has misunderstood the exercise. "Rest longer" is a button of its own for
 * the same reason (D3.3).
 *
 * Nothing here blocks. The athlete can start the next set at any point; the
 * timer is information, not a gate.
 */
function Resting({
  rest,
  nextSet,
  onLonger,
  onReady,
}: {
  rest: { remainingS: number; elapsedS: number; targetS: number; over: boolean };
  nextSet: number;
  onLonger: () => void;
  onReady: () => void;
}) {
  return (
    <>
      <p className="eyebrow" style={{ marginTop: 30 }}>
        Rest before set {nextSet}
      </p>
      <h1 className={rest.over ? "clock over" : "clock"}>
        {rest.over ? asClock(rest.elapsedS - rest.targetS) : asClock(rest.remainingS)}
      </h1>
      <p className="prescribed">
        {rest.over ? "rested — go when you are ready" : `of ${asClock(rest.targetS)}`}
      </p>

      <div className="grow" />

      <button className="done" onClick={onReady}>
        Start set {nextSet}
      </button>
      <button className="missed" onClick={onLonger}>
        Rest longer
      </button>
    </>
  );
}

/**
 * The miss path (D2.2.1).
 *
 * A picker of whole numbers, not a slider and not a "failed" flag. Four reps of
 * a target five is a near miss and one rep is a collapse, and the engine can
 * only tell them apart if the difference was written down (INV-4).
 *
 * It stops one below the target, because a set that made the target is Done —
 * the button on the other screen. There is no way to log a miss of five.
 */
function MissPicker({
  targetReps,
  onPick,
  onCancel,
}: {
  targetReps: number;
  onPick: (reps: number) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <p className="prompt">How many did you get?</p>
      <div className="picker">
        {Array.from({ length: targetReps }, (_, reps) => (
          <button key={reps} className="pick" onClick={() => onPick(reps)}>
            {reps}
          </button>
        ))}
      </div>
      <button className="missed" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}

/** Every side logged. The app never closes a session by itself. */
function Finished({ onFinish }: { onFinish: () => void }) {
  return (
    <>
      <p className="eyebrow" style={{ marginTop: 30 }}>
        All sets logged
      </p>
      <h1 className="side">DONE</h1>
      <div className="grow" />
      <button className="done" onClick={onFinish}>
        Finish session
      </button>
    </>
  );
}
