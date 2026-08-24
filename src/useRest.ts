/**
 * A repainting clock for the rest timer (D3.1).
 *
 * The interval here exists to force a re-render and for no other reason. The
 * number on the screen comes from `restAt`, which subtracts two instants, so a
 * tick that the system throttles or suspends costs a frame and never a second.
 * That is the whole distinction the build plan is making when it says *never*
 * count down with a `setInterval` — the sin is not the interval, it is trusting
 * it to be the source of the time.
 *
 * It stops when there is nothing to time, so a session sitting mid-set is not
 * waking the phone twice a second for nothing.
 */

import { useEffect, useState } from "react";

import type { Instant } from "./engine";
import type { Rest } from "./session";
import { restAt } from "./session";

/** Twice a second: fast enough that the seconds never look stuck. */
const REPAINT_MS = 500;

export function useRest(startedAt: Instant | null, targetS: number): Rest | null {
  const [, repaint] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => repaint((n) => n + 1), REPAINT_MS);
    return () => clearInterval(timer);
  }, [startedAt]);

  return startedAt === null ? null : restAt(startedAt, targetS);
}

/** `m:ss`, the way a rest is read rather than the way a duration is written. */
export function asClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
