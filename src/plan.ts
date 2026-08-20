/**
 * The five-day rotation. One lift a day, in this order, forever.
 *
 * This is a placeholder for M1's progression engine: the weights below are
 * fixed rather than derived from a log. Everything else about the rotation —
 * that it is a position pointer and not a calendar — is already true here.
 */
export type Exercise = {
  readonly id: string;
  readonly name: string;
  readonly pattern: string;
  /** Kilograms. kg is the only unit stored, anywhere. */
  readonly weightKg: number;
  readonly weakSide: "left" | "right";
};

export const ROTATION: readonly Exercise[] = [
  { id: "split-squat", name: "Bulgarian Split Squat",     pattern: "squat",           weightKg: 30,   weakSide: "left"  },
  { id: "press",       name: "Single-Arm Shoulder Press", pattern: "vertical push",   weightKg: 17.5, weakSide: "left"  },
  { id: "deadlift",    name: "Single-Leg Deadlift",       pattern: "hip hinge",       weightKg: 32.5, weakSide: "right" },
  { id: "bench",       name: "Single-Arm Bench Press",    pattern: "horizontal push", weightKg: 22.5, weakSide: "left"  },
  { id: "row",         name: "Single-Arm Row",            pattern: "horizontal pull", weightKg: 27.5, weakSide: "left"  },
];

export const SCHEME = { repsPerSide: 5, sets: 3, restMinutes: 5 } as const;

/**
 * The local training day, with a 3 a.m. cutoff so a session logged just after
 * midnight belongs to the day it felt like. Never derive this from UTC.
 */
export function trainingDay(now: Date = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < 3) d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
