/**
 * The browser's own install prompt (F2.3).
 *
 * `beforeinstallprompt` has an awkward shape: it fires once, early, usually
 * before React has mounted, and the event object is the only way to trigger the
 * install later. Miss it and there is no way to ask for it again — the browser
 * will not re-fire it on demand. So it is caught at module load, before
 * anything renders, and held here.
 *
 * That makes this the one piece of module-level mutable state in the app, which
 * is worth justifying rather than hiding. It cannot be a hook: the event
 * arrives before any component exists. It cannot be re-read: the browser
 * offers no way to query "would you install this". Holding it is the only
 * implementation there is, and the alternative is not offering the button.
 *
 * None of this exists on iOS, where a page cannot install itself at all — that
 * is what the drawn instructions in `screens/Install.tsx` are for.
 */

/**
 * The event, as the spec has it. It is not in `lib.dom.d.ts` because it has
 * never been standardised — it is a Chromium extension that Edge and Samsung
 * Internet also implement, and Safari and Firefox never will.
 */
type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
};

let held: InstallPromptEvent | null = null;

/**
 * Start listening. Called from `main.tsx`, before the app renders.
 *
 * `preventDefault` stops Chromium's own mini-infobar, which is the right trade
 * here: the app has a screen that explains *why* installing matters for this
 * particular kind of data (§9.2), and a bare browser chip saying "Add Lift Log
 * to Home screen" does not.
 */
export function watchForInstallPrompt(onChange: () => void = () => {}): void {
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    held = event as InstallPromptEvent;
    onChange();
  });

  // Once it is installed the held event is stale — using it would ask the
  // browser to install something it already has.
  addEventListener("appinstalled", () => {
    held = null;
    onChange();
  });
}

/** Whether there is a prompt to fire. */
export function heldPrompt(): boolean {
  return held !== null;
}

/**
 * Fire it, and let it go.
 *
 * The event is single-use whatever the athlete chooses, so it is dropped either
 * way. Declining is not an error and is not reported as one: they were asked,
 * they said no, and the Back up screen still says the app is not installed —
 * which remains true and remains the honest thing on the screen.
 */
export async function promptToInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = held;
  if (event === null) return "unavailable";
  held = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
