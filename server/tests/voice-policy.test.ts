import { derivePolicy, type PolicyPendingState, type SanitizedTurn } from "../src/services/voiceIntentPolicy";

function turn(intent: SanitizedTurn["intent"], entities: Record<string, unknown> = {}, confidence = 0.9): SanitizedTurn {
  return { intent, entities, confidence };
}

describe("voiceIntentPolicy — fresh intents", () => {
  test("log_wellness with no fields is incomplete", () => {
    const result = derivePolicy(turn("log_wellness", {}), null);
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toContain("sleepQuality");
    expect(result.requiresConfirmation).toBe(true);
  });

  test("log_wellness with a value present is ready to confirm", () => {
    const result = derivePolicy(turn("log_wellness", { sleepQuality: 8 }), null);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.missingFields).toEqual([]);
    expect(result.spokenResponse).toMatch(/sleep 8/);
  });

  test("log_session missing both required fields lists sessionType first", () => {
    const result = derivePolicy(turn("log_session", {}), null);
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields[0]).toBe("sessionType");
    expect(result.missingFields).toContain("status");
  });

  test("log_session with an rpe value also requires trainingCategory and plannedIntensityPercent", () => {
    const result = derivePolicy(
      turn("log_session", { sessionType: "AM", status: "completed", rpe: 8 }),
      null
    );
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toEqual(expect.arrayContaining(["trainingCategory", "plannedIntensityPercent"]));
  });

  test("log_session keeps rpe and effortScore independent — never cross-populates", () => {
    const result = derivePolicy(
      turn("log_session", {
        sessionType: "AM",
        status: "completed",
        rpe: 8,
        trainingCategory: "MAX SPEED",
        plannedIntensityPercent: 80,
      }),
      null
    );
    expect(result.action).toBe("ready_to_confirm");
    expect(result.entities.rpe).toBe(8);
    expect(result.entities.effortScore).toBeUndefined();
    expect(result.spokenResponse).toMatch(/RPE 8/);
    expect(result.spokenResponse).not.toMatch(/effort/);
  });

  test("log_session with only effortScore does not populate rpe", () => {
    const result = derivePolicy(
      turn("log_session", { sessionType: "PM", status: "completed", effortScore: 9 }),
      null
    );
    expect(result.entities.rpe).toBeUndefined();
    expect(result.entities.effortScore).toBe(9);
  });

  test("log_rpe requires rpe specifically — effortScore alone does not satisfy it", () => {
    const result = derivePolicy(turn("log_rpe", { effortScore: 8 } as Record<string, unknown>), null);
    // effortScore is not part of log_rpe's own entity schema, so it's dropped entirely.
    expect(result.entities.effortScore).toBeUndefined();
    expect(result.missingFields).toEqual(["rpe"]);
    expect(result.action).toBe("collect_fields");
  });

  test("log_rpe with rpe present is ready to confirm", () => {
    const result = derivePolicy(turn("log_rpe", { rpe: 7, trainingCategory: "ENDURANCE" }), null);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.spokenResponse).toMatch(/RPE 7/);
  });

  test("log_rpe rejects a trainingCategory outside the allowlist", () => {
    const result = derivePolicy(turn("log_rpe", { rpe: 6, trainingCategory: "Made Up Category" }), null);
    expect(result.entities.trainingCategory).toBeUndefined();
  });

  test("add_water requires amountMl and strips out-of-range values", () => {
    const tooMuch = derivePolicy(turn("add_water", { amountMl: 9000 }), null);
    expect(tooMuch.missingFields).toEqual(["amountMl"]);
    const ok = derivePolicy(turn("add_water", { amountMl: 500 }), null);
    expect(ok.action).toBe("ready_to_confirm");
    expect(ok.spokenResponse).toMatch(/500 ml/);
  });

  test("show_hydration is read-only, needs no confirmation", () => {
    const result = derivePolicy(turn("show_hydration", {}), null);
    expect(result.action).toBe("answer");
    expect(result.requiresConfirmation).toBe(false);
  });

  test("open_screen with an allowlisted screen navigates", () => {
    const result = derivePolicy(turn("open_screen", { screen: "progress" }), null);
    expect(result.action).toBe("navigate");
    expect(result.spokenResponse).toMatch(/progress/);
  });

  test("open_screen with a non-allowlisted screen asks instead of navigating", () => {
    const result = derivePolicy(turn("open_screen", { screen: "admin" }), null);
    expect(result.action).toBe("collect_fields");
    expect(result.entities.screen).toBeUndefined();
  });

  test("explain_app_field returns the controlled dictionary text for a known term", () => {
    const result = derivePolicy(turn("explain_app_field", { term: "RPE" }), null);
    expect(result.action).toBe("answer");
    expect(result.spokenResponse).toMatch(/RPE is how hard/i);
  });

  test("explain_app_field with an unrecognized term asks rather than inventing an answer", () => {
    const result = derivePolicy(turn("explain_app_field", { term: "periodization theory" }), null);
    expect(result.missingFields).toEqual(["term"]);
    expect(result.action).toBe("collect_fields");
  });

  test("unknown_intent always rejects with a redirect, never a general answer", () => {
    const result = derivePolicy(turn("unknown_intent", { anything: "goes here" }), null);
    expect(result.action).toBe("reject");
    expect(result.entities).toEqual({});
    expect(result.requiresConfirmation).toBe(false);
  });

  test("a stray entity key outside an intent's own schema is dropped, defense-in-depth", () => {
    const result = derivePolicy(
      turn("add_water", { amountMl: 500, coachId: "507f1f77bcf86cd799439011" } as Record<string, unknown>),
      null
    );
    expect(result.entities.coachId).toBeUndefined();
  });
});

