/**
 * The stepper (D5.2).
 *
 * One component, used everywhere a number is changed, so there is exactly one
 * set of touch targets to get right and exactly one place to fix them. The
 * build plan says ≥ 42 px; these are 52, because the hand pressing them has
 * just finished a set (§14.9).
 *
 * Press and hold repeats. Without it, walking a start weight from 1 kg to 20 kg
 * is nineteen separate taps, and the athlete correctly concludes the app is
 * broken. The first repeat waits, so a single deliberate tap is never read as
 * the beginning of a run.
 */

import { useCallback, useEffect, useRef } from "react";

/** How long a press must be held before it starts repeating. */
const HOLD_MS = 450;
/** And how fast it repeats once it does. */
const REPEAT_MS = 90;

export function Stepper({
  onStep,
  canGoDown = true,
  canGoUp = true,
  label,
  children,
}: {
  /** −1 or +1. The caller decides what a step means. */
  onStep: (direction: -1 | 1) => void;
  canGoDown?: boolean;
  canGoUp?: boolean;
  /** For screen readers: what is being changed. */
  label: string;
  /** The value, between the two buttons. */
  children: React.ReactNode;
}) {
  const timers = useRef<{ hold?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});

  const stop = useCallback(() => {
    clearTimeout(timers.current.hold);
    clearInterval(timers.current.repeat);
    timers.current = {};
  }, []);

  // A pointer released outside the button never fires `pointerup` on it, and
  // the repeat would run until the component unmounted.
  useEffect(() => stop, [stop]);

  const press = (direction: -1 | 1) => {
    stop();
    onStep(direction);
    timers.current.hold = setTimeout(() => {
      timers.current.repeat = setInterval(() => onStep(direction), REPEAT_MS);
    }, HOLD_MS);
  };

  return (
    <span className="stepper" role="group" aria-label={label}>
      <button
        className="step"
        aria-label={`${label}: less`}
        disabled={!canGoDown}
        onPointerDown={() => press(-1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        // Holding a button on a phone otherwise selects text or opens a menu.
        onContextMenu={(e) => e.preventDefault()}
      >
        −
      </button>
      <span className="stepper-value">{children}</span>
      <button
        className="step"
        aria-label={`${label}: more`}
        disabled={!canGoUp}
        onPointerDown={() => press(1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
      >
        +
      </button>
    </span>
  );
}
