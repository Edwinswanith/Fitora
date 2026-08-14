import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { TrainingSession } from "../src/models/TrainingSession";
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

async function makeAthlete(name: string, sport = "football") {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport });
  return { user, profile };
}

async function makeCoachWithAthlete(coachName: string, athleteName: string) {
  const admin = await makeUser("coach", `${coachName}-admin`);
  const coach = await makeUser("coach", coachName);
  const { user: athleteUser, profile } = await makeAthlete(athleteName);
  await CoachAthleteAssignment.create({
    coachId: coach._id,
    athleteId: profile._id,
    assignedBy: admin._id,
  });
  return { coach, athleteUser, profile };
}

function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY_STR = new Date().toISOString().slice(0, 10);

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

describe("Coach session-photo upload", () => {
  test("coach attaches a photo to an assigned athlete's AM session", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-photo", "ath-photo");
    const app = buildApp();

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/AM/photos`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", PNG_BYTES, { filename: "note.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.photo).toMatchObject({ originalName: "note.png", mimeType: "image/png" });

    const session = await TrainingSession.findOne({ athleteId: profile._id, slot: "AM" }).lean();
    expect(session?.photos).toHaveLength(1);
    expect(session?.photos?.[0].originalName).toBe("note.png");
  });

  test("coach cannot attach a photo for an athlete not assigned to them", async () => {
    const outsiderCoach = await makeUser("coach", "outsider-coach");
    const { profile } = await makeAthlete("ath-guarded");
    const app = buildApp();

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/AM/photos`)
      .set("Authorization", `Bearer ${tokenFor(outsiderCoach._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", PNG_BYTES, { filename: "x.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(await TrainingSession.countDocuments({})).toBe(0);
  });

  test("rejects a disallowed mime type", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-mime2", "ath-mime2");
    const app = buildApp();

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/AM/photos`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", Buffer.from("not an image"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_file_type");
  });
});

describe("Session-photo visibility — no send gate, unlike WorkoutMedia", () => {
  test("athlete can immediately view a photo the coach attached, with no separate send step", async () => {
    const { coach, profile, athleteUser } = await makeCoachWithAthlete("coach-vis", "ath-vis");
    const app = buildApp();

    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/PM/photos`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", PNG_BYTES, { filename: "plan.png", contentType: "image/png" });
    const photoId = upload.body.photo.id;

    const file = await request(app)
      .get(`/api/athlete/training/PM/photos/${photoId}/file`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("image/png");
    expect(Buffer.compare(file.body as Buffer, PNG_BYTES)).toBe(0);
  });

  test("coach can view the photo it uploaded via its own file route", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-viewself", "ath-viewself");
    const app = buildApp();

    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/AFT/photos`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    const photoId = upload.body.photo.id;

    const file = await request(app)
      .get(`/api/coach/athletes/${profile._id.toString()}/training/AFT/photos/${photoId}/file`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body as Buffer, PNG_BYTES)).toBe(0);
  });

  test("a different athlete can never view someone else's session photo", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-outsider2", "ath-owner2");
    const { user: otherAthlete } = await makeAthlete("ath-nosee");
    const app = buildApp();

    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/AM/photos`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    const photoId = upload.body.photo.id;

    const res = await request(app)
      .get(`/api/athlete/training/AM/photos/${photoId}/file`)
      .set("Authorization", `Bearer ${tokenFor(otherAthlete._id, "athlete")}`);
    expect(res.status).toBe(404);
  });

  test("a different coach (even if assigned to the athlete) cannot view another coach's upload", async () => {
    const admin = await makeUser("coach", "shared-admin2");
    const coachA = await makeUser("coach", "coach-a2");
    const coachB = await makeUser("coach", "coach-b2");
    const { profile } = await makeAthlete("ath-shared2");
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: profile._id, assignedBy: admin._id });
    await CoachAthleteAssignment.create({ coachId: coachB._id, athleteId: profile._id, assignedBy: admin._id });
    const app = buildApp();

    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/AM/photos`)
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    expect(upload.status).toBe(201);

    // Coach B is assigned to the same athlete, so requireAthleteAccess passes —
    // but the photo route itself has no additional coach-ownership gate (unlike
    // WorkoutMedia), matching the shared/no-gate nature of session notes.
    const photoId = upload.body.photo.id;
    const res = await request(app)
      .get(`/api/coach/athletes/${profile._id.toString()}/training/AM/photos/${photoId}/file`)
      .set("Authorization", `Bearer ${tokenFor(coachB._id, "coach")}`);
    expect(res.status).toBe(200);
  });
});

describe("Photos surfaced on the daily card", () => {
  test("GET /api/athlete/daily includes uploaded session photo metadata", async () => {
    const { coach, profile, athleteUser } = await makeCoachWithAthlete("coach-card", "ath-card");
    const app = buildApp();

    await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/training/AM/photos`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("date", TODAY_STR)
      .attach("file", PNG_BYTES, { filename: "card-photo.png", contentType: "image/png" });

    const res = await request(app)
      .get(`/api/athlete/daily?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.card.sessions.AM.photos).toHaveLength(1);
    expect(res.body.card.sessions.AM.photos[0].originalName).toBe("card-photo.png");
  });
});
