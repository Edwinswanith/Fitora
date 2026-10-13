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
import { MEAL_TYPES, type MealType } from "../models/PlannedMeal";
import { TRAINING_CATEGORIES } from "../lib/trainingCategories";

export const VOICE_INTENTS_V2 = [
  "start_check_in",
  "log_wellness",
  "log_session",
  "log_rpe",
  "add_water",
  "log_meal",
  "show_hydration",
  "show_nutrition",
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
  "show_upcoming_session",
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
  // The athlete corrected or cancelled the action the app saved a moment
  // ago ("actually make it one litre", "undo that"). The client performs it,
  // since only the client knows what it saved and can delete or redo it.
  "undo_last",
  "amend_last",
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
  "show_nutrition",
  "show_upcoming_session",
  "show_daily_checklist",
];

/**
 * Intents that save/update/send data. Most are simple, reversible, single-
 * athlete writes (a log entry can always be corrected/deleted afterward) —
 * for those, asking "should I save this?" on every single utterance is the
 * exact friction real usage flagged (spec items 3/4), so they auto-execute
 * the moment their required fields are present. Only `send_coach_note` stays
 * confirmation-gated below (CONFIRMATION_REQUIRED_INTENTS): it puts a message
 * in front of another real person and can't be unsent, which is a
 * meaningfully different risk profile than a personal data log.
 */
const WRITE_INTENTS: VoiceIntentNameV2[] = [
  "log_wellness",
  "log_session",
  "log_rpe",
  "add_water",
  "log_meal",
  "set_water_goal",
  "change_hydration_reminder",
  "log_recovery",
  "mark_rest_day",
  "log_heart_rate",
  "update_profile",
  "send_coach_note",
  "add_note",
];

/** Subset of WRITE_INTENTS that still requires an explicit "yes" before saving — see the comment above. */
const CONFIRMATION_REQUIRED_INTENTS: VoiceIntentNameV2[] = ["send_coach_note"];

/** Below this confidence, the model's classification isn't trusted enough to act on — never silently guesses. */
const LOW_CONFIDENCE_THRESHOLD = 0.45;

export const OPEN_SCREEN_ALLOWLIST = [
  "today",
  "workouts",
  "nutrition",
  "progress",
  "log",
  "coach",
  "messages",
  "water",
  "goals",
  "trends",
  "notifications",
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
  calories: [0, 5000],
  proteinG: [0, 500],
  carbsG: [0, 800],
  fatG: [0, 400],
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
  // fullCheckIn is set only by the policy (start_check_in), never by the model.
  log_wellness: ["sleepHours", "sleepQuality", "mood", "stress", "soreness", "fatigue", "fullCheckIn"],
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
  log_meal: ["mealType", "mealName", "foodName", "calories", "proteinG", "carbsG", "fatG"],
  show_hydration: [],
  show_nutrition: [],
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
  show_upcoming_session: [],
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
  if ("mealType" in out) {
    if (typeof out.mealType === "string") out.mealType = out.mealType.trim().toLowerCase();
    if (!MEAL_TYPES.includes(out.mealType as MealType)) delete out.mealType;
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
  for (const key of ["body", "workoutType", "reps", "notes", "bodyConditionFeedback", "position", "mealName", "foodName"]) {
    if (key in out && typeof out[key] !== "string") delete out[key];
  }
  if ("position" in out && typeof out.position === "string") {
    const trimmed = out.position.trim();
    if (!trimmed || trimmed.length > 80) delete out.position;
    else out.position = trimmed;
  }
  if ("body" in out && typeof out.body === "string") out.body = out.body.trim();
  if (out.body === "") delete out.body;
  for (const key of ["mealName", "foodName"]) {
    const value = out[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 160) delete out[key];
      else out[key] = trimmed;
    }
  }
  if ("enabled" in out && typeof out.enabled !== "boolean") delete out.enabled;

  return out;
}

