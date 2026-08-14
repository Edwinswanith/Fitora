/**
 * V2 voice NLU adapter — classification and entity extraction ONLY.
 *
 * Unlike the V1 interpreter (voiceIntentInterpreter.ts, left untouched and
 * still serving the existing /api/athlete/voice/interpret endpoint), this
 * interpreter's output has no `action`, `missingFields`, `requiresConfirmation`,
 * or `spokenResponse` — those are exclusively the responsibility of
 * voiceIntentPolicy.ts. The model here cannot decide what happens next, which
 * API is called, or whether confirmation is required; it can only be wrong
 * about the intent/entities/confidence, all three of which are re-validated
 * by sanitizeModelOutput() before anything downstream trusts them.
 */

import { env } from "../config/env";
import { VOICE_INTENTS_V2, type VoiceIntentNameV2, type SanitizedTurn, type PolicyPendingState } from "./voiceIntentPolicy";
import { TRAINING_CATEGORIES } from "../lib/trainingCategories";

export type VoiceInterpretInputV2 = {
  transcript: string;
  today: string;
  pendingIntent?: PolicyPendingState;
};

export interface VoiceIntentInterpreterV2 {
  interpret(input: VoiceInterpretInputV2): Promise<SanitizedTurn>;
}

const RESPONSE_SCHEMA_V2 = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: VOICE_INTENTS_V2 as unknown as string[] },
    entities: {
      type: "OBJECT",
      description:
        "Only entities explicitly said or unambiguously implied by THIS turn — never invent values, " +
        "never re-state values from a prior turn unless the athlete repeated them.",
      properties: {
        sleepHours: { type: "NUMBER", description: "log_wellness: hours slept, 0-14." },
        sleepQuality: { type: "NUMBER", description: "log_wellness/log_rpe: spoken 1-10 scale." },
        mood: { type: "NUMBER", description: "log_wellness: spoken 1-10 scale." },
        stress: { type: "NUMBER", description: "log_wellness: spoken 1-10 scale." },
        soreness: { type: "NUMBER", description: "log_wellness: spoken 1-10 scale." },
        fatigue: { type: "NUMBER", description: "log_wellness/log_rpe: spoken 1-10 scale." },
        sessionType: { type: "STRING", enum: ["AM", "AFT", "PM"], description: "log_session/log_rpe: which session slot." },
        status: {
          type: "STRING",
          enum: ["planned", "in_progress", "completed", "skipped", "rest"],
          description: "log_session: completion status.",
        },
        workoutType: { type: "STRING", description: "log_session: short workout/drill label, e.g. 'Sprints'." },
        actualDurationMin: { type: "NUMBER", description: "log_session: minutes trained, 0-600." },
        sets: { type: "NUMBER", description: "log_session: number of sets." },
        reps: { type: "STRING", description: "log_session: reps or distance per set, e.g. '100m'." },
        notes: { type: "STRING", description: "log_session: free-text notes." },
        rpe: {
          type: "NUMBER",
          description:
            "log_session/log_rpe: session RPE, 0-10. DISTINCT from effortScore — never inferred from it.",
        },
        effortScore: {
          type: "NUMBER",
          description: "log_session: effort rating, spoken 1-10 scale. DISTINCT from rpe — never inferred from it.",
        },
        trainingCategory: {
          type: "STRING",
          description:
            "log_rpe always, log_session only if rpe is also given (an RPE reading needs a category to be saved): " +
            "training category (validated against a fixed list server-side).",
        },
        plannedIntensityPercent: {
          type: "NUMBER",
          description: "log_rpe always, log_session only if rpe is also given: planned intensity percent, 0-100.",
        },
        restingHeartRate: { type: "NUMBER", description: "log_rpe: resting heart rate in bpm, 20-220." },
        bodyConditionFeedback: { type: "STRING", description: "log_rpe: free-text body condition feedback." },
        modalities: {
          type: "ARRAY",
          items: { type: "STRING", enum: ["stretching", "ice_bath", "mobility", "physio", "hydration"] },
          description: "log_recovery: recovery modalities completed today.",
        },
        skipped: { type: "BOOLEAN", description: "log_recovery: true if the athlete explicitly skipped recovery." },
        amountMl: { type: "NUMBER", description: "add_water: amount in millilitres, 1-4000." },
        goalMl: { type: "NUMBER", description: "set_water_goal: new daily goal in millilitres, 500-8000." },
        enabled: { type: "BOOLEAN", description: "change_hydration_reminder/mark_rest_day: on/off." },
        intervalMinutes: { type: "NUMBER", description: "change_hydration_reminder: minimum spacing between reminders, 15-720." },
        body: { type: "STRING", description: "send_coach_note/add_note: the message or note body." },
        screen: {
          type: "STRING",
          enum: ["today", "progress", "log", "coach", "messages", "water", "goals", "trends"],
          description: "open_screen: which section/tab to open.",
        },
        term: { type: "STRING", description: "explain_app_field: the Apex-specific term asked about." },
        wakeHr: { type: "NUMBER", description: "log_heart_rate: waking heart rate in bpm, 25-220." },
        bedHr: { type: "NUMBER", description: "log_heart_rate: resting heart rate before bed in bpm, 25-220." },
        heightCm: { type: "NUMBER", description: "update_profile: height in centimetres, 50-250." },
        weightKg: { type: "NUMBER", description: "update_profile: weight in kilograms, 20-250." },
        position: { type: "STRING", description: "update_profile: playing position, e.g. 'striker'." },
      },
    },
    confidence: {
      type: "NUMBER",
      description: "Calibrated 0-1 confidence in this classification and extraction — lower for ambiguous/short/noisy input.",
    },
  },
  required: ["intent", "entities", "confidence"],
};

