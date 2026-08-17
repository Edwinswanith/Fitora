import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachProfile } from "../src/models/CoachProfile";
import coachReviewsRouter from "../src/routes/coachReviews";
import marketplaceRouter from "../src/routes/marketplace";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", coachReviewsRouter);
  app.use("/api/marketplace", marketplaceRouter);
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
async function endedRelationship(coachId: Types.ObjectId, athleteId: Types.ObjectId) {
  return CoachAthleteAssignment.create({ coachId, athleteId, assignedBy: coachId, status: "ended", endedAt: new Date(), endedReason: "athlete_left" });
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

describe("POST /athlete/coach-reviews", () => {
  test("blocked while the relationship is still active", async () => {
    const coach = await makeCoach("active-rel-coach");
    const { user, profile } = await makeAthlete("active-rel-athlete");
    const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

    const res = await request(buildApp())
      .post("/api/athlete/coach-reviews")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ relationshipId: relationship._id.toString(), overallRating: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("relationship_not_ended");
  });

  test("allowed once the relationship has ended; recomputes CoachProfile's aggregate", async () => {
    const coach = await makeCoach("ended-rel-coach");
    const { user, profile } = await makeAthlete("ended-rel-athlete");
    const relationship = await endedRelationship(coach._id, profile._id);

    const res = await request(buildApp())
      .post("/api/athlete/coach-reviews")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ relationshipId: relationship._id.toString(), overallRating: 4, subRatings: { communication: 5, knowledge: 3 }, body: "Solid coach" });
    expect(res.status).toBe(201);
    expect(res.body.review.overallRating).toBe(4);
    expect(res.body.review.subRatings.communication).toBe(5);

    const profileDoc = await CoachProfile.findOne({ userId: coach._id }).lean();
    expect(profileDoc?.avgRating).toBe(4);
    expect(profileDoc?.reviewCount).toBe(1);
  });

  test("one review per relationship — duplicate attempt is rejected", async () => {
    const coach = await makeCoach("dup-review-coach");
    const { user, profile } = await makeAthlete("dup-review-athlete");
    const relationship = await endedRelationship(coach._id, profile._id);
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const first = await request(app).post("/api/athlete/coach-reviews").set("Authorization", token).send({ relationshipId: relationship._id.toString(), overallRating: 5 });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/athlete/coach-reviews").set("Authorization", token).send({ relationshipId: relationship._id.toString(), overallRating: 2 });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_reviewed");
  });

  test("cannot review someone else's relationship", async () => {
    const coach = await makeCoach("owner-review-coach");
    const { profile: ownerProfile } = await makeAthlete("owner-review-athlete");
    const { user: intruderUser } = await makeAthlete("intruder-review-athlete");
    const relationship = await endedRelationship(coach._id, ownerProfile._id);

    const res = await request(buildApp())
      .post("/api/athlete/coach-reviews")
      .set("Authorization", `Bearer ${tokenFor(intruderUser._id, "athlete")}`)
      .send({ relationshipId: relationship._id.toString(), overallRating: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_your_relationship");
  });

  test("rejects an out-of-range rating and a client-injected aggregate field is simply ignored (no such field is ever accepted)", async () => {
    const coach = await makeCoach("fuzz-coach");
    const { user, profile } = await makeAthlete("fuzz-athlete");
    const relationship = await endedRelationship(coach._id, profile._id);

    const badRating = await request(buildApp())
      .post("/api/athlete/coach-reviews")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ relationshipId: relationship._id.toString(), overallRating: 7 });
    expect(badRating.status).toBe(400);
    expect(badRating.body.error).toBe("invalid_overallRating");

    // A client trying to directly plant a fake CoachProfile aggregate via the review body — ignored, no such field is read.
    const res = await request(buildApp())
      .post("/api/athlete/coach-reviews")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ relationshipId: relationship._id.toString(), overallRating: 3, avgRating: 5, reviewCount: 999 });
    expect(res.status).toBe(201);
    const profileDoc = await CoachProfile.findOne({ userId: coach._id }).lean();
    expect(profileDoc?.avgRating).toBe(3);
    expect(profileDoc?.reviewCount).toBe(1);
  });

  test("a coach token cannot post a review (athlete-only route)", async () => {
    const coach = await makeCoach("gate-coach");
    const res = await request(buildApp())
      .post("/api/athlete/coach-reviews")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ relationshipId: new Types.ObjectId().toString(), overallRating: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_role");
  });
});

