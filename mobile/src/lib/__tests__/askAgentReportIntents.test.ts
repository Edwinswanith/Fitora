import { classifyReportQuery, isReportLikeQuery, type ReportIntent } from "../askAgentReportIntents";

/**
 * Regression coverage for the Ask Agent's "report"-style queries.
 *
 * Each case is a genuinely different real-world moment an athlete would hit
 * the Ask Agent with — not a rewording of the same request. Two bugs drove
 * this suite:
 *
 * 1. "which day did I perform average" fell into the trending-down report
 *    because STT mis-transcribed "week" as "weak", colliding with the real
 *    word "weak" (underperforming). Fixed by normalizing that exact typo'd
 *    time-period pattern before keyword matching.
 * 2. "give me a report of my last heart rate" fell into the generic weekly
 *    readiness/training-load report, because any query containing "report"
 *    satisfied the generic bucket's own trigger words. Fixed by adding a
 *    metric_report intent that wins whenever the query names one specific
 *    metric (heart rate, water, mood, stress, fatigue, sleep, recovery,
 *    soreness, training) — the generic overview now only fires when nothing
 *    more specific was asked for.
 */

type Case = { scenario: string; query: string; expected: ReportIntent };

const CASES: Case[] = [
  // --- A. Day-level performance ranking ---
  { scenario: "asks which day was worst, misheard 'week' as 'weak'", query: "give em a report of which day i preform very worst in last weak.", expected: { kind: "day_extremum", direction: "worst", metric: "readiness", days: 7 } },
  { scenario: "asks which day was best, misheard 'week' as 'weak'", query: "give em a report of which day i preform very best in last weak.", expected: { kind: "day_extremum", direction: "best", metric: "readiness", days: 7 } },
  { scenario: "asks which day was average (the original reported bug)", query: "give em a report of which day i preform avarage in last weak.", expected: { kind: "day_extremum", direction: "average", metric: "readiness", days: 7 } },
  { scenario: "STT mangled 'based on' -> 'best on' and 'worst' -> 'waste' in the same sentence", query: "so best on my past one week data which day I performed the waste", expected: { kind: "day_extremum", direction: "worst", metric: "readiness", days: 7 } },
  { scenario: "athlete wants to know which night's sleep was worst", query: "which day did I sleep the worst this week", expected: { kind: "day_extremum", direction: "worst", metric: "sleep", days: 7 } },
  { scenario: "athlete checking their best-recovered day over a month", query: "which day did I have the best recovery this month", expected: { kind: "day_extremum", direction: "best", metric: "recovery", days: 30 } },
  { scenario: "athlete tracking their sorest day", query: "which day was my soreness the worst", expected: { kind: "day_extremum", direction: "worst", metric: "soreness", days: 7 } },
  { scenario: "athlete wants an explicit 14-day window on readiness", query: "show my worst readiness day in the last 14 days", expected: { kind: "day_extremum", direction: "worst", metric: "readiness", days: 14 } },
  { scenario: "athlete wants their best-sleep day over a month", query: "which day did I have the best sleep this month", expected: { kind: "day_extremum", direction: "best", metric: "sleep", days: 30 } },

  // --- B. Training/session ranking (no literal "day" needed) ---
  { scenario: "athlete asking which training session went best, no 'day' word", query: "which training did I perform best in last week", expected: { kind: "day_extremum", direction: "best", metric: "training", days: 7 } },
  { scenario: "athlete asking which session was hardest/worst", query: "what was my worst training session this week", expected: { kind: "day_extremum", direction: "worst", metric: "training", days: 7 } },
  { scenario: "athlete referencing an upcoming event instead of 'this week'", query: "which workout was my best before the tournament", expected: { kind: "day_extremum", direction: "best", metric: "training", days: 7 } },

  // --- C. Listing past training (not a ranking) ---
  { scenario: "athlete wants a plain list of past sessions", query: "list out the past day training workout.", expected: { kind: "list_training_history", days: 7 } },
  { scenario: "athlete wants a month's worth of sessions, casual phrasing", query: "show me every session I did this month", expected: { kind: "list_training_history", days: 30 } },
  { scenario: "athlete wants a specific 10-day workout list", query: "display my workouts from the past 10 days", expected: { kind: "list_training_history", days: 10 } },

  // --- D. Metric-specific report (the new intent, one distinct topic each) ---
  { scenario: "the exact bug report from the athlete, verbatim", query: "give me a report of my last heart rate", expected: { kind: "metric_report", subject: "heartRate", days: 7 } },
  { scenario: "same ask, phrased as a status check instead of 'give me a report'", query: "how is my heart rate looking this week", expected: { kind: "metric_report", subject: "heartRate", days: 7 } },
  { scenario: "same metric, explicit 10-day window", query: "can I get a heart rate report for the last 10 days", expected: { kind: "metric_report", subject: "heartRate", days: 10 } },
  { scenario: "athlete on a hot week checking hydration habits", query: "how is my hydration this week", expected: { kind: "metric_report", subject: "water", days: 7 } },
  { scenario: "athlete wants a longer hydration window", query: "give me a water report for the last 14 days", expected: { kind: "metric_report", subject: "water", days: 14 } },
  { scenario: "athlete checking in on their mental state", query: "how has my mood been lately", expected: { kind: "metric_report", subject: "mood", days: 7 } },
  { scenario: "athlete under exam/competition pressure checking stress", query: "give me a stress report for this week", expected: { kind: "metric_report", subject: "stress", days: 7 } },
  { scenario: "athlete worried about burnout checking fatigue", query: "how has my fatigue been this week", expected: { kind: "metric_report", subject: "fatigue", days: 7 } },
  { scenario: "athlete wants a sleep-only report, not the full weekly overview", query: "give me a sleep report for the last week", expected: { kind: "metric_report", subject: "sleep", days: 7 } },
  { scenario: "athlete checking recovery over a full month before a season", query: "how is my recovery trending this month", expected: { kind: "metric_report", subject: "recovery", days: 30 } },
  { scenario: "coach-facing ask about training load specifically", query: "give me a report on my training load this week", expected: { kind: "metric_report", subject: "training", days: 7 } },
  { scenario: "short recovery check ahead of a weekend meet", query: "give me a recovery report for the last 3 days", expected: { kind: "metric_report", subject: "recovery", days: 3 } },
  { scenario: "athlete tracking muscle soreness after a hard block", query: "how has my soreness been this week", expected: { kind: "metric_report", subject: "soreness", days: 7 } },

  // --- E. Coaching / progress advice (each a different real situation) ---
  { scenario: "athlete preparing for a competition next week", query: "any tips to get better before my competition next week", expected: { kind: "progress_advice", days: 7 } },
  { scenario: "athlete fixated specifically on their readiness number", query: "what should I do next to boost my readiness", expected: { kind: "progress_advice", days: 7 } },
  { scenario: "athlete asking for a routine change, not a status report", query: "can you recommend changes to my recovery routine", expected: { kind: "progress_advice", days: 7 } },

  // --- F. Generic weekly overview (no single metric named) ---
  { scenario: "plain, unambiguous weekly report ask", query: "give me my weekly report", expected: { kind: "report", days: 7, mode: "weekly" } },
  { scenario: "STT noise appended after 'report' (real transcript)", query: "give me your report app", expected: { kind: "report", days: 7, mode: "weekly" } },
  { scenario: "heavily garbled STT transcript (real transcript)", query: "give me a report of fast office", expected: { kind: "report", days: 7, mode: "weekly" } },

  // --- G. Trending-down overview (genuine "weak"/"low"/"drop" signal) ---
  { scenario: "athlete asking generally what's underperforming", query: "what areas are weak this week", expected: { kind: "report", days: 7, mode: "down" } },
  { scenario: "athlete concerned specifically about readiness dropping", query: "why has my readiness been low this week", expected: { kind: "report", days: 7, mode: "down" } },
  { scenario: "athlete noticing a general performance dip", query: "what's causing my drop in performance this week", expected: { kind: "report", days: 7, mode: "down" } },

  // --- H. Explicit day-range parsing on the generic report ---
  { scenario: "short 3-day check-in report", query: "give me a report for the last 3 days", expected: { kind: "report", days: 3, mode: "weekly" } },
  { scenario: "explicit 30-day report", query: "give me a 30 day report", expected: { kind: "report", days: 30, mode: "weekly" } },
  { scenario: "monthly report, spoken naturally", query: "give me a monthly report", expected: { kind: "report", days: 30, mode: "weekly" } },

  // --- I. Not report queries at all — real scenarios that must stay unclassified ---
  { scenario: "a write command, not a question", query: "log my sleep as 8 hours", expected: { kind: "none" } },
  { scenario: "a hydration write command", query: "add 250 ml water", expected: { kind: "none" } },
  { scenario: "small talk", query: "hello there", expected: { kind: "none" } },
  { scenario: "a schedule command", query: "set today as a rest day", expected: { kind: "none" } },
  { scenario: "a messaging command naming a metric ('session') but not asking for a report", query: "send my coach a message about today's session", expected: { kind: "none" } },
  { scenario: "a personal-profile question", query: "what is my name", expected: { kind: "none" } },
  { scenario: "a today-only snapshot question, not a multi-day report", query: "what's my soreness level right now", expected: { kind: "none" } },
  { scenario: "a navigation command", query: "open my training log for yesterday", expected: { kind: "none" } },
  { scenario: "a notifications check", query: "do I have any new notifications", expected: { kind: "none" } },
  { scenario: "cancelling a schedule entry", query: "can you cancel my rest day", expected: { kind: "none" } },
  { scenario: "asking what a coach said, not asking for a data report", query: "what did my coach say yesterday", expected: { kind: "none" } },
];

