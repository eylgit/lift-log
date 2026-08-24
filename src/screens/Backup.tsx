/**
 * Back up, and restore (F1, F4).
 *
 * Pulled forward out of Part F at the end of Part D, because the build plan's
 * own standing instruction says to: *ship export in Part C, not Part F — from
 * Part D the data is real*. The bytes have existed since C4; this is the
 * button, and now the way back in.
 *
 * The screen is deliberately blunt about where the log lives. §9 is the section
 * this comes from and its whole argument is that a browser database is not a
 * safe place to keep a year of training: iOS deletes an uninstalled site's data
 * after seven days, storage pressure can evict it, and clearing browsing data
 * takes it with everything else. None of that is hidden behind a reassuring
 * phrase. The athlete is told plainly, once, and given a button.
 *
 * The status block (F1.3) is the same honesty in numbers, and §9.1 asks for it
 * unhidden. Every line of it can read "unknown", because every one of those
 * browser APIs is optional and a block that invented a zero would be worse than
 * one that admits what it does not know.
 *
 * Import sits below the downloads and looks secondary (F4.3), which is the
 * right weight for it: it is the rarer action and the destructive one. It also
 * cannot happen in one tap — the file is read and checked first, and what the
 * confirm says is what was actually found in it (F4.1, F4.2).
 */

import { useRef } from "react";

import type { Format, Saved } from "../backup";
import type { ImportPreview, ImportResult } from "../db";
import type { StorageStatus } from "../durability";
import type { InstallState } from "../platform";

export type BackupState = {
  /** ISO instant of the last successful save, or null if it has never happened. */
  readonly lastExportedAt: string | null;
  /** How many sessions are in the log — the thing that would be lost. */
  readonly sessions: number;
  /** Persistence, usage and how the app is running (F1.2, F1.3). */
  readonly storage: StorageStatus | null;
  /** What happened on the last press, for the line under the buttons. */
  readonly result: { readonly saved: Saved; readonly format: Format } | null;
  readonly error: string | null;
  readonly busy: boolean;
  /** A file has been read and checked and is waiting to be confirmed (F4.1). */
  readonly pending: { readonly preview: ImportPreview; readonly json: string } | null;
  /** What the restore put back, once it has (F4). */
  readonly restored: ImportResult | null;
};

export function BackupScreen({
  state,
  onDownload,
  onPick,
  onImport,
  onCancelImport,
  onInstall,
  onBack,
}: {
  state: BackupState;
  onDownload: (format: Format) => void;
  onPick: (file: File) => void;
  onImport: () => void;
  onCancelImport: () => void;
  onInstall: () => void;
  onBack: () => void;
}) {
  const { lastExportedAt, sessions, storage, result, error, busy, pending, restored } = state;
  const picker = useRef<HTMLInputElement>(null);

  if (pending !== null) {
    return (
      <Confirm
        preview={pending.preview}
        sessions={sessions}
        busy={busy}
        onImport={onImport}
        onCancel={onCancelImport}
      />
    );
  }

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

      {/* F1.3. Five lines, none of them hidden and none of them guessed. */}
      <div className="kv">
        <span className="k">LAST BACKUP</span>
        <span className="v">{lastExportedAt === null ? "never" : lastExportedAt.slice(0, 10)}</span>
      </div>
      <div className="kv">
        <span className="k">STORED</span>
        <span className="v">in this browser, on this device</span>
      </div>
      <div className="kv">
        <span className="k">INSTALLED</span>
        <span className="v">{storage === null ? "checking…" : installLine(storage.install)}</span>
      </div>
      <div className="kv">
        <span className="k">PERSISTENT</span>
        <span className="v">
          {storage === null
            ? "checking…"
            : storage.persisted === null
              ? "unknown"
              : storage.persisted
                ? "granted"
                : "best effort"}
        </span>
      </div>
      <div className="kv">
        <span className="k">USING</span>
        <span className="v">{storage === null ? "checking…" : usageLine(storage)}</span>
      </div>

      {storage !== null && storage.install === "ios-browser" && (
        <p className="notice warn">
          This is Safari on iOS, and it deletes a site's data after seven days
          without a visit — a fortnight away and a year of training is gone. Add
          Lift Log to your Home Screen and that rule stops applying to it.
        </p>
      )}
      {storage !== null && storage.install === "installable" && (
        <button className="missed" onClick={onInstall}>
          Install Lift Log on this device
        </button>
      )}

      <div className="grow" />

      {error !== null && <p className="notice">{error}</p>}
      {error === null && restored !== null && (
        <p className="hint" style={{ marginBottom: 10 }}>
          Restored {restored.sessions} {restored.sessions === 1 ? "session" : "sessions"} and{" "}
          {restored.sets} sets from a backup taken on {restored.exportedAt.slice(0, 10)}.
        </p>
      )}
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

      <div className="rule" />

      {/* F4.3 — beside the downloads and quieter than them. */}
      <input
        ref={picker}
        className="hidden-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared on the way out so that picking the same file twice after a
          // failed read fires `change` the second time as well.
          event.target.value = "";
          if (file !== undefined) onPick(file);
        }}
      />
      <button className="missed" disabled={busy} onClick={() => picker.current?.click()}>
        Restore from a backup file
      </button>

      <p className="hint">
        The backup is the whole database and is what restores it. The spreadsheet
        is one row per set, for reading — it does not restore anything.
      </p>
    </>
  );
}

