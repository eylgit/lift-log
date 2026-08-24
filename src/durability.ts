/**
 * How safe the log is, and when to say so (F1, F3).
 *
 * Two questions live here, and they are the same question at two distances.
 * `readStorage` answers "where does this log stand right now" — persistent or
 * best-effort, how much room it takes, whether the app is installed. The nudge
 * rule answers "has it been long enough that the athlete should be interrupted
 * about it". Both come out of §9's argument, which is worth restating in one
 * line because everything in this file follows from it:
 *
 *   **Browser storage cannot be the only copy of a log you intend to keep for
 *   years.** Nothing in a browser survives someone clearing site data, and no
 *   API exists that would change that.
 *
 * So the app's job is not to make the database indestructible — it cannot — but
 * to be honest about the risk and to get a second copy off the device before it
 * matters. `readStorage` is the honesty and the nudge is the second copy.
 *
 * The nudge rule is a plain function over values, with the clock handed in. It
 * decides whether to interrupt somebody's morning, which is exactly the kind of
 * decision that should be checkable without a browser or a fortnight of waiting.
 */

import type { Session } from "./engine";
import type { InstallState } from "./platform";
import { readPlatform, installState } from "./platform";

/* ------------------------------------------------------- the status (F1) */

/**
 * What the storage block says (F1.3).
 *
 * Every field is nullable because every one of them can be unavailable, and
 * saying "unknown" is the point of the block. A browser that does not implement
 * `estimate()` must not produce a screen claiming zero bytes.
 */
export type StorageStatus = {
  /** Whether the browser promised to keep this through storage pressure. */
  readonly persisted: boolean | null;
  /** Bytes the origin is using, or null if the browser will not say. */
  readonly usageBytes: number | null;
  /** Bytes it would allow, or null. */
  readonly quotaBytes: number | null;
  readonly install: InstallState;
};

/**
 * Ask the browser everything it will tell us (F1.1, F1.2).
 *
 * `persist()` is called rather than remembered. It is idempotent and returns
 * the standing answer, so asking is both cheaper and more current than storing
 * the result of the one call §9 suggests making during onboarding — a browser
 * can change its mind, and a stored "granted" from three months ago would be
 * the app asserting something it has not checked.
 *
 * Everything is wrapped, because all of it is optional. Safari has shipped
 * versions with `storage` and no `estimate`, and a private window can throw
 * from either. A status block that crashed the screen it is meant to reassure
 * would be a poor trade.
 */
export async function readStorage(promptable = false): Promise<StorageStatus> {
  const persisted = await navigator.storage?.persist?.().catch(() => false) ?? null;

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    usageBytes = estimate?.usage ?? null;
    quotaBytes = estimate?.quota ?? null;
  } catch {
    // Refused, which is a fact about the browser and not an error worth
    // showing. The block says "unknown" and the rest of it is still true.
  }

  return { persisted, usageBytes, quotaBytes, install: installState(readPlatform(promptable)) };
}

/* -------------------------------------------------------- the nudge (F3) */

/**
 * How long, and how many sessions, before the app interrupts.
 *
 * The plan says "~14 days or ~10 sessions" and the tildes are doing real work:
 * neither number is a threshold anything depends on, and both are round numbers
 * chosen because they are roughly a fortnight and roughly a fortnight's
 * training. A backup two weeks old loses at most two weeks.
 */
export const NUDGE_AFTER_DAYS = 14;
export const NUDGE_AFTER_SESSIONS = 10;

/** What the nudge knows, and why it is firing. */
export type BackupStatus = {
  /** Sessions logged since the last backup — what a lost phone would cost. */
  readonly atRisk: number;
  /** Whole days since the last backup, or null if there has never been one. */
  readonly daysSince: number | null;
  /** Whether to interrupt (F3.2). */
  readonly due: boolean;
  /** Which threshold tripped. Null when nothing is due. */
  readonly reason: "days" | "sessions" | null;
};

/** Whole days between two instants. Elapsed time, not calendar days. */
function daysSinceInstant(at: string, now: Date): number | null {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/** The later of two instants, either of which may be missing. */
function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * Whether to interrupt about the backup (F3.2).
 *
 * Two clocks, deliberately, and the difference between them is the whole rule.
 *
 * What the screen *says* is measured from the last backup: that is the true
 * answer to "how much would I lose", and dismissing a nudge does not make the
 * log any safer.
 *
 * What *triggers* is measured from the last backup **or the last time we
 * interrupted, whichever is more recent**. That is what makes this a nudge
 * rather than nagging. Dismissing buys another fortnight, or another ten
 * sessions, and then the app asks again — because the risk has not gone away
 * and pretending otherwise until the athlete happens to think of it is how a
 * year of training gets lost. It cannot fire twice in one morning, which is the
 * failure mode that would teach somebody to dismiss it without reading it.
 *
 * A log with nothing finished in it never nudges, whatever the dates say. There
 * is nothing to lose yet, and interrupting a fresh install to insist it back up
 * an empty database would be the app talking about itself.
 *
 * Sessions still `planned` do not count, the same rule the calendar and the
 * list apply: one is either the session being trained right now or one nobody
 * closed, and neither has happened.
 */
export function backupStatus(
  sessions: readonly Session[],
  lastExportedAt: string | null,
  lastNudgedAt: string | null,
  now: Date = new Date(),
): BackupStatus {
  const finished = sessions.filter((session) => session.status !== "planned");
  const since = (at: string | null) =>
    at === null ? finished : finished.filter((session) => session.startedAt > at);

  const atRisk = since(lastExportedAt).length;
  const daysSince = lastExportedAt === null ? null : daysSinceInstant(lastExportedAt, now);

  if (finished.length === 0) return { atRisk, daysSince, due: false, reason: null };

  // The trigger's clock: whichever of the two happened later.
  const from = latest(lastExportedAt, lastNudgedAt);
  const sessionsSince = since(from).length;
  // Never backed up and never nudged: count from the first session, because
  // that is when the log became worth losing.
  const days = daysSinceInstant(from ?? finished[0]!.startedAt, now) ?? 0;

  if (sessionsSince >= NUDGE_AFTER_SESSIONS) {
    return { atRisk, daysSince, due: true, reason: "sessions" };
  }
  if (days >= NUDGE_AFTER_DAYS) return { atRisk, daysSince, due: true, reason: "days" };
  return { atRisk, daysSince, due: false, reason: null };
}
