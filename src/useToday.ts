/**
 * The Today card, as React sees it (D1.1).
 *
 * The screen cannot render a prescription synchronously: the rotation and the
 * engine cache live in IndexedDB, opening it is asynchronous, and on the first
 * open it also seeds defaults and may rebuild the cache (C3.2). So there are
 * three states rather than one, and this hook names all three instead of
 * letting the card guess from a possibly-undefined value.
 *
 * `failed` is one of them on purpose. A browser can refuse storage — a private
 * window, a full disk, an upgrade held open by another tab — and an app whose
 * answer to that is a blank screen has thrown away the one piece of information
 * the athlete needs (§9, INV-8). What to draw for it is the card's business;
 * carrying the error rather than swallowing it is this hook's.
 */

import { useEffect, useState } from "react";

import { openRepo } from "./db";
import type { Today } from "./today";
import { loadToday } from "./today";

export type TodayView =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly today: Today }
  | { readonly status: "failed"; readonly error: Error };

export function useToday(dayIndex: number): TodayView {
  const [view, setView] = useState<TodayView>({ status: "loading" });

  useEffect(() => {
    // Guards the two setState calls below rather than cancelling the read.
    // There is nothing to cancel — the database work is already in flight and
    // takes milliseconds — and under StrictMode this effect runs twice in
    // development, so without it the first run resolves into an unmounted
    // component.
    let live = true;

    openRepo()
      .then((repo) => loadToday(repo, dayIndex))
      .then((today) => {
        if (live) setView({ status: "ready", today });
      })
      .catch((error: unknown) => {
        if (live) {
          setView({
            status: "failed",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });

    return () => {
      live = false;
    };
  }, [dayIndex]);

  return view;
}
