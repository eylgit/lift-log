/**
 * The whole app as a state machine (D2, D4).
 *
 * Three screens — Today, the session, the summary — and every move between them
 * is a write to the log followed by a read of what the log now says. The screens
 * themselves hold no knowledge of storage or of the engine; they are handed a
 * shape and a set of things they may ask for.
 *
 * One decision worth stating. On open, the app asks whether a session is
 * already in progress *before* it asks what today's lift is. An open session
 * outranks the rotation: somebody who force-quit mid-workout wants the side they
 * were on, not a card telling them to start again (D2.5). It is also the only
 * ordering that cannot lose work.
 *
 * Errors land in one place. Every action is wrapped, and a failure puts the app
 * in `failed` with the error kept rather than swallowed — a browser that refuses
 * storage mid-session is exactly when the athlete needs to be told, not shown a
 * button that silently does nothing (§9, INV-8).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Format } from "./backup";
import { saveFile } from "./backup";
import { trainingDay } from "./clock";
import { exportCsv, exportJson, openRepo, rebuildState } from "./db";
import type { Exercise, ExerciseId, OutcomeResult, SessionId, Side } from "./engine";
import type { History, SessionDetail } from "./history";
import { loadDetail, loadHistory } from "./history";
import type { SessionView } from "./session";
import {
  closeSession,
  logSide as logSideOf,
  resumeSession,
  setReps as setRepsOf,
  setTotalSets as setTotalSetsOf,
  setWeight as setWeightOf,
  startSession,
} from "./session";
import type { BackupState } from "./screens/Backup";
import type { Today } from "./today";
import { loadToday } from "./today";

export type Screen =
  | { readonly name: "loading" }
  | { readonly name: "failed"; readonly error: Error }
  | {
      readonly name: "today";
      readonly today: Today;
      /**
       * What the athlete has tapped their way to, before pressing Start (D5.4).
       *
       * Held here and not written anywhere, because until Start there is no
       * session for it to be a fact about. It becomes one the moment the session
       * opens: the weight as `actualKg` beside the engine's `prescribedKg`, the
       * reps as each set's `targetReps`.
       */
      readonly plan: Plan;
    }
  | {
      readonly name: "session";
      readonly view: SessionView;
      /** The athlete's rest, from settings rather than the engine's default. */
      readonly restTargetS: number;
      /**
       * The side about to be logged, when the athlete has corrected it (D5.5).
       *
       * It survives exactly one write. "I did the right side first this time" is
       * a statement about one row, not about the session, so it is cleared as
       * soon as that row exists.
       */
      readonly sideOverride: Side | null;
    }
  | {
      readonly name: "summary";
      readonly view: SessionView;
      readonly outcome: OutcomeResult;
    }
  | { readonly name: "backup"; readonly state: BackupState }
  | { readonly name: "history"; readonly history: History }
  | { readonly name: "detail"; readonly detail: SessionDetail };

/** Today's session as the athlete has adjusted it. */
export type Plan = {
  readonly weightKg: number;
  readonly repsPerSide: number;
  readonly totalSets: number;
};

export type Actions = {
  /** Open a session for today's prescription and go to it. */
  readonly start: () => void;
  /** Write down the side on screen (D2.5). */
  readonly logSide: (doneReps: number) => void;
  /** Correct the weight on the dumbbell (INV-7, D5.5). */
  readonly setWeight: (kg: number) => void;
  /** Close a session that ran to the end (D4). */
  readonly finish: () => void;
  /** Close a session that was walked out of (B5.7). */
  readonly abandon: () => void;
  /** Leave the summary and go back to Today. */
  readonly dismiss: () => void;

  /* -------------------------------------------------- tap to edit (D5) */

  /** Today only: train a different lift from the one the rotation offered. */
  readonly chooseLift: (exerciseId: ExerciseId) => void;
  /** Today only: the weight to put on. Becomes `actualKg` at Start. */
  readonly chooseWeight: (kg: number) => void;
  /** Reps per side. On Today it plans; mid-session it changes what is left. */
  readonly chooseReps: (reps: number) => void;
  /** How many sets. On Today it plans; mid-session it adds or drops one. */
  readonly chooseSets: (sets: number) => void;
  /** Which side is the weak one. A fact about the athlete, so it is stored. */
  readonly flipWeakSide: () => void;
  /** How long to rest between sets, in seconds. Stored in settings. */
  readonly chooseRest: (seconds: number) => void;
  /** Mid-session: log the side you actually did, if it was not the one offered. */
  readonly flipSide: () => void;

  /* ------------------------------------------------------ history (E1) */

  /** Open the history calendar and the log beneath it. */
  readonly openHistory: () => void;
  /** Open one logged session, down to every set (E1.2). */
  readonly openDetail: (id: SessionId) => void;
  /** Tombstone the session on screen and go back to the list (E1.3, INV-3). */
  readonly deleteSession: () => void;

  /* ------------------------------------------------------- backup (F1) */

  /** Open the backup screen. */
  readonly openBackup: () => void;
  /** Write the log to a file and, if it got there, record that it happened. */
  readonly download: (format: Format) => void;
};

