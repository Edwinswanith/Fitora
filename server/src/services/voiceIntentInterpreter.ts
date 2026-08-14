/**
 * Adapter for turning an athlete's spoken transcript into a structured voice
 * intent. `getVoiceIntentInterpreter()` returns the real Gemini interpreter
 * when GEMINI_API_KEY is configured, otherwise a deterministic keyword-based
 * mock. To plug in a different provider, implement `VoiceIntentInterpreter`
 * and swap the resolver; nothing else in the codebase changes, since callers
 * only depend on the interface.
 *
 * IMPORTANT: this service only classifies intent and extracts structured
 * fields — it never writes to the database and never authors data-bearing
 * answers (e.g. readiness scores). The caller (the /voice/interpret route,
 * and ultimately the web client) performs the actual write via the existing
 * athlete endpoints after the user confirms, and assembles any "status"
 * answer deterministically from real fetched data.
 */

import { env } from "../config/env";

export const VOICE_INTENTS = [
  "navigate",
  "fill_wellness",
  "fill_attendance",
  "fill_training",
  "fill_rpe",
  "fill_heart_rate",
  "fill_recovery",
  "add_water",
  "add_note",
  "send_coach_message",
  "query_status",
  "unsupported",
] as const;
export type VoiceIntentName = (typeof VOICE_INTENTS)[number];

export type VoicePendingIntent = {
  intent: VoiceIntentName;
  collected: Record<string, unknown>;
  missingFields: string[];
};

export type VoiceInterpretInput = {
  transcript: string;
  today: string;
  pendingIntent?: VoicePendingIntent;
};

export type VoiceIntentResult = {
  intent: VoiceIntentName;
  fields: Record<string, unknown>;
  missingFields: string[];
  followUpQuestion?: string;
  requiresConfirmation: boolean;
  spokenResponse: string;
};

export interface VoiceIntentInterpreter {
  interpret(input: VoiceInterpretInput): Promise<VoiceIntentResult>;
}

const WRITE_INTENTS: VoiceIntentName[] = [
  "fill_wellness",
  "fill_attendance",
  "fill_training",
  "fill_rpe",
  "fill_heart_rate",
  "fill_recovery",
  "add_water",
  "add_note",
  "send_coach_message",
];

/** `requiresConfirmation` is a hardcoded app rule, not a model decision. */
function requiresConfirmationFor(intent: VoiceIntentName): boolean {
  return WRITE_INTENTS.includes(intent);
}

const NUMERIC_FIELD_RANGES: Record<string, [number, number]> = {
  sleepHours: [0, 14],
  sleepQuality: [1, 10],
  mood: [1, 10],
  stress: [1, 10],
  soreness: [1, 10],
  fatigue: [1, 10],
  amountMl: [1, 4000],
  sets: [0, 200],
  actualDurationMin: [0, 600],
  effortRating: [1, 10],
  rpe: [0, 10],
  plannedIntensityPercent: [0, 100],
  restingHeartRate: [20, 220],
  wakeHr: [25, 220],
  bedHr: [25, 220],
};

