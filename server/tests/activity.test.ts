import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { Attendance } from "../src/models/Attendance";
import { TrainingSession } from "../src/models/TrainingSession";
import { Recovery } from "../src/models/Recovery";
import { CoachComment } from "../src/models/CoachComment";
import { buildActivityFeed } from "../src/services/activity";
import athleteRouter from "../src/routes/athlete";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  app.use("/api/coach", coachRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}
async function makeAthlete(name: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "athletics" });
  return { user, profile };
}
function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
);

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

describe("buildActivityFeed", () => {
  test("merges sources, drops planned-only sessions, sorts newest-first, bands set", async () => {
    const { profile } = await makeAthlete("feed-a");
    await Attendance.create({ athleteId: profile._id, date: TODAY, status: "present" });
    await TrainingSession.create({ athleteId: profile._id, date: TODAY, slot: "AM", type: "strength", status: "completed" });
    await TrainingSession.create({ athleteId: profile._id, date: TODAY, slot: "PM", type: "skill", status: "planned" });
    await Recovery.create({ athleteId: profile._id, date: TODAY, status: "green", modalities: ["ice_bath"] });

    const feed = await buildActivityFeed(profile._id, 40);
    const kinds = feed.map((f) => f.kind);
    expect(kinds).toContain("attendance");
    expect(kinds).toContain("session");
    expect(kinds).toContain("recovery");

    // Planned-only PM session is excluded; only the completed AM session appears.
    const sessions = feed.filter((f) => f.kind === "session");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].band).toBe("green");

    // Sorted newest-first.
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1].at >= feed[i].at).toBe(true);
    }

    // limit is respected.
    const limited = await buildActivityFeed(profile._id, 2);
    expect(limited.length).toBeLessThanOrEqual(2);
  });
});

describe("GET /api/athlete/activity (self)", () => {
  test("returns the caller's own feed", async () => {
    const { user, profile } = await makeAthlete("self-feed");
    await Attendance.create({ athleteId: profile._id, date: TODAY, status: "late" });
    const res = await request(buildApp())
      .get("/api/athlete/activity")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].kind).toBe("attendance");
  });
});

describe("GET /api/coach/athletes/:id/activity (scoped)", () => {
  test("assigned coach → 200 incl. their comment; unassigned → 403", async () => {
    const admin = await makeUser("coach", "ad");
    const coachA = await makeUser("coach", "kumar");
    const coachB = await makeUser("coach", "singh");
    const { profile } = await makeAthlete("scoped-feed");
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: profile._id, assignedBy: admin._id });
    await CoachComment.create({ athleteId: profile._id, coachId: coachA._id, date: TODAY, body: "Nice work." });
    const app = buildApp();

    const ok = await request(app)
      .get(`/api/coach/athletes/${profile._id}/activity`)
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`);
    expect(ok.status).toBe(200);
    expect(ok.body.items.some((i: { kind: string; detail?: string }) => i.kind === "comment" && i.detail === "Nice work.")).toBe(true);

    const denied = await request(app)
      .get(`/api/coach/athletes/${profile._id}/activity`)
      .set("Authorization", `Bearer ${tokenFor(coachB._id, "coach")}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("not_in_assignments");
  });
});
