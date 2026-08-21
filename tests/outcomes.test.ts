/**
 * B7.1 for the session outcome rules (B5).
 *
 * One test per row of the table in `lift-log-design.md` §6.3, plus the cases
 * that table does not have room for: the override that is not a special case,
 * the deload that has to fall back, and the arguments that must not be allowed
 * to disagree with each other.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DELOAD_FALLBACK_FACTOR,
  DELOAD_LOOKBACK_SESSIONS,
  STALLS_BEFORE_DELOAD,
  applyOutcome,
  isClean,
} from "../src/engine/progression";
import type {
  EngineState,
  Equipment,
  Session,
  SetLog,
} from "../src/engine/types";

const PRESS = "press";
const kit = (stepKg: number): Equipment => ({ stepKg });

function stateFor(currentKg: number, stallCount = 0): EngineState {
  return { exerciseId: PRESS, currentKg, stallCount };
}

/** A session as the app would write it: trained, all sets logged. */
function session(over: Partial<Session> = {}): Session {
  const prescribedKg = over.prescribedKg ?? 20;
  return {
    id: "s1",
    exerciseId: PRESS,
    startedAt: "2026-08-20T08:00:00.000Z",
    finishedAt: "2026-08-20T08:30:00.000Z",
    trainingDay: "2026-08-20",
    prescribedKg,
    actualKg: prescribedKg,
    status: "complete",
    note: null,
    deletedAt: null,
    ...over,
  };
}

/** Three sets, both sides, `shortfall` reps missing from the very last one. */
function sets(sessionId = "s1", shortfall = 0): SetLog[] {
  const out: SetLog[] = [];
  for (let i = 0; i < 6; i += 1) {
    out.push({
      id: `${sessionId}-${i}`,
      sessionId,
      ordinal: i,
      side: i % 2 === 0 ? "left" : "right",
      targetReps: 5,
      doneReps: i === 5 ? 5 - shortfall : 5,
      loggedAt: `2026-08-20T08:0${i}:00.000Z`,
    });
  }
  return out;
}

describe("isClean", () => {
  it("is true only when every set made its target", () => {
    expect(isClean(session(), sets())).toBe(true);
    expect(isClean(session(), sets("s1", 1))).toBe(false);
    expect(isClean(session(), sets("s1", 5))).toBe(false);
  });

  it("counts an extra rep as clean, not as a miss", () => {
    // The plan writes doneReps === targetReps; the design says "short of",
    // and the design wins. Six of a target five is not a failed session.
    const generous = sets().map((s) => ({ ...s, doneReps: 6 }));
    expect(isClean(session(), generous)).toBe(true);
  });

  it("is never true for an abandoned session, however good the sets look", () => {
    expect(isClean(session({ status: "abandoned" }), sets())).toBe(false);
  });

  it("is false when the status and the sets contradict each other", () => {
    // "complete" claims every set was logged; no sets were. Take the branch
    // that does not hand out weight.
    expect(isClean(session(), [])).toBe(false);
  });
});

