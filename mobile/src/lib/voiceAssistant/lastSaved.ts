import type { VoiceIntentNameV2 } from "./types";

/**
 * What the assistant saved most recently, so the athlete can say "actually
 * make it one litre" or "undo that" right after. Pure planning only (unit
 * tested); actionDispatch.ts performs the steps.
 */
export type LastSaved = {
  intent: VoiceIntentNameV2;
  entities: Record<string, unknown>;
  /** The write endpoint's response (for water: the day with its entries). */
  response: unknown;
  at: number;
};

/** A correction or undo is only offered this long after the save. */
export const LAST_SAVED_WINDOW_MS = 180_000;

export type FollowUpStep =
  | { kind: "delete_water"; entryId: string }
  | { kind: "execute"; intent: VoiceIntentNameV2; entities: Record<string, unknown> };

export type FollowUpPlan = { steps: FollowUpStep[]; message: string } | { steps: null; message: string };

/** Overwrite-style saves: saving again with the corrected values replaces the earlier ones. */
const RESAVE_INTENTS: VoiceIntentNameV2[] = ["log_wellness", "set_water_goal", "update_profile", "log_heart_rate"];

export function isLastSavedFresh(last: LastSaved | null, now: number): last is LastSaved {
  return Boolean(last) && now - (last as LastSaved).at <= LAST_SAVED_WINDOW_MS;
}

/** The context the server needs to understand a correction ("recentAction" in interpret-v2). */
export function recentActionPayload(last: LastSaved | null, now: number) {
  if (!isLastSavedFresh(last, now)) return undefined;
  return { intent: last.intent, entities: last.entities, secondsAgo: Math.round((now - last.at) / 1000) };
}

function newestWaterEntry(response: unknown): { id: string; amountMl: number } | null {
  const entries = (response as { entries?: { id?: unknown; amountMl?: unknown; loggedAt?: unknown }[] } | null)?.entries;
  if (!Array.isArray(entries)) return null;
  let newest: { id: string; amountMl: number; loggedAt: string } | null = null;
  for (const entry of entries) {
    if (typeof entry.id !== "string" || typeof entry.loggedAt !== "string") continue;
    if (!newest || entry.loggedAt >= newest.loggedAt) newest = { id: entry.id, amountMl: Number(entry.amountMl) || 0, loggedAt: entry.loggedAt };
  }
  return newest;
}

const ALREADY_SAVED = "That's saved already. You can change it on its screen.";

/** How to carry out an undo or a correction of the last save. */
export function planFollowUp(last: LastSaved, action: "undo_last" | "amend_last", entities: Record<string, unknown>): FollowUpPlan {
  if (last.intent === "add_water") {
    const entry = newestWaterEntry(last.response);
    if (!entry) return { steps: null, message: ALREADY_SAVED };
    if (action === "undo_last") {
      return { steps: [{ kind: "delete_water", entryId: entry.id }], message: `Removed ${entry.amountMl} ml of water.` };
    }
    const amount = typeof entities.amountMl === "number" ? entities.amountMl : null;
    if (!amount) return { steps: null, message: "How much water should it be?" };
    return {
      steps: [
        { kind: "delete_water", entryId: entry.id },
        { kind: "execute", intent: "add_water", entities: { amountMl: amount } },
      ],
      message: `Changed it to ${amount} ml.`,
    };
  }

  if (last.intent === "mark_rest_day") {
    if (action === "undo_last") {
      return { steps: [{ kind: "execute", intent: "mark_rest_day", entities: { ...last.entities, enabled: false } }], message: "Okay, today is not a rest day." };
    }
    return { steps: null, message: ALREADY_SAVED };
  }

  if (action === "amend_last" && RESAVE_INTENTS.includes(last.intent)) {
    return { steps: [{ kind: "execute", intent: last.intent, entities }], message: "Updated." };
  }

  return { steps: null, message: ALREADY_SAVED };
}
