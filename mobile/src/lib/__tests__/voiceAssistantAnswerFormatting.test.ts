import {
  formatReadinessAnswer,
  formatTodayPlanAnswer,
  formatProgressAnswer,
  formatCoachFeedbackAnswer,
  formatHydrationAnswer,
  formatNutritionAnswer,
  formatUpcomingSessionAnswer,
  formatDailyChecklistAnswer,
  type DailyCardForAnswers,
} from "../voiceAssistant/answerFormatting";

function card(overrides: Partial<DailyCardForAnswers> = {}): DailyCardForAnswers {
  return {
    readinessScore: null,
    isRestDay: false,
    sessions: {
      AM: { status: null, workoutType: null },
      AFT: { status: null, workoutType: null },
      PM: { status: null, workoutType: null },
    },
    ...overrides,
  };
}

describe("formatReadinessAnswer", () => {
  test("states the real score when checked in", () => {
    expect(formatReadinessAnswer(card({ readinessScore: 82 }))).toBe("Your readiness today is 82 out of 100.");
  });

  test("never invents a score when there's no check-in", () => {
    expect(formatReadinessAnswer(card())).toMatch(/haven't checked in/);
  });
});

describe("formatTodayPlanAnswer", () => {
  test("rest day short-circuits everything else", () => {
    expect(formatTodayPlanAnswer(card({ isRestDay: true }))).toBe("Today is a rest day.");
  });

  test("only mentions slots that actually happened, not merely planned ones", () => {
    const c = card({
      sessions: {
        AM: { status: "completed", workoutType: "Sprints" },
        AFT: { status: "planned", workoutType: "Endurance" },
        PM: { status: null, workoutType: null },
      },
    });
    const result = formatTodayPlanAnswer(c);
    expect(result).toContain("AM Sprints completed");
    expect(result).not.toContain("AFT");
    expect(result).not.toContain("PM");
  });

  test("says nothing logged when every slot is empty/planned", () => {
    expect(formatTodayPlanAnswer(card())).toBe("You have no sessions logged yet today.");
  });
});

describe("formatProgressAnswer", () => {
  test("reports upward trend from real numbers", () => {
    const series = [{ readiness: 60 }, { readiness: 65 }, { readiness: 70 }, { readiness: 80 }];
    expect(formatProgressAnswer(series)).toMatch(/up.*80/);
  });

  test("reports downward trend", () => {
    const series = [{ readiness: 80 }, { readiness: 60 }];
    expect(formatProgressAnswer(series)).toMatch(/down/);
  });

  test("small deltas read as 'about the same', not noise as a trend", () => {
    const series = [{ readiness: 70 }, { readiness: 71 }];
    expect(formatProgressAnswer(series)).toMatch(/about the same/);
  });

  test("never fabricates a trend from insufficient real data", () => {
    expect(formatProgressAnswer([])).toMatch(/not enough|isn't enough/i);
    expect(formatProgressAnswer([{ readiness: 70 }])).toMatch(/not enough|isn't enough/i);
    expect(formatProgressAnswer([{ readiness: null }, { readiness: null }])).toMatch(/not enough|isn't enough/i);
  });
});

describe("formatCoachFeedbackAnswer", () => {
  test("reads back the real, most recent comment verbatim", () => {
    expect(formatCoachFeedbackAnswer([{ body: "Great session, keep it up" }, { body: "older" }])).toBe(
      'Your coach said: "Great session, keep it up"'
    );
  });

  test("never invents feedback when there is none", () => {
    expect(formatCoachFeedbackAnswer([])).toMatch(/no coach feedback/i);
  });
});

describe("formatHydrationAnswer", () => {
  test("reports real remaining amount", () => {
    expect(formatHydrationAnswer(1000, 3000)).toBe("You've had 1000 millilitres, 2000 millilitres left to reach your goal.");
  });

  test("congratulates on goal met instead of a negative remaining number", () => {
    expect(formatHydrationAnswer(3200, 3000)).toBe("You've reached your 3000 millilitre water goal today.");
  });
});

describe("formatNutritionAnswer", () => {
  test("reports calories and macro remaining from real totals", () => {
    const result = formatNutritionAnswer(
      { calories: 2100, proteinG: 150, carbsG: 220, fatG: 65 },
      { calories: 1680, proteinG: 120, carbsG: 180, fatG: 48 }
    );
    expect(result).toContain("1680 calories");
    expect(result).toContain("420 calories remaining");
    expect(result).toContain("Protein 30 grams left");
  });

  test("does not invent a target when none is set", () => {
    expect(formatNutritionAnswer(null, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })).toMatch(/no nutrition target/i);
  });
});

describe("formatUpcomingSessionAnswer", () => {
  test("returns the next future non-cancelled session", () => {
    const now = new Date("2026-08-14T10:00:00.000Z").getTime();
    const result = formatUpcomingSessionAnswer(
      [
        { status: "cancelled", type: "cancelled", scheduledStart: "2026-08-14T11:00:00.000Z", scheduledEnd: "2026-08-14T11:30:00.000Z" },
        { status: "confirmed", type: "Progress Review", coachName: "Arjun", scheduledStart: "2026-08-14T12:30:00.000Z", scheduledEnd: "2026-08-14T13:00:00.000Z" },
      ],
      now
    );
    expect(result).toContain("Progress Review");
    expect(result).toContain("Coach Arjun");
    expect(result).toContain("30 minutes");
  });

  test("says no upcoming session when there is none", () => {
    expect(formatUpcomingSessionAnswer([], Date.now())).toMatch(/do not have an upcoming/i);
  });
});

describe("formatDailyChecklistAnswer", () => {
  test("lists real missing categories with friendly labels", () => {
    expect(formatDailyChecklistAnswer(["wellness", "water"])).toBe("You still need to log your wellness check-in, water today.");
  });

  test("confirms nothing missing rather than a generic placeholder", () => {
    expect(formatDailyChecklistAnswer([])).toMatch(/all caught up/);
  });
});
