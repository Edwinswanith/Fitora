import {
  checkInStreak,
  nutritionSummary,
  progressHeadline,
  rangeBuckets,
  rangeDatesLabel,
  recoverySummary,
  trainingSummary,
  weeklyCounts,
  type DayFormatter,
} from "../progressModel";
import { shiftDay } from "../progressWindow";

const fmt: DayFormatter = { weekday: (d) => `wd${d.slice(8)}`, date: (d) => d.slice(5) };
const TODAY = "2026-10-07";

function workouts(spec: [number, boolean][]) {
  // [daysAgo, completed]
  return spec.map(([ago, done], i) => ({ id: String(i), scheduledDate: shiftDay(TODAY, -ago), status: done ? "completed" : "scheduled" }));
}

describe("rangeBuckets", () => {
  it("splits each range into contiguous buckets ending today", () => {
    for (const [range, count] of [["7D", 7], ["4W", 4], ["3M", 6]] as const) {
      const buckets = rangeBuckets(range, TODAY, fmt);
      expect(buckets).toHaveLength(count);
      expect(buckets[buckets.length - 1].end).toBe(TODAY);
      for (let i = 1; i < buckets.length; i++) expect(buckets[i].start).toBe(shiftDay(buckets[i - 1].end, 1));
    }
  });

  it("labels the exact dates covered", () => {
    expect(rangeDatesLabel("4W", TODAY, fmt)).toBe("09-10 – 10-07");
  });
});

describe("trainingSummary", () => {
  it("counts only workouts in the range and states the basis", () => {
    const t = trainingSummary(workouts([[0, true], [3, true], [10, false], [40, true]]), "4W", TODAY, fmt);
    expect(t.total).toBe(3);
    expect(t.completed).toBe(2);
    expect(t.basis).toBe("2 of 3 workouts done");
  });

  it("leaves weeks with nothing scheduled off the chart instead of plotting 0%", () => {
    const t = trainingSummary(workouts([[0, true], [1, false]]), "4W", TODAY, fmt);
    expect(t.series).toHaveLength(1);
    expect(t.series[0].value).toBe(50);
    expect(t.series[0].detail).toContain("1 of 2 done");
  });

  it("uses the 60/80 thresholds once there is a real sample", () => {
    const done = (n: number, of: number) => workouts(Array.from({ length: of }, (_, i) => [i, i < n] as [number, boolean]));
    expect(trainingSummary(done(8, 10), "4W", TODAY, fmt).tone).toBe("success");
    expect(trainingSummary(done(7, 10), "4W", TODAY, fmt).tone).toBe("neutral");
    expect(trainingSummary(done(5, 10), "4W", TODAY, fmt).tone).toBe("warning");
    expect(trainingSummary(done(2, 10), "4W", TODAY, fmt).tone).toBe("danger");
  });
});

describe("nutritionSummary", () => {
  const day = (ago: number, calories: number) => ({ date: shiftDay(TODAY, -ago), loggedMeals: calories ? 2 : 0, calories });

  it("covers the whole selected range, not just one week", () => {
    const n = nutritionSummary([day(0, 2000), day(20, 1800), day(60, 2200)], "3M", TODAY, null, fmt);
    expect(n.loggedDays).toBe(3);
    expect(n.totalDays).toBe(90);
    expect(n.avgCalories).toBe(2000);
    expect(n.basis).toBe("Meals logged on 3 of 90 days");
  });

  it("counts only days since joining", () => {
    const n = nutritionSummary([day(0, 2000), day(1, 1900)], "4W", TODAY, shiftDay(TODAY, -2), fmt);
    expect(n.totalDays).toBe(3);
    expect(n.tone).toBe("neutral"); // 2 of 3 = 67%
  });

  it("averages calories over logged days only", () => {
    const n = nutritionSummary([day(0, 2000), day(1, 0), day(2, 1000)], "7D", TODAY, null, fmt);
    expect(n.avgCalories).toBe(1500);
    expect(n.series.map((p) => p.value)).toEqual([1000, 2000]);
  });
});

