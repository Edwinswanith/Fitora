/**
 * Pure (no React / Expo imports) logic behind the coach plan builder:
 * draft shapes for the workout-template and meal-plan editors, client-side
 * validation that mirrors the server validators exactly, payload builders,
 * server-error translation, and bulk-assign result summaries.
 *
 * Server sources of truth (keep in sync):
 * - server/src/routes/workoutTemplates.ts `validateExercises` + models/WorkoutTemplate.ts
 * - server/src/routes/coachMealPlans.ts `validateDays`/`validateFoods` + models/MealPlan.ts, models/PlannedMeal.ts
 * - server/src/services/mealPlanAssignment.ts `validatePlanForAthlete` (422 block + warnings)
 */

// ---------- Workout templates ----------

export const EXERCISE_TYPES = ["sets_reps", "reps", "duration", "checklist"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  sets_reps: "Sets x reps",
  reps: "Reps",
  duration: "Timed",
  checklist: "Checklist",
};

export const TEMPLATE_LIMITS = {
  nameMax: 160,
  descriptionMax: 2000,
  exercisesMax: 60,
  titleMax: 160,
  setsMax: 50,
  repsMax: 40,
  durationMaxSec: 36000,
  restMaxSec: 3600,
  instructionsMax: 2000,
  notesMax: 500,
} as const;

/** Server shape returned by GET/POST/PATCH /api/workout-templates. */
export type ServerWorkoutExercise = {
  title: string;
  type: ExerciseType;
  sets: number | null;
  reps: string | null;
  durationSec: number | null;
  restSec: number | null;
  instructions: string | null;
  mediaId: string | null;
  notes: string | null;
  order?: number;
};

export type ServerWorkoutTemplate = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  isArchived: boolean;
  exercises: ServerWorkoutExercise[];
  updatedAt?: string;
};

/** Every field is the raw text the coach typed, so inputs stay controlled. */
export type ExerciseDraft = {
  key: string;
  title: string;
  type: ExerciseType;
  sets: string;
  reps: string;
  duration: string;
  rest: string;
  instructions: string;
  notes: string;
  mediaId: string | null;
};

export type TemplateDraft = {
  name: string;
  description: string;
  exercises: ExerciseDraft[];
};

export type ExercisePayload = {
  title: string;
  type: ExerciseType;
  sets?: number;
  reps?: string;
  durationSec?: number;
  restSec?: number;
  instructions?: string;
  notes?: string;
  mediaId: string | null;
};

export type TemplatePayload = {
  name: string;
  description: string;
  exercises: ExercisePayload[];
};

let keySeq = 0;
export function nextKey(prefix = "k"): string {
  keySeq += 1;
  return `${prefix}${Date.now().toString(36)}${keySeq}`;
}

export function emptyExercise(type: ExerciseType = "sets_reps"): ExerciseDraft {
  return {
    key: nextKey("ex"),
    title: "",
    type,
    sets: type === "sets_reps" ? "3" : "",
    reps: type === "sets_reps" || type === "reps" ? "10" : "",
    duration: type === "duration" ? "0:45" : "",
    rest: "",
    instructions: "",
    notes: "",
    mediaId: null,
  };
}

export function emptyTemplateDraft(kind: "workout" | "tasks" = "workout"): TemplateDraft {
  return { name: "", description: "", exercises: [emptyExercise(kind === "tasks" ? "checklist" : "sets_reps")] };
}

/** "90" -> "1:30"; null/0 -> "". */
export function formatSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "";
  const whole = Math.round(sec);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  if (m === 0) return String(s);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Accepts "45" (seconds), "1:30" (m:ss) or "1:02:00" (h:mm:ss). Returns
 * null for blank input and NaN for anything unparseable.
 */
