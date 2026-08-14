// Turns a raw value series into a plain-language trend a non-technical user can
// read at a glance ("Improving", "Declining", "Steady"). Mirror of the web app's
// components/charts/trendStats.ts so mobile trend panels read identically.

export type TrendDir = "improving" | "declining" | "steady";

export type TrendSummary = {
  current: number; // smoothed latest value
  baseline: number; // smoothed earliest value in the window
  deltaAbs: number; // current - baseline (in the metric's own units)
  deltaPct: number | null; // fractional change vs baseline; null if baseline is 0
  dir: TrendDir; // good/bad/steady — already accounts for lowerIsBetter
  rose: boolean | null; // did the raw value go up? null when steady
};

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Compare the average of the most recent points against the earliest points
 * (smooths day-to-day noise). `lowerIsBetter` flips the good/bad reading for
 * metrics where down is good — sprint times, stress, etc. `deadbandPct` is the
 * dead zone below which we say "steady" instead of flip-flopping on tiny moves.
 */
export function summarizeTrend(
  values: (number | null)[],
  opts: { lowerIsBetter?: boolean; sample?: number; deadbandPct?: number } = {}
): TrendSummary | null {
  const { lowerIsBetter = false, sample = 3, deadbandPct = 0.04 } = opts;
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length === 0) return null;

  const head = valid.slice(0, Math.min(sample, valid.length));
  const tail = valid.slice(Math.max(0, valid.length - sample));
  const baseline = avg(head);
  const current = avg(tail);
  const deltaAbs = current - baseline;
  const deltaPct = baseline !== 0 ? deltaAbs / Math.abs(baseline) : null;

  const scale = Math.max(Math.abs(baseline), Math.abs(current), 1);
  const steady = Math.abs(deltaAbs) / scale < deadbandPct;

  let dir: TrendDir;
  if (steady) dir = "steady";
  else {
    const rose = deltaAbs > 0;
    const good = lowerIsBetter ? !rose : rose;
    dir = good ? "improving" : "declining";
  }

  return { current, baseline, deltaAbs, deltaPct, dir, rose: steady ? null : deltaAbs > 0 };
}

/** Round for display: ints for whole-ish numbers, 1 dp for small/decimal ones. */
export function fmtValue(v: number, unit?: string): string {
  const rounded = Math.abs(v) >= 10 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10;
  return unit ? `${rounded}${unit}` : `${rounded}`;
}

/** "6%" or, when a baseline of 0 makes percent meaningless, the absolute delta. */
export function fmtMagnitude(s: TrendSummary, unit?: string): string {
  if (s.deltaPct !== null && Math.abs(s.deltaPct) >= 0.005) {
    return `${Math.round(Math.abs(s.deltaPct) * 100)}%`;
  }
  return fmtValue(Math.abs(s.deltaAbs), unit);
}

/** Pull one metric's column out of a series array (preserving null gaps). */
export function column<T extends Record<string, unknown>>(series: T[], key: keyof T): (number | null)[] {
  return series.map((p) => {
    const v = p[key];
    return typeof v === "number" ? v : null;
  });
}

/** Latest non-null value in a column, or null. */
export function latestVal(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}
