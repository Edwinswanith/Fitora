import { initialVoiceAssistantState, voiceAssistantReducer, type VoiceAssistantState } from "../voiceAssistant/state";
import type { InterpretV2Response } from "../voiceAssistant/types";

function turn(overrides: Partial<InterpretV2Response>): InterpretV2Response {
  return {
    intent: "add_water",
    entities: {},
    missingFields: [],
    action: "collect_fields",
    requiresConfirmation: true,
    spokenResponse: "",
    ...overrides,
  };
}

describe("voiceAssistantReducer — phase transitions", () => {
  test("LISTENING resets to a clean listening state", () => {
    const dirty: VoiceAssistantState = { ...initialVoiceAssistantState, phase: "error", errorMessage: "boom" };
    const next = voiceAssistantReducer(dirty, { type: "LISTENING" });
    expect(next.phase).toBe("listening");
    expect(next.errorMessage).toBeNull();
  });

  test("an incomplete turn (collect_fields) moves to collecting and keeps entities", () => {
    const next = voiceAssistantReducer(initialVoiceAssistantState, {
      type: "TURN",
      payload: turn({ action: "collect_fields", entities: { amountMl: undefined }, missingFields: ["amountMl"] }),
      clientActionId: "id-1",
    });
    expect(next.phase).toBe("collecting");
    expect(next.missingFields).toEqual(["amountMl"]);
  });

  test("a complete turn (ready_to_confirm) moves to confirming and adopts the offered clientActionId", () => {
    const next = voiceAssistantReducer(initialVoiceAssistantState, {
      type: "TURN",
      payload: turn({ action: "ready_to_confirm", entities: { amountMl: 500 }, missingFields: [] }),
      clientActionId: "id-1",
    });
    expect(next.phase).toBe("confirming");
    expect(next.clientActionId).toBe("id-1");
  });

  test("re-confirming after a correction keeps the ORIGINAL clientActionId, never regenerates it", () => {
    const confirming: VoiceAssistantState = {
      ...initialVoiceAssistantState,
      phase: "confirming",
      clientActionId: "original-id",
    };
    const next = voiceAssistantReducer(confirming, {
      type: "TURN",
      payload: turn({ action: "ready_to_confirm", entities: { amountMl: 750 }, missingFields: [] }),
      clientActionId: "a-fresh-id-that-should-be-ignored",
    });
    expect(next.clientActionId).toBe("original-id");
  });

  test("navigate/answer resolve straight to done with no confirmation", () => {
    const nav = voiceAssistantReducer(initialVoiceAssistantState, {
      type: "TURN",
      payload: turn({ intent: "open_screen", action: "navigate", requiresConfirmation: false }),
      clientActionId: null,
    });
    expect(nav.phase).toBe("done");

    const answer = voiceAssistantReducer(initialVoiceAssistantState, {
      type: "TURN",
      payload: turn({ intent: "show_readiness", action: "answer", requiresConfirmation: false }),
      clientActionId: null,
    });
    expect(answer.phase).toBe("done");
  });

  test("reject resolves back to idle", () => {
    const next = voiceAssistantReducer(initialVoiceAssistantState, {
      type: "TURN",
      payload: turn({ intent: "unknown_intent", action: "reject", requiresConfirmation: false }),
      clientActionId: null,
    });
    expect(next.phase).toBe("idle");
  });

  test("ANSWERED carries the real fetched answer text, separate from a save's successMessage", () => {
    const next = voiceAssistantReducer(initialVoiceAssistantState, { type: "ANSWERED", text: "Your readiness today is 82 out of 100." });
    expect(next.phase).toBe("done");
    expect(next.answerText).toBe("Your readiness today is 82 out of 100.");
    expect(next.successMessage).toBeNull();
  });

  test("NEEDS_COACH surfaces the real fetched coach list, never an invented one", () => {
    const next = voiceAssistantReducer(initialVoiceAssistantState, {
      type: "NEEDS_COACH",
      coaches: [{ coachId: "c1", name: "Coach Ada" }, { coachId: "c2", name: "Coach Bo" }],
    });
    expect(next.phase).toBe("needs_coach");
    expect(next.coachChoices).toHaveLength(2);
  });

  test("COACH_CHOSEN resolves back to confirming with the picked coachId stored", () => {
    const needsCoach: VoiceAssistantState = { ...initialVoiceAssistantState, phase: "needs_coach", coachChoices: [] };
    const next = voiceAssistantReducer(needsCoach, { type: "COACH_CHOSEN", coachId: "c1" });
    expect(next.phase).toBe("confirming");
    expect(next.resolvedCoachId).toBe("c1");
    expect(next.coachChoices).toBeNull();
  });

  test("EXECUTED clears the whole workflow back to a fresh idle-adjacent state, keeping only the success message", () => {
    const confirming: VoiceAssistantState = { ...initialVoiceAssistantState, phase: "confirming", intent: "add_water", clientActionId: "id-1" };
    const next = voiceAssistantReducer(confirming, { type: "EXECUTED", message: "Water logged." });
    expect(next.phase).toBe("done");
    expect(next.successMessage).toBe("Water logged.");
    expect(next.intent).toBeNull();
    expect(next.clientActionId).toBeNull();
  });

  test("ERROR preserves the in-progress workflow (so the athlete can retry) rather than discarding it", () => {
    const confirming: VoiceAssistantState = { ...initialVoiceAssistantState, phase: "confirming", intent: "add_water", entities: { amountMl: 500 } };
    const next = voiceAssistantReducer(confirming, { type: "ERROR", message: "Network error." });
    expect(next.phase).toBe("error");
    expect(next.errorMessage).toBe("Network error.");
    expect(next.entities).toEqual({ amountMl: 500 });
  });

  test("RESET always returns to the exact initial state", () => {
    const dirty: VoiceAssistantState = { ...initialVoiceAssistantState, phase: "confirming", intent: "add_water" };
    expect(voiceAssistantReducer(dirty, { type: "RESET" })).toEqual(initialVoiceAssistantState);
  });
});
