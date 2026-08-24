/**
 * The session, in progress (D2).
 *
 * The one idea in this file: **there is no cursor**. Where a session has got to
 * is not stored anywhere — it is read off the sets already logged, because the
 * number of sides written down *is* how far through you are. That is INV-2
 * applied to a screen rather than to a weight, and it is what makes D2.5 fall
 * out for free: the app persists after every side because writing the side is
 * the only thing it does, so killing the app and reopening lands on exactly the
 * side that comes next. There is no "resume" code path. There is only reading.
 *
 * The rest timer works the same way (D3.1). Rest starts when the second side of
 * a set is logged, and that instant is already in the log as that set's
 * `loggedAt` — so the remaining time is a subtraction against the wall clock,
 * not a counter that a locked phone can suspend.
 *
 * Everything below either derives a shape from facts or writes one fact. No
 * function here decides anything about weight: that is the engine's, and
 * `closeSession` hands the finished session to it rather than doing the
 * arithmetic itself.
 */

import type {
  EngineState,
  Exercise,
  Instant,
  OutcomeResult,
  Prescription,
  Session,
  SessionStatus,
  SetLog,
  Side,
} from "./engine";
import { SESSION_SCHEME, applyOutcome, initialState } from "./engine";
import { trainingDay } from "./clock";
import type { Repo } from "./db";

/**
 * A new row id. It only has to be unique and survive JSON unchanged (C4).
 *
 * `crypto.randomUUID` is the right answer and is not always there. It needs a
 * secure context, so a page opened over plain http on a phone on the local
 * network — which is exactly how this app gets tried out before it is
 * deployed — has no `crypto` at all, and neither does every JavaScript runtime
 * the tests might run under.
 *
 * The fallback does not have to be cryptographic; nothing here is a secret and
 * the log is one person's. It has to not collide. The counter guarantees that
 * within a process, the clock separates processes, and the random tail covers
 * two devices writing in the same millisecond before an import merges them.
 * A collision would be caught rather than swallowed in any case — the
 * repository writes with `add`, not `put` (C2.2).
 */
let sequence = 0;

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === "function") return uuid.call(globalThis.crypto);

  sequence += 1;
  const random = Math.floor(Math.random() * 0x100000000).toString(16);
  return `${Date.now().toString(36)}-${sequence.toString(36)}-${random}`;
}

/* ------------------------------------------------------------- the shape */

/**
 * One side of one set: what the screen shows, and what Done writes down.
 *
 * `setNumber` counts from one because it is read aloud on the screen — "Set 2
 * of 3". `ordinal` counts from zero because it is a row's position in the log.
 * Keeping both, named differently, is cheaper than remembering which one a
 * given line means.
 */
export type Step = {
  readonly ordinal: number;
  /** 1-based, for the screen. */
  readonly setNumber: number;
  /** 0 is the weak side, which always goes first (D2.4). */
  readonly sideIndex: 0 | 1;
  readonly side: Side;
  readonly isWeakSide: boolean;
  readonly targetReps: number;
  readonly weightKg: number;
  readonly isLastSide: boolean;
};

/** A session and everything derivable from it. */
export type SessionView = {
  readonly session: Session;
  readonly exercise: Exercise;
  /** Logged so far, in ordinal order. */
  readonly sets: readonly SetLog[];
  readonly totalSets: number;
  /** The side to do next, or null when every side has been logged. */
  readonly step: Step | null;
  /** One entry per set: 0, 0.5 after the first side, 1 when both are in (D2.3). */
  readonly bars: readonly number[];
  /**
   * When the current rest began, or null if this is not a rest.
   *
   * It is the `loggedAt` of the set that ended, which is a fact already in the
   * log rather than a second timestamp written for the timer's benefit. Rest
   * falls **between sets only** and never between the two sides of one set
   * (D2.4), so this is null halfway through a set and null again once the last
   * side is done.
   */
  readonly restStartedAt: Instant | null;
};

