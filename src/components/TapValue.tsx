/**
 * Tap to edit (D5.1, D5.3).
 *
 * One rule across the whole app: **a dotted underline means you can tap it, and
 * tapping turns that value into a stepper exactly where it sat.** Not a settings
 * screen, not a modal, not a pencil icon — the number you are looking at becomes
 * the number you are changing, in place, and tapping anywhere else puts it back.
 *
 * The known weakness of the pattern is that nobody discovers it. That is paid
 * for with one line of text on Today (D5.7) rather than by decorating every
 * value with an icon.
 *
 * Two kinds of value, and the distinction is D5.3. Anything with a range gets a
 * stepper. Anything with two states — the weak side — does not: a stepper for a
 * choice between left and right is a machine where a switch would do, so it
 * flips on tap and there is nothing to close.
 */

import { useEffect, useRef, useState } from "react";

import { Stepper } from "./Stepper";

/**
 * A number that can be stepped.
 *
 * `format` rather than a unit string, because the units belong to the caller:
 * "22.5 kg", "5 reps per side", "5 min" are all this component and none of them
 * is a suffix bolted onto a number.
 */
export function TapNumber({
  value,
  onChange,
  step,
  min,
  max,
  label,
  format,
}: {
  value: number;
  onChange: (next: number) => void;
  step: number;
  min: number;
  max?: number;
  label: string;
  format: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // Tapping elsewhere collapses it (D5.1). `pointerdown` rather than `click`,
  // so the value closes as the finger lands rather than as it lifts.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  if (!open) {
    return (
      <button className="tap" onClick={() => setOpen(true)} aria-label={`Change ${label}`}>
        {format(value)}
      </button>
    );
  }

  // Rounding after the addition, not before: adding 0.5 to 22.5 in binary
  // floating point is 23.000000000000004, and the athlete would see it.
  const move = (direction: -1 | 1) => {
    const next = Math.round((value + direction * step) * 1000) / 1000;
    if (next < min) return;
    if (max !== undefined && next > max) return;
    onChange(next);
  };

  return (
    <span ref={box}>
      <Stepper
        label={label}
        onStep={move}
        canGoDown={value - step >= min}
        canGoUp={max === undefined || value + step <= max}
      >
        {format(value)}
      </Stepper>
    </span>
  );
}

/**
 * One of a short list — the lift, in practice.
 *
 * A stepper rather than a dropdown: five lifts in a fixed order is a ring you
 * step around, and a native select on a phone covers half the screen to choose
 * between five things. It wraps, because the rotation does.
 */
export function TapChoice<T extends string>({
  value,
  options,
  onChange,
  label,
  format,
}: {
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  label: string;
  format: (value: T) => string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  if (!open) {
    return (
      <button className="tap" onClick={() => setOpen(true)} aria-label={`Change ${label}`}>
        {format(value)}
      </button>
    );
  }

  const move = (direction: -1 | 1) => {
    const at = options.indexOf(value);
    const next = options[(at + direction + options.length) % options.length];
    if (next !== undefined) onChange(next);
  };

  return (
    <span ref={box}>
      <Stepper label={label} onStep={move}>
        {format(value)}
      </Stepper>
    </span>
  );
}

/**
 * Two states, so it flips (D5.3).
 *
 * No stepper, nothing to open, nothing to close. Tapping "left side first" is
 * the whole interaction.
 */
export function TapToggle<T extends string>({
  value,
  other,
  onChange,
  label,
  format,
}: {
  value: T;
  other: T;
  onChange: (next: T) => void;
  label: string;
  format: (value: T) => string;
}) {
  return (
    <button className="tap" onClick={() => onChange(other)} aria-label={`Change ${label}`}>
      {format(value)}
    </button>
  );
}
