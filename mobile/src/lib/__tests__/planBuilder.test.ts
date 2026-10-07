import {
  buildAssignOutcome,
  copyDay,
  emptyDay,
  emptyExercise,
  emptyFood,
  emptyMealPlanDraft,
  isChecklistTemplate,
  mealPlanToDraft,
  moveItem,
  nextFreeDayIndex,
  parseAllergenTags,
  parseSeconds,
  formatSeconds,
  summarizeMealAttempts,
  summarizeWorkoutBulk,
  templateToDraft,
  validateMealPlanDraft,
  validateTemplateDraft,
  type ServerMealPlan,
  type ServerWorkoutTemplate,
  type TemplateDraft,
} from "../planBuilder";

describe("seconds parsing", () => {
  test("accepts plain seconds and m:ss", () => {
    expect(parseSeconds("45")).toBe(45);
    expect(parseSeconds("1:30")).toBe(90);
    expect(parseSeconds("1:02:00")).toBe(3720);
    expect(parseSeconds("")).toBeNull();
    expect(parseSeconds("1:75")).toBeNaN();
    expect(parseSeconds("abc")).toBeNaN();
  });
  test("formats round-trip", () => {
    expect(formatSeconds(90)).toBe("1:30");
    expect(formatSeconds(45)).toBe("45");
    expect(formatSeconds(null)).toBe("");
    expect(parseSeconds(formatSeconds(125))).toBe(125);
  });
});

describe("validateTemplateDraft", () => {
  function draft(exercises: TemplateDraft["exercises"]): TemplateDraft {
    return { name: " Leg day ", description: "", exercises };
  }

  test("builds a server payload with only the fields each type uses", () => {
    const squat = { ...emptyExercise("sets_reps"), title: "Squat", sets: "4", reps: "6-8", rest: "2:00", notes: "80 kg", duration: "0:30" };
    const plank = { ...emptyExercise("duration"), title: "Plank", duration: "1:00", reps: "10" };
    const task = { ...emptyExercise("checklist"), title: "Log water", sets: "3", rest: "30" };
    const result = validateTemplateDraft(draft([squat, plank, task]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.name).toBe("Leg day");
    expect(result.payload.exercises).toEqual([
      { title: "Squat", type: "sets_reps", sets: 4, reps: "6-8", restSec: 120, notes: "80 kg", mediaId: null },
      { title: "Plank", type: "duration", durationSec: 60, mediaId: null },
      { title: "Log water", type: "checklist", mediaId: null },
    ]);
  });

  test("reports missing name, exercises and per-exercise problems in plain language", () => {
    const empty = validateTemplateDraft({ name: "", description: "", exercises: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.errors).toContain("Give the template a name.");
      expect(empty.errors).toContain("Add at least one exercise.");
    }
    const bad = validateTemplateDraft(
      draft([{ ...emptyExercise("sets_reps"), title: "Row", sets: "0", reps: "" }, { ...emptyExercise("duration"), title: "", duration: "" }])
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes("Exercise 1 (Row): sets"))).toBe(true);
      expect(bad.errors.some((e) => e.includes("Exercise 1 (Row): enter reps"))).toBe(true);
      expect(bad.errors).toContain("Exercise 2: add a name.");
      expect(bad.errors.some((e) => e.startsWith("Exercise 2: enter a duration"))).toBe(true);
    }
  });

  test("enforces server length limits", () => {
    const long = validateTemplateDraft(draft([{ ...emptyExercise("reps"), title: "x".repeat(161), reps: "1".repeat(41) }]));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.length).toBe(2);
  });

  test("server template round-trips through the editor draft unchanged", () => {
    const server: ServerWorkoutTemplate = {
      id: "t1",
      name: "Push",
      description: null,
      version: 3,
      isArchived: false,
      exercises: [
        { title: "Bench", type: "sets_reps", sets: 5, reps: "5", durationSec: null, restSec: 180, instructions: "Arch", mediaId: "m1", notes: null, order: 0 },
        { title: "Hold", type: "duration", sets: 2, reps: null, durationSec: 40, restSec: null, instructions: null, mediaId: null, notes: null, order: 1 },
      ],
    };
    const result = validateTemplateDraft(templateToDraft(server));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.exercises).toEqual([
      { title: "Bench", type: "sets_reps", sets: 5, reps: "5", restSec: 180, instructions: "Arch", mediaId: "m1" },
      { title: "Hold", type: "duration", sets: 2, durationSec: 40, mediaId: null },
    ]);
  });

  test("moveItem and isChecklistTemplate", () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(isChecklistTemplate({ exercises: [{ type: "checklist" }] })).toBe(true);
    expect(isChecklistTemplate({ exercises: [{ type: "checklist" }, { type: "reps" }] })).toBe(false);
    expect(isChecklistTemplate({ exercises: [] })).toBe(false);
  });
});

