import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachAvailability } from "../src/models/CoachAvailability";
import { CoachSession } from "../src/models/CoachSession";
import coachAvailabilityRouter from "../src/routes/coachAvailability";
import athleteSessionsRouter from "../src/routes/athleteSessions";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachAvailabilityRouter);
  app.use("/api/athlete", athleteSessionsRouter);
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

// 2026-01-05 is a Monday (dayOfWeek 1); 2026-01-06 is a Tuesday.
const MONDAY = "2026-01-05";
const TUESDAY = "2026-01-06";

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

describe("PUT /coach/availability", () => {
  test("replaces the coach's full recurring rule set and validates ranges", async () => {
    const coach = await makeCoach("avail-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    const res = await request(app)
      .put("/api/coach/availability")
      .set("Authorization", token)
      .send({
        rules: [
          { dayOfWeek: 1, startMinute: 480, endMinute: 1020, timezone: "UTC", sessionDurationMin: 30, bufferMin: 10 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.rules).toHaveLength(1);
    expect(await CoachAvailability.countDocuments({ coachId: coach._id })).toBe(1);

    const bad = await request(app)
      .put("/api/coach/availability")
      .set("Authorization", token)
      .send({ rules: [{ dayOfWeek: 1, startMinute: 600, endMinute: 500, timezone: "UTC" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_endMinute");

    // A second PUT with an empty array clears everything (whole-array replace).
    const cleared = await request(app).put("/api/coach/availability").set("Authorization", token).send({ rules: [] });
    expect(cleared.status).toBe(200);
    expect(await CoachAvailability.countDocuments({ coachId: coach._id })).toBe(0);
  });
});

describe("POST/DELETE /coach/availability/exceptions", () => {
  test("upserts one exception per date and deletes by id", async () => {
    const coach = await makeCoach("exc-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    const created = await request(app)
      .post("/api/coach/availability/exceptions")
      .set("Authorization", token)
      .send({ date: MONDAY, type: "unavailable", reason: "Holiday" });
    expect(created.status).toBe(201);
    expect(created.body.exception.type).toBe("unavailable");

    // Same date again — upserts in place, not a duplicate.
    const upserted = await request(app)
      .post("/api/coach/availability/exceptions")
      .set("Authorization", token)
      .send({ date: MONDAY, type: "custom_hours", startMinute: 600, endMinute: 720 });
    expect(upserted.status).toBe(201);
    expect(await request(app).get("/api/coach/availability/exceptions").set("Authorization", token).then((r) => r.body.exceptions.length)).toBe(1);

    const del = await request(app).delete(`/api/coach/availability/exceptions/${upserted.body.exception.id}`).set("Authorization", token);
    expect(del.status).toBe(200);
    expect(await request(app).get("/api/coach/availability/exceptions").set("Authorization", token).then((r) => r.body.exceptions.length)).toBe(0);
  });
});

describe("GET /athlete/coaches/:coachId/available-slots", () => {
  async function setup() {
    const coach = await makeCoach("slots-coach");
    const { user, profile } = await makeAthlete("slots-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    await CoachAvailability.create({
      coachId: coach._id,
      dayOfWeek: 1,
      startMinute: 480, // 08:00
      endMinute: 600, // 10:00
      timezone: "UTC",
      sessionDurationMin: 30,
      bufferMin: 0,
    });
    return { coach, user, profile };
  }

  test("returns discretized slots for a matching weekday, none for a non-matching weekday", async () => {
    const { coach, user } = await setup();
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const monday = await request(app).get(`/api/athlete/coaches/${coach._id.toString()}/available-slots?date=${MONDAY}`).set("Authorization", token);
    expect(monday.status).toBe(200);
    // 08:00-10:00 in 30-min increments = 4 slots.
    expect(monday.body.slots).toHaveLength(4);
    expect(new Date(monday.body.slots[0].start).toISOString()).toBe("2026-01-05T08:00:00.000Z");

    const tuesday = await request(app).get(`/api/athlete/coaches/${coach._id.toString()}/available-slots?date=${TUESDAY}`).set("Authorization", token);
    expect(tuesday.status).toBe(200);
    expect(tuesday.body.slots).toHaveLength(0);
  });

  test("a whole-day 'unavailable' exception removes every slot for that date", async () => {
    const { coach, user } = await setup();
    const { CoachAvailabilityException } = await import("../src/models/CoachAvailabilityException");
    await CoachAvailabilityException.create({ coachId: coach._id, date: new Date("2026-01-05T00:00:00Z"), type: "unavailable" });
    const app = buildApp();
    const res = await request(app)
      .get(`/api/athlete/coaches/${coach._id.toString()}/available-slots?date=${MONDAY}`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(0);
  });

  test("existing bookings are excluded from the returned slots", async () => {
    const { coach, user, profile } = await setup();
    await CoachSession.create({
      coachId: coach._id,
      athleteId: profile._id,
      relationshipId: new Types.ObjectId(),
      type: "general",
      scheduledStart: new Date("2026-01-05T08:00:00Z"),
      scheduledEnd: new Date("2026-01-05T08:30:00Z"),
      bufferMin: 0,
      status: "confirmed",
      events: [],
    });
    const app = buildApp();
    const res = await request(app)
      .get(`/api/athlete/coaches/${coach._id.toString()}/available-slots?date=${MONDAY}`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(3);
    expect(res.body.slots.some((s: { start: string }) => s.start === "2026-01-05T08:00:00.000Z")).toBe(false);
  });

  test("requires an active relationship with that specific coach", async () => {
    const { user } = await makeAthlete("no-relationship-athlete");
    const strangerCoach = await makeCoach("stranger-coach");
    const app = buildApp();
    const res = await request(app)
      .get(`/api/athlete/coaches/${strangerCoach._id.toString()}/available-slots?date=${MONDAY}`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_your_coach");
  });

  test("Phase 12: a coach with TWO recurring windows on the same day offers slots from BOTH (morning + evening block)", async () => {
    const coach = await makeCoach("multiwindow-coach");
    const { user, profile } = await makeAthlete("multiwindow-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 540, endMinute: 780, timezone: "UTC", sessionDurationMin: 30, bufferMin: 0 }); // 09:00-13:00
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 960, endMinute: 1200, timezone: "UTC", sessionDurationMin: 30, bufferMin: 0 }); // 16:00-20:00

    const res = await request(buildApp())
      .get(`/api/athlete/coaches/${coach._id.toString()}/available-slots?date=${MONDAY}`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    // 4 hours / 30min = 8 slots per window, two windows = 16 total.
    expect(res.body.slots).toHaveLength(16);
    const starts = res.body.slots.map((s: { start: string }) => s.start);
    expect(starts).toContain("2026-01-05T09:00:00.000Z"); // morning block
    expect(starts).toContain("2026-01-05T16:00:00.000Z"); // evening block
  });
});

describe("Phase 12: maxSessionsPerDay", () => {
  async function setupCapped(cap: number) {
    const coach = await makeCoach(`cap-coach-${cap}-${Date.now()}`);
    const { user, profile } = await makeAthlete(`cap-athlete-${cap}-${Date.now()}`);
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    await CoachAvailability.create({
      coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 720, timezone: "UTC",
      sessionDurationMin: 30, bufferMin: 0, maxSessionsPerDay: cap,
    });
    return { coach, user, profile };
  }

  test("resolveAvailableSlots trims the offered slot list to the remaining daily allowance", async () => {
    const { coach, user, profile } = await setupCapped(2);
    await CoachSession.create({
      coachId: coach._id, athleteId: profile._id, relationshipId: new Types.ObjectId(), type: "general",
      scheduledStart: new Date("2026-01-05T08:00:00Z"), scheduledEnd: new Date("2026-01-05T08:30:00Z"),
      bufferMin: 0, status: "confirmed", events: [],
    });

    const res = await request(buildApp())
      .get(`/api/athlete/coaches/${coach._id.toString()}/available-slots?date=${MONDAY}`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    // 8 raw half-hour slots in the window minus the 08:00 booking = 7
    // available, but the cap (2 total/day, 1 already booked) limits to 1.
    expect(res.body.slots).toHaveLength(1);
  });

  test("booking is rejected with max_sessions_per_day_reached once the cap is hit", async () => {
    const athleteSessionsRouter2 = (await import("../src/routes/athleteSessions")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/athlete", athleteSessionsRouter2);

    const { coach, user, profile } = await setupCapped(1);
    await CoachSession.create({
      coachId: coach._id, athleteId: profile._id, relationshipId: new Types.ObjectId(), type: "general",
      scheduledStart: new Date("2026-01-05T08:00:00Z"), scheduledEnd: new Date("2026-01-05T08:30:00Z"),
      bufferMin: 0, status: "confirmed", events: [],
    });

    const res = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T09:00:00.000Z" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("max_sessions_per_day_reached");
  });

  test("without maxSessionsPerDay set, booking is unaffected (no accidental cap introduced)", async () => {
    const athleteSessionsRouter2 = (await import("../src/routes/athleteSessions")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/athlete", athleteSessionsRouter2);

    const coach = await makeCoach("uncapped-coach");
    const { user, profile } = await makeAthlete("uncapped-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 720, timezone: "UTC", sessionDurationMin: 30, bufferMin: 0 });
    await CoachSession.create({
      coachId: coach._id, athleteId: profile._id, relationshipId: new Types.ObjectId(), type: "general",
      scheduledStart: new Date("2026-01-05T08:00:00Z"), scheduledEnd: new Date("2026-01-05T08:30:00Z"),
      bufferMin: 0, status: "confirmed", events: [],
    });

    const res = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T09:00:00.000Z" });
    expect(res.status).toBe(201);
  });
});
