/**
 * Onboarding, drawn (G1).
 *
 * Three questions and a full stop, in that order, and the exit criterion is a
 * stranger reaching their first session in under two minutes. Everything on
 * these screens is either one tap or nothing at all: the step is a choice from
 * six, the weak sides come pre-answered with "not sure", and the third screen
 * asks for nothing whatsoever.
 *
 * The draft lives here in `useState` rather than in the app's state machine,
 * for the reason `BackfillScreen` gives at the top of its own file: the machine
 * writes and then re-reads, and until the last screen there is nothing to
 * write. What the machine does hold is `saved` — the fact that the write landed
 * — and the wizard reads that instead of its own step for the last screen. That
 * is what stops the install step being reachable before the answers are safe,
 * without a second source of truth about which screen is on.
 *
 * The install step is `InstallScreen` itself and not a copy of it (G1.5, F2).
 * There is one argument in the app for Add to Home Screen and one drawn Share
 * flow, and a second version of either would drift.
 */

import { useState } from "react";

import type { Exercise, ExerciseId, Side } from "../engine";
import type { InstallState } from "../platform";
import type { OnboardingDraft, OnboardingStep } from "../onboarding";
import {
  PROJECTION_SESSIONS,
  STEP_CHOICES,
  initialDraft,
  projectedGainKg,
  setStepKg,
  setWeakSide,
} from "../onboarding";
import { InstallScreen } from "./Install";

/** What the wizard needs before it can ask anything. */
export type OnboardingSetup = {
  /** The five lifts, in rotation order — the names the side questions use. */
  readonly rotation: readonly Exercise[];
  /** Where the step starts, which on a fresh install is the engine's default. */
  readonly stepKg: number;
};

/** The three screens that ask something. `install` is reached by saving. */
const ASKING: readonly OnboardingStep[] = ["step", "sides", "alarm"];

/** Weights are written with as few decimals as they need: 2.5, but 1 not 1.0. */
function kg(value: number): string {
  return `${Number(value.toFixed(2))} kg`;
}

export function OnboardingScreen({
  setup,
  saved,
  busy,
  install,
  onFinish,
  onInstall,
  onDone,
}: {
  setup: OnboardingSetup;
  /** The answers are in the database. Set by the machine, never by this file. */
  saved: boolean;
  /** The write is in flight, so Finish cannot be pressed twice. */
  busy: boolean;
  install: InstallState;
  onFinish: (draft: OnboardingDraft) => void;
  onInstall: () => void;
  onDone: () => void;
}) {
  const [at, setAt] = useState(0);
  const [draft, setDraft] = useState<OnboardingDraft>(() =>
    initialDraft(setup.rotation, setup.stepKg),
  );

  // `saved` wins over the local step, always. Once the answers are written the
  // only screen left is the one with nothing to answer.
  if (saved) {
    return (
      <InstallScreen
        state={install}
        onInstall={onInstall}
        onBack={onDone}
        backLabel="Done"
        onDone={onDone}
        doneLabel="Start training"
      />
    );
  }

  const step = ASKING[at]!;

  return (
    <>
      <div className="row">
        {/* The dots travel with the eyebrow rather than sitting between it and
            Back, which only exists from the second step on — otherwise they
            would shift sideways the moment the athlete answered anything. */}
        <span className="wizard-at">
          <span className="eyebrow">
            Setup {at + 1} of {ASKING.length}
          </span>
          <span className="rotation" aria-hidden="true">
            {ASKING.map((name, i) => (
              <i key={name} className={i === at ? "on" : undefined} />
            ))}
          </span>
        </span>
        {at > 0 && (
          <button className="quiet" onClick={() => setAt(at - 1)}>
            Back
          </button>
        )}
      </div>

      {step === "step" && (
        <StepQuestion
          stepKg={draft.stepKg}
          onChoose={(value) => setDraft(setStepKg(draft, value))}
        />
      )}

      {step === "sides" && (
        <SidesQuestion
          rotation={setup.rotation}
          draft={draft}
          onChoose={(id, side) => setDraft(setWeakSide(draft, id, side))}
        />
      )}

      {step === "alarm" && <AlarmNote />}

      <div className="grow" />

      {step === "alarm" ? (
        <button className="start" disabled={busy} onClick={() => onFinish(draft)}>
          {busy ? "Saving…" : "Finish setup"}
        </button>
      ) : (
        <button className="start" onClick={() => setAt(at + 1)}>
          Next
        </button>
      )}
    </>
  );
}

/**
 * G1.1 — the one number.
 *
 * Two things are said on this screen and the second one is the one nobody
 * expects: the step is not only a fact about the dumbbells, it is the rate of
 * progress. One clean session adds one step and nothing else moves the weight
 * (§6.1), so the choice made here is also the choice of how fast the athlete
 * gets stronger. Stating it as an arithmetic that updates under the tap is
 * worth more than a paragraph, and it costs one line.
 *
 * The advice to round down is the method's, not a hedge. A step that is too
 * small costs a session that could have been harder; one that is too big stalls
 * the lift and eventually deloads it. The errors are not the same size.
 */