describe("validateMealPlanDraft", () => {
  function filledDraft() {
    const d = emptyMealPlanDraft();
    d.name = "Cut";
    d.days[0].meals[0].foods[0] = { ...emptyFood(), name: "Oats", quantity: "80", unit: "g", calories: "300", proteinG: "10", carbsG: "", fatG: "5", allergenTags: "Gluten, gluten , oats" };
    return d;
  }

  test("builds the server payload; blank macros become 0 and tags are normalized", () => {
    const result = validateMealPlanDraft(filledDraft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      name: "Cut",
      description: "",
      durationDays: 7,
      days: [
        {
          dayIndex: 0,
          meals: [{ mealType: "breakfast", foods: [{ name: "Oats", quantity: 80, unit: "g", calories: 300, proteinG: 10, carbsG: 0, fatG: 5, allergenTags: ["gluten", "oats"] }] }],
        },
      ],
    });
  });

  test("allows partially-filled plans but rejects out-of-range and duplicate days", () => {
    const d = filledDraft();
    d.days.push(copyDay(d.days[0], 6));
    expect(validateMealPlanDraft(d).ok).toBe(true);
    d.days.push(copyDay(d.days[0], 6));
    const dup = validateMealPlanDraft(d);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors).toContain("Day 7 appears more than once.");
    const outOfRange = filledDraft();
    outOfRange.durationDays = 1;
    outOfRange.days.push(copyDay(outOfRange.days[0], 3));
    expect(validateMealPlanDraft(outOfRange).ok).toBe(false);
  });

  test("flags missing calories, unit and macro limits", () => {
    const d = filledDraft();
    d.days[0].meals[0].foods[0] = { ...d.days[0].meals[0].foods[0], calories: "", unit: "", proteinG: "501" };
    const result = validateMealPlanDraft(d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("calories must be 0 to 5000"))).toBe(true);
      expect(result.errors.some((e) => e.includes("add a unit"))).toBe(true);
      expect(result.errors.some((e) => e.includes("protein must be 0 to 500"))).toBe(true);
    }
  });

  test("nextFreeDayIndex and server round-trip", () => {
    expect(nextFreeDayIndex([emptyDay(0), emptyDay(1)], 7)).toBe(2);
    expect(nextFreeDayIndex([emptyDay(0)], 1)).toBeNull();
    expect(nextFreeDayIndex([emptyDay(0), emptyDay(6)], 7, 6)).toBe(1);
    const server: ServerMealPlan = {
      id: "p1",
      name: "Bulk",
      description: "More food",
      durationDays: 14,
      version: 2,
      isArchived: false,
      days: [{ dayIndex: 3, meals: [{ mealType: "lunch", name: "Bowl", foods: [{ name: "Rice", quantity: 1, unit: "cup", calories: 200, proteinG: 4, carbsG: 44, fatG: 0, allergenTags: [] }] }] }],
    };
    const result = validateMealPlanDraft(mealPlanToDraft(server));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.durationDays).toBe(14);
      expect(result.payload.days).toEqual([
        { dayIndex: 3, meals: [{ mealType: "lunch", name: "Bowl", foods: [{ name: "Rice", quantity: 1, unit: "cup", calories: 200, proteinG: 4, carbsG: 44, fatG: 0, allergenTags: [] }] }] },
      ]);
    }
  });

  test("parseAllergenTags", () => {
    expect(parseAllergenTags(" Peanuts,  ,DAIRY, peanuts")).toEqual(["peanuts", "dairy"]);
  });
});

