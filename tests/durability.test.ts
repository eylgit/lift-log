/**
 * F1–F3 — how safe the log is, and when to say so.
 *
 * Two decisions are tested here and neither one needs a browser, which is the
 * reason both were written as plain functions over values. The platform
 * detection decides which instructions to draw; the nudge rule decides whether
 * to interrupt somebody's morning. The second is the one worth being careful
 * about — a nudge that fires on every open is worse than no nudge at all,
 * because it teaches people to dismiss a screen without reading it, and a
 * fortnight is a long time to wait to find that out by hand.
 *
 * `readStorage` is not tested here. It reads three optional browser APIs and
 * does nothing else; a test of it would be a test of the mock.
 */

import { describe, expect, it } from "vitest";

import { NUDGE_AFTER_DAYS, NUDGE_AFTER_SESSIONS, backupStatus } from "../src/durability";
import type { Session } from "../src/engine";
import { atRiskOfEviction, installState, isIos } from "../src/platform";

/* -------------------------------------------------------------- fixtures */

const NOW = new Date("2026-08-24T09:00:00.000Z");

/** `days` before NOW, as an instant. */
function ago(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function sessionOf(over: Partial<Session> & { id: string }): Session {
  return {
    exerciseId: "split-squat",
    startedAt: ago(1),
    finishedAt: ago(1),
    trainingDay: "2026-08-23",
    prescribedKg: 20,
    actualKg: 20,
    status: "complete",
    note: null,
    deletedAt: null,
    ...over,
  };
}

/** `n` finished sessions, the oldest `oldestDaysAgo` back, one a day after. */
function log(n: number, oldestDaysAgo = n): Session[] {
  return Array.from({ length: n }, (_, i) =>
    sessionOf({ id: `s${i}`, startedAt: ago(oldestDaysAgo - i) }),
  );
}

/* ------------------------------------------------------- the nudge (F3.2) */

describe("backupStatus", () => {
  it("says nothing at all about an empty log", () => {
    // A fresh install has nothing to lose, and interrupting it to insist on
    // backing up an empty database would be the app talking about itself.
    const status = backupStatus([], null, null, NOW);

    expect(status).toEqual({ atRisk: 0, daysSince: null, due: false, reason: null });
  });

  it("does not nudge a log younger than the threshold", () => {
    const status = backupStatus(log(3, 3), null, null, NOW);

    expect(status.due).toBe(false);
    expect(status.atRisk).toBe(3);
  });

  it("nudges after a fortnight without a backup", () => {
    // Three sessions is nowhere near the session threshold; it is the days that
    // trip it, which is the case for somebody training twice a week.
    const status = backupStatus(log(3, NUDGE_AFTER_DAYS + 1), null, null, NOW);

    expect(status.due).toBe(true);
    expect(status.reason).toBe("days");
  });

  it("nudges after ten sessions, however recent they are", () => {
    // Trained every day for a fortnight… no. Ten sessions in five days is not
    // realistic training, but it is exactly what an import or a burst of
    // backfilling looks like, and the log is just as unbacked-up either way.
    const status = backupStatus(log(NUDGE_AFTER_SESSIONS, 5), null, null, NOW);

    expect(status.due).toBe(true);
    expect(status.reason).toBe("sessions");
  });

  it("counts only what has happened since the last backup", () => {
    // Eight sessions, backed up after the fifth. Three are at risk, and three
    // is not ten.
    const sessions = log(8, 8);
    const status = backupStatus(sessions, ago(3.5), null, NOW);

    expect(status.atRisk).toBe(3);
    expect(status.due).toBe(false);
  });

  it("leaves open sessions out of the count", () => {
    // The same rule the calendar and the list apply: one is either the session
    // being trained right now or one nobody closed, and neither has happened.
    const sessions = [...log(2, 2), sessionOf({ id: "open", status: "planned" })];

    expect(backupStatus(sessions, null, null, NOW).atRisk).toBe(2);
  });

  it("reports the days since the backup, not since the dismissal", () => {
    // What the screen says is measured from the backup, because that is the
    // true answer to "how much would I lose". Dismissing a nudge does not make
    // the log any safer and the number must not pretend it did.
    const status = backupStatus(log(3, 30), ago(20), ago(1), NOW);

    expect(status.daysSince).toBe(20);
  });

  it("stops nudging once it has been dismissed", () => {
    // The whole of "interrupt *once*". Without this the screen comes back on
    // the next open, and the one after that.
    const sessions = log(3, 30);

    expect(backupStatus(sessions, null, null, NOW).due).toBe(true);
    expect(backupStatus(sessions, null, ago(1), NOW).due).toBe(false);
  });

  it("asks again a fortnight after being dismissed", () => {
    // Dismissing buys time, not silence. The log is still at risk and the app
    // should say so again — just not tomorrow.
    const sessions = log(3, 60);

    expect(backupStatus(sessions, null, ago(NUDGE_AFTER_DAYS + 1), NOW).due).toBe(true);
  });

  it("asks again after ten more sessions, however recent the dismissal", () => {
    // Somebody who dismissed yesterday and has since backfilled a month of
    // training has ten more sessions that exist nowhere else.
    const sessions = log(NUDGE_AFTER_SESSIONS + 2, 1);
    const status = backupStatus(sessions, null, ago(1.5), NOW);

    expect(status.due).toBe(true);
    expect(status.reason).toBe("sessions");
  });

  it("goes quiet as soon as a backup happens", () => {
    const sessions = log(20, 40);

    expect(backupStatus(sessions, null, null, NOW).due).toBe(true);
    expect(backupStatus(sessions, ago(0.1), null, NOW)).toMatchObject({
      due: false,
      atRisk: 0,
      daysSince: 0,
    });
  });

  it("survives a lastExportedAt that is not a date", () => {
    // A hand-edited backup can carry anything, and `readOptionalString` checks
    // the type rather than the meaning. A nudge that crashed the app on open
    // would be a worse outcome than one that does not fire.
    const status = backupStatus(log(3, 30), "the other day", null, NOW);

    expect(status.daysSince).toBeNull();
    expect(() => backupStatus(log(3, 30), "nonsense", "also nonsense", NOW)).not.toThrow();
  });
});

/* ------------------------------------------------------- the platform (F2) */

describe("installState", () => {
  it("calls an installed app installed, whatever else is true", () => {
    // A held install prompt on an already-installed app is a browser being
    // wrong, and believing the display mode is the safer way round.
    expect(installState({ standalone: true, ios: true, promptable: false })).toBe("installed");
    expect(installState({ standalone: true, ios: false, promptable: true })).toBe("installed");
  });

  it("singles out iOS in a tab, where the seven-day rule bites", () => {
    expect(installState({ standalone: false, ios: true, promptable: false })).toBe("ios-browser");
  });

  it("offers the prompt where there is one", () => {
    expect(installState({ standalone: false, ios: false, promptable: true })).toBe("installable");
  });

  it("admits when there is nothing it can do", () => {
    expect(installState({ standalone: false, ios: false, promptable: false })).toBe("browser");
  });
});

describe("atRiskOfEviction", () => {
  it("is true only for iOS in a tab", () => {
    // Not "iOS Safari". Every browser on iOS is WebKit underneath and subject
    // to the same cap, so singling Safari out would tell a Chrome-on-iPhone
    // user their log was safe when it is not.
    expect(atRiskOfEviction("ios-browser")).toBe(true);
    expect(atRiskOfEviction("installed")).toBe(false);
    expect(atRiskOfEviction("browser")).toBe(false);
    expect(atRiskOfEviction("installable")).toBe(false);
  });
});

describe("isIos", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const IPAD_AS_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const MAC = IPAD_AS_MAC;
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Mobile Safari/537.36";

  it("knows an iPhone", () => {
    expect(isIos(IPHONE, 5)).toBe(true);
  });

  it("catches an iPad claiming to be a Mac", () => {
    // iPadOS 13 and later report a desktop user-agent by default. The touch
    // points are the only thing left that gives it away.
    expect(isIos(IPAD_AS_MAC, 5)).toBe(true);
  });

  it("does not mistake a real Mac for one", () => {
    // The same string. No Mac reports more than one touch point.
    expect(isIos(MAC, 0)).toBe(false);
  });

  it("knows Android is not iOS", () => {
    expect(isIos(ANDROID, 5)).toBe(false);
  });
});
