/**
 * Storage-level types that are not the engine's business (C2).
 *
 * The engine owns `Exercise`, `Session`, `SetLog` and the rest — the things it
 * reasons about. It has no opinion about display units or a rest-timer default,
 * so those live here rather than in `src/engine/types.ts`.
 *
 * This file exists so that `repo.ts` — the interface every screen talks to —
 * can name a `Settings` without importing `schema.ts`, which imports Dexie.
 * Types are erased at compile time and would cost nothing at runtime, but the
 * dependency would still be there in the source, and the whole point of C2 is
 * that the layer above `src/db/` never depends on which database is underneath.
 */

/** Kilograms are what gets stored; pounds are a display conversion (§6.6, INV-1). */
export type Units = "kg" | "lb";

/**
 * The app's preferences. One row, and the row is the whole of it.
 *
 * `stallThreshold` duplicates the engine's `STALLS_BEFORE_DELOAD` constant on
 * purpose: the engine keeps a default it can reason about with no database
 * present, and this is where the athlete's override will live once the settings
 * screen exists (G3). Until then it is written with the engine's value and read
 * back unchanged.
 */
export type Settings = {
  readonly units: Units;
  readonly restTargetS: number;
  readonly stallThreshold: number;
  /** ISO instant of the last successful export, or null if never (F3). */
  readonly lastExportedAt: string | null;
  /**
   * ISO instant of the last time the backup nudge interrupted, or null (F3.2).
   *
   * Stored rather than held in memory because the nudge has to survive being
   * dismissed and the app being closed. Without it, "interrupt once" would mean
   * once per open, which is the behaviour that teaches somebody to dismiss a
   * screen without reading it. See `backupStatus` in `src/durability.ts`.
   */
  readonly lastNudgedAt: string | null;
  /**
   * ISO instant onboarding was finished, or null if it never has been (G1).
   *
   * The app asks its four questions once, and this is the record that it did.
   * It is not the only test — `needsOnboarding` in `src/onboarding.ts` also
   * requires an empty log — because a backup taken before this field existed
   * restores as null, and marching somebody through setup on top of a year of
   * training would be the app forgetting who it was talking to.
   */
  readonly onboardedAt: string | null;
  /** What version of this schema wrote the data. Also goes in the export (C4). */
  readonly schemaVersion: number;
};
