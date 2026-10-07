import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import fs from "fs";
import path from "path";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { CoachProfile } from "../src/models/CoachProfile";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import { Payment } from "../src/models/Payment";
import { CoachAvailability } from "../src/models/CoachAvailability";
import { CoachAvailabilityException } from "../src/models/CoachAvailabilityException";
import { CoachSession } from "../src/models/CoachSession";
import { CoachSessionSlotLock } from "../src/models/CoachSessionSlotLock";
import { CoachVideo } from "../src/models/CoachVideo";
import { CoachVideoProgress } from "../src/models/CoachVideoProgress";
import { CoachReview } from "../src/models/CoachReview";
import { Meal } from "../src/models/Meal";
import { MealFood } from "../src/models/MealFood";
import { MealScan } from "../src/models/MealScan";
import { MealScanItem } from "../src/models/MealScanItem";
import { NutritionTarget } from "../src/models/NutritionTarget";
import { TrainingSession } from "../src/models/TrainingSession";
import { permanentlyDeleteAccount } from "../src/services/accountDeletion";
import { env } from "../src/config/env";

// Phase 11 hardening: accountDeletion.ts previously cleaned up none of the 12
// Phase 6-10 collections (AthleteCoachSubscription, Payment, CoachAvailability,
// CoachAvailabilityException, CoachSession, CoachSessionSlotLock, CoachVideo,
// CoachVideoProgress, CoachReview, CoachPricingPlan, CoachProfile) — worse,
// since CoachAthleteAssignment WAS deleted, surviving rows referencing it via
// relationshipId were left pointing at a nonexistent document. This suite
// verifies every one of those collections is now actually cleaned up.
let mongo: MongoMemoryServer;

async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}
async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general" });
  return { user, profile };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  fs.mkdirSync(env.upload.dir, { recursive: true });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

async function setupFullRelationship() {
  const coach = await makeCoach("cascade-coach");
  const { user: athleteUser, profile } = await makeAthlete("cascade-athlete");
  const plan = await CoachPricingPlan.create({ coachId: coach._id, name: "Pro", monthlyPrice: 20, currency: "USD" });
  await CoachProfile.create({ userId: coach._id, bio: "test" });

  const subscription = await AthleteCoachSubscription.create({
    coachId: coach._id,
    athleteId: profile._id,
    pricingPlanId: plan._id,
    pricingPlanSnapshot: { name: plan.name, monthlyPrice: plan.monthlyPrice, currency: plan.currency, includedServices: [], liveSessionsPerCycle: 1, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
    provider: "razorpay",
    status: "active",
  });
  const payment = await Payment.create({ subscriptionId: subscription._id, provider: "razorpay", providerPaymentId: `pay_${Date.now()}`, amount: 20, currency: "USD", status: "succeeded" });
  const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "ended", endedAt: new Date(), subscriptionId: subscription._id });

  const availability = await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 600, timezone: "UTC", sessionDurationMin: 30 });
  const exception = await CoachAvailabilityException.create({ coachId: coach._id, date: new Date("2026-01-05"), type: "unavailable" });

  const session = await CoachSession.create({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, type: "general", scheduledStart: new Date(), scheduledEnd: new Date(Date.now() + 1800000), bufferMin: 0, status: "confirmed" });
  const lock = await CoachSessionSlotLock.create({ coachId: coach._id, bucketStart: new Date(), sessionId: session._id });

  const video = await CoachVideo.create({ coachId: coach._id, title: "Test Video", category: "mobility", originalName: "x.mp4", storedFilename: `cascade-test-${Date.now()}.mp4`, mimeType: "video/mp4", sizeBytes: 10 });
  const videoFilePath = path.join(env.upload.dir, video.storedFilename);
  await fs.promises.writeFile(videoFilePath, "test video bytes");
  const progress = await CoachVideoProgress.create({ videoId: video._id, athleteId: profile._id, status: "viewed", progressPercent: 50, lastPositionSec: 30 });

  const review = await CoachReview.create({ relationshipId: relationship._id, coachId: coach._id, athleteId: profile._id, overallRating: 5 });

  return { coach, athleteUser, profile, plan, subscription, payment, relationship, availability, exception, session, lock, video, videoFilePath, progress, review };
}

