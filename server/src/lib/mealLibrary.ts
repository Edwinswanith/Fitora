import type { MealType } from "../models/PlannedMeal";

export type LibraryFood = {
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
};

export type MealLibraryEntry = {
  id: string;
  name: string;
  mealType: MealType;
  dietTags: string[]; // e.g. "vegetarian", "vegan", "non_veg"
  cuisineTags: string[]; // e.g. "indian", "continental", "mexican"
  allergens: string[]; // e.g. "nuts", "dairy", "gluten", "egg", "soy", "shellfish"
  baseFoods: LibraryFood[];
};

function baseCalories(entry: Pick<MealLibraryEntry, "baseFoods">): number {
  return entry.baseFoods.reduce((sum, f) => sum + f.calories, 0);
}

/**
 * A small but real deterministic meal library — the engine that makes 7-day
 * routine generation NOT require an AI call per plan (services/
 * routineGenerator.ts). Deliberately data, not code: adding cuisines/diets is
 * adding entries here, not touching the selection algorithm.
 */
export const MEAL_LIBRARY: MealLibraryEntry[] = [
  // Breakfast
  { id: "b-oats-berries", name: "Oats with Berries", mealType: "breakfast", dietTags: ["vegetarian", "vegan"], cuisineTags: ["continental"], allergens: ["gluten"], baseFoods: [{ name: "Rolled oats", quantity: 60, unit: "g", calories: 230, proteinG: 8, carbsG: 40, fatG: 4, fiberG: 6 }, { name: "Mixed berries", quantity: 80, unit: "g", calories: 45, proteinG: 1, carbsG: 11, fatG: 0, fiberG: 3 }] },
  { id: "b-eggs-toast", name: "Eggs & Wholegrain Toast", mealType: "breakfast", dietTags: ["non_veg"], cuisineTags: ["continental"], allergens: ["egg", "gluten"], baseFoods: [{ name: "Eggs", quantity: 2, unit: "piece", calories: 156, proteinG: 13, carbsG: 1, fatG: 11 }, { name: "Wholegrain toast", quantity: 2, unit: "slice", calories: 140, proteinG: 6, carbsG: 24, fatG: 2, fiberG: 4 }] },
  { id: "b-idli-sambar", name: "Idli with Sambar", mealType: "breakfast", dietTags: ["vegetarian", "vegan"], cuisineTags: ["indian"], allergens: [], baseFoods: [{ name: "Idli", quantity: 4, unit: "piece", calories: 200, proteinG: 8, carbsG: 40, fatG: 1, fiberG: 2 }, { name: "Sambar", quantity: 150, unit: "ml", calories: 90, proteinG: 5, carbsG: 12, fatG: 2, fiberG: 3 }] },
  { id: "b-greek-yogurt", name: "Greek Yogurt Bowl", mealType: "breakfast", dietTags: ["vegetarian"], cuisineTags: ["continental"], allergens: ["dairy"], baseFoods: [{ name: "Greek yogurt", quantity: 200, unit: "g", calories: 130, proteinG: 20, carbsG: 8, fatG: 2 }, { name: "Granola", quantity: 30, unit: "g", calories: 120, proteinG: 3, carbsG: 18, fatG: 4, fiberG: 2 }] },
  { id: "b-paratha", name: "Vegetable Paratha", mealType: "breakfast", dietTags: ["vegetarian"], cuisineTags: ["indian"], allergens: ["gluten", "dairy"], baseFoods: [{ name: "Vegetable paratha", quantity: 2, unit: "piece", calories: 320, proteinG: 8, carbsG: 44, fatG: 12, fiberG: 4 }, { name: "Curd", quantity: 100, unit: "g", calories: 60, proteinG: 4, carbsG: 5, fatG: 3 }] },
  { id: "b-smoothie", name: "Protein Smoothie", mealType: "breakfast", dietTags: ["vegetarian"], cuisineTags: ["continental"], allergens: ["dairy"], baseFoods: [{ name: "Whey protein", quantity: 30, unit: "g", calories: 120, proteinG: 24, carbsG: 3, fatG: 2 }, { name: "Banana", quantity: 1, unit: "piece", calories: 105, proteinG: 1, carbsG: 27, fatG: 0, fiberG: 3 }, { name: "Milk", quantity: 200, unit: "ml", calories: 100, proteinG: 7, carbsG: 10, fatG: 3 }] },
  { id: "b-tofu-scramble", name: "Tofu Scramble", mealType: "breakfast", dietTags: ["vegetarian", "vegan"], cuisineTags: ["continental"], allergens: ["soy"], baseFoods: [{ name: "Tofu scramble", quantity: 200, unit: "g", calories: 220, proteinG: 18, carbsG: 8, fatG: 14, fiberG: 3 }, { name: "Wholegrain toast", quantity: 1, unit: "slice", calories: 70, proteinG: 3, carbsG: 12, fatG: 1, fiberG: 2 }] },
  { id: "b-poha", name: "Vegetable Poha", mealType: "breakfast", dietTags: ["vegetarian", "vegan"], cuisineTags: ["indian"], allergens: [], baseFoods: [{ name: "Poha", quantity: 250, unit: "g", calories: 270, proteinG: 6, carbsG: 52, fatG: 5, fiberG: 3 }] },

  // Lunch/Dinner (shared pool)
  { id: "ld-chicken-rice", name: "Grilled Chicken & Rice", mealType: "lunch", dietTags: ["non_veg"], cuisineTags: ["continental", "indian"], allergens: [], baseFoods: [{ name: "Grilled chicken breast", quantity: 150, unit: "g", calories: 250, proteinG: 46, carbsG: 0, fatG: 6 }, { name: "Steamed rice", quantity: 150, unit: "g", calories: 195, proteinG: 4, carbsG: 43, fatG: 0 }, { name: "Steamed vegetables", quantity: 100, unit: "g", calories: 40, proteinG: 2, carbsG: 8, fatG: 0, fiberG: 3 }] },
  { id: "ld-dal-rice", name: "Dal Tadka with Rice", mealType: "lunch", dietTags: ["vegetarian", "vegan"], cuisineTags: ["indian"], allergens: [], baseFoods: [{ name: "Dal tadka", quantity: 200, unit: "g", calories: 220, proteinG: 12, carbsG: 30, fatG: 6, fiberG: 6 }, { name: "Steamed rice", quantity: 150, unit: "g", calories: 195, proteinG: 4, carbsG: 43, fatG: 0 }] },
  { id: "ld-paneer-roti", name: "Paneer Curry with Roti", mealType: "dinner", dietTags: ["vegetarian"], cuisineTags: ["indian"], allergens: ["dairy", "gluten"], baseFoods: [{ name: "Paneer curry", quantity: 200, unit: "g", calories: 340, proteinG: 18, carbsG: 12, fatG: 24 }, { name: "Roti", quantity: 2, unit: "piece", calories: 160, proteinG: 5, carbsG: 30, fatG: 3, fiberG: 3 }] },
  { id: "ld-salmon-quinoa", name: "Salmon with Quinoa", mealType: "dinner", dietTags: ["non_veg"], cuisineTags: ["continental"], allergens: ["shellfish"], baseFoods: [{ name: "Grilled salmon", quantity: 150, unit: "g", calories: 280, proteinG: 34, carbsG: 0, fatG: 15 }, { name: "Quinoa", quantity: 100, unit: "g", calories: 120, proteinG: 4, carbsG: 21, fatG: 2, fiberG: 3 }] },
  { id: "ld-chickpea-salad", name: "Chickpea Salad Bowl", mealType: "lunch", dietTags: ["vegetarian", "vegan"], cuisineTags: ["continental", "mexican"], allergens: [], baseFoods: [{ name: "Chickpeas", quantity: 150, unit: "g", calories: 200, proteinG: 12, carbsG: 34, fatG: 3, fiberG: 9 }, { name: "Mixed greens & veg", quantity: 150, unit: "g", calories: 60, proteinG: 3, carbsG: 10, fatG: 1, fiberG: 4 }, { name: "Olive oil dressing", quantity: 15, unit: "ml", calories: 120, proteinG: 0, carbsG: 0, fatG: 14 }] },
  { id: "ld-beef-tacos", name: "Beef Tacos", mealType: "dinner", dietTags: ["non_veg"], cuisineTags: ["mexican"], allergens: ["gluten", "dairy"], baseFoods: [{ name: "Ground beef", quantity: 150, unit: "g", calories: 280, proteinG: 26, carbsG: 0, fatG: 19 }, { name: "Corn tortillas", quantity: 3, unit: "piece", calories: 180, proteinG: 4, carbsG: 36, fatG: 2, fiberG: 3 }, { name: "Cheese & salsa", quantity: 50, unit: "g", calories: 130, proteinG: 6, carbsG: 5, fatG: 10 }] },
  { id: "ld-veg-biryani", name: "Vegetable Biryani", mealType: "lunch", dietTags: ["vegetarian"], cuisineTags: ["indian"], allergens: ["dairy"], baseFoods: [{ name: "Vegetable biryani", quantity: 350, unit: "g", calories: 480, proteinG: 10, carbsG: 78, fatG: 14, fiberG: 6 }, { name: "Raita", quantity: 100, unit: "g", calories: 60, proteinG: 3, carbsG: 5, fatG: 3 }] },
  { id: "ld-tofu-stirfry", name: "Tofu Vegetable Stir-fry", mealType: "dinner", dietTags: ["vegetarian", "vegan"], cuisineTags: ["continental"], allergens: ["soy"], baseFoods: [{ name: "Tofu", quantity: 150, unit: "g", calories: 180, proteinG: 16, carbsG: 4, fatG: 11 }, { name: "Stir-fry vegetables", quantity: 200, unit: "g", calories: 90, proteinG: 4, carbsG: 16, fatG: 1, fiberG: 5 }, { name: "Brown rice", quantity: 150, unit: "g", calories: 165, proteinG: 4, carbsG: 34, fatG: 1, fiberG: 2 }] },
  { id: "ld-turkey-wrap", name: "Turkey Wrap", mealType: "lunch", dietTags: ["non_veg"], cuisineTags: ["continental"], allergens: ["gluten"], baseFoods: [{ name: "Turkey breast", quantity: 120, unit: "g", calories: 150, proteinG: 30, carbsG: 0, fatG: 3 }, { name: "Wholewheat wrap", quantity: 1, unit: "piece", calories: 170, proteinG: 6, carbsG: 30, fatG: 3, fiberG: 3 }, { name: "Vegetables & hummus", quantity: 80, unit: "g", calories: 100, proteinG: 3, carbsG: 10, fatG: 5, fiberG: 3 }] },
  { id: "ld-rajma-rice", name: "Rajma with Rice", mealType: "dinner", dietTags: ["vegetarian", "vegan"], cuisineTags: ["indian"], allergens: [], baseFoods: [{ name: "Rajma (kidney bean curry)", quantity: 200, unit: "g", calories: 230, proteinG: 13, carbsG: 36, fatG: 4, fiberG: 10 }, { name: "Steamed rice", quantity: 150, unit: "g", calories: 195, proteinG: 4, carbsG: 43, fatG: 0 }] },

  // Snacks
  { id: "s-protein-bar", name: "Protein Bar", mealType: "snack", dietTags: ["vegetarian"], cuisineTags: ["continental"], allergens: ["nuts", "dairy"], baseFoods: [{ name: "Protein bar", quantity: 1, unit: "piece", calories: 200, proteinG: 20, carbsG: 20, fatG: 7, fiberG: 3 }] },
  { id: "s-fruit-nuts", name: "Fruit & Nuts", mealType: "snack", dietTags: ["vegetarian", "vegan"], cuisineTags: ["continental"], allergens: ["nuts"], baseFoods: [{ name: "Apple", quantity: 1, unit: "piece", calories: 95, proteinG: 0, carbsG: 25, fatG: 0, fiberG: 4 }, { name: "Almonds", quantity: 20, unit: "g", calories: 115, proteinG: 4, carbsG: 4, fatG: 10, fiberG: 2 }] },
  { id: "s-greek-yogurt-snack", name: "Greek Yogurt", mealType: "snack", dietTags: ["vegetarian"], cuisineTags: ["continental"], allergens: ["dairy"], baseFoods: [{ name: "Greek yogurt", quantity: 150, unit: "g", calories: 100, proteinG: 15, carbsG: 6, fatG: 1 }] },
  { id: "s-hummus-veg", name: "Hummus with Veggies", mealType: "snack", dietTags: ["vegetarian", "vegan"], cuisineTags: ["continental", "mexican"], allergens: [], baseFoods: [{ name: "Hummus", quantity: 60, unit: "g", calories: 120, proteinG: 4, carbsG: 10, fatG: 8, fiberG: 3 }, { name: "Carrot & cucumber sticks", quantity: 100, unit: "g", calories: 30, proteinG: 1, carbsG: 6, fatG: 0, fiberG: 2 }] },
  { id: "s-boiled-eggs", name: "Boiled Eggs", mealType: "snack", dietTags: ["non_veg"], cuisineTags: ["continental"], allergens: ["egg"], baseFoods: [{ name: "Boiled eggs", quantity: 2, unit: "piece", calories: 140, proteinG: 12, carbsG: 1, fatG: 10 }] },
  { id: "s-roasted-chana", name: "Roasted Chana", mealType: "snack", dietTags: ["vegetarian", "vegan"], cuisineTags: ["indian"], allergens: [], baseFoods: [{ name: "Roasted chickpeas", quantity: 40, unit: "g", calories: 150, proteinG: 8, carbsG: 20, fatG: 3, fiberG: 5 }] },
];

export function libraryBaseCalories(entry: MealLibraryEntry): number {
  return baseCalories(entry);
}
