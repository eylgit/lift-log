/**
 * Settings (G3).
 *
 * G3.2 is the whole design of this screen: **resist adding settings**. Every
 * one is a decision handed back to the athlete, which is precisely the thing
 * the app exists to remove (§14.7), so what is here is the shortest list that
 * does the job — the two numbers the engine reads, the door to the backup file,
 * the credit, and the way out.
 *
 * Nothing that is tap-editable elsewhere is duplicated here as a control. Rest
 * is the exception and it earns it: it is the one value that lives in settings
 * rather than in the log, and somebody looking for it will look here first.
 *
 * What is deliberately absent: a theme (INV-8), a units toggle until the app
 * can actually convert one (INV-1 — see the note in the build plan at G3.1), a
 * per-exercise increment (B2.1), and a stall threshold. The last is the most
 * tempting and the most wrong: three stalls before a deload is a rule the whole
 * engine is reasoned around (B5.3), and handing it over would turn a method into
 * a preference.
 */

import { TapNumber } from "../components/TapValue";

/** What the screen needs, all of it already in the database. */
export type SettingsView = {
  readonly stepKg: number;
  readonly restTargetS: number;
  readonly sessions: number;
  readonly lastExportedAt: string | null;
  /** The confirm for the one destructive button is up (G3.1). */
  readonly erasing: boolean;
  /** A write is in flight. */
  readonly busy: boolean;
};

/** Trailing zeros trimmed: 2.5 stays, 1 is not 1.00. */
function kg(value: number): string {
  return `${Number(value.toFixed(2))} kg`;
}

export function SettingsScreen({
  view,
  onStep,
  onRest,
  onBackup,
  onErase,
  onBack,
}: {
  view: SettingsView;
  onStep: (stepKg: number) => void;
  onRest: (seconds: number) => void;
  onBackup: () => void;
  onErase: (step: "ask" | "no" | "yes") => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="row">
        <span className="eyebrow">Settings</span>
        <button className="quiet" onClick={onBack}>
          Back
        </button>
      </div>

      <h1 className="lift">Settings</h1>

      <p className="prompt">
        Two numbers, your log, and a way to start over. Everything else the app
        decides for you, which is the reason it is worth using.
      </p>

      <div className="rule" />

      {/* The one number the engine reads about the athlete's equipment (B2.2). */}
      <div className="kv">
        <span className="k">STEP</span>
        <span className="v">
          <TapNumber
            value={view.stepKg}
            onChange={onStep}
            step={0.25}
            min={0.25}
            label="the step"
            format={kg}
          />
        </span>
      </div>
      <p className="footnote flush">
        What you add after a session where you hit every rep. Changing it moves
        the next weight, not the ones already in your log.
      </p>

      <div className="kv">
        <span className="k">REST</span>
        <span className="v">
          <TapNumber
            value={Math.round(view.restTargetS / 60)}
            onChange={(minutes) => onRest(minutes * 60)}
            step={1}
            min={1}
            label="rest between sets"
            format={(minutes) => `${minutes} min between sets`}
          />
        </span>
      </div>

      <div className="kv">
        <span className="k">YOUR LOG</span>
        <span className="v">
          <button className="tap" onClick={onBackup}>
            {view.sessions === 1 ? "1 session" : `${view.sessions} sessions`} — back up or
            restore
          </button>
        </span>
      </div>

      <div className="kv">
        <span className="k">LAST BACKUP</span>
        <span className="v">
          {view.lastExportedAt === null ? "never" : view.lastExportedAt.slice(0, 10)}
        </span>
      </div>

      <div className="rule" />

      <About />

      <div className="grow" />

      {/* G3.1 — reset. The only button in the app that throws the log away. */}
      {view.erasing ? (
        <div className="erase">
          <p className="sample-ask">
            This deletes every session, every set and your setup, from this
            device, permanently. If you have not downloaded a backup, there is
            no way back.
          </p>
          <div className="sample-buttons">
            <button className="quiet" onClick={() => onErase("no")}>
              Keep my log
            </button>
            <button className="sample-go" disabled={view.busy} onClick={() => onErase("yes")}>
              {view.busy ? "Erasing…" : "Erase everything"}
            </button>
          </div>
        </div>
      ) : (
        <button className="missed" onClick={() => onErase("ask")}>
          Erase everything and start over
        </button>
      )}
    </>
  );
}

/**
 * G3.3 — the credit and the disclaimer.
 *
 * The method is not this app's idea and the app says so, by name and with a
 * link, on a screen somebody will actually reach. §16 asks for exactly that.
 *
 * The disclaimer is short because a long one is not read and neither version is
 * legal advice. It says the true thing: this is software that suggests a number
 * and it knows nothing about the person holding the dumbbell.
 */
function About() {
  return (
    <>
      <p className="aside">
        The method is Scott Chen's — one lift a day, one limb at a time, add the
        smallest jump you can when every rep goes up. Lift Log is only a way of
        keeping score. His writing is at{" "}
        <a href="https://onelift.org" target="_blank" rel="noreferrer noopener">
          onelift.org
        </a>
        .
      </p>

      <p className="footnote flush">
        Lift Log is not medical advice and cannot see you lift. It suggests a
        weight from what you logged last time; whether that weight is safe today
        is your judgement. If something hurts, stop.
      </p>
    </>
  );
}
