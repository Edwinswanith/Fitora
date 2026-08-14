import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
import { ExerciseMedia } from "../src/models/ExerciseMedia";
import coachWorkoutRouter from "../src/routes/coachWorkout";
import athleteWorkoutRouter from "../src/routes/athleteWorkout";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachWorkoutRouter);
  app.use("/api/athlete", athleteWorkoutRouter);
  return app;
}
async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}
function tokenFor(id: Types.ObjectId, role: "coach" | "athlete") {
  return signAccessToken({ sub: id.toString(), role });
}
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

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

describe("Coach exercise-media upload", () => {
  test("coach uploads a demo image; owns it; can retrieve the file", async () => {
    const coach = await makeUser("coach", "media-coach");
    const app = buildApp();
    const upload = await request(app)
      .post("/api/coach/exercise-media")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .attach("file", PNG_BYTES, { filename: "squat.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    expect(upload.body.media.kind).toBe("image");
    expect(upload.body.media.coachId).toBe(coach._id.toString());

    const file = await request(app)
      .get(`/api/coach/exercise-media/${upload.body.media.id}/file`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(file.status).toBe(200);
  });

  test("rejects an unsupported mime type", async () => {
    const coach = await makeUser("coach", "media-coach2");
    const res = await request(buildApp())
      .post("/api/coach/exercise-media")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .attach("file", Buffer.from("not a media file"), { filename: "evil.exe", contentType: "application/octet-stream" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_file_type");
  });

  test("a different coach cannot view or delete media they don't own", async () => {
    const owner = await makeUser("coach", "media-owner");
    const intruder = await makeUser("coach", "media-intruder");
    const app = buildApp();
    const upload = await request(app)
      .post("/api/coach/exercise-media")
      .set("Authorization", `Bearer ${tokenFor(owner._id, "coach")}`)
      .attach("file", PNG_BYTES, { filename: "demo.png", contentType: "image/png" });

    const view = await request(app)
      .get(`/api/coach/exercise-media/${upload.body.media.id}/file`)
      .set("Authorization", `Bearer ${tokenFor(intruder._id, "coach")}`);
    expect(view.status).toBe(404);

    const del = await request(app)
      .delete(`/api/coach/exercise-media/${upload.body.media.id}`)
      .set("Authorization", `Bearer ${tokenFor(intruder._id, "coach")}`);
    expect(del.status).toBe(404);
    expect(await ExerciseMedia.countDocuments({})).toBe(1);
  });

  test("deleting media that's referenced by a template is blocked (409 media_in_use)", async () => {
    const coach = await makeUser("coach", "inuse-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const upload = await request(app)
      .post("/api/coach/exercise-media")
      .set("Authorization", token)
      .attach("file", PNG_BYTES, { filename: "demo.png", contentType: "image/png" });
    await WorkoutTemplate.create({
      ownerId: coach._id,
      ownerRole: "coach",
      name: "Uses it",
      exercises: [{ title: "Squat", type: "checklist", mediaId: upload.body.media.id, order: 0 }],
    });

    const del = await request(app).delete(`/api/coach/exercise-media/${upload.body.media.id}`).set("Authorization", token);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("media_in_use");
  });
});

describe("Athlete access to exercise media — authorized only through an actual assignment", () => {
  async function setupAssignedWithMedia() {
    const coach = await makeUser("coach", "video-coach");
    const athleteUser = await makeUser("athlete", "video-athlete");
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });
    const app = buildApp();
    const upload = await request(app)
      .post("/api/coach/exercise-media")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .attach("file", PNG_BYTES, { filename: "demo.png", contentType: "image/png" });
    const template = await WorkoutTemplate.create({
      ownerId: coach._id,
      ownerRole: "coach",
      name: "Has video",
      exercises: [{ title: "Goblet Squat", type: "checklist", mediaId: upload.body.media.id, order: 0 }],
    });
    return { app, coach, athleteUser, profile, template, mediaId: upload.body.media.id as string };
  }

  test("athlete WITHOUT an assignment referencing the media is denied (403), even though the exercise/template exists", async () => {
    const { app, athleteUser, mediaId } = await setupAssignedWithMedia();
    const res = await request(app)
      .get(`/api/athlete/exercise-media/${mediaId}/file`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_authorized");
  });

  test("athlete WITH an assignment referencing the media can view it after being assigned the workout", async () => {
    const { app, coach, athleteUser, profile, template, mediaId } = await setupAssignedWithMedia();
    await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-08-14" });

    const res = await request(app)
      .get(`/api/athlete/exercise-media/${mediaId}/file`)
      .set("Authorization", `Bearer ${tokenFor(athleteUser._id, "athlete")}`);
    expect(res.status).toBe(200);
  });

  test("an unrelated athlete (never assigned anything referencing this media) is denied", async () => {
    const { app, coach, profile, template, mediaId } = await setupAssignedWithMedia();
    await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-08-14" });

    const stranger = await makeUser("athlete", "unrelated-athlete");
    await AthleteProfile.create({ userId: stranger._id, sport: "general" });
    const res = await request(app)
      .get(`/api/athlete/exercise-media/${mediaId}/file`)
      .set("Authorization", `Bearer ${tokenFor(stranger._id, "athlete")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_authorized");
  });
});
