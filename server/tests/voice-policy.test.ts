import { derivePolicy, type PolicyPendingState, type SanitizedTurn } from "../src/services/voiceIntentPolicy";

function turn(intent: SanitizedTurn["intent"], entities: Record<string, unknown> = {}, confidence = 0.9): SanitizedTurn {
  return { intent, entities, confidence };
}

describe("voiceIntentPolicy — fresh intents", () => {
  test("log_wellness with no fields is incomplete", () => {
    const result = derivePolicy(turn("log_wellness", {}), null);
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toContain("sleepQuality");
    expect(result.requiresConfirmation).toBe(false);
  });

  test("log_wellness with a value present auto-executes — no confirmation needed for a simple reversible log", () => {
    const result = derivePolicy(turn("log_wellness", { sleepQuality: 8 }), null);
    expect(result.action).toBe("execute");
    expect(result.missingFields).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
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
    expect(result.action).toBe("execute");
    expect(result.entities.rpe).toBe(8);
    expect(result.entities.effortScore).toBeUndefined();
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
    expect(result.missingFields).toEqual(["rpe", "trainingCategory", "plannedIntensityPercent"]);
    expect(result.action).toBe("collect_fields");
  });

  test("log_rpe with rpe, category and planned intensity auto-executes", () => {
    const result = derivePolicy(turn("log_rpe", { rpe: 7, trainingCategory: "ENDURANCE", plannedIntensityPercent: 70 }), null);
    expect(result.action).toBe("execute");
    expect(result.entities.rpe).toBe(7);
  });

  test("a bare 'RPE 8' asks for category and planned intensity instead of failing on save", () => {
    const result = derivePolicy(turn("log_rpe", { rpe: 8 }), null);
    expect(result.action).toBe("collect_fields");
    expect(result.missingFields).toEqual(["trainingCategory", "plannedIntensityPercent"]);
  });

  test("log_rpe rejects a trainingCategory outside the allowlist", () => {
    const result = derivePolicy(turn("log_rpe", { rpe: 6, trainingCategory: "Made Up Category" }), null);
    expect(result.entities.trainingCategory).toBeUndefined();
  });

  test("add_water requires amountMl and strips out-of-range values", () => {
    const tooMuch = derivePolicy(turn("add_water", { amountMl: 9000 }), null);
    expect(tooMuch.missingFields).toEqual(["amountMl"]);
    const ok = derivePolicy(turn("add_water", { amountMl: 500 }), null);
    expect(ok.action).toBe("execute");
    expect(ok.requiresConfirmation).toBe(false);
    expect(ok.entities.amountMl).toBe(500);
  });

  test("show_hydration is read-only, needs no confirmation", () => {
    const result = derivePolicy(turn("show_hydration", {}), null);
    expect(result.action).toBe("answer");
    expect(result.requiresConfirmation).toBe(false);
  });

  test("show_nutrition and show_upcoming_session are read-only answers", () => {
    const nutrition = derivePolicy(turn("show_nutrition", {}), null);
    expect(nutrition.action).toBe("answer");
    expect(nutrition.requiresConfirmation).toBe(false);

    const session = derivePolicy(turn("show_upcoming_session", {}), null);
    expect(session.action).toBe("answer");
    expect(session.requiresConfirmation).toBe(false);
  });

  test("log_meal requires meal type, food name, and calories before it can save", () => {
    const incomplete = derivePolicy(turn("log_meal", { mealType: "lunch", foodName: "Chicken rice bowl" }), null);
    expect(incomplete.action).toBe("collect_fields");
    expect(incomplete.missingFields).toEqual(["calories"]);

    const ready = derivePolicy(
      turn("log_meal", { mealType: "Lunch", foodName: "Chicken rice bowl", calories: 650, proteinG: 45 }),
      null
    );
    expect(ready.action).toBe("execute");
    expect(ready.requiresConfirmation).toBe(false);
    expect(ready.entities.mealType).toBe("lunch");
    expect(ready.entities.calories).toBe(650);
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
    expect(result.requiresConfirmation).toBe(false);
  });

  test("wakeHr alone auto-executes and doesn't require bedHr", () => {
    const result = derivePolicy(turn("log_heart_rate", { wakeHr: 52 }), null);
    expect(result.action).toBe("execute");
    expect(result.entities.wakeHr).toBe(52);
    expect(result.entities.bedHr).toBeUndefined();
  });

  test("both wakeHr and bedHr are included when both are given", () => {
    const result = derivePolicy(turn("log_heart_rate", { wakeHr: 52, bedHr: 58 }), null);
    expect(result.entities.wakeHr).toBe(52);
    expect(result.entities.bedHr).toBe(58);
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

  test("height alone auto-executes", () => {
    const result = derivePolicy(turn("update_profile", { heightCm: 178 }), null);
    expect(result.action).toBe("execute");
    expect(result.entities.heightCm).toBe(178);
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
  test("auto-executes without ever claiming a fixed-cadence hydration-specific timer", () => {
    const result = derivePolicy(turn("change_hydration_reminder", { intervalMinutes: 90 }), null);
    expect(result.action).toBe("execute");
    expect(result.entities.intervalMinutes).toBe(90);
    expect(result.spokenResponse.toLowerCase()).not.toMatch(/every 90 minutes/);
  });

  test("turning reminders off still resolves the enabled flag correctly", () => {
    const result = derivePolicy(turn("change_hydration_reminder", { enabled: false }), null);
    expect(result.action).toBe("execute");
    expect(result.entities.enabled).toBe(false);
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
    expect(result.action).toBe("execute"); // log_session is a simple reversible log — no confirmation needed
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

describe("voiceIntentPolicy — send_coach_note is the one write intent that still requires confirmation", () => {
  test("a complete send_coach_note is ready_to_confirm, not auto-executed", () => {
    const result = derivePolicy(turn("send_coach_note", { body: "Running 10 minutes late today" }), null);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.spokenResponse).toMatch(/Running 10 minutes late today/);
  });

  test("update_field completing a pending send_coach_note still asks for confirmation, not auto-execute", () => {
    const pendingNote: PolicyPendingState = { intent: "send_coach_note", entities: {}, missingFields: ["body"] };
    const result = derivePolicy(turn("update_field", { body: "See you at practice" }), pendingNote);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.requiresConfirmation).toBe(true);
  });

  test("saying yes to a pending send_coach_note executes it", () => {
    const pendingNote: PolicyPendingState = { intent: "send_coach_note", entities: { body: "See you at practice" }, missingFields: [] };
    const result = derivePolicy(turn("confirm_action"), pendingNote);
    expect(result.action).toBe("execute");
  });
});

describe("voiceIntentPolicy — low-confidence classifications are never acted on", () => {
  test("a fresh, low-confidence turn with no pending workflow asks the athlete to repeat, without guessing", () => {
    const result = derivePolicy(turn("add_water", { amountMl: 500 }, 0.2), null);
    expect(result.action).toBe("reject");
    expect(result.spokenResponse).toBe("I didn't catch that. Could you say it again?");
    expect(result.entities).toEqual({});
  });

  test("a low-confidence turn during an in-progress workflow preserves the pending state instead of discarding it", () => {
    const pendingMeal: PolicyPendingState = { intent: "log_meal", entities: { mealType: "lunch", foodName: "Chicken rice bowl" }, missingFields: ["calories"] };
    const result = derivePolicy(turn("add_water", { amountMl: 500 }, 0.2), pendingMeal);
    expect(result.action).toBe("collect_fields");
    expect(result.effectiveIntent).toBe("log_meal");
    expect(result.entities).toEqual(pendingMeal.entities);
    // Re-asks the pending question instead of a generic "say it again".
    expect(result.spokenResponse).toBe("I didn't catch that. How many calories should I log?");
  });

  test("meta-intents (yes/no/correction) are exempt from the confidence gate even when reported low", () => {
    const pendingWater: PolicyPendingState = { intent: "add_water", entities: { amountMl: 500 }, missingFields: [] };
    const result = derivePolicy(turn("confirm_action", {}, 0.1), pendingWater);
    expect(result.action).toBe("execute");
  });

  test("unknown_intent is handled by its own redirect, not the confidence gate, even at zero confidence", () => {
    const result = derivePolicy(turn("unknown_intent", {}, 0), null);
    expect(result.action).toBe("reject");
    expect(result.spokenResponse).toBe("I didn't catch that. Could you say it again?");
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

describe("an unrecognised or garbled turn never throws away an in-progress workflow", () => {
  const mealPending: PolicyPendingState = { intent: "log_meal", entities: { mealType: "lunch", foodName: "rice" }, missingFields: ["calories"] };

  test("unknown_intent mid-collection keeps the workflow and re-asks the missing field", () => {
    const result = derivePolicy(turn("unknown_intent", {}, 0), mealPending);
    expect(result.action).toBe("collect_fields");
    expect(result.effectiveIntent).toBe("log_meal");
    expect(result.entities).toEqual({ mealType: "lunch", foodName: "rice" });
    expect(result.missingFields).toEqual(["calories"]);
    expect(result.spokenResponse).toMatch(/calories/i);
  });

  test("unknown_intent while a coach note awaits confirmation stays a confirmation", () => {
    const notePending: PolicyPendingState = { intent: "send_coach_note", entities: { body: "Knee is sore" }, missingFields: [] };
    const result = derivePolicy(turn("unknown_intent", {}, 0), notePending);
    expect(result.action).toBe("ready_to_confirm");
    expect(result.spokenResponse).toMatch(/yes to send/i);
  });

  test("a low-confidence fresh intent mid-collection also keeps the workflow", () => {
    const result = derivePolicy(turn("add_water", { amountMl: 250 }, 0.2), mealPending);
    expect(result.action).toBe("collect_fields");
    expect(result.effectiveIntent).toBe("log_meal");
  });
});