describe("recoverySummary", () => {
  const trend = (ago: number, readiness: number | null) => ({ date: shiftDay(TODAY, -ago), readiness, sleepHours: 7, load: null });

  it("ignores missed days and flags low days only when they are a real share", () => {
    const steady = recoverySummary([70, 72, 55, 74, 76, 71, 73, 75].map((v, i) => trend(7 - i, v)), "4W", TODAY, 75, fmt);
    expect(steady.lowDays).toBe(1);
    expect(steady.problem).toBe(false);

    const rough = recoverySummary([trend(3, 50), trend(2, 55), trend(1, null), trend(0, 70)], "4W", TODAY, 70, fmt);
    expect(rough.checkIns).toBe(3);
    expect(rough.lowDays).toBe(2);
    expect(rough.problem).toBe(true);
  });

  it("ignores low days older than a week (already recovered)", () => {
    const old = [40, 45, 50, 42].map((v, i) => trend(40 - i, v));
    const recent = [72, 74, 76, 75].map((v, i) => trend(3 - i, v));
    const r = recoverySummary([...old, ...recent], "3M", TODAY, 75, fmt);
    expect(r.lowDays).toBe(4);
    expect(r.problem).toBe(false);
  });

  it("is a problem when today is in the red", () => {
    expect(recoverySummary([trend(0, 50)], "7D", TODAY, 50, fmt).problem).toBe(true);
  });
});

describe("progressHeadline", () => {
  const good = () => ({
    training: trainingSummary(workouts([[0, true], [2, true], [4, true], [6, true]]), "4W", TODAY, fmt),
    nutrition: nutritionSummary(Array.from({ length: 28 }, (_, i) => ({ date: shiftDay(TODAY, -i), loggedMeals: 3, calories: 2000 })), "4W", TODAY, null, fmt),
    recovery: recoverySummary([70, 72, 74, 76].map((v, i) => ({ date: shiftDay(TODAY, -3 + i), readiness: v })), "4W", TODAY, 76, fmt),
  });

  it("is strong when every area is on track", () => {
    const { training, nutrition, recovery } = good();
    expect(progressHeadline(training, nutrition, recovery)).toMatchObject({ status: "strong", focus: null });
  });

  it("puts recovery first and explains it with numbers", () => {
    const { training, nutrition } = good();
    const recovery = recoverySummary([80, 80, 60, 60].map((v, i) => ({ date: shiftDay(TODAY, -3 + i), readiness: v })), "4W", TODAY, 65, fmt);
    const h = progressHeadline(training, nutrition, recovery);
    expect(h).toMatchObject({ status: "attention", focus: "recovery" });
    expect(h.body).toBe("Readiness is down 20 pts vs. the first half.");
  });

  it("names the slipping area with its counts", () => {
    const { nutrition, recovery } = good();
    const training = trainingSummary(workouts([[0, true], [1, false], [2, true], [3, false], [4, false]]), "4W", TODAY, fmt);
    const h = progressHeadline(training, nutrition, recovery);
    expect(h).toMatchObject({ status: "mixed", focus: "training", title: "Training is slipping" });
    expect(h.body).toBe("2 of 5 workouts done.");
  });

  it("has no verdict without data", () => {
    const empty = progressHeadline(trainingSummary([], "4W", TODAY, fmt), nutritionSummary([], "4W", TODAY, TODAY, fmt), recoverySummary([], "4W", TODAY, null, fmt));
    expect(empty).toMatchObject({ hasData: false, status: "none" });
  });
});

describe("weeklyCounts", () => {
  it("counts this week's workouts, meal days and check-ins", () => {
    const w = weeklyCounts(
      workouts([[0, true], [2, false], [9, true]]),
      [{ date: TODAY, loggedMeals: 1, calories: 500 }, { date: shiftDay(TODAY, -1), loggedMeals: 0, calories: 0 }],
      [{ date: TODAY, readiness: 70 }, { date: shiftDay(TODAY, -1), readiness: null }],
      TODAY,
      null
    );
    expect(w).toEqual({ workoutDone: 1, workoutTotal: 2, mealDays: 1, checkIns: 1, days: 7 });
  });
});

describe("checkInStreak", () => {
  it("counts the current run back from today and the longest run", () => {
    const t = (ago: number, readiness: number | null = 70) => ({ date: shiftDay(TODAY, -ago), readiness });
    expect(checkInStreak([t(0), t(1), t(3), t(4), t(5), t(6), t(2, null)], TODAY)).toEqual({ current: 2, longest: 4 });
    expect(checkInStreak([t(1)], TODAY)).toEqual({ current: 0, longest: 1 });
  });
});
