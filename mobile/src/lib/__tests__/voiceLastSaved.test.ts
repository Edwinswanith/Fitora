import { planFollowUp, recentActionPayload, type LastSaved } from "../voiceAssistant/lastSaved";
import { buildVoiceAction } from "../voiceAssistant/actionMapping";

const waterDay = {
  entries: [
    { id: "a", amountMl: 500, loggedAt: "2026-10-13T08:00:00.000Z" },
    { id: "b", amountMl: 750, loggedAt: "2026-10-13T09:00:00.000Z" },
  ],
};
const water: LastSaved = { intent: "add_water", entities: { amountMl: 750 }, response: waterDay, at: 1_000_000 };

describe("voice: undo or change the last save", () => {
  it("undo removes exactly the water entry just logged", () => {
    expect(planFollowUp(water, "undo_last", {})).toEqual({ steps: [{ kind: "delete_water", entryId: "b" }], message: "Removed 750 ml of water." });
  });

  it("a correction replaces the entry with the new amount", () => {
    const plan = planFollowUp(water, "amend_last", { amountMl: 1000 });
    expect(plan.steps).toEqual([
      { kind: "delete_water", entryId: "b" },
      { kind: "execute", intent: "add_water", entities: { amountMl: 1000 } },
    ]);
    expect(plan.message).toBe("Changed it to 1000 ml.");
  });

  it("a check-in correction saves the corrected scores again", () => {
    const checkIn: LastSaved = { intent: "log_wellness", entities: { mood: 8 }, response: {}, at: 0 };
    expect(planFollowUp(checkIn, "amend_last", { mood: 5 }).steps).toEqual([{ kind: "execute", intent: "log_wellness", entities: { mood: 5 } }]);
    expect(planFollowUp(checkIn, "undo_last", {}).steps).toBeNull();
  });

  it("only offers the context for three minutes", () => {
    expect(recentActionPayload(water, water.at + 30_000)).toEqual({ intent: "add_water", entities: { amountMl: 750 }, secondsAgo: 30 });
    expect(recentActionPayload(water, water.at + 181_000)).toBeUndefined();
    expect(recentActionPayload(null, 0)).toBeUndefined();
  });
});

describe("voice: check-in scores are saved as whole 1-5 values", () => {
  it("rounds the spoken 1-10 scale", () => {
    const action = buildVoiceAction("log_wellness", { sleepQuality: 8, mood: 7, stress: 3, soreness: 4, fatigue: 2, fullCheckIn: true }, { clientActionId: "x" });
    expect(action).toMatchObject({ kind: "http", body: { sleepQuality: 4, mood: 4, stress: 2, soreness: 2, fatigue: 1 } });
    expect((action as { body: Record<string, unknown> }).body.fullCheckIn).toBeUndefined();
  });
});
