// Who gets the one-time setup flow, and the checks on its "About you" step.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { athleteNeedsOnboarding, bodyBasicsError, buildAvailabilityRules, coachNeedsOnboarding, hasSeenOnboarding, markOnboardingSeen } from "../onboarding";
import { sportLabel } from "../sport";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

const joinedLocal = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9, 0).toISOString();
const today = "2026-10-14";

describe("athleteNeedsOnboarding", () => {
  it("shows for a new athlete with no goal or weight", () => {
    expect(athleteNeedsOnboarding({ today, createdAt: joinedLocal(2026, 10, 14) })).toBe(true);
    expect(athleteNeedsOnboarding({ today, createdAt: joinedLocal(2026, 10, 8) })).toBe(true);
  });
  it("never shows for accounts older than the first week", () => {
    expect(athleteNeedsOnboarding({ today, createdAt: joinedLocal(2026, 10, 7) })).toBe(false);
    expect(athleteNeedsOnboarding({ today, createdAt: null })).toBe(false);
  });
  it("skips athletes who already set a goal or weight", () => {
    expect(athleteNeedsOnboarding({ today, createdAt: joinedLocal(2026, 10, 14), fitnessGoal: "lose_weight" })).toBe(false);
    expect(athleteNeedsOnboarding({ today, createdAt: joinedLocal(2026, 10, 14), weightKg: 70 })).toBe(false);
  });
});

describe("coachNeedsOnboarding", () => {
  const empty = { bio: null, specializations: [], active: false, availabilityRuleCount: 0 };
  it("shows for a coach with nothing set up", () => {
    expect(coachNeedsOnboarding(empty)).toBe(true);
    expect(coachNeedsOnboarding({ ...empty, bio: "   " })).toBe(true);
  });
  it("skips a coach who set up anything athletes see", () => {
    expect(coachNeedsOnboarding({ ...empty, bio: "I coach runners." })).toBe(false);
    expect(coachNeedsOnboarding({ ...empty, specializations: ["Strength"] })).toBe(false);
    expect(coachNeedsOnboarding({ ...empty, active: true })).toBe(false);
    expect(coachNeedsOnboarding({ ...empty, availabilityRuleCount: 2 })).toBe(false);
  });
});

describe("seen flag", () => {
  it("is per user and survives until cleared", async () => {
    await AsyncStorage.clear();
    expect(await hasSeenOnboarding("a")).toBe(false);
    await markOnboardingSeen("a");
    expect(await hasSeenOnboarding("a")).toBe(true);
    expect(await hasSeenOnboarding("b")).toBe(false);
  });
});

describe("bodyBasicsError", () => {
  const ok = { weightKg: "72", heightCm: "170", dob: "1998-03-14", sex: "male", today };
  it("accepts complete, believable values", () => {
    expect(bodyBasicsError(ok)).toBeNull();
    expect(bodyBasicsError({ ...ok, weightKg: "72.5" })).toBeNull();
  });
  it("names the first problem in screen order", () => {
    expect(bodyBasicsError({ ...ok, weightKg: "" })).toMatch(/weight/);
    expect(bodyBasicsError({ ...ok, weightKg: "7" })).toMatch(/weight/);
    expect(bodyBasicsError({ ...ok, heightCm: "abc" })).toMatch(/height/);
    expect(bodyBasicsError({ ...ok, dob: "" })).toMatch(/birthday/);
    expect(bodyBasicsError({ ...ok, dob: "2030-01-01" })).toMatch(/future/);
    expect(bodyBasicsError({ ...ok, sex: "" })).toMatch(/male or female/);
  });
});

describe("sportLabel", () => {
  it("hides the server's placeholder", () => {
    expect(sportLabel("Not set")).toBeNull();
    expect(sportLabel("not set ")).toBeNull();
    expect(sportLabel("")).toBeNull();
    expect(sportLabel(null)).toBeNull();
    expect(sportLabel("Cricket")).toBe("Cricket");
  });
});

describe("buildAvailabilityRules", () => {
  const windows = [{ start: "18:00", end: "20:00" }, { start: "06:00", end: "09:00" }];

  it("makes one rule per day and window, earliest first", () => {
    const result = buildAvailabilityRules([3, 1], windows, "Asia/Kolkata");
    expect(result.error).toBeNull();
    expect(result.rules).toEqual([
      { dayOfWeek: 1, startMinute: 360, endMinute: 540, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 10 },
      { dayOfWeek: 1, startMinute: 1080, endMinute: 1200, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 10 },
      { dayOfWeek: 3, startMinute: 360, endMinute: 540, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 10 },
      { dayOfWeek: 3, startMinute: 1080, endMinute: 1200, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 10 },
    ]);
  });

  it("refuses windows the server or a booking could not use", () => {
    expect(buildAvailabilityRules([], windows, "UTC").error).toMatch(/day/);
    expect(buildAvailabilityRules([1], [], "UTC").error).toMatch(/window/);
    expect(buildAvailabilityRules([1], [{ start: "09:00", end: "08:00" }], "UTC").error).toMatch(/end after/);
    expect(buildAvailabilityRules([1], [{ start: "09:00", end: "09:20" }], "UTC").error).toMatch(/30 minutes/);
    expect(buildAvailabilityRules([1], [{ start: "09:00", end: "11:00" }, { start: "10:00", end: "12:00" }], "UTC").error).toMatch(/overlap/);
  });
});
