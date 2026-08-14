import { buildVoiceAction } from "../voiceAssistant/actionMapping";

describe("buildVoiceAction — log_session", () => {
  test("maps to the /voice/log-session orchestration endpoint with the clientActionId attached", () => {
    const result = buildVoiceAction(
      "log_session",
      { sessionType: "AM", status: "completed", workoutType: "Sprints", actualDurationMin: 45 },
      { clientActionId: "abc-123" }
    );
    expect(result).toMatchObject({
      kind: "http",
      method: "POST",
      path: "/api/athlete/voice/log-session",
      body: { sessionType: "AM", status: "completed", workoutType: "Sprints", actualDurationMin: 45, clientActionId: "abc-123" },
    });
  });

  test("only includes trainingCategory/plannedIntensityPercent when rpe is present", () => {
    const withoutRpe = buildVoiceAction("log_session", { sessionType: "AM", status: "completed" }, { clientActionId: "x" });
    expect(withoutRpe.kind).toBe("http");
    if (withoutRpe.kind === "http") {
      expect(withoutRpe.body.trainingCategory).toBeUndefined();
      expect(withoutRpe.body.plannedIntensityPercent).toBeUndefined();
    }

    const withRpe = buildVoiceAction(
      "log_session",
      { sessionType: "AM", status: "completed", rpe: 8, trainingCategory: "MAX SPEED", plannedIntensityPercent: 80 },
      { clientActionId: "x" }
    );
    expect(withRpe.kind).toBe("http");
    if (withRpe.kind === "http") {
      expect(withRpe.body.trainingCategory).toBe("MAX SPEED");
      expect(withRpe.body.plannedIntensityPercent).toBe(80);
    }
  });

  test("rpe and effortScore are passed through independently, never cross-populated", () => {
    const result = buildVoiceAction("log_session", { sessionType: "PM", status: "completed", effortScore: 9 }, { clientActionId: "x" });
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(result.body.effortScore).toBe(9);
      expect(result.body.rpe).toBeUndefined();
    }
  });
});

describe("buildVoiceAction — log_rpe", () => {
  test("routes through /voice/log-session (not the raw /rpe-monitoring endpoint), defaulting status to completed", () => {
    const result = buildVoiceAction(
      "log_rpe",
      { rpe: 7, trainingCategory: "ENDURANCE", plannedIntensityPercent: 60, sessionType: "PM" },
      { clientActionId: "y" }
    );
    expect(result).toMatchObject({
      kind: "http",
      path: "/api/athlete/voice/log-session",
      body: { sessionType: "PM", status: "completed", rpe: 7, trainingCategory: "ENDURANCE", plannedIntensityPercent: 60 },
    });
  });

  test("defaults sessionType to AM when the athlete never said which session", () => {
    const result = buildVoiceAction("log_rpe", { rpe: 6, trainingCategory: "ENDURANCE", plannedIntensityPercent: 50 }, { clientActionId: "y" });
    expect(result.kind).toBe("http");
    if (result.kind === "http") expect(result.body.sessionType).toBe("AM");
  });
});

describe("buildVoiceAction — log_wellness", () => {
  test("converts every spoken 1-10 sub-score to the stored 1-5 scale before sending", () => {
    const result = buildVoiceAction("log_wellness", { sleepQuality: 10, mood: 1, stress: 5.5 }, { clientActionId: "x" });
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(result.body.sleepQuality).toBe(5);
      expect(result.body.mood).toBe(1);
      expect(result.body.stress).toBeCloseTo(3, 5);
    }
  });

  test("sleepHours passes through unconverted (both scales already 0-14)", () => {
    const result = buildVoiceAction("log_wellness", { sleepHours: 7 }, { clientActionId: "x" });
    expect(result.kind).toBe("http");
    if (result.kind === "http") expect(result.body.sleepHours).toBe(7);
  });
});

describe("buildVoiceAction — hydration", () => {
  test("add_water carries amountMl and the idempotency key", () => {
    const result = buildVoiceAction("add_water", { amountMl: 500 }, { clientActionId: "z" });
    expect(result).toMatchObject({ kind: "http", path: "/api/athlete/water", body: { amountMl: 500, clientActionId: "z" } });
  });

  test("set_water_goal maps goalMl onto PATCH /me's hydrationGoalMl", () => {
    const result = buildVoiceAction("set_water_goal", { goalMl: 4000 }, { clientActionId: "z" });
    expect(result).toMatchObject({ kind: "http", method: "PATCH", path: "/api/athlete/me", body: { hydrationGoalMl: 4000 } });
  });

  test("change_hydration_reminder maps intervalMinutes to minIntervalMinutes on the notification-preferences endpoint", () => {
    const result = buildVoiceAction("change_hydration_reminder", { intervalMinutes: 90 }, { clientActionId: "z" });
    expect(result).toMatchObject({
      kind: "http",
      path: "/api/notification-preferences",
      body: { minIntervalMinutes: 90 },
    });
  });
});

describe("buildVoiceAction — log_recovery", () => {
  test("a skipped recovery synthesizes an empty, noted entry (the endpoint has no skipped field)", () => {
    const result = buildVoiceAction("log_recovery", { skipped: true }, { clientActionId: "x" });
    expect(result).toMatchObject({ kind: "http", path: "/api/athlete/recovery", body: { modalities: [], note: "Skipped recovery today" } });
  });

  test("logged modalities pass through as-is", () => {
    const result = buildVoiceAction("log_recovery", { modalities: ["stretching", "ice_bath"] }, { clientActionId: "x" });
    expect(result.kind).toBe("http");
    if (result.kind === "http") expect(result.body.modalities).toEqual(["stretching", "ice_bath"]);
  });
});

describe("buildVoiceAction — profile fields", () => {
  test("log_heart_rate maps straight through, no conversion", () => {
    const result = buildVoiceAction("log_heart_rate", { wakeHr: 52, bedHr: 58 }, { clientActionId: "x" });
    expect(result).toMatchObject({ kind: "http", path: "/api/athlete/heart-rate", body: { wakeHr: 52, bedHr: 58 } });
  });

  test("update_profile only includes fields that were actually provided", () => {
    const result = buildVoiceAction("update_profile", { heightCm: 178 }, { clientActionId: "x" });
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(result.body).toEqual({ heightCm: 178 });
    }
  });
});

describe("buildVoiceAction — coach-targeted writes", () => {
  test("send_coach_note without a resolved coachId reports needs_coach instead of guessing", () => {
    const result = buildVoiceAction("send_coach_note", { body: "Feeling great" }, { clientActionId: "x" });
    expect(result).toEqual({ kind: "needs_coach" });
  });

  test("send_coach_note with a resolved coachId targets that coach's thread", () => {
    const result = buildVoiceAction("send_coach_note", { body: "Feeling great" }, { clientActionId: "x", coachId: "coach-1" });
    expect(result).toMatchObject({ kind: "http", path: "/api/athlete/messages/coach-1", body: { body: "Feeling great", clientActionId: "x" } });
  });

  test("add_note never needs a coach — it's private", () => {
    const result = buildVoiceAction("add_note", { body: "Calf feels tight" }, { clientActionId: "x" });
    expect(result).toMatchObject({ kind: "http", path: "/api/athlete/notes" });
  });
});

describe("buildVoiceAction — unsupported intents", () => {
  test("a read-only or meta intent has no write mapping", () => {
    expect(buildVoiceAction("show_readiness", {}, { clientActionId: "x" })).toEqual({ kind: "unsupported" });
    expect(buildVoiceAction("open_screen", { screen: "today" }, { clientActionId: "x" })).toEqual({ kind: "unsupported" });
  });
});