/**
 * Weak side first, then the other (D2.4).
 *
 * The weak side is trained while fresh and it sets the standard for both
 * (`lift-log-design.md` §6.4), so it is not a preference about ordering — it is
 * the method. Even ordinals are the weak side, all the way down.
 */
export function sideAt(ordinal: number, weakSide: Side): Side {
  const other: Side = weakSide === "left" ? "right" : "left";
  return ordinal % 2 === 0 ? weakSide : other;
}

/**
 * Assemble the view from a session, its lift and the sets logged so far.
 *
 * The cursor is the last logged ordinal plus one, rather than the number of
 * rows. They are the same for every session this app writes; they differ if a
 * row ever went missing, and counting rows would then hand out an ordinal that
 * is already taken. Reading the highest one is the version that degrades into
 * a visible gap instead of a duplicate key.
 */
export function buildView(
  session: Session,
  exercise: Exercise,
  sets: readonly SetLog[],
  totalSets: number = SESSION_SCHEME.sets,
): SessionView {
  const ordered = [...sets].sort((a, b) => a.ordinal - b.ordinal);
  const last = ordered[ordered.length - 1];
  const cursor = last === undefined ? 0 : last.ordinal + 1;
  const totalSides = totalSets * 2;

  const step: Step | null =
    cursor >= totalSides
      ? null
      : {
          ordinal: cursor,
          setNumber: Math.floor(cursor / 2) + 1,
          sideIndex: cursor % 2 === 0 ? 0 : 1,
          side: sideAt(cursor, exercise.weakSide),
          isWeakSide: cursor % 2 === 0,
          targetReps: SESSION_SCHEME.repsPerSide,
          weightKg: session.actualKg,
          isLastSide: cursor === totalSides - 1,
        };

  const logged = new Set(ordered.map((set) => set.ordinal));
  const bars = Array.from({ length: totalSets }, (_, set) => {
    const sides = (logged.has(set * 2) ? 1 : 0) + (logged.has(set * 2 + 1) ? 1 : 0);
    return sides / 2;
  });

  // Resting only after a set is finished, and not after the last one — there is
  // nothing left to rest for.
  const restStartedAt =
    step !== null && cursor > 0 && cursor % 2 === 0 ? (last?.loggedAt ?? null) : null;

  return { session, exercise, sets: ordered, totalSets, step, bars, restStartedAt };
}

/** Every side logged. The screen offers to finish; it does not finish by itself. */
export function isFinished(view: SessionView): boolean {
  return view.step === null;
}

/* ------------------------------------------------------------ the writes */

/**
 * Open a session for today's prescription (D2).
 *
 * `actualKg` starts equal to `prescribedKg` and moves only if the athlete says
 * so (INV-7, D5.5). Both are kept: the pair is what makes a stall explicable a
 * year later, when the question is whether the engine asked for a weight that
 * was never on the dumbbell.
 */
export async function startSession(
  repo: Repo,
  prescription: Prescription,
  now: Date = new Date(),
): Promise<SessionView> {
  const session: Session = {
    id: newId(),
    exerciseId: prescription.exercise.id,
    startedAt: now.toISOString(),
    finishedAt: null,
    trainingDay: trainingDay(now),
    prescribedKg: prescription.weightKg,
    actualKg: prescription.weightKg,
    status: "planned",
    note: null,
    deletedAt: null,
  };
  await repo.appendSession(session);
  return buildView(session, prescription.exercise, []);
}

/**
 * Write down one side (D2.5).
 *
 * `doneReps` is an integer and not a flag (INV-4): four reps of a target five
 * is a near miss and one rep is a collapse, and the engine can only tell them
 * apart if the difference was written down. Reps above the target are allowed
 * through — `isClean` compares with `>=`, an extra rep is not a failure, and
 * refusing to record one would be the app arguing with what happened.
 */
