/**
 * Deterministic policy engine for the V2 voice assistant pipeline.
 *
 * The LLM (voiceIntentInterpreterV2.ts) classifies intent and extracts
 * entities ONLY — it never decides what happens next. This file is the sole
 * authority for: which fields are still missing, what the next action is,
 * whether confirmation is required, and what the assistant says. All of it
 * is plain, deterministic code — no model calls, no I/O — so it is fully
 * unit-testable and cannot be talked into skipping a confirmation step or
 * inventing a claim (e.g. about a hydration reminder schedule) that isn't
 * backed by a real feature.
 */

import { SESSION_SLOTS, SESSION_STATUS, type SessionSlot } from "../models/TrainingSession";
import { TRAINING_CATEGORIES } from "../lib/trainingCategories";

export const VOICE_INTENTS_V2 = [
  "start_check_in",
  "log_wellness",
  "log_session",
  "log_rpe",
  "add_water",
  "show_hydration",
  "set_water_goal",
  "change_hydration_reminder",
  "log_recovery",
  "mark_rest_day",
  "log_heart_rate",
  "update_profile",
  "send_coach_note",
  "add_note",
  "show_readiness",
  "show_today_plan",
  "show_progress",
  "show_coach_feedback",
  "show_daily_checklist",
  "open_screen",
  "explain_app_field",
  "update_field",
  "confirm_action",
  "cancel_action",
  "unknown_intent",
] as const;
export type VoiceIntentNameV2 = (typeof VOICE_INTENTS_V2)[number];

export const VOICE_ACTIONS = [
  "collect_fields",
  "ready_to_confirm",
  "execute",
  "navigate",
  "answer",
  "reject",
] as const;
export type VoiceAction = (typeof VOICE_ACTIONS)[number];

/** Meta-intents that act on an already-pending workflow rather than starting a new one. */
const META_INTENTS: VoiceIntentNameV2[] = ["update_field", "confirm_action", "cancel_action"];

/** Read-only intents — never require confirmation, never write anything. */
const READ_ONLY_INTENTS: VoiceIntentNameV2[] = [
  "show_readiness",
  "show_today_plan",
  "show_progress",
  "show_coach_feedback",
  "show_hydration",
  "show_daily_checklist",
];

/** Intents that save/update/send data — confirmation is mandatory, hardcoded, never model-decided. */
const WRITE_INTENTS: VoiceIntentNameV2[] = [
  "log_wellness",
  "log_session",
  "log_rpe",
  "add_water",
  "set_water_goal",
  "change_hydration_reminder",
  "log_recovery",
  "mark_rest_day",
  "log_heart_rate",
  "update_profile",
  "send_coach_note",
  "add_note",
];

export const OPEN_SCREEN_ALLOWLIST = [
  "today",
  "progress",
  "log",
  "coach",
  "messages",
  "water",
  "goals",
  "trends",
] as const;
export type OpenScreenTarget = (typeof OPEN_SCREEN_ALLOWLIST)[number];

export const RECOVERY_MODALITIES = ["stretching", "ice_bath", "mobility", "physio", "hydration"] as const;
export type RecoveryModality = (typeof RECOVERY_MODALITIES)[number];

/** Controlled, pre-written explanations for Apex-specific terms only (correction #9). */
export const APP_FIELD_EXPLANATIONS: Record<string, string> = {
  rpe: "RPE is how hard a single session felt, on a 0 to 10 scale you report right after training.",
  rpm: "RPM monitoring tracks your training load and flags risk based on RPE, sleep, soreness, and fatigue.",
  readiness: "Readiness is a score from your sleep, mood, stress, soreness, and fatigue check-in.",
  "readiness score": "Your readiness score comes from sleep, mood, stress, soreness, and fatigue.",
  "training load": "Training load is your planned intensity multiplied by your session RPE.",
  "risk flag": "A risk flag is green, amber, or red, based on your RPE, sleep, and fatigue trends.",
  "effort score": "Effort score is how hard you pushed in a session, separate from RPE.",
  "recovery modality": "Recovery modalities are stretching, ice bath, mobility, physio, or hydration work.",
  "hydration goal": "Your hydration goal is your daily water target in millilitres, set by you.",
};