const FIELD_FOLLOW_UP_QUESTIONS: Record<string, string> = {
  sleepHours: "Sleep hours should be between 0 and 14. How many hours should I save?",
  sleepQuality: "Sleep quality should be from 1 to 10. What score should I save?",
  mood: "Mood should be from 1 to 10. What score should I save?",
  stress: "Stress should be from 1 to 10. What score should I save?",
  soreness: "Soreness should be from 1 to 10. What score should I save?",
  fatigue: "Fatigue should be from 1 to 10. What score should I save?",
  amountMl: "Water amount should be between 1 and 4000 ml. How much should I log?",
  effortRating: "Effort should be from 1 to 10. What score should I save?",
  rpe: "RPE should be from 0 to 10. What score should I save?",
  plannedIntensityPercent: "Planned intensity should be between 0 and 100 percent. What percent should I save?",
  restingHeartRate: "Resting heart rate should be between 20 and 220 bpm. What value should I save?",
  wakeHr: "Wake heart rate should be between 25 and 220 bpm. What value should I save?",
  bedHr: "Bed heart rate should be between 25 and 220 bpm. What value should I save?",
};

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: VOICE_INTENTS as unknown as string[] },
    fields: {
      type: "OBJECT",
      description:
        "Structured fields extracted from the transcript for the chosen intent. Only include fields " +
        "that were actually said or can be reasonably inferred — never invent values.",
      properties: {
        target: {
          type: "STRING",
          enum: ["today", "progress", "log", "coach", "messages", "water", "goals", "trends"],
          description: "navigate: which section/tab to open.",
        },
        sleepHours: { type: "NUMBER", description: "fill_wellness: hours slept, 0-14." },
        sleepQuality: { type: "NUMBER", description: "fill_wellness: spoken 1-10 scale." },
        mood: { type: "NUMBER", description: "fill_wellness: spoken 1-10 scale." },
        stress: { type: "NUMBER", description: "fill_wellness: spoken 1-10 scale." },
        soreness: { type: "NUMBER", description: "fill_wellness: spoken 1-10 scale." },
        fatigue: { type: "NUMBER", description: "fill_wellness: spoken 1-10 scale." },
        status: {
          type: "STRING",
          enum: ["present", "absent", "late", "excused", "rest", "planned", "in_progress", "completed", "skipped"],
          description: "fill_attendance: present/absent/late/excused/rest. fill_training: planned/in_progress/completed/skipped/rest.",
        },
        slot: { type: "STRING", enum: ["AM", "AFT", "PM"], description: "fill_training/fill_rpe: which session slot." },
        attended: { type: "BOOLEAN", description: "fill_training: whether the athlete attended/completed the session." },
        workoutType: { type: "STRING", description: "fill_training: short workout/drill label, e.g. 'Sprints'." },
        trainingCategory: { type: "STRING", description: "fill_rpe: RPE monitoring training category, e.g. endurance, strength, skill, mobility." },
        sets: { type: "NUMBER", description: "fill_training: number of sets." },
        reps: { type: "STRING", description: "fill_training: reps or distance per set, e.g. '100m'." },
        actualDurationMin: { type: "NUMBER", description: "fill_training: minutes trained, 0-600." },
        effortRating: { type: "NUMBER", description: "fill_training: effort/RPE, spoken 1-10 scale." },
        rpe: { type: "NUMBER", description: "fill_rpe: session RPE, spoken 0-10 scale." },
        plannedIntensityPercent: { type: "NUMBER", description: "fill_rpe: planned intensity percent, 0-100." },
        restingHeartRate: { type: "NUMBER", description: "fill_rpe: resting heart rate in bpm, 20-220." },
        bodyConditionFeedback: { type: "STRING", description: "fill_rpe: free-text body condition feedback." },
        wakeHr: { type: "NUMBER", description: "fill_heart_rate: wake/morning heart rate in bpm, 25-220." },
        bedHr: { type: "NUMBER", description: "fill_heart_rate: bed/night heart rate in bpm, 25-220." },
        notes: { type: "STRING", description: "fill_training: free-text notes, e.g. workout description or soreness callout." },
        modalities: {
          type: "ARRAY",
          items: { type: "STRING", enum: ["stretching", "ice_bath", "mobility", "physio", "hydration"] },
          description: "fill_recovery: recovery modalities completed today.",
        },
        amountMl: { type: "NUMBER", description: "add_water: amount in millilitres, 1-4000." },
        body: { type: "STRING", description: "send_coach_message/add_note: the message or private note body." },
        topic: {
          type: "STRING",
          enum: ["readiness", "hydration", "training_plan", "coach_feedback", "general"],
          description: "query_status: what the athlete is asking about.",
        },
      },
    },
    missingFields: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Field names still needed to complete this intent (empty if nothing is missing).",
    },
    followUpQuestion: {
      type: "STRING",
      description: "One short natural question to ask next if missingFields is non-empty. Omit otherwise.",
    },
    spokenResponse: {
      type: "STRING",
      description:
        "A short spoken acknowledgement. For query_status, do NOT include any numbers/scores/facts here — " +
        "the app fills those in from real data. Just confirm the topic was understood.",
    },
  },
  required: ["intent", "fields", "missingFields", "spokenResponse"],
};

