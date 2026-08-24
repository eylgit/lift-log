/**
 * Today — the home screen (D1).
 *
 * Every number here is derived: the lift from the rotation pointer, the weight
 * from the engine, the history from the log. The wording lives in this file and
 * nowhere else, so a sentence can be rewritten without touching a rule and a
 * rule can change without touching a sentence.
 */

import { TapChoice, TapNumber, TapToggle } from "../components/TapValue";
import { trainingDay } from "../clock";
import type { ExerciseId, Side } from "../engine";
import type { InstallState } from "../platform";
import type { Actions, Plan } from "../useApp";
import type { LastResult, Today, WeightChange } from "../today";

export function TodayScreen({
  today,
  plan,
  install,
  actions,
}: {
  today: Today;
  plan: Plan;
  /** How the app is running, for the install row (F2). */
  install: InstallState;
  actions: Actions;
}) {
  const { prescription: rx, dayIndex, rotationLength, last, change } = today;
  const { rotation, stepKg, restTargetS, loggedSessions, lastExportedAt } = today;
  const chosenWeight = plan.weightKg !== rx.weightKg;
  const names = new Map(rotation.map((e) => [e.id, e.name] as const));

  return (
    <>
      <div className="row">
        <span className="eyebrow">Day {dayIndex + 1} of {rotationLength}</span>
        <span className="rotation">
          {Array.from({ length: rotationLength }, (_, i) => (
            <i key={i} className={i === dayIndex ? "on" : undefined} />
          ))}
        </span>
      </div>

      <h1 className="lift">
        <TapChoice
          value={rx.exercise.id}
          options={rotation.map((e) => e.id)}
          onChange={actions.chooseLift}
          label="today's lift"
          format={(id: ExerciseId) => names.get(id) ?? id}
        />
      </h1>
      <div className="eyebrow" style={{ marginTop: 9 }}>
        {rx.exercise.pattern} ·{" "}
        <TapToggle
          value={rx.weakSide}
          other={rx.weakSide === "left" ? "right" : "left"}
          onChange={actions.flipWeakSide}
          label="the weak side"
          format={(side: Side) => `${side} side first`}
        />
      </div>

      <div className="load">
        <TapNumber
          value={plan.weightKg}
          onChange={actions.chooseWeight}
          step={stepKg}
          min={stepKg}
          label="today's weight"
          format={(kg) => `${kg} kg`}
        />
      </div>
      <p className="change">
        {chosenWeight
          ? `you chose this — the engine asked for ${rx.weightKg} kg`
          : changeLine(change, last)}
      </p>
      <div className="scheme">
        <TapNumber
          value={plan.repsPerSide}
          onChange={actions.chooseReps}
          step={1}
          min={1}
          label="reps per side"
          format={(reps) => `${reps} reps per side`}
        />{" "}
        ×{" "}
        <TapNumber
          value={plan.totalSets}
          onChange={actions.chooseSets}
          step={1}
          min={1}
          label="sets"
          format={(sets) => `${sets} sets`}
        />
      </div>

      <div className="rule" />

      <div className="kv">
        <span className="k">REST</span>
        <span className="v">
          <TapNumber
            value={Math.round(restTargetS / 60)}
            onChange={(minutes) => actions.chooseRest(minutes * 60)}
            step={1}
            min={1}
            label="rest between sets"
            format={(minutes) => `${minutes} min between sets`}
          />
        </span>
      </div>
      <div className="kv">
        <span className="k">LAST TIME</span>
        <span className="v">{lastLine(last)}</span>
      </div>
      <div className="kv">
        <span className="k">TRAINING DAY</span>
        <span className="v">{trainingDay()}</span>
      </div>
      <div className="kv">
        <span className="k">HISTORY</span>
        <span className="v">
          <button className="tap" onClick={actions.openHistory}>
            {historyLine(loggedSessions)}
          </button>
        </span>
      </div>
      <div className="kv">
        <span className="k">PROGRESS</span>
        <span className="v">
          <button className="tap" onClick={() => actions.openProgress()}>
            {progressLine(rx.weightKg, rx.exercise.startKg)}
          </button>
        </span>
      </div>
      <div className="kv">
        <span className="k">LAST BACKUP</span>
        <span className="v">
          <button className="tap" onClick={actions.openBackup}>
            {lastExportedAt === null ? "never — back up" : lastExportedAt.slice(0, 10)}
          </button>
        </span>
      </div>
      {/* Only where it is worth a row. An installed app has nothing to do here,
          and a desktop browser that cannot install has nothing to offer (F2). */}
      {install !== "installed" && install !== "browser" && (
        <div className="kv">
          <span className="k">INSTALL</span>
          <span className="v">
            <button className="tap" onClick={actions.openInstall}>
              {install === "ios-browser" ? "not on your home screen" : "add to this device"}
            </button>
          </span>
        </div>
      )}

      <p className="hint">A dotted underline means you can tap it.</p>

      <div className="grow" />

      <button className="start" onClick={actions.start}>
        <svg width="17" height="17" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <polygon points="4,2.5 15,9 4,15.5" />
        </svg>
        Start
      </button>
    </>
  );
}