export function parseSeconds(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return NaN;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return NaN;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function templateToDraft(template: ServerWorkoutTemplate): TemplateDraft {
  return {
    name: template.name,
    description: template.description ?? "",
    exercises: (template.exercises ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => ({
        key: nextKey("ex"),
        title: e.title,
        type: EXERCISE_TYPES.includes(e.type) ? e.type : "checklist",
        sets: e.sets != null ? String(e.sets) : "",
        reps: e.reps ?? "",
        duration: formatSeconds(e.durationSec),
        rest: formatSeconds(e.restSec),
        instructions: e.instructions ?? "",
        notes: e.notes ?? "",
        mediaId: e.mediaId ?? null,
      })),
  };
}

/** Which inputs the editor shows for a given exercise type. */
export function exerciseFields(type: ExerciseType): { sets: boolean; reps: boolean; duration: boolean; rest: boolean } {
  switch (type) {
    case "sets_reps":
      return { sets: true, reps: true, duration: false, rest: true };
    case "reps":
      return { sets: false, reps: true, duration: false, rest: true };
    case "duration":
      return { sets: true, reps: false, duration: true, rest: true };
    default:
      return { sets: false, reps: false, duration: false, rest: false };
  }
}

export type ValidationResult<T> = { ok: true; payload: T } | { ok: false; errors: string[] };

export function validateTemplateDraft(draft: TemplateDraft): ValidationResult<TemplatePayload> {
  const errors: string[] = [];
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!name) errors.push("Give the template a name.");
  else if (name.length > TEMPLATE_LIMITS.nameMax) errors.push(`Name must be ${TEMPLATE_LIMITS.nameMax} characters or fewer.`);
  if (description.length > TEMPLATE_LIMITS.descriptionMax) errors.push(`Description must be ${TEMPLATE_LIMITS.descriptionMax} characters or fewer.`);
  if (draft.exercises.length === 0) errors.push("Add at least one exercise.");
  if (draft.exercises.length > TEMPLATE_LIMITS.exercisesMax) errors.push(`A template can hold at most ${TEMPLATE_LIMITS.exercisesMax} exercises.`);

  const exercises: ExercisePayload[] = [];
  draft.exercises.forEach((ex, index) => {
    const label = `Exercise ${index + 1}${ex.title.trim() ? ` (${ex.title.trim()})` : ""}`;
    const fields = exerciseFields(ex.type);
    const title = ex.title.trim();
    const out: ExercisePayload = { title, type: ex.type, mediaId: ex.mediaId ?? null };
    if (!title) errors.push(`Exercise ${index + 1}: add a name.`);
    else if (title.length > TEMPLATE_LIMITS.titleMax) errors.push(`${label}: name must be ${TEMPLATE_LIMITS.titleMax} characters or fewer.`);

    if (fields.sets) {
      const raw = ex.sets.trim();
      if (raw) {
        const sets = Number(raw);
        if (!Number.isInteger(sets) || sets < 1 || sets > TEMPLATE_LIMITS.setsMax) {
          errors.push(`${label}: sets must be a whole number from 1 to ${TEMPLATE_LIMITS.setsMax}.`);
        } else out.sets = sets;
      } else if (ex.type === "sets_reps") {
        errors.push(`${label}: enter the number of sets.`);
      }
    }
    if (fields.reps) {
      const reps = ex.reps.trim();
      if (!reps) errors.push(`${label}: enter reps (e.g. 10 or 8-12).`);
      else if (reps.length > TEMPLATE_LIMITS.repsMax) errors.push(`${label}: reps must be ${TEMPLATE_LIMITS.repsMax} characters or fewer.`);
      else out.reps = reps;
    }
    if (fields.duration) {
      const sec = parseSeconds(ex.duration);
      if (sec === null) errors.push(`${label}: enter a duration (seconds or m:ss).`);
      else if (!Number.isFinite(sec) || sec <= 0 || sec > TEMPLATE_LIMITS.durationMaxSec) {
        errors.push(`${label}: duration must be between 1 second and 10 hours (seconds or m:ss).`);
      } else out.durationSec = sec;
    }
    if (fields.rest) {
      const rest = parseSeconds(ex.rest);
      if (rest !== null) {
        if (!Number.isFinite(rest) || rest < 0 || rest > TEMPLATE_LIMITS.restMaxSec) {
          errors.push(`${label}: rest must be 0 to 60 minutes (seconds or m:ss).`);
        } else if (rest > 0) out.restSec = rest;
      }
    }
    const instructions = ex.instructions.trim();
    if (instructions.length > TEMPLATE_LIMITS.instructionsMax) errors.push(`${label}: instructions must be ${TEMPLATE_LIMITS.instructionsMax} characters or fewer.`);
    else if (instructions) out.instructions = instructions;
    const notes = ex.notes.trim();
    if (notes.length > TEMPLATE_LIMITS.notesMax) errors.push(`${label}: notes must be ${TEMPLATE_LIMITS.notesMax} characters or fewer.`);
    else if (notes) out.notes = notes;
    exercises.push(out);
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: { name, description, exercises } };
}

export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function exerciseSummary(e: Pick<ServerWorkoutExercise, "type" | "sets" | "reps" | "durationSec">): string {
  switch (e.type) {
    case "sets_reps":
      return `${e.sets ?? "?"} x ${e.reps ?? "?"}`;
    case "reps":
      return `${e.reps ?? "?"} reps`;
    case "duration":
      return `${e.sets ? `${e.sets} x ` : ""}${formatSeconds(e.durationSec) || "?"}${e.durationSec && e.durationSec < 60 ? "s" : ""}`;
    default:
      return "Checklist";
  }
}

/** A template is a "task list" when every item is a checklist item. */
export function isChecklistTemplate(template: { exercises?: unknown[] }): boolean {
  const list = Array.isArray(template.exercises) ? (template.exercises as { type?: string }[]) : [];
  return list.length > 0 && list.every((e) => e?.type === "checklist");
}

// ---------- Meal plans ----------

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const MEAL_PLAN_DURATIONS = [1, 7, 14, 30] as const;
export type MealPlanDuration = (typeof MEAL_PLAN_DURATIONS)[number];

export const MEAL_LIMITS = {
  nameMax: 160,
  descriptionMax: 2000,
  mealsPerDayMax: 8,
  foodsPerMealMax: 30,
  mealNameMax: 160,
  foodNameMax: 160,
  unitMax: 40,
  caloriesMax: 5000,
  proteinMax: 500,
  carbsMax: 800,
  fatMax: 400,
  allergenTagMax: 40,
  allergenTagsMax: 20,
} as const;

export type ServerPlannedFood = {
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  allergenTags?: string[];
};
export type ServerMealPlan = {
  id: string;
  name: string;
  description: string | null;
  durationDays: number;
  version: number;
  isArchived: boolean;
  days: { dayIndex: number; meals: { mealType: MealType; name?: string | null; foods: ServerPlannedFood[] }[] }[];
  updatedAt?: string;
};

export type FoodDraft = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  allergenTags: string;
};
export type MealDraft = { key: string; mealType: MealType; name: string; foods: FoodDraft[] };
export type DayDraft = { key: string; dayIndex: number; meals: MealDraft[] };
export type MealPlanDraft = {
  name: string;
  description: string;
  durationDays: MealPlanDuration;
  days: DayDraft[];
};

