/**
 * Adapter for turning a guided app-tour step's static copy into a warmer,
 * second-person line, spoken in the app's "AI agent" voice. `getTourNarrator()`
 * returns the real Gemini narrator when GEMINI_API_KEY is configured, otherwise
 * a deterministic mock that returns the given fallback verbatim. To plug in a
 * different provider, implement `TourNarrator` and swap the resolver; nothing
 * else in the codebase changes, since callers only depend on the interface.
 *
 * IMPORTANT: the model is only ever asked to rephrase a fact it is given (the
 * step's title + fallbackNote) — it is never asked to describe the UI from
 * scratch, so it cannot invent a feature or number that doesn't exist.
 */

import { env } from "../config/env";
import type { UserRole } from "../models/User";

export type TourNarrateInput = {
  role: UserRole;
  stepId: string;
  title: string;
  fallbackNote: string;
  context?: Record<string, unknown>;
};

export type TourNarrateResult = {
  note: string;
};

export interface TourNarrator {
  narrate(input: TourNarrateInput): Promise<TourNarrateResult>;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    note: {
      type: "STRING",
      description:
        "A warm, second-person, under-30-word rephrasing of the given fact. Never invent a detail that wasn't given.",
    },
  },
  required: ["note"],
};

const SYSTEM_PROMPT =
  "You are Apex Assist, a friendly onboarding guide inside a sports coaching app, narrating a guided " +
  "product tour to a first-time user. For each step you are given a section title and a factual " +
  'description of what it does — rephrase that fact in a warmer, second-person voice ("You can...", ' +
  '"Here you\'ll find...") in under 30 words. Never invent a feature, number, or behavior that wasn\'t ' +
  "given to you, and never claim the app can do something the description doesn't say.";

function buildUserPrompt(input: TourNarrateInput): string {
  const parts = [`Role: ${input.role}`, `Section title: ${input.title}`, `What it does: ${input.fallbackNote}`];
  if (input.context && Object.keys(input.context).length > 0) {
    parts.push(`Extra context: ${JSON.stringify(input.context)}`);
  }
  return parts.join("\n");
}

/**
 * Real narrator: sends the step's title/fact to Gemini and asks for a
 * grounded rephrasing only. Throws on any failure so the caller can fall
 * back to the original fallbackNote.
 */
export class GeminiTourNarrator implements TourNarrator {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async narrate(input: TourNarrateInput): Promise<TourNarrateResult> {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        temperature: 0.4,
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
    const note = (parsed as Record<string, unknown> | null)?.note;
    if (typeof note !== "string" || !note.trim()) {
      throw new Error("gemini_bad_json");
    }
    return { note: note.trim() };
  }
}

/**
 * Deterministic placeholder — used for local dev without a GEMINI_API_KEY and
 * for tests. Returns the step's own fallbackNote verbatim, so the tour is
 * fully correct (if less conversational) with zero AI cost or network calls.
 */
export class MockTourNarrator implements TourNarrator {
  async narrate(input: TourNarrateInput): Promise<TourNarrateResult> {
    return { note: input.fallbackNote };
  }
}

let narrator: TourNarrator | null = null;

/**
 * Single choke point for resolving the active narrator implementation. Uses
 * the real Gemini narrator when GEMINI_API_KEY is configured; otherwise the
 * deterministic mock (keeps local dev and tests running with no key/network).
 */
export function getTourNarrator(): TourNarrator {
  if (!narrator) {
    narrator = env.gemini.apiKey
      ? new GeminiTourNarrator(env.gemini.apiKey, env.gemini.model)
      : new MockTourNarrator();
  }
  return narrator;
}

/** Test-only seam for injecting a fake narrator. */
export function setTourNarratorForTests(impl: TourNarrator | null): void {
  narrator = impl;
}
