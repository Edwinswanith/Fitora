const path = require("path");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "fitora_seed_access_secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fitora_seed_refresh_secret";
process.env.INTERNAL_SWEEP_SECRET = process.env.INTERNAL_SWEEP_SECRET || "fitora_seed_sweep_secret";
process.env.TS_NODE_PROJECT = path.resolve(__dirname, "..", "server", "tsconfig.json");
process.env.TS_NODE_TRANSPILE_ONLY = "1";

require("dotenv").config({ path: path.resolve(__dirname, "..", "server", ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
require("../server/node_modules/ts-node/register/transpile-only");

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

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
const { Payment } = require("../server/src/models/Payment");
const { deriveLoadAndRisk, dayOfWeek } = require("../server/src/lib/trainingCategories");

const DEMO_COACH_EMAIL = "coach.kumar@acme.test";
const DEMO_ATHLETES = [
  ["athlete.arjun@acme.test", "Edwin Swanith", "Weight Loss", "general", "male-1", "lose_weight"],
  ["meera@acme.test", "Meera", "Build Muscle", "general", "female-1", "gain_weight"],
  ["rahul@acme.test", "Rahul", "General Fitness", "general", "male-2", "maintain_weight"],
  ["kiran@acme.test", "Kiran", "Maintain Fitness", "general", "male-1", "maintain_weight"],
];

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

function isRemoteMongo(uri) {
  if (/^mongodb\+srv:\/\//i.test(uri)) return true;
  const host = uri.replace(/^mongodb:\/\//i, "").split("/")[0] || "";
  return !/(^|@|,)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(host) && host !== "";
}

async function upsertUser({ email, role, name, password, academyId, avatarDefaultId, isAcademyOwner = false }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        role,
        name,
        passwordHash,
        academyId,
        isActive: true,
        isAcademyOwner,
        avatarKind: "default",
        avatarDefaultId,
        mustChangePassword: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function clearDemoData(coach, athletes) {
  const athleteProfileIds = athletes.map((athlete) => athlete.profile._id);
  const athleteUserIds = athletes.map((athlete) => athlete.user._id);

  const workoutAssignments = await WorkoutAssignment.find({
    $or: [{ assignedTo: { $in: athleteProfileIds } }, { assignedBy: coach._id }],
  }).select("_id");
  const workoutAssignmentIds = workoutAssignments.map((doc) => doc._id);

  const meals = await Meal.find({ athleteId: { $in: athleteProfileIds } }).select("_id");
  const mealIds = meals.map((doc) => doc._id);

  const relationships = await CoachAthleteAssignment.find({
    $or: [{ coachId: coach._id }, { athleteId: { $in: athleteProfileIds } }],
  }).select("_id");
  const relationshipIds = relationships.map((doc) => doc._id);

  const subscriptions = await AthleteCoachSubscription.find({
    $or: [
      { coachId: coach._id },
      { athleteId: { $in: athleteProfileIds } },
      { relationshipId: { $in: relationshipIds } },
    ],
  }).select("_id");
  const subscriptionIds = subscriptions.map((doc) => doc._id);

  await Promise.all([
    ExerciseProgress.deleteMany({ assignmentId: { $in: workoutAssignmentIds } }),
    WorkoutAssignment.deleteMany({ _id: { $in: workoutAssignmentIds } }),
    WorkoutTemplate.deleteMany({ ownerId: coach._id }),
    MealFood.deleteMany({ mealId: { $in: mealIds } }),
    Meal.deleteMany({ _id: { $in: mealIds } }),
    PlannedMeal.deleteMany({ athleteId: { $in: athleteProfileIds } }),
    MealPlanAssignment.deleteMany({
      $or: [{ assignedTo: { $in: athleteProfileIds } }, { assignedBy: coach._id }],
    }),
    MealPlan.deleteMany({ ownerId: coach._id }),
    NutritionTarget.deleteMany({ athleteId: { $in: athleteProfileIds } }),
    WaterIntake.deleteMany({ athleteId: { $in: athleteProfileIds } }),
    Wellness.deleteMany({ athleteId: { $in: athleteProfileIds } }),
    Recovery.deleteMany({ athleteId: { $in: athleteProfileIds } }),
    Attendance.deleteMany({ athleteId: { $in: athleteProfileIds } }),
    TrainingSession.deleteMany({ athleteId: { $in: athleteProfileIds } }),
    RpeMonitoring.deleteMany({
      $or: [{ athleteId: { $in: athleteProfileIds } }, { coachId: coach._id }],
    }),
    CoachComment.deleteMany({
      $or: [{ athleteId: { $in: athleteProfileIds } }, { coachId: coach._id }],
    }),
    Notification.deleteMany({ recipientUserId: { $in: [coach._id, ...athleteUserIds] } }),
    CoachVideo.deleteMany({ coachId: coach._id }),
    CoachReview.deleteMany({
      $or: [{ coachId: coach._id }, { athleteId: { $in: athleteProfileIds } }],
    }),
    Payment.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    AthleteCoachSubscription.deleteMany({ _id: { $in: subscriptionIds } }),
    CoachAvailability.deleteMany({ coachId: coach._id }),
    CoachSession.deleteMany({
      $or: [{ coachId: coach._id }, { athleteId: { $in: athleteProfileIds } }],
    }),
    CoachPricingPlan.deleteMany({ coachId: coach._id }),
    CoachProfile.deleteMany({ userId: coach._id }),
    CoachAthleteAssignment.deleteMany({ _id: { $in: relationshipIds } }),
  ]);
}

async function run() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || undefined;
  if (!uri) throw new Error("MONGODB_URI is required");

  const remote = isRemoteMongo(uri);
  if (remote && process.env.FITORA_SEED_ALLOW_REMOTE !== "true") {
    throw new Error("Refusing to seed a remote MongoDB without FITORA_SEED_ALLOW_REMOTE=true");
  }

  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10000 });
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  console.log(`[fitora-seed] connected to ${mongoose.connection.db?.databaseName}`);

  const academy = await Academy.findOneAndUpdate(
    { slug: "fitora-demo" },
    {
      $set: {
        name: "Fitora Demo Academy",
        slug: "fitora-demo",
        timezone: "Asia/Kolkata",
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const coach = await upsertUser({
    email: DEMO_COACH_EMAIL,
    role: "coach",
    name: "Arjun Kumar",
    password: "Coach@123",
    academyId: academy._id,
    avatarDefaultId: "coach-1",
    isAcademyOwner: true,
  });

  const athletes = [];
  for (const [email, name, position, sport, avatarDefaultId, fitnessGoal] of DEMO_ATHLETES) {
    const user = await upsertUser({
      email,
      role: "athlete",
      name,
      password: "Athlete@123",
      academyId: academy._id,
      avatarDefaultId,
    });
    const profile = await AthleteProfile.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          userId: user._id,
          academyId: academy._id,
          sport,
          position,
          timezone: "Asia/Kolkata",
          heightCm: 178,
          weightKg: name === "Edwin Swanith" ? 78.4 : 72,
          dob: "1997-08-14",
          hydrationGoalMl: 2500,
          fitnessGoal,
          goalIntensity: "moderate",
          activityLevel: "moderate",
          biologicalSex: name === "Meera" ? "female" : "male",
          cuisinePreferences: ["South Indian"],
          dietaryPreferences: ["Non-Vegetarian"],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    athletes.push({ user, profile, name });
  }

  await clearDemoData(coach, athletes);

  const relationships = [];
  for (const athlete of athletes) {
    const relationship = await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: athlete.profile._id,
      assignedBy: coach._id,
      status: "active",
      endedAt: null,
    });
    relationships.push(relationship);
  }

  const [edwin, meera, rahul, kiran] = athletes;
  const edwinRelationship = relationships[0];

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

  const basicPlan = await CoachPricingPlan.create({
    coachId: coach._id,
    name: "Basic",
    monthlyPrice: 2499,
    currency: "INR",
    includedServices: ["Workout planning", "Messaging"],
    workoutPlanningIncluded: true,
    priority: 0,
  });
  await CoachPricingPlan.create({
    coachId: coach._id,
    name: "Pro",
    monthlyPrice: 3999,
    currency: "INR",
    includedServices: ["Workout", "Nutrition", "2 calls"],
    workoutPlanningIncluded: true,
    nutritionIncluded: true,
    liveSessionsPerCycle: 2,
    priority: 1,
  });
  const premiumPlan = await CoachPricingPlan.create({
    coachId: coach._id,
    name: "Premium",
    monthlyPrice: 5999,
    currency: "INR",
    includedServices: ["Weekly session", "Priority support"],
    liveSessionsPerCycle: 4,
    nutritionIncluded: true,
    workoutPlanningIncluded: true,
    priority: 2,
  });

  const subscription = await AthleteCoachSubscription.create({
    relationshipId: edwinRelationship._id,
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
  await CoachAthleteAssignment.updateOne({ _id: edwinRelationship._id }, { $set: { subscriptionId: subscription._id } });

  await Payment.create({
    subscriptionId: subscription._id,
    provider: "razorpay",
    amount: 3999,
    currency: "INR",
    status: "paid",
    paidAt: day(-12),
    description: "Premium Coaching demo payment",
  }).catch(() => undefined);

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

  await CoachSession.create({
    coachId: coach._id,
    athleteId: edwin.profile._id,
    relationshipId: edwinRelationship._id,
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
  await WorkoutTemplate.create({
    ownerId: coach._id,
    ownerRole: "coach",
    name: "Recovery Mobility",
    description: "Short mobility session.",
    exercises: exercises.slice(3),
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
    {
      assignmentId: workout._id,
      exerciseIndex: 0,
      status: "completed",
      setsCompleted: [{ setNumber: 1 }, { setNumber: 2 }, { setNumber: 3 }, { setNumber: 4 }],
      completedAt: new Date(),
    },
    {
      assignmentId: workout._id,
      exerciseIndex: 1,
      status: "in_progress",
      setsCompleted: [{ setNumber: 1 }, { setNumber: 2 }],
    },
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
    slot: "AM",
    status: "scheduled",
  });
  await WorkoutAssignment.create({
    templateId: template._id,
    templateVersionSnapshot: 1,
    nameSnapshot: "Recovery + Mobility",
    exercisesSnapshot: exercises.slice(3),
    assignedTo: edwin.profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: day(3),
    slot: "PM",
    status: "scheduled",
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
    slot: "AM",
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
    calculationVersion: "fitora-demo",
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
    {
      athleteId: edwin.profile._id,
      date: day(0),
      mealType: "breakfast",
      source: "coach_assigned",
      name: "Oats + Banana + Eggs",
      foods: [
        { name: "Oats", quantity: 1, unit: "bowl", calories: 260, proteinG: 12, carbsG: 40, fatG: 6 },
        { name: "Eggs", quantity: 2, unit: "pcs", calories: 190, proteinG: 13, carbsG: 1, fatG: 14 },
      ],
    },
    {
      athleteId: edwin.profile._id,
      date: day(0),
      mealType: "lunch",
      source: "coach_assigned",
      name: "Chicken Rice Bowl",
      foods: [{ name: "Chicken Rice Bowl", quantity: 1, unit: "serving", calories: 650, proteinG: 44, carbsG: 64, fatG: 18 }],
    },
    {
      athleteId: edwin.profile._id,
      date: day(0),
      mealType: "snack",
      source: "coach_assigned",
      name: "Protein Shake",
      foods: [{ name: "Protein Shake", quantity: 1, unit: "serving", calories: 220, proteinG: 30, carbsG: 12, fatG: 4 }],
    },
    {
      athleteId: edwin.profile._id,
      date: day(0),
      mealType: "dinner",
      source: "coach_assigned",
      name: "Grilled Chicken + Vegetables",
      foods: [{ name: "Dinner", quantity: 1, unit: "plate", calories: 580, proteinG: 34, carbsG: 43, fatG: 20 }],
    },
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
  const breakfast = await Meal.create({
    athleteId: edwin.profile._id,
    date: day(0),
    mealType: "breakfast",
    source: "confirmed_from_plan",
    plannedMealId: planned[0]._id,
    name: "Oats + Eggs",
  });
  await MealFood.insertMany([
    { mealId: breakfast._id, name: "Oats", quantity: 1, unit: "bowl", calories: 260, proteinG: 12, carbsG: 40, fatG: 6 },
    { mealId: breakfast._id, name: "Eggs", quantity: 2, unit: "pcs", calories: 220, proteinG: 16, carbsG: 1, fatG: 15 },
  ]);
  await WaterIntake.insertMany([
    { athleteId: edwin.profile._id, date: day(0), amountMl: 1000, loggedAt: at(0, 8, 0) },
    { athleteId: edwin.profile._id, date: day(0), amountMl: 800, loggedAt: at(0, 11, 0) },
  ]);

  for (const [index, athlete] of athletes.entries()) {
    const score = [76, 84, 67, 58][index];
    await Wellness.create({
      athleteId: athlete.profile._id,
      date: day(0),
      sleepHours: 7.2,
      sleepQuality: 4,
      mood: 4,
      stress: 2,
      soreness: index === 3 ? 4 : 2,
      fatigue: index === 2 ? 4 : 3,
    });
    await Recovery.create({
      athleteId: athlete.profile._id,
      date: day(0),
      recoveryScore: score,
      status: score >= 75 ? "green" : score >= 60 ? "amber" : "red",
      restingHr: 58,
      hrv: 72,
    });
    await Attendance.create({ athleteId: athlete.profile._id, date: day(0), status: "present", recordedBy: coach._id });
    await TrainingSession.create({
      athleteId: athlete.profile._id,
      coachId: coach._id,
      date: day(0),
      slot: "AM",
      type: "strength",
      status: index === 0 ? "in_progress" : index === 1 ? "completed" : "planned",
      durationMin: 45,
    });
    const rpe = index === 0 ? 9 : 6;
    await RpeMonitoring.create({
      academyId: academy._id,
      athleteId: athlete.profile._id,
      coachId: coach._id,
      date: day(0),
      day: dayOfWeek(day(0)),
      sessionType: "AM",
      trainingCategory: "GENERAL STRENGTH & MOBILITY",
      plannedIntensityPercent: 80,
      rpe,
      bodyConditionFeedback: "",
      restingHeartRate: 58,
      sleepQuality: 4,
      muscleSoreness: index === 3 ? 4 : 2,
      fatigue: index === 2 ? 4 : 3,
      moodMotivation: 4,
      ...deriveLoadAndRisk({
        plannedIntensityPercent: 80,
        rpe,
        sleepQuality: 4,
        muscleSoreness: index === 3 ? 4 : 2,
        fatigue: index === 2 ? 4 : 3,
        moodMotivation: 4,
      }),
    });
  }

  await CoachComment.create({
    athleteId: edwin.profile._id,
    coachId: coach._id,
    date: day(0),
    body: "Keep your shoulder press lighter today.",
  });

  await CoachVideo.insertMany([
    {
      coachId: coach._id,
      title: "How to Improve Your Squat",
      category: "exercise_tutorial",
      visibility: "subscribers",
      originalName: "squat.mp4",
      storedFilename: `fitora-demo-${coach._id}-squat.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 1024,
      durationSec: 522,
    },
    {
      coachId: coach._id,
      title: "Shoulder Mobility",
      category: "mobility",
      visibility: "selected_clients",
      selectedClientIds: [edwin.profile._id],
      originalName: "mobility.mp4",
      storedFilename: `fitora-demo-${coach._id}-mobility.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 1024,
      durationSec: 370,
    },
    {
      coachId: coach._id,
      title: "Nutrition for Training",
      category: "nutrition",
      visibility: "public_preview",
      originalName: "nutrition.mp4",
      storedFilename: `fitora-demo-${coach._id}-nutrition.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 1024,
      durationSec: 684,
    },
  ]);

  const endedRelationship = await CoachAthleteAssignment.create({
    coachId: coach._id,
    athleteId: edwin.profile._id,
    assignedBy: coach._id,
    status: "ended",
    endedAt: day(-60),
    endedReason: "athlete_left",
  });
  await CoachReview.create({
    relationshipId: endedRelationship._id,
    coachId: coach._id,
    athleteId: edwin.profile._id,
    overallRating: 5,
    body: "Very clear training guidance and quick responses.",
  });

  await Notification.insertMany([
    {
      recipientUserId: edwin.user._id,
      academyId: academy._id,
      type: "coach_feedback",
      priority: "high",
      title: "New feedback from Coach Arjun",
      body: "Keep shoulder press lighter today.",
      link: "/athlete/dashboard",
    },
    {
      recipientUserId: coach._id,
      academyId: academy._id,
      type: "readiness_flag",
      priority: "high",
      title: "Edwin needs attention",
      body: "Low readiness with RPE 9.",
      link: `/coach/athletes/${edwin.profile._id}`,
    },
  ]);

  const counts = {
    users: await User.countDocuments({ email: { $in: [DEMO_COACH_EMAIL, ...DEMO_ATHLETES.map(([email]) => email)] } }),
    relationships: await CoachAthleteAssignment.countDocuments({ coachId: coach._id }),
    pricingPlans: await CoachPricingPlan.countDocuments({ coachId: coach._id }),
    sessions: await CoachSession.countDocuments({ coachId: coach._id }),
    workoutTemplates: await WorkoutTemplate.countDocuments({ ownerId: coach._id }),
    workoutAssignments: await WorkoutAssignment.countDocuments({ assignedTo: { $in: athletes.map((athlete) => athlete.profile._id) } }),
    plannedMeals: await PlannedMeal.countDocuments({ athleteId: edwin.profile._id }),
    loggedMeals: await Meal.countDocuments({ athleteId: edwin.profile._id }),
    videos: await CoachVideo.countDocuments({ coachId: coach._id }),
    reviews: await CoachReview.countDocuments({ coachId: coach._id }),
  };

  console.log("[fitora-seed] demo credentials:");
  console.log("  coach:   coach.kumar@acme.test / Coach@123");
  console.log("  athlete: athlete.arjun@acme.test / Athlete@123");
  console.log("[fitora-seed] counts:", counts);
}

run()
  .then(async () => {
    await mongoose.disconnect();
    console.log("[fitora-seed] done");
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[fitora-seed] failed:", error.message);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