describe("applyOutcome", () => {
  const history: Session[] = [];

  it("B5.1 — a clean session adds one step and clears the stall count", () => {
    const r = applyOutcome(stateFor(20, 2), kit(2.5), session(), sets(), history);
    expect(r.state.currentKg).toBe(22.5);
    expect(r.state.stallCount).toBe(0);
    expect(r.deload).toBeNull();
  });

  it("B5.2 — one rep short holds the weight and counts a stall", () => {
    const r = applyOutcome(stateFor(20), kit(2.5), session(), sets("s1", 1), history);
    expect(r.state.currentKg).toBe(20);
    expect(r.state.stallCount).toBe(1);
    expect(r.deload).toBeNull();
  });

  it("B5.7 — an abandoned session changes nothing at all", () => {
    // Not a stall. The deload now happens by itself, and people walk out of
    // sessions for reasons that have nothing to do with strength.
    const r = applyOutcome(
      stateFor(20, 1),
      kit(2.5),
      session({ status: "abandoned", finishedAt: null }),
      sets(),
      history,
    );
    expect(r.state).toEqual(stateFor(20, 1));
    expect(r.deload).toBeNull();
  });

  it("a run of abandoned sessions never triggers a deload", () => {
    let state = stateFor(20);
    for (let i = 0; i < 10; i += 1) {
      const r = applyOutcome(
        state,
        kit(2.5),
        session({ id: `a${i}`, status: "abandoned", finishedAt: null }),
        [],
        history,
      );
      expect(r.deload).toBeNull();
      state = r.state;
    }
    expect(state.currentKg).toBe(20);
  });

  it("does not mutate the state it was given", () => {
    const state = stateFor(20, 1);
    applyOutcome(state, kit(2.5), session(), sets(), history);
    expect(state).toEqual(stateFor(20, 1));
  });

  describe("B5.6 — a hand-typed weight, which is not a special case", () => {
    it("progresses from what was on the dumbbell, not from what was asked for", () => {
      const overridden = session({ prescribedKg: 20, actualKg: 25 });
      const r = applyOutcome(stateFor(20), kit(2.5), overridden, sets(), history);
      expect(r.state.currentKg).toBe(27.5);
    });

    it("keeps an override downwards rather than discarding it (INV-7)", () => {
      const overridden = session({ prescribedKg: 20, actualKg: 15 });
      const r = applyOutcome(stateFor(20), kit(2.5), overridden, sets("s1", 1), history);
      expect(r.state.currentKg).toBe(15);
    });
  });

  describe("arguments that disagree", () => {
    it("refuses a session belonging to another exercise", () => {
      expect(() =>
        applyOutcome(stateFor(20), kit(2.5), session({ exerciseId: "row" }), sets(), history),
      ).toThrow(RangeError);
    });

    it("refuses sets belonging to another session", () => {
      expect(() =>
        applyOutcome(stateFor(20), kit(2.5), session(), sets("other"), history),
      ).toThrow(RangeError);
    });

    it("refuses a session that has not been trained, or has been deleted", () => {
      expect(() =>
        applyOutcome(stateFor(20), kit(2.5), session({ status: "planned" }), sets(), history),
      ).toThrow(RangeError);
      expect(() =>
        applyOutcome(
          stateFor(20),
          kit(2.5),
          session({ deletedAt: "2026-08-21T00:00:00.000Z" }),
          sets(),
          history,
        ),
      ).toThrow(RangeError);
    });
  });
});

/** `count` complete sessions of the press, one a day, at the given weights. */
function past(weights: number[]): Session[] {
  return weights.map((kg, i) =>
    session({
      id: `past-${i}`,
      startedAt: `2026-08-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`,
      trainingDay: `2026-08-${String(i + 1).padStart(2, "0")}`,
      prescribedKg: kg,
      actualKg: kg,
    }),
  );
}

describe("B5.3 — the deload happens by itself", () => {
  it("holds the weight for the first two stalls", () => {
    for (let stalls = 0; stalls < STALLS_BEFORE_DELOAD - 1; stalls += 1) {
      const r = applyOutcome(stateFor(20, stalls), kit(2.5), session(), sets("s1", 1), []);
      expect(r.state.currentKg).toBe(20);
      expect(r.deload).toBeNull();
    }
  });

  it("drops the weight on the third, and clears the stall count", () => {
    const r = applyOutcome(stateFor(20, 2), kit(2.5), session(), sets("s1", 1), []);
    // 15% of 20 is 3, which is 1.2 steps of 2.5, so drop 2 steps: 20 -> 15.
    expect(r.state.currentKg).toBe(15);
    expect(r.state.stallCount).toBe(0);
    expect(r.deload).toEqual({
      exerciseId: PRESS,
      fromKg: 20,
      toKg: 15,
      basis: "fallback",
      stallCount: STALLS_BEFORE_DELOAD,
    });
  });

  it("reports the drop only on the session it happened", () => {
    const r = applyOutcome(stateFor(20, 2), kit(2.5), session(), sets("s1", 1), []);
    const next = applyOutcome(r.state, kit(2.5), session({ id: "s2", prescribedKg: 15 }), sets("s2", 1), []);
    expect(next.deload).toBeNull();
  });

  it("buys another three sessions before dropping again", () => {
    let state = stateFor(40, 0);
    const drops: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const r = applyOutcome(
        state,
        kit(2.5),
        session({ id: `s${i}`, prescribedKg: state.currentKg }),
        sets(`s${i}`, 1),
        [],
      );
      if (r.deload !== null) drops.push(i);
      state = r.state;
    }
    // Sessions 2, 5 and 8 — every third, never two in a row.
    expect(drops).toEqual([2, 5, 8]);
  });
});

