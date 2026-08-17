import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongoose";

// Import every model so its schema (and index() calls) registers with Mongoose.
import "../models/Academy";
import "../models/User";
import "../models/AthleteProfile";
import "../models/CoachAthleteAssignment";
import "../models/Attendance";
import "../models/TrainingSession";
import "../models/Wellness";
import "../models/Recovery";
import "../models/RpeMonitoring";
import "../models/Performance";
import "../models/Injury";
import "../models/AthleteNote";
import "../models/CoachComment";
import "../models/WaterIntake";
import "../models/Message";
import "../models/Announcement";
import "../models/Notification";
import "../models/NotificationPreference";
import "../models/NotificationDecision";
import "../models/DeviceToken";
import "../models/WorkoutMedia";
import "../models/VoicePendingState";
import "../models/VoiceActionReceipt";
import "../models/AuditLog";
import "../models/WorkoutTemplate";
import "../models/WorkoutAssignment";
import "../models/ExerciseProgress";
import "../models/ExerciseMedia";
import "../models/NutritionTarget";
import "../models/PlannedMeal";
import "../models/Meal";
import "../models/MealFood";
import "../models/MealScan";
import "../models/MealScanItem";
import "../models/Routine";
import "../models/MealPlan";
import "../models/MealPlanAssignment";

async function run() {
  await connectMongo();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no db");
  console.log("[verify-indexes] connected to", db.databaseName);

  // Force index builds for every registered model (mirrors what happens on
  // real app startup, just made explicit + awaited here for verification).
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  const collections = await db.listCollections().toArray();
  console.log("\n[verify-indexes] collections after model init:", collections.map((c) => c.name).sort());

  for (const modelName of Object.keys(mongoose.models)) {
    const model = mongoose.models[modelName];
    const collName = model.collection.collectionName;
    const indexes = await model.collection.indexes();
    console.log(`\n--- ${modelName} (collection: ${collName}) ---`);
    for (const idx of indexes) {
      console.log(
        JSON.stringify({
          name: idx.name,
          key: idx.key,
          unique: idx.unique ?? false,
          partialFilterExpression: idx.partialFilterExpression ?? null,
          sparse: idx.sparse ?? false,
        })
      );
    }
  }

  await disconnectMongo();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("[verify-indexes] failed:", err);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
