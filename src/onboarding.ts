/**
 * Onboarding (G1) — the four questions, and what they write.
 *
 * The whole of setup is one number and five binary answers, and that is not a
 * shortcut. §14.6 is blunt about it: *the equipment screen is where onboarding
 * goes to die*, it is the most complex UI in the app, and it is the first thing
 * a stranger meets. So there is no plate inventory, no lightest-weight field
 * and no per-lift start weight — one number, the smallest jump you can make,
 * which is everything the engine needs (§6.5, B2.2).
 *
 * The five start weights are not asked for at all. They all begin at one step,
 * because the method says start absurdly light and a start weight that is too
 * low costs one clean session while one that is too high costs an injury
 * (G1.2). Every one of them is tap-editable on the card afterwards (INV-7), so
 * asking here would be charging a stranger five decisions for something the app
 * hands back the first time they look at it.
 *
 * What *is* asked is the weak side, five times, because it is the one thing the
 * engine reads that no amount of logging can work out for itself (§6.4) — and
 * even that has an "I don't know", because most people genuinely do not.
 *
 * The rule the module follows: nothing here touches storage except
 * `commitOnboarding`, which does it once, at the end, in one go. Everything
 * else is a function over values, so the decisions can be checked without a
 * browser.
 */

import type { Exercise, ExerciseId, Session, Side } from "./engine";
import { DEFAULT_STEP_KG } from "./engine";
import type { Repo, Settings } from "./db";
import { rebuildState } from "./db";

/* ----------------------------------------------------------------- steps */

/**
 * The screens, in order.
 *
 * `install` is last because F2 says Add to Home Screen is a data-safety step
 * and not a nicety, and the moment somebody has just finished setting the app
 * up is the only moment they will ever care about it (G1.5). It is also the one
 * step with nothing to answer, which is why the write happens before it and not
 * after: an athlete who closes the app on the install screen has still been
 * asked their questions and should never be asked them again.
 */
export const ONBOARDING_STEPS = ["step", "sides", "alarm", "install"] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/* ------------------------------------------------------------ the choices */

/**
 * The steps offered, in kilograms.
 *
 * A list and not a free stepper, for one reason: a stranger on the first screen
 * of an app they have never used does not know what number belongs here, and a
 * blank stepper starting at 1 asks them to guess. Six choices, each of which is
 * a real thing a real rack does, is one tap instead.
 *
 * 1.25 is on the list and would not be on any grid of halves — it is what a
 * pair of micro-plates gives you, and leaving it off would have quietly told
 * every athlete who owns them to pick something else. It is settable to
 * anything at all in settings later (G3.1); this is the fast path, not the
 * limit.
 *
 * Note what the number does *not* claim. B2.2.2 threw out the idea that the
 * loadable weights are the multiples of the step: a fixed rack runs 5, 10,
 * 12.5, 15, 17.5, 20, 22.5 and no single number describes those gaps. The step
 * is what the athlete *intends* to add, the engine names a target from it, and
 * the athlete reconciles the target with the rack by tapping the weight.
 */
export const STEP_CHOICES: readonly number[] = [0.5, 1, 1.25, 2, 2.5, 5];

/** How many clean sessions the "and then you are here" line projects forward. */
export const PROJECTION_SESSIONS = 10;

/**
 * What ten clean sessions comes to, at this step.
 *
 * The point of the line this feeds is that the step is not only a fact about
 * the athlete's dumbbells — it is the rate of progress, one step per clean
 * session and nothing else (§6.1, B4.1). That is not obvious from a number in
 * kilograms, and it is the single most consequential thing the screen asks.
 */
export function projectedGainKg(stepKg: number, sessions = PROJECTION_SESSIONS): number {
  return Math.round(stepKg * sessions * 100) / 100;
}

/* ------------------------------------------------------------- the draft */

/**
 * The athlete's answers, as the wizard collects them.
 *
 * `weakSides` holds `null` for "I don't know", which is a different thing from
 * "left" even though both end up written as left. The distinction lives only as
 * long as the draft: keeping it means the screen can show an unanswered
 * question as unanswered rather than as a left the athlete never chose, and
 * `resolveRotation` is the one place the two collapse.
 */
