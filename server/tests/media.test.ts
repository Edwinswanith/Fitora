import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { WorkoutMedia } from "../src/models/WorkoutMedia";
import athleteRouter from "../src/routes/athlete";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";
import {
  setWorkoutImageConverterForTests,
  MockWorkoutImageConverter,
  type WorkoutImageConverter,
} from "../src/services/workoutImageConverter";

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
  // Tests must never depend on ambient env (GEMINI_API_KEY may or may not be
  // configured locally) — force the deterministic mock explicitly every time.
  setWorkoutImageConverterForTests(new MockWorkoutImageConverter());
});

describe("Coach media upload", () => {
  test("coach uploads an image for an assigned athlete", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-up", "ath-up");
    const app = buildApp();

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "session.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.media).toMatchObject({
      athleteId: profile._id.toString(),
      context: "workout",
      originalName: "session.png",
      mimeType: "image/png",
      sent: false,
      sentAt: null,
    });
    expect(res.body.media.conversion.status).toBe("none");

    const stored = await WorkoutMedia.countDocuments({ athleteId: profile._id });
    expect(stored).toBe(1);
  });

  test("coach cannot upload for an athlete not assigned to them", async () => {
    const coachAdmin = await makeUser("coach", "outsider-admin");
    const outsiderCoach = await makeUser("coach", "outsider");
    const { profile } = await makeAthlete("ath-guarded");
    void coachAdmin;

    const app = buildApp();
    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(outsiderCoach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "x.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(await WorkoutMedia.countDocuments({})).toBe(0);
  });

  test("rejects a disallowed mime type", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-mime", "ath-mime");
    const app = buildApp();

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", Buffer.from("not an image"), {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_file_type");
    expect(await WorkoutMedia.countDocuments({})).toBe(0);
  });

  test("rejects an invalid context value and deletes the orphaned upload", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-ctx", "ath-ctx");
    const app = buildApp();

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "not_a_real_context")
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_context");
    expect(await WorkoutMedia.countDocuments({})).toBe(0);
  });
});

describe("Coach media ownership and file access", () => {
  async function uploadOne(app: express.Express, coachId: Types.ObjectId, athleteId: Types.ObjectId) {
    const res = await request(app)
      .post(`/api/coach/athletes/${athleteId.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coachId, "coach")}`)
      .field("context", "athlete")
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    return res.body.media as { id: string };
  }

  test("another coach assigned to the SAME athlete still cannot access the first coach's media", async () => {
    const admin = await makeUser("coach", "shared-admin");
    const coachA = await makeUser("coach", "coach-a-shared");
    const coachB = await makeUser("coach", "coach-b-shared");
    const { profile } = await makeAthlete("ath-shared");
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: profile._id, assignedBy: admin._id });
    await CoachAthleteAssignment.create({ coachId: coachB._id, athleteId: profile._id, assignedBy: admin._id });

    const app = buildApp();
    const media = await uploadOne(app, coachA._id, profile._id);

    const res = await request(app)
      .get(`/api/coach/media/${media.id}`)
      .set("Authorization", `Bearer ${tokenFor(coachB._id, "coach")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_media_owner");
  });

  test("coach can stream back the raw file bytes it uploaded", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-file", "ath-file");
    const app = buildApp();
    const media = await uploadOne(app, coach._id, profile._id);

    const res = await request(app)
      .get(`/api/coach/media/${media.id}/file`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(Buffer.compare(res.body as Buffer, PNG_BYTES)).toBe(0);
  });
});

describe("Sending media to the athlete", () => {
  test("athlete cannot see an uploaded-but-unsent image", async () => {
    const { coach, profile, athleteUser } = await makeCoachWithAthlete("coach-send1", "ath-send1");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "athlete")
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;

    const list = await request(app)
      .get("/api/athlete/media")
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(list.body.media).toEqual([]);

    const get = await request(app)
      .get(`/api/athlete/media/${mediaId}`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(get.status).toBe(404);

    const file = await request(app)
      .get(`/api/athlete/media/${mediaId}/file`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(file.status).toBe(404);
  });

  test("sending flips visibility — athlete can then list, view, and download it", async () => {
    const { coach, profile, athleteUser } = await makeCoachWithAthlete("coach-send2", "ath-send2");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "training_plan")
      .attach("file", PNG_BYTES, { filename: "plan.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;

    const send = await request(app)
      .post(`/api/coach/media/${mediaId}/send`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ caption: "Here's today's plan" });
    expect(send.status).toBe(200);
    expect(send.body.media.sent).toBe(true);
    expect(send.body.media.sentAt).not.toBeNull();
    expect(send.body.message).toMatchObject({
      senderRole: "coach",
      body: "Here's today's plan",
      media: { id: mediaId },
    });

    const list = await request(app)
      .get("/api/athlete/media")
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(list.body.media).toHaveLength(1);
    expect(list.body.media[0].id).toBe(mediaId);

    const file = await request(app)
      .get(`/api/athlete/media/${mediaId}/file`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body as Buffer, PNG_BYTES)).toBe(0);
  });

  test("sending posts the image into the coach<->athlete chat thread for both sides", async () => {
    const { coach, profile, athleteUser } = await makeCoachWithAthlete("coach-chat", "ath-chat");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "w.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;
    await request(app)
      .post(`/api/coach/media/${mediaId}/send`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const coachThread = await request(app)
      .get(`/api/coach/athletes/${profile._id.toString()}/messages`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(coachThread.body.messages).toHaveLength(1);
    expect(coachThread.body.messages[0].media.id).toBe(mediaId);
    expect(coachThread.body.messages[0].mine).toBe(true);

    const athleteThread = await request(app)
      .get(`/api/athlete/messages/${coach._id.toString()}`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(athleteThread.body.messages).toHaveLength(1);
    expect(athleteThread.body.messages[0].media.id).toBe(mediaId);
    expect(athleteThread.body.messages[0].mine).toBe(false);
    expect(athleteThread.body.messages[0].media.conversion.status).toBe("none");
  });

  test("plain text messages still carry media: null", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-plain", "ath-plain");
    const app = buildApp();
    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/messages`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ body: "hello" });
    expect(res.status).toBe(201);
    expect(res.body.message.media).toBeNull();
  });

  test("a different athlete can never see media sent to someone else", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-send3", "ath-send3");
    const { user: otherAthlete } = await makeAthlete("ath-outsider");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "athlete")
      .attach("file", PNG_BYTES, { filename: "a.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;
    await request(app)
      .post(`/api/coach/media/${mediaId}/send`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const res = await request(app)
      .get(`/api/athlete/media/${mediaId}`)
      .set("Authorization", `Bearer ${tokenFor(otherAthlete._id, "athlete")}`);
    expect(res.status).toBe(404);
  });
});

