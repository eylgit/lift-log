/**
 * Sample data (G2).
 *
 * The claim worth testing is not "91 rows were written". It is that the sample
 * log is *the engine's own output* — that replaying it rebuilds exactly the
 * cache the generator ended with, that every drop in it is a deload the engine
 * decided on, and that a stranger landing on it sees a card with a real reason
 * under it rather than an empty grid.
 *
 * The generator itself is shared with B7.3's year-long run (`src/sample.ts`),
 * so what is checked here is the fourteen-week end of it and the database
 * writes either side.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { addDays, daysBetween } from "../src/clock";
import { backupStatus } from "../src/durability";
import { openDexieRepo } from "../src/db/dexie-repo";
import { rebuildState, replaceAll, resetToDefaults } from "../src/db";
import type { Repo, Settings } from "../src/db";
import { DEFAULT_SETTINGS } from "../src/db/schema";
import { DEFAULT_STEP_KG, chartSeries } from "../src/engine";
import { needsOnboarding } from "../src/onboarding";
import {
  SAMPLE_DAYS,
  SAMPLE_EQUIPMENT,
  SAMPLE_ID_PREFIX,
  SAMPLE_ROTATION,
  SAMPLE_WEEKS,
  sampleRun,
  sampleSnapshot,
} from "../src/sample";

const TODAY = "2026-08-25";
const NOW = "2026-08-25T09:00:00.000Z";

/** The settings row as it stands before anyone presses "try it". */
function settingsOf(over: Partial<Settings> = {}): Settings {
  const { id: _id, ...rest } = DEFAULT_SETTINGS;
  return { ...rest, ...over };
}

/* ---------------------------------------------------------------- the run */