export async function logSide(
  repo: Repo,
  view: SessionView,
  doneReps: number,
  now: Date = new Date(),
): Promise<SessionView> {
  const { step } = view;
  if (step === null) {
    throw new RangeError(`session ${view.session.id} has every side logged already`);
  }
  if (!Number.isInteger(doneReps) || doneReps < 0) {
    throw new RangeError(`doneReps must be a whole number of reps, got ${doneReps}`);
  }

  const set: SetLog = {
    id: newId(),
    sessionId: view.session.id,
    ordinal: step.ordinal,
    side: step.side,
    targetReps: step.targetReps,
    doneReps,
    loggedAt: now.toISOString(),
  };
  await repo.appendSets([set]);
  return buildView(view.session, view.exercise, [...view.sets, set], view.totalSets);
}

/**
 * Correct the weight on the dumbbell (INV-7, D5.5).
 *
 * Not append-only, and deliberately so: `actualKg` is a field of a record being
 * completed rather than a fact being rewritten (see the note on append-only in
 * `db/repo.ts`). The engine progresses from this number, so an override is
 * absorbed rather than fought — finish clean at a weight you chose and the next
 * session is a step above that.
 */
export async function setWeight(
  repo: Repo,
  view: SessionView,
  actualKg: number,
): Promise<SessionView> {
  if (!Number.isFinite(actualKg) || actualKg <= 0) {
    throw new RangeError(`a weight must be a positive number of kilograms, got ${actualKg}`);
  }
  await repo.setActualKg(view.session.id, actualKg);
  const session: Session = { ...view.session, actualKg };
  return buildView(session, view.exercise, view.sets, view.totalSets);
}

/**
 * Close the session and fold it into the engine (D4).
 *
 * This is the one place in the app that advances `engineState` as it happens.
 * Everywhere else the cache is either read or rebuilt wholesale by replay
 * (C3) — and the test that those two agree is what keeps this function honest
 * (`tests/rebuild.test.ts`).
 *
 * The engine is handed the session and its sets and decides; nothing here
 * inspects a rep count. `applyOutcome` refuses a session that is still open,
 * which is why the status is written first and the row read back rather than
 * assumed.
 *
 * D2.6 needs no code. "The weak side governs — if the weak side misses and the
 * other does not, the session is still incomplete" is `isClean` requiring every
 * logged side to make its target, which it already does.
 */
export async function closeSession(
  repo: Repo,
  view: SessionView,
  status: Exclude<SessionStatus, "planned">,
  now: Date = new Date(),
): Promise<OutcomeResult> {
  const finishedAt = now.toISOString();
  await repo.finishSession(view.session.id, { status, finishedAt });

  const [state, equipment, history] = await Promise.all([
    repo.getEngineState(view.exercise.id),
    repo.getEquipment(),
    repo.listSessions({ exerciseId: view.exercise.id }),
  ]);

  const finished: Session = { ...view.session, status, finishedAt };
  const opening: EngineState = state ?? initialState(view.exercise);
  const result = applyOutcome(opening, equipment, finished, view.sets, history);

  await repo.putEngineState([result.state]);
  return result;
}

/* ------------------------------------------------------------- the reads */

/** A session by id, with its lift and its sets. Null if either has gone. */
export async function loadSession(repo: Repo, sessionId: string): Promise<SessionView | null> {
  const session = await repo.getSession(sessionId);
  if (session === undefined) return null;

  const [sets, exercises] = await Promise.all([repo.listSets(sessionId), repo.listExercises()]);
  const exercise = exercises.find((e) => e.id === session.exerciseId);
  // The lift was dropped from the rotation while a session for it was open.
  // Nothing can prescribe for it, so there is nothing to resume.
  if (exercise === undefined) return null;

  return buildView(session, exercise, sets);
}

/**
 * The session left open by a session that was walked out of, if there is one
 * (D2.5).
 *
 * Called on every app open. It is what turns "killing the app mid-session" into
 * a non-event: the log already says which sides are done, so reopening reads
 * them and carries on.
 */
export async function resumeSession(repo: Repo): Promise<SessionView | null> {
  const active = await repo.getActiveSession();
  return active === undefined ? null : loadSession(repo, active.id);
}
