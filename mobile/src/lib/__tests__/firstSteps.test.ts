import { firstStepsState } from "../firstSteps";

const base = { today: "2026-10-13", waterMl: 0, readinessScore: null, hasCoach: false };
const joinedLocal = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9, 0).toISOString();

describe("firstStepsState", () => {
  it("shows day 1 with nothing done for a brand-new athlete", () => {
    const state = firstStepsState({ ...base, createdAt: joinedLocal(2026, 10, 13) });
    expect(state).toMatchObject({ day: 1, doneCount: 0, allDone: false });
    expect(state?.steps.map((s) => s.key)).toEqual(["water", "checkin", "coach"]);
  });

  it("marks steps done from today's data", () => {
    const state = firstStepsState({ ...base, createdAt: joinedLocal(2026, 10, 12), waterMl: 250, readinessScore: 70 });
    expect(state).toMatchObject({ day: 2, doneCount: 2, allDone: false });
  });

  it("keeps the all-set payoff on day 1 only", () => {
    const done = { ...base, waterMl: 250, readinessScore: 70, hasCoach: true };
    expect(firstStepsState({ ...done, createdAt: joinedLocal(2026, 10, 13) })?.allDone).toBe(true);
    expect(firstStepsState({ ...done, createdAt: joinedLocal(2026, 10, 11) })).toBeNull();
  });

  it("disappears after the first week or without a join date", () => {
    expect(firstStepsState({ ...base, createdAt: joinedLocal(2026, 10, 7) })?.day).toBe(7);
    expect(firstStepsState({ ...base, createdAt: joinedLocal(2026, 10, 6) })).toBeNull();
    expect(firstStepsState({ ...base, createdAt: null })).toBeNull();
  });
});