describe("Workout image → structured table conversion", () => {
  test("mock converter produces a structured table with the required columns", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-conv", "ath-conv");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "w.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;

    const res = await request(app)
      .post(`/api/coach/media/${mediaId}/convert`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    expect(res.status).toBe(200);
    expect(res.body.media.conversion.status).toBe("completed");
    expect(res.body.media.conversion.table.length).toBeGreaterThan(0);
    for (const row of res.body.media.conversion.table) {
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("sets");
      expect(row).toHaveProperty("reps");
      expect(row).toHaveProperty("distance");
      expect(row).toHaveProperty("duration");
      expect(row).toHaveProperty("intensity");
      expect(row).toHaveProperty("notes");
    }
  });

  test("a failing converter records conversion.status = failed without throwing", async () => {
    const failing: WorkoutImageConverter = {
      async convert() {
        throw new Error("boom");
      },
    };
    setWorkoutImageConverterForTests(failing);

    const { coach, profile } = await makeCoachWithAthlete("coach-fail", "ath-fail");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "w.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;

    const res = await request(app)
      .post(`/api/coach/media/${mediaId}/convert`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    expect(res.status).toBe(200);
    expect(res.body.media.conversion.status).toBe("failed");
    expect(res.body.media.conversion.error).toBe("boom");
  });
});

describe("Coach edits an extracted table before sending", () => {
  test("coach can overwrite the table with manual corrections", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-edit", "ath-edit");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "w.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;

    const res = await request(app)
      .patch(`/api/coach/media/${mediaId}/table`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({
        table: [
          { name: "Stretching", sets: "1", reps: "-", duration: "5 min", notes: "  " },
          { name: "  " }, // dropped — no usable name
          { sets: "3" }, // dropped — no name at all
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.media.conversion.status).toBe("completed");
    expect(res.body.media.conversion.table).toEqual([
      { name: "Stretching", sets: "1", reps: "-", duration: "5 min" },
    ]);
  });

  test("rejects edits once the media has already been sent to the athlete", async () => {
    const { coach, profile } = await makeCoachWithAthlete("coach-edit-sent", "ath-edit-sent");
    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "w.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;
    await request(app)
      .post(`/api/coach/media/${mediaId}/send`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const res = await request(app)
      .patch(`/api/coach/media/${mediaId}/table`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ table: [{ name: "Late edit" }] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_sent");
  });

  test("another coach cannot edit a table they don't own", async () => {
    const admin = await makeUser("coach", "edit-outsider-admin");
    const coachA = await makeUser("coach", "edit-owner");
    const outsiderCoach = await makeUser("coach", "edit-outsider");
    const { profile } = await makeAthlete("ath-edit-guarded");
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: profile._id, assignedBy: admin._id });

    const app = buildApp();
    const upload = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/media`)
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`)
      .field("context", "workout")
      .attach("file", PNG_BYTES, { filename: "w.png", contentType: "image/png" });
    const mediaId = upload.body.media.id;

    const res = await request(app)
      .patch(`/api/coach/media/${mediaId}/table`)
      .set("Authorization", `Bearer ${tokenFor(outsiderCoach._id, "coach")}`)
      .send({ table: [{ name: "Hack" }] });

    expect(res.status).toBe(403);
  });
});
