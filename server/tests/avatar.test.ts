import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import authRouter from "../src/routes/auth";
import avatarRouter from "../src/routes/avatar";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/me", avatarRouter);
  app.use("/api/coach", coachRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete" | "guardian", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

function tokenFor(userId: Types.ObjectId, role: "coach" | "athlete" | "guardian") {
  return signAccessToken({ sub: userId.toString(), role });
}

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009077" +
    "53de0000000a49444154789c6300010000050001a5f645400000000049454e" +
    "44ae426082",
  "hex"
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
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

describe("Profile avatar — every role manages their own the same way", () => {
  test.each(["coach", "athlete", "guardian"] as const)(
    "%s can upload a photo, view it, then switch to a default badge",
    async (role) => {
      const user = await makeUser(role, `${role}-avatar`);
      const app = buildApp();
      const token = tokenFor(user._id, role);

      const upload = await request(app)
        .post("/api/me/avatar")
        .set("Authorization", `Bearer ${token}`)
        .attach("file", PNG_BYTES, { filename: "me.png", contentType: "image/png" });
      expect(upload.status).toBe(201);
      expect(upload.body.avatar).toEqual({ kind: "photo", defaultId: null });

      const file = await request(app)
        .get("/api/me/avatar/file")
        .set("Authorization", `Bearer ${token}`);
      expect(file.status).toBe(200);
      expect(file.headers["content-type"]).toContain("image/png");
      expect(Buffer.compare(file.body as Buffer, PNG_BYTES)).toBe(0);

      const switched = await request(app)
        .post("/api/me/avatar/default")
        .set("Authorization", `Bearer ${token}`)
        .send({ defaultId: "female-2" });
      expect(switched.status).toBe(200);
      expect(switched.body.avatar).toEqual({ kind: "default", defaultId: "female-2" });

      // Old photo file is gone once replaced by a default badge.
      const fileAfter = await request(app)
        .get("/api/me/avatar/file")
        .set("Authorization", `Bearer ${token}`);
      expect(fileAfter.status).toBe(404);
    }
  );

  test("rejects an unknown default badge id", async () => {
    const user = await makeUser("athlete", "ath-bad-default");
    const app = buildApp();
    const res = await request(app)
      .post("/api/me/avatar/default")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ defaultId: "robot-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_default_id");
  });

  test("rejects a disallowed mime type on upload", async () => {
    const user = await makeUser("athlete", "ath-bad-mime");
    const app = buildApp();
    const res = await request(app)
      .post("/api/me/avatar")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .attach("file", Buffer.from("not an image"), { filename: "x.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_file_type");
  });

  test("DELETE clears the avatar back to initials-fallback state", async () => {
    const user = await makeUser("guardian", "guardian-clear");
    const app = buildApp();
    const token = tokenFor(user._id, "guardian");
    await request(app)
      .post("/api/me/avatar/default")
      .set("Authorization", `Bearer ${token}`)
      .send({ defaultId: "male-1" });

    const res = await request(app).delete("/api/me/avatar").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.avatar).toEqual({ kind: null, defaultId: null });
  });

  test("without any avatar set, the file route 404s", async () => {
    const user = await makeUser("coach", "coach-none");
    const app = buildApp();
    const res = await request(app)
      .get("/api/me/avatar/file")
      .set("Authorization", `Bearer ${tokenFor(user._id, "coach")}`);
    expect(res.status).toBe(404);
  });

  test("a user can never fetch a DIFFERENT user's avatar photo via this endpoint", async () => {
    const owner = await makeUser("athlete", "ath-owner-avatar");
    const outsider = await makeUser("athlete", "ath-outsider-avatar");
    const app = buildApp();
    await request(app)
      .post("/api/me/avatar")
      .set("Authorization", `Bearer ${tokenFor(owner._id, "athlete")}`)
      .attach("file", PNG_BYTES, { filename: "me.png", contentType: "image/png" });

    // The route is self-scoped (reads req.actor.userId only) — there's no
    // parameterized "other user" variant to even attempt, but confirm the
    // outsider's own (unset) avatar file lookup 404s rather than somehow
    // returning the owner's photo.
    const res = await request(app)
      .get("/api/me/avatar/file")
      .set("Authorization", `Bearer ${tokenFor(outsider._id, "athlete")}`);
    expect(res.status).toBe(404);
  });

  test("login response includes the avatar summary", async () => {
    const passwordHash = await import("bcryptjs").then((b) => b.hash("Pass@1234", 10));
    const user = await User.create({
      email: "avatar-login@test.io",
      passwordHash,
      role: "athlete",
      name: "Avatar Login",
    });
    const app = buildApp();
    const token = tokenFor(user._id, "athlete");
    await request(app)
      .post("/api/me/avatar/default")
      .set("Authorization", `Bearer ${token}`)
      .send({ defaultId: "male-2" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "avatar-login@test.io", password: "Pass@1234" });
    expect(res.status).toBe(200);
    expect(res.body.user.avatar).toEqual({ kind: "default", defaultId: "male-2" });
  });
});