const SYSTEM_PROMPT_V2 =
  "You are the natural-language understanding layer for an athlete's voice assistant in a sports " +
  "coaching app. Your ONLY job is to classify the transcript into exactly one supported intent and " +
  "extract explicitly-stated entities with a calibrated confidence. You do NOT decide what happens " +
  "next, whether confirmation is needed, which API is called, or what the app says back — a " +
  "separate system handles all of that. Do not attempt to be conversational or helpful beyond " +
  "this classification task.\n\n" +
  `Classify into exactly one of: ${VOICE_INTENTS_V2.join(", ")}.\n\n` +
  "If the athlete asks something unrelated to their own logging/data/the app's own terms (e.g. " +
  "general training-science trivia, anything about another athlete, anything not about this app), " +
  "use unknown_intent. Use explain_app_field only for a short 'what is X' question about an " +
  "Apex-specific term (RPE, RPM, readiness, training load, risk flag, effort score, recovery " +
  "modality, hydration goal) — extract entities.term as the term asked about; do not explain it " +
  "yourself, you have no access to the approved definitions.\n\n" +
  "Use update_field only when a pendingIntent is already in progress and the athlete is " +
  "correcting/adding to already-collected values — extract ONLY the field(s) just mentioned, never " +
  "re-state or guess unchanged fields. Use confirm_action for a bare affirmative, cancel_action for " +
  "a bare negative, only when a pendingIntent exists.\n\n" +
  "rpe and effortScore are DISTINCT fields — never infer one from the other. Only include a field " +
  "if the athlete explicitly stated it.\n\n" +
  "Extract only entities explicitly said or unambiguously implied — never invent values. " +
  "sleepQuality/mood/stress/soreness/fatigue/effortScore are spoken 1-10 (the app converts to its " +
  "internal 1-5 scale — you do not). rpe is 0-10.\n\n" +
  "log_session must handle one-sentence multi-value input, e.g. 'I completed four sets of " +
  "100-metre sprints this morning in 45 minutes, RPE 8 and effort 9' -> sessionType=AM, " +
  "status=completed, workoutType='Sprints', sets=4, reps='100m', actualDurationMin=45, rpe=8, " +
  "effortScore=9 — extract every distinct value present in one pass, keeping rpe and effortScore " +
  "separate.\n\n" +
  "If a log_session turn includes an rpe value, also extract trainingCategory and " +
  "plannedIntensityPercent when the athlete stated them — an RPE reading can only be saved with a " +
  "training category and planned intensity attached. Do not guess or default these two fields.\n\n" +
  "Distinguish send_coach_note (explicit 'tell/send/message my coach...') from add_note (private, " +
  "not sent to the coach). Never extract a coach name or identifier — coach targeting is resolved " +
  "by the app, not by you.\n\n" +
  "log_heart_rate is for a standalone heart-rate reading not tied to an RPE workflow (e.g. 'my " +
  "waking heart rate was 52', 'resting heart rate before bed was 58'). If restingHeartRate is " +
  "mentioned alongside an RPE/training-category context, that belongs to log_rpe's " +
  "restingHeartRate field instead, not log_heart_rate.\n\n" +
  "update_profile is only for height, weight, or playing position ('I'm now 178 centimetres', " +
  "'I weigh 72 kilos', 'my position is striker'). Never extract a name, date of birth, sport, or " +
  "timezone by voice — those aren't supported here.\n\n" +
  "show_daily_checklist is for a general 'what have I not logged today' / 'what's left for me to " +
  "update today' / 'what am I missing today' question — classify topic only, you have no access to " +
  "real data; the app fills in the actual answer.\n\n" +
  "Tamil, Tanglish, and mixed Tamil-English commands may appear; 'sleep score 8' means " +
  "sleepQuality=8; 'naan 7 mani neram thoonginen sleep score 6' means sleepHours=7, " +
  "sleepQuality=6. Only extract sleepHours when the athlete says hours/hrs/mani/neram.\n\n" +
  "For show_readiness/show_today_plan/show_progress/show_coach_feedback/show_daily_checklist: " +
  "classify topic only, and never invent/state a number, plan detail, or feedback text — you have " +
  "no access to real data.\n\n" +
  "Report a calibrated confidence 0-1 — lower it for ambiguous, very short, or noisy transcripts.\n\n" +
  "If pendingIntent is provided, merge newly-stated entities with the ones already collected " +
  "mentally to decide the right intent (e.g. update_field vs. a fresh intent), but only return the " +
  "entities from THIS turn.";

