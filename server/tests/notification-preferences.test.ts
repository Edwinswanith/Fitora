import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { NotificationPreference } from "../src/models/NotificationPreference";
import notificationPreferencesRouter from "../src/routes/notificationPreferences";
import presenceRouter from "../src/routes/presence";
import { signAccessToken } from "../src/lib/tokens";
import { env } from "../src/config/env";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/notification-preferences", notificationPreferencesRouter);
  app.use("/api/presence", presenceRouter);
  return app;
}

async function makeAthlete(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
}

function tokenFor(userId: Types.ObjectId) {
  return signAccessToken({ sub: userId.toString(), role: "athlete" });
}

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
});

describe("GET /api/notification-preferences", () => {
  test("lazily creates a default row with env-driven quiet hours", async () => {
    const user = await makeAthlete("alpha");
    const res = await request(buildApp())
      .get("/api/notification-preferences")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.categories).toMatchObject({
      reminders: true,
      alerts: true,
      deadlines: true,
      digests: true,
      milestones: true,
      messages: true,
    });
    expect(res.body.quietHours.startMinute).toBe(env.notification.quietHoursDefaultStartMinute);
    expect(res.body.quietHours.endMinute).toBe(env.notification.quietHoursDefaultEndMinute);
    expect(await NotificationPreference.countDocuments({ userId: user._id })).toBe(1);
  });
});

describe("PATCH /api/notification-preferences", () => {
  test("partial update only touches the given fields", async () => {
    const user = await makeAthlete("alpha");
    const app = buildApp();
    const auth = `Bearer ${tokenFor(user._id)}`;

    const first = await request(app)
      .patch("/api/notification-preferences")
      .set("Authorization", auth)
      .send({ categories: { reminders: false } });
    expect(first.status).toBe(200);
    expect(first.body.categories.reminders).toBe(false);
    expect(first.body.categories.alerts).toBe(true); // untouched
    expect(first.body.enabled).toBe(true); // untouched

    const second = await request(app)
      .patch("/api/notification-preferences")
      .set("Authorization", auth)
      .send({ enabled: false });
    expect(second.status).toBe(200);
    expect(second.body.enabled).toBe(false);
    expect(second.body.categories.reminders).toBe(false); // still off from the first PATCH
  });

  test("quiet hours round-trip, including a wrap-past-midnight window", async () => {
    const user = await makeAthlete("alpha");
    const res = await request(buildApp())
      .patch("/api/notification-preferences")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({ quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 } });
    expect(res.status).toBe(200);
    expect(res.body.quietHours).toMatchObject({ enabled: true, startMinute: 1320, endMinute: 420 });
  });

  test("out-of-range minute values are ignored, not stored", async () => {
    const user = await makeAthlete("alpha");
    const res = await request(buildApp())
      .patch("/api/notification-preferences")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({ quietHours: { startMinute: 5000, endMinute: -1 } });
    expect(res.status).toBe(200);
    expect(res.body.quietHours.startMinute).toBe(env.notification.quietHoursDefaultStartMinute);
    expect(res.body.quietHours.endMinute).toBe(env.notification.quietHoursDefaultEndMinute);
  });

  // Voice assistant V2's change_hydration_reminder intent maps to this field
  // (plan §4.1) — it was previously readable via GET but not settable via PATCH.
  describe("minIntervalMinutes", () => {
    test("a valid value persists and is echoed back", async () => {
      const user = await makeAthlete("alpha");
      const res = await request(buildApp())
        .patch("/api/notification-preferences")
        .set("Authorization", `Bearer ${tokenFor(user._id)}`)
        .send({ minIntervalMinutes: 90 });
      expect(res.status).toBe(200);
      expect(res.body.minIntervalMinutes).toBe(90);
      const stored = await NotificationPreference.findOne({ userId: user._id }).lean();
      expect(stored?.minIntervalMinutes).toBe(90);
    });

    test("out-of-range values are rejected with 400, not silently clamped", async () => {
      const user = await makeAthlete("alpha");
      const app = buildApp();
      const auth = `Bearer ${tokenFor(user._id)}`;

      const tooLow = await request(app).patch("/api/notification-preferences").set("Authorization", auth).send({ minIntervalMinutes: 5 });
      expect(tooLow.status).toBe(400);
      expect(tooLow.body.error).toBe("invalid_minIntervalMinutes");

      const tooHigh = await request(app).patch("/api/notification-preferences").set("Authorization", auth).send({ minIntervalMinutes: 1000 });
      expect(tooHigh.status).toBe(400);

      const notInteger = await request(app).patch("/api/notification-preferences").set("Authorization", auth).send({ minIntervalMinutes: 45.5 });
      expect(notInteger.status).toBe(400);
    });

    test("explicit null resets to the global default", async () => {
      const user = await makeAthlete("alpha");
      const app = buildApp();
      const auth = `Bearer ${tokenFor(user._id)}`;
      await request(app).patch("/api/notification-preferences").set("Authorization", auth).send({ minIntervalMinutes: 120 });

      const res = await request(app).patch("/api/notification-preferences").set("Authorization", auth).send({ minIntervalMinutes: null });
      expect(res.status).toBe(200);
      expect(res.body.minIntervalMinutes).toBeNull();
    });

    test("leaving it out of the body doesn't disturb a previously-set value", async () => {
      const user = await makeAthlete("alpha");
      const app = buildApp();
      const auth = `Bearer ${tokenFor(user._id)}`;
      await request(app).patch("/api/notification-preferences").set("Authorization", auth).send({ minIntervalMinutes: 60 });

      const res = await request(app).patch("/api/notification-preferences").set("Authorization", auth).send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.minIntervalMinutes).toBe(60);
    });
  });
});

describe("POST /api/presence/heartbeat", () => {
  test("stamps lastActiveAt on a lazily-created preference row", async () => {
    const user = await makeAthlete("alpha");
    const before = new Date();
    const res = await request(buildApp())
      .post("/api/presence/heartbeat")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`);
    expect(res.status).toBe(200);
    const pref = await NotificationPreference.findOne({ userId: user._id }).lean();
    expect(pref?.lastActiveAt).toBeTruthy();
    expect((pref!.lastActiveAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
