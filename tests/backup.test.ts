/**
 * F1 — the file the athlete actually keeps.
 *
 * Only the naming is tested here. Handing a file to a person is the one part of
 * the data story that is genuinely platform-dependent — a share sheet on iOS, a
 * download everywhere else — and neither exists in a test runner. What can be
 * checked is that two backups taken on different days are told apart, which is
 * the second thing anyone needs from a backup after having one at all.
 *
 * The bytes themselves are `tests/transfer.test.ts` and `tests/round-trip.test.ts`,
 * which take a simulated year out and put it back.
 */

import { describe, expect, it } from "vitest";

import { backupFileName } from "../src/backup";

/** A local `Date`, built from local parts, because the name is a local date. */
function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour);
}

describe("backupFileName", () => {
  it("names the file for the day it was taken", () => {
    expect(backupFileName("json", at(2026, 8, 24))).toBe("lift-log-2026-08-24.json");
    expect(backupFileName("csv", at(2026, 8, 24))).toBe("lift-log-2026-08-24.csv");
  });

  it("uses the day the phone says it is, not the training day", () => {
    // 00:30 on the 25th is still the 24th's *session*, but it is the 25th's
    // file — that is the folder the athlete will look in.
    expect(backupFileName("json", at(2026, 8, 25, 0))).toBe("lift-log-2026-08-25.json");
  });

  it("sorts chronologically in a file listing", () => {
    const names = [at(2026, 12, 1), at(2026, 2, 3), at(2026, 8, 24)]
      .map((d) => backupFileName("json", d))
      .sort();

    expect(names).toEqual([
      "lift-log-2026-02-03.json",
      "lift-log-2026-08-24.json",
      "lift-log-2026-12-01.json",
    ]);
  });
});
