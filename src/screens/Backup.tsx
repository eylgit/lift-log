/**
 * Back up (F1).
 *
 * Pulled forward out of Part F, because the build plan's own standing
 * instruction says to: *ship export in Part C, not Part F — from Part D the
 * data is real*. The bytes have existed since C4; this is the button.
 *
 * The screen is deliberately blunt about where the log lives. §9 is the section
 * this comes from and its whole argument is that a browser database is not a
 * safe place to keep a year of training: Safari deletes an uninstalled site's
 * data after seven days, storage pressure can evict it, and clearing browsing
 * data takes it with everything else. None of that is hidden behind a
 * reassuring phrase. The athlete is told plainly, once, and given a button.
 */

import type { Format, Saved } from "../backup";

export type BackupState = {
  /** ISO instant of the last successful save, or null if it has never happened. */
  readonly lastExportedAt: string | null;
  /** How many sessions are in the log — the thing that would be lost. */
  readonly sessions: number;
  /** Whether the browser promised to keep the data through storage pressure. */
  readonly persisted: boolean | null;
  /** What happened on the last press, for the line under the buttons. */
  readonly result: { readonly saved: Saved; readonly format: Format } | null;
  readonly error: string | null;
  readonly busy: boolean;
};

export function BackupScreen({
  state,
  onDownload,
  onBack,
}: {
  state: BackupState;
  onDownload: (format: Format) => void;
  onBack: () => void;
}) {
  const { lastExportedAt, sessions, persisted, result, error, busy } = state;

  return (
    <>
      <div className="row">
        <span className="eyebrow">Back up</span>
        <button className="quiet" onClick={onBack}>
          Back
        </button>
      </div>

      <h1 className="lift">
        {sessions === 0
          ? "Nothing logged yet"
          : `${sessions} ${sessions === 1 ? "session" : "sessions"} on this device`}
      </h1>

      <p className="change" style={{ fontSize: 14, lineHeight: 1.55 }}>
        This log lives in one browser, on one phone, and nowhere else. A browser
        can throw it away — after a week of not visiting, when storage runs
        short, or the moment anyone clears browsing data. The file below is the
        only copy that survives any of that.
      </p>

      <div className="rule" />

      <div className="kv">
        <span className="k">LAST BACKUP</span>
        <span className="v">{lastExportedAt === null ? "never" : lastExportedAt.slice(0, 10)}</span>
      </div>
      <div className="kv">
        <span className="k">STORAGE</span>
        <span className="v">
          {persisted === null ? "checking…" : persisted ? "persistent" : "best effort"}
        </span>
      </div>

      <div className="grow" />

      {error !== null && <p className="notice">{error}</p>}
      {error === null && result !== null && (
        <p className="hint" style={{ marginBottom: 10 }}>
          {result.saved === "shared"
            ? `${result.format.toUpperCase()} file handed to the share sheet — keep it somewhere that is not this phone.`
            : `${result.format.toUpperCase()} file downloaded. Move it somewhere that is not this phone.`}
        </p>
      )}

      <button className="done" disabled={busy} onClick={() => onDownload("json")}>
        {busy ? "Working…" : "Download backup"}
      </button>
      <button className="missed" disabled={busy} onClick={() => onDownload("csv")}>
        Download a spreadsheet instead
      </button>

      <p className="hint">
        The backup is the whole database and is what restores it. The spreadsheet
        is one row per set, for reading — it does not restore anything.
      </p>
    </>
  );
}