const NUMERIC_ENTITY_RANGES: Record<string, [number, number]> = {
  sleepHours: [0, 14],
  sleepQuality: [1, 10],
  mood: [1, 10],
  stress: [1, 10],
  soreness: [1, 10],
  fatigue: [1, 10],
  amountMl: [1, 4000],
  goalMl: [500, 8000],
  sets: [0, 200],
  actualDurationMin: [0, 600],
  effortScore: [1, 10],
  rpe: [0, 10],
  plannedIntensityPercent: [0, 100],
  restingHeartRate: [20, 220],
  intervalMinutes: [15, 720],
  wakeHr: [25, 220],
  bedHr: [25, 220],
  heightCm: [50, 250],
  weightKg: [20, 250],
};

/**
 * Which entity keys belong to each intent's own schema. `update_field` may
 * only ever touch keys in this set for the pending intent — this is the
 * allowlist that stops a correction turn from injecting an unrelated field
 * (§7 of the plan).
 */
const INTENT_ENTITY_KEYS: Partial<Record<VoiceIntentNameV2, string[]>> = {
  log_wellness: ["sleepHours", "sleepQuality", "mood", "stress", "soreness", "fatigue"],
  log_session: [
    "sessionType",
    "status",
    "workoutType",
    "actualDurationMin",
    "sets",
    "reps",
    "notes",
    "rpe",
    "effortScore",
    "trainingCategory",
    "plannedIntensityPercent",
  ],
  log_rpe: [
    "sessionType",
    "trainingCategory",
    "plannedIntensityPercent",
    "rpe",
    "bodyConditionFeedback",
    "restingHeartRate",
    "sleepQuality",
    "muscleSoreness",
    "fatigue",
    "moodMotivation",
  ],
  add_water: ["amountMl"],
  show_hydration: [],
  set_water_goal: ["goalMl"],
  change_hydration_reminder: ["enabled", "intervalMinutes"],
  log_recovery: ["modalities", "skipped", "note"],
  mark_rest_day: ["enabled", "date"],
  log_heart_rate: ["wakeHr", "bedHr"],
  // name/dob/sport are deliberately excluded — identity fields, low-value
  // and error-prone to fill by voice. timezone is auto-detected by the app,
  // not something an athlete would naturally say aloud.
  update_profile: ["heightCm", "weightKg", "position"],
  send_coach_note: ["body"],
  add_note: ["body"],
  open_screen: ["screen"],
  explain_app_field: ["term"],
  // Explicitly empty — these intents take no entities at all; any key the
  // model returned for them is dropped, not passed through.
  start_check_in: [],
  show_readiness: [],
  show_today_plan: [],
  show_progress: [],
  show_coach_feedback: [],
  show_daily_checklist: [],
  unknown_intent: [],
};

/** Drops any entity key that doesn't belong to this intent's own schema. Unmapped intents get no entities at all. */
function filterToIntentKeys(intent: VoiceIntentNameV2, entities: Record<string, unknown>): Record<string, unknown> {
  const allowed = INTENT_ENTITY_KEYS[intent] ?? [];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in entities) out[key] = entities[key];
  }
  return out;
}

export type PolicyPendingState = {
  intent: VoiceIntentNameV2;
  entities: Record<string, unknown>;
  missingFields: string[];
} | null;

export type SanitizedTurn = {
  intent: VoiceIntentNameV2;
  entities: Record<string, unknown>;
  confidence: number;
};

