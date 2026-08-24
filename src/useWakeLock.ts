/**
 * Keep the screen awake during a session (D3.2).
 *
 * The phone is on the floor at arm's length and the athlete's hands are full
 * (§14.9). A screen that sleeps between sets means picking it up, waking it, and
 * finding your place — three actions that all happen while out of breath.
 *
 * Everything here is best-effort by design. The Screen Wake Lock API is missing
 * on some browsers, refused in others, and dropped by the system whenever it
 * feels like it — most reliably when the tab is backgrounded, which is why the
 * lock is re-requested on the way back. None of that is worth an error message:
 * the app works perfectly well with a screen that dims, and the rest timer reads
 * the wall clock precisely so that being suspended costs nothing (D3.1).
 *
 * D3.4 is the other half of this and is deliberately not built: no scheduled
 * notifications. They are unreliable on iOS web, they are explicitly out of v1
 * scope, and onboarding says to set a phone alarm instead (G1).
 */

import { useEffect } from "react";

/** The slice of the API this file uses. `lib.dom` does not always declare it. */
type WakeLockSentinel = { released: boolean; release: () => Promise<void> };
type WakeLockNavigator = {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const api = (navigator as Navigator & WakeLockNavigator).wakeLock;
    if (api === undefined) return;

    let sentinel: WakeLockSentinel | null = null;
    // Survives the await below: without it, an effect that is cleaned up while
    // the request is in flight would leave the lock held for a screen nobody is
    // looking at.
    let wanted = true;

    const acquire = async () => {
      if (!wanted || (sentinel !== null && !sentinel.released)) return;
      try {
        const held = await api.request("screen");
        if (wanted) sentinel = held;
        else void held.release();
      } catch {
        // Refused, or the document was not visible. Nothing to do and nothing
        // worth saying — this is a convenience, not a feature.
      }
    };

    // The system drops the lock when the tab goes away and does not give it
    // back on its own.
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      wanted = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (sentinel !== null && !sentinel.released) void sentinel.release().catch(() => {});
    };
  }, [active]);
}
