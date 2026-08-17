import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachVideo } from "../src/models/CoachVideo";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import { CoachVideoProgress } from "../src/models/CoachVideoProgress";
import coachVideosRouter from "../src/routes/coachVideos";
import athleteCoachVideosRouter from "../src/routes/athleteCoachVideos";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachVideosRouter);
  app.use("/api/athlete", athleteCoachVideosRouter);
  return app;
}
async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}
async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general" });
  return { user, profile };
}
function tokenFor(id: Types.ObjectId, role: "coach" | "athlete") {
  return signAccessToken({ sub: id.toString(), role });
}
const FAKE_MP4 = Buffer.from("not a real mp4", "utf8");

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

async function uploadVideo(coach: Awaited<ReturnType<typeof makeCoach>>, overrides: { visibility?: string; selectedClientIds?: string[] } = {}) {
  const upload = await request(buildApp())
    .post("/api/coach/videos")
    .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
    .field("title", "Test Video")
    .field("category", "mobility")
    .attach("file", FAKE_MP4, { filename: "x.mp4", contentType: "video/mp4" });
  const videoId = upload.body.video.id as string;
  if (overrides.visibility || overrides.selectedClientIds) {
    await request(buildApp())
      .patch(`/api/coach/videos/${videoId}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ visibility: overrides.visibility, selectedClientIds: overrides.selectedClientIds });
  }
  return videoId;
}

describe("visibility matrix", () => {
  test("public_preview: visible to ANY authenticated athlete, no relationship required", async () => {
    const coach = await makeCoach("preview-coach");
    const videoId = await uploadVideo(coach, { visibility: "public_preview" });
    const { user: strangerUser } = await makeAthlete("preview-stranger");

    const res = await request(buildApp())
      .get(`/api/athlete/coach-videos?coachId=${coach._id.toString()}`)
      .set("Authorization", `Bearer ${tokenFor(strangerUser._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.videos.map((v: { id: string }) => v.id)).toContain(videoId);
  });

  test("private: never visible to any athlete, even one with an active relationship", async () => {
    const coach = await makeCoach("private-coach");
    const { user, profile } = await makeAthlete("private-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const videoId = await uploadVideo(coach); // default visibility: private

    const list = await request(buildApp()).get(`/api/athlete/coach-videos?coachId=${coach._id.toString()}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(list.body.videos).toHaveLength(0);

    const detail = await request(buildApp()).get(`/api/athlete/coach-videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(detail.status).toBe(404);
  });

  test("selected_clients: visible only to listed athletes with an active relationship, not to other assigned athletes", async () => {
    const coach = await makeCoach("selected-coach");
    const { user: chosenUser, profile: chosenProfile } = await makeAthlete("chosen-athlete");
    const { user: otherUser, profile: otherProfile } = await makeAthlete("other-athlete");
    await Promise.all([
      CoachAthleteAssignment.create({ coachId: coach._id, athleteId: chosenProfile._id, assignedBy: coach._id, status: "active" }),
      CoachAthleteAssignment.create({ coachId: coach._id, athleteId: otherProfile._id, assignedBy: coach._id, status: "active" }),
    ]);
    const videoId = await uploadVideo(coach, { visibility: "selected_clients", selectedClientIds: [chosenProfile._id.toString()] });

    const chosenList = await request(buildApp()).get(`/api/athlete/coach-videos?coachId=${coach._id.toString()}`).set("Authorization", `Bearer ${tokenFor(chosenUser._id, "athlete")}`);
    expect(chosenList.body.videos.map((v: { id: string }) => v.id)).toContain(videoId);

    const otherList = await request(buildApp()).get(`/api/athlete/coach-videos?coachId=${coach._id.toString()}`).set("Authorization", `Bearer ${tokenFor(otherUser._id, "athlete")}`);
    expect(otherList.body.videos).toHaveLength(0);
  });

  test("selected_clients: a listed athlete whose relationship has ENDED loses access", async () => {
    const coach = await makeCoach("ended-selected-coach");
    const { user, profile } = await makeAthlete("ended-selected-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "ended", endedAt: new Date() });
    const videoId = await uploadVideo(coach, { visibility: "selected_clients", selectedClientIds: [profile._id.toString()] });

    const res = await request(buildApp()).get(`/api/athlete/coach-videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(404);
  });

  test("subscribers: a legacy relationship with NO linked subscription is unpaywalled (backward-compatible)", async () => {
    const coach = await makeCoach("legacy-sub-coach");
    const { user, profile } = await makeAthlete("legacy-sub-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const videoId = await uploadVideo(coach, { visibility: "subscribers" });

    const res = await request(buildApp()).get(`/api/athlete/coach-videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
  });

  test("subscribers: an active subscription grants access, an expired/payment_failed one blocks it", async () => {
    const coach = await makeCoach("active-sub-coach");
    const { user, profile } = await makeAthlete("active-sub-athlete");
    const plan = await CoachPricingPlan.create({ coachId: coach._id, name: "Pro", monthlyPrice: 20, currency: "USD" });
    const subscription = await AthleteCoachSubscription.create({
      coachId: coach._id,
      athleteId: profile._id,
      pricingPlanId: plan._id,
      pricingPlanSnapshot: { name: plan.name, monthlyPrice: plan.monthlyPrice, currency: plan.currency, includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
      provider: "razorpay",
      status: "active",
    });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active", subscriptionId: subscription._id });
    const videoId = await uploadVideo(coach, { visibility: "subscribers" });

    const ok = await request(buildApp()).get(`/api/athlete/coach-videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(ok.status).toBe(200);

    await AthleteCoachSubscription.updateOne({ _id: subscription._id }, { $set: { status: "expired" } });
    const blocked = await request(buildApp()).get(`/api/athlete/coach-videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(blocked.status).toBe(404);
  });

  test("archived videos are never visible to an athlete regardless of visibility tier", async () => {
    const coach = await makeCoach("archived-coach");
    const { user, profile } = await makeAthlete("archived-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const videoId = await uploadVideo(coach, { visibility: "public_preview" });
    await request(buildApp()).post(`/api/coach/videos/${videoId}/archive`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const res = await request(buildApp()).get(`/api/athlete/coach-videos?coachId=${coach._id.toString()}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.body.videos).toHaveLength(0);
  });

  test("streaming a video the athlete can't see returns 404, not the file", async () => {
    const coach = await makeCoach("stream-block-coach");
    const { user } = await makeAthlete("stream-block-athlete");
    const videoId = await uploadVideo(coach); // private, no relationship at all
    const res = await request(buildApp()).get(`/api/athlete/coach-videos/${videoId}/stream`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /athlete/coach-videos/:id/progress", () => {
  test("computes progressPercent from durationSec and transitions status", async () => {
    const coach = await makeCoach("progress-coach");
    const { user, profile } = await makeAthlete("progress-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const videoId = await uploadVideo(coach, { visibility: "public_preview" });
    await CoachVideo.updateOne({ _id: videoId }, { $set: { durationSec: 100 } });
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const first = await request(app).post(`/api/athlete/coach-videos/${videoId}/progress`).set("Authorization", token).send({ positionSec: 10 });
    expect(first.status).toBe(200);
    expect(first.body.progress.status).toBe("viewed");
    expect(first.body.progress.progressPercent).toBe(10);

    const second = await request(app).post(`/api/athlete/coach-videos/${videoId}/progress`).set("Authorization", token).send({ positionSec: 96 });
    expect(second.body.progress.status).toBe("completed");
    expect(second.body.progress.progressPercent).toBe(96);

    // Upsert, not duplicate rows.
    expect(await CoachVideoProgress.countDocuments({ videoId, athleteId: profile._id })).toBe(1);
  });

  test("an explicit completed:true marks completed regardless of percent", async () => {
    const coach = await makeCoach("explicit-complete-coach");
    const { user, profile } = await makeAthlete("explicit-complete-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const videoId = await uploadVideo(coach, { visibility: "public_preview" });
    await CoachVideo.updateOne({ _id: videoId }, { $set: { durationSec: 600 } });

    const res = await request(buildApp())
      .post(`/api/athlete/coach-videos/${videoId}/progress`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ positionSec: 30, completed: true });
    expect(res.body.progress.status).toBe("completed");
  });

  test("cannot post progress for a video the athlete can't see", async () => {
    const coach = await makeCoach("progress-block-coach");
    const { user } = await makeAthlete("progress-block-athlete");
    const videoId = await uploadVideo(coach); // private
    const res = await request(buildApp()).post(`/api/athlete/coach-videos/${videoId}/progress`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`).send({ positionSec: 5 });
    expect(res.status).toBe(404);
  });
});