/** One hardcoded required-field rule per intent. Never merges rpe/effortScore (correction #3). */
function requiredMissingFields(intent: VoiceIntentNameV2, entities: Record<string, unknown>): string[] {
  switch (intent) {
    case "log_wellness": {
      // A check-in the athlete started ("do my check-in") collects all five
      // scores before saving once; a single remark ("soreness is 6") saves
      // just that score.
      if (entities.fullCheckIn === true) return CHECK_IN_SCORES.filter((f) => typeof entities[f] !== "number");
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
    case "log_rpe": {
      // Same rule as log_session's rpe branch: the save endpoint
      // (/voice/log-session) rejects an RPE without a training category and
      // planned intensity, so ask for them instead of saying "saving" and failing.
      const missing: string[] = [];
      if (typeof entities.rpe !== "number") missing.push("rpe");
      if (typeof entities.trainingCategory !== "string") missing.push("trainingCategory");
      if (typeof entities.plannedIntensityPercent !== "number") missing.push("plannedIntensityPercent");
      return missing;
    }
    case "add_water":
      return typeof entities.amountMl === "number" ? [] : ["amountMl"];
    case "log_meal": {
      const missing: string[] = [];
      if (typeof entities.mealType !== "string") missing.push("mealType");
      if (typeof entities.foodName !== "string" && typeof entities.mealName !== "string") missing.push("foodName");
      if (typeof entities.calories !== "number") missing.push("calories");
      return missing;
    }
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

const CHECK_IN_SCORES = ["sleepQuality", "mood", "stress", "soreness", "fatigue"] as const;
const CHECK_IN_SCORE_NAMES: Record<string, string> = {
  sleepQuality: "sleep",
  mood: "mood",
  stress: "stress",
  soreness: "soreness",
  fatigue: "fatigue",
};

/** Scores the athlete rates out of ten; only ever saved when that number was actually said. */
const SPOKEN_SCORE_FIELDS = ["sleepQuality", "mood", "stress", "soreness", "fatigue", "rpe", "effortScore", "muscleSoreness", "moodMotivation"];

const FILLER_WORDS = new Set(["uh", "um", "umm", "hmm", "so", "er", "ah", "like", "okay", "ok", "hey", "the", "a"]);

/** Three or more real words: a request that was heard, as opposed to noise or a half-started sentence. */
export function isRealSentence(transcript: string): boolean {
  const words = transcript.toLowerCase().split(/[^a-z\u0900-\u097f']+/).filter((w) => w.length > 1 && !FILLER_WORDS.has(w));
  return words.length >= 3;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Every number said in the transcript, as digits ("7", "7.5") or words ("seven"). */
export function numbersSpoken(transcript: string): Set<number> {
  const found = new Set<number>();
  const lower = transcript.toLowerCase();
  for (const match of lower.matchAll(/\d+(?:\.\d+)?/g)) found.add(Number(match[0]));
  for (const word of lower.split(/[^a-z]+/)) {
    if (word in NUMBER_WORDS) found.add(NUMBER_WORDS[word]);
  }
  return found;
}

/**
 * Removes any 1-10 score the athlete didn't actually say. "I feel a bit
 * tired" names no number, so it must not become fatigue 1 (the model
 * guesses such values despite its instructions); the policy then asks for
 * the score instead.
 */
export function dropUnspokenScores(entities: Record<string, unknown>, transcript: string): Record<string, unknown> {
  const spoken = numbersSpoken(transcript);
  const out: Record<string, unknown> = { ...entities };
  for (const field of SPOKEN_SCORE_FIELDS) {
    if (!(field in out)) continue;
    const value = typeof out[field] === "number" ? (out[field] as number) : Number(out[field]);
    if (!spoken.has(value)) delete out[field];
  }
  return out;
}

const FIELD_FOLLOW_UP_QUESTIONS: Record<string, string> = {
  sleepQuality: "What sleep quality score, one to ten, should I save?",
  mood: "And your mood, one to ten?",
  stress: "How stressed are you, one to ten?",
  soreness: "How sore are you, one to ten?",
  fatigue: "How tired are you, one to ten?",
  sessionType: "Which session — AM, afternoon, or PM?",
  status: "Was it planned, in progress, completed, skipped, or a rest day?",
  rpe: "What was your session RPE, zero to ten?",
  trainingCategory: "Which training category was this — for example endurance, max speed, or strength?",
  plannedIntensityPercent: "What was the planned intensity, as a percent?",
  amountMl: "How much water, in millilitres?",
  mealType: "Which meal was it - breakfast, lunch, dinner, or snack?",
  foodName: "What did you eat?",
  calories: "How many calories should I log?",
  goalMl: "What should your new water goal be, in millilitres?",
  reminderChange: "Turn reminders on, off, or change the spacing?",
  modalities: "Which recovery did you do — stretching, ice bath, mobility, or physio? Or should I skip it?",
  body: "What would you like the message to say?",
  screen: "Which screen - today, workouts, nutrition, coach, progress, messages, water, goals, trends, or notifications?",
  term: "Which term would you like explained?",
  heartRateValue: "What was your heart rate — waking, resting before bed, or both?",
  profileField: "What would you like to update — height, weight, or position?",
};

function spokenResponseFor(
  intent: VoiceIntentNameV2,
  action: VoiceAction,
  entities: Record<string, unknown>,
  missingFields: string[]
): string {
  if (action === "collect_fields") {
    const field = missingFields[0];
    if (intent === "log_wellness" && entities.fullCheckIn === true && missingFields.length > 1) {
      const names = missingFields.map((f) => CHECK_IN_SCORE_NAMES[f] ?? f);
      const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      const first = missingFields.length === CHECK_IN_SCORES.length;
      // Ends in "?" on purpose: the app only keeps the mic open after a question.
      return first
        ? `Let's do your check-in. You can say them all at once: how are your ${list}, one to ten each?`
        : `Got it. And your ${list}, one to ten each?`;
    }
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
    return "I didn't catch that. Could you say it again?";
  }

  if (action === "execute") {
    return "Saving that now.";
  }

  // ready_to_confirm — only send_coach_note ever reaches this now (the sole
  // entry in CONFIRMATION_REQUIRED_INTENTS); every other write intent
  // auto-executes the moment its required fields are present (spec item 4).
  if (intent === "send_coach_note") {
    return `Send this to your coach: "${entities.body}"?`;
  }
  return "Should I save this?";
}

/**
 * Re-asks for the in-progress workflow instead of discarding it (garbled,
 * low-confidence or unrecognised turn, or the interpreter failing). The
 * action matches where the workflow actually is, so a confirmation card
 * stays a confirmation card.
 */
export function keepPendingWorkflow(pending: NonNullable<PolicyPendingState>, prefix = "I didn't catch that."): PolicyResult {
  const requiresConfirmation = CONFIRMATION_REQUIRED_INTENTS.includes(pending.intent);
  const missingFields = requiredMissingFields(pending.intent, pending.entities);
  const action: VoiceAction = missingFields.length > 0 ? "collect_fields" : requiresConfirmation ? "ready_to_confirm" : "collect_fields";
  const followUp =
    action === "ready_to_confirm"
      ? "Say yes to send it, or no to cancel."
      : spokenResponseFor(pending.intent, "collect_fields", pending.entities, missingFields);
  return {
    effectiveIntent: pending.intent,
    entities: pending.entities,
    missingFields,
    action,
    requiresConfirmation,
    spokenResponse: `${prefix} ${followUp}`,
  };
}

/**
 * The single entry point. Given a sanitized model turn and any pending
 * workflow state, derives everything downstream of intent+entities.
 */
/** What the app saved a moment ago (sent back by the client), so "actually make it 600" or "undo that" can refer to it. */
export type RecentAction = { intent: VoiceIntentNameV2; entities: Record<string, unknown> } | null;

export type PolicyContext = {
  /** The athlete's words; scores they didn't say are dropped. */
  transcript?: string;
  recent?: RecentAction;
};

export function derivePolicy(rawTurn: SanitizedTurn, pending: PolicyPendingState, context: PolicyContext = {}): PolicyResult {
  // fullCheckIn is the policy's own marker; the model never gets to set it.
  const { fullCheckIn: _ignored, ...modelEntities } = rawTurn.entities;
  void _ignored;
  let turn: SanitizedTurn = {
    ...rawTurn,
    entities: context.transcript ? dropUnspokenScores(modelEntities, context.transcript) : modelEntities,
  };
  // Scores the model guessed but the athlete never put a number on ("a bit
  // tired" -> fatigue). The next question asks for exactly that score.
  const guessedScores = Object.keys(modelEntities).filter((key) => CHECK_IN_SCORES.includes(key as (typeof CHECK_IN_SCORES)[number]) && !(key in turn.entities));
  // Answering the open question with a fresh sentence of the same kind
  // ("sleep 8, mood 7" during a check-in) continues that workflow; it must
  // not restart it and lose what was already collected.
  if (pending && turn.intent === pending.intent) turn = { ...turn, intent: "update_field" };
  const isMeta = META_INTENTS.includes(turn.intent);

  // A classification the model itself wasn't confident about is never acted
  // on — better to ask the athlete to repeat themselves than execute (or
  // start collecting fields for) a guess. Meta-intents (yes/no/correction)
  // are short, unambiguous utterances by nature and are exempt; unknown_intent
  // gets the same treatment below. If a workflow was already in progress,
  // its state is preserved rather than discarded on a garbled turn.
  if (!isMeta && turn.intent !== "unknown_intent" && turn.confidence < LOW_CONFIDENCE_THRESHOLD) {
    if (pending) return keepPendingWorkflow(pending);
    return {
      effectiveIntent: "unknown_intent",
      entities: {},
      missingFields: [],
      action: "reject",
      requiresConfirmation: false,
      spokenResponse: "I didn't catch that. Could you say it again?",
    };
  }

  // Meta-intents operate on the pending workflow, not a fresh one.
  if (isMeta) {
    if (!pending && context.recent) {
      const recent = context.recent;
      if (turn.intent === "cancel_action") {
        return {
          effectiveIntent: recent.intent,
          entities: recent.entities,
          missingFields: [],
          action: "undo_last",
          requiresConfirmation: false,
          spokenResponse: "Okay, undoing that.",
        };
      }
      if (turn.intent === "update_field") {
        const incoming = filterToIntentKeys(recent.intent, turn.entities);
        const merged = sanitizeEntities(recent.intent, { ...recent.entities, ...incoming });
        const changed = Object.keys(incoming).some((key) => key in merged && merged[key] !== recent.entities[key]);
        if (changed && requiredMissingFields(recent.intent, merged).length === 0) {
          return {
            effectiveIntent: recent.intent,
            entities: merged,
            missingFields: [],
            action: "amend_last",
            requiresConfirmation: false,
            spokenResponse: "Okay, changing it.",
          };
        }
      }
      return {
        effectiveIntent: "unknown_intent",
        entities: {},
        missingFields: [],
        action: "reject",
        requiresConfirmation: false,
        spokenResponse: turn.intent === "confirm_action" ? "That's already saved." : "What should I change it to?",
      };
    }
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
    const requiresConfirmation = CONFIRMATION_REQUIRED_INTENTS.includes(pending.intent);

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
    const action: VoiceAction = missingFields.length > 0 ? "collect_fields" : requiresConfirmation ? "ready_to_confirm" : "execute";
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
    // Mid-workflow, an unrecognised turn re-asks instead of throwing away
    // what the athlete has already dictated.
    if (pending) return keepPendingWorkflow(pending);
    return {
      effectiveIntent: "unknown_intent",
      entities: {},
      missingFields: [],
      action: "reject",
      requiresConfirmation: false,
      // A clear request the app can't do ("what's the weather") was heard
      // fine; saying "I didn't catch that" would make the athlete repeat it.
      spokenResponse:
        context.transcript && isRealSentence(context.transcript)
          ? "I can't help with that here. I can log water, meals, check-ins and training, or tell you about your day."
          : spokenResponseFor("unknown_intent", "reject", {}, []),
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
    const checkIn = { ...entities, fullCheckIn: true };
    const missingFields = requiredMissingFields("log_wellness", checkIn);
    return {
      effectiveIntent: "log_wellness",
      entities: checkIn,
      missingFields,
      action: "collect_fields",
      requiresConfirmation: false,
      spokenResponse: spokenResponseFor("log_wellness", "collect_fields", checkIn, missingFields),
    };
  }

  // Every remaining intent is a write workflow.
  let missingFields = requiredMissingFields(turn.intent, entities);
  if (turn.intent === "log_wellness" && guessedScores.length > 0 && missingFields.length > 0) missingFields = [guessedScores[0]];
  const requiresConfirmation = CONFIRMATION_REQUIRED_INTENTS.includes(turn.intent);
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
