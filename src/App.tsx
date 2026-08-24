/**
 * The shell (D2).
 *
 * Three things live here and nothing else: the update banner, the storage and
 * connection readout, and which of the three screens is on. Everything the app
 * actually knows is in `useApp`, and everything it says is in `src/screens/`.
 */

import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { BackupScreen } from "./screens/Backup";
import { SessionScreen } from "./screens/Session";
import { SummaryScreen } from "./screens/Summary";
import { TodayScreen } from "./screens/Today";
import { useApp } from "./useApp";

export default function App() {
  const [screen, actions] = useApp();
  const [online, setOnline] = useState(navigator.onLine);
  const [persisted, setPersisted] = useState<boolean | null>(null);

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
        <TodayScreen today={screen.today} plan={screen.plan} actions={actions} />
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
