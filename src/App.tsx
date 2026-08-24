import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { trainingDay } from "./clock";
import type { LastResult, Today, WeightChange } from "./today";
import { useToday } from "./useToday";

export default function App() {
  const view = useToday();
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

      {/* Disabled until D2 gives it somewhere to go. A button that responds to
          a tap by doing nothing is worse than one that says it is not ready. */}
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
 * The card itself — every number on it derived, none of it hardcoded (D1.2).
 *
 * The wording lives here and nowhere else. `today.ts` hands over shapes and
 * numbers, this turns them into English, and the two can be changed
 * independently: a rewritten sentence breaks no test, and a changed rule breaks
 * no layout.
 */
function Card({ today }: { today: Today }) {
  const { prescription: rx, dayIndex, rotationLength, last, change } = today;

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
      <p className="change">{changeLine(change, last)}</p>
      <div className="scheme">
        {rx.repsPerSide} reps per side × {rx.sets} sets
      </div>

      <div className="rule" />

      <div className="kv">
        <span className="k">REST</span>
        <span className="v">{rx.restMinutes} min between sets</span>
      </div>
      <div className="kv">
        <span className="k">LAST TIME</span>
        <span className="v">{lastLine(last)}</span>
      </div>
      <div className="kv">
        <span className="k">TRAINING DAY</span>
        <span className="v">{trainingDay()}</span>
      </div>
    </>
  );
}

/**
 * Why the weight is what it is.
 *
 * The direction comes from the subtraction; the reason comes from what happened
 * last time. Neither restates the progression rule, which is what keeps this
 * from being able to contradict the number above it.
 *
 * A drop is not explained by counting stalls, tempting though it is. The count
 * resets the moment the deload lands, so the card would be asserting a number
 * it cannot read — and by D5 a weight can also come down because the athlete
 * typed it. "Back off and climb again" is true either way.
 */
function changeLine(change: WeightChange, last: LastResult | null): string {
  if (change.kind === "first") {
    return "your start weight — lighter than feels right is the right amount";
  }

  const direction =
    change.kind === "same"
      ? "same again"
      : change.kind === "down"
        ? `down from ${change.fromKg} kg`
        : change.oneStep
          ? `one step up from ${change.fromKg} kg`
          : `up ${change.byKg} kg from ${change.fromKg} kg`;

  return `${direction}${because(change, last)}`;
}

/**
 * The half-sentence after the dash, or nothing at all.
 *
 * A clean session needs no explanation — the weight went up, which is what
 * clean sessions do. The other two do: "same again" with no reason reads like
 * the app forgot to progress, and a drop with no reason reads like a bug.
 *
 * A walked-out session is called out whichever way the weight moved, because it
 * is the one case where today's number has nothing to do with what was on the
 * dumbbell last time. The engine learns nothing from a session nobody finished
 * (B5.7), so the weight is wherever the last *finished* session left it.
 */
function because(change: WeightChange, last: LastResult | null): string {
  if (last === null || last.outcome === "clean") return "";
  if (last.outcome === "walked out") return " — last session was walked out";
  return change.kind === "down" ? " — back off and climb again" : " — last time was short";
}

/**
 * Last session's result, as a fact and not a nag.
 *
 * The date is shown and the *gap* is not. "Three days ago" is one short step
 * from "you have missed two sessions", and the rotation is a position pointer
 * rather than a calendar — skipping a week costs nothing and the card must not
 * imply otherwise (INV-6).
 */
function lastLine(last: LastResult | null): string {
  if (last === null) return "never trained";
  const what =
    last.outcome === "short"
      ? `${last.repsShort} ${last.repsShort === 1 ? "rep" : "reps"} short`
      : last.outcome;
  return `${last.trainingDay} · ${last.weightKg} kg · ${what}`;
}
