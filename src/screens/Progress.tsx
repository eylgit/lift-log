/**
 * Progress — the sawtooth (E2).
 *
 * The most motivating screen in the app, and the one with the least in it: a
 * line that goes up, the estimate of what it is worth underneath, and five
 * numbers. No chart library — the whole picture is four SVG elements over a
 * grid `src/progress.ts` has already worked out, which is a smaller thing to
 * carry than a dependency that draws axes nobody asked for.
 *
 * Nothing is drawn against time. A fortnight off is not a fortnight of flat
 * line here; it is simply not a session (§5, and the header of `progress.ts`).
 *
 * What is deliberately *not* marked is every personal best. `chartSeries` flags
 * a session as a best whenever it equalled or beat everything before it, which
 * on a log that is going up is every session — a marker on each is a marker on
 * none. One dot goes on the heaviest, which is what somebody means by "my best".
 */

import { TapChoice } from "../components/TapValue";
import type { ChartPoint, ExerciseId } from "../engine";
import type { Plot, Progress, ProgressStats } from "../progress";
import { PLOT_GUTTER, plot } from "../progress";

/**
 * Above this many sessions the dots merge into the line and stop meaning
 * anything, so the line is left to speak for itself.
 */
const DOTS_BELOW = 40;

export function ProgressScreen({
  progress,
  onChoose,
  onBack,
}: {
  progress: Progress;
  onChoose: (id: ExerciseId) => void;
  onBack: () => void;
}) {
  const { exercise, rotation, points, stats } = progress;
  const names = new Map(rotation.map((e) => [e.id, e.name] as const));
  const drawn = plot(points, stats.bestSessionId);

  return (
    <>
      <div className="row">
        <span className="eyebrow">Progress</span>
        <button className="quiet" onClick={onBack}>
          Back
        </button>
      </div>

      {/* E2.5. The same stepper the Today card switches lifts with, because it
          is the same question — five lifts in a fixed order, stepped around. */}
      <h1 className="lift">
        <TapChoice
          value={exercise.id}
          options={rotation.map((e) => e.id)}
          onChange={onChoose}
          label="the lift"
          format={(id: ExerciseId) => names.get(id) ?? id}
        />
      </h1>
      <p className="change">{caption(stats)}</p>

      {drawn === null ? (
        <p className="notice">
          Nothing to chart yet. This lift gets its first point the day you
          finish a session of it.
        </p>
      ) : (
        <Chart plot={drawn} points={points} />
      )}

      <div className="rule" />

      <div className="kv">
        <span className="k">CURRENT</span>
        <span className="v">{stats.currentKg} kg</span>
      </div>
      <div className="kv">
        <span className="k">BEST</span>
        <span className="v">
          {stats.bestKg === null ? "—" : `${stats.bestKg} kg · ${stats.bestDay}`}
        </span>
      </div>
      <div className="kv">
        <span className="k">EST. 1RM</span>
        <span className="v">{stats.best1RM === null ? "—" : `${stats.best1RM} kg`}</span>
      </div>
      <div className="kv">
        <span className="k">GAIN</span>
        <span className="v">{gain(stats)}</span>
      </div>
      <div className="kv">
        <span className="k">WENT DOWN</span>
        <span className="v">
          {stats.drops === 0 ? "never" : `${stats.drops} ${stats.drops === 1 ? "time" : "times"}`}
        </span>
      </div>

      <div className="grow" />

      <p className="hint">
        The estimate is Epley over the best set of each session, per hand. It is
        an estimate: nobody has tested a single at that weight.
      </p>
    </>
  );
}

/**
 * The picture.
 *
 * Drawn back to front, which is also least to most important: the marks for
 * where the weight came down, then the estimate, then the sawtooth itself, then
 * the one dot on the best session.
 *
 * `vectorEffect="non-scaling-stroke"` keeps every line the same weight however
 * wide the phone is. Without it the strokes scale with the viewBox and the
 * chart looks heavier on a small screen than on a large one — the opposite of
 * what a small screen needs.
 */
