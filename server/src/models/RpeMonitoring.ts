import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import {
  TRAINING_CATEGORIES,
  deriveLoadAndRisk,
  type RpeRiskFlag,
  type RpeReadinessBand,
} from "../lib/trainingCategories";

// Mirrors TrainingSession slots (AM → Afternoon → PM). Kept as its own constant
// so the RPE model stays self-contained, but the values must match SESSION_SLOTS.
export const RPE_SESSION_TYPES = ["AM", "AFT", "PM"] as const;
export type RpeSessionType = (typeof RPE_SESSION_TYPES)[number];

export const RPE_RISK_FLAGS: RpeRiskFlag[] = ["green", "amber", "red"];
export const RPE_READINESS_BANDS: RpeReadinessBand[] = ["green", "amber", "red"];

const rpeMonitoringSchema = new Schema(
  {
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", index: true },
    athleteId: {
      type: Schema.Types.ObjectId,
      ref: "AthleteProfile",
      required: true,
    },
    coachId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    date: { type: Date, required: true },
    day: { type: String, required: true, trim: true },
    sessionType: { type: String, enum: RPE_SESSION_TYPES, required: true },
    trainingCategory: {
      type: String,
      enum: TRAINING_CATEGORIES as readonly string[],
      required: true,
    },
    plannedIntensityPercent: { type: Number, min: 0, max: 100, required: true },
    rpe: { type: Number, min: 0, max: 10, required: true },
    bodyConditionFeedback: { type: String },
    restingHeartRate: { type: Number, min: 20, max: 220 },
    sleepQuality: { type: Number, min: 0, max: 5, required: true },
    muscleSoreness: { type: Number, min: 0, max: 5, required: true },
    fatigue: { type: Number, min: 0, max: 5, required: true },
    moodMotivation: { type: Number, min: 0, max: 5, required: true },
    calculatedTrainingLoad: { type: Number, required: true },
    riskFlag: { type: String, enum: RPE_RISK_FLAGS, required: true },
    riskReasons: { type: [String], default: [] },
    readinessScore: { type: Number, min: 0, max: 100, required: true },
    readinessBand: { type: String, enum: RPE_READINESS_BANDS, required: true },
  },
  { timestamps: true }
);

// Unique: prevents duplicate AM/PM per athlete per day
rpeMonitoringSchema.index(
  { athleteId: 1, date: -1, sessionType: 1 },
  { unique: true }
);
// Supplementary indexes for academy/coach/date lookups
rpeMonitoringSchema.index({ academyId: 1, date: -1 });
rpeMonitoringSchema.index({ coachId: 1, date: -1 });
rpeMonitoringSchema.index({ athleteId: 1, date: -1 });

// Safety net for any direct .save() — handler also computes for upsert path.
rpeMonitoringSchema.pre("validate", function (next) {
  const doc = this as unknown as RpeMonitoringDoc;
  if (
    typeof doc.plannedIntensityPercent === "number" &&
    typeof doc.rpe === "number" &&
    typeof doc.fatigue === "number" &&
    typeof doc.muscleSoreness === "number" &&
    typeof doc.sleepQuality === "number" &&
    typeof doc.moodMotivation === "number"
  ) {
    const derived = deriveLoadAndRisk(doc);
    doc.calculatedTrainingLoad = derived.calculatedTrainingLoad;
    doc.riskFlag = derived.riskFlag;
    doc.riskReasons = derived.riskReasons;
    doc.readinessScore = derived.readinessScore;
    doc.readinessBand = derived.readinessBand;
  }
  next();
});

export type RpeMonitoringDoc = InferSchemaType<typeof rpeMonitoringSchema> & {
  _id: Types.ObjectId;
};

export const RpeMonitoring: Model<RpeMonitoringDoc> = model<RpeMonitoringDoc>(
  "RpeMonitoring",
  rpeMonitoringSchema
);
