import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { CoachVideo } from "../src/models/CoachVideo";
import { CoachVideoProgress } from "../src/models/CoachVideoProgress";
import coachVideosRouter from "../src/routes/coachVideos";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachVideosRouter);
  return app;
}
async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}
function tokenFor(id: Types.ObjectId, role: "coach") {
  return signAccessToken({ sub: id.toString(), role });
}
const FAKE_MP4 = Buffer.from("not a real mp4 but multer/fileFilter only checks content-type", "utf8");

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

describe("POST /coach/videos (upload)", () => {
  test("coach uploads a video with required fields, defaults to private visibility", async () => {
    const coach = await makeCoach("upload-coach");
    const res = await request(buildApp())
      .post("/api/coach/videos")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("title", "Mobility Flow")
      .field("category", "mobility")
      .attach("file", FAKE_MP4, { filename: "flow.mp4", contentType: "video/mp4" });

    expect(res.status).toBe(201);
    expect(res.body.video.title).toBe("Mobility Flow");
    expect(res.body.video.category).toBe("mobility");
    expect(res.body.video.visibility).toBe("private");
    expect(res.body.video.coachId).toBe(coach._id.toString());
  });

  test("rejects an unsupported file type", async () => {
    const coach = await makeCoach("bad-type-coach");
    const res = await request(buildApp())
      .post("/api/coach/videos")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("title", "Bad")
      .field("category", "mobility")
      .attach("file", Buffer.from("evil"), { filename: "evil.exe", contentType: "application/octet-stream" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_file_type");
  });

  test("rejects a missing title or invalid category", async () => {
    const coach = await makeCoach("missing-title-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    const noTitle = await request(app).post("/api/coach/videos").set("Authorization", token).field("category", "mobility").attach("file", FAKE_MP4, { filename: "x.mp4", contentType: "video/mp4" });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error).toBe("invalid_title");

    const badCategory = await request(app).post("/api/coach/videos").set("Authorization", token).field("title", "X").field("category", "not_a_real_category").attach("file", FAKE_MP4, { filename: "x.mp4", contentType: "video/mp4" });
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.error).toBe("invalid_category");
  });
});

describe("PATCH /coach/videos/:id", () => {
  async function uploadOne(coach: Awaited<ReturnType<typeof makeCoach>>) {
    const res = await request(buildApp())
      .post("/api/coach/videos")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("title", "Original")
      .field("category", "mobility")
      .attach("file", FAKE_MP4, { filename: "x.mp4", contentType: "video/mp4" });
    return res.body.video.id as string;
  }

  test("updates title/description/category/visibility/selectedClientIds", async () => {
    const coach = await makeCoach("patch-coach");
    const videoId = await uploadOne(coach);
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const clientId = new Types.ObjectId().toString();

    const res = await request(app).patch(`/api/coach/videos/${videoId}`).set("Authorization", token).send({
      title: "Renamed",
      description: "New desc",
      category: "full_workout",
      visibility: "selected_clients",
      selectedClientIds: [clientId],
    });
    expect(res.status).toBe(200);
    expect(res.body.video.title).toBe("Renamed");
    expect(res.body.video.visibility).toBe("selected_clients");
    expect(res.body.video.selectedClientIds).toEqual([clientId]);
  });

  test("rejects an invalid visibility value", async () => {
    const coach = await makeCoach("patch-bad-coach");
    const videoId = await uploadOne(coach);
    const res = await request(buildApp()).patch(`/api/coach/videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`).send({ visibility: "everyone" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_visibility");
  });

  test("a different coach cannot patch someone else's video", async () => {
    const owner = await makeCoach("owner-coach");
    const intruder = await makeCoach("intruder-coach");
    const videoId = await uploadOne(owner);
    const res = await request(buildApp()).patch(`/api/coach/videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(intruder._id, "coach")}`).send({ title: "Hijacked" });
    expect(res.status).toBe(404);
  });
});

describe("archive/unarchive and delete", () => {
  async function uploadOne(coach: Awaited<ReturnType<typeof makeCoach>>) {
    const res = await request(buildApp())
      .post("/api/coach/videos")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("title", "Archivable")
      .field("category", "mobility")
      .attach("file", FAKE_MP4, { filename: "x.mp4", contentType: "video/mp4" });
    return res.body.video.id as string;
  }

  test("archive hides from the default list; unarchive restores it", async () => {
    const coach = await makeCoach("archive-coach");
    const videoId = await uploadOne(coach);
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    await request(app).post(`/api/coach/videos/${videoId}/archive`).set("Authorization", token);
    const listAfterArchive = await request(app).get("/api/coach/videos").set("Authorization", token);
    expect(listAfterArchive.body.videos).toHaveLength(0);
    const listIncludingArchived = await request(app).get("/api/coach/videos?includeArchived=1").set("Authorization", token);
    expect(listIncludingArchived.body.videos).toHaveLength(1);

    await request(app).post(`/api/coach/videos/${videoId}/unarchive`).set("Authorization", token);
    const listAfterUnarchive = await request(app).get("/api/coach/videos").set("Authorization", token);
    expect(listAfterUnarchive.body.videos).toHaveLength(1);
  });

  test("delete removes the document and any progress rows", async () => {
    const coach = await makeCoach("delete-coach");
    const videoId = await uploadOne(coach);
    await CoachVideoProgress.create({ videoId, athleteId: new Types.ObjectId(), status: "viewed", progressPercent: 40, lastPositionSec: 120 });

    const res = await request(buildApp()).delete(`/api/coach/videos/${videoId}`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(await CoachVideo.countDocuments({ _id: videoId })).toBe(0);
    expect(await CoachVideoProgress.countDocuments({ videoId })).toBe(0);
  });
});

describe("GET /coach/videos/:id/stream (coach preview)", () => {
  test("coach can stream their own upload", async () => {
    const coach = await makeCoach("stream-coach");
    const upload = await request(buildApp())
      .post("/api/coach/videos")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .field("title", "Streamable")
      .field("category", "mobility")
      .attach("file", FAKE_MP4, { filename: "x.mp4", contentType: "video/mp4" });

    const res = await request(buildApp()).get(`/api/coach/videos/${upload.body.video.id}/stream`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe(FAKE_MP4.toString());
  });
});