function Chart({ plot: p, points }: { plot: Plot; points: readonly ChartPoint[] }) {
  const line = (get: (at: (typeof p.points)[number]) => number) =>
    p.points.map((at) => `${round(at.x)},${round(get(at))}`).join(" ");

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${p.width} ${p.height}`}
        role="img"
        aria-label={label(points)}
      >
        <text className="chart-axis" x={PLOT_GUTTER - 9} y={p.ceilingY + 3} textAnchor="end">
          {p.ceilingKg} kg
        </text>
        <text className="chart-axis" x={PLOT_GUTTER - 9} y={p.floorY + 3} textAnchor="end">
          {p.floorKg} kg
        </text>

        {p.points
          .filter((at) => at.dropped)
          .map((at) => (
            <line
              key={at.sessionId}
              className="chart-drop"
              x1={round(at.x)}
              y1={p.ceilingY - 4}
              x2={round(at.x)}
              y2={p.floorY + 4}
              vectorEffect="non-scaling-stroke"
            />
          ))}

        <polyline
          className="chart-1rm"
          points={line((at) => at.y1RM)}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          className="chart-weight"
          points={line((at) => at.y)}
          vectorEffect="non-scaling-stroke"
        />

        {p.points.length <= DOTS_BELOW &&
          p.points.map((at) => (
            <circle key={at.sessionId} className="chart-dot" cx={round(at.x)} cy={round(at.y)} r="2.4" />
          ))}

        {/* A polyline of one point draws nothing, so the first session's
            estimate would be an axis label with no mark against it. */}
        {p.points.length === 1 && (
          <circle
            className="chart-dot est"
            cx={round(p.points[0]!.x)}
            cy={round(p.points[0]!.y1RM)}
            r="2.4"
          />
        )}

        {p.bestAt !== null && (
          <circle
            className="chart-best"
            cx={round(p.points[p.bestAt]!.x)}
            cy={round(p.points[p.bestAt]!.y)}
            r="4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      <div className="chart-span mono">
        <span>{first?.trainingDay}</span>
        <span className="chart-key">
          <i className="chart-swatch weight" /> lifted
          <i className="chart-swatch est" /> est. 1RM
        </span>
        {/* One session is one date, and printing it at both ends of the axis
            would suggest a span that is not there. */}
        <span>{last?.trainingDay === first?.trainingDay ? "" : last?.trainingDay}</span>
      </div>
    </>
  );
}

/** Two decimals is finer than a hair on any phone, and it keeps the file small. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** What the chart says, for a reader who cannot see it. */
export function label(points: readonly ChartPoint[]): string {
  if (points.length === 0) return "No sessions yet";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    `${points.length} ${points.length === 1 ? "session" : "sessions"}, ` +
    `from ${first.weightKg} kg on ${first.trainingDay} ` +
    `to ${last.weightKg} kg on ${last.trainingDay}`
  );
}

/**
 * The line under the lift's name.
 *
 * Only the count. What the two lines mean is written in the key beneath the
 * chart, where the lines actually are, and saying it twice would push the
 * picture down the screen to make room for a sentence about the picture.
 */
export function caption(stats: ProgressStats): string {
  if (stats.sessions === 0) return "never trained";
  return `${stats.sessions} ${stats.sessions === 1 ? "session" : "sessions"}`;
}

/**
 * The gain, with its sign.
 *
 * A gain of zero is a lift that has not moved rather than a lift with no
 * history, and it is worth saying so plainly instead of printing "0 kg" — the
 * weight is where it started, which is a sentence, not a score.
 */
export function gain(stats: ProgressStats): string {
  if (stats.gainKg === 0) return "still at the start weight";
  const sign = stats.gainKg > 0 ? "+" : "−";
  return `${sign}${Math.abs(stats.gainKg)} kg from ${stats.startKg} kg`;
}