export type FoodPayload = {
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  allergenTags: string[];
};
export type MealPlanPayload = {
  name: string;
  description: string;
  durationDays: MealPlanDuration;
  days: { dayIndex: number; meals: { mealType: MealType; name?: string; foods: FoodPayload[] }[] }[];
};

export function emptyFood(): FoodDraft {
  return { key: nextKey("fd"), name: "", quantity: "1", unit: "serving", calories: "", proteinG: "", carbsG: "", fatG: "", allergenTags: "" };
}
export function emptyMeal(mealType: MealType = "breakfast"): MealDraft {
  return { key: nextKey("ml"), mealType, name: "", foods: [emptyFood()] };
}
export function emptyDay(dayIndex: number): DayDraft {
  return { key: nextKey("dy"), dayIndex, meals: [emptyMeal("breakfast")] };
}
export function emptyMealPlanDraft(): MealPlanDraft {
  return { name: "", description: "", durationDays: 7, days: [emptyDay(0)] };
}

/** Lower-cased, trimmed, de-duplicated tags from "Peanuts, dairy". */
export function parseAllergenTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const tag = piece.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function numText(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "" : String(n);
}

export function mealPlanToDraft(plan: ServerMealPlan): MealPlanDraft {
  const duration = (MEAL_PLAN_DURATIONS as readonly number[]).includes(plan.durationDays) ? (plan.durationDays as MealPlanDuration) : 7;
  return {
    name: plan.name,
    description: plan.description ?? "",
    durationDays: duration,
    days: (plan.days ?? [])
      .slice()
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((day) => ({
        key: nextKey("dy"),
        dayIndex: day.dayIndex,
        meals: (day.meals ?? []).map((meal) => ({
          key: nextKey("ml"),
          mealType: (MEAL_TYPES as readonly string[]).includes(meal.mealType) ? meal.mealType : "snack",
          name: meal.name ?? "",
          foods: (meal.foods ?? []).map((food) => ({
            key: nextKey("fd"),
            name: food.name,
            quantity: numText(food.quantity),
            unit: food.unit,
            calories: numText(food.calories),
            proteinG: numText(food.proteinG),
            carbsG: numText(food.carbsG),
            fatG: numText(food.fatG),
            allergenTags: (food.allergenTags ?? []).join(", "),
          })),
        })),
      })),
  };
}

