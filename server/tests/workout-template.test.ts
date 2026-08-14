import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
import { ExerciseMedia } from "../src/models/ExerciseMedia";
import workoutTemplatesRouter from "../src/routes/workoutTemplates";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/workout-templates", workoutTemplatesRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}
function tokenFor(id: Types.ObjectId, role: "coach" | "athlete") {
  return signAccessToken({ sub: id.toString(), role });
}

const validExercises = [
  { title: "Bench Press", type: "sets_reps", sets: 4, reps: "10" },
  { title: "Plank", type: "duration", durationSec: 60 },
];

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

describe("POST /api/workout-templates", () => {
  test("coach creates a template with mixed exercise types; order derived from array position", async () => {
    const coach = await makeUser("coach", "kumar");
    const app = buildApp();
    const res = await request(app)
      .post("/api/workout-templates")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ name: "Push Day", description: "Chest/shoulders/triceps", exercises: validExercises });

    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe("Push Day");
    expect(res.body.template.ownerRole).toBe("coach");
    expect(res.body.template.version).toBe(1);
    expect(res.body.template.exercises).toHaveLength(2);
    expect(res.body.template.exercises[0].order).toBe(0);
    expect(res.body.template.exercises[1].order).toBe(1);
  });

  test("athlete can self-author a template too (standalone use, no coach required)", async () => {
    const athlete = await makeUser("athlete", "solo");
    const res = await request(buildApp())
      .post("/api/workout-templates")
      .set("Authorization", `Bearer ${tokenFor(athlete._id, "athlete")}`)
      .send({ name: "My Morning Routine", exercises: [{ title: "Squats", type: "checklist" }] });
    expect(res.status).toBe(201);
    expect(res.body.template.ownerRole).toBe("athlete");
  });

  test("rejects empty exercises array, invalid exercise type, and oversized name", async () => {
    const coach = await makeUser("coach", "kumar2");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    const noExercises = await request(app).post("/api/workout-templates").set("Authorization", token).send({ name: "X", exercises: [] });
    expect(noExercises.status).toBe(400);
    expect(noExercises.body.error).toBe("exercises_required");

    const badType = await request(app)
      .post("/api/workout-templates")
      .set("Authorization", token)
      .send({ name: "X", exercises: [{ title: "Y", type: "not_a_real_type" }] });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toBe("invalid_exercise_type");

    const badName = await request(app)
      .post("/api/workout-templates")
      .set("Authorization", token)
      .send({ name: "x".repeat(161), exercises: validExercises });
    expect(badName.status).toBe(400);
    expect(badName.body.error).toBe("invalid_name");
  });

  test("rejects an exercise mediaId the coach doesn't own", async () => {
    const coach = await makeUser("coach", "kumar3");
    const otherCoach = await makeUser("coach", "other3");
    const foreignMedia = await ExerciseMedia.create({
      coachId: otherCoach._id,
      originalName: "demo.mp4",
      storedFilename: "abc.mp4",
      mimeType: "video/mp4",
      kind: "video",
      sizeBytes: 1000,
    });

    const res = await request(buildApp())
      .post("/api/workout-templates")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({
        name: "Stolen media",
        exercises: [{ title: "Squat", type: "checklist", mediaId: foreignMedia._id.toString() }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("media_not_owned");
  });
});

describe("PATCH /api/workout-templates/:id — ownership + versioning", () => {
  test("editing exercises bumps version; editing only name/description does not", async () => {
    const coach = await makeUser("coach", "verkumar");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const created = await request(app)
      .post("/api/workout-templates")
      .set("Authorization", token)
      .send({ name: "V1", exercises: validExercises });
    const id = created.body.template.id;

    const renamed = await request(app)
      .patch(`/api/workout-templates/${id}`)
      .set("Authorization", token)
      .send({ description: "just a description tweak" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.template.version).toBe(1);

    const edited = await request(app)
      .patch(`/api/workout-templates/${id}`)
      .set("Authorization", token)
      .send({ exercises: [{ title: "Bench Press", type: "sets_reps", sets: 5, reps: "8" }] });
    expect(edited.status).toBe(200);
    expect(edited.body.template.version).toBe(2);
    expect(edited.body.template.exercises).toHaveLength(1);
  });

  test("a coach cannot edit or archive another coach's template", async () => {
    const owner = await makeUser("coach", "realowner");
    const intruder = await makeUser("coach", "intruder");
    const app = buildApp();
    const created = await request(app)
      .post("/api/workout-templates")
      .set("Authorization", `Bearer ${tokenFor(owner._id, "coach")}`)
      .send({ name: "Mine", exercises: validExercises });
    const id = created.body.template.id;

    const patch = await request(app)
      .patch(`/api/workout-templates/${id}`)
      .set("Authorization", `Bearer ${tokenFor(intruder._id, "coach")}`)
      .send({ name: "Hijacked" });
    expect(patch.status).toBe(403);
    expect(patch.body.error).toBe("not_template_owner");

    const archive = await request(app)
      .post(`/api/workout-templates/${id}/archive`)
      .set("Authorization", `Bearer ${tokenFor(intruder._id, "coach")}`);
    expect(archive.status).toBe(403);

    expect((await WorkoutTemplate.findById(id))!.name).toBe("Mine");
  });
});

describe("Archive / unarchive", () => {
  test("archived templates are excluded from the default list but visible with includeArchived=1", async () => {
    const coach = await makeUser("coach", "archcoach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const created = await request(app).post("/api/workout-templates").set("Authorization", token).send({ name: "Old plan", exercises: validExercises });
    await request(app).post(`/api/workout-templates/${created.body.template.id}/archive`).set("Authorization", token);

    const defaultList = await request(app).get("/api/workout-templates").set("Authorization", token);
    expect(defaultList.body.templates).toHaveLength(0);

    const withArchived = await request(app).get("/api/workout-templates?includeArchived=1").set("Authorization", token);
    expect(withArchived.body.templates).toHaveLength(1);
    expect(withArchived.body.templates[0].isArchived).toBe(true);
  });
});
