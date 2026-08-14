import type { MealType } from "../models/PlannedMeal";

/**
 * Suggests a meal type from FOOD NAMES first, clock time only as a secondary
 * tiebreaker when the food signal is ambiguous — never purely time-based
 * (coffee at noon is still a snack; biryani at 8am is still lunch/dinner-
 * flavoured food, just logged early). Deliberately a small, explainable
 * keyword table rather than a model call — this is a UI convenience
 * suggestion, not a business-critical calculation, and doesn't need AI.
 */
const SNACK_KEYWORDS = ["coffee", "tea", "shake", "protein bar", "chips", "cookie", "biscuit", "nuts", "fruit", "smoothie"];
const BREAKFAST_KEYWORDS = ["oatmeal", "cereal", "egg", "toast", "pancake", "porridge", "idli", "dosa", "paratha"];
const LUNCH_DINNER_KEYWORDS = ["rice", "curry", "biryani", "roti", "pasta", "pizza", "salad", "soup", "sandwich", "noodles"];

function matchesAny(foodNames: string[], keywords: string[]): boolean {
  const joined = foodNames.join(" ").toLowerCase();
  return keywords.some((k) => joined.includes(k));
}

/**
 * `hourOfDay` (0-23, in the User's OWN local time — callers must resolve
 * this via the athlete's timezone, never server UTC) is only consulted when
 * the food names don't clearly indicate a type.
 */
export function suggestMealType(foodNames: string[], hourOfDay: number): MealType {
  if (matchesAny(foodNames, SNACK_KEYWORDS)) return "snack";
  if (matchesAny(foodNames, BREAKFAST_KEYWORDS)) return "breakfast";
  if (matchesAny(foodNames, LUNCH_DINNER_KEYWORDS)) {
    return hourOfDay < 15 ? "lunch" : "dinner";
  }
  // Ambiguous food signal — fall back to time-of-day as the secondary signal.
  if (hourOfDay < 11) return "breakfast";
  if (hourOfDay < 15) return "lunch";
  if (hourOfDay < 21) return "dinner";
  return "snack";
}
