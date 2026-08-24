/**
 * Onboarding (G1).
 *
 * Two halves. The first is the decisions — what the draft resolves to, and when
 * the app asks at all — which are plain functions over values and need no
 * database. The second drives `commitOnboarding` against a real repository,
 * because the thing worth checking there is not that four writes happened but
 * that the *card that comes out the other side* says what the athlete chose:
 * the step, the start weight and the weak side all have to survive replay, and
 * replay is the part that would quietly hand back a default.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ROTATION } from "../src/db/schema";
import { openDexieRepo } from "../src/db/dexie-repo";
import type { Repo } from "../src/db";
import type { Exercise, Session } from "../src/engine";
import { DEFAULT_STEP_KG } from "../src/engine";
import {
  ONBOARDING_STEPS,
  PROJECTION_SESSIONS,
  STEP_CHOICES,
  commitOnboarding,
  initialDraft,
  needsOnboarding,
  projectedGainKg,
  resolveRotation,
  setStepKg,
  setWeakSide,
} from "../src/onboarding";

const ROTATION: readonly Exercise[] = DEFAULT_ROTATION.map(({ order: _order, ...rest }) => rest);

/** A finished session, for the clauses that only care that one exists. */
function session(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    exerciseId: "press",
    startedAt: "2026-08-01T09:00:00.000Z",
    finishedAt: "2026-08-01T09:30:00.000Z",
    trainingDay: "2026-08-01",
    prescribedKg: 10,
    actualKg: 10,
    status: "complete",
    note: null,
    deletedAt: null,
    ...over,
  };
}

/* ------------------------------------------------------------ the choices */

describe("the step, offered (G1.1)", () => {
  it("offers only steps that are real increments", () => {
    expect(STEP_CHOICES).toEqual([0.5, 1, 1.25, 2, 2.5, 5]);
  });

  it("includes the app's own default, so the screen opens on something chosen", () => {
    expect(STEP_CHOICES).toContain(DEFAULT_STEP_KG);
  });

  it("keeps 1.25, which no grid of halves would contain", () => {
    // A pair of micro-plates. Leaving it off would have told every athlete who
    // owns them to pick something else.
    expect(STEP_CHOICES).toContain(1.25);
  });

  it("projects the step forward as a rate of progress, not just a weight", () => {
    expect(projectedGainKg(2.5)).toBe(25);
    expect(projectedGainKg(0.5)).toBe(5);
    expect(projectedGainKg(1.25)).toBe(12.5);
  });

  it("does not drift on a step that cannot be written in binary", () => {
    // 0.1 + 0.2 !== 0.3 is the whole difficulty; the projection is a
    // multiplication and still gets rounded, for the same reason `roundKg` does.
    expect(projectedGainKg(1.25, 3)).toBe(3.75);
    expect(String(projectedGainKg(0.5, 3))).toBe("1.5");
  });

  it("projects over ten sessions by default", () => {
    expect(PROJECTION_SESSIONS).toBe(10);
    expect(projectedGainKg(2)).toBe(2 * PROJECTION_SESSIONS);
  });
});

describe("the steps of the wizard (G1.5)", () => {
  it("ends on install, because that is the data-safety step", () => {
    expect(ONBOARDING_STEPS.at(-1)).toBe("install");
  });

  it("asks the step before it asks anything else", () => {
    expect(ONBOARDING_STEPS[0]).toBe("step");
  });
});

/* -------------------------------------------------------------- the draft */

describe("the draft (G1.2, G1.3)", () => {
  it("starts with every side unanswered, not with a guess wearing an answer's clothes", () => {
    const draft = initialDraft(ROTATION);
    expect(draft.weakSides.size).toBe(ROTATION.length);
    for (const exercise of ROTATION) {
      expect(draft.weakSides.get(exercise.id)).toBeNull();
    }
  });

  it("opens on the step the app is already set to", () => {
    expect(initialDraft(ROTATION, 2.5).stepKg).toBe(2.5);
    expect(initialDraft(ROTATION).stepKg).toBe(DEFAULT_STEP_KG);
  });

  it("changes one side without touching the others", () => {
    const draft = setWeakSide(initialDraft(ROTATION), "press", "right");
    expect(draft.weakSides.get("press")).toBe("right");
    expect(draft.weakSides.get("row")).toBeNull();
  });

  it("lets an answered side go back to unanswered", () => {
    const answered = setWeakSide(initialDraft(ROTATION), "press", "right");
    expect(setWeakSide(answered, "press", null).weakSides.get("press")).toBeNull();
  });

  it("never mutates the draft it was handed", () => {
    const before = initialDraft(ROTATION);
    setWeakSide(before, "press", "right");
    setStepKg(before, 5);
    expect(before.weakSides.get("press")).toBeNull();
    expect(before.stepKg).toBe(DEFAULT_STEP_KG);
  });
});