/** Lowest dayIndex in [0, durationDays) not used yet, or null when full. */
export function nextFreeDayIndex(days: Pick<DayDraft, "dayIndex">[], durationDays: number, after = -1): number | null {
  const used = new Set(days.map((d) => d.dayIndex));
  for (let i = after + 1; i < durationDays; i += 1) if (!used.has(i)) return i;
  for (let i = 0; i <= after && i < durationDays; i += 1) if (!used.has(i)) return i;
  return null;
}

/** Deep copy of a day (fresh keys) at a new dayIndex. */
export function copyDay(day: DayDraft, dayIndex: number): DayDraft {
  return {
    key: nextKey("dy"),
    dayIndex,
    meals: day.meals.map((meal) => ({
      ...meal,
      key: nextKey("ml"),
      foods: meal.foods.map((food) => ({ ...food, key: nextKey("fd") })),
    })),
  };
}

function parseNum(raw: string, blankAsZero: boolean): number {
  const text = raw.trim();
  if (!text) return blankAsZero ? 0 : NaN;
  return Number(text);
}

export function foodCalories(food: FoodDraft): number {
  const n = Number(food.calories.trim());
  return Number.isFinite(n) ? n : 0;
}
export function dayCalories(day: DayDraft): number {
  return day.meals.reduce((sum, meal) => sum + meal.foods.reduce((s, f) => s + foodCalories(f), 0), 0);
}

