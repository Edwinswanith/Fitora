// Small statistics for the Progress tab. Kept out of the screen so they can
// be unit tested: a day with no check-in is *missing*, never zero (treating
// it as 0 once dragged averages down, produced "+76 pts" readiness jumps and
// flagged engaged athletes as "Needs attention").

/** Only real numbers; null/undefined/NaN (a day with no entry) are dropped. */
export function finiteValues(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function average(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function latestValue(values: readonly number[]): number | null {
  return values.length ? values[values.length - 1] : null;
}

/**
 * Change between the earlier and the recent half of a period, in the
 * values' own units (e.g. readiness points). Averages each half so one good
 * or bad morning can't swing it; needs at least `minPerHalf` entries in each
 * half, otherwise there's no trend to report.
 */
export function halvesDelta(values: readonly number[], minPerHalf = 2): number | null {
  if (values.length < minPerHalf * 2) return null;
  const midpoint = Math.floor(values.length / 2);
  const earlier = average(values.slice(0, midpoint));
  const recent = average(values.slice(midpoint));
  if (earlier == null || recent == null) return null;
  return Math.round(recent - earlier);
}

/** Same comparison as a percentage of the earlier half (e.g. training load). */
export function halvesPercentDelta(values: readonly number[], minPerHalf = 2): number | null {
  if (values.length < minPerHalf * 2) return null;
  const midpoint = Math.floor(values.length / 2);
  const earlier = average(values.slice(0, midpoint));
  const recent = average(values.slice(midpoint));
  if (!earlier || recent == null) return null;
  return Math.round(((recent - earlier) / earlier) * 100);
}