describe("voiceIntentPolicy — log_heart_rate", () => {
  test("with no values is incomplete", () => {
    const result = derivePolicy(turn("log_heart_rate", {}), null);
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toEqual(["heartRateValue"]);
    expect(result.requiresConfirmation).toBe(true);
  });

  test("wakeHr alone is ready to confirm and doesn't require bedHr", () => {
    const result = derivePolicy(turn("log_heart_rate", { wakeHr: 52 }), null);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.spokenResponse).toMatch(/wake 52/);
    expect(result.spokenResponse).not.toMatch(/bed/);
  });

  test("both wakeHr and bedHr are included in the confirmation", () => {
    const result = derivePolicy(turn("log_heart_rate", { wakeHr: 52, bedHr: 58 }), null);
    expect(result.spokenResponse).toMatch(/wake 52/);
    expect(result.spokenResponse).toMatch(/bed 58/);
  });

  test("an out-of-range value is stripped, not clamped, and reopens collection", () => {
    const result = derivePolicy(turn("log_heart_rate", { wakeHr: 999 }), null);
    expect(result.entities.wakeHr).toBeUndefined();
    expect(result.action).toBe("collect_fields");
  });
});

describe("voiceIntentPolicy — update_profile", () => {
  test("with no fields is incomplete", () => {
    const result = derivePolicy(turn("update_profile", {}), null);
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toEqual(["profileField"]);
  });

  test("height alone is ready to confirm", () => {
    const result = derivePolicy(turn("update_profile", { heightCm: 178 }), null);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.spokenResponse).toMatch(/height 178 cm/);
  });

  test("a stray key like coachId or name is never passed through (allowlist)", () => {
    const result = derivePolicy(
      turn("update_profile", { weightKg: 72, name: "New Name", coachId: "x" } as Record<string, unknown>),
      null
    );
    expect(result.entities.name).toBeUndefined();
    expect(result.entities.coachId).toBeUndefined();
    expect(result.entities.weightKg).toBe(72);
  });
});

describe("voiceIntentPolicy — show_daily_checklist", () => {
  test("is read-only, never requires confirmation, resolves straight to answer", () => {
    const result = derivePolicy(turn("show_daily_checklist"), null);
    expect(result.action).toBe("answer");
    expect(result.requiresConfirmation).toBe(false);
    expect(result.missingFields).toEqual([]);
  });
});