function StepQuestion({
  stepKg,
  onChoose,
}: {
  stepKg: number;
  onChoose: (stepKg: number) => void;
}) {
  return (
    <>
      <h1 className="lift">The smallest jump you can make</h1>

      <p className="prompt">
        What is the smallest amount you can actually add to a dumbbell? That is
        the only thing Lift Log needs to know about your equipment.
      </p>

      <div className="choices" role="radiogroup" aria-label="the step">
        {STEP_CHOICES.map((value) => (
          <button
            key={value}
            className={value === stepKg ? "choice on" : "choice"}
            role="radio"
            aria-checked={value === stepKg}
            onClick={() => onChoose(value)}
          >
            {kg(value)}
          </button>
        ))}
      </div>

      <p className="footnote">
        Adjustable dumbbells usually move in 2.5 kg and a fixed rack is often 2
        or 2.5. Micro-plates are what make 0.5 and 1.25 possible.
      </p>

      <div className="rule" />

      <p className="prompt">
        This is also how fast you get stronger. A session where you hit every rep
        adds one step, and nothing else moves the weight — so{" "}
        {PROJECTION_SESSIONS} clean sessions at {kg(stepKg)} is{" "}
        <strong>{kg(projectedGainKg(stepKg))} heavier</strong>.
      </p>

      <p className="hint">
        Between two, take the smaller. Too small costs a week; too big stalls the
        lift.
      </p>
    </>
  );
}

/**
 * G1.3 — the weak side, five times, with a real "I don't know".
 *
 * The weak side is the one input the engine cannot derive: it decides which
 * side goes first, while fresh, and that side sets the weight for both (§6.4).
 * It is also something most people have never thought about, so the default is
 * the honest answer rather than a coin toss dressed as a preference. "Not sure"
 * is written as left — which is what the app has always guessed — and the
 * screen says so, because a default the athlete cannot see is a decision made
 * on their behalf in the dark.
 */
function SidesQuestion({
  rotation,
  draft,
  onChoose,
}: {
  rotation: readonly Exercise[];
  draft: OnboardingDraft;
  onChoose: (exerciseId: ExerciseId, side: Side | null) => void;
}) {
  const options: readonly (readonly [Side | null, string])[] = [
    ["left", "Left"],
    ["right", "Right"],
    [null, "Not sure"],
  ];

  return (
    <>
      <h1 className="lift">Which side is weaker?</h1>

      <p className="prompt">
        The weak side trains first, while you are fresh, and whatever it manages
        is what the strong side does too. That is the whole point of training one
        limb at a time.
      </p>

      <ul className="sides">
        {rotation.map((exercise) => {
          const chosen = draft.weakSides.get(exercise.id) ?? null;
          return (
            <li key={exercise.id} className="side-row">
              <span className="side-lift">{exercise.name}</span>
              <span className="seg" role="radiogroup" aria-label={exercise.name}>
                {options.map(([side, label]) => (
                  <button
                    key={label}
                    // Chosen and *defaulted* are drawn differently on purpose.
                    // Five accent-filled "Not sure"s would read as five
                    // decisions the athlete had made, on a screen where they
                    // have made none yet.
                    className={side === chosen ? (side === null ? "on soft" : "on") : undefined}
                    role="radio"
                    aria-checked={side === chosen}
                    onClick={() => onChoose(exercise.id, side)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="hint">
        Not sure is fine — it starts on the left, and one tap on the card flips
        it once you have felt the difference.
      </p>
    </>
  );
}

/**
 * G1.4 — the reminder the app will not send.
 *
 * One line of advice and one paragraph saying why it is advice rather than a
 * feature. §10.1 is unambiguous: a website cannot schedule a local notification
 * on iOS, and building the Android half would ship a reminder that works for
 * some athletes and silently never fires for the rest. Saying so is better than
 * a settings row that quietly does nothing on half the phones in the world.
 */
function AlarmNote() {
  return (
    <>
      <h1 className="lift">One thing to do outside the app</h1>

      <p className="prompt">
        Set a recurring alarm on your phone for when you want to train.
      </p>

      <div className="rule" />

      <p className="aside">
        Lift Log does not send reminders, and it is not going to. A web app
        cannot schedule a notification on an iPhone at all, so the choice was
        between one that fires for some people and never for the rest, or none
        and a sentence about it. Your phone's clock already does this properly,
        and it works whether or not this app is installed.
      </p>

      <p className="hint">
        That is everything it needs to ask. What comes after this is where the
        log lives.
      </p>
    </>
  );
}