/**
 * The confirm (F4.2).
 *
 * It replaces the screen rather than sitting on top of it, because the decision
 * deserves the whole display and because there is nothing on the screen behind
 * that is worth reading while making it.
 *
 * What it says is what the file actually contains, which is why the file is
 * read and checked before this is drawn. "Replace 214 sessions with the 198 in
 * a file from 3 August" is a decision somebody can make; "replace everything?"
 * is a dice roll. The two numbers being different is exactly the case worth
 * catching — restoring last month's backup over a log that has moved on.
 */
function Confirm({
  preview,
  sessions,
  busy,
  onImport,
  onCancel,
}: {
  preview: ImportPreview;
  sessions: number;
  busy: boolean;
  onImport: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="row">
        <span className="eyebrow">Restore</span>
        <button className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <h1 className="lift">Replace this log?</h1>

      <p className="change" style={{ fontSize: 14, lineHeight: 1.55 }}>
        Restoring <strong>replaces</strong> everything on this device. It is not
        a merge: what is in the file becomes the whole log, and what is here now
        is gone.
      </p>

      <div className="rule" />

      <div className="kv">
        <span className="k">ON THIS DEVICE</span>
        <span className="v">
          {sessions} {sessions === 1 ? "session" : "sessions"}
        </span>
      </div>
      <div className="kv">
        <span className="k">IN THE FILE</span>
        <span className="v">
          {preview.sessions} {preview.sessions === 1 ? "session" : "sessions"}, {preview.sets} sets
        </span>
      </div>
      <div className="kv">
        <span className="k">TAKEN</span>
        <span className="v">{preview.exportedAt.slice(0, 10)}</span>
      </div>

      <div className="grow" />

      {/* Said again, at the moment of the tap, when the numbers above have had
          their chance to be read. */}
      <p className="hint" style={{ marginBottom: 10 }}>
        {loss(sessions, preview.sessions)}
      </p>

      <div className="picker choice">
        <button className="pick" disabled={busy} onClick={onCancel}>
          Keep this log
        </button>
        <button className="pick drop" disabled={busy} onClick={onImport}>
          {busy ? "Restoring…" : "Replace"}
        </button>
      </div>
    </>
  );
}

/**
 * What the swap costs, in the one number that matters.
 *
 * Only ever states the direction it can be sure of. A file with fewer sessions
 * than the device is the dangerous case and is named plainly; a file with more
 * is the ordinary restore-onto-a-new-phone case and needs no warning. Equal
 * counts say nothing about whether the sessions are the same sessions, so it
 * does not claim they are.
 */
export function loss(onDevice: number, inFile: number): string {
  if (onDevice === 0) return "There is nothing on this device to lose.";
  if (inFile < onDevice) {
    const gone = onDevice - inFile;
    return `This file is smaller than the log on this device — ${gone} ${
      gone === 1 ? "session" : "sessions"
    } fewer. Back this device up first if you are not sure.`;
  }
  return "The log on this device will be replaced by the file.";
}

/** How the app is running, in the words the athlete would use (F1.3). */
export function installLine(state: InstallState): string {
  switch (state) {
    case "installed":
      return "yes — on the home screen";
    case "ios-browser":
      return "no — in a Safari tab";
    case "installable":
      return "no — but this browser can";
    case "browser":
      return "no — in a browser tab";
  }
}

/**
 * Usage against quota (F1.2).
 *
 * The percentage is deliberately absent. A log is a few hundred kilobytes
 * against a quota in the gigabytes, so it rounds to zero and the only thing
 * "0%" communicates is that the number was not worth printing. What is worth
 * knowing is that the log is small — which is the honest reassurance, because
 * it means nothing about this app is what puts it at risk of eviction.
 */
export function usageLine({ usageBytes, quotaBytes }: StorageStatus): string {
  if (usageBytes === null) return "unknown";
  const used = bytes(usageBytes);
  return quotaBytes === null || quotaBytes === 0 ? used : `${used} of ${bytes(quotaBytes)}`;
}

/** Bytes at human scale. Two significant figures is as much as anyone reads. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"] as const;
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
