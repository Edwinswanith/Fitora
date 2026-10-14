import type { NextAction } from "../fitoraData";
import type { FirstStepsState } from "../firstSteps";
import { dayProgress, daysSinceLastCheckIn, derivePexReaction, streakMilestoneLine, type PexInput } from "../pex/brain";

const next = (over: Partial<NextAction> & Pick<NextAction, "kind">): NextAction => ({ eyebrow: "Next up", title: "", body: "", ctaLabel: "", ...over });

function input(over: Partial<PexInput> = {}): PexInput {
  return {
    next: next({ kind: "complete", eyebrow: "All set", title: "Day complete", body: "Nothing left." }),
    hour: 14,
    firstSteps: null,
    readinessScore: 72,
    daysSinceCheckIn: 1,
    streak: 0,
    dayProgress: 0.5,
    hasCoach: true,
    coachName: "Ravi Kumar",
    pendingRequestCoach: null,
    inviteCoach: null,
    ...over,
  };
}

const steps = (over: Partial<FirstStepsState> = {}): FirstStepsState => ({
  day: 1,
  steps: [
    { key: "water", done: false },
    { key: "checkin", done: false },
    { key: "coach", done: false },
  ],
  doneCount: 0,
  allDone: false,
  ...over,
});

describe("derivePexReaction", () => {
  test("a failed payment beats everything and looks alarmed", () => {
    const r = derivePexReaction(input({ next: next({ kind: "payment", title: "Payment failed", ctaLabel: "View Membership" }), inviteCoach: "Asha" }));
    expect(r).toMatchObject({ id: "payment", face: "alarm", tone: "alert", action: "payment" });
  });

  test("an open coach invite is news, and it never names anything the coach can see", () => {
    const r = derivePexReaction(input({ hasCoach: false, coachName: null, inviteCoach: "Ravi Kumar" }));
    expect(r).toMatchObject({ id: "invite", face: "news", title: "Ravi wants to coach you", action: "coach" });
  });

  test("a missing calorie target sends a new athlete to setup first", () => {
    const r = derivePexReaction(input({ firstSteps: steps({ steps: [{ key: "target", done: false }, { key: "checkin", done: false }, { key: "coach", done: false }] }) }));
    expect(r).toMatchObject({ id: "setup.target", face: "welcome", eyebrow: "Hi, I'm Pex", action: "onboarding" });
  });

  test("first-days steps walk through the next undone one, with progress in the eyebrow", () => {
    const r = derivePexReaction(input({ next: next({ kind: "checkin" }), firstSteps: steps({ day: 2, steps: [{ key: "water", done: true }, { key: "checkin", done: false }, { key: "coach", done: false }], doneCount: 1 }) }));
    expect(r).toMatchObject({ id: "setup.checkin", eyebrow: "Day 2 · 1 of 3 done", action: "checkin" });
  });

  test("a coach's workout outranks setup chores", () => {
    const r = derivePexReaction(input({ next: next({ kind: "workout_upcoming", title: "Leg Day", body: "6 exercises", ctaLabel: "Start Workout" }), firstSteps: steps({ steps: [{ key: "water", done: true }, { key: "checkin", done: false }, { key: "coach", done: true }], doneCount: 2 }) }));
    expect(r.id).toBe("workout.upcoming");
  });

  test("a pending join request shows Pex waiting, with no button", () => {
    const r = derivePexReaction(input({ hasCoach: false, coachName: null, pendingRequestCoach: "Ravi Kumar" }));
    expect(r).toMatchObject({ id: "coach.waiting", face: "waiting", title: "Waiting on Ravi", ctaLabel: "", action: null });
  });

  test("coming back after days away is a gentle check-in, never a count of missed days", () => {
    const r = derivePexReaction(input({ next: next({ kind: "checkin", ctaLabel: "Check In" }), daysSinceCheckIn: 4 }));
    expect(r).toMatchObject({ id: "checkin.comeback", face: "gentle", title: "Good to see you" });
    expect(`${r.title} ${r.body}`).not.toMatch(/\d/);
  });

  test("mornings ask how they slept; later it's a plain check-in", () => {
    expect(derivePexReaction(input({ next: next({ kind: "checkin" }), hour: 7 })).id).toBe("checkin.morning");
    expect(derivePexReaction(input({ next: next({ kind: "checkin" }), hour: 15 })).id).toBe("checkin");
  });

  test("late at night Pex winds down, but never interrupts a workout in progress", () => {
    expect(derivePexReaction(input({ next: next({ kind: "hydration", body: "1.2 L to go", ctaLabel: "Log Water" }), hour: 23 })).face).toBe("sleepy");
    expect(derivePexReaction(input({ next: next({ kind: "workout_active", title: "Leg Day", body: "3 / 6 exercises complete" }), hour: 23 })).id).toBe("workout.active");
  });

  test("low readiness before a workout suggests messaging the coach, using the real score", () => {
    const r = derivePexReaction(input({ next: next({ kind: "workout_upcoming", title: "Leg Day", body: "6 exercises", ctaLabel: "Start Workout" }), readinessScore: 38.4 }));
    expect(r).toMatchObject({ face: "worried", tone: "caution", eyebrow: "Readiness 38", ctaLabel: "Message Ravi", action: "messageCoach" });
  });

  test("an upcoming workout only praises readiness when it is actually high", () => {
    const high = derivePexReaction(input({ next: next({ kind: "workout_upcoming", title: "Leg Day", body: "6 exercises" }), readinessScore: 81 }));
    expect(high.body).toBe("6 exercises from Ravi. Readiness 81, you're good to go.");
    const unknown = derivePexReaction(input({ next: next({ kind: "workout_upcoming", title: "Leg Day", body: "6 exercises" }), readinessScore: null }));
    expect(unknown.body).toBe("6 exercises from Ravi.");
  });

  test("the effort question names the coach only when there is one", () => {
    expect(derivePexReaction(input({ next: next({ kind: "rpe" }) })).body).toContain("Ravi uses it");
    expect(derivePexReaction(input({ next: next({ kind: "rpe" }), hasCoach: false, coachName: null })).body).toBe("Rate today's session from 1 to 10.");
  });

  test("a finished day is calm; without a coach it points to finding one", () => {
    expect(derivePexReaction(input())).toMatchObject({ id: "complete", face: "calm", calm: true, action: "progress" });
    expect(derivePexReaction(input({ hasCoach: false, coachName: null }))).toMatchObject({ id: "coach.find", action: "coach" });
  });

  test("the streak spark needs at least two days in a row", () => {
    expect(derivePexReaction(input({ streak: 1 })).spark).toBe(false);
    expect(derivePexReaction(input({ streak: 2 })).spark).toBe(true);
  });
});

describe("dayProgress", () => {
  test("averages only what applies today", () => {
    expect(dayProgress({ checkedIn: false })).toBe(0);
    expect(dayProgress({ checkedIn: true, waterMl: 1500, waterGoalMl: 3000 })).toBe(0.75);
    expect(dayProgress({ checkedIn: true, waterMl: 6000, waterGoalMl: 3000, calories: 1000, calorieTarget: 2000, workout: { status: "completed", completedCount: 0, exerciseCount: 0 } })).toBeCloseTo((1 + 1 + 0.5 + 1) / 4);
  });
});

describe("daysSinceLastCheckIn", () => {
  test("counts days from the last check-in before today", () => {
    const trends = [
      { date: "2026-10-08", readiness: 70 },
      { date: "2026-10-10", readiness: 65 },
      { date: "2026-10-11", readiness: null },
      { date: "2026-10-14", readiness: 80 },
    ];
    expect(daysSinceLastCheckIn(trends, "2026-10-14")).toBe(4);
    expect(daysSinceLastCheckIn([], "2026-10-14")).toBeNull();
  });
});

test("streak milestones", () => {
  expect(streakMilestoneLine(7)).toBe("7 days in a row. That's a streak!");
  expect(streakMilestoneLine(8)).toBeNull();
});