function buildUserPrompt(input: VoiceInterpretInputV2): string {
  const parts = [`Today's date: ${input.today}`];
  if (input.pendingIntent) {
    parts.push(
      `In-progress intent: ${input.pendingIntent.intent}`,
      `Already collected: ${JSON.stringify(input.pendingIntent.entities)}`,
      `Still missing: ${input.pendingIntent.missingFields.join(", ") || "(none)"}`
    );
  }
  parts.push(`Transcript: "${input.transcript}"`);
  return parts.join("\n");
}

/**
 * Validates a raw model response into the strict {intent, entities,
 * confidence} shape. Any malformed output is downgraded to unknown_intent
 * with confidence 0 — never trusted, never partially applied.
 */
export function sanitizeModelOutput(raw: unknown): SanitizedTurn {
  const r = (raw ?? {}) as Record<string, unknown>;
  const intentValid = VOICE_INTENTS_V2.includes(r.intent as VoiceIntentNameV2);
  const entitiesValid = r.entities !== null && typeof r.entities === "object" && !Array.isArray(r.entities);
  const confidenceRaw = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : undefined;

  if (!intentValid || !entitiesValid || confidenceRaw === undefined) {
    return { intent: "unknown_intent", entities: {}, confidence: 0 };
  }

  return {
    intent: r.intent as VoiceIntentNameV2,
    entities: r.entities as Record<string, unknown>,
    confidence: Math.max(0, Math.min(1, confidenceRaw)),
  };
}

export class GeminiVoiceIntentInterpreterV2 implements VoiceIntentInterpreterV2 {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async interpret(input: VoiceInterpretInputV2): Promise<SanitizedTurn> {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT_V2 }] },
      contents: [{ parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA_V2,
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
    if (!res.ok) throw new Error(`gemini_http_${res.status}`);

    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("gemini_empty_response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("gemini_bad_json");
    }
    return sanitizeModelOutput(parsed);
  }
}

/**
 * Deterministic keyword-based placeholder for local dev without a
 * GEMINI_API_KEY, and for tests — no network dependency. Confidence is
 * synthesized (1.0 clean keyword match / 0.6 heuristic / 0.3 unknown) so
 * low-confidence UI paths are testable without a live model.
 */