export function validateMealPlanDraft(draft: MealPlanDraft): ValidationResult<MealPlanPayload> {
  const errors: string[] = [];
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!name) errors.push("Give the meal plan a name.");
  else if (name.length > MEAL_LIMITS.nameMax) errors.push(`Name must be ${MEAL_LIMITS.nameMax} characters or fewer.`);
  if (description.length > MEAL_LIMITS.descriptionMax) errors.push(`Description must be ${MEAL_LIMITS.descriptionMax} characters or fewer.`);
  if (!(MEAL_PLAN_DURATIONS as readonly number[]).includes(draft.durationDays)) errors.push("Pick a plan length of 1, 7, 14 or 30 days.");
  if (draft.days.length === 0) errors.push("Add at least one day.");
  if (draft.days.length > draft.durationDays) errors.push(`A ${draft.durationDays}-day plan can have at most ${draft.durationDays} days.`);

  const seen = new Set<number>();
  const days: MealPlanPayload["days"] = [];
  for (const day of draft.days.slice().sort((a, b) => a.dayIndex - b.dayIndex)) {
    const dayLabel = `Day ${day.dayIndex + 1}`;
    if (!Number.isInteger(day.dayIndex) || day.dayIndex < 0 || day.dayIndex >= draft.durationDays) {
      errors.push(`${dayLabel} is outside a ${draft.durationDays}-day plan.`);
    }
    if (seen.has(day.dayIndex)) errors.push(`${dayLabel} appears more than once.`);
    seen.add(day.dayIndex);
    if (day.meals.length === 0) errors.push(`${dayLabel}: add at least one meal.`);
    if (day.meals.length > MEAL_LIMITS.mealsPerDayMax) errors.push(`${dayLabel}: at most ${MEAL_LIMITS.mealsPerDayMax} meals per day.`);

    const meals: MealPlanPayload["days"][number]["meals"] = [];
    day.meals.forEach((meal, mealIndex) => {
      const mealLabel = `${dayLabel}, meal ${mealIndex + 1}`;
      if (!(MEAL_TYPES as readonly string[]).includes(meal.mealType)) errors.push(`${mealLabel}: pick a meal type.`);
      const mealName = meal.name.trim();
      if (mealName.length > MEAL_LIMITS.mealNameMax) errors.push(`${mealLabel}: name must be ${MEAL_LIMITS.mealNameMax} characters or fewer.`);
      if (meal.foods.length === 0) errors.push(`${mealLabel}: add at least one food.`);
      if (meal.foods.length > MEAL_LIMITS.foodsPerMealMax) errors.push(`${mealLabel}: at most ${MEAL_LIMITS.foodsPerMealMax} foods per meal.`);

      const foods: FoodPayload[] = [];
      meal.foods.forEach((food, foodIndex) => {
        const foodName = food.name.trim();
        const foodLabel = `${mealLabel}, food ${foodIndex + 1}${foodName ? ` (${foodName})` : ""}`;
        const unit = food.unit.trim();
        const quantity = parseNum(food.quantity, false);
        const calories = parseNum(food.calories, false);
        const proteinG = parseNum(food.proteinG, true);
        const carbsG = parseNum(food.carbsG, true);
        const fatG = parseNum(food.fatG, true);
        const allergenTags = parseAllergenTags(food.allergenTags);
        if (!foodName) errors.push(`${mealLabel}, food ${foodIndex + 1}: add a name.`);
        else if (foodName.length > MEAL_LIMITS.foodNameMax) errors.push(`${foodLabel}: name must be ${MEAL_LIMITS.foodNameMax} characters or fewer.`);
        if (!unit) errors.push(`${foodLabel}: add a unit (e.g. g, cup, serving).`);
        else if (unit.length > MEAL_LIMITS.unitMax) errors.push(`${foodLabel}: unit must be ${MEAL_LIMITS.unitMax} characters or fewer.`);
        if (!Number.isFinite(quantity) || quantity < 0) errors.push(`${foodLabel}: enter a quantity (0 or more).`);
        if (!Number.isFinite(calories) || calories < 0 || calories > MEAL_LIMITS.caloriesMax) {
          errors.push(`${foodLabel}: calories must be 0 to ${MEAL_LIMITS.caloriesMax}.`);
        }
        if (!Number.isFinite(proteinG) || proteinG < 0 || proteinG > MEAL_LIMITS.proteinMax) errors.push(`${foodLabel}: protein must be 0 to ${MEAL_LIMITS.proteinMax} g.`);
        if (!Number.isFinite(carbsG) || carbsG < 0 || carbsG > MEAL_LIMITS.carbsMax) errors.push(`${foodLabel}: carbs must be 0 to ${MEAL_LIMITS.carbsMax} g.`);
        if (!Number.isFinite(fatG) || fatG < 0 || fatG > MEAL_LIMITS.fatMax) errors.push(`${foodLabel}: fat must be 0 to ${MEAL_LIMITS.fatMax} g.`);
        if (allergenTags.length > MEAL_LIMITS.allergenTagsMax) errors.push(`${foodLabel}: at most ${MEAL_LIMITS.allergenTagsMax} allergen tags.`);
        if (allergenTags.some((t) => t.length > MEAL_LIMITS.allergenTagMax)) errors.push(`${foodLabel}: each allergen tag must be ${MEAL_LIMITS.allergenTagMax} characters or fewer.`);
        foods.push({ name: foodName, quantity, unit, calories, proteinG, carbsG, fatG, allergenTags });
      });
      meals.push({ mealType: meal.mealType, ...(mealName ? { name: mealName } : {}), foods });
    });
    days.push({ dayIndex: day.dayIndex, meals });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: { name, description, durationDays: draft.durationDays, days } };
}

// ---------- Server errors -> plain language ----------

