/**
 * Pure text classification for the athlete Ask Agent's "report"-style queries
 * (no React/Expo imports, so this can be unit tested outside a device/RN environment).
 *
 * The goal is precision: a query like "which day did I perform worst" must not
 * fall through to a generic weekly-report bucket just because it shares a
 * stray keyword ("data", "week") with that bucket's trigger words.
 */

export type ReportDirection = "worst" | "best" | "average";
/** "day worst/best/average" ranking only supports the card-backed metrics (see dashboard.tsx's DAY_EXTREMUM_METRICS). */
export type ReportMetric = "readiness" | "sleep" | "recovery" | "soreness" | "training" | "heartRate";
/** A plain metric report (average/trend, not a ranking) additionally covers metrics with no single-day "worst/best" framing. */
export type ReportSubject = ReportMetric | "water" | "mood" | "stress" | "fatigue";
export type ReportMode = "weekly" | "improve" | "down";

export type ReportIntent =
  | { kind: "day_extremum"; direction: ReportDirection; metric: ReportMetric; days: number }
  | { kind: "metric_report"; subject: ReportSubject; days: number }
  | { kind: "list_training_history"; days: number }
  | { kind: "progress_advice"; days: number }
  | { kind: "report"; days: number; mode: ReportMode }
  | { kind: "none" };

export function requestedHistoryDays(text: string, fallback = 7): number {
  const lower = text.toLowerCase();
  const explicit = lower.match(/\b(?:last|past|previous|recent)\s+(\d{1,2})\s+days?\b/);
  if (explicit) return Math.max(1, Math.min(30, Number(explicit[1])));
  if (/\b30\s*days?\b|\bmonth(?:ly)?\b/.test(lower)) return 30;
  if (/\bweek(?:ly)?\b|\b7\s*days?\b/.test(lower)) return 7;
  return fallback;
}

/**
 * STT frequently mishears "week" as "weak" (e.g. "in last weak"). Left
 * unnormalized, that "weak" collides with the real word "weak" used to mean
 * "underperforming" and misroutes the query into the trending-down report.
 * Only the exact "<qualifier> weak" time-period pattern is rewritten, so a
 * genuine "areas are weak this week" still keeps its "weak" signal.
 */
function normalizeWeekTypos(lower: string): string {
  return lower.replace(
    /\b(last|this|past|previous|next)\s+weak(s)?\b/g,
    (_match, qualifier: string, plural: string | undefined) => `${qualifier} week${plural ?? ""}`
  );
}

const WORST_WORDS = /\b(worst|worse|waste|lowest|poorest)\b/;
const AVERAGE_WORDS = /\b(average|avarage|typical|normal|usual|median)\b/;
const EXTREMUM_WORDS = /\b(worst|worse|waste|lowest|poorest|best|highest|top|average|avarage|typical|normal|usual|median)\b/;
const TRAINING_SUBJECT_WORDS = /\b(training|workout|workouts|session|sessions|practice)\b/;
const HEART_RATE_WORDS = /\bheart\s*rate|heart\s*beat|heartbeat|pulse|bpm\b/;
const WATER_WORDS = /\bwater|hydrat|drink(?:ing)?\b/;

/** Worst-family wins over best-family when both appear — STT often mishears "based on" as "best on". */
function reportDirectionFromQuery(lower: string): ReportDirection {
  if (WORST_WORDS.test(lower)) return "worst";
  if (AVERAGE_WORDS.test(lower)) return "average";
  return "best";
}

/** Metrics with a per-day card value, so "which day was worst/best" can rank them. */
function reportMetricFromQuery(lower: string): ReportMetric {
  if (HEART_RATE_WORDS.test(lower)) return "heartRate";
  if (/\bsleep\b/.test(lower)) return "sleep";
  if (/\brecovery\b/.test(lower)) return "recovery";
  if (/\bsoreness|sore\b/.test(lower)) return "soreness";
  if (TRAINING_SUBJECT_WORDS.test(lower) || /\bload\b/.test(lower)) return "training";
  return "readiness";
}

/**
 * Metrics a plain (non-ranking) report can be generated for — broader than
 * reportMetricFromQuery since a trend/average doesn't need a per-day card
 * value the way a "worst day" ranking does. Returns null when the query
 * doesn't name a specific metric, so the caller falls back to the general
 * overview report instead of guessing.
 */