describe("B5.4 — where the deload lands", () => {
  it("reaches back six sessions of that exercise, and reads the weight actually used", () => {
    // Newest last, so counting back from now: 1 ago is 35, ... 6 ago is 27.5.
    const history = past([27.5, 30, 32.5, 35, 35, 35]);
    const r = applyOutcome(stateFor(35, 2), kit(2.5), session({ id: "now", prescribedKg: 35 }), sets("now", 1), history);
    expect(r.deload?.basis).toBe("history");
    expect(r.state.currentKg).toBe(27.5);
  });

  it("counts sessions, not calendar days", () => {
    // The same six sessions, spread over five months instead of six days.
    const history = past([27.5, 30, 32.5, 35, 35, 35]).map((s, i) => ({
      ...s,
      startedAt: `2026-0${i + 1}-01T08:00:00.000Z`,
    }));
    const r = applyOutcome(stateFor(35, 2), kit(2.5), session({ id: "now", prescribedKg: 35 }), sets("now", 1), history);
    expect(r.deload?.toKg).toBe(27.5);
  });

  it("ignores deleted and abandoned sessions when counting back", () => {
    const history = [
      ...past([27.5, 30, 32.5, 35, 35, 35]),
      session({ id: "junk-1", status: "abandoned", startedAt: "2026-08-07T08:00:00.000Z", prescribedKg: 35 }),
      session({ id: "junk-2", deletedAt: "2026-08-09T00:00:00.000Z", startedAt: "2026-08-08T08:00:00.000Z", prescribedKg: 35 }),
    ];
    const r = applyOutcome(stateFor(35, 2), kit(2.5), session({ id: "now", prescribedKg: 35 }), sets("now", 1), history);
    // Still 27.5. Counted in, the two junk sessions would have stopped the
    // lookback two short of the plateau, at 32.5.
    expect(r.deload?.toKg).toBe(27.5);
  });

  it("falls back to 85% snapped down when the log is too short", () => {
    const history = past([30, 32.5, 35]); // three, not six
    const r = applyOutcome(stateFor(35, 2), kit(2.5), session({ id: "now", prescribedKg: 35 }), sets("now", 1), history);
    expect(r.deload?.basis).toBe("fallback");
    // 15% of 35 is 5.25, which is 2.1 steps of 2.5, so drop 3 steps: 35 -> 27.5.
    expect(r.state.currentKg).toBe(27.5);
  });

  it("falls back rather than proposing a deload that raises the weight", () => {
    // Six sessions ago was heavier — possible after an override downwards.
    const history = past([50, 50, 50, 50, 50, 50]);
    const r = applyOutcome(stateFor(20, 2), kit(2.5), session({ id: "now", prescribedKg: 20 }), sets("now", 1), history);
    expect(r.deload?.basis).toBe("fallback");
    expect(r.state.currentKg).toBe(15);
  });

  it("stays on the athlete's own ladder rather than a grid anchored at zero", () => {
    // Started at 22 by hand with a 2.5 step, so the weights are 22, 24.5, 27 —
    // none of them multiples of 2.5. The fallback moves in whole steps from
    // where they are, so it lands on 22, not on 22.5.
    const r = applyOutcome(stateFor(27, 2), kit(2.5), session({ id: "now", prescribedKg: 27 }), sets("now", 1), []);
    expect(r.deload?.basis).toBe("fallback");
    expect(r.state.currentKg).toBe(22);
  });

  it("returns a historical weight exactly as it was lifted, off-grid or not", () => {
    const history = past([22, 24.5, 27, 29.5, 29.5, 29.5]);
    const r = applyOutcome(stateFor(29.5, 2), kit(2.5), session({ id: "now", prescribedKg: 29.5 }), sets("now", 1), history);
    expect(r.deload?.basis).toBe("history");
    expect(r.state.currentKg).toBe(22);
  });

  it("never lands above the weight that is stuck, nor below one step", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0.5, 1, 1.25, 2.5, 5),
        fc.integer({ min: 4, max: 60 }),
        fc.array(fc.integer({ min: 1, max: 80 }), { maxLength: 12 }),
        (stepKg, steps, pastSteps) => {
          const currentKg = Number((steps * stepKg).toFixed(2));
          const history = past(pastSteps.map((n) => Number((n * stepKg).toFixed(2))));
          const r = applyOutcome(
            stateFor(currentKg, STALLS_BEFORE_DELOAD - 1),
            kit(stepKg),
            session({ id: "now", prescribedKg: currentKg }),
            sets("now", 1),
            history,
          );
          const toKg = r.state.currentKg;
          expect(toKg).toBeLessThan(currentKg);
          expect(toKg).toBeGreaterThanOrEqual(stepKg);
        },
      ),
    );
  });
});

describe("the constants are the ones the design specifies", () => {
  it("three stalls, six sessions back, 85%", () => {
    expect(STALLS_BEFORE_DELOAD).toBe(3);
    expect(DELOAD_LOOKBACK_SESSIONS).toBe(6);
    expect(DELOAD_FALLBACK_FACTOR).toBe(0.85);
  });
});
