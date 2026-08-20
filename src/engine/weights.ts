/**
 * Weight arithmetic (B3).
 *
 * The athlete's step is also the progression increment, so weights move in
 * whole steps and there is no ladder to snap to. See `lift-log-design.md` §6.1
 * for the virtual-target design this replaced, and what dropping it costs.
 *
 * Floating point is the entire difficulty in this file. `0.1 + 0.2 !== 0.3`,
 * and a 2.5 kg step accumulated by repeated addition drifts until 17.5 stops
 * comparing equal to 17.5. Every weight the engine hands out goes through
 * `roundKg` for that reason.
 */

/** Two decimals is finer than any plate anyone owns, and exactly representable enough to compare. */
const DECIMALS = 2;

/**
 * A hundred tonnes. Not a limit anyone will meet — it is here so that a weight
 * arriving from a corrupt import is rejected loudly rather than propagating.
 */
const MAX_KG = 100_000;

/** Guard for the one input that can turn this arithmetic into nonsense. */
function assertStep(stepKg: number): void {
  if (!Number.isFinite(stepKg) || stepKg <= 0) {
    throw new RangeError(`stepKg must be a positive, finite number, got ${stepKg}`);
  }
  if (roundKg(stepKg) !== stepKg) {
    throw new RangeError(`stepKg must be a whole number of hundredths, got ${stepKg}`);
  }
}

/**
 * A weight as a whole number of hundredths of a kilo, rounded **down**.
 *
 * Doing the division in integers is what removes the floating point from
 * `snapToStep` entirely: no tolerance to tune, no quotient arriving as
 * 6.999999999999999, and nothing that can round a weight up past the value it
 * was asked to stay below.
 */
function hundredthsDown(kg: number): number {
  // The epsilon absorbs the error multiplication leaves behind — 17.5 * 100 is
  // 1750.0000000000002, and 25.2 * 100 is 2519.9999999999995, which would floor
  // to 2519 and lose a hundredth. At the weights a human lifts that error is
  // around 1e-11, so 1e-9 clears it with room to spare while staying far below
  // anything that could be a real difference between two weights.
  return Math.floor(kg * 100 + 1e-9);
}

/**
 * Round a weight to the precision the app stores and displays.
 *
 * The obvious forms both get the exact half-way case wrong, and in the same
 * direction: `1.005 * 100` is `100.49999999999999`, so `Math.round(x * 100) / 100`
 * gives 1, and `(1.005).toFixed(2)` gives "1.00" for the same reason — the
 * double nearest 1.005 is a hair below it. Shifting the decimal point through
 * the exponent instead of by multiplying keeps the digits the athlete typed, so
 * 1.005 rounds up to 1.01.
 *
 * It matters less than it looks — a hundredth of a kilo is not a plate anyone
 * owns — but a rounding helper that is subtly wrong is worse than none.
 */
export function roundKg(kg: number): number {
  if (!Number.isFinite(kg)) {
    throw new RangeError(`weight must be a finite number, got ${kg}`);
  }
  if (Math.abs(kg) > MAX_KG) {
    throw new RangeError(`weight is not plausible: ${kg}`);
  }
  // Below half a hundredth the answer is zero anyway, and taking the shortcut
  // avoids the one case the string shift cannot handle: JavaScript prints
  // numbers under 1e-6 in exponent notation, and "1e-9e2" parses as NaN.
  if (Math.abs(kg) < 0.005) return 0;
  return Number(`${Math.round(Number(`${kg}e${DECIMALS}`))}e-${DECIMALS}`);
}

/**
 * The largest multiple of the step at or below `kg`, never below one step.
 *
 * Used in exactly two places, the only two that can land between steps: the
 * deload fallback (B5.4) and a start weight typed in by hand (G1.2). Weights
 * that got where they are by adding steps are already on the grid and do not
 * need this.
 *
 * Down, strictly: the result is never above `kg`. A weight carrying more than
 * two decimals is treated as the storage precision below it, because this
 * function's job is to be safe to load, not to be generous.
 */
export function snapToStep(kg: number, stepKg: number): number {
  assertStep(stepKg);
  if (!Number.isFinite(kg)) {
    throw new RangeError(`weight must be a finite number, got ${kg}`);
  }
  if (kg <= stepKg) return roundKg(stepKg);
  const steps = Math.floor(hundredthsDown(kg) / hundredthsDown(stepKg));
  return roundKg((steps * hundredthsDown(stepKg)) / 100);
}

/** One step up. The whole of the progression rule (B4.1) is this line. */
export function addStep(kg: number, stepKg: number): number {
  assertStep(stepKg);
  return roundKg(kg + stepKg);
}
