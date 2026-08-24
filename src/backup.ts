/**
 * Getting a file out of the app and onto something that is not this phone (F1).
 *
 * `src/db/transfer.ts` already produces the bytes and has done since C4 — that
 * was deliberate, so that the day a backup is needed is not the day it gets
 * written. What was missing was a way for a human to press a button, which is
 * this file plus one screen.
 *
 * Handing a file to the athlete is the one part of the whole data story that is
 * genuinely platform-dependent, and iOS is why. A home-screen PWA on iOS has no
 * visible filesystem, no downloads bar and no obvious place for a file to land,
 * so the honest answer there is the share sheet: it puts the file in Files, or
 * iCloud, or an email to yourself — which is a *better* backup than a download,
 * because it leaves the device. Everywhere else, a download is what people
 * expect and it is what they get.
 *
 * The distinction that matters to F3 is whether the file actually reached the
 * athlete. `exportJson` deliberately does not stamp `lastExportedAt` for exactly
 * this reason, and `saveFile` throws rather than returning quietly when the
 * share sheet is dismissed — a backup nobody kept is not a backup.
 */

import { localDay } from "./clock";

export type Format = "json" | "csv";

/** How the file left the app, so the screen can say something true about it. */
export type Saved = "shared" | "downloaded";

const MIME: Record<Format, string> = {
  json: "application/json",
  csv: "text/csv",
};

/**
 * `lift-log-2026-08-24.json`.
 *
 * Dated, because the second thing anyone does with backups is accumulate
 * several and need to tell them apart. Local date rather than the training day:
 * a file saved at half past midnight belongs to the day the phone says it is.
 */
export function backupFileName(format: Format, now: Date = new Date()): string {
  return `lift-log-${localDay(now)}.${format}`;
}

/**
 * Put the file somewhere the athlete can find it.
 *
 * Two paths, and the share sheet is tried first wherever it exists, because on
 * the platform where it matters most it is the only one that works properly.
 *
 * Cancelling the share sheet throws `AbortError`, and that is passed straight
 * through rather than swallowed. The caller has to know: a cancelled save must
 * not be recorded as a backup, and the screen must not say "saved".
 */
export async function saveFile(
  contents: string,
  format: Format,
  now: Date = new Date(),
): Promise<Saved> {
  const name = backupFileName(format, now);
  const type = MIME[format];
  const file = new File([contents], name, { type });

  // `canShare` with the actual file, not just a feature check: desktop Chrome
  // has `navigator.share` and refuses files, and asking is the only way to tell.
  if (navigator.canShare?.({ files: [file] }) === true) {
    await navigator.share({ files: [file], title: name });
    return "shared";
  }

  const url = URL.createObjectURL(new Blob([contents], { type }));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    // Firefox needs the element in the document for a programmatic click to
    // count; the others do not care.
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Not immediately: revoking before the browser has read the blob cancels
    // the download in Safari. A minute is far longer than any save needs and
    // the object is a few hundred kilobytes at worst.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Optimistic, and the only honest option: a download started this way reports
  // nothing back. If the athlete cancels the save dialog, the app will believe
  // a backup happened. That is the right way round to be wrong — a nudge that
  // fires a fortnight late is a smaller failure than one that never fires.
  return "downloaded";
}
