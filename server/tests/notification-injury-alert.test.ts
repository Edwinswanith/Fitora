import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import { Injury } from "../src/models/Injury";
import { Notification } from "../src/models/Notification";
import { DeviceToken } from "../src/models/DeviceToken";
import { NotificationPreference } from "../src/models/NotificationPreference";
import { NotificationDecision } from "../src/models/NotificationDecision";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";
import { setPushDeliveryAdapterForTests, type PushDeliveryAdapter } from "../src/services/fcmDelivery";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete" | "guardian", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

function tokenFor(userId: Types.ObjectId, role: "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const noopAdapter: PushDeliveryAdapter = {
  async send(input) {
    return input.tokens.map((t) => ({ token: t.token, ok: true }));
  },
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  setPushDeliveryAdapterForTests(noopAdapter);
});
afterAll(() => setPushDeliveryAdapterForTests(null));

async function seedScenario() {
  const admin = await makeUser("coach", "admin");
  const coach = await makeUser("coach", "kumar");
  const athleteUser = await makeUser("athlete", "arjun");
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "athletics" });
  await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: admin._id });
  const guardianUser = await makeUser("guardian", "rao");
  await GuardianAthleteLink.create({ guardianId: guardianUser._id, athleteId: profile._id });
  // Give every recipient a device token so the push path actually runs, and
  // disable quiet hours so these tests don't depend on the real wall-clock
  // time the suite happens to run at (default quiet hours are enabled).
  await DeviceToken.create({ userId: coach._id, platform: "android", token: `tok-${coach._id}` });
  await DeviceToken.create({ userId: guardianUser._id, platform: "android", token: `tok-${guardianUser._id}` });
  await NotificationPreference.create({ userId: coach._id, quietHours: { enabled: false } });
  await NotificationPreference.create({ userId: guardianUser._id, quietHours: { enabled: false } });
  return { coach, athleteUser, profile, guardianUser };
}

describe("POST /api/coach/athletes/:athleteId/injuries", () => {
  test("creates the injury and fans out to every assigned coach + linked guardian", async () => {
    const { coach, profile, guardianUser } = await seedScenario();
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/injuries`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ bodyPart: "hamstring", severity: "moderate", restriction: "no sprinting" });

    expect(res.status).toBe(201);
    expect(res.body.injury.bodyPart).toBe("hamstring");
    expect(await Injury.countDocuments({ athleteId: profile._id })).toBe(1);

    expect(await Notification.countDocuments({ recipientUserId: coach._id, type: "injury_alert" })).toBe(1);
    expect(await Notification.countDocuments({ recipientUserId: guardianUser._id, type: "injury_alert" })).toBe(1);

    const decisions = await NotificationDecision.find({ type: "injury_alert" }).lean();
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.status === "sent")).toBe(true);
  });

  test("invalid severity → 400, nothing created", async () => {
    const { coach, profile } = await seedScenario();
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/injuries`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ bodyPart: "ankle", severity: "catastrophic" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_severity");
    expect(await Injury.countDocuments({})).toBe(0);
  });

  test("severe injury bypasses an already-exhausted daily cap; mild/moderate respects it", async () => {
    const { coach, profile } = await seedScenario();
    // seedScenario() already created a quietHours:disabled preference row for the
    // coach — overwrite it in place rather than a second create() (unique index).
    await NotificationPreference.updateOne({ userId: coach._id }, { $set: { dailyCap: 0 } }); // cap already exhausted
    const app = buildApp();
    const auth = `Bearer ${tokenFor(coach._id, "coach")}`;

    const mild = await request(app)
      .post(`/api/coach/athletes/${profile._id}/injuries`)
      .set("Authorization", auth)
      .send({ bodyPart: "wrist", severity: "mild" });
    expect(mild.status).toBe(201);

    const severe = await request(app)
      .post(`/api/coach/athletes/${profile._id}/injuries`)
      .set("Authorization", auth)
      .send({ bodyPart: "knee", severity: "severe" });
    expect(severe.status).toBe(201);

    const decisions = await NotificationDecision.find({ userId: coach._id, type: "injury_alert" })
      .sort({ createdAt: 1 })
      .lean();
    // The mild one's push is capped out (transient — no row); the severe one overrides the cap and sends.
    expect(decisions).toHaveLength(1);
    expect(decisions[0].priorityTier).toBe(1);
    expect(decisions[0].status).toBe("sent");
  });

  test("unassigned coach cannot log an injury for another coach's athlete → 403", async () => {
    const { profile } = await seedScenario();
    const stranger = await makeUser("coach", "stranger");
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/injuries`)
      .set("Authorization", `Bearer ${tokenFor(stranger._id, "coach")}`)
      .send({ bodyPart: "hamstring", severity: "mild" });
    expect(res.status).toBe(403);
    expect(await Injury.countDocuments({})).toBe(0);
  });
});