describe("assignment summaries", () => {
  const names: Record<string, string> = { a: "Asha", b: "Ben" };
  const nameOf = (id: string) => names[id] ?? "Client";

  test("total workout failure is an error, never 'Assigned 0'", () => {
    const section = summarizeWorkoutBulk("Workout", ["a", "b"], {
      status: 207,
      body: { results: [{ athleteId: "a", ok: false, error: "slot_already_assigned" }, { athleteId: "b", ok: false, error: "subscription_not_active" }] },
    }, nameOf);
    const outcome = buildAssignOutcome([section]);
    expect(outcome.tone).toBe("error");
    expect(outcome.title).toBe("Nothing was assigned (0 of 2 workouts).");
    expect(outcome.lines).toEqual([
      "Asha: already has a workout in that slot on this date",
      "Ben: their membership is not active",
    ]);
  });

  test("whole-request failure (e.g. 404 template) covers all clients", () => {
    const section = summarizeWorkoutBulk("Workout", ["a"], { status: 404, body: { error: "template_not_found" } }, nameOf);
    expect(section.succeeded).toBe(0);
    expect(section.failures[0]).toMatch(/^All clients: that template no longer exists/);
    const offline = summarizeWorkoutBulk("Workout", ["a"], { status: 0, body: null }, nameOf);
    expect(offline.failures).toEqual(["All clients: could not reach the server"]);
  });

  test("meal 422 allergy block and warnings are readable; partial success is 'partial'", () => {
    const meal = summarizeMealAttempts(
      "Meal plan",
      [
        { athleteId: "a", status: 422, body: { error: "plan_contains_tagged_allergen", violatingFoods: ["Peanut bar", "Peanut bar"] } },
        {
          athleteId: "b",
          status: 201,
          body: {
            warnings: [
              { type: "allergy_reminder", allergies: ["shellfish"] },
              { type: "day_calories_deviation", dayIndex: 0, planCalories: 1500, targetCalories: 2500, deviationPercent: 40 },
            ],
          },
        },
      ],
      nameOf
    );
    expect(meal.failures).toEqual(["Asha: blocked - allergy conflict with Peanut bar. Edit the plan or pick another."]);
    expect(meal.warnings).toEqual([
      "Ben has allergies (shellfish). Only foods you tagged were checked - review untagged foods.",
      "Ben: Day 1 is 1500 kcal vs a 2500 kcal target (40% off).",
    ]);
    const workout = summarizeWorkoutBulk("Workout", ["a", "b"], { status: 207, body: { results: [{ athleteId: "a", ok: true }, { athleteId: "b", ok: true }] } }, nameOf);
    const outcome = buildAssignOutcome([workout, meal]);
    expect(outcome.tone).toBe("partial");
    expect(outcome.title).toBe("Partly assigned: 2 of 2 workouts and 1 of 2 meal plans.");
    expect(outcome.lines[0]).toMatch(/^Meal plan - Asha: blocked/);
  });

  test("full success", () => {
    const outcome = buildAssignOutcome([
      summarizeWorkoutBulk("Workout", ["a"], { status: 207, body: { results: [{ athleteId: "a", ok: true }] } }, nameOf),
    ]);
    expect(outcome).toEqual({ tone: "success", title: "Assigned 1 of 1 workout.", lines: [], warnings: [] });
  });
});