describe("account deletion cascade — coach", () => {
  test("deleting a coach's account cleans up every Phase 5-10 collection they own", async () => {
    const ctx = await setupFullRelationship();
    const coachDoc = await User.findById(ctx.coach._id);
    expect(coachDoc).not.toBeNull();

    await permanentlyDeleteAccount(coachDoc!);

    expect(await CoachProfile.countDocuments({ userId: ctx.coach._id })).toBe(0);
    expect(await CoachPricingPlan.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await CoachAvailability.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await CoachAvailabilityException.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await CoachSession.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await CoachSessionSlotLock.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await CoachVideo.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await CoachVideoProgress.countDocuments({ videoId: ctx.video._id })).toBe(0);
    expect(await CoachReview.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await AthleteCoachSubscription.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(await Payment.countDocuments({ subscriptionId: ctx.subscription._id })).toBe(0);
    expect(await CoachAthleteAssignment.countDocuments({ coachId: ctx.coach._id })).toBe(0);
    expect(fs.existsSync(ctx.videoFilePath)).toBe(false);
    expect(await User.countDocuments({ _id: ctx.coach._id })).toBe(0);
  });

  test("deleting the coach leaves the athlete's own unrelated data untouched", async () => {
    const ctx = await setupFullRelationship();
    const coachDoc = await User.findById(ctx.coach._id);
    await permanentlyDeleteAccount(coachDoc!);

    expect(await AthleteProfile.countDocuments({ _id: ctx.profile._id })).toBe(1);
    expect(await User.countDocuments({ _id: ctx.athleteUser._id })).toBe(1);
  });
});

describe("account deletion cascade — athlete", () => {
  test("deleting an athlete's account cleans up every Phase 6-10 collection referencing them", async () => {
    const ctx = await setupFullRelationship();
    const athleteDoc = await User.findById(ctx.athleteUser._id);
    expect(athleteDoc).not.toBeNull();

    await permanentlyDeleteAccount(athleteDoc!);

    expect(await AthleteCoachSubscription.countDocuments({ athleteId: ctx.profile._id })).toBe(0);
    expect(await Payment.countDocuments({ subscriptionId: ctx.subscription._id })).toBe(0);
    expect(await CoachSession.countDocuments({ athleteId: ctx.profile._id })).toBe(0);
    expect(await CoachSessionSlotLock.countDocuments({ sessionId: ctx.session._id })).toBe(0);
    expect(await CoachVideoProgress.countDocuments({ athleteId: ctx.profile._id })).toBe(0);
    expect(await CoachReview.countDocuments({ athleteId: ctx.profile._id })).toBe(0);
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: ctx.profile._id })).toBe(0);
    expect(await AthleteProfile.countDocuments({ _id: ctx.profile._id })).toBe(0);
    expect(await User.countDocuments({ _id: ctx.athleteUser._id })).toBe(0);
  });

  test("deleting an athlete also removes nutrition rows, meal scans and their uploaded photos", async () => {
    const ctx = await setupFullRelationship();
    const athleteId = ctx.profile._id;
    const meal = await Meal.create({ athleteId, date: new Date(), mealType: "lunch", source: "ad_hoc" });
    await MealFood.create({ mealId: meal._id, name: "Rice", quantity: 1, unit: "cup", calories: 200, proteinG: 4, carbsG: 44, fatG: 0 });
    const scanFile = `cascade-scan-${Date.now()}.jpg`;
    const photoFile = `cascade-photo-${Date.now()}.jpg`;
    await fs.promises.writeFile(path.join(env.upload.dir, scanFile), "scan bytes");
    await fs.promises.writeFile(path.join(env.upload.dir, photoFile), "photo bytes");
    const scan = await MealScan.create({ athleteId, storedFilename: scanFile, originalName: "plate.jpg", mimeType: "image/jpeg", sizeBytes: 10 });
    await MealScanItem.create({ scanId: scan._id, foodName: "Rice", quantity: 1, unit: "cup", calories: 200, proteinG: 4, carbsG: 44, fatG: 0 });
    await NutritionTarget.create({ athleteId, goal: "maintain_weight", goalIntensity: "moderate", calories: 2200, proteinG: 120, carbsG: 250, fatG: 70, effectiveFrom: new Date() });
    await TrainingSession.create({
      athleteId,
      date: new Date(),
      slot: "AM",
      photos: [{ _id: new Types.ObjectId(), storedFilename: photoFile, originalName: "p.jpg", mimeType: "image/jpeg", sizeBytes: 11, uploadedAt: new Date() }],
    });

    await permanentlyDeleteAccount((await User.findById(ctx.athleteUser._id))!);

    expect(await Meal.countDocuments({ athleteId })).toBe(0);
    expect(await MealFood.countDocuments({ mealId: meal._id })).toBe(0);
    expect(await MealScan.countDocuments({ athleteId })).toBe(0);
    expect(await MealScanItem.countDocuments({ scanId: scan._id })).toBe(0);
    expect(await NutritionTarget.countDocuments({ athleteId })).toBe(0);
    expect(fs.existsSync(path.join(env.upload.dir, scanFile))).toBe(false);
    expect(fs.existsSync(path.join(env.upload.dir, photoFile))).toBe(false);
    await fs.promises.unlink(ctx.videoFilePath).catch(() => undefined);
  });

  test("deleting the athlete leaves the coach's own profile/plan/other videos untouched", async () => {
    const ctx = await setupFullRelationship();
    const athleteDoc = await User.findById(ctx.athleteUser._id);
    await permanentlyDeleteAccount(athleteDoc!);

    expect(await CoachProfile.countDocuments({ userId: ctx.coach._id })).toBe(1);
    expect(await CoachPricingPlan.countDocuments({ coachId: ctx.coach._id })).toBe(1);
    expect(await CoachVideo.countDocuments({ coachId: ctx.coach._id })).toBe(1);
    expect(fs.existsSync(ctx.videoFilePath)).toBe(true);
    await fs.promises.unlink(ctx.videoFilePath).catch(() => undefined);
  });
});
