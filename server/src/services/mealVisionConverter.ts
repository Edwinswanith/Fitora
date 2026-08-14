/**
 * Adapter for turning a meal photo into structured food items — mirrors
 * services/workoutImageConverter.ts's exact shape (real Gemini vision when
 * GEMINI_API_KEY is configured, deterministic mock otherwise) so the two AI-
 * boundary integrations in this codebase stay consistent. Nothing this
 * module returns is ever trusted as consumed nutrition on its own — see
 * services/mealScan.ts, which sanitizes every field and requires an explicit
 * User confirm step before anything becomes a Meal.
 */

import fs from "fs";
import { env } from "../config/env";

export type MealVisionItem = {
  foodName: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  foodConfidence: number;
  quantityConfidence: number;
};

export type MealVisionResult = {
  suggestedMealName?: string;
  items: MealVisionItem[];
};

export interface MealVisionConverter {
  convert(input: { filePath: string; mimeType: string; originalName: string }): Promise<MealVisionResult>;
}

function num(value: unknown, lo: number, hi: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < lo || value > hi) return undefined;
  return value;
}
function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/**
 * Shared sanitizer for AI-detected food items — never invents a value for a
 * field the model didn't confidently provide; a food/item that fails
 * validation is dropped rather than persisted with a guessed number. Caps at
 * 20 items per scan (a single plate/meal photo is never realistically more
 * than that — a higher count is a strong signal of a bad detection).
 */
export function sanitizeMealVisionItems(input: unknown): MealVisionItem[] {
  if (!Array.isArray(input)) return [];
  const items: MealVisionItem[] = [];
  for (const raw of input.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const foodName = str(r.foodName, 160);
    const unit = str(r.unit, 40);
    const quantity = num(r.quantity, 0, 10000);
    const calories = num(r.calories, 0, 5000);
    const proteinG = num(r.proteinG, 0, 500);
    const carbsG = num(r.carbsG, 0, 800);
    const fatG = num(r.fatG, 0, 400);
    const foodConfidence = num(r.foodConfidence, 0, 1);
    const quantityConfidence = num(r.quantityConfidence, 0, 1);
    // Every required field must be present and valid — a partially-detected
    // item is dropped, not persisted with a placeholder/invented value.
    if (
      foodName === undefined ||
      unit === undefined ||
      quantity === undefined ||
      calories === undefined ||
      proteinG === undefined ||
      carbsG === undefined ||
      fatG === undefined ||
      foodConfidence === undefined ||
      quantityConfidence === undefined
    ) {
      continue;
    }
    const fiberG = num(r.fiberG, 0, 200);
    items.push({ foodName, quantity, unit, calories, proteinG, carbsG, fatG, fiberG, foodConfidence, quantityConfidence });
  }
  return items;
}

export class GeminiMealVisionConverter implements MealVisionConverter {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async convert(input: { filePath: string; mimeType: string; originalName: string }): Promise<MealVisionResult> {
    const base64 = await fs.promises.readFile(input.filePath, { encoding: "base64" });
    const prompt =
      "You are identifying food items in a photo of a meal for nutrition tracking. For each " +
      "distinct food item visible, estimate: foodName, quantity, unit (e.g. 'g', 'ml', 'piece', " +
      "'cup'), calories, proteinG, carbsG, fatG, and optionally fiberG. Also provide foodConfidence " +
      "(0-1, how sure you are of the food's IDENTITY) and quantityConfidence (0-1, how sure you are " +
      "of the estimated QUANTITY/portion size) for each item separately, since identity and portion " +
      "size can be uncertain independently. Also suggest an overall mealName describing the plate.\n\n" +
      "CRITICAL: if you cannot identify a food item with reasonable confidence, DO NOT invent one — " +
      "omit it entirely rather than guessing. Never fabricate nutrition values for a food you cannot " +
      "actually see. If the image contains no identifiable food, return an empty items array.";

    const body = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: input.mimeType, data: base64 } }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            suggestedMealName: { type: "STRING" },
            items: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  foodName: { type: "STRING" },
                  quantity: { type: "NUMBER" },
                  unit: { type: "STRING" },
                  calories: { type: "NUMBER" },
                  proteinG: { type: "NUMBER" },
                  carbsG: { type: "NUMBER" },
                  fatG: { type: "NUMBER" },
                  fiberG: { type: "NUMBER" },
                  foodConfidence: { type: "NUMBER" },
                  quantityConfidence: { type: "NUMBER" },
                },
                required: [
                  "foodName", "quantity", "unit", "calories", "proteinG", "carbsG", "fatG",
                  "foodConfidence", "quantityConfidence",
                ],
              },
            },
          },
          required: ["items"],
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
    const rec = parsed as Record<string, unknown>;
    return {
      suggestedMealName: str(rec.suggestedMealName, 160),
      items: sanitizeMealVisionItems(rec.items),
    };
  }
}

/**
 * Deterministic placeholder — does not read pixel data. Returns a plausible
 * generic single-item result with DELIBERATELY MODERATE confidence, so the
 * "needs review" UI path is exercised the same way a genuinely uncertain
 * real detection would trigger it.
 */
export class MockMealVisionConverter implements MealVisionConverter {
  async convert(input: { filePath: string; mimeType: string; originalName: string }): Promise<MealVisionResult> {
    return {
      suggestedMealName: `Mock scan of "${input.originalName}"`,
      items: [
        {
          foodName: "Unidentified plate item",
          quantity: 1,
          unit: "serving",
          calories: 400,
          proteinG: 20,
          carbsG: 40,
          fatG: 15,
          foodConfidence: 0.4,
          quantityConfidence: 0.4,
        },
      ],
    };
  }
}

let converter: MealVisionConverter | null = null;

export function getMealVisionConverter(): MealVisionConverter {
  if (!converter) {
    converter = env.gemini.apiKey
      ? new GeminiMealVisionConverter(env.gemini.apiKey, env.gemini.model)
      : new MockMealVisionConverter();
  }
  return converter;
}

export function setMealVisionConverterForTests(impl: MealVisionConverter | null): void {
  converter = impl;
}