export type PolicyResult = {
  /** The workflow this result actually pertains to — for meta-intents this is the PENDING intent, not the meta-intent itself. */
  effectiveIntent: VoiceIntentNameV2;
  entities: Record<string, unknown>;
  missingFields: string[];
  action: VoiceAction;
  requiresConfirmation: boolean;
  spokenResponse: string;
};

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Strips any entity that fails its allowlist/range check, in place. Never
 * coerces to the nearest valid value — an invalid value is simply removed,
 * which the required-field rules below will then surface as missing.
 */
function sanitizeEntities(intent: VoiceIntentNameV2, entities: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entities };

  for (const [field, [min, max]] of Object.entries(NUMERIC_ENTITY_RANGES)) {
    if (!(field in out)) continue;
    const value = finiteNumber(out[field]);
    if (value === undefined || value < min || value > max) {
      delete out[field];
      continue;
    }
    out[field] = field === "amountMl" || field === "goalMl" || field === "sets" || field === "actualDurationMin" || field === "intervalMinutes" ? Math.round(value) : value;
  }

  if ("sessionType" in out && !SESSION_SLOTS.includes(out.sessionType as SessionSlot)) delete out.sessionType;
  if ("status" in out && typeof out.status === "string" && !SESSION_STATUS.includes(out.status as (typeof SESSION_STATUS)[number])) {
    delete out.status;
  }
  if ("trainingCategory" in out && !TRAINING_CATEGORIES.includes(out.trainingCategory as (typeof TRAINING_CATEGORIES)[number])) {
    delete out.trainingCategory;
  }
  if ("screen" in out && !OPEN_SCREEN_ALLOWLIST.includes(out.screen as OpenScreenTarget)) delete out.screen;
  if (Array.isArray(out.modalities)) {
    out.modalities = out.modalities.filter((m): m is RecoveryModality => RECOVERY_MODALITIES.includes(m as RecoveryModality));
  }
  if ("term" in out && typeof out.term === "string") {
    const key = out.term.trim().toLowerCase();
    out.term = key in APP_FIELD_EXPLANATIONS ? key : undefined;
    if (out.term === undefined) delete out.term;
  }
  for (const key of ["body", "workoutType", "reps", "notes", "bodyConditionFeedback", "position"]) {
    if (key in out && typeof out[key] !== "string") delete out[key];
  }
  if ("position" in out && typeof out.position === "string") {
    const trimmed = out.position.trim();
    if (!trimmed || trimmed.length > 80) delete out.position;
    else out.position = trimmed;
  }
  if ("body" in out && typeof out.body === "string") out.body = out.body.trim();
  if (out.body === "") delete out.body;
  if ("enabled" in out && typeof out.enabled !== "boolean") delete out.enabled;

  return out;
}

/** One hardcoded required-field rule per intent. Never merges rpe/effortScore (correction #3). */
function requiredMissingFields(intent: VoiceIntentNameV2, entities: Record<string, unknown>): string[] {
  switch (intent) {
    case "log_wellness": {
      const any = ["sleepHours", "sleepQuality", "mood", "stress", "soreness", "fatigue"].some(
        (f) => typeof entities[f] === "number"
      );
      return any ? [] : ["sleepQuality"];
    }
    case "log_session": {
      const missing: string[] = [];
      if (typeof entities.sessionType !== "string") missing.push("sessionType");
      if (typeof entities.status !== "string") missing.push("status");
      // An RPE reading can only be saved alongside a full RpeMonitoring row,
      // which requires a training category and planned intensity — so once
      // rpe is present, these become required too (never defaulted/invented).
      if (typeof entities.rpe === "number") {
        if (typeof entities.trainingCategory !== "string") missing.push("trainingCategory");
        if (typeof entities.plannedIntensityPercent !== "number") missing.push("plannedIntensityPercent");
      }
      return missing;
    }
    case "log_rpe":
      return typeof entities.rpe === "number" ? [] : ["rpe"];
    case "add_water":
      return typeof entities.amountMl === "number" ? [] : ["amountMl"];
    case "set_water_goal":
      return typeof entities.goalMl === "number" ? [] : ["goalMl"];
    case "change_hydration_reminder":
      return typeof entities.enabled === "boolean" || typeof entities.intervalMinutes === "number" ? [] : ["reminderChange"];
    case "log_recovery": {
      const hasModalities = Array.isArray(entities.modalities) && entities.modalities.length > 0;
      const skipped = entities.skipped === true;
      return hasModalities || skipped ? [] : ["modalities"];
    }
    case "send_coach_note":
    case "add_note":
      return typeof entities.body === "string" && entities.body.length > 0 ? [] : ["body"];
    case "log_heart_rate":
      return typeof entities.wakeHr === "number" || typeof entities.bedHr === "number" ? [] : ["heartRateValue"];
    case "update_profile": {
      const any = ["heightCm", "weightKg", "position"].some((f) => entities[f] !== undefined);
      return any ? [] : ["profileField"];
    }
    case "open_screen":
      return typeof entities.screen === "string" ? [] : ["screen"];
    case "explain_app_field":
      return typeof entities.term === "string" ? [] : ["term"];
    default:
      return [];
  }
}

