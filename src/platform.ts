/**
 * Where the app is running, and whether it has been installed (F1.3, F2).
 *
 * This exists because of one fact in §9.2, and it is the fact that decides
 * whether a year of training survives: **iOS deletes all script-writable
 * storage after seven days without a visit, and a home-screen app is exempt.**
 * Add to Home Screen is therefore not an engagement tactic in this app, it is
 * the data-safety step, and the app has to know whether it has happened before
 * it can say anything honest about how safe the log is.
 *
 * Every function here takes what it needs rather than reading the browser, so
 * the answers can be tested without one — the same reason `today.ts` is handed
 * a date. `readPlatform()` at the foot is the twenty lines that read the real
 * browser, and it is the only part that cannot be tested here.
 *
 * A word on the user-agent sniff, since sniffing is usually a mistake. It is
 * used here for exactly one thing: which *instructions* to draw. There is no
 * feature test for "this browser's storage evaporates in seven days" and no API
 * that reports it; the platform is the only signal there is. Nothing about the
 * app's behaviour branches on it — only the words on one screen.
 */

/** How the app is running, as far as the athlete's data is concerned. */
export type InstallState =
  /**
   * Installed and running from the home screen or as a standalone window.
   * On iOS this is the one that matters: outside Safari's seven-day counter.
   */
  | "installed"
  /**
   * iOS, in a browser tab. The seven-day rule applies and there is no install
   * prompt to offer — Apple gives none, so the app has to draw the Share →
   * Add to Home Screen flow itself (F2.2).
   */
  | "ios-browser"
  /** A browser that has offered us its install prompt. One tap (F2.3). */
  | "installable"
  /** Everywhere else: a browser tab, with no install route we can drive. */
  | "browser";

/**
 * The bits of the browser these answers come from.
 *
 * Passed in as a plain object so `installState` is a decision rather than a
 * reading. `readPlatform` fills it in.
 */
export type PlatformFacts = {
  /** `display-mode: standalone`, or iOS Safari's own `navigator.standalone`. */
  readonly standalone: boolean;
  readonly ios: boolean;
  /** A `beforeinstallprompt` event has been caught and is still usable. */
  readonly promptable: boolean;
};

/**
 * Which of the four situations the app is in.
 *
 * Installed first, and unconditionally: an installed app has nothing to be
 * nudged about, whatever else is true. A held install prompt on an already
 * installed app is a browser being wrong, and believing the display mode over
 * the event is the safer way round.
 */
export function installState(facts: PlatformFacts): InstallState {
  if (facts.standalone) return "installed";
  if (facts.ios) return "ios-browser";
  return facts.promptable ? "installable" : "browser";
}

/**
 * Whether the seven-day rule is hanging over this log (§9.2, threat 2).
 *
 * True only on iOS in a tab. Not "iOS Safari" — every browser on iOS is WebKit
 * underneath and every one of them is subject to the same cap, so singling
 * Safari out would tell a Chrome-on-iPhone user their log was safe when it is
 * not.
 */
export function atRiskOfEviction(state: InstallState): boolean {
  return state === "ios-browser";
}

/* --------------------------------------------------------- reading it out */

/**
 * iOS, including an iPad pretending to be a Mac.
 *
 * iPadOS 13 and later report a desktop Safari user-agent by default, so the
 * string alone says "Macintosh". The touch-point count is what gives it away:
 * no Mac reports more than one, and every iPad reports five. This is the
 * standard workaround and it is ugly, and there is no better one — Apple
 * removed the signal deliberately.
 */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Read the real browser.
 *
 * `navigator.standalone` is Apple's own, predates the display-mode query and is
 * still the only reliable answer on iOS, so both are consulted. `matchMedia`
 * is feature-detected because this also runs under a test environment that has
 * a `window` and not much else.
 */
export function readPlatform(promptable = false): PlatformFacts {
  const nav = navigator as Navigator & { standalone?: boolean };
  const displayMode =
    typeof matchMedia === "function" &&
    (matchMedia("(display-mode: standalone)").matches ||
      matchMedia("(display-mode: fullscreen)").matches ||
      matchMedia("(display-mode: minimal-ui)").matches);

  return {
    standalone: displayMode || nav.standalone === true,
    ios: isIos(nav.userAgent, nav.maxTouchPoints ?? 0),
    promptable,
  };
}