/**
 * The door to the calendar (E1.1).
 *
 * A count rather than the word "history", because the count is the interesting
 * part and it only ever goes up. "nothing yet" for an empty log — not "0
 * sessions", which reads like a score.
 */
export function historyLine(sessions: number): string {
  if (sessions === 0) return "nothing yet — see the calendar";
  return `${sessions} ${sessions === 1 ? "session" : "sessions"}`;
}

/**
 * The door to the chart (E2).
 *
 * The gain rather than the word "chart", for the reason the history row shows a
 * count: the number is the interesting part, and it is the number the screen
 * behind it is about. It is measured against the start weight rather than
 * against last session, because that is the figure that only exists on the
 * chart — the change since last time is already printed above, in `changeLine`.
 *
 * A weight at or below where it started is not called a loss. It is either a
 * lift that has not been trained yet or one in the middle of climbing back, and
 * naming it either would be guessing at which (§5, and `drops` in
 * `src/progress.ts`).
 */
export function progressLine(weightKg: number, startKg: number): string {
  const gain = Math.round((weightKg - startKg) * 1000) / 1000;
  return gain > 0 ? `+${gain} kg since the start` : "see the chart";
}

/**
 * Why the weight is what it is.
 *
 * The direction comes from the subtraction; the reason comes from what happened
 * last time. Neither restates the progression rule, which is what keeps this
 * from being able to contradict the number above it.
 *
 * A drop is not explained by counting stalls, tempting though it is. The count
 * resets the moment the deload lands, so the card would be asserting a number
 * it cannot read — and a weight can also come down because the athlete typed it.
 * "Back off and climb again" is true either way.
 */
export function changeLine(change: WeightChange, last: LastResult | null): string {
  if (change.kind === "first") {
    return "your start weight — lighter than feels right is the right amount";
  }

  const direction =
    change.kind === "same"
      ? "same again"
      : change.kind === "down"
        ? `down from ${change.fromKg} kg`
        : change.oneStep
          ? `one step up from ${change.fromKg} kg`
          : `up ${change.byKg} kg from ${change.fromKg} kg`;

  return `${direction}${because(change, last)}`;
}

/**
 * The half-sentence after the dash, or nothing at all.
 *
 * A clean session needs no explanation — the weight went up, which is what
 * clean sessions do. The other two do: "same again" with no reason reads like
 * the app forgot to progress, and a drop with no reason reads like a bug.
 *
 * A walked-out session is called out whichever way the weight moved, because it
 * is the one case where today's number has nothing to do with what was on the
 * dumbbell last time. The engine learns nothing from a session nobody finished
 * (B5.7), so the weight is wherever the last *finished* session left it.
 */
function because(change: WeightChange, last: LastResult | null): string {
  if (last === null || last.outcome === "clean") return "";
  if (last.outcome === "walked out") return " — last session was walked out";
  return change.kind === "down" ? " — back off and climb again" : " — last time was short";
}

/**
 * Last session's result, as a fact and not a nag.
 *
 * The date is shown and the *gap* is not. "Three days ago" is one short step
 * from "you have missed two sessions", and the rotation is a position pointer
 * rather than a calendar — skipping a week costs nothing and the card must not
 * imply otherwise (INV-6).
 */
export function lastLine(last: LastResult | null): string {
  if (last === null) return "never trained";
  const what =
    last.outcome === "short"
      ? `${last.repsShort} ${last.repsShort === 1 ? "rep" : "reps"} short`
      : last.outcome;
  return `${last.trainingDay} · ${last.weightKg} kg · ${what}`;
}