describe("voiceIntentPolicy — change_hydration_reminder honesty (correction #13)", () => {
  test("never claims a fixed-cadence hydration-specific timer", () => {
    const result = derivePolicy(turn("change_hydration_reminder", { intervalMinutes: 90 }), null);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.spokenResponse.toLowerCase()).not.toMatch(/every 90 minutes/);
    expect(result.spokenResponse.toLowerCase()).toMatch(/at least|apart/);
  });

  test("turning reminders off is described plainly", () => {
    const result = derivePolicy(turn("change_hydration_reminder", { enabled: false }), null);
    expect(result.spokenResponse.toLowerCase()).toMatch(/off/);
  });
});

describe("voiceIntentPolicy — meta-intents against pending state", () => {
  const pendingSession: PolicyPendingState = {
    intent: "log_session",
    entities: {
      sessionType: "AM",
      status: "completed",
      rpe: 8,
      effortScore: 9,
      actualDurationMin: 45,
      trainingCategory: "MAX SPEED",
      plannedIntensityPercent: 80,
    },
    missingFields: [],
  };

  test("confirm_action with no pending state has nothing to confirm", () => {
    const result = derivePolicy(turn("confirm_action"), null);
    expect(result.action).toBe("reject");
    expect(result.spokenResponse).toMatch(/nothing to confirm/i);
  });

  test("confirm_action against a complete pending workflow executes", () => {
    const result = derivePolicy(turn("confirm_action"), pendingSession);
    expect(result.action).toBe("execute");
    expect(result.effectiveIntent).toBe("log_session");
    expect(result.entities.rpe).toBe(8);
    expect(result.entities.effortScore).toBe(9);
  });

  test("confirm_action against an incomplete pending workflow keeps collecting", () => {
    const incomplete: PolicyPendingState = { intent: "log_session", entities: { sessionType: "AM" }, missingFields: ["status"] };
    const result = derivePolicy(turn("confirm_action"), incomplete);
    expect(result.action).toBe("collect_fields");
  });

  test("cancel_action discards the pending workflow and reports which intent was cancelled", () => {
    const result = derivePolicy(turn("cancel_action"), pendingSession);
    expect(result.action).toBe("reject");
    expect(result.effectiveIntent).toBe("log_session");
    expect(result.spokenResponse).toMatch(/cancelled/i);
  });

  test("update_field merges only the mentioned field, preserving the rest", () => {
    const result = derivePolicy(turn("update_field", { rpe: 7 }), pendingSession);
    expect(result.entities.rpe).toBe(7);
    expect(result.entities.effortScore).toBe(9); // untouched
    expect(result.entities.sessionType).toBe("AM"); // untouched
    expect(result.entities.actualDurationMin).toBe(45); // untouched
    expect(result.action).toBe("ready_to_confirm");
  });

  test("update_field cannot inject a key outside the pending intent's own schema", () => {
    const result = derivePolicy(
      turn("update_field", { coachId: "507f1f77bcf86cd799439011", intervalMinutes: 30 } as Record<string, unknown>),
      pendingSession
    );
    expect(result.entities.coachId).toBeUndefined();
    expect(result.entities.intervalMinutes).toBeUndefined(); // not in log_session's schema
    // untouched fields survive
    expect(result.entities.rpe).toBe(8);
  });

  test("update_field that removes a required value re-opens collection", () => {
    const pendingWater: PolicyPendingState = { intent: "add_water", entities: { amountMl: 500 }, missingFields: [] };
    const result = derivePolicy(turn("update_field", { amountMl: 9999 }), pendingWater);
    // out-of-range strips the value entirely
    expect(result.entities.amountMl).toBeUndefined();
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toEqual(["amountMl"]);
  });
});

describe("voiceIntentPolicy — malformed/unexpected model output never executes an action", () => {
  test("an intent-only turn with entirely unrelated entities still resolves deterministically", () => {
    const result = derivePolicy(turn("send_coach_note", { unrelatedField: 123 } as Record<string, unknown>), null);
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toEqual(["body"]);
  });

  test("a numeric entity sent as an out-of-range string is stripped, not coerced", () => {
    const result = derivePolicy(turn("log_wellness", { sleepQuality: "99" } as Record<string, unknown>), null);
    expect(result.entities.sleepQuality).toBeUndefined();
    expect(result.missingFields).toContain("sleepQuality");
  });
});