describe("fourteen weeks of somebody else's training (G2.1)", () => {
  const run = sampleRun(TODAY);

  it("ends today, so the card is not about a rotation idle since spring", () => {
    expect(run.lastDay).toBe(TODAY);
    expect(daysBetween(run.firstDay, run.lastDay)).toBe(SAMPLE_DAYS - 1);
    expect(SAMPLE_DAYS).toBe(SAMPLE_WEEKS * 7);
  });

  it("logs a session on every day but the week off", () => {
    // 98 days, seven of them a break — the calendar wants a hole in it.
    expect(run.sessions.length).toBe(SAMPLE_DAYS - 7);
    const days = new Set(run.sessions.map((s) => s.trainingDay));
    expect(days.size).toBe(run.sessions.length);
  });

  it("keeps every session inside the window", () => {
    for (const session of run.sessions) {
      expect(session.trainingDay >= run.firstDay).toBe(true);
      expect(session.trainingDay <= run.lastDay).toBe(true);
    }
  });

  it("deloads at least twice on every lift — the thing worth showing (G2.3)", () => {
    for (const lift of SAMPLE_ROTATION) {
      const drops = chartSeries(lift.id, run.sessions, run.sets).filter((p) => p.weightDropped);
      expect(drops.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("finishes every lift heavier than it started", () => {
    for (const lift of SAMPLE_ROTATION) {
      const points = chartSeries(lift.id, run.sessions, run.sets);
      expect(points.at(-1)!.weightKg).toBeGreaterThan(points[0]!.weightKg);
    }
  });

  it("includes one session walked out of, because a real log has one (B5.7)", () => {
    const open = run.sessions.filter((s) => s.status !== "complete");
    expect(open.length).toBe(1);
    expect(open[0]!.status).toBe("abandoned");
  });

  it("rotates by position and not by date, so the break costs no lift (INV-6)", () => {
    // Five lifts, one a day: after the week off the next session is the next
    // lift in the cycle, not whichever one the calendar landed on.
    const order = run.sessions.map((s) => s.exerciseId);
    const ids = SAMPLE_ROTATION.map((e) => e.id);
    for (let i = 0; i < order.length; i += 1) {
      expect(order[i]).toBe(ids[i % ids.length]);
    }
  });

  it("marks its rows, so a glance at the database says what they are", () => {
    expect(run.sessions.every((s) => s.id.startsWith(SAMPLE_ID_PREFIX))).toBe(true);
    expect(run.sets.every((s) => s.sessionId.startsWith(SAMPLE_ID_PREFIX))).toBe(true);
  });

  it("is the same run every time it is asked for the same day", () => {
    const again = sampleRun(TODAY);
    expect(again.sessions).toEqual(run.sessions);
    expect(again.sets).toEqual(run.sets);
  });

  it("moves with the day it is asked about", () => {
    const tomorrow = sampleRun(addDays(TODAY, 1));
    expect(tomorrow.lastDay).toBe(addDays(TODAY, 1));
    expect(tomorrow.sessions.length).toBe(run.sessions.length);
  });
});

/* ----------------------------------------------------------- the snapshot */

describe("the sample as a database (G2.1)", () => {
  it("brings its own rotation and step — the log would replay to nonsense without", () => {
    const snapshot = sampleSnapshot(TODAY, settingsOf(), NOW);
    expect(snapshot.equipment).toEqual(SAMPLE_EQUIPMENT);
    expect(snapshot.exercises).toEqual(SAMPLE_ROTATION);
    // A 30 kg split squat against a rotation that starts at 1 kg is not a
    // lighter version of the same thing.
    expect(snapshot.exercises[0]!.startKg).toBeGreaterThan(1);
  });

  it("marks itself as sample, and as already introduced", () => {
    const { settings } = sampleSnapshot(TODAY, settingsOf(), NOW);
    expect(settings.sampleDataAt).toBe(NOW);
    expect(settings.onboardedAt).toBe(NOW);
  });

  it("keeps what the athlete had set for themselves", () => {
    const mine = settingsOf({ restTargetS: 120, units: "lb", stallThreshold: 4 });
    const { settings } = sampleSnapshot(TODAY, mine, NOW);
    expect(settings.restTargetS).toBe(120);
    expect(settings.units).toBe("lb");
    expect(settings.stallThreshold).toBe(4);
  });

  it("forgets the last backup, which described a log that is no longer here", () => {
    const backed = settingsOf({ lastExportedAt: "2026-08-01T00:00:00.000Z" });
    expect(sampleSnapshot(TODAY, backed, NOW).settings.lastExportedAt).toBeNull();
  });
});

/* ------------------------------------------------------- why it is silent */

describe("the backup nudge over sample data (G2, F3.2)", () => {
  it("would fire, which is exactly why the boot rule suppresses it", () => {
    const { sessions } = sampleRun(TODAY);
    // Ninety-one finished sessions and no backup: due on the sessions clock,
    // several times over. A stranger's first screen must not be a file dialog.
    const status = backupStatus(sessions, null, null, new Date(NOW));
    expect(status.due).toBe(true);
    expect(status.reason).toBe("sessions");
  });
});

/* --------------------------------------------------------- in a database */

describe("writing and wiping (G2.1, G2.2)", () => {
  let repo: Repo;
  let dbCount = 0;

  beforeEach(async () => {
    repo = await openDexieRepo(`sample-test-${(dbCount += 1)}`);
  });

  it("writes the whole log, and prescribes from it", async () => {
    const settings = await repo.getSettings();
    await replaceAll(repo, sampleSnapshot(TODAY, settings, NOW));

    expect((await repo.listSessions()).length).toBe(SAMPLE_DAYS - 7);
    expect(await repo.getEquipment()).toEqual(SAMPLE_EQUIPMENT);

    // The one that would go wrong silently: without the rebuild the cache still
    // holds the 1 kg defaults the database was seeded with, and the first card
    // a visitor sees prescribes 1 kg over a log of 30 kg split squats.
    for (const state of await repo.listEngineState()) {
      expect(state.currentKg).toBeGreaterThan(1);
    }
  });

  it("replays to exactly the cache the generator ended with", async () => {
    // The strongest claim in the file: the log is not decorated, it is what the
    // shipped engine did. Rebuilding it from scratch must agree with the run.
    const run = sampleRun(TODAY);
    await replaceAll(repo, sampleSnapshot(TODAY, await repo.getSettings(), NOW));

    const rebuilt = await rebuildState(repo);
    for (const state of rebuilt) {
      expect(state).toEqual(run.finalState.get(state.exerciseId));
    }
    expect(rebuilt.length).toBe(SAMPLE_ROTATION.length);
  });

  it("stops asking for setup once the sample has been shown", async () => {
    await replaceAll(repo, sampleSnapshot(TODAY, await repo.getSettings(), NOW));
    const settings = await repo.getSettings();
    expect(settings.sampleDataAt).toBe(NOW);
    expect(needsOnboarding(settings, await repo.listSessions())).toBe(false);
  });

  it("wipes back to a fresh install, setup questions and all (G2.2)", async () => {
    await replaceAll(repo, sampleSnapshot(TODAY, await repo.getSettings(), NOW));
    await resetToDefaults(repo);

    expect(await repo.listSessions()).toEqual([]);
    expect(await repo.listSets("sample-0")).toEqual([]);
    expect((await repo.getEquipment()).stepKg).toBe(DEFAULT_STEP_KG);

    const settings = await repo.getSettings();
    expect(settings.sampleDataAt).toBeNull();
    expect(settings.onboardedAt).toBeNull();
    expect(needsOnboarding(settings, await repo.listSessions())).toBe(true);
  });

  it("puts the rotation back to the shipped one, not the sample athlete's", async () => {
    await replaceAll(repo, sampleSnapshot(TODAY, await repo.getSettings(), NOW));
    await resetToDefaults(repo);

    for (const exercise of await repo.listExercises()) {
      expect(exercise.startKg).toBe(DEFAULT_STEP_KG);
      expect(exercise.weakSide).toBe("left");
    }
  });
});
