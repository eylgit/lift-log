/**
 * The simulation, drawn (B7.3).
 *
 * Hand-written SVG, no dependencies, in the Blueprint palette — the same
 * choice the app makes for its own charts (E2.1). The output is a static file
 * that can be dropped into the README, so there is no interactivity here and
 * no need for any: it has one job, which is to make the sawtooth obvious to
 * someone giving the repository ninety seconds.
 *
 * Two lines per lift. The dashed one is what the simulated athlete *could*
 * lift on that day — the fixed curve in `lifter.ts`, which the engine cannot
 * see. The solid one is what the engine actually asked for. Watching the solid
 * line climb past the dashed one, stall, drop back and climb again is the
 * method working, and it is the only explanation of it worth pasting into a
 * repository.
 */

const WIDTH = 900;
const PANEL_HEIGHT = 104;
const PANEL_GAP = 16;
const MARGIN = { top: 92, right: 20, bottom: 46, left: 58 };

const C = {
  bg: "#EDF1F6",
  surface: "#FFFFFF",
  line: "#D2DAE5",
  ink: "#131C27",
  ink2: "#4E5C6C",
  ink3: "#7B8897",
  accent: "#17539B",
  warn: "#8A5A08",
} as const;

const SANS = "Bricolage Grotesque, Helvetica Neue, Arial, sans-serif";
const MONO = "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace";

export type ChartPanel = {
  readonly name: string;
  /** One point per session: the day it happened, and what was on the dumbbell. */
  readonly points: readonly { readonly day: number; readonly weightKg: number }[];
  /** Day indices where the engine dropped the weight after three stalls. */
  readonly deloadDays: readonly number[];
  /** The lifter's true capacity, one sample per day. */
  readonly capacityKg: readonly number[];
};