const SYSTEM_PROMPT =
  "You are the natural-language understanding layer for an athlete's voice assistant in a sports " +
  "coaching app. Classify the athlete's spoken transcript into exactly one of these intents: " +
  `${VOICE_INTENTS.join(", ")}. Extract only fields that were explicitly said or unambiguously implied — ` +
  "never invent numbers or facts. Wellness/effort fields are on a spoken 1-10 scale (not the app's " +
  "internal 1-5 scale - do not convert). " +
  "Treat sleep score, sleep quality, and sleep rating as sleepQuality, not sleepHours. Only extract " +
  "sleepHours when the user clearly says hours, hrs, mani, neram, sleep duration, or slept for a " +
  "duration. Tamil, Tanglish, and mixed Tamil-English commands may appear; for example 'sleep score " +
  "8' means sleepQuality=8, and 'naan 7 mani neram thoonginen sleep score 6' means sleepHours=7 and " +
  "sleepQuality=6. Use fill_heart_rate for wake/morning or bed/night heart rate. Use fill_rpe for " +
  "RPE/RPM monitoring values like training category, planned intensity, session RPE, soreness, " +
  "fatigue, mood, resting heart rate, or body condition feedback. Use add_note for private athlete " +
  "notes; use send_coach_message only when the athlete explicitly asks to send/tell/message the " +
  "coach. Use fill_recovery for stretching, ice bath, mobility, physio, or hydration recovery. For " +
  "fill_training, map natural workout descriptions like 'four by one hundred sprint repeats' to sets=4, reps='100m', workoutType='Sprints'. For " +
  "query_status, classify the topic only — never state a readiness score, water total, or any other " +
  "number yourself, since you do not have access to real data. If a follow-up conversation turn is " +
  "provided (pendingIntent), merge newly-stated fields with the ones already collected and only ask " +
  "about fields still missing. If the transcript doesn't match any supported capability, use intent " +
  "'unsupported'.";

function buildUserPrompt(input: VoiceInterpretInput): string {
  const parts = [`Today's date: ${input.today}`];
  if (input.pendingIntent) {
    parts.push(
      `In-progress intent: ${input.pendingIntent.intent}`,
      `Already collected: ${JSON.stringify(input.pendingIntent.collected)}`,
      `Still missing: ${input.pendingIntent.missingFields.join(", ") || "(none)"}`
    );
  }
  parts.push(`Transcript: "${input.transcript}"`);
  return parts.join("\n");
}

/**
 * Real interpreter: sends the transcript (+ conversation context) to Gemini
 * and asks for a structured intent only. Throws on any failure so the caller
 * can fall back to a graceful "unsupported" response.
 */