const FIELD_FOLLOW_UP_QUESTIONS: Record<string, string> = {
  sleepQuality: "What sleep quality score, one to ten, should I save?",
  sessionType: "Which session — AM, afternoon, or PM?",
  status: "Was it planned, in progress, completed, skipped, or a rest day?",
  rpe: "What was your session RPE, zero to ten?",
  trainingCategory: "Which training category was this — for example endurance, max speed, or strength?",
  plannedIntensityPercent: "What was the planned intensity, as a percent?",
  amountMl: "How much water, in millilitres?",
  goalMl: "What should your new water goal be, in millilitres?",
  reminderChange: "Turn reminders on, off, or change the spacing?",
  modalities: "Which recovery did you do — stretching, ice bath, mobility, or physio? Or should I skip it?",
  body: "What would you like the message to say?",
  screen: "Which screen — today, progress, log, coach, messages, water, goals, or trends?",
  term: "Which term would you like explained?",
  heartRateValue: "What was your heart rate — waking, resting before bed, or both?",
  profileField: "What would you like to update — height, weight, or position?",
};

function formatSessionSummary(entities: Record<string, unknown>): string {
  const parts: string[] = [];
  if (entities.status) parts.push(`${entities.status}`);
  if (entities.workoutType) parts.push(`${entities.workoutType}`);
  if (entities.actualDurationMin) parts.push(`for ${entities.actualDurationMin} minutes`);
  const summary = parts.length ? parts.join(" ") : "this session";
  const rpePart =
    typeof entities.rpe === "number"
      ? `, RPE ${entities.rpe}${entities.trainingCategory ? ` (${entities.trainingCategory}, ${entities.plannedIntensityPercent}% planned)` : ""}`
      : "";
  const effortPart = typeof entities.effortScore === "number" ? ` and effort ${entities.effortScore}` : "";
  const slot = entities.sessionType ? `your ${entities.sessionType} ` : "";
  return `You ${slot}${summary}${rpePart}${effortPart}. Should I save it?`;
}