/** The plan a freshly loaded card starts from: exactly what was prescribed. */
function planFrom(today: Today): Plan {
  return {
    weightKg: today.prescription.weightKg,
    repsPerSide: today.prescription.repsPerSide,
    totalSets: today.prescription.sets,
  };
}

export function useApp(): readonly [Screen, Actions] {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });

  // The current screen, for the actions to read without being rebuilt on every
  // state change. Actions fire from event handlers, so they need what is true
  // *now*, and a callback that closed over an old screen would write the wrong
  // set to the wrong session.
  const current = useRef<Screen>(screen);
  current.current = screen;

  // Guards every setState. Under StrictMode the mount effect runs twice in
  // development, and an in-flight database read must not resolve into a
  // component that is no longer there.
  const live = useRef(true);


  const run = useCallback(async (work: () => Promise<Screen>) => {
    try {
      const next = await work();
      if (live.current) setScreen(next);
    } catch (error: unknown) {
      if (live.current) {
        setScreen({
          name: "failed",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void run(async () => {
      const repo = await openRepo();
      // An open session beats the rotation. See the header.
      const resumed = await resumeSession(repo);
      if (resumed === null) {
        const today = await loadToday(repo);
        return { name: "today", today, plan: planFrom(today) };
      }
      const settings = await repo.getSettings();
      return {
        name: "session",
        view: resumed,
        restTargetS: settings.restTargetS,
        sideOverride: null,
      };
    });

    return () => {
      live.current = false;
    };
  }, [run]);

  /**
   * Re-read the card.
   *
   * `keep` is for the edits that change the card without changing what the
   * athlete has already decided about it: flipping the weak side and changing
   * the rest both write to storage and both have to reload, and neither is a
   * reason to throw away a weight they had just dialled in. Choosing a different
   * lift is — a different lift has a different weight, and keeping the old one
   * would silently prescribe the press's weight for the deadlift.
   */
  const toToday = useCallback(
    async (exerciseId?: ExerciseId, keep?: Plan): Promise<Screen> => {
      const repo = await openRepo();
      const today = await loadToday(repo, exerciseId);
      return { name: "today", today, plan: keep ?? planFrom(today) };
    },
    [],
  );

  const start = useCallback(() => {
    void run(async () => {
      const here = current.current;
      if (here.name !== "today") return here;
      const repo = await openRepo();
      const view = await startSession(repo, here.today.prescription, {
        actualKg: here.plan.weightKg,
        repsPerSide: here.plan.repsPerSide,
        totalSets: here.plan.totalSets,
      });
      return {
        name: "session",
        view,
        restTargetS: here.today.restTargetS,
        sideOverride: null,
      };
    });
  }, [run]);

  const logSide = useCallback(
    (doneReps: number) => {
      void run(async () => {
        const here = current.current;
        if (here.name !== "session") return here;
        const repo = await openRepo();
        const view = await logSideOf(
          repo,
          here.view,
          doneReps,
          new Date(),
          here.sideOverride ?? undefined,
        );
        return { name: "session", view, restTargetS: here.restTargetS, sideOverride: null };
      });
    },
    [run],
  );

  const setWeight = useCallback(
    (kg: number) => {
      void run(async () => {
        const here = current.current;
        if (here.name !== "session") return here;
        const repo = await openRepo();
        const view = await setWeightOf(repo, here.view, kg);
        return { name: "session", view, restTargetS: here.restTargetS, sideOverride: null };
      });
    },
    [run],
  );

  const close = useCallback(
    (status: "complete" | "abandoned") => {
      void run(async () => {
        const here = current.current;
        if (here.name !== "session") return here;
        const repo = await openRepo();
        const outcome = await closeSession(repo, here.view, status);
        // The summary is handed the session as it now stands, not as it was a
        // moment ago: it has to say whether the session was completed or walked
        // out of, and that is exactly the field the close just wrote.
        const view: SessionView = {
          ...here.view,
          session: { ...here.view.session, status, finishedAt: new Date().toISOString() },
        };
        return { name: "summary", view, outcome };
      });
    },
    [run],
  );

  /* ---------------------------------------------------------- history (E1) */

  /**
   * Read the log and show the calendar.
   *
   * Today's date is read here rather than inside `loadHistory`, because that is
   * where the clock lives (`src/clock.ts`) and it is what keeps the history
   * module testable without freezing time. It is read at the moment the screen
   * opens, not when the app started: an app left open overnight and reopened in
   * the morning should mark the right square as today.
   */
  const openHistory = useCallback(() => {
    void run(async () => {
      const repo = await openRepo();
      return { name: "history", history: await loadHistory(repo, trainingDay()) };
    });
  }, [run]);

  /**
   * Open one session from the list.
   *
   * A session that is not there any more sends the athlete back to the list
   * rather than to an empty screen. The only way to reach that is a row tapped
   * from a list built before the session was deleted — from another tab, or
   * from an import — and the right answer is the list as it now stands, which
   * no longer has the row in it (INV-3, and `loadDetail`).
   */
  const openDetail = useCallback(
    (id: SessionId) => {
      void run(async () => {
        const repo = await openRepo();
        const detail = await loadDetail(repo, id);
        if (detail === null) {
          return { name: "history", history: await loadHistory(repo, trainingDay()) };
        }
        return { name: "detail", detail };
      });
    },
    [run],
  );

  /**
   * Delete the session on screen (E1.3).
   *
   * Three steps and the middle one is the point. The tombstone is written
   * (INV-3), then the engine cache is rebuilt, then the list is re-read. The
   * cache is derived from the log and the log has just changed underneath it:
   * delete last week's clean session and the weight it earned is still sitting
   * in `engineState`, so tomorrow's card would prescribe a number that nothing
   * in the log supports (INV-2). `rebuildState` is the function that exists to
   * say that out loud, and it filters tombstones because every read does.
   *
   * It takes no argument for the same reason `finish` does not: the session it
   * acts on is the one on the screen, and passing an id would invite acting on
   * a different one.
   */
  const deleteSession = useCallback(() => {
    void run(async () => {
      const here = current.current;
      if (here.name !== "detail") return here;
      const repo = await openRepo();
      await repo.softDeleteSession(here.detail.id, new Date().toISOString());
      await rebuildState(repo);
      return { name: "history", history: await loadHistory(repo, trainingDay()) };
    });
  }, [run]);

  /* ----------------------------------------------------------- backup (F1) */

  const readBackup = useCallback(async (over: Partial<BackupState> = {}): Promise<Screen> => {
    const repo = await openRepo();
    const [settings, sessions] = await Promise.all([repo.getSettings(), repo.listSessions()]);
    return {
      name: "backup",
      state: {
        lastExportedAt: settings.lastExportedAt,
        sessions: sessions.length,
        // `persist()` is idempotent and returns the standing answer, so asking
        // again here costs nothing and is the only way to be current (F1.1).
        persisted: (await navigator.storage?.persist?.().catch(() => false)) ?? null,
        result: null,
        error: null,
        busy: false,
        ...over,
      },
    };
  }, []);

  const openBackup = useCallback(() => void run(() => readBackup()), [run, readBackup]);

  const download = useCallback(
    (format: Format) => {
      const here = current.current;
      if (here.name !== "backup" || here.state.busy) return;
      setScreen({ ...here, state: { ...here.state, busy: true, error: null, result: null } });

      void (async () => {
        try {
          const repo = await openRepo();
          const exportedAt = new Date().toISOString();
          const contents =
            format === "json" ? await exportJson(repo, exportedAt) : await exportCsv(repo);
          const saved = await saveFile(contents, format);

          // Only the full backup counts as a backup. A spreadsheet cannot
          // restore anything, and recording it as one would silence the nudge
          // that exists to stop the log being lost (F3.1).
          if (format === "json") await repo.saveSettings({ lastExportedAt: exportedAt });
          if (live.current) setScreen(await readBackup({ result: { saved, format } }));
        } catch (error: unknown) {
          if (!live.current) return;
          // Dismissing the share sheet is not a failure and is not worth a
          // sentence — but it must not be recorded as a backup either, which
          // is why it arrives here rather than in the success path.
          const cancelled = error instanceof DOMException && error.name === "AbortError";
          setScreen(
            await readBackup({
              error: cancelled
                ? null
                : `The backup could not be written: ${error instanceof Error ? error.message : String(error)}`,
            }),
          );
        }
      })();
    },
    [readBackup],
  );

  const finish = useCallback(() => close("complete"), [close]);
  const abandon = useCallback(() => close("abandoned"), [close]);
  const dismiss = useCallback(() => void run(() => toToday()), [run, toToday]);

  /* ------------------------------------------------------ tap to edit (D5) */

  const chooseLift = useCallback(
    (exerciseId: ExerciseId) => void run(() => toToday(exerciseId)),
    [run, toToday],
  );

  /** Change part of today's plan without touching the card underneath it. */
  const replan = useCallback((change: (plan: Plan) => Plan) => {
    const here = current.current;
    if (here.name !== "today") return;
    setScreen({ ...here, plan: change(here.plan) });
  }, []);

  const chooseWeight = useCallback(
    (weightKg: number) => {
      const here = current.current;
      if (here.name === "today") return replan((plan) => ({ ...plan, weightKg }));
      void run(async () => {
        if (here.name !== "session") return here;
        const repo = await openRepo();
        const view = await setWeightOf(repo, here.view, weightKg);
        return {
          name: "session",
          view,
          restTargetS: here.restTargetS,
          sideOverride: here.sideOverride,
        };
      });
    },
    [replan, run],
  );

  const chooseReps = useCallback(
    (repsPerSide: number) => {
      const here = current.current;
      if (here.name === "today") return replan((plan) => ({ ...plan, repsPerSide }));
      // Mid-session this touches no row: it changes the target of the sides
      // still to come, and each of those records its own target when logged.
      if (here.name === "session") {
        setScreen({ ...here, view: setRepsOf(here.view, repsPerSide) });
      }
    },
    [replan],
  );

  const chooseSets = useCallback(
    (totalSets: number) => {
      const here = current.current;
      if (here.name === "today") return replan((plan) => ({ ...plan, totalSets }));
      if (here.name === "session") {
        setScreen({ ...here, view: setTotalSetsOf(here.view, totalSets) });
      }
    },
    [replan],
  );

  const flipWeakSide = useCallback(() => {
    void run(async () => {
      const here = current.current;
      if (here.name !== "today") return here;
      const repo = await openRepo();
      const rotation = await repo.listExercises();
      const id = here.today.prescription.exercise.id;
      // Which side is weaker is a fact about the athlete, not about a session,
      // so it goes on the exercise and outlives every session (see `Exercise`).
      const flipped: Exercise[] = rotation.map((exercise) =>
        exercise.id === id
          ? { ...exercise, weakSide: (exercise.weakSide === "left" ? "right" : "left") as Side }
          : exercise,
      );
      await repo.saveRotation(flipped);
      return toToday(id, here.plan);
    });
  }, [run, toToday]);

  const chooseRest = useCallback(
    (seconds: number) => {
      void run(async () => {
        const here = current.current;
        if (here.name !== "today") return here;
        const repo = await openRepo();
        await repo.saveSettings({ restTargetS: seconds });
        return toToday(here.today.prescription.exercise.id, here.plan);
      });
    },
    [run, toToday],
  );

  const flipSide = useCallback(() => {
    const here = current.current;
    if (here.name !== "session" || here.view.step === null) return;
    // Nothing is written until Done. This only changes which side the next row
    // will say it was.
    const showing = here.sideOverride ?? here.view.step.side;
    setScreen({ ...here, sideOverride: showing === "left" ? "right" : "left" });
  }, []);

  return [
    screen,
    {
      start,
      logSide,
      setWeight,
      finish,
      abandon,
      dismiss,
      chooseLift,
      chooseWeight,
      chooseReps,
      chooseSets,
      flipWeakSide,
      chooseRest,
      flipSide,
      openHistory,
      openDetail,
      deleteSession,
      openBackup,
      download,
    },
  ] as const;
}
