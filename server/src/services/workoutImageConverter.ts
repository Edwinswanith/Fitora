/**
 * Adapter for turning a coach-uploaded workout image into a structured table.
 * `getWorkoutImageConverter()` returns the real Gemini vision converter when
 * GEMINI_API_KEY is configured, otherwise the mock placeholder below. To plug in
 * a different provider, implement `WorkoutImageConverter` and swap the resolver;
 * nothing else in the codebase changes, since callers only depend on the interface.
 */

import fs from "fs";
import { env } from "../config/env";

export type WorkoutTableRow = {
  name: string;
  sets?: string;
  reps?: string;
  distance?: string;
  duration?: string;
  intensity?: string;
  notes?: string;
};

export interface WorkoutImageConverter {
  /** Reads the image at `filePath` and returns the workout it depicts as table rows. */
  convert(input: {
    filePath: string;
    mimeType: string;
    originalName: string;
  }): Promise<WorkoutTableRow[]>;
}

// Trim to the WorkoutMedia row field limits (name 160, short fields 40, notes 500).
function cap(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/**
 * Shared row sanitizer — enforces the same field caps and row-count limit
 * (80) as the Gemini converter, and drops any row without a name. Used both
 * for AI-converted rows and for a coach's manual edits to a table, so the
 * two paths can never diverge in what they consider a valid row.
 */
export function sanitizeWorkoutTableRows(input: unknown): WorkoutTableRow[] {
  if (!Array.isArray(input)) return [];
  const rows: WorkoutTableRow[] = [];
  for (const raw of input.slice(0, 80)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = cap(r.name, 160);
    if (!name) continue; // name is required — skip junk rows
    rows.push({
      name,
      sets: cap(r.sets, 40),
      reps: cap(r.reps, 40),
      distance: cap(r.distance, 40),
      duration: cap(r.duration, 40),
      intensity: cap(r.intensity, 40),
      notes: cap(r.notes, 500),
    });
  }
  return rows;
}

/**
 * Real converter: sends the actual image to Google's Gemini vision model and
 * asks for ONLY the workout exercises as structured rows — titles, page numbers,
 * coaching prose and other non-exercise text are excluded by the prompt + schema.
 * Throws on any failure so the caller records the conversion as "failed".
 */
export class GeminiWorkoutImageConverter implements WorkoutImageConverter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async convert(input: { filePath: string; mimeType: string; originalName: string }): Promise<WorkoutTableRow[]> {
    const base64 = await fs.promises.readFile(input.filePath, { encoding: "base64" });
    const prompt =
      "You are reading a photo or scan of a coach's workout/training plan. It may be laid " +
      "out as a strict table (columns like Exercise/Sets/Reps/Rest/Intensity), OR as a " +
      "structured form/grid (e.g. weeks as columns, with sections like 'Warm-up activities', " +
      "'Drills and games', 'Cool-down activities' each containing a bulleted list of exercise " +
      "names and no separate numeric columns). Handle BOTH layouts:\n\n" +
      "1. Extract ONLY the actual exercises/drills as structured rows — one row per exercise " +
      "or bullet item. Use exactly what the image shows — do not invent or summarise. Exclude " +
      "section/topic headings on their own (e.g. a lone 'Aerobic Endurance' skill heading is " +
      "not an exercise), dates, athlete names, page numbers, and equipment lists.\n" +
      "2. If a bullet/cell is a plain exercise name with no numbers next to it (typical of the " +
      "form-style layout), still return it as a row with just `name` filled in — do NOT skip " +
      "it and do NOT invent sets/reps/duration/intensity values that are not shown anywhere.\n" +
      "3. IMPORTANT — numbers are often embedded inside the exercise text itself rather than in " +
      "a separate column, e.g. '3 km run', 'Sprints x10', '20 min uphill', '4x8 Ball Control'. " +
      "When that happens, pull the number into the matching field (distance='3 km', " +
      "duration='20 min', sets='4', reps='8') AND keep a clean exercise name (e.g. name='Run', " +
      "name='Sprints', name='Uphill Running', name='Ball Control') rather than leaving the raw " +
      "text only in `name`.\n" +
      "4. If the image is organised by week/day/session, prefix `name` with that grouping so " +
      "rows from different weeks stay distinguishable, e.g. name='Week 1 — Sprint Drills'. If " +
      "the image shows which section a row came from (Warm-up vs Drills and games vs " +
      "Cool-down), you may note that in `notes`, e.g. notes='Warm-up'.\n" +
      "5. Only fill sets/reps/distance/duration/intensity when the image actually specifies " +
      "that value (either in a real column, or embedded in the text per rule 3) — leave the " +
      "field absent, not a guessed value, when genuinely not specified anywhere.\n" +
      "For each exercise return: name (required), and when determinable sets, reps, distance, " +
      "duration, intensity, notes. If the image contains no workout at all, return an empty array.";

    const body = {
      contents: [
        {
          parts: [
            { text: prompt },
            { inline_data: { mime_type: input.mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: {
                type: "STRING",
                description: "Clean exercise/drill name, without embedded numbers already captured in other fields.",
              },
              sets: { type: "STRING", description: "Number of sets, only if explicitly shown or embedded (e.g. '4' from '4x8')." },
              reps: { type: "STRING", description: "Reps per set, only if explicitly shown or embedded (e.g. '8' from '4x8')." },
              distance: { type: "STRING", description: "Distance, only if explicitly shown or embedded (e.g. '3 km' from '3 km run')." },
              duration: { type: "STRING", description: "Time/duration, only if explicitly shown or embedded (e.g. '20 min')." },
              intensity: { type: "STRING", description: "Effort/intensity label if shown (e.g. Low/Moderate/High)." },
              notes: { type: "STRING", description: "Optional context, e.g. which section (Warm-up/Drills/Cool-down) the row came from." },
            },
            required: ["name"],
          },
        },
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
    if (!Array.isArray(parsed)) throw new Error("gemini_not_array");

    return sanitizeWorkoutTableRows(parsed);
  }
}

/**
 * Deterministic placeholder — does not actually read pixel data. Returns a
 * plausible generic session structure so the rest of the product (table UI,
 * send-to-athlete flow, tests) has something real to work against while a
 * real OCR/vision provider isn't configured yet.
 */
export class MockWorkoutImageConverter implements WorkoutImageConverter {
  async convert(input: {
    filePath: string;
    mimeType: string;
    originalName: string;
  }): Promise<WorkoutTableRow[]> {
    return [
      {
        name: "Warm-up",
        sets: "1",
        reps: "-",
        distance: "400m",
        duration: "8 min",
        intensity: "Low",
        notes: `Mock conversion of "${input.originalName}" — connect a real OCR/vision provider to replace this.`,
      },
      {
        name: "Main set",
        sets: "4",
        reps: "8",
        distance: "-",
        duration: "20 min",
        intensity: "Moderate-High",
        notes: "Placeholder row — review and edit against the source image.",
      },
      {
        name: "Cool-down",
        sets: "1",
        reps: "-",
        distance: "200m",
        duration: "5 min",
        intensity: "Low",
        notes: "",
      },
    ];
  }
}

let converter: WorkoutImageConverter | null = null;

/**
 * Single choke point for resolving the active converter implementation. Uses the
 * real Gemini vision converter when GEMINI_API_KEY is configured; otherwise the
 * mock placeholder (keeps local dev and tests running with no key/network).
 */
export function getWorkoutImageConverter(): WorkoutImageConverter {
  if (!converter) {
    converter = env.gemini.apiKey
      ? new GeminiWorkoutImageConverter(env.gemini.apiKey, env.gemini.model)
      : new MockWorkoutImageConverter();
  }
  return converter;
}

/** Test-only seam for injecting a fake converter. */
export function setWorkoutImageConverterForTests(impl: WorkoutImageConverter | null): void {
  converter = impl;
}