const ERROR_MESSAGES: Record<string, string> = {
  // workout templates
  invalid_name: "The name is missing or longer than 160 characters.",
  invalid_description: "The description is longer than 2000 characters.",
  exercises_required: "Add at least one exercise.",
  too_many_exercises: "A template can hold at most 60 exercises.",
  invalid_exercise_title: "Every exercise needs a name of 160 characters or fewer.",
  invalid_exercise_type: "One exercise has an unknown type.",
  invalid_sets: "Sets must be between 0 and 50.",
  invalid_reps: "Reps must be 40 characters or fewer.",
  invalid_durationSec: "Duration must be 10 hours or less.",
  invalid_restSec: "Rest must be 60 minutes or less.",
  invalid_instructions: "Instructions must be 2000 characters or fewer.",
  invalid_notes: "Notes must be 500 characters or fewer.",
  invalid_media_id: "One attached demo is invalid. Remove it and try again.",
  media_not_owned: "One attached demo is not in your exercise media library.",
  template_not_found: "That template no longer exists. Refresh and pick another.",
  not_template_owner: "You can only edit your own templates.",
  invalid_template_id: "That template link is invalid.",
  // meal plans
  invalid_durationDays: "Plan length must be 1, 7, 14 or 30 days.",
  days_required: "Add at least one day.",
  too_many_days: "There are more days than the plan length allows.",
  invalid_dayIndex: "A day is outside the plan length.",
  invalid_meals: "Every day needs between 1 and 8 meals.",
  invalid_mealType: "One meal has an unknown meal type.",
  foods_required: "Every meal needs at least one food.",
  too_many_foods: "A meal can hold at most 30 foods.",
  invalid_food_name: "Every food needs a name of 160 characters or fewer.",
  invalid_unit: "Every food needs a unit of 40 characters or fewer.",
  invalid_quantity: "Food quantities must be 0 or more.",
  invalid_calories: "Calories must be 0 to 5000 per food.",
  invalid_proteinG: "Protein must be 0 to 500 g per food.",
  invalid_carbsG: "Carbs must be 0 to 800 g per food.",
  invalid_fatG: "Fat must be 0 to 400 g per food.",
  meal_plan_not_found: "That meal plan no longer exists. Refresh and pick another.",
  not_meal_plan_owner: "You can only edit your own meal plans.",
  invalid_meal_plan_id: "That meal plan link is invalid.",
  // assignment
  not_in_assignments: "not on your client list",
  slot_already_assigned: "already has a workout in that slot on this date",
  subscription_not_active: "their membership is not active",
  feature_not_included_in_plan: "their membership does not include this",
  nutrition_not_included: "their membership does not include nutrition",
  invalid_scheduledDate: "the date is invalid",
  invalid_startDate: "the start date is invalid",
  athlete_profile_not_found: "their profile could not be found",
  plan_contains_tagged_allergen: "the plan contains a food tagged with their allergy",
  assignment_failed: "the server could not create the assignment",
  forbidden: "you do not have access to this client",
  rate_limited: "too many requests - wait a minute and retry",
  unauthenticated: "your session expired - sign in again",
};

export function describeServerError(code: string | null | undefined, status?: number): string {
  if (code && ERROR_MESSAGES[code]) {
    const msg = ERROR_MESSAGES[code];
    return msg.charAt(0).toUpperCase() + msg.slice(1) + (/[.!?]$/.test(msg) ? "" : ".");
  }
  if (status === 429) return "Too many changes in a short time. Wait a minute and try again.";
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 0 || status === undefined) return "Could not reach the server. Check your connection and try again.";
  return "Something went wrong saving this. Try again.";
}

/** Lower-case reason fragment for "Name: reason" lists. */
export function assignmentReason(code: string | null | undefined, status?: number): string {
  if (code && ERROR_MESSAGES[code]) {
    const msg = ERROR_MESSAGES[code].replace(/\.$/, "");
    return msg.charAt(0).toLowerCase() + msg.slice(1);
  }
  if (status === 429) return "too many requests - wait a minute and retry";
  if (status === 0 || status === undefined) return "could not reach the server";
  return code ? code.replace(/_/g, " ") : "unknown error";
}

// ---------- Assign results ----------

export type BulkWorkoutResult = { athleteId: string; ok: boolean; assignmentId?: string; error?: string };

export type MealAssignAttempt = {
  athleteId: string;
  status: number;
  body: {
    error?: string;
    violatingFoods?: string[];
    warnings?: MealAssignWarning[];
  } | null;
};

export type MealAssignWarning =
  | { type: "allergy_reminder"; allergies: string[] }
  | { type: "diet_preference_unverified"; dietaryPreferences: string[] }
  | { type: "day_calories_deviation"; dayIndex: number; planCalories: number; targetCalories: number; deviationPercent: number }
  | { type: string; [key: string]: unknown };

export type AssignSection = {
  label: string;
  attempted: number;
  succeeded: number;
  failures: string[];
  warnings: string[];
};