function reportSubjectFromQuery(lower: string): ReportSubject | null {
  if (HEART_RATE_WORDS.test(lower)) return "heartRate";
  if (WATER_WORDS.test(lower)) return "water";
  if (/\bmood\b/.test(lower)) return "mood";
  if (/\bstress\b/.test(lower)) return "stress";
  if (/\bfatigue|tired\b/.test(lower)) return "fatigue";
  if (/\bsleep\b/.test(lower)) return "sleep";
  if (/\brecovery\b/.test(lower)) return "recovery";
  if (/\bsoreness|sore\b/.test(lower)) return "soreness";
  if (TRAINING_SUBJECT_WORDS.test(lower) || /\bload\b/.test(lower)) return "training";
  return null;
}

function isDayExtremumQuery(lower: string): boolean {
  return /\bday\b/.test(lower) && EXTREMUM_WORDS.test(lower);
}

function isTrainingExtremumQuery(lower: string): boolean {
  return TRAINING_SUBJECT_WORDS.test(lower) && EXTREMUM_WORDS.test(lower);
}

/** "report"/"how is X"/"summary"/"trend" naming one specific metric — e.g. "give me a report of my heart rate". */
function metricReportSubject(lower: string): ReportSubject | null {
  const subject = reportSubjectFromQuery(lower);
  if (!subject) return null;
  const hasReportSignal = /\breport\b|\bsummary\b|\btrend\b|\bhow\s+(?:is|has|have|was|were)\b/.test(lower);
  return hasReportSignal ? subject : null;
}

function isListTrainingHistoryQuery(lower: string): boolean {
  if (EXTREMUM_WORDS.test(lower) || /\breport\b/.test(lower)) return false;
  return TRAINING_SUBJECT_WORDS.test(lower) && /\b(list|show|display)\b/.test(lower);
}

function isProgressAdviceQuery(lower: string): boolean {
  return (
    /\b(progress|how am i doing|suggest(?:ion)?s?|advice|recommend(?:ation)?s?|what should i do|next step|next steps|improve|improvement|better)\b/.test(lower) ||
    /\bhow\b.*\bprogress\b/.test(lower) ||
    /\bwhat\b.*\bthings?\b.*\bsuggest\b/.test(lower) ||
    /\bthings?\b.*\bsuggest\b/.test(lower)
  );
}

function isReportInfoQuery(lower: string): boolean {
  return (
    /\b(report|last week|weekly|week|improve|improvement|area|areas|down|low|weak|weaker|drop|dropped|struggle|struggling|better|progress|suggest|suggestion|advice|recommend|recommendation|next)\b/.test(lower) &&
    /\b(report|week|improve|improvement|area|areas|down|low|weak|drop|struggle|readiness|recovery|sleep|water|load|training|rpm|performance|progress|suggest|suggestion|advice|recommend|recommendation|next)\b/.test(lower)
  );
}

function reportMode(lower: string): ReportMode {
  if (/\b(suggest|suggestion|advice|recommend|recommendation|improve|improvement|better|next\s+steps?)\b/.test(lower)) return "improve";
  if (/\b(down|low|weak|weaker|drop|dropped|struggle|struggling)\b/.test(lower)) return "down";
  return "weekly";
}

/**
 * Priority order matters:
 * 1. A single-day/session ranking ("which day/training was worst/best/average") wins over
 *    everything else, even though it may share words like "report" or "week".
 * 2. An explicit ask for help/advice wins next.
 * 3. A report that names one specific metric (heart rate, water, mood, ...) gets a report
 *    scoped to that metric, instead of falling into the general readiness/load overview —
 *    that overview should only fire when nothing more specific was asked for.
 */
export function classifyReportQuery(query: string): ReportIntent {
  const lower = normalizeWeekTypos(query.toLowerCase());
  const days = requestedHistoryDays(lower);

  if (isDayExtremumQuery(lower) || isTrainingExtremumQuery(lower)) {
    return { kind: "day_extremum", direction: reportDirectionFromQuery(lower), metric: reportMetricFromQuery(lower), days };
  }
  if (isProgressAdviceQuery(lower)) {
    return { kind: "progress_advice", days };
  }
  const subject = metricReportSubject(lower);
  if (subject) {
    return { kind: "metric_report", subject, days };
  }
  if (isListTrainingHistoryQuery(lower)) {
    return { kind: "list_training_history", days };
  }
  if (isReportInfoQuery(lower)) {
    return { kind: "report", days, mode: reportMode(lower) };
  }
  return { kind: "none" };
}

export function isReportLikeQuery(text: string): boolean {
  return classifyReportQuery(text).kind !== "none";
}