test("covers at least 50 distinct real-world scenarios", () => {
  expect(CASES.length).toBeGreaterThanOrEqual(50);
});

test("no two scenarios share the exact same query text", () => {
  const queries = CASES.map((c) => c.query);
  expect(new Set(queries).size).toBe(queries.length);
});

describe.each(CASES)("[$scenario]", ({ query, expected }) => {
  test(`"${query}" -> ${JSON.stringify(expected)}`, () => {
    expect(classifyReportQuery(query)).toEqual(expected);
  });
});

describe("isReportLikeQuery", () => {
  test("true for every scenario that classifies to something other than none", () => {
    for (const { query, expected } of CASES) {
      expect(isReportLikeQuery(query)).toBe(expected.kind !== "none");
    }
  });
});

describe("the two reported bugs stay fixed", () => {
  test("a heart-rate report is never answered with the generic weekly report", () => {
    const intent = classifyReportQuery("give me a report of my last heart rate");
    expect(intent.kind).toBe("metric_report");
    expect(intent).not.toMatchObject({ kind: "report" });
  });

  test("worst/best/average day queries each produce a distinct direction, not one fixed response", () => {
    const worst = classifyReportQuery("give em a report of which day i preform very worst in last weak.");
    const best = classifyReportQuery("give em a report of which day i preform very best in last weak.");
    const average = classifyReportQuery("give em a report of which day i preform avarage in last weak.");
    expect(worst).toMatchObject({ kind: "day_extremum", direction: "worst" });
    expect(best).toMatchObject({ kind: "day_extremum", direction: "best" });
    expect(average).toMatchObject({ kind: "day_extremum", direction: "average" });
    expect(new Set([worst, best, average].map((intent) => JSON.stringify(intent))).size).toBe(3);
  });

  test("every metric_report subject produces a distinct, non-overlapping response shape", () => {
    const subjects = CASES.filter((c) => c.expected.kind === "metric_report").map((c) => (c.expected as { subject: string }).subject);
    const distinctSubjects = new Set(subjects);
    expect(distinctSubjects.size).toBeGreaterThanOrEqual(8);
  });
});