describe("PATCH /athlete/coach-reviews/:id", () => {
  test("edits in place and sets editedAt; recomputes the aggregate across multiple reviewers correctly", async () => {
    const coach = await makeCoach("edit-coach");
    const { user: userA, profile: profileA } = await makeAthlete("edit-athlete-a");
    const { user: userB, profile: profileB } = await makeAthlete("edit-athlete-b");
    const relA = await endedRelationship(coach._id, profileA._id);
    const relB = await endedRelationship(coach._id, profileB._id);
    const app = buildApp();

    const reviewA = await request(app).post("/api/athlete/coach-reviews").set("Authorization", `Bearer ${tokenFor(userA._id, "athlete")}`).send({ relationshipId: relA._id.toString(), overallRating: 5 });
    await request(app).post("/api/athlete/coach-reviews").set("Authorization", `Bearer ${tokenFor(userB._id, "athlete")}`).send({ relationshipId: relB._id.toString(), overallRating: 3 });

    let profileDoc = await CoachProfile.findOne({ userId: coach._id }).lean();
    expect(profileDoc?.avgRating).toBe(4); // (5+3)/2
    expect(profileDoc?.reviewCount).toBe(2);

    const edited = await request(app)
      .patch(`/api/athlete/coach-reviews/${reviewA.body.review.id}`)
      .set("Authorization", `Bearer ${tokenFor(userA._id, "athlete")}`)
      .send({ overallRating: 1, body: "Changed my mind" });
    expect(edited.status).toBe(200);
    expect(edited.body.review.overallRating).toBe(1);
    expect(edited.body.review.editedAt).not.toBeNull();

    profileDoc = await CoachProfile.findOne({ userId: coach._id }).lean();
    expect(profileDoc?.avgRating).toBe(2); // (1+3)/2
    expect(profileDoc?.reviewCount).toBe(2); // count unchanged, edit not a new review
  });

  test("cannot edit someone else's review", async () => {
    const coach = await makeCoach("edit-owner-coach");
    const { user: ownerUser, profile: ownerProfile } = await makeAthlete("edit-owner-athlete");
    const { user: intruderUser } = await makeAthlete("edit-intruder-athlete");
    const relationship = await endedRelationship(coach._id, ownerProfile._id);
    const app = buildApp();

    const review = await request(app).post("/api/athlete/coach-reviews").set("Authorization", `Bearer ${tokenFor(ownerUser._id, "athlete")}`).send({ relationshipId: relationship._id.toString(), overallRating: 5 });
    const res = await request(app).patch(`/api/athlete/coach-reviews/${review.body.review.id}`).set("Authorization", `Bearer ${tokenFor(intruderUser._id, "athlete")}`).send({ overallRating: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_your_review");
  });
});

describe("GET /marketplace/coaches/:coachId/reviews", () => {
  test("returns paginated public reviews, newest first", async () => {
    const coach = await makeCoach("public-reviews-coach");
    const { user: userA, profile: profileA } = await makeAthlete("public-review-athlete-a");
    const { user: userB, profile: profileB } = await makeAthlete("public-review-athlete-b");
    const relA = await endedRelationship(coach._id, profileA._id);
    const relB = await endedRelationship(coach._id, profileB._id);
    const app = buildApp();

    await request(app).post("/api/athlete/coach-reviews").set("Authorization", `Bearer ${tokenFor(userA._id, "athlete")}`).send({ relationshipId: relA._id.toString(), overallRating: 4, body: "First" });
    await request(app).post("/api/athlete/coach-reviews").set("Authorization", `Bearer ${tokenFor(userB._id, "athlete")}`).send({ relationshipId: relB._id.toString(), overallRating: 5, body: "Second" });

    const res = await request(app).get(`/api/marketplace/coaches/${coach._id.toString()}/reviews`).set("Authorization", `Bearer ${tokenFor(userA._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.reviews[0].body).toBe("Second"); // newest first
    expect(res.body.reviews[1].body).toBe("First");
  });
});
