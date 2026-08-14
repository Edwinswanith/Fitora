import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import tourRouter from "../src/routes/tour";
import { signAccessToken } from "../src/lib/tokens";
import { setTourNarratorForTests, MockTourNarrator, type TourNarrator } from "../src/services/tourNarrator";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/tour", tourRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete" | "guardian", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

function tokenFor(userId: Types.ObjectId, role: "coach" | "athlete" | "guardian") {
  return signAccessToken({ sub: userId.toString(), role });
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
  setTourNarratorForTests(new MockTourNarrator());
});

afterEach(() => {
  setTourNarratorForTests(null);
});

describe("POST /api/tour/narrate — access", () => {
  test("rejects unauthenticated requests", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/tour/narrate")
      .send({ stepId: "athlete-hero", title: "Readiness", fallbackNote: "Your daily readiness ring." });
    expect(res.status).toBe(401);
  });

  test.each(["coach", "athlete", "guardian"] as const)("allows a %s to call it (no requireRole gate)", async (role) => {
    const app = buildApp();
    const user = await makeUser(role, `${role}-user`);
    const token = tokenFor(user._id as Types.ObjectId, role);
    const res = await request(app)
      .post("/api/tour/narrate")
      .set("Cookie", [`accessToken=${token}`])
      .send({ stepId: "step-1", title: "Squad readiness", fallbackNote: "See your whole squad at a glance." });
    expect(res.status).toBe(200);
    expect(res.body.note).toBe("See your whole squad at a glance.");
  });
});

describe("POST /api/tour/narrate — contract", () => {
  test("mock narrator returns the fallback note verbatim", async () => {
    const app = buildApp();
    const user = await makeUser("athlete", "Arjun");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/tour/narrate")
      .set("Cookie", [`accessToken=${token}`])
      .send({ stepId: "athlete-hero", title: "Readiness", fallbackNote: "Your daily readiness ring." });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: "Your daily readiness ring." });
  });

  test("rejects a missing stepId/title/fallbackNote", async () => {
    const app = buildApp();
    const user = await makeUser("athlete", "Bala");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");

    const missingStepId = await request(app)
      .post("/api/tour/narrate")
      .set("Cookie", [`accessToken=${token}`])
      .send({ title: "Readiness", fallbackNote: "Your daily readiness ring." });
    expect(missingStepId.status).toBe(400);

    const missingTitle = await request(app)
      .post("/api/tour/narrate")
      .set("Cookie", [`accessToken=${token}`])
      .send({ stepId: "athlete-hero", fallbackNote: "Your daily readiness ring." });
    expect(missingTitle.status).toBe(400);

    const missingFallback = await request(app)
      .post("/api/tour/narrate")
      .set("Cookie", [`accessToken=${token}`])
      .send({ stepId: "athlete-hero", title: "Readiness" });
    expect(missingFallback.status).toBe(400);
  });

  test("falls back to the fallbackNote when the narrator throws", async () => {
    const app = buildApp();
    const user = await makeUser("coach", "Coach Kumar");
    const token = tokenFor(user._id as Types.ObjectId, "coach");
    const throwing: TourNarrator = {
      narrate: async () => {
        throw new Error("boom");
      },
    };
    setTourNarratorForTests(throwing);
    const res = await request(app)
      .post("/api/tour/narrate")
      .set("Cookie", [`accessToken=${token}`])
      .send({ stepId: "coach-kpi", title: "Squad KPIs", fallbackNote: "Athletes, present, and readiness at a glance." });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: "Athletes, present, and readiness at a glance." });
  });
});
