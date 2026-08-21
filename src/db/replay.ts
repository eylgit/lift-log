/**
 * Replay (C3).
 *
 * `engineState` is a cache. This is the function that says so out loud: it
 * throws the table away and works every row out again from the exercises and
 * the log, which are the only things in the database that are true (INV-2).
 *
 * Nothing here decides anything. The seed comes from `initialState`, each
 * session is folded in by `applyOutcome`, and both live in `src/engine/`. What
 * this file contributes is the order — oldest session first, one exercise at a
 * time — and the discipline of putting the result somewhere rather than
 * keeping it. That is deliberate: a replay that made its own judgements could
 * disagree with the engine that made the cache in the first place, and then
 * "rebuild it and see" would stop being a way to check anything.
 *
 * It takes a `Repo` rather than a database handle, so it knows no more about
 * where the log lives than any screen does (C2.3).
 */

import type { EngineState, ExerciseId, Session } from "../engine";
import { applyOutcome, initialState } from "../engine";
import type { Repo } from "./repo";

/**
 * Rebuild `engineState` from the log, and return what it now holds.
 *
 * The result is returned as well as written because every caller wants it: an
 * import wants to show what the athlete ended up with, a migration wants to
 * carry on, and the test wants to compare. Re-reading a table you have just
 * written is a small waste and a large opportunity to test the wrong thing.
 *
 * Two decisions inside are worth stating.
 *
 * The whole fold happens before anything is written. The build plan says
 * "clear, read, feed, write back" and this does the reading and feeding first,
 * so that a throw halfway through leaves the old cache in place rather than an
 * empty table. A stale cache is a wrong weight on one screen; a missing one is
 * an app with nothing to prescribe.
 *
 * The write is a clear followed by a put, not a put alone. A lift dropped from
 * the rotation must not leave its state behind — `saveRotation` replaces the
 * rotation wholesale, and this mirrors it. The two calls are not in one
 * transaction because `Repo` deliberately exposes none; the window between
 * them is a few milliseconds of local writes, and the recovery from losing it
 * is to run this function again.
 */
export async function rebuildState(repo: Repo): Promise<readonly EngineState[]> {
  const [exercises, equipment, log] = await Promise.all([
    repo.listExercises(),
    repo.getEquipment(),
    repo.readLog(),
  ]);

  const states = new Map<ExerciseId, EngineState>(
    exercises.map((exercise) => [exercise.id, initialState(exercise)]),
  );
  /** Sessions already folded in, per exercise — what a deload counts back through. */
  const history = new Map<ExerciseId, Session[]>(exercises.map((e) => [e.id, []]));

  for (const { session, sets } of log) {
    const state = states.get(session.exerciseId);
    if (state === undefined) {
      // A session for a lift that is no longer in the rotation. Its state has
      // nowhere to go — `engineState` is keyed by exercise and nothing could
      // prescribe from it — so it is skipped rather than invented. The session
      // itself is untouched and still exports (INV-3's reasoning, applied to a
      // lift instead of a session): the fact happened.
      continue;
    }
    // A session that is open right now. `applyOutcome` throws on one, and
    // rightly — it has no outcome yet. Replay runs while an app is in use, so
    // it must expect to meet one.
    if (session.status === "planned") continue;

    const past = history.get(session.exerciseId)!;
    // The deload is discarded on purpose. It is a thing that happened on the
    // day it happened, for the Today card to announce; the weight it produced
    // is already in the state, and re-announcing every deload of the past year
    // on the strength of a rebuild would be nonsense.
    const outcome = applyOutcome(state, equipment, session, sets, past);
    states.set(session.exerciseId, outcome.state);
    past.push(session);
  }

  const rebuilt = [...states.values()];
  await repo.clearEngineState();
  await repo.putEngineState(rebuilt);
  return rebuilt;
}
