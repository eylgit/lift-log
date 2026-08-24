/**
 * Add to Home Screen (F2).
 *
 * This screen exists because of one sentence in §9.2, and it is the sentence
 * that decides whether a year of training survives an iPhone: **iOS caps all
 * script-writable storage at seven days without a visit, and a web app on the
 * Home Screen is outside that counter.** So Add to Home Screen is not a nicety
 * here and it is not an engagement tactic — it is the data-safety step, and the
 * design says in as many words that it deserves a real screen with real
 * instructions.
 *
 * It is also the only screen in the app that has to draw an interaction it
 * cannot perform. iOS gives a web page no install prompt of any kind, so the
 * Share → Add to Home Screen flow has to be described in words and a drawn
 * icon. Everywhere else there is an event to fire and one button to press.
 *
 * The reason is given before the instructions, in plain terms and without
 * softening. Somebody who does not know why they are being asked will not do
 * it, and this is the one thing in the app worth being asked twice about.
 */

import type { InstallState } from "../platform";

export function InstallScreen({
  state,
  onInstall,
  onBack,
}: {
  state: InstallState;
  onInstall: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="row">
        <span className="eyebrow">Install</span>
        <button className="quiet" onClick={onBack}>
          Back
        </button>
      </div>

      {state === "installed" ? (
        <>
          <h1 className="lift">Already installed</h1>
          <p className="change" style={{ fontSize: 14, lineHeight: 1.55 }}>
            Lift Log is running from your home screen, which is where you want
            it. On iOS that is what keeps Safari's seven-day rule from applying
            to this log. It still is not a backup — nothing on one device is.
          </p>
        </>
      ) : (
        <>
          <h1 className="lift">Put it on your home screen</h1>
          <p className="change" style={{ fontSize: 14, lineHeight: 1.55 }}>
            {reason(state)}
          </p>
        </>
      )}

      <div className="rule" />

      {state === "ios-browser" && <IosSteps />}

      {state === "installable" && (
        <>
          <p className="prompt">
            This browser can install Lift Log itself. It becomes an app with its
            own icon, opens without the browser around it, and keeps working
            offline.
          </p>
          <button className="done" onClick={onInstall}>
            Install Lift Log
          </button>
        </>
      )}

      {state === "browser" && (
        <p className="prompt">
          This browser has not offered an install button, and there is no way for
          a page to force one. Look for <em>Install</em> or{" "}
          <em>Add to Home Screen</em> in its menu. If it is not there, back up
          often — that file is what makes the log safe, and it works everywhere.
        </p>
      )}

      <div className="grow" />

      <p className="hint">
        Installing protects the log from the browser. It does not protect it
        from a lost phone — only the backup file does that.
      </p>
    </>
  );
}

/**
 * The iOS flow, drawn (F2.2).
 *
 * The Share icon is inline SVG rather than the character `􀈂`, which is in
 * Apple's private-use area and renders as a blank box on every other platform —
 * including the desktop browser somebody might be reading this on.
 */
function IosSteps() {
  return (
    <ol className="steps">
      <li>
        Tap <Share /> <strong>Share</strong> at the bottom of Safari.
      </li>
      <li>
        Scroll down and tap <strong>Add to Home Screen</strong>.
      </li>
      <li>
        Tap <strong>Add</strong>.
      </li>
      <li>Open Lift Log from the new icon from now on.</li>
    </ol>
  );
}

function Share() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12M12 3l-4 4M12 3l4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Why this is being asked, in the terms that are actually true of the platform.
 *
 * iOS gets the seven-day rule stated outright, because it is a real and
 * near-term way to lose everything and no amount of tact improves it. Elsewhere
 * the honest reason is smaller — eviction under storage pressure is real but
 * rarer — and overstating it would be borrowing Apple's problem to make a case
 * that does not need it.
 */
export function reason(state: InstallState): string {
  if (state === "ios-browser") {
    return (
      "Safari deletes a website's data after seven days without a visit, and " +
      "this log is website data. Two weeks away and it is gone — not hidden, " +
      "gone. A web app on the home screen is exempt from that rule, which is " +
      "why this screen exists."
    );
  }
  return (
    "An installed app is treated as something you meant to keep. Its data is " +
    "the first thing a browser stops throwing away when storage runs short, " +
    "and it opens offline, from its own icon, without a tab."
  );
}
