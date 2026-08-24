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

import {
  addDays,
  daysBetween,
  localDay,
  startOfWeek,
  trainingDay,
  weekdayIndex,
} from "../src/clock";

/** A local `Date`, built from local parts, because the cutoff is local. */
function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("localDay", () => {
  it("is the plain local date, with no cutoff", () => {
    // Where `trainingDay` would say the 24th, this says the 25th: a file saved
    // at half past midnight belongs to the day the phone says it is.
    expect(localDay(at(2026, 8, 25, 0, 30))).toBe("2026-08-25");
    expect(trainingDay(at(2026, 8, 25, 0, 30))).toBe("2026-08-24");
  });

  it("zero-pads", () => {
    expect(localDay(at(2026, 1, 5, 9))).toBe("2026-01-05");
  });
});

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

/* ---------------------------------------------- calendar arithmetic (E1.1) */

describe("addDays", () => {
  it("moves forwards and backwards", () => {
    expect(addDays("2026-08-24", 1)).toBe("2026-08-25");
    expect(addDays("2026-08-24", -1)).toBe("2026-08-23");
    expect(addDays("2026-08-24", 0)).toBe("2026-08-24");
  });

  it("crosses months and years", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("knows about leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("survives a spring-forward night", () => {
    // The reason the arithmetic is done in UTC. In London, Berlin or Madrid the
    // 29th of March 2026 is twenty-three hours long, and adding 24 hours of
    // local time to its midnight lands back on the 29th.
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("refuses something that is not a day", () => {
    expect(() => addDays("not-a-day", 1)).toThrow(RangeError);
  });
});

describe("daysBetween", () => {
  it("counts forwards, and negative backwards", () => {
    expect(daysBetween("2026-08-24", "2026-08-31")).toBe(7);
    expect(daysBetween("2026-08-31", "2026-08-24")).toBe(-7);
    expect(daysBetween("2026-08-24", "2026-08-24")).toBe(0);
  });

  it("is the inverse of addDays over a long span", () => {
    expect(daysBetween("2025-01-01", addDays("2025-01-01", 900))).toBe(900);
  });
});

describe("weekdayIndex and startOfWeek", () => {
  it("counts Monday as zero", () => {
    // 2026-08-24 is a Monday.
    expect(weekdayIndex("2026-08-24")).toBe(0);
    expect(weekdayIndex("2026-08-30")).toBe(6);
  });

  it("walks back to Monday, and stays put on one", () => {
    expect(startOfWeek("2026-08-24")).toBe("2026-08-24");
    expect(startOfWeek("2026-08-30")).toBe("2026-08-24");
    expect(startOfWeek("2026-08-27")).toBe("2026-08-24");
  });
});