export type OnboardingDraft = {
  readonly stepKg: number;
  readonly weakSides: ReadonlyMap<ExerciseId, Side | null>;
};

/** An empty draft: the default step, and nothing decided about any side. */
export function initialDraft(
  rotation: readonly Exercise[],
  stepKg: number = DEFAULT_STEP_KG,
): OnboardingDraft {
  return {
    stepKg,
    weakSides: new Map(rotation.map((exercise) => [exercise.id, null])),
  };
}

/** Answer one lift's weak side, or unanswer it. */
export function setWeakSide(
  draft: OnboardingDraft,
  exerciseId: ExerciseId,
  side: Side | null,
): OnboardingDraft {
  const weakSides = new Map(draft.weakSides);
  weakSides.set(exerciseId, side);
  return { ...draft, weakSides };
}

/** Choose the step. */
export function setStepKg(draft: OnboardingDraft, stepKg: number): OnboardingDraft {
  return { ...draft, stepKg };
}

/**
 * The rotation as the draft would write it (G1.2, G1.3).
 *
 * Two things happen here and both are the whole of their sub-step. Every
 * `startKg` becomes one step — not a weight the athlete chose, because they
 * were not asked. And every unanswered side becomes left, which is the
 * non-dominant side for most people and is what `DEFAULT_ROTATION` already
 * guesses.
 *
 * Order is preserved, because `saveRotation` reads array position as rotation
 * position (C2.1) and nothing on these screens is about the order.
 */
export function resolveRotation(
  rotation: readonly Exercise[],
  draft: OnboardingDraft,
): readonly Exercise[] {
  return rotation.map((exercise) => ({
    ...exercise,
    startKg: draft.stepKg,
    weakSide: draft.weakSides.get(exercise.id) ?? "left",
  }));
}

/* ---------------------------------------------------------- when to ask */

/**
 * Whether to run onboarding at all (G1).
 *
 * Two clauses, and the second is the one that matters. `onboardedAt` is the
 * record that the questions were asked, but it is a field that did not exist
 * before G1 — so a backup taken in Part F restores with it absent, which reads
 * as null, which on its own would march somebody through setup on top of the
 * log they had just restored. Their answers are already in that file; the
 * rotation and the step came back with it.
 *
 * So the log gets a veto. Any session at all — even one abandoned, even one
 * backfilled — is proof that this install has been used, and an app that has
 * been used does not need introducing. The only state that runs onboarding is
 * the one state that cannot be a decision anybody made: never onboarded, and
 * nothing logged.
 *
 * Tombstoned sessions count, deliberately. Deleting every session you ever
 * logged is not the same as never having trained, and it should not hand you
 * back the welcome screen (INV-3).
 */
export function needsOnboarding(
  settings: Pick<Settings, "onboardedAt">,
  sessions: readonly Session[],
): boolean {
  return settings.onboardedAt === null && sessions.length === 0;
}

/* -------------------------------------------------------------- the write */

/**
 * Write the answers, once, at the end (G1).
 *
 * Four writes and they are ordered, not concurrent, because the last one
 * depends on the first two. `rebuildState` replays the log against the
 * exercises and the equipment to work out what to prescribe (C3), and the log
 * here is empty — so every lift's opening balance is its `startKg`, which is
 * the number the first two writes just changed. Rebuilding before them would
 * cache the defaults and the first card would read 1 kg whatever the athlete
 * chose.
 *
 * `onboardedAt` goes last of the three writes for a plainer reason: it is the
 * claim that setup happened, and it should not be true before setup has.
 *
 * There is no transaction around this and `Repo` deliberately offers none
 * (C2.3). The window is a few milliseconds of local writes on a database with
 * nothing in it, and the recovery from losing it is that `needsOnboarding` is
 * still true and the athlete is asked again — which is the right answer.
 */
export async function commitOnboarding(
  repo: Repo,
  rotation: readonly Exercise[],
  draft: OnboardingDraft,
  now: string,
): Promise<void> {
  await repo.saveEquipment({ stepKg: draft.stepKg });
  await repo.saveRotation(resolveRotation(rotation, draft));
  await repo.saveSettings({ onboardedAt: now });
  await rebuildState(repo);
}
