import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { ROTATION, SCHEME, trainingDay } from "./plan";

/** Day of the rotation. M1 replaces this with a pointer read from the log. */
const DAY_INDEX = 2;

export default function App() {
  const lift = ROTATION[DAY_INDEX]!;
  const [online, setOnline] = useState(navigator.onLine);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  // The one update rule: never swap code out from under a session.
  // registerType is "prompt", so the new version waits for an explicit tap.
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

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
      {needRefresh && (
        <div className="banner">
          <span>A new version of Lift Log is ready.</span>
          <span className="spacer" />
          <button onClick={() => void updateServiceWorker(true)}>Reload</button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="eyebrow">Day {DAY_INDEX + 1} of {ROTATION.length}</span>
        <span className="rotation">
          {ROTATION.map((e, i) => (
            <i key={e.id} className={i === DAY_INDEX ? "on" : undefined} />
          ))}
        </span>
      </div>

      <h1 className="lift">{lift.name}</h1>
      <div className="eyebrow" style={{ marginTop: 9 }}>
        {lift.pattern} · {lift.weakSide} side first
      </div>

      <div className="load">
        <span className="kg">{lift.weightKg}</span>
        <span className="unit">kg</span>
      </div>
      <div className="scheme">
        {SCHEME.repsPerSide} reps per side × {SCHEME.sets} sets
      </div>

      <div className="rule" />

      <div className="kv">
        <span className="k">REST</span>
        <span className="v">{SCHEME.restMinutes} min between sets</span>
      </div>
      <div className="kv">
        <span className="k">TRAINING DAY</span>
        <span className="v">{trainingDay()}</span>
      </div>

      <div className="grow" />

      <button className="start" disabled>
        <svg width="17" height="17" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <polygon points="4,2.5 15,9 4,15.5" />
        </svg>
        Start
      </button>
      <p className="footnote">The session runner lands in M2.</p>

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
