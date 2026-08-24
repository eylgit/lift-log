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

import { openRepo } from "./db";
import type { OutcomeResult } from "./engine";
import type { SessionView } from "./session";
import {
  closeSession,
  logSide as logSideOf,
  resumeSession,
  setWeight as setWeightOf,
  startSession,
} from "./session";
import type { Today } from "./today";
import { loadToday } from "./today";

export type Screen =
  | { readonly name: "loading" }
  | { readonly name: "failed"; readonly error: Error }
  | { readonly name: "today"; readonly today: Today }
  | {
      readonly name: "session";
      readonly view: SessionView;
      /** The athlete's rest, from settings rather than the engine's default. */
      readonly restTargetS: number;
    }
  | {
      readonly name: "summary";
      readonly view: SessionView;
      readonly outcome: OutcomeResult;
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
};

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
      if (resumed === null) return { name: "today", today: await loadToday(repo) };
      const settings = await repo.getSettings();
      return { name: "session", view: resumed, restTargetS: settings.restTargetS };
    });

    return () => {
      live.current = false;
    };
  }, [run]);

  const toToday = useCallback(async (): Promise<Screen> => {
    const repo = await openRepo();
    return { name: "today", today: await loadToday(repo) };
  }, []);

  const start = useCallback(() => {
    void run(async () => {
      const here = current.current;
      if (here.name !== "today") return here;
      const repo = await openRepo();
      const view = await startSession(repo, here.today.prescription);
      return { name: "session", view, restTargetS: here.today.restTargetS };
    });
  }, [run]);

  const logSide = useCallback(
    (doneReps: number) => {
      void run(async () => {
        const here = current.current;
        if (here.name !== "session") return here;
        const repo = await openRepo();
        const view = await logSideOf(repo, here.view, doneReps);
        return { name: "session", view, restTargetS: here.restTargetS };
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
        return { name: "session", view, restTargetS: here.restTargetS };
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

  const finish = useCallback(() => close("complete"), [close]);
  const abandon = useCallback(() => close("abandoned"), [close]);
  const dismiss = useCallback(() => void run(toToday), [run, toToday]);

  return [screen, { start, logSide, setWeight, finish, abandon, dismiss }] as const;
}
