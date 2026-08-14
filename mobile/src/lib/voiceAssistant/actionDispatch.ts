import { apiJson, ApiError } from "../api";
import { buildVoiceAction } from "./actionMapping";
import type { CoachOption, VoiceIntentNameV2 } from "./types";

/** GET /api/athlete/coaches — the real, server-fetched assignment list. send_coach_note always resolves its target from this, never from anything the model proposed (plan §9). */
export async function fetchAssignedCoaches(): Promise<CoachOption[]> {
  const res = await apiJson<{ coaches: CoachOption[] }>("/api/athlete/coaches");
  return res.coaches;
}

const API_ERROR_MESSAGES: Record<string, string> = {
  invalid_amountMl: "That water amount doesn't look right.",
  invalid_sessionType: "I didn't catch which session that was.",
  invalid_status: "I didn't catch the session status.",
  invalid_trainingCategory: "I need a valid training category to save that RPE.",
  invalid_plannedIntensityPercent: "I need the planned intensity to save that RPE.",
  invalid_hydrationGoalMl: "That water goal doesn't look right.",
  invalid_wakeHr: "That waking heart rate doesn't look right.",
  invalid_bedHr: "That resting heart rate doesn't look right.",
  invalid_heightCm: "That height doesn't look right.",
  invalid_weightKg: "That weight doesn't look right.",
  invalid_minIntervalMinutes: "That reminder spacing doesn't look right.",
  coach_not_assigned: "That coach isn't assigned to you anymore.",
  athlete_profile_not_found: "Something went wrong finding your profile. Please try again.",
};

function humanizeExecuteError(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed.error && API_ERROR_MESSAGES[parsed.error]) return API_ERROR_MESSAGES[parsed.error];
    } catch {
      // fall through to the generic message below
    }
  }
  return "Something went wrong saving that. Please try again.";
}

export type ExecuteVoiceActionResult = { message: string };

/**
 * Performs the actual save for a confirmed voice action — the write only
 * ever happens here, after the athlete has said yes (plan's confirm-before-write
 * requirement, enforced by the caller checking requiresConfirmation before
 * ever reaching this function).
 */
export async function executeVoiceAction(
  intent: VoiceIntentNameV2,
  entities: Record<string, unknown>,
  opts: { clientActionId: string; coachId?: string }
): Promise<ExecuteVoiceActionResult> {
  const mapping = buildVoiceAction(intent, entities, opts);

  if (mapping.kind === "needs_coach") {
    throw new Error("A coach must be resolved before sending a message — call fetchAssignedCoaches() first.");
  }
  if (mapping.kind === "unsupported") {
    throw new Error(`No save action exists for intent "${intent}".`);
  }

  try {
    await apiJson(mapping.path, { method: mapping.method, body: JSON.stringify(mapping.body) });
    return { message: mapping.successMessage };
  } catch (err) {
    throw new Error(humanizeExecuteError(err));
  }
}
