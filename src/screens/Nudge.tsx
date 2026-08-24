/**
 * The backup nudge (F3.2).
 *
 * The plan calls this the highest-leverage item in the whole data story and
 * says not to skip it, and the reason is in §9.3: an export button that nobody
 * ever presses is level zero of the durability ladder, and by itself it is
 * insufficient *because nobody ever presses it*. Everything else in Part F
 * makes the log a bit safer where it already is. This is the only thing in the
 * app that gets a second copy off the device.
 *
 * The whole screen is one sentence and one large button, which is what the plan
 * asks for and is also the only design that works. A screen with a paragraph on
 * it is a screen that gets dismissed unread, and a nudge that has been trained
 * out of somebody is worse than no nudge — it is the same interruption with
 * none of the benefit.
 *
 * Three things it deliberately does not do.
 *
 * It does not scold. Not backing up is not a failure of character, and the
 * design is explicit that guilt is friction and friction is the enemy (§5). The
 * sentence states a fact about a number of sessions and stops.
 *
 * It does not block. "Not now" is a real button, in the same size and weight as
 * the other one, and it costs nothing to press. An app that will not let
 * somebody past it to log the set they are standing over is an app that gets
 * closed.
 *
 * It does not lie about what a backup is worth. The line under the button says
 * the file has to leave the phone, because a download sitting in the same
 * device's Files app survives none of the three threats in §9.2.
 */

import type { BackupStatus } from "../durability";

export function NudgeScreen({
  status,
  busy,
  onBackUp,
  onDismiss,
}: {
  status: BackupStatus;
  busy: boolean;
  onBackUp: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <div className="row">
        <span className="eyebrow">Back up</span>
      </div>

      <h1 className="lift">{headline(status)}</h1>
      <p className="change" style={{ fontSize: 15, lineHeight: 1.55 }}>
        {sentence(status)}
      </p>

      <div className="grow" />

      <button className="done" disabled={busy} onClick={onBackUp}>
        {busy ? "Working…" : "Download backup"}
      </button>
      <button className="missed" disabled={busy} onClick={onDismiss}>
        Not now
      </button>

      <p className="hint">
        Keep the file somewhere that is not this phone. That is the part that
        makes it a backup.
      </p>
    </>
  );
}

/**
 * The number, as a headline.
 *
 * Sessions rather than days, whichever threshold actually fired, because the
 * sessions are the thing that would be lost and a fortnight of not training
 * costs nothing at all. A count is also a fact rather than a judgement — "14
 * days since you backed up" reads as an accusation in a way "11 sessions" does
 * not.
 */
export function headline(status: BackupStatus): string {
  const n = status.atRisk;
  return n === 1 ? "1 session exists only here" : `${n} sessions exist only here`;
}

/**
 * One sentence, and it is about the log rather than about the athlete.
 *
 * The two cases are genuinely different and are worth different words. Never
 * having backed up is the ordinary state of somebody who has been training for
 * a fortnight and has not thought about it; a backup that has gone stale is a
 * habit that has lapsed. Neither is framed as a mistake.
 */
export function sentence(status: BackupStatus): string {
  const they = status.atRisk === 1 ? "It has" : "They have";
  const those = status.atRisk === 1 ? "that session is" : "those sessions are";

  if (status.daysSince === null) {
    return (
      `${they} never been backed up. If this browser clears its data, or ` +
      "the phone goes missing, that is the whole log."
    );
  }
  const days = status.daysSince;
  return (
    `The last backup was ${days} ${days === 1 ? "day" : "days"} ago, so ${those} ` +
    "on this device and nowhere else."
  );
}
