import { calculateNutritionTarget, explainNutritionTarget, type NutritionEngineInput } from "../src/services/nutritionEngine";

// Pure (no database): the "How is this calculated?" numbers must always
// describe the real calculation, never a second formula that could drift.
const base: NutritionEngineInput = {
  weightKg: 75,
  heightCm: 178,
  age: 30,
  biologicalSex: "male",
  activityLevel: "moderate",
  goal: "lose_weight",
  goalIntensity: "moderate",
};

describe("explainNutritionTarget", () => {
  test("walks through BMR, activity, goal adjustment to the same calories as the engine", () => {
    const explained = explainNutritionTarget(base);
    expect(explained).toEqual({ bmr: 1718, activityFactor: 1.55, tdee: 2662, goalDelta: -500, floorApplied: null, calories: 2162 });
    expect(explained.calories).toBe(calculateNutritionTarget(base).calories);
  });

  test("matches the engine for every activity level, goal and intensity", () => {
    for (const activityLevel of ["sedentary", "light", "moderate", "active", "very_active"] as const) {
      for (const goal of ["lose_weight", "maintain_weight", "gain_weight"] as const) {
        for (const goalIntensity of ["mild", "moderate", "aggressive"] as const) {
          for (const biologicalSex of ["male", "female"] as const) {
            const input = { ...base, activityLevel, goal, goalIntensity, biologicalSex };
            expect(explainNutritionTarget(input).calories).toBe(calculateNutritionTarget(input).calories);
          }
        }
      }
    }
  });

  test("names the safety floor when it raises the target", () => {
    const small = { ...base, weightKg: 45, heightCm: 150, age: 60, biologicalSex: "female" as const, activityLevel: "sedentary" as const, goalIntensity: "aggressive" as const };
    const explained = explainNutritionTarget(small);
    expect(explained.floorApplied).toBe("minimum");
    expect(explained.calories).toBe(1200);
    expect(explained.calories).toBe(calculateNutritionTarget(small).calories);
  });
});
