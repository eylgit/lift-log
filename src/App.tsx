import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { trainingDay } from "./clock";
import type { Today } from "./today";
import { useToday } from "./useToday";

/**
 * Day of the rotation.
 *
 * Still a constant, and the last thing on this card that is. D1.3 replaces it
 * with a pointer counted off the log — position, not date, so a missed day is
 * simply a day and the next lift is still the next lift (INV-6).
 */
const DAY_INDEX = 2;

export default function App() {
  const view = useToday(DAY_INDEX);
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

      {view.status === "loading" && <p className="notice">Reading your log…</p>}
      {view.status === "failed" && (
        <p className="notice">
          Lift Log could not open its database, so it does not know what you are lifting today.
          Nothing has been lost — reload, and if that does not help, check whether this browser is
          in a private window.
          <span className="detail">{view.error.message}</span>
        </p>
      )}
      {view.status === "ready" && <Card today={view.today} />}

      <div className="grow" />

      <button className="start" disabled>
        <svg width="17" height="17" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
          <polygon points="4,2.5 15,9 4,15.5" />
        </svg>
        Start
      </button>
      <p className="footnote">The session runner lands in D2.</p>

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

/**
 * The card itself — every number on it derived, none of it hardcoded.
 *
 * The weight is the engine's answer for this lift given everything in the log,
 * which on a fresh install is the start weight and nothing else. D1.2 fills the
 * card out; this is the same card as before with the placeholder rotation
 * pulled out from under it.
 */
function Card({ today }: { today: Today }) {
  const { prescription: rx, dayIndex, rotationLength } = today;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="eyebrow">Day {dayIndex + 1} of {rotationLength}</span>
        <span className="rotation">
          {Array.from({ length: rotationLength }, (_, i) => (
            <i key={i} className={i === dayIndex ? "on" : undefined} />
          ))}
        </span>
      </div>

      <h1 className="lift">{rx.exercise.name}</h1>
      <div className="eyebrow" style={{ marginTop: 9 }}>
        {rx.exercise.pattern} · {rx.weakSide} side first
      </div>

      <div className="load">
        <span className="kg">{rx.weightKg}</span>
        <span className="unit">kg</span>
      </div>
      <div className="scheme">
        {rx.repsPerSide} reps per side × {rx.sets} sets
      </div>

      <div className="rule" />

      <div className="kv">
        <span className="k">REST</span>
        <span className="v">{rx.restMinutes} min between sets</span>
      </div>
      <div className="kv">
        <span className="k">TRAINING DAY</span>
        <span className="v">{trainingDay()}</span>
      </div>
    </>
  );
}