export class MockVoiceIntentInterpreterV2 implements VoiceIntentInterpreterV2 {
  async interpret(input: VoiceInterpretInputV2): Promise<SanitizedTurn> {
    const t = input.transcript.toLowerCase().trim();
    const pending = input.pendingIntent;

    if (pending && /^(yes|yeah|yep|confirm|correct|do it|save it)\b/.test(t)) {
      return { intent: "confirm_action", entities: {}, confidence: 0.95 };
    }
    if (pending && /^(no|nope|cancel|don't|stop|never mind)\b/.test(t)) {
      return { intent: "cancel_action", entities: {}, confidence: 0.95 };
    }
    if (pending && /\bactually\b|\bi meant\b|\bchange (it|that) to\b/.test(t)) {
      return { intent: "update_field", entities: extractEntitiesFor(pending.intent, t, input.transcript), confidence: 0.75 };
    }

    if (/^(open|show|go to)\b/.test(t)) {
      const screens: Record<string, string> = {
        today: "today",
        progress: "progress",
        log: "log",
        training: "log",
        coach: "coach",
        messages: "messages",
        water: "water",
        goals: "goals",
        trends: "trends",
      };
      for (const [keyword, screen] of Object.entries(screens)) {
        if (t.includes(keyword)) return { intent: "open_screen", entities: { screen }, confidence: 0.9 };
      }
    }

    if (/\bwhat is\b|\bwhat does\b.*\bmean\b|\bexplain\b/.test(t)) {
      const term = ["rpe", "rpm", "readiness", "training load", "risk flag", "effort score", "recovery modality", "hydration goal"].find(
        (candidate) => t.includes(candidate)
      );
      if (term) return { intent: "explain_app_field", entities: { term }, confidence: 0.85 };
      return { intent: "unknown_intent", entities: {}, confidence: 0.3 };
    }

    if (
      /\bwhat\b[\s\S]{0,20}\b(?:missing|left|still need)\b/.test(t) ||
      /\bwhat should i (?:log|update|do) today\b/.test(t) ||
      /\bhave i logged everything\b|\bdaily checklist\b/.test(t)
    ) {
      return { intent: "show_daily_checklist", entities: {}, confidence: 0.8 };
    }

    if (t.includes("readiness") || t.includes("how am i")) return { intent: "show_readiness", entities: {}, confidence: 0.85 };
    if (t.includes("today") && t.includes("plan")) return { intent: "show_today_plan", entities: {}, confidence: 0.8 };
    if (t.includes("progress") || t.includes("trend")) return { intent: "show_progress", entities: {}, confidence: 0.8 };
    if (t.includes("coach") && t.includes("feedback")) return { intent: "show_coach_feedback", entities: {}, confidence: 0.8 };
    if (t.includes("water") && (t.includes("how much") || t.includes("left") || t.includes("remaining"))) {
      return { intent: "show_hydration", entities: {}, confidence: 0.8 };
    }

    if (/\bset\b.*\bgoal\b/.test(t) && t.includes("water")) {
      return { intent: "set_water_goal", entities: extractEntitiesFor("set_water_goal", t, input.transcript), confidence: 0.75 };
    }
    if (/\bremind/.test(t) || (/\breminder/.test(t) && (t.includes("off") || t.includes("on") || /\d+\s*minute/.test(t)))) {
      return { intent: "change_hydration_reminder", entities: extractEntitiesFor("change_hydration_reminder", t, input.transcript), confidence: 0.7 };
    }
    if (t.includes("water") || t.includes("drink") || t.includes("hydrat")) {
      return { intent: "add_water", entities: extractEntitiesFor("add_water", t, input.transcript), confidence: 0.75 };
    }

    if (/\brest day\b/.test(t)) return { intent: "mark_rest_day", entities: { enabled: true }, confidence: 0.85 };
    if (/\bskip recovery\b/.test(t)) return { intent: "log_recovery", entities: { skipped: true }, confidence: 0.85 };
    if (/\brecovery\b|\bstretch(?:ing)?\b|\bice\s*bath\b|\bmobility\b|\bphysio\b/.test(t)) {
      return { intent: "log_recovery", entities: extractEntitiesFor("log_recovery", t, input.transcript), confidence: 0.7 };
    }

    if (/\bheight\b|\bweight\b|\bmy position is\b|\bplaying position\b/.test(t) && !/\bheart\s*rate\b|\bbpm\b/.test(t)) {
      return { intent: "update_profile", entities: extractEntitiesFor("update_profile", t, input.transcript), confidence: 0.7 };
    }

    if (t.includes("coach") && (t.includes("tell") || t.includes("send") || t.includes("message"))) {
      return { intent: "send_coach_note", entities: { body: input.transcript }, confidence: 0.7 };
    }
    if (/\b(?:add|save|write|create|log)\s+(?:a\s+)?note\b/.test(t)) {
      return { intent: "add_note", entities: { body: input.transcript }, confidence: 0.7 };
    }

    if (/\bcheck.?in\b/.test(t)) return { intent: "start_check_in", entities: {}, confidence: 0.85 };

    // A one-sentence session description ("session", "sets", "completed", a
    // duration in minutes) belongs to log_session even when it also mentions
    // planned intensity/training category — those are valid log_session
    // entities too now that an attached rpe reading requires them (see
    // voiceIntentPolicy's log_session missing-fields rule). Only route to the
    // dedicated log_rpe workflow when there's NO session-completion framing —
    // e.g. a standalone "log my RPE, planned intensity 80, max speed".
    const hasSessionSignal = /\bsession\b|\btraining\b|\bworkout\b|\bsprint\b|\bsets?\b|\bcompleted\b|\bfinished\b|\bminutes?\b/.test(t);
    if (hasSessionSignal) {
      return { intent: "log_session", entities: extractEntitiesFor("log_session", t, input.transcript), confidence: 0.6 };
    }

    const hasRpeSpecificVocab = /\bplanned\s+intensity\b|\bbody\s*condition\b|\btraining\s+category\b/.test(t);
    if (hasRpeSpecificVocab) {
      return { intent: "log_rpe", entities: extractEntitiesFor("log_rpe", t, input.transcript), confidence: 0.7 };
    }

    // A standalone heart-rate reading (no session/rpe-specific context above)
    // is its own intent — log_rpe's restingHeartRate field only applies
    // inside an actual RPE workflow, caught by the checks above.
    if (/\bheart\s*rate\b|\bbpm\b|\bwak(?:e|ing)\s*hr\b|\bresting\s*hr\b/.test(t)) {
      return { intent: "log_heart_rate", entities: extractEntitiesFor("log_heart_rate", t, input.transcript), confidence: 0.7 };
    }

    if (/\brpe\b|\brpm\b/.test(t)) {
      return { intent: "log_rpe", entities: extractEntitiesFor("log_rpe", t, input.transcript), confidence: 0.6 };
    }

    if (/sleep|slept|mood|stress|soreness|sore|fatigue|tired/.test(t)) {
      return { intent: "log_wellness", entities: extractEntitiesFor("log_wellness", t, input.transcript), confidence: 0.65 };
    }

    return { intent: "unknown_intent", entities: {}, confidence: 0.2 };
  }
}

function numberNear(text: string, label: string): number | undefined {
  const after = text.match(new RegExp(`(?:${label})[^0-9]{0,32}(\\d{1,4}(?:\\.\\d+)?)`));
  if (after) return Number(after[1]);
  const before = text.match(new RegExp(`(\\d{1,4}(?:\\.\\d+)?)[^a-z0-9]{0,20}(?:${label})`));
  return before ? Number(before[1]) : undefined;
}

/** Minimal shared entity-extraction heuristics for the mock interpreter's fallback path. */
function extractEntitiesFor(intent: VoiceIntentNameV2, t: string, rawTranscript: string): Record<string, unknown> {
  const entities: Record<string, unknown> = {};

  if (intent === "log_wellness" || intent === "log_rpe") {
    const sleepQuality = numberNear(t, "sleep\\s+(?:quality|score|rating)");
    if (sleepQuality !== undefined) entities.sleepQuality = sleepQuality;
    const mood = numberNear(t, "mood");
    if (mood !== undefined) entities.mood = mood;
    const stress = numberNear(t, "stress");
    if (stress !== undefined) entities.stress = stress;
    const soreness = numberNear(t, "soreness|sore");
    if (soreness !== undefined) entities.soreness = soreness;
    const fatigue = numberNear(t, "fatigue|tired");
    if (fatigue !== undefined) entities.fatigue = fatigue;
    const sleepHours = t.match(/(\d{1,2}(?:\.\d+)?)\s*(?:hours?|hrs?)\b/);
    if (sleepHours) entities.sleepHours = Number(sleepHours[1]);
  }

  if (intent === "log_session" || intent === "log_rpe") {
    if (t.includes("afternoon") || /\baft\b/.test(t)) entities.sessionType = "AFT";
    else if (/\bpm\b|\bevening\b|\bnight\b/.test(t)) entities.sessionType = "PM";
    else if (/\bam\b|\bmorning\b/.test(t)) entities.sessionType = "AM";

    const rpe = numberNear(t, "rpe|rpm");
    if (rpe !== undefined) entities.rpe = rpe;

    // Both intents can save an rpe reading, which requires a training
    // category and planned intensity — extract them whenever explicitly said.
    const category = TRAINING_CATEGORIES.find((c) => t.includes(c.toLowerCase()));
    if (category) entities.trainingCategory = category;
    const plannedIntensityPercent = numberNear(t, "planned\\s+intensity|intensity|percent");
    if (plannedIntensityPercent !== undefined) entities.plannedIntensityPercent = plannedIntensityPercent;

    if (intent === "log_session") {
      const effort = numberNear(t, "effort");
      if (effort !== undefined) entities.effortScore = effort;
      if (t.includes("completed") || t.includes("did") || t.includes("finished")) entities.status = "completed";
      else if (t.includes("skipped") || t.includes("missed")) entities.status = "skipped";
      const duration = t.match(/(\d{1,3})\s*minutes?\b/);
      if (duration) entities.actualDurationMin = Number(duration[1]);
      const sets = t.match(/(\d{1,2})\s*sets?\b/);
      if (sets) entities.sets = Number(sets[1]);
      const distance = t.match(/(\d{1,4})\s*(?:m|metre|meter)s?\b/);
      if (distance) entities.reps = `${distance[1]}m`;
      if (t.includes("sprint")) entities.workoutType = "Sprints";
    }
  }

  if (intent === "add_water") {
    const ml = t.match(/(\d{1,4})\s*ml\b/);
    if (ml) entities.amountMl = Number(ml[1]);
    else {
      const litre = t.match(/(\d+(?:\.\d+)?)\s*l(?:itre|iter)?s?\b/);
      if (litre) entities.amountMl = Math.round(Number(litre[1]) * 1000);
    }
  }

  if (intent === "set_water_goal") {
    const litre = t.match(/(\d+(?:\.\d+)?)\s*l(?:itre|iter)?s?\b/);
    if (litre) entities.goalMl = Math.round(Number(litre[1]) * 1000);
    else {
      const ml = t.match(/(\d{2,5})\s*ml\b/);
      if (ml) entities.goalMl = Number(ml[1]);
    }
  }

  if (intent === "change_hydration_reminder") {
    if (t.includes("off")) entities.enabled = false;
    else if (t.includes("on")) entities.enabled = true;
    const minutes = t.match(/(\d{1,3})\s*minutes?\b/);
    if (minutes) entities.intervalMinutes = Number(minutes[1]);
  }

  if (intent === "log_recovery") {
    const modalities: string[] = [];
    if (/\bstretch(?:ing)?\b/.test(t)) modalities.push("stretching");
    if (/\bice\s*bath\b/.test(t)) modalities.push("ice_bath");
    if (/\bmobility\b/.test(t)) modalities.push("mobility");
    if (/\bphysio\b/.test(t)) modalities.push("physio");
    if (/\bhydrat/.test(t)) modalities.push("hydration");
    if (modalities.length) entities.modalities = modalities;
  }

  if (intent === "log_heart_rate") {
    const wake = numberNear(t, "wak(?:e|ing)(?:\\s*hr|\\s+heart\\s*rate)?");
    if (wake !== undefined) entities.wakeHr = wake;
    const bed = numberNear(t, "bed(?:\\s*hr|\\s+heart\\s*rate)?|resting(?:\\s*hr|\\s+heart\\s*rate)?");
    if (bed !== undefined) entities.bedHr = bed;
    if (wake === undefined && bed === undefined) {
      // No wake/bed/resting qualifier said — a bare "heart rate was 58" with
      // nothing to disambiguate defaults to the resting/bed reading.
      const generic = numberNear(t, "heart\\s*rate|bpm");
      if (generic !== undefined) entities.bedHr = generic;
    }
  }

  if (intent === "update_profile") {
    const heightCm = numberNear(t, "(?:centimet(?:re|er)s?|cm)");
    if (heightCm !== undefined) entities.heightCm = heightCm;
    const weightKg = numberNear(t, "(?:kilo(?:gram)?s?|kg)");
    if (weightKg !== undefined) entities.weightKg = weightKg;
    const position = t.match(/\b(?:my position is|playing position is|position is|position as)\s+([a-z]+(?:\s[a-z]+){0,2})/);
    if (position) entities.position = position[1].trim();
  }

  void rawTranscript;
  return entities;
}

let interpreterV2: VoiceIntentInterpreterV2 | null = null;

export function getVoiceIntentInterpreterV2(): VoiceIntentInterpreterV2 {
  if (!interpreterV2) {
    interpreterV2 = env.gemini.apiKey
      ? new GeminiVoiceIntentInterpreterV2(env.gemini.apiKey, env.gemini.model)
      : new MockVoiceIntentInterpreterV2();
  }
  return interpreterV2;
}

/** Test-only seam for injecting a fake interpreter. */
export function setVoiceIntentInterpreterV2ForTests(impl: VoiceIntentInterpreterV2 | null): void {
  interpreterV2 = impl;
}