export class GeminiVoiceIntentInterpreter implements VoiceIntentInterpreter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async interpret(input: VoiceInterpretInput): Promise<VoiceIntentResult> {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`gemini_http_${res.status}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("gemini_empty_response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("gemini_bad_json");
    }
    return sanitizeVoiceIntentResult(parsed);
  }
}

/** Trims/validates a raw model response into a safe, well-typed result. */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function addMissingField(missingFields: string[], field: string): void {
  if (!missingFields.includes(field)) missingFields.push(field);
}

function sanitizeNumericFields(fields: Record<string, unknown>, missingFields: string[]): void {
  for (const [field, [min, max]] of Object.entries(NUMERIC_FIELD_RANGES)) {
    if (!(field in fields)) continue;
    const value = finiteNumber(fields[field]);
    if (value === undefined || value < min || value > max) {
      delete fields[field];
      addMissingField(missingFields, field);
      continue;
    }
    fields[field] = field === "amountMl" || field === "sets" || field === "actualDurationMin" ? Math.round(value) : value;
  }
}

function normalizeRpeFields(intent: VoiceIntentName, fields: Record<string, unknown>): void {
  if (intent !== "fill_rpe") return;
  if (typeof fields.rpe === "number" && typeof fields.effortRating !== "number") {
    fields.effortRating = fields.rpe;
  }
  if (typeof fields.effortRating === "number" && typeof fields.rpe !== "number") {
    fields.rpe = fields.effortRating;
  }
}

const SPOKEN_SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  onnu: 1,
  rendu: 2,
  moonu: 3,
  moonru: 3,
  naalu: 4,
  anju: 5,
  aaru: 6,
  ezhu: 7,
  elu: 7,
  ettu: 8,
  yettu: 8,
  onbadhu: 9,
  pathu: 10,
};
const SPOKEN_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SMALL_NUMBER_WORD_PATTERN = Object.keys(SPOKEN_SMALL_NUMBERS).join("|");
const TENS_NUMBER_WORD_PATTERN = Object.keys(SPOKEN_TENS).join("|");

function normalizeSpokenNumberWords(text: string): string {
  let normalized = text.toLowerCase().replace(/-/g, " ");
  normalized = normalized.replace(
    new RegExp(`\\b(${SMALL_NUMBER_WORD_PATTERN})\\s+hundred\\b`, "g"),
    (_match, word: string) => String((SPOKEN_SMALL_NUMBERS[word] ?? 0) * 100)
  );
  normalized = normalized.replace(
    new RegExp(`\\b(${TENS_NUMBER_WORD_PATTERN})\\s+(${SMALL_NUMBER_WORD_PATTERN})\\b`, "g"),
    (_match, ten: string, unit: string) => String((SPOKEN_TENS[ten] ?? 0) + (SPOKEN_SMALL_NUMBERS[unit] ?? 0))
  );
  normalized = normalized.replace(
    new RegExp(`\\b(${TENS_NUMBER_WORD_PATTERN}|${SMALL_NUMBER_WORD_PATTERN})\\b`, "g"),
    (word) => String(SPOKEN_TENS[word] ?? SPOKEN_SMALL_NUMBERS[word] ?? word)
  );
  return normalized;
}

function numberNear(text: string, label: string): number | undefined {
  const after = text.match(new RegExp(`(?:${label})[^0-9]{0,32}(\\d{1,3}(?:\\.\\d+)?)`));
  if (after) return Number(after[1]);
  const before = text.match(new RegExp(`(\\d{1,3}(?:\\.\\d+)?)[^a-z0-9]{0,20}(?:${label})`));
  return before ? Number(before[1]) : undefined;
}

function extractRpeFieldsFromTranscript(fields: Record<string, unknown>, transcript: string): void {
  const t = normalizeSpokenNumberWords(transcript);
  if (!("slot" in fields)) {
    const slot = t.includes("afternoon") || /\baft\b/.test(t) ? "AFT" : /\bpm\b|\bevening\b|\bnight\b/.test(t) ? "PM" : /\bam\b|\bmorning\b/.test(t) ? "AM" : undefined;
    if (slot) fields.slot = slot;
  }
  const rpe = numberNear(t, "rpe|rpm|effort");
  if (rpe !== undefined) {
    fields.rpe = rpe;
    fields.effortRating = rpe;
  }
  const plannedIntensityPercent = numberNear(t, "planned\\s+intensity|intensity|percent|percentage");
  if (plannedIntensityPercent !== undefined) fields.plannedIntensityPercent = plannedIntensityPercent;
  const soreness = numberNear(t, "soreness|sore|vali");
  if (soreness !== undefined) fields.soreness = soreness;
  const fatigue = numberNear(t, "fatigue|tired|sorvu");
  if (fatigue !== undefined) fields.fatigue = fatigue;
  const mood = numberNear(t, "mood");
  if (mood !== undefined) fields.mood = mood;
  const sleepQuality = numberNear(t, "sleep\\s+(?:quality|score|rating)");
  if (sleepQuality !== undefined) fields.sleepQuality = sleepQuality;
  const restingHeartRate = numberNear(t, "resting\\s+(?:heart\\s*)?rate|resting\\s*hr");
  if (restingHeartRate !== undefined) fields.restingHeartRate = restingHeartRate;
}

function extractWellnessFieldsFromTranscript(fields: Record<string, unknown>, transcript: string): void {
  const t = normalizeSpokenNumberWords(transcript);
  const sleepHoursBefore = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:hours?|hrs?|mani|neram)\b/);
  const sleepHoursAfter = t.match(/\b(?:sleep\s+(?:hours?|duration)|hours?|hrs?|mani|neram|slept|thoongi\w*|thoonginen)[^0-9]{0,24}(\d{1,2}(?:\.\d+)?)/);
  const sleepHours = sleepHoursBefore ? Number(sleepHoursBefore[1]) : sleepHoursAfter ? Number(sleepHoursAfter[1]) : undefined;
  if (sleepHours !== undefined) fields.sleepHours = sleepHours;
  const sleepQuality = numberNear(t, "sleep\\s+(?:quality|score|rating)|thookam\\s+(?:quality|score)|tookam\\s+(?:quality|score)|urakkam\\s+(?:quality|score)");
  if (sleepQuality !== undefined) fields.sleepQuality = sleepQuality;
  const mood = numberNear(t, "mood");
  if (mood !== undefined) fields.mood = mood;
  const stress = numberNear(t, "stress|azhutham");
  if (stress !== undefined) fields.stress = stress;
  const soreness = numberNear(t, "soreness|sore|vali");
  if (soreness !== undefined) fields.soreness = soreness;
  const fatigue = numberNear(t, "fatigue|tired|sorvu");
  if (fatigue !== undefined) fields.fatigue = fatigue;
}

function extractWaterFieldsFromTranscript(fields: Record<string, unknown>, transcript: string): void {
  const t = normalizeSpokenNumberWords(transcript);
  const ml = t.match(/(\d{1,4})\s*(?:ml|millilitre|milliliter|millilitres|milliliters)\b/);
  if (ml) {
    fields.amountMl = Number(ml[1]);
    return;
  }
  const litre = t.match(/(\d+(?:\.\d+)?)\s*(?:l|litre|liter|litres|liters)\b/);
  if (litre) fields.amountMl = Math.round(Number(litre[1]) * 1000);
}

function normalizeMissingFieldsForIntent(intent: VoiceIntentName, fields: Record<string, unknown>, missingFields: string[]): string[] {
  if (intent === "fill_rpe") {
    return typeof fields.rpe === "number" || typeof fields.effortRating === "number" ? [] : ["rpe"];
  }
  if (intent === "add_water") {
    return typeof fields.amountMl === "number" ? [] : ["amountMl"];
  }
  if (intent === "fill_heart_rate") {
    return typeof fields.wakeHr === "number" || typeof fields.bedHr === "number" ? [] : ["wakeHr"];
  }
  if (intent === "fill_wellness") {
    return ["sleepHours", "sleepQuality", "mood", "stress", "soreness", "fatigue"].some((field) => typeof fields[field] === "number") ? [] : ["sleepQuality"];
  }
  if (intent === "fill_attendance") {
    return typeof fields.status === "string" ? [] : ["status"];
  }
  if (intent === "send_coach_message" || intent === "add_note") {
    return typeof fields.body === "string" && fields.body.trim() ? [] : ["body"];
  }
  return missingFields;
}

export function enrichVoiceIntentResult(result: VoiceIntentResult, transcript: string): VoiceIntentResult {
  const normalizedTranscript = normalizeSpokenNumberWords(transcript);
  const fields = { ...result.fields };
  let intent = result.intent;
  const looksLikeRpe = /\brpe\b|\brpm\b|\bplanned\s+intensity\b|\bbody\s*condition\b|\bresting\s+(?:heart\s*)?rate\b/.test(normalizedTranscript);
  const looksLikeWellness = /sleep|slept|thookam|tookam|urakkam|thoongi|thoonginen|mood|stress|soreness|sore|fatigue|tired|sorvu|vali|azhutham/.test(normalizedTranscript);
  const looksLikeWater = /\bwater\b|\bdrink\b|\bdrank\b|\bhydrat/.test(normalizedTranscript);

  if (looksLikeRpe) {
    intent = "fill_rpe";
    extractRpeFieldsFromTranscript(fields, normalizedTranscript);
  } else if (intent === "fill_wellness" || looksLikeWellness) {
    if (intent === "unsupported" && looksLikeWellness) intent = "fill_wellness";
    extractWellnessFieldsFromTranscript(fields, normalizedTranscript);
  } else if (intent === "add_water" || looksLikeWater) {
    if (intent === "unsupported" && looksLikeWater) intent = "add_water";
    extractWaterFieldsFromTranscript(fields, normalizedTranscript);
  }

  const sanitized = sanitizeVoiceIntentResult({
    ...result,
    intent,
    fields,
    missingFields: normalizeMissingFieldsForIntent(intent, fields, result.missingFields),
  });
  return {
    ...sanitized,
    missingFields: normalizeMissingFieldsForIntent(sanitized.intent, sanitized.fields, sanitized.missingFields),
  };
}

export function sanitizeVoiceIntentResult(raw: unknown): VoiceIntentResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const intent = VOICE_INTENTS.includes(r.intent as VoiceIntentName) ? (r.intent as VoiceIntentName) : "unsupported";
  const fields = r.fields && typeof r.fields === "object" ? (r.fields as Record<string, unknown>) : {};
  const missingFields = Array.isArray(r.missingFields) ? r.missingFields.filter((f): f is string => typeof f === "string") : [];
  sanitizeNumericFields(fields, missingFields);
  normalizeRpeFields(intent, fields);
  if (Array.isArray(fields.modalities)) {
    fields.modalities = fields.modalities.filter(
      (m): m is string => typeof m === "string" && ["stretching", "ice_bath", "mobility", "physio", "hydration"].includes(m)
    );
  }
  const invalidField = missingFields.find((field) => FIELD_FOLLOW_UP_QUESTIONS[field]);
  const followUpQuestion =
    typeof r.followUpQuestion === "string" ? r.followUpQuestion : invalidField ? FIELD_FOLLOW_UP_QUESTIONS[invalidField] : undefined;
  const spokenResponse = typeof r.spokenResponse === "string" ? r.spokenResponse : "Okay.";
  return {
    intent,
    fields,
    missingFields,
    followUpQuestion,
    requiresConfirmation: requiresConfirmationFor(intent),
    spokenResponse,
  };
}

/**
 * Deterministic keyword-based placeholder — used for local dev without a
 * GEMINI_API_KEY and for tests, so both run with no network dependency.
 * Handles the common cases from the product spec well enough to exercise
 * the route contract; anything it can't confidently classify falls back to
 * "unsupported" rather than guessing.
 */
export class MockVoiceIntentInterpreter implements VoiceIntentInterpreter {
  async interpret(input: VoiceInterpretInput): Promise<VoiceIntentResult> {
    const t = input.transcript.toLowerCase();

    const navTargets: Record<string, string> = {
      recovery: "log",
      today: "today",
      readiness: "today",
      progress: "progress",
      water: "water",
      hydration: "water",
      log: "log",
      training: "log",
      coach: "coach",
      feedback: "coach",
      messages: "messages",
      trends: "trends",
      goals: "goals",
    };
    if (/^(open|show|go to)\b/.test(t)) {
      for (const [keyword, target] of Object.entries(navTargets)) {
        if (t.includes(keyword)) {
          return {
            intent: "navigate",
            fields: { target },
            missingFields: [],
            requiresConfirmation: false,
            spokenResponse: `Opening ${target}.`,
          };
        }
      }
    }

    if (t.includes("how am i") || t.includes("how do i look") || t.includes("readiness")) {
      return {
        intent: "query_status",
        fields: { topic: "readiness" },
        missingFields: [],
        requiresConfirmation: false,
        spokenResponse: "Here's your status.",
      };
    }

    if (/\brecovery\b|\bstretch(?:ing)?\b|\bice\s*bath\b|\bmobility\b|\bphysio\b/.test(t)) {
      const modalities: string[] = [];
      if (/\bstretch(?:ing)?\b/.test(t)) modalities.push("stretching");
      if (/\bice\s*bath\b/.test(t)) modalities.push("ice_bath");
      if (/\bmobility\b/.test(t)) modalities.push("mobility");
      if (/\bphysio\b/.test(t)) modalities.push("physio");
      if (/\bhydrat(?:ion|e)?\b/.test(t)) modalities.push("hydration");
      return {
        intent: "fill_recovery",
        fields: { modalities },
        missingFields: [],
        requiresConfirmation: true,
        spokenResponse: "Save recovery?",
      };
    }

    if (t.includes("water") || t.includes("drink") || t.includes("hydrat")) {
      const amountMatch = t.match(/(\d+)\s*ml/);
      const litreMatch = t.match(/(\d+(?:\.\d+)?)\s*l(?:itre|iter)?/);
      const amountMl = amountMatch
        ? Number(amountMatch[1])
        : litreMatch
          ? Math.round(Number(litreMatch[1]) * 1000)
          : undefined;
      if (amountMl) {
        return {
          intent: "add_water",
          fields: { amountMl },
          missingFields: [],
          requiresConfirmation: true,
          spokenResponse: `Log ${amountMl} ml of water?`,
        };
      }
      return {
        intent: "add_water",
        fields: {},
        missingFields: ["amountMl"],
        followUpQuestion: "How much water, in millilitres?",
        requiresConfirmation: true,
        spokenResponse: "How much water?",
      };
    }

    if (t.includes("coach") && (t.includes("tell") || t.includes("send") || t.includes("note") || t.includes("message"))) {
      return {
        intent: "send_coach_message",
        fields: { body: input.transcript },
        missingFields: [],
        requiresConfirmation: true,
        spokenResponse: "Send this to your coach?",
      };
    }

    if (/\b(?:add|save|write|create|log)\s+(?:a\s+)?note\b|\bnote\s+(?:to\s+myself|for\s+myself)\b/.test(t)) {
      const body =
        input.transcript.match(/(?:add|save|write|create|log)\s+(?:a\s+)?note\s*(?:to\s+myself|for\s+myself)?\s*(?:that|saying|:|-)?\s*(.+)$/i)?.[1]?.trim() ??
        input.transcript;
      return {
        intent: "add_note",
        fields: { body },
        missingFields: [],
        requiresConfirmation: true,
        spokenResponse: "Save this note?",
      };
    }

    if (/\bpresent\b|\battendance\b/.test(t)) {
      const status = t.includes("late") ? "late" : t.includes("absent") ? "absent" : "present";
      return {
        intent: "fill_attendance",
        fields: { status },
        missingFields: [],
        requiresConfirmation: true,
        spokenResponse: `Mark attendance as ${status}?`,
      };
    }

    if (/\bheart\s*rate\b|\bheartbeat\b|\bpulse\b|\bwake\s*hr\b|\bbed\s*hr\b/.test(t)) {
      const value = Number(t.match(/\b(\d{2,3})\b/)?.[1] ?? NaN);
      const fields: Record<string, unknown> = {};
      if (Number.isFinite(value)) {
        if (/\bbed|night|sleeping\b/.test(t)) fields.bedHr = value;
        else fields.wakeHr = value;
      }
      return {
        intent: "fill_heart_rate",
        fields,
        missingFields: Object.keys(fields).length ? [] : ["wakeHr"],
        followUpQuestion: Object.keys(fields).length ? undefined : "What heart rate value should I save?",
        requiresConfirmation: true,
        spokenResponse: "Save heart rate?",
      };
    }

    if (/\brpe\b|\brpm\b|\bplanned\s+intensity\b|\bbody\s*condition\b|\bresting\s+(?:heart\s*)?rate\b/.test(t)) {
      const fields: Record<string, unknown> = {};
      const slot = t.includes("afternoon") || /\baft\b/.test(t) ? "AFT" : /\bpm\b|\bevening\b|\bnight\b/.test(t) ? "PM" : /\bam\b|\bmorning\b/.test(t) ? "AM" : undefined;
      if (slot) fields.slot = slot;
      const valueNear = (label: string) => {
        const match = t.match(new RegExp(`(?:${label})[^0-9]{0,24}(\\d{1,3}(?:\\.\\d+)?)`));
        return match ? Number(match[1]) : undefined;
      };
      const rpe = valueNear("rpe|rpm|effort");
      if (rpe !== undefined) {
        fields.rpe = rpe;
        fields.effortRating = rpe;
      }
      const plannedIntensityPercent = valueNear("planned\\s+intensity|intensity|percent");
      if (plannedIntensityPercent !== undefined) fields.plannedIntensityPercent = plannedIntensityPercent;
      const soreness = valueNear("soreness|sore");
      if (soreness !== undefined) fields.soreness = soreness;
      const fatigue = valueNear("fatigue|tired");
      if (fatigue !== undefined) fields.fatigue = fatigue;
      const mood = valueNear("mood");
      if (mood !== undefined) fields.mood = mood;
      const restingHeartRate = valueNear("resting\\s+(?:heart\\s*)?rate|resting\\s*hr");
      if (restingHeartRate !== undefined) fields.restingHeartRate = restingHeartRate;
      const category = t.match(/\b(?:category|training category)\s*(?:is|as|:|-)?\s*([a-z /&]+?)(?:\s+\d|\s+rpe|\s+rpm|\s+planned|\s+intensity|$)/)?.[1]?.trim();
      if (category) fields.trainingCategory = category;
      const bodyConditionFeedback = input.transcript.match(/\bbody\s*(?:condition|feeling|feedback)\s*(?:is|was|:|-)?\s*(.+)$/i)?.[1]?.trim();
      if (bodyConditionFeedback) fields.bodyConditionFeedback = bodyConditionFeedback;
      return {
        intent: "fill_rpe",
        fields,
        missingFields: fields.rpe === undefined && fields.effortRating === undefined ? ["rpe"] : [],
        followUpQuestion: fields.rpe === undefined && fields.effortRating === undefined ? "What was your session RPE from 1 to 10?" : undefined,
        requiresConfirmation: true,
        spokenResponse: "Save session RPE?",
      };
    }

    if (/sleep|slept|thookam|tookam|urakkam|thoongi|thoonginen|mood|stress|soreness|sore|fatigue|tired|sorvu|vali|azhutham/.test(t)) {
      const fields: Record<string, unknown> = {};
      const numNear = (label: string) => {
        const after = t.match(new RegExp(`(?:${label})[^0-9]{0,24}(\\d{1,3}(?:\\.\\d+)?)`));
        if (after) return Number(after[1]);
        const before = t.match(new RegExp(`(\\d{1,3}(?:\\.\\d+)?)[^a-z0-9]{0,16}(?:${label})`));
        return before ? Number(before[1]) : undefined;
      };
      const sleepHoursBefore = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:hours?|hrs?|mani|neram)\b/);
      const sleepHoursAfter = t.match(/\b(?:sleep\s+(?:hours?|duration)|hours?|hrs?|mani|neram|slept|thoongi\w*|thoonginen)[^0-9]{0,24}(\d{1,2}(?:\.\d+)?)/);
      const sleepHours = sleepHoursBefore ? Number(sleepHoursBefore[1]) : sleepHoursAfter ? Number(sleepHoursAfter[1]) : undefined;
      if (sleepHours !== undefined) fields.sleepHours = sleepHours;

      const sleepQuality = numNear(
        "sleep\\s+(?:quality|score|rating)|thookam\\s+(?:quality|score)|tookam\\s+(?:quality|score)|urakkam\\s+(?:quality|score)"
      );
      if (sleepQuality !== undefined) fields.sleepQuality = sleepQuality;

      const mood = numNear("mood");
      if (mood !== undefined) fields.mood = mood;
      const stress = numNear("stress|azhutham");
      if (stress !== undefined) fields.stress = stress;
      const soreness = numNear("soreness|sore|vali");
      if (soreness !== undefined) fields.soreness = soreness;
      const fatigue = numNear("fatigue|tired|sorvu");
      if (fatigue !== undefined) fields.fatigue = fatigue;
      return {
        intent: "fill_wellness",
        fields,
        missingFields: Object.keys(fields).length ? [] : ["sleepQuality"],
        followUpQuestion: Object.keys(fields).length ? undefined : "What sleep quality score or sleep hours should I save?",
        requiresConfirmation: true,
        spokenResponse: "Save this check-in?",
      };
    }

    if (/effort|sprint|session|training|workout/.test(t)) {
      return {
        intent: "fill_training",
        fields: { notes: input.transcript },
        missingFields: ["slot"],
        followUpQuestion: "Which session — AM, afternoon, or PM?",
        requiresConfirmation: true,
        spokenResponse: "Got it.",
      };
    }

    return {
      intent: "unsupported",
      fields: {},
      missingFields: [],
      requiresConfirmation: false,
      spokenResponse: "I can't do that yet.",
    };
  }
}

let interpreter: VoiceIntentInterpreter | null = null;

/**
 * Single choke point for resolving the active interpreter implementation.
 * Uses the real Gemini interpreter when GEMINI_API_KEY is configured;
 * otherwise the deterministic mock (keeps local dev and tests running with
 * no key/network).
 */
export function getVoiceIntentInterpreter(): VoiceIntentInterpreter {
  if (!interpreter) {
    interpreter = env.gemini.apiKey
      ? new GeminiVoiceIntentInterpreter(env.gemini.apiKey, env.gemini.model)
      : new MockVoiceIntentInterpreter();
  }
  return interpreter;
}

/** Test-only seam for injecting a fake interpreter. */
export function setVoiceIntentInterpreterForTests(impl: VoiceIntentInterpreter | null): void {
  interpreter = impl;
}
