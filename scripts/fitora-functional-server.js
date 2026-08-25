const path = require("path");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.PORT = process.env.FITORA_FUNCTIONAL_PORT || "4102";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "fitora_functional_access_secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fitora_functional_refresh_secret";
process.env.INTERNAL_SWEEP_SECRET = process.env.INTERNAL_SWEEP_SECRET || "fitora_functional_sweep_secret";
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, "..", "qa-artifacts", "fitora-functional", "uploads");
process.env.TS_NODE_PROJECT = path.resolve(__dirname, "..", "server", "tsconfig.json");
process.env.TS_NODE_TRANSPILE_ONLY = "1";

require("../server/node_modules/ts-node/register/transpile-only");

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

function day(offset = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function at(offset, hour, minute = 0) {
  const d = day(offset);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "fitora_functional";

  const { createServer } = require("http");
  const { createApp } = require("../server/src/app");
  const { Academy } = require("../server/src/models/Academy");
  const { User } = require("../server/src/models/User");
  const { AthleteProfile } = require("../server/src/models/AthleteProfile");
  const { CoachAthleteAssignment } = require("../server/src/models/CoachAthleteAssignment");
  const { CoachProfile } = require("../server/src/models/CoachProfile");
  const { CoachPricingPlan } = require("../server/src/models/CoachPricingPlan");
  const { AthleteCoachSubscription } = require("../server/src/models/AthleteCoachSubscription");
  const { CoachAvailability } = require("../server/src/models/CoachAvailability");
  const { CoachSession } = require("../server/src/models/CoachSession");
  const { WorkoutTemplate } = require("../server/src/models/WorkoutTemplate");
  const { WorkoutAssignment } = require("../server/src/models/WorkoutAssignment");
  const { ExerciseProgress } = require("../server/src/models/ExerciseProgress");
  const { NutritionTarget } = require("../server/src/models/NutritionTarget");
  const { PlannedMeal } = require("../server/src/models/PlannedMeal");
  const { Meal } = require("../server/src/models/Meal");
  const { MealFood } = require("../server/src/models/MealFood");
  const { MealPlan } = require("../server/src/models/MealPlan");
  const { MealPlanAssignment } = require("../server/src/models/MealPlanAssignment");
  const { WaterIntake } = require("../server/src/models/WaterIntake");
  const { Wellness } = require("../server/src/models/Wellness");
  const { Recovery } = require("../server/src/models/Recovery");
  const { Attendance } = require("../server/src/models/Attendance");
  const { TrainingSession } = require("../server/src/models/TrainingSession");
  const { RpeMonitoring } = require("../server/src/models/RpeMonitoring");
  const { Notification } = require("../server/src/models/Notification");
  const { CoachComment } = require("../server/src/models/CoachComment");
  const { CoachVideo } = require("../server/src/models/CoachVideo");
  const { CoachReview } = require("../server/src/models/CoachReview");
  const { deriveLoadAndRisk, dayOfWeek } = require("../server/src/lib/trainingCategories");

  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB });

  const passwordHash = await bcrypt.hash("Athlete@123", 10);
  const coachPasswordHash = await bcrypt.hash("Coach@123", 10);
  const academy = await Academy.create({
    name: "Fitora QA Academy",
    slug: "fitora-qa",
    timezone: "Asia/Kolkata",
    isActive: true,
  });
  const coach = await User.create({
    email: "coach.kumar@acme.test",
    passwordHash: coachPasswordHash,
    role: "coach",
    name: "Arjun Kumar",
    academyId: academy._id,
    isActive: true,
    isAcademyOwner: true,
    avatarKind: "default",
    avatarDefaultId: "coach-1",
  });
  const athletes = [];
  const athleteSpecs = [
    ["athlete.arjun@acme.test", "Edwin Swanith", "Weight Loss", "general", "male-1"],
    ["meera@acme.test", "Meera", "Build Muscle", "general", "female-1"],
    ["rahul@acme.test", "Rahul", "General Fitness", "general", "male-2"],
    ["kiran@acme.test", "Kiran", "Maintain Fitness", "general", "male-1"],
  ];
  for (const [email, name, position, sport, avatarDefaultId] of athleteSpecs) {
    const user = await User.create({
      email,
      passwordHash,
      role: "athlete",
      name,
      academyId: academy._id,
      isActive: true,
      avatarKind: "default",
      avatarDefaultId,
    });
    const profile = await AthleteProfile.create({
      userId: user._id,
      academyId: academy._id,
      sport,
      position,
      timezone: "Asia/Kolkata",
      heightCm: 178,
      weightKg: name === "Edwin Swanith" ? 78.4 : 72,
      dob: "1997-08-14",
      hydrationGoalMl: 2500,
      fitnessGoal: name === "Meera" ? "gain_weight" : "lose_weight",
      goalIntensity: "moderate",
      activityLevel: "moderate",
      biologicalSex: "male",
      cuisinePreferences: ["South Indian"],
      dietaryPreferences: ["Non-Vegetarian"],
    });
    const relationship = await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: coach._id,
      status: "active",
      endedAt: null,
    });
    athletes.push({ user, profile, relationship });
  }

  const [edwin, meera, rahul, kiran] = athletes;
  await CoachProfile.create({
    userId: coach._id,
    bio: "Strength and conditioning coach for busy athletes.",
    philosophy: "Clear plans, quick feedback, and steady progression.",
    yearsExperience: 8,
    certifications: ["CSCS", "Precision Nutrition", "Mobility Specialist"],
    specializations: ["Strength", "Weight Loss", "Sports Performance"],
    languages: ["English", "Hindi"],
    coachingTypes: ["strength", "nutrition"],
    nutritionSupport: true,
    verifiedStatus: "verified",
    avgRating: 4.8,
    reviewCount: 126,
    active: true,
  });
  const premiumPlan = await CoachPricingPlan.create({
    coachId: coach._id,
    name: "Premium",
    monthlyPrice: 3999,
    currency: "INR",
    includedServices: ["2 live sessions", "Workout planning", "Nutrition support"],
    liveSessionsPerCycle: 2,
    nutritionIncluded: true,
    workoutPlanningIncluded: true,
    priority: 2,
  });
  await CoachPricingPlan.insertMany([
    { coachId: coach._id, name: "Basic", monthlyPrice: 2499, currency: "INR", includedServices: ["Workout planning", "Messaging"], workoutPlanningIncluded: true, priority: 0 },
    { coachId: coach._id, name: "Pro", monthlyPrice: 3999, currency: "INR", includedServices: ["Workout", "Nutrition", "2 calls"], workoutPlanningIncluded: true, nutritionIncluded: true, liveSessionsPerCycle: 2, priority: 1 },
  ]);
  await AthleteCoachSubscription.create({
    relationshipId: edwin.relationship._id,
    coachId: coach._id,
    athleteId: edwin.profile._id,
    pricingPlanId: premiumPlan._id,
    pricingPlanSnapshot: {
      name: "Premium Coaching",
      monthlyPrice: 3999,
      currency: "INR",
      includedServices: ["2 live sessions", "Workout planning", "Nutrition support"],
      liveSessionsPerCycle: 2,
      nutritionIncluded: true,
      workoutPlanningIncluded: true,
      messagingIncluded: true,
      version: 1,
    },
    provider: "razorpay",
    status: "active",
    currentPeriodStart: day(-12),
    currentPeriodEnd: day(28),
    nextBillingAt: day(28),
  });
  for (let dow = 1; dow <= 6; dow += 1) {
    await CoachAvailability.create({
      coachId: coach._id,
      dayOfWeek: dow,
      startMinute: 9 * 60,
      endMinute: dow === 6 ? 13 * 60 : 18 * 60,
      timezone: "Asia/Kolkata",
      sessionDurationMin: 30,
      bufferMin: 10,
    });
  }

  const session = await CoachSession.create({
    coachId: coach._id,
    athleteId: edwin.profile._id,
    relationshipId: edwin.relationship._id,
    type: "progress_review",
    scheduledStart: at(0, 18, 0),
    scheduledEnd: at(0, 18, 30),
    bufferMin: 10,
    status: "confirmed",
    events: [{ type: "confirmed", actorId: coach._id, at: new Date() }],
    summary: "Progress review and weekly adjustments.",
  });

  const exercises = [
    { title: "Bench Press", type: "sets_reps", sets: 4, reps: "8", order: 0, mediaId: new mongoose.Types.ObjectId() },
    { title: "Lat Pulldown", type: "sets_reps", sets: 3, reps: "10", order: 1, mediaId: new mongoose.Types.ObjectId() },
    { title: "Shoulder Press", type: "sets_reps", sets: 3, reps: "12", order: 2, mediaId: new mongoose.Types.ObjectId() },
    { title: "Incline Row", type: "sets_reps", sets: 3, reps: "10", order: 3 },
    { title: "Core Hold", type: "duration", durationSec: 45, order: 4 },
    { title: "Cool Down", type: "checklist", order: 5 },
  ];
  const template = await WorkoutTemplate.create({
    ownerId: coach._id,
    ownerRole: "coach",
    name: "Upper Body Strength",
    description: "Upper body strength block.",
    exercises,
    version: 1,
  });
  const workout = await WorkoutAssignment.create({
    templateId: template._id,
    templateVersionSnapshot: 1,
    nameSnapshot: "Upper Body Strength",
    exercisesSnapshot: exercises,
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: day(0),
    slot: "AM",
    status: "in_progress",
    startedAt: new Date(),
  });
  await ExerciseProgress.insertMany([
    { assignmentId: workout._id, exerciseIndex: 0, status: "completed", setsCompleted: [{ setNumber: 1 }, { setNumber: 2 }, { setNumber: 3 }, { setNumber: 4 }], completedAt: new Date() },
    { assignmentId: workout._id, exerciseIndex: 1, status: "in_progress", setsCompleted: [{ setNumber: 1 }, { setNumber: 2 }] },
    { assignmentId: workout._id, exerciseIndex: 4, status: "skipped", setsCompleted: [] },
  ]);
  await WorkoutAssignment.create({
    templateId: template._id,
    templateVersionSnapshot: 1,
    nameSnapshot: "Lower Body",
    exercisesSnapshot: exercises.slice(0, 4),
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: day(1),
    status: "scheduled",
  });
  await WorkoutAssignment.create({
    templateId: template._id,
    templateVersionSnapshot: 1,
    nameSnapshot: "Recovery + Mobility",
    exercisesSnapshot: exercises.slice(0, 3),
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: day(3),
    status: "scheduled",
  });
  await WorkoutAssignment.create({
    templateId: template._id,
    templateVersionSnapshot: 1,
    nameSnapshot: "Upper Body",
    exercisesSnapshot: exercises.slice(0, 6),
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: day(5),
    status: "scheduled",
  });
  await WorkoutAssignment.create({
    templateId: template._id,
    templateVersionSnapshot: 1,
    nameSnapshot: "Upper Body Strength",
    exercisesSnapshot: exercises.slice(0, 6),
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: day(-2),
    status: "completed",
    completedAt: day(-2),
  });
  await WorkoutAssignment.create({
    templateId: template._id,
    templateVersionSnapshot: 1,
    nameSnapshot: "Cardio",
    exercisesSnapshot: exercises.slice(0, 2),
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: day(-1),
    status: "completed",
    completedAt: day(-1),
  });

  await NutritionTarget.create({
    athleteId: edwin.profile._id,
    goal: "lose_weight",
    goalIntensity: "moderate",
    calories: 2100,
    proteinG: 150,
    carbsG: 220,
    fatG: 65,
    effectiveFrom: day(-30),
    effectiveTo: null,
    calculationVersion: "functional-qa",
    inputSnapshot: {
      weightKg: 78.4,
      heightCm: 178,
      age: 29,
      biologicalSex: "male",
      activityLevel: "moderate",
      goal: "lose_weight",
      goalIntensity: "moderate",
    },
  });
  const planned = await PlannedMeal.insertMany([
    { athleteId: edwin.profile._id, date: day(0), mealType: "breakfast", source: "coach_assigned", name: "Oats + Banana + Eggs", foods: [{ name: "Oats", quantity: 1, unit: "bowl", calories: 260, proteinG: 12, carbsG: 40, fatG: 6 }, { name: "Eggs", quantity: 2, unit: "pcs", calories: 190, proteinG: 13, carbsG: 1, fatG: 14 }] },
    { athleteId: edwin.profile._id, date: day(0), mealType: "lunch", source: "coach_assigned", name: "Chicken Rice Bowl", foods: [{ name: "Chicken Rice Bowl", quantity: 1, unit: "serving", calories: 650, proteinG: 44, carbsG: 64, fatG: 18 }] },
    { athleteId: edwin.profile._id, date: day(0), mealType: "snack", source: "coach_assigned", name: "Protein Shake", foods: [{ name: "Protein Shake", quantity: 1, unit: "serving", calories: 220, proteinG: 30, carbsG: 12, fatG: 4 }] },
    { athleteId: edwin.profile._id, date: day(0), mealType: "dinner", source: "coach_assigned", name: "Grilled Chicken + Vegetables", foods: [{ name: "Dinner", quantity: 1, unit: "plate", calories: 580, proteinG: 34, carbsG: 43, fatG: 20 }] },
  ]);
  const mealPlan = await MealPlan.create({
    ownerId: coach._id,
    name: "7-Day Coach Plan",
    durationDays: 7,
    days: [{ dayIndex: 0, meals: planned.map((meal) => ({ mealType: meal.mealType, name: meal.name, foods: meal.foods })) }],
    version: 1,
  });
  await MealPlanAssignment.create({
    mealPlanId: mealPlan._id,
    mealPlanVersionSnapshot: 1,
    nameSnapshot: "7-Day Coach Plan",
    daysSnapshot: mealPlan.days,
    durationDays: 7,
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    startDate: day(-3),
    status: "active",
    plannedMealIds: planned.map((meal) => meal._id),
  });
  const breakfast = await Meal.create({ athleteId: edwin.profile._id, date: day(0), mealType: "breakfast", source: "confirmed_from_plan", plannedMealId: planned[0]._id, name: "Oats + Eggs" });
  await MealFood.insertMany([
    { mealId: breakfast._id, name: "Oats", quantity: 1, unit: "bowl", calories: 260, proteinG: 12, carbsG: 40, fatG: 6 },
    { mealId: breakfast._id, name: "Eggs", quantity: 2, unit: "pcs", calories: 220, proteinG: 16, carbsG: 1, fatG: 15 },
  ]);
  await WaterIntake.insertMany([
    { athleteId: edwin.profile._id, date: day(0), amountMl: 1000, loggedAt: at(0, 8, 0) },
    { athleteId: edwin.profile._id, date: day(0), amountMl: 800, loggedAt: at(0, 11, 0) },
  ]);

  for (const [index, item] of athletes.entries()) {
    const score = [76, 84, 67, 58][index];
    await Wellness.create({ athleteId: item.profile._id, date: day(0), sleepHours: 7.2, sleepQuality: 4, mood: 4, stress: 2, soreness: index === 3 ? 4 : 2, fatigue: index === 2 ? 4 : 3 });
    await Recovery.create({ athleteId: item.profile._id, date: day(0), recoveryScore: score, status: score >= 75 ? "green" : score >= 60 ? "amber" : "red", restingHr: 58, hrv: 72 });
    await Attendance.create({ athleteId: item.profile._id, date: day(0), status: "present", recordedBy: coach._id });
    await TrainingSession.create({ athleteId: item.profile._id, coachId: coach._id, date: day(0), slot: "AM", type: "strength", status: index === 0 ? "in_progress" : index === 1 ? "completed" : "planned", durationMin: 45 });
    await RpeMonitoring.create({
      academyId: academy._id,
      athleteId: item.profile._id,
      coachId: coach._id,
      date: day(0),
      day: dayOfWeek(day(0)),
      sessionType: "AM",
      trainingCategory: "GENERAL STRENGTH & MOBILITY",
      plannedIntensityPercent: 80,
      rpe: index === 0 ? 9 : 6,
      bodyConditionFeedback: "",
      restingHeartRate: 58,
      sleepQuality: 4,
      muscleSoreness: index === 3 ? 4 : 2,
      fatigue: index === 2 ? 4 : 3,
      moodMotivation: 4,
      ...deriveLoadAndRisk({ plannedIntensityPercent: 80, rpe: index === 0 ? 9 : 6, sleepQuality: 4, muscleSoreness: index === 3 ? 4 : 2, fatigue: index === 2 ? 4 : 3, moodMotivation: 4 }),
    });
  }

  await CoachComment.create({
    athleteId: edwin.profile._id,
    coachId: coach._id,
    date: day(0),
    body: "Keep your shoulder press lighter today.",
  });
  await CoachVideo.insertMany([
    { coachId: coach._id, title: "How to Improve Your Squat", category: "exercise_tutorial", visibility: "subscribers", originalName: "squat.mp4", storedFilename: "qa-squat.mp4", mimeType: "video/mp4", sizeBytes: 1024, durationSec: 522 },
    { coachId: coach._id, title: "Shoulder Mobility", category: "mobility", visibility: "selected_clients", selectedClientIds: [edwin.profile._id], originalName: "mobility.mp4", storedFilename: "qa-mobility.mp4", mimeType: "video/mp4", sizeBytes: 1024, durationSec: 370 },
    { coachId: coach._id, title: "Nutrition for Training", category: "nutrition", visibility: "public_preview", originalName: "nutrition.mp4", storedFilename: "qa-nutrition.mp4", mimeType: "video/mp4", sizeBytes: 1024, durationSec: 684 },
  ]);
  const endedRelationship = await CoachAthleteAssignment.create({
    coachId: coach._id,
    athleteId: edwin.profile._id,
    assignedBy: coach._id,
    status: "ended",
    endedAt: day(-60),
    endedReason: "athlete_left",
  }).catch(() => null);
  if (endedRelationship) {
    await CoachReview.create({
      relationshipId: endedRelationship._id,
      coachId: coach._id,
      athleteId: edwin.profile._id,
      overallRating: 5,
      body: "Very clear training guidance and quick responses.",
    }).catch(() => undefined);
  }
  await Notification.insertMany([
    { recipientUserId: edwin.user._id, academyId: academy._id, type: "coach_feedback", priority: "high", title: "New feedback from Coach Arjun", body: "Keep shoulder press lighter today.", link: "/athlete/dashboard" },
    { recipientUserId: coach._id, academyId: academy._id, type: "readiness_flag", priority: "high", title: "Edwin needs attention", body: "Low readiness with RPE 9.", link: `/coach/athletes/${edwin.profile._id}` },
  ]);

  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  const server = createServer(createApp());
  server.listen(Number(process.env.PORT), () => {
    console.log(`[fitora-functional] listening on http://localhost:${process.env.PORT}`);
    console.log("[fitora-functional] users: athlete.arjun@acme.test/Athlete@123, coach.kumar@acme.test/Coach@123");
    console.log(`[fitora-functional] coachSession=${session._id.toString()}`);
  });

  async function shutdown() {
    server.close(async () => {
      await mongoose.disconnect().catch(() => undefined);
      await mongo.stop().catch(() => undefined);
      process.exit(0);
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[fitora-functional] failed", error);
  process.exit(1);
});
