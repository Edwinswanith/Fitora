import { spokenTenToFive } from "../wellnessScale";
import type { VoiceIntentNameV2 } from "./types";

/**
 * Pure mapping from a confirmed voice action (intent + validated entities)
 * to the existing REST call that actually saves it (plan §4's API-action
 * table). No network/Expo/React import here on purpose — this is the one
 * piece of the voice-assistant client worth unit testing directly, the same
 * way mobile/src/lib/askAgentReportIntents.ts's pure classifiers are tested.
 *
 * Every write here reuses an already-validated, already-secured endpoint —
 * this layer only decides which one and reshapes the entity names/scale to
 * match it. It never invents a value beyond what derivePolicy already
 * confirmed with the athlete.
 */
export type HttpWriteAction = {
  kind: "http";
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  successMessage: string;
};

/** send_coach_note needs a real coachId resolved (GET /api/athlete/coaches) before this can build a request — never from the model. */
export type NeedsCoachAction = { kind: "needs_coach" };
export type UnsupportedAction = { kind: "unsupported" };

export type VoiceActionMapping = HttpWriteAction | NeedsCoachAction | UnsupportedAction;

export type BuildVoiceActionOptions = {
  clientActionId: string;
  coachId?: string;
};

const WELLNESS_KEYS = ["sleepQuality", "mood", "stress", "soreness", "fatigue"] as const;

export function buildVoiceAction(
  intent: VoiceIntentNameV2,
  entities: Record<string, unknown>,
  opts: BuildVoiceActionOptions
): VoiceActionMapping {
  switch (intent) {
    case "log_session": {
      const rpe = typeof entities.rpe === "number" ? entities.rpe : undefined;
      return {
        kind: "http",
        method: "POST",
        path: "/api/athlete/voice/log-session",
        body: {
          sessionType: entities.sessionType,
          status: entities.status,
          workoutType: entities.workoutType,
          actualDurationMin: entities.actualDurationMin,
          sets: entities.sets,
          reps: entities.reps,
          notes: entities.notes,
          effortScore: entities.effortScore,
          rpe,
          trainingCategory: rpe !== undefined ? entities.trainingCategory : undefined,
          plannedIntensityPercent: rpe !== undefined ? entities.plannedIntensityPercent : undefined,
          clientActionId: opts.clientActionId,
        },
        successMessage: "Session saved.",
      };
    }

    case "log_rpe": {
      // POST /api/athlete/rpe-monitoring hard-requires four 0-5 wellness
      // sub-scores the athlete was never asked for in a bare "log my RPE"
      // turn — the /voice/log-session orchestration endpoint backfills those
      // from today's real check-in instead, so a standalone RPE reading
      // routes through it too. Reporting an RPE implies the session already
      // happened, so status defaults to "completed" when not otherwise known.
      return {
        kind: "http",
        method: "POST",
        path: "/api/athlete/voice/log-session",
        body: {
          sessionType: entities.sessionType ?? "AM",
          status: "completed",
          rpe: entities.rpe,
          trainingCategory: entities.trainingCategory,
          plannedIntensityPercent: entities.plannedIntensityPercent,
          clientActionId: opts.clientActionId,
        },
        successMessage: "RPE saved.",
      };
    }

    case "log_wellness": {
      const body: Record<string, unknown> = {};
      for (const key of WELLNESS_KEYS) {
        const value = entities[key];
        if (typeof value === "number") body[key] = spokenTenToFive(value);
      }
      if (typeof entities.sleepHours === "number") body.sleepHours = entities.sleepHours;
      return { kind: "http", method: "POST", path: "/api/athlete/wellness", body, successMessage: "Check-in saved." };
    }

    case "add_water":
      return {
        kind: "http",
        method: "POST",
        path: "/api/athlete/water",
        body: { amountMl: entities.amountMl, clientActionId: opts.clientActionId },
        successMessage: "Water logged.",
      };

    case "set_water_goal":
      return {
        kind: "http",
        method: "PATCH",
        path: "/api/athlete/me",
        body: { hydrationGoalMl: entities.goalMl },
        successMessage: "Water goal updated.",
      };

    case "change_hydration_reminder": {
      const body: Record<string, unknown> = {};
      if (typeof entities.enabled === "boolean") body.enabled = entities.enabled;
      if (typeof entities.intervalMinutes === "number") body.minIntervalMinutes = entities.intervalMinutes;
      return { kind: "http", method: "PATCH", path: "/api/notification-preferences", body, successMessage: "Reminder settings updated." };
    }

    case "log_recovery": {
      // POST /api/athlete/recovery has no "skipped" field — synthesize an
      // empty, noted entry rather than inventing a status the server can't record.
      const body: Record<string, unknown> =
        entities.skipped === true ? { modalities: [], note: "Skipped recovery today" } : { modalities: entities.modalities ?? [] };
      return { kind: "http", method: "POST", path: "/api/athlete/recovery", body, successMessage: "Recovery saved." };
    }

    case "mark_rest_day":
      return {
        kind: "http",
        method: "POST",
        path: "/api/athlete/rest-day",
        body: { enabled: entities.enabled ?? true },
        successMessage: "Rest day marked.",
      };

    case "log_heart_rate":
      return {
        kind: "http",
        method: "POST",
        path: "/api/athlete/heart-rate",
        body: { wakeHr: entities.wakeHr, bedHr: entities.bedHr },
        successMessage: "Heart rate saved.",
      };

    case "update_profile": {
      const body: Record<string, unknown> = {};
      if (typeof entities.heightCm === "number") body.heightCm = entities.heightCm;
      if (typeof entities.weightKg === "number") body.weightKg = entities.weightKg;
      if (typeof entities.position === "string") body.position = entities.position;
      return { kind: "http", method: "PATCH", path: "/api/athlete/me", body, successMessage: "Profile updated." };
    }

    case "send_coach_note": {
      if (!opts.coachId) return { kind: "needs_coach" };
      return {
        kind: "http",
        method: "POST",
        path: `/api/athlete/messages/${opts.coachId}`,
        body: { body: entities.body, clientActionId: opts.clientActionId },
        successMessage: "Message sent to your coach.",
      };
    }

    case "add_note":
      return {
        kind: "http",
        method: "POST",
        path: "/api/athlete/notes",
        body: { body: entities.body, clientActionId: opts.clientActionId },
        successMessage: "Note saved.",
      };

    default:
      return { kind: "unsupported" };
  }
}
