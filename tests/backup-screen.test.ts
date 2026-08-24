/**
 * F1.3 and F4.2 — what the durability screens actually say.
 *
 * These are the sentences and figures on the two screens that talk about losing
 * data, and they are worth testing for the same reason the wording on Today is:
 * every one of them is a claim, and a claim that is wrong on the day it matters
 * is worse than no screen at all. The dangerous one is `loss` — the line above
 * the Replace button — because it is the last thing read before a log is
 * overwritten.
 */

import { describe, expect, it } from "vitest";

import { bytes, installLine, loss, usageLine } from "../src/screens/Backup";
import { headline, sentence } from "../src/screens/Nudge";
import { reason } from "../src/screens/Install";
import type { BackupStatus } from "../src/durability";
import type { StorageStatus } from "../src/durability";

/* ------------------------------------------------ the restore confirm (F4.2) */

describe("loss", () => {
  it("names the shortfall when the file holds less than the device", () => {
    // The dangerous case, and the only one worth a warning: restoring last
    // month's backup over a log that has since moved on.
    expect(loss(20, 14)).toMatch(/6 sessions fewer/);
    expect(loss(20, 14)).toMatch(/Back this device up first/);
  });

  it("counts one missing session in the singular", () => {
    expect(loss(2, 1)).toMatch(/1 session fewer/);
  });

  it("says nothing alarming about restoring onto a new phone", () => {
    // The ordinary case. A bigger file replacing a smaller log is what the
    // feature is for, and a warning here would be noise that teaches somebody
    // to skip the warning that matters.
    expect(loss(3, 11)).toBe("The log on this device will be replaced by the file.");
  });

  it("says there is nothing to lose when there is nothing to lose", () => {
    expect(loss(0, 11)).toBe("There is nothing on this device to lose.");
  });

  it("claims nothing about two logs of the same size", () => {
    // Equal counts say nothing about whether they are the same sessions, so it
    // does not pretend they are.
    expect(loss(11, 11)).toBe("The log on this device will be replaced by the file.");
  });
});

/* ------------------------------------------------- the status block (F1.3) */

describe("bytes", () => {
  it("leaves small numbers alone", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(900)).toBe("900 B");
  });

  it("climbs a unit at a time", () => {
    expect(bytes(1024)).toBe("1.0 kB");
    expect(bytes(1024 * 1024)).toBe("1.0 MB");
    expect(bytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("drops the decimal once the number is big enough not to need it", () => {
    expect(bytes(1024 * 512)).toBe("512 kB");
  });
});

describe("usageLine", () => {
  const status = (over: Partial<StorageStatus>): StorageStatus => ({
    persisted: true,
    usageBytes: null,
    quotaBytes: null,
    install: "browser",
    ...over,
  });

  it("admits when the browser will not say", () => {
    // A block that invented a zero would be worse than one that says unknown —
    // the whole point of it is that it is honest (§9.1).
    expect(usageLine(status({}))).toBe("unknown");
  });

  it("shows usage against quota", () => {
    expect(usageLine(status({ usageBytes: 1024 * 1024, quotaBytes: 1024 * 1024 * 1024 }))).toBe(
      "1.0 MB of 1.0 GB",
    );
  });

  it("shows usage alone when there is no quota to compare it to", () => {
    expect(usageLine(status({ usageBytes: 2048 }))).toBe("2.0 kB");
    expect(usageLine(status({ usageBytes: 2048, quotaBytes: 0 }))).toBe("2.0 kB");
  });
});

describe("installLine", () => {
  it("answers the question that was asked, which is yes or no", () => {
    expect(installLine("installed")).toMatch(/^yes/);
    expect(installLine("ios-browser")).toMatch(/^no/);
    expect(installLine("installable")).toMatch(/^no/);
    expect(installLine("browser")).toMatch(/^no/);
  });

  it("names Safari only where it is Safari", () => {
    expect(installLine("ios-browser")).toContain("Safari");
    expect(installLine("browser")).not.toContain("Safari");
  });
});

/* ---------------------------------------------------------- the nudge (F3.2) */

describe("the nudge's words", () => {
  const status = (over: Partial<BackupStatus>): BackupStatus => ({
    atRisk: 11,
    daysSince: null,
    due: true,
    reason: "sessions",
    ...over,
  });

  it("counts sessions, not days, in the headline", () => {
    // A fortnight of not training costs nothing; the sessions are the thing
    // that would be lost. A count is also a fact rather than an accusation.
    expect(headline(status({}))).toBe("11 sessions exist only here");
    expect(headline(status({ atRisk: 1 }))).toBe("1 session exists only here");
  });

  it("says something different to somebody who has never backed up", () => {
    expect(sentence(status({}))).toMatch(/never been backed up/);
    expect(sentence(status({ daysSince: 20 }))).toMatch(/20 days ago/);
    expect(sentence(status({ daysSince: 1 }))).toMatch(/1 day ago/);
  });

  it("reads as English when there is exactly one session at risk", () => {
    // The plural is the common case and the singular is the one nobody looks
    // at, which is exactly why it is the one that ships broken.
    expect(headline(status({ atRisk: 1 }))).toContain("exists");
    expect(sentence(status({ atRisk: 1 }))).toMatch(/^It has never/);
    expect(sentence(status({ atRisk: 1, daysSince: 3 }))).toMatch(/that session is on this device/);
  });

  it("never scolds", () => {
    // §5: guilt is friction and friction is the enemy. The sentence states a
    // fact about a log and stops.
    for (const s of [sentence(status({})), sentence(status({ daysSince: 30 }))]) {
      expect(s).not.toMatch(/should|ought|forgot|failed|remember to/i);
    }
  });
});

/* -------------------------------------------------------- the install (F2.2) */

describe("the install screen's reason", () => {
  it("states the seven-day rule outright on iOS", () => {
    // A real and near-term way to lose everything, and no amount of tact
    // improves it (§9.2, threat 2).
    expect(reason("ios-browser")).toMatch(/seven days/);
    expect(reason("ios-browser")).toMatch(/gone/);
  });

  it("does not borrow Apple's problem elsewhere", () => {
    // Eviction under storage pressure is real but rarer, and overstating it
    // would make a case that does not need making.
    expect(reason("installable")).not.toMatch(/seven days/);
    expect(reason("browser")).not.toMatch(/seven days/);
  });
});
