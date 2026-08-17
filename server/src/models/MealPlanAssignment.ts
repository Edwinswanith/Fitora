import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { plannedFoodSchema, MEAL_TYPES } from "./PlannedMeal";

export const MEAL_PLAN_ASSIGNMENT_STATUS = ["active", "cancelled"] as const;
export type MealPlanAssignmentStatus = (typeof MEAL_PLAN_ASSIGNMENT_STATUS)[number];

const assignmentMealSchema = new Schema(
  {
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    name: { type: String, trim: true, maxlength: 160 },
    foods: { type: [plannedFoodSchema], default: [] },
  },
  { _id: false }
);
const assignmentDaySchema = new Schema(
  {
    dayIndex: { type: Number, required: true, min: 0 },
    meals: { type: [assignmentMealSchema], default: [] },
  },
  { _id: false }
);

/**
 * One coach's assignment of a MealPlan to one Client starting on a date —
 * snapshots `days` + the plan's version at assign-time (see MealPlan.ts doc
 * comment). `plannedMealIds` links to the actual PlannedMeal rows this
 * assignment created, so cancelling can be traced/audited even though it
 * deliberately does NOT delete those rows (historical planning data is never
 * destroyed — see services/mealPlanAssignment.ts).
 *
 * "completed" is deliberately NOT a stored status — whether an assignment's
 * date range has passed is derived at read time from startDate+durationDays,
 * the same "derive, don't persist" approach used for subscription
 * expiring-soon elsewhere in this plan. Only "active"/"cancelled" are real,
 * persisted states.
 */
const mealPlanAssignmentSchema = new Schema(
  {
    mealPlanId: { type: Schema.Types.ObjectId, ref: "MealPlan", required: true },
    mealPlanVersionSnapshot: { type: Number, required: true },
    nameSnapshot: { type: String, required: true, trim: true, maxlength: 160 },
    daysSnapshot: { type: [assignmentDaySchema], default: [] },
    durationDays: { type: Number, required: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startDate: { type: Date, required: true },
    status: { type: String, enum: MEAL_PLAN_ASSIGNMENT_STATUS, default: "active" },
    plannedMealIds: { type: [Schema.Types.ObjectId], ref: "PlannedMeal", default: [] },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

mealPlanAssignmentSchema.index({ assignedTo: 1, createdAt: -1 });
mealPlanAssignmentSchema.index({ assignedBy: 1, createdAt: -1 });

export type MealPlanAssignmentDoc = InferSchemaType<typeof mealPlanAssignmentSchema> & {
  _id: Types.ObjectId;
};
export const MealPlanAssignment: Model<MealPlanAssignmentDoc> = model<MealPlanAssignmentDoc>(
  "MealPlanAssignment",
  mealPlanAssignmentSchema
);