/** Templated, deterministic spoken text — never model-authored (correction #1, #13). */
function spokenResponseFor(
  intent: VoiceIntentNameV2,
  action: VoiceAction,
  entities: Record<string, unknown>,
  missingFields: string[]
): string {
  if (action === "collect_fields") {
    const field = missingFields[0];
    return FIELD_FOLLOW_UP_QUESTIONS[field] ?? "Could you say that again?";
  }

  if (action === "navigate") {
    return `Opening ${entities.screen ?? "that screen"}.`;
  }

  if (action === "answer") {
    if (intent === "explain_app_field") {
      const term = typeof entities.term === "string" ? entities.term : "";
      return APP_FIELD_EXPLANATIONS[term] ?? "I don't have a definition for that yet.";
    }
    // show_* intents: never state real data here — the app fills this in from
    // fetched records after classification.
    return "Here's what you asked for.";
  }

  if (action === "reject") {
    return "Do you want to log RPE for a session, check your readiness, log a session, or message your coach — what would you like to do?";
  }

  if (action === "execute") {
    return "Saving that now.";
  }

  // ready_to_confirm
  switch (intent) {
    case "log_session":
      return formatSessionSummary(entities);
    case "log_wellness": {
      const bits: string[] = [];
      if (typeof entities.sleepQuality === "number") bits.push(`sleep ${entities.sleepQuality}`);
      if (typeof entities.sleepHours === "number") bits.push(`${entities.sleepHours} hours slept`);
      if (typeof entities.mood === "number") bits.push(`mood ${entities.mood}`);
      if (typeof entities.stress === "number") bits.push(`stress ${entities.stress}`);
      if (typeof entities.soreness === "number") bits.push(`soreness ${entities.soreness}`);
      if (typeof entities.fatigue === "number") bits.push(`fatigue ${entities.fatigue}`);
      return `Save this check-in — ${bits.join(", ") || "no details"}?`;
    }
    case "log_rpe":
      return `Save session RPE ${entities.rpe} ${typeof entities.trainingCategory === "string" ? `for ${entities.trainingCategory}` : ""}?`;
    case "add_water":
      return `Log ${entities.amountMl} ml of water?`;
    case "set_water_goal":
      return `Set your water goal to ${entities.goalMl} ml?`;
    case "change_hydration_reminder": {
      // Correction #13: never claim a fixed-cadence hydration-specific schedule.
      if (typeof entities.enabled === "boolean" && entities.enabled === false) {
        return "Turn reminders off?";
      }
      if (typeof entities.intervalMinutes === "number") {
        return `Space reminders at least ${entities.intervalMinutes} minutes apart?`;
      }
      return "Turn reminders on?";
    }
    case "log_recovery":
      if (entities.skipped === true) return "Skip recovery today?";
      return `Save recovery — ${Array.isArray(entities.modalities) ? (entities.modalities as string[]).join(", ") : "logged"}?`;
    case "mark_rest_day":
      return "Mark today as a rest day?";
    case "log_heart_rate": {
      const parts: string[] = [];
      if (typeof entities.wakeHr === "number") parts.push(`wake ${entities.wakeHr}`);
      if (typeof entities.bedHr === "number") parts.push(`bed ${entities.bedHr}`);
      return `Save heart rate — ${parts.join(", ")} bpm?`;
    }
    case "update_profile": {
      const parts: string[] = [];
      if (typeof entities.heightCm === "number") parts.push(`height ${entities.heightCm} cm`);
      if (typeof entities.weightKg === "number") parts.push(`weight ${entities.weightKg} kg`);
      if (typeof entities.position === "string") parts.push(`position ${entities.position}`);
      return `Update your profile — ${parts.join(", ")}?`;
    }
    case "send_coach_note":
      return `Send this to your coach: "${entities.body}"?`;
    case "add_note":
      return `Save this note: "${entities.body}"?`;
    default:
      return "Should I save this?";
  }
}

/**
 * The single entry point. Given a sanitized model turn and any pending
 * workflow state, derives everything downstream of intent+entities.
 */
