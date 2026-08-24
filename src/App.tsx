/**
 * The shell (D2).
 *
 * Three things live here and nothing else: the update banner, the storage and
 * connection readout, and which screen is on. Everything the app actually knows
 * is in `useApp`, and everything it says is in `src/screens/`.
 */

import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { InstallState } from "./platform";
import { installState, readPlatform } from "./platform";
import { heldPrompt, watchForInstallPrompt } from "./install";
import { BackfillScreen } from "./screens/Backfill";
import { BackupScreen } from "./screens/Backup";
import { DetailScreen } from "./screens/Detail";
import { HistoryScreen } from "./screens/History";
import { InstallScreen } from "./screens/Install";
import { NudgeScreen } from "./screens/Nudge";
import { ProgressScreen } from "./screens/Progress";
import { SessionScreen } from "./screens/Session";
import { SummaryScreen } from "./screens/Summary";
import { TodayScreen } from "./screens/Today";
import { useApp } from "./useApp";

export default function App() {
  const [screen, actions] = useApp();
  const [online, setOnline] = useState(navigator.onLine);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [install, setInstall] = useState<InstallState>(() =>
    installState(readPlatform(heldPrompt())),
  );

  // The one update rule: never swap code out from under a session.
  // registerType is "prompt", so the new version waits for an explicit tap —
  // and mid-session it is not even offered, because the tap reloads the page.
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const inSession = screen.name === "session";

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    // Ask the browser to keep our data through storage pressure. It may say no.
    navigator.storage?.persist?.().then(setPersisted).catch(() => setPersisted(false));
  }, []);

  useEffect(() => {
    // `main.tsx` starts listening before React exists, because the event fires
    // before React exists. This second call is what tells the app when one
    // arrives late, or when the app is installed while it is open (F2.3).
    watchForInstallPrompt(() => setInstall(installState(readPlatform(heldPrompt()))));
  }, []);

  return (
    <div className="app">
      {needRefresh && !inSession && (
        <div className="banner">
          <span>A new version of Lift Log is ready.</span>
          <span className="spacer" />
          <button onClick={() => void updateServiceWorker(true)}>Reload</button>
        </div>
      )}

      {/* The three screens each end with their own `grow`, which is what pins the
          status line to the bottom. These two are not screens and need their own. */}
      {screen.name === "loading" && (
        <>
          <p className="notice">Reading your log…</p>
          <div className="grow" />
        </>
      )}

      {screen.name === "failed" && (
        <p className="notice">
          Lift Log could not reach its database, so it does not know what you are lifting today.
          Nothing you have already logged has been lost — reload, and if that does not help, check
          whether this browser is in a private window.
          <span className="detail">{screen.error.message}</span>
        </p>
      )}
      {screen.name === "failed" && <div className="grow" />}

      {screen.name === "today" && (
        <TodayScreen
          today={screen.today}
          plan={screen.plan}
          install={install}
          actions={actions}
        />
      )}

      {screen.name === "session" && (
        <SessionScreen
          view={screen.view}
          restTargetS={screen.restTargetS}
          sideOverride={screen.sideOverride}
          actions={actions}
        />
      )}

      {screen.name === "backup" && (
        <BackupScreen
          state={screen.state}
          onDownload={actions.download}
          onPick={actions.pickImport}
          onImport={actions.runImport}
          onCancelImport={actions.cancelImport}
          onInstall={actions.openInstall}
          onBack={actions.dismiss}
        />
      )}

      {screen.name === "install" && (
        <InstallScreen
          state={screen.state}
          onInstall={actions.install}
          onBack={actions.openBackup}
        />
      )}

      {/* F3.2 — the one screen that interrupts. It is shown instead of Today on
          open, never over a session, and "Not now" is a real way past it. */}
      {screen.name === "nudge" && (
        <NudgeScreen
          status={screen.status}
          busy={screen.busy}
          onBackUp={() => actions.download("json")}
          onDismiss={actions.dismissNudge}
        />
      )}

      {screen.name === "history" && (
        <HistoryScreen
          heat={screen.history.heat}
          log={screen.history.log}
          onOpen={actions.openDetail}
          onAdd={actions.openBackfill}
          onBack={actions.dismiss}
        />
      )}

      {screen.name === "backfill" && (
        <BackfillScreen
          setup={screen.setup}
          onSave={actions.saveBackfill}
          onBack={actions.openHistory}
        />
      )}

      {/* Back goes to the list it was opened from, not to Today — and it goes
          by re-reading, so a session deleted here is gone from the list that
          comes back (E1.3). */}
      {screen.name === "detail" && (
        <DetailScreen
          detail={screen.detail}
          onDelete={actions.deleteSession}
          onBack={actions.openHistory}
        />
      )}

      {screen.name === "progress" && (
        <ProgressScreen
          progress={screen.progress}
          onChoose={actions.openProgress}
          onBack={actions.dismiss}
        />
      )}

      {screen.name === "summary" && (
        <SummaryScreen view={screen.view} outcome={screen.outcome} onDismiss={actions.dismiss} />
      )}

      <div className="status">
        <span className={online ? "dot" : "dot off"} />
        <span>{online ? "online" : "offline — everything still works"}</span>
        <span>·</span>
        <span>
          storage{" "}
          {persisted === null ? "checking…" : persisted ? "persistent" : "best effort"}
        </span>
      </div>
    </div>
  );
}
