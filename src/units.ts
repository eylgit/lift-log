/**
 * Kilograms in, whatever the athlete reads out (INV-1, §6.6, §14.4).
 *
 * One rule, and the whole file exists to make it cheap to obey: **kilograms are
 * the only stored unit** — in the database, in the engine, in the export, in
 * every field named `…Kg`. Pounds are a rendering. Nothing here is ever written
 * back to storage, and no function in this file is called by `src/engine/`.
 *
 * §14.4 says decide this now because retrofitting is miserable, and it was
 * half right: the *storage* half was decided in Part B and cost nothing, and
 * the *display* half was retrofitted in G3 across seven screens, which was
 * exactly as tedious as promised. What made it survivable is that the rule had
 * been kept — there was no weight anywhere that had to be migrated, only text
 * that had to be routed through `weight()`.
 *
 * ## The one number
 *
 * `KG_PER_LB` is exact: the international pound has been defined as 0.45359237
 * kilograms since 1959, and it is a definition rather than a measurement. Using
 * 2.2 or 2.205 anywhere would put a visible error on the screen at gym weights.
 *
 * ## Rounding, and the drift that is not a bug
 *
 * Stored weights are rounded to two decimal places (B3.1), so a weight built by
 * adding an lb-native step to itself many times can land a hundredth of a kilo
 * or two away from the exact figure — about a fifth of a pound after fifty
 * clean sessions. Displayed to one decimal, that can eventually read 35.2 lb
 * where the arithmetic says 35.
 *
 * That is not worth engineering away, and B2.2.2 says why: **the step is an
 * aspiration, not a constraint.** The engine names a target and the athlete
 * reconciles it with the rack by tapping the weight, which is the same thing
 * they already do for every fixed dumbbell that is not on the grid. A tenth of
 * a pound of drift is far inside the error the design already accepts.
 */

import type { Units } from "./db";

export type { Units };

/** Exact by definition since 1959, not a measurement. */
export const KG_PER_LB = 0.45359237;

/* --------------------------------------------------------------- convert */

/** A stored weight, as the number the athlete sees. */
export function toDisplay(kg: number, units: Units): number {
  return units === "lb" ? kg / KG_PER_LB : kg;
}

/**
 * A number the athlete typed or tapped, as the weight to store.
 *
 * The inverse of `toDisplay`, and it goes through `roundKg`'s two decimals for
 * the same reason every other stored weight does: a step of 5 lb is
 * 2.267961850 kg, and carrying seventeen significant figures into the database
 * would make two weights that are the same weight fail to compare equal.
 */
export function fromDisplay(value: number, units: Units): number {
  const kg = units === "lb" ? value * KG_PER_LB : value;
  return Math.round(kg * 100) / 100;
}

/* ---------------------------------------------------------------- format */

/** Trailing zeros trimmed: 42.5 stays, 40 is not 40.0. */
function trim(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}

/**
 * A weight, with its unit. The one function every screen calls.
 *
 * One decimal place in pounds and two in kilograms, which is not an
 * inconsistency: a tenth of a pound is 45 grams and a hundredth of a kilo is
 * ten, so both round at about the same physical precision. Trailing zeros are
 * trimmed either way, because `40.0 kg` on a card at arm's length reads as a
 * number that has been calculated rather than a weight that has been lifted.
 */
export function weight(kg: number, units: Units): string {
  return units === "lb" ? `${trim(toDisplay(kg, "lb"), 1)} lb` : `${trim(kg, 2)} kg`;
}

/** The number without its unit, for the rare line that supplies its own. */
export function weightValue(kg: number, units: Units): string {
  return units === "lb" ? trim(toDisplay(kg, "lb"), 1) : trim(kg, 2);
}

/** A signed weight, for a gain: `+5 kg`, `-2.5 kg`. */
export function signedWeight(kg: number, units: Units): string {
  return `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${weight(Math.abs(kg), units)}`;
}

/**
 * A number that is *already* in display units, with its unit appended.
 *
 * For the step choices, which are canonical values in their own unit rather
 * than stored weights. Sending 1.25 lb through `weight()` would convert it to
 * 0.57 kg, round to two decimals, convert back and print **1.3 lb** — a button
 * whose label disagrees with the sentence underneath it about micro-plates.
 */
export function displayWeight(shown: number, units: Units): string {
  return `${trim(shown, 2)} ${units}`;
}

/** Just the unit, for a column heading or an axis. */
export function unitLabel(units: Units): string {
  return units;
}

/* ------------------------------------------------------------ the step */

/**
 * The steps offered on the setup screen and in settings, in the athlete's own
 * units (§6.6, G1.1).
 *
 * §6.6 is explicit that an lb athlete should set **an lb-native step — 5 lb or
 * 2.5 lb — rather than the ugly conversion of 2.5 kg**, and this is that
 * sentence in code. The two lists are not conversions of one another and were
 * not meant to be: they are the increments each kind of kit actually offers.
 * 1.25 in either unit is what a pair of micro-plates gives you.
 *
 * The returned values are in **display units**. `fromDisplay` turns the chosen
 * one into the kilograms that get stored.
 */
const STEP_CHOICES_KG: readonly number[] = [0.5, 1, 1.25, 2, 2.5, 5];
const STEP_CHOICES_LB: readonly number[] = [1, 1.25, 2.5, 5, 10];

export function stepChoices(units: Units): readonly number[] {
  return units === "lb" ? STEP_CHOICES_LB : STEP_CHOICES_KG;
}

/**
 * How much one tap of a stepper moves a weight, in display units.
 *
 * A quarter of a kilo, or half a pound — near enough the same distance, and
 * both are round numbers in their own unit. Stepping a pound display by a
 * quarter-kilo would walk 88.2, 88.7, 89.3, which is a stepper that cannot hit
 * a whole number.
 */
export function displayStep(units: Units): number {
  return units === "lb" ? 0.5 : 0.25;
}

/**
 * The offered step closest to one already chosen, in a different unit.
 *
 * For the moment somebody switches units on the setup screen. Carrying the
 * kilograms straight across would hand an lb athlete a step of 5.5 lb — the
 * exact "ugly conversion of 2.5 kg" §6.6 exists to prevent — so the choice is
 * re-expressed as the nearest thing their kit actually offers. 2.5 kg becomes
 * 5 lb, which is what they would have picked.
 *
 * Nearest and not rounded-down: 10 lb is a closer reading of 5 kg than 5 lb is,
 * and the step is an aspiration rather than a limit (B2.2.2), so being a little
 * over is no worse than being a little under.
 */
export function nearestStep(kg: number, units: Units): number {
  const shown = toDisplay(kg, units);
  const best = stepChoices(units).reduce((a, b) =>
    Math.abs(b - shown) < Math.abs(a - shown) ? b : a,
  );
  return fromDisplay(best, units);
}