export function summarizeWorkoutBulk(
  label: string,
  athleteIds: string[],
  response: { status: number; body: { results?: BulkWorkoutResult[]; error?: string } | null },
  nameOf: (athleteId: string) => string
): AssignSection {
  const rawResults = response.body?.results;
  const results = Array.isArray(rawResults) ? rawResults : null;
  if (!results) {
    const reason = assignmentReason(response.body?.error, response.status);
    return { label, attempted: athleteIds.length, succeeded: 0, failures: [`All clients: ${reason}`], warnings: [] };
  }
  const failures = results.filter((r) => !r.ok).map((r) => `${nameOf(r.athleteId)}: ${assignmentReason(r.error, 200)}`);
  const succeeded = results.filter((r) => r.ok).length;
  // Defensive: any requested athlete missing from the results counts as failed.
  const returned = new Set(results.map((r) => r.athleteId));
  for (const id of athleteIds) if (!returned.has(id)) failures.push(`${nameOf(id)}: no result returned`);
  return { label, attempted: athleteIds.length, succeeded, failures, warnings: [] };
}

export function describeMealWarning(name: string, w: MealAssignWarning): string {
  if (w.type === "allergy_reminder" && Array.isArray((w as { allergies?: unknown }).allergies)) {
    const list = (w as { allergies: string[] }).allergies.join(", ");
    return `${name} has allergies (${list}). Only foods you tagged were checked - review untagged foods.`;
  }
  if (w.type === "diet_preference_unverified" && Array.isArray((w as { dietaryPreferences?: unknown }).dietaryPreferences)) {
    const list = (w as { dietaryPreferences: string[] }).dietaryPreferences.join(", ");
    return `${name} prefers ${list}. The plan was not checked against these preferences.`;
  }
  if (w.type === "day_calories_deviation") {
    const d = w as { dayIndex: number; planCalories: number; targetCalories: number; deviationPercent: number };
    return `${name}: Day ${d.dayIndex + 1} is ${Math.round(d.planCalories)} kcal vs a ${Math.round(d.targetCalories)} kcal target (${d.deviationPercent}% off).`;
  }
  return `${name}: ${String(w.type).replace(/_/g, " ")}.`;
}

export function summarizeMealAttempts(label: string, attempts: MealAssignAttempt[], nameOf: (athleteId: string) => string): AssignSection {
  const failures: string[] = [];
  const warnings: string[] = [];
  let succeeded = 0;
  for (const attempt of attempts) {
    const name = nameOf(attempt.athleteId);
    if (attempt.status >= 200 && attempt.status < 300) {
      succeeded += 1;
      for (const w of attempt.body?.warnings ?? []) warnings.push(describeMealWarning(name, w));
      continue;
    }
    if (attempt.status === 422 && attempt.body?.error === "plan_contains_tagged_allergen") {
      const foods = (attempt.body.violatingFoods ?? []).filter(Boolean);
      const unique = Array.from(new Set(foods));
      failures.push(`${name}: blocked - allergy conflict with ${unique.length ? unique.join(", ") : "a tagged food"}. Edit the plan or pick another.`);
      continue;
    }
    failures.push(`${name}: ${assignmentReason(attempt.body?.error, attempt.status)}`);
  }
  return { label, attempted: attempts.length, succeeded, failures, warnings };
}

export type AssignOutcome = { tone: "success" | "partial" | "error"; title: string; lines: string[]; warnings: string[] };

export function buildAssignOutcome(sections: AssignSection[]): AssignOutcome {
  const attempted = sections.reduce((s, x) => s + x.attempted, 0);
  const succeeded = sections.reduce((s, x) => s + x.succeeded, 0);
  const lines = sections.flatMap((section) => section.failures.map((f) => (sections.length > 1 ? `${section.label} - ${f}` : f)));
  const warnings = sections.flatMap((s) => s.warnings);
  const counts = sections.map((s) => `${s.succeeded} of ${s.attempted} ${s.label.toLowerCase()}${s.attempted === 1 ? "" : "s"}`).join(" and ");
  if (attempted > 0 && succeeded === attempted) return { tone: "success", title: `Assigned ${counts}.`, lines: [], warnings };
  if (succeeded === 0) return { tone: "error", title: `Nothing was assigned (${counts}).`, lines, warnings };
  return { tone: "partial", title: `Partly assigned: ${counts}.`, lines, warnings };
}

// ---------- Library refresh signal ----------

let libraryDirty = false;
/** Called by an editor after a successful save/archive so the Plan tab refetches on focus. */
export function markPlanLibraryDirty(): void {
  libraryDirty = true;
}
/** Returns true (once) if an editor changed the library since the last call. */
export function consumePlanLibraryDirty(): boolean {
  const was = libraryDirty;
  libraryDirty = false;
  return was;
}