export function derivePolicy(turn: SanitizedTurn, pending: PolicyPendingState): PolicyResult {
  const isMeta = META_INTENTS.includes(turn.intent);

  // Meta-intents operate on the pending workflow, not a fresh one.
  if (isMeta) {
    if (!pending) {
      return {
        effectiveIntent: "unknown_intent",
        entities: {},
        missingFields: [],
        action: "reject",
        requiresConfirmation: false,
        spokenResponse: "There's nothing to confirm right now.",
      };
    }

    if (turn.intent === "cancel_action") {
      return {
        effectiveIntent: pending.intent,
        entities: pending.entities,
        missingFields: pending.missingFields,
        action: "reject",
        requiresConfirmation: false,
        spokenResponse: "Okay, cancelled.",
      };
    }

    // update_field: merge ONLY the entity keys present in this turn, and only
    // keys that belong to the pending intent's own schema (allowlist, §7) —
    // a correction turn can never introduce a key the pending intent doesn't declare.
    const incoming = turn.intent === "update_field" ? filterToIntentKeys(pending.intent, turn.entities) : {};
    const mergedRaw = { ...pending.entities, ...incoming };
    const merged = sanitizeEntities(pending.intent, mergedRaw);
    const missingFields = requiredMissingFields(pending.intent, merged);
    const requiresConfirmation = WRITE_INTENTS.includes(pending.intent);

    if (turn.intent === "confirm_action") {
      if (missingFields.length > 0) {
        // Can't confirm an incomplete workflow — keep collecting.
        return {
          effectiveIntent: pending.intent,
          entities: merged,
          missingFields,
          action: "collect_fields",
          requiresConfirmation,
          spokenResponse: spokenResponseFor(pending.intent, "collect_fields", merged, missingFields),
        };
      }
      return {
        effectiveIntent: pending.intent,
        entities: merged,
        missingFields: [],
        action: "execute",
        requiresConfirmation,
        spokenResponse: spokenResponseFor(pending.intent, "execute", merged, []),
      };
    }

    // update_field
    const action: VoiceAction = missingFields.length > 0 ? "collect_fields" : "ready_to_confirm";
    return {
      effectiveIntent: pending.intent,
      entities: merged,
      missingFields,
      action,
      requiresConfirmation,
      spokenResponse: spokenResponseFor(pending.intent, action, merged, missingFields),
    };
  }

  // Fresh (non-meta) intent. Filter to this intent's own declared keys first
  // (defense-in-depth against a malformed/hallucinated model response
  // including a stray key), then range/enum-sanitize what's left.
  const entities = sanitizeEntities(turn.intent, filterToIntentKeys(turn.intent, turn.entities));

  if (turn.intent === "unknown_intent") {
    return {
      effectiveIntent: "unknown_intent",
      entities: {},
      missingFields: [],
      action: "reject",
      requiresConfirmation: false,
      spokenResponse: spokenResponseFor("unknown_intent", "reject", {}, []),
    };
  }

  if (turn.intent === "open_screen") {
    const missingFields = requiredMissingFields(turn.intent, entities);
    const action: VoiceAction = missingFields.length > 0 ? "collect_fields" : "navigate";
    return {
      effectiveIntent: turn.intent,
      entities,
      missingFields,
      action,
      requiresConfirmation: false,
      spokenResponse: spokenResponseFor(turn.intent, action, entities, missingFields),
    };
  }

  if (READ_ONLY_INTENTS.includes(turn.intent) || turn.intent === "explain_app_field") {
    const missingFields = requiredMissingFields(turn.intent, entities);
    const action: VoiceAction = missingFields.length > 0 ? "collect_fields" : "answer";
    return {
      effectiveIntent: turn.intent,
      entities,
      missingFields,
      action,
      requiresConfirmation: false,
      spokenResponse: spokenResponseFor(turn.intent, action, entities, missingFields),
    };
  }

  if (turn.intent === "start_check_in") {
    return {
      effectiveIntent: "log_wellness",
      entities,
      missingFields: requiredMissingFields("log_wellness", entities),
      action: "collect_fields",
      requiresConfirmation: true,
      spokenResponse: "Let's do your check-in. How was your sleep quality, one to ten?",
    };
  }

  // Every remaining intent is a write workflow.
  const missingFields = requiredMissingFields(turn.intent, entities);
  const requiresConfirmation = WRITE_INTENTS.includes(turn.intent);
  const action: VoiceAction = missingFields.length > 0 ? "collect_fields" : requiresConfirmation ? "ready_to_confirm" : "execute";

  return {
    effectiveIntent: turn.intent,
    entities,
    missingFields,
    action,
    requiresConfirmation,
    spokenResponse: spokenResponseFor(turn.intent, action, entities, missingFields),
  };
}
