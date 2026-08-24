/**
 * INV-5 — the training day is the day it felt like.
 *
 * `trainingDay()` moved out of the placeholder `plan.ts` in D1.1 and had no
 * test, which is worth fixing rather than carrying: it decides which day every
 * session in the log belongs to, and it is the one function in the app that
 * reads the actual clock.
 *
 * Every case passes its own `Date` rather than mocking time. The parameter
 * exists for exactly this, and a test that has to freeze the clock to check a
 * cutoff has already lost the argument about where clocks belong.
 */

import { describe, expect, it } from "vitest";

import { trainingDay } from "../src/clock";

/** A local `Date`, built from local parts, because the cutoff is local. */
function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("trainingDay", () => {
  it("formats as YYYY-MM-DD, zero-padded", () => {
    expect(trainingDay(at(2026, 3, 7, 12))).toBe("2026-03-07");
  });

  it("is the calendar day for any ordinary hour", () => {
    expect(trainingDay(at(2026, 8, 24, 6))).toBe("2026-08-24");
    expect(trainingDay(at(2026, 8, 24, 23, 59))).toBe("2026-08-24");
  });

  it("counts the small hours as the night before", () => {
    // A session finished at 00:30 on the 25th belongs to the 24th — the day the
    // athlete thinks they trained.
    expect(trainingDay(at(2026, 8, 25, 0, 30))).toBe("2026-08-24");
    expect(trainingDay(at(2026, 8, 25, 2, 59))).toBe("2026-08-24");
  });

  it("hands the day over at 3 a.m., not at midnight", () => {
    expect(trainingDay(at(2026, 8, 25, 3))).toBe("2026-08-25");
  });

  it("rolls back across a month boundary", () => {
    expect(trainingDay(at(2026, 9, 1, 1))).toBe("2026-08-31");
  });

  it("rolls back across a year boundary", () => {
    expect(trainingDay(at(2027, 1, 1, 2))).toBe("2026-12-31");
  });

  it("does not modify the date it was given", () => {
    const midnight = at(2026, 8, 25, 1);
    const before = midnight.getTime();

    trainingDay(midnight);

    expect(midnight.getTime()).toBe(before);
  });
});
