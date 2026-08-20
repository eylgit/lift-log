/**
 * Weight arithmetic (B3).
 *
 * The athlete's step is the progression increment, so weights move in whole
 * steps and there is no ladder to snap to. See `lift-log-design.md` §6.1 for
 * the virtual-target design this replaced, and what dropping it costs.
 *
 * Floating point is the entire difficulty in this file. `0.1 + 0.2 !== 0.3`,
 * and a 2.5 kg step accumulated by repeated addition drifts until 17.5 stops
 * comparing equal to 17.5. Every weight the engine hands out goes through
 * `roundKg` for that reason.
 *
 * There was a `snapToStep` here, which rounded a weight down to a multiple of
 * the step. It went when the step became the athlete's *intended* increment
 * rather than a claim about which weights exist (see `Equipment`): with no grid
 * to snap to, both its callers had nothing left to correct.
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

/** One step up. The whole of the progression rule (B4.1) is this line. */
export function addStep(kg: number, stepKg: number): number {
  assertStep(stepKg);
  return roundKg(kg + stepKg);
}