describe("resolving the draft into a rotation (G1.2, G1.3)", () => {
  it("starts every lift at one step, because nobody was asked for a weight", () => {
    const draft = setStepKg(initialDraft(ROTATION), 2.5);
    for (const exercise of resolveRotation(ROTATION, draft)) {
      expect(exercise.startKg).toBe(2.5);
    }
  });

  it("writes an unanswered side as left, and says so on the screen", () => {
    const resolved = resolveRotation(ROTATION, initialDraft(ROTATION));
    expect(resolved.every((exercise) => exercise.weakSide === "left")).toBe(true);
  });

  it("keeps the sides that were answered", () => {
    let draft = initialDraft(ROTATION);
    draft = setWeakSide(draft, "press", "right");
    draft = setWeakSide(draft, "row", "right");
    const byId = new Map(resolveRotation(ROTATION, draft).map((e) => [e.id, e.weakSide]));
    expect(byId.get("press")).toBe("right");
    expect(byId.get("row")).toBe("right");
    expect(byId.get("bench")).toBe("left");
  });

  it("preserves rotation order, which is what array position means", () => {
    const resolved = resolveRotation(ROTATION, initialDraft(ROTATION));
    expect(resolved.map((e) => e.id)).toEqual(ROTATION.map((e) => e.id));
  });

  it("changes nothing else about a lift", () => {
    const resolved = resolveRotation(ROTATION, initialDraft(ROTATION));
    expect(resolved[0]!.name).toBe(ROTATION[0]!.name);
    expect(resolved[0]!.pattern).toBe(ROTATION[0]!.pattern);
    expect(resolved[0]!.videoQuery).toBe(ROTATION[0]!.videoQuery);
  });
});

/* ------------------------------------------------------------ when to ask */

describe("whether to ask at all (G1)", () => {
  it("asks a fresh install", () => {
    expect(needsOnboarding({ onboardedAt: null }, [])).toBe(true);
  });

  it("does not ask twice", () => {
    expect(needsOnboarding({ onboardedAt: "2026-08-24T09:00:00.000Z" }, [])).toBe(false);
  });

  it("does not ask on top of a restored log that predates the field", () => {
    // A backup taken in Part F has no `onboardedAt`, which reads as null. The
    // sessions in it are the better answer to "has this been set up".
    expect(needsOnboarding({ onboardedAt: null }, [session()])).toBe(false);
  });

  it("counts a session nobody finished — it is still proof the app was used", () => {
    const planned = session({ status: "planned", finishedAt: null });
    expect(needsOnboarding({ onboardedAt: null }, [planned])).toBe(false);
  });

  it("counts a deleted session, because deleting your log is not un-training", () => {
    const gone = session({ deletedAt: "2026-08-02T09:00:00.000Z" });
    expect(needsOnboarding({ onboardedAt: null }, [gone])).toBe(false);
  });
});

/* -------------------------------------------------------------- the write */

describe("committing the answers (G1)", () => {
  let repo: Repo;
  let dbCount = 0;

  // A database per test, under a name no other test uses — see the note in
  // `repo.test.ts` for why swapping the global `IDBFactory` does not work.
  beforeEach(async () => {
    repo = await openDexieRepo(`onboarding-test-${(dbCount += 1)}`);
  });

  it("writes the step, the start weights and the sides in one go", async () => {
    let draft = setStepKg(initialDraft(ROTATION), 2.5);
    draft = setWeakSide(draft, "press", "right");
    await commitOnboarding(repo, ROTATION, draft, "2026-08-24T09:00:00.000Z");

    expect(await repo.getEquipment()).toEqual({ stepKg: 2.5 });
    const byId = new Map((await repo.listExercises()).map((e) => [e.id, e]));
    expect(byId.get("press")!.weakSide).toBe("right");
    expect(byId.get("press")!.startKg).toBe(2.5);
    expect(byId.get("row")!.weakSide).toBe("left");
  });

  it("records that setup happened, so it is not asked again", async () => {
    const settings = await repo.getSettings();
    expect(needsOnboarding(settings, await repo.listSessions())).toBe(true);

    await commitOnboarding(repo, ROTATION, initialDraft(ROTATION), "2026-08-24T09:00:00.000Z");

    const after = await repo.getSettings();
    expect(after.onboardedAt).toBe("2026-08-24T09:00:00.000Z");
    expect(needsOnboarding(after, await repo.listSessions())).toBe(false);
  });

  it("rebuilds the cache, so the first card prescribes what was chosen", async () => {
    // The one that would go wrong silently. `engineState` was seeded when the
    // database opened, from a rotation whose start weights were all 1 kg; if
    // the commit did not replay, the first session would be prescribed at 1 kg
    // however carefully the athlete answered.
    const draft = setStepKg(initialDraft(ROTATION), 5);
    await commitOnboarding(repo, ROTATION, draft, "2026-08-24T09:00:00.000Z");

    for (const state of await repo.listEngineState()) {
      expect(state.currentKg).toBe(5);
      expect(state.stallCount).toBe(0);
    }
  });

  it("leaves the log alone — setup writes no facts", async () => {
    await commitOnboarding(repo, ROTATION, initialDraft(ROTATION), "2026-08-24T09:00:00.000Z");
    expect(await repo.listSessions()).toEqual([]);
  });

  it("does not disturb the rest of the settings", async () => {
    const before = await repo.getSettings();
    await commitOnboarding(repo, ROTATION, initialDraft(ROTATION), "2026-08-24T09:00:00.000Z");
    const after = await repo.getSettings();
    expect(after.restTargetS).toBe(before.restTargetS);
    expect(after.stallThreshold).toBe(before.stallThreshold);
    expect(after.units).toBe(before.units);
    expect(after.lastExportedAt).toBe(before.lastExportedAt);
  });
});