describe("Coach viewing an assigned athlete's avatar", () => {
  async function makeAssignedAthlete(coachName: string, athleteName: string) {
    const admin = await User.create({ email: `${coachName}-admin@test.io`, passwordHash: "x", role: "coach", name: `${coachName}-admin` });
    const coach = await User.create({ email: `${coachName}@test.io`, passwordHash: "x", role: "coach", name: coachName });
    const athleteUser = await User.create({ email: `${athleteName}@test.io`, passwordHash: "x", role: "athlete", name: athleteName });
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "football" });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: admin._id });
    return { coach, athleteUser, profile };
  }

  test("roster includes each athlete's avatar summary", async () => {
    const { coach, athleteUser, profile } = await makeAssignedAthlete("coach-roster", "athlete-roster");
    const app = buildApp();
    await request(app)
      .post("/api/me/avatar/default")
      .set("Authorization", `Bearer ${signAccessToken({ sub: athleteUser._id.toString(), role: "athlete" })}`)
      .send({ defaultId: "female-1" });

    const res = await request(app)
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${signAccessToken({ sub: coach._id.toString(), role: "coach" })}`);
    expect(res.status).toBe(200);
    const entry = res.body.athletes.find((a: { athleteId: string }) => a.athleteId === profile._id.toString());
    expect(entry.avatar).toEqual({ kind: "default", defaultId: "female-1" });
  });

  test("assigned coach can view the athlete's uploaded photo", async () => {
    const { coach, athleteUser, profile } = await makeAssignedAthlete("coach-photo", "athlete-photo");
    const app = buildApp();
    await request(app)
      .post("/api/me/avatar")
      .set("Authorization", `Bearer ${signAccessToken({ sub: athleteUser._id.toString(), role: "athlete" })}`)
      .attach("file", PNG_BYTES, { filename: "me.png", contentType: "image/png" });

    const res = await request(app)
      .get(`/api/coach/athletes/${profile._id.toString()}/avatar/file`)
      .set("Authorization", `Bearer ${signAccessToken({ sub: coach._id.toString(), role: "coach" })}`);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });

  test("an unassigned coach is forbidden from viewing the athlete's photo", async () => {
    const { athleteUser, profile } = await makeAssignedAthlete("coach-scoped", "athlete-scoped");
    const outsiderCoach = await User.create({ email: "outsider-coach@test.io", passwordHash: "x", role: "coach", name: "Outsider Coach" });
    const app = buildApp();
    await request(app)
      .post("/api/me/avatar")
      .set("Authorization", `Bearer ${signAccessToken({ sub: athleteUser._id.toString(), role: "athlete" })}`)
      .attach("file", PNG_BYTES, { filename: "me.png", contentType: "image/png" });

    const res = await request(app)
      .get(`/api/coach/athletes/${profile._id.toString()}/avatar/file`)
      .set("Authorization", `Bearer ${signAccessToken({ sub: outsiderCoach._id.toString(), role: "coach" })}`);
    expect(res.status).toBe(403);
  });
});
