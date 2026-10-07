import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachProfile } from "../src/models/CoachProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachJoinRequest } from "../src/models/CoachJoinRequest";
import { athleteJoinRequestsRouter, coachJoinRequestsRouter } from "../src/routes/coachJoinRequests";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteJoinRequestsRouter);
  app.use("/api/coach", coachJoinRequestsRouter);
  return app;
}

const token = (userId: Types.ObjectId, role: "coach" | "athlete") => `Bearer ${signAccessToken({ sub: userId.toString(), role })}`;

async function makeCoach(name: string, listed = true) {
  const coach = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
  await CoachProfile.create({ userId: coach._id, active: listed });
  return coach;
}

async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "football" });
  return { user, profile };
}

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

describe("request to join a coach", () => {
  test("athlete requests, coach sees it, accepts, and the relationship becomes active", async () => {
    const app = buildApp();
    const coach = await makeCoach("coach-a");
    const { user, profile } = await makeAthlete("athlete-a");

    const created = await request(app)
      .post(`/api/athlete/coaches/${coach._id}/join-request`)
      .set("Authorization", token(user._id, "athlete"))
      .send({ message: "Training for a marathon" });
    expect(created.status).toBe(201);
    expect(created.body.request).toMatchObject({ status: "pending", message: "Training for a marathon", coach: { name: "coach-a" } });

    const list = await request(app).get("/api/coach/join-requests").set("Authorization", token(coach._id, "coach"));
    expect(list.status).toBe(200);
    expect(list.body.requests).toHaveLength(1);
    expect(list.body.requests[0].athlete).toMatchObject({ name: "athlete-a", sport: "football" });
    expect(list.body.requests[0].athlete).not.toHaveProperty("email");

    const accepted = await request(app)
      .post(`/api/coach/join-requests/${created.body.request.id}/accept`)
      .set("Authorization", token(coach._id, "coach"));
    expect(accepted.status).toBe(200);
    expect(accepted.body.request.status).toBe("accepted");
    expect(await CoachAthleteAssignment.countDocuments({ coachId: coach._id, athleteId: profile._id, status: "active" })).toBe(1);

    const again = await request(app)
      .post(`/api/coach/join-requests/${created.body.request.id}/accept`)
      .set("Authorization", token(coach._id, "coach"));
    expect(again.status).toBe(404);
  });

  test("only one pending request per athlete, and an unlisted coach can't be asked", async () => {
    const app = buildApp();
    const coachA = await makeCoach("coach-b1");
    const coachB = await makeCoach("coach-b2");
    const hidden = await makeCoach("coach-hidden", false);
    const { user } = await makeAthlete("athlete-b");
    const auth = token(user._id, "athlete");

    expect((await request(app).post(`/api/athlete/coaches/${hidden._id}/join-request`).set("Authorization", auth)).status).toBe(404);
    expect((await request(app).post(`/api/athlete/coaches/${coachA._id}/join-request`).set("Authorization", auth)).status).toBe(201);
    const second = await request(app).post(`/api/athlete/coaches/${coachB._id}/join-request`).set("Authorization", auth);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("request_pending");
  });

  test("a coach can't act on another coach's request; decline closes it and the athlete can cancel theirs", async () => {
    const app = buildApp();
    const coach = await makeCoach("coach-c");
    const other = await makeCoach("coach-c-other");
    const { user } = await makeAthlete("athlete-c");

    const created = await request(app).post(`/api/athlete/coaches/${coach._id}/join-request`).set("Authorization", token(user._id, "athlete"));
    const id = created.body.request.id;

    expect((await request(app).post(`/api/coach/join-requests/${id}/accept`).set("Authorization", token(other._id, "coach"))).status).toBe(404);
    expect((await request(app).get("/api/coach/join-requests").set("Authorization", token(other._id, "coach"))).body.requests).toHaveLength(0);

    const declined = await request(app).post(`/api/coach/join-requests/${id}/decline`).set("Authorization", token(coach._id, "coach"));
    expect(declined.body.request.status).toBe("declined");
    const latest = await request(app).get("/api/athlete/join-request").set("Authorization", token(user._id, "athlete"));
    expect(latest.body.request.status).toBe("declined");

    const retry = await request(app).post(`/api/athlete/coaches/${coach._id}/join-request`).set("Authorization", token(user._id, "athlete"));
    expect(retry.status).toBe(201);
    const cancelled = await request(app).post(`/api/athlete/join-request/${retry.body.request.id}/cancel`).set("Authorization", token(user._id, "athlete"));
    expect(cancelled.body.request.status).toBe("cancelled");
  });

  test("an athlete with a coach can't request; a request made stale by another coach is closed, not shown", async () => {
    const app = buildApp();
    const coach = await makeCoach("coach-d");
    const other = await makeCoach("coach-d-other");
    const { user, profile } = await makeAthlete("athlete-d");

    const created = await request(app).post(`/api/athlete/coaches/${coach._id}/join-request`).set("Authorization", token(user._id, "athlete"));
    expect(created.status).toBe(201);

    // The athlete gets linked by another coach while the request is pending.
    await CoachAthleteAssignment.create({ coachId: other._id, athleteId: profile._id, assignedBy: other._id });

    const list = await request(app).get("/api/coach/join-requests").set("Authorization", token(coach._id, "coach"));
    expect(list.body.requests).toHaveLength(0);
    expect((await CoachJoinRequest.findById(created.body.request.id).lean())?.status).toBe("cancelled");

    const blocked = await request(app).post(`/api/athlete/coaches/${coach._id}/join-request`).set("Authorization", token(user._id, "athlete"));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("already_has_coach");
  });

  test("accept fails cleanly if the athlete got a coach between listing and accepting", async () => {
    const app = buildApp();
    const coach = await makeCoach("coach-e");
    const other = await makeCoach("coach-e-other");
    const { user, profile } = await makeAthlete("athlete-e");

    const created = await request(app).post(`/api/athlete/coaches/${coach._id}/join-request`).set("Authorization", token(user._id, "athlete"));
    await CoachAthleteAssignment.create({ coachId: other._id, athleteId: profile._id, assignedBy: other._id });

    const accepted = await request(app).post(`/api/coach/join-requests/${created.body.request.id}/accept`).set("Authorization", token(coach._id, "coach"));
    expect(accepted.status).toBe(409);
    expect(accepted.body.error).toBe("athlete_has_active_coach");
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile._id, status: "active" })).toBe(1);
  });

  test("roles are enforced: athletes can't use coach routes and vice versa", async () => {
    const app = buildApp();
    const coach = await makeCoach("coach-f");
    const { user } = await makeAthlete("athlete-f");
    expect((await request(app).get("/api/coach/join-requests").set("Authorization", token(user._id, "athlete"))).status).toBe(403);
    expect((await request(app).post(`/api/athlete/coaches/${coach._id}/join-request`).set("Authorization", token(coach._id, "coach"))).status).toBe(403);
  });
});