/** Trim trailing zeros: 32.5 stays, 30.0 becomes 30. */
function kg(value: number): string {
  return `${Number(value.toFixed(1))}`;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** First day of each month, as a day index into a 365-day year starting 1 Jan. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthStarts(): { label: string; day: number }[] {
  const out: { label: string; day: number }[] = [];
  let day = 0;
  MONTHS.forEach((label, i) => {
    out.push({ label, day });
    day += MONTH_LENGTHS[i]!;
  });
  return out;
}

export function renderSimulationSvg(
  panels: readonly ChartPanel[],
  meta: { readonly days: number; readonly stepKg: number; readonly sessions: number },
): string {
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const height =
    MARGIN.top + panels.length * PANEL_HEIGHT + (panels.length - 1) * PANEL_GAP + MARGIN.bottom;
  const x = (day: number) => MARGIN.left + (day / (meta.days - 1)) * plotWidth;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="One simulated year of Lift Log: five lifts, each a rising sawtooth of working weight against the lifter's true capacity.">`,
    `<rect width="${WIDTH}" height="${height}" fill="${C.bg}"/>`,
  );

  /* ------------------------------------------------------------- heading */

  parts.push(
    `<text x="${MARGIN.left}" y="40" font-family="${SANS}" font-size="21" font-weight="700" fill="${C.ink}">One simulated year</text>`,
    `<text x="${MARGIN.left}" y="60" font-family="${SANS}" font-size="12.5" fill="${C.ink2}">${meta.sessions} sessions through the real engine · ${kg(meta.stepKg)} kg step · one lift a day, five-day rotation</text>`,
  );

  // Legend, right-aligned with the plot.
  const legend = [
    { label: "what the engine asked for", swatch: `<line x1="0" y1="0" x2="18" y2="0" stroke="${C.accent}" stroke-width="2"/>` },
    { label: "what the lifter could do", swatch: `<line x1="0" y1="0" x2="18" y2="0" stroke="${C.ink3}" stroke-width="1.4" stroke-dasharray="3 3"/>` },
    { label: "deload", swatch: `<circle cx="9" cy="0" r="3.2" fill="${C.warn}"/>` },
  ];
  let legendX = MARGIN.left;
  const legendY = 76;
  for (const item of legend) {
    parts.push(
      `<g transform="translate(${legendX} ${legendY})">${item.swatch}</g>`,
      `<text x="${legendX + 24}" y="${legendY + 4}" font-family="${SANS}" font-size="11.5" fill="${C.ink2}">${esc(item.label)}</text>`,
    );
    legendX += 24 + item.label.length * 6.1 + 22;
  }

  /* -------------------------------------------------------------- panels */

  panels.forEach((panel, index) => {
    const top = MARGIN.top + index * (PANEL_HEIGHT + PANEL_GAP);
    const bottom = top + PANEL_HEIGHT;

    const weights = panel.points.map((p) => p.weightKg);
    const lo = Math.min(...weights, ...panel.capacityKg) - 1.5;
    const hi = Math.max(...weights, ...panel.capacityKg) + 1.5;
    const y = (value: number) => bottom - ((value - lo) / (hi - lo)) * PANEL_HEIGHT;

    parts.push(
      `<rect x="${MARGIN.left}" y="${top}" width="${plotWidth}" height="${PANEL_HEIGHT}" fill="${C.surface}" stroke="${C.line}"/>`,
    );

    // Month gridlines, so a plateau can be read as "three weeks stuck".
    for (const month of monthStarts()) {
      if (month.day === 0) continue;
      parts.push(
        `<line x1="${x(month.day).toFixed(1)}" y1="${top}" x2="${x(month.day).toFixed(1)}" y2="${bottom}" stroke="${C.line}" stroke-width="0.7"/>`,
      );
    }

    // The two y labels worth having: where the lift started, where it ended.
    const first = panel.points[0]!;
    const last = panel.points[panel.points.length - 1]!;
    for (const value of [first.weightKg, last.weightKg]) {
      parts.push(
        `<text x="${MARGIN.left - 8}" y="${(y(value) + 3.5).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${C.ink3}">${kg(value)}</text>`,
      );
    }

    const capacity = panel.capacityKg
      .map((value, day) => `${x(day).toFixed(1)},${y(value).toFixed(1)}`)
      .join(" ");
    parts.push(
      `<polyline points="${capacity}" fill="none" stroke="${C.ink3}" stroke-width="1.4" stroke-dasharray="3 3"/>`,
    );

    const sawtooth = panel.points
      .map((p) => `${x(p.day).toFixed(1)},${y(p.weightKg).toFixed(1)}`)
      .join(" ");
    parts.push(
      `<polyline points="${sawtooth}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    );

    const byDay = new Map(panel.points.map((p) => [p.day, p.weightKg]));
    for (const day of panel.deloadDays) {
      const value = byDay.get(day);
      if (value === undefined) continue;
      parts.push(
        `<circle cx="${x(day).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3.2" fill="${C.warn}"/>`,
      );
    }

    parts.push(
      `<text x="${MARGIN.left + 10}" y="${top + 17}" font-family="${SANS}" font-size="12.5" font-weight="700" fill="${C.ink}">${esc(panel.name)}</text>`,
      `<text x="${MARGIN.left + plotWidth - 10}" y="${top + 17}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${C.accent}">${kg(first.weightKg)} → ${kg(last.weightKg)} kg</text>`,
    );
  });

  /* -------------------------------------------------------------- x axis */

  const axisY = MARGIN.top + panels.length * PANEL_HEIGHT + (panels.length - 1) * PANEL_GAP;
  for (const month of monthStarts()) {
    parts.push(
      `<text x="${x(month.day).toFixed(1)}" y="${axisY + 18}" text-anchor="middle" font-family="${MONO}" font-size="9.5" fill="${C.ink3}">${month.label}</text>`,
    );
  }
  parts.push(
    `<text x="${MARGIN.left}" y="${axisY + 36}" font-family="${SANS}" font-size="11" fill="${C.ink3}">Every drop is the engine backing off after three stalled sessions. The gap in May is a ten-day holiday — no debt, no catch-up.</text>`,
  );

  parts.push("</svg>");
  return `${parts.join("\n")}\n`;
}
