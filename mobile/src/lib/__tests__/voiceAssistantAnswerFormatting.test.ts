import {
  formatReadinessAnswer,
  formatTodayPlanAnswer,
  formatProgressAnswer,
  formatCoachFeedbackAnswer,
  formatHydrationAnswer,
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

describe("formatDailyChecklistAnswer", () => {
  test("lists real missing categories with friendly labels", () => {
    expect(formatDailyChecklistAnswer(["wellness", "water"])).toBe("You still need to log your wellness check-in, water today.");
  });

  test("confirms nothing missing rather than a generic placeholder", () => {
    expect(formatDailyChecklistAnswer([])).toMatch(/all caught up/);
  });
});
