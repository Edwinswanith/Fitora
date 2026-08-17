import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachProfile } from "../src/models/CoachProfile";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import coachProfileRouter from "../src/routes/coachProfile";
import marketplaceRouter from "../src/routes/marketplace";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachProfileRouter);
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

describe("Coach self-service profile", () => {
  test("GET lazily creates a profile on first access; no backfill migration needed", async () => {
    const coach = await makeCoach("lazy-coach");
    const res = await request(buildApp()).get("/api/coach/profile").set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.active).toBe(false); // never auto-listed
    expect(await CoachProfile.countDocuments({})).toBe(1);
  });

  test("PATCH updates bio/specializations/etc; validates arrays and numeric ranges", async () => {
    const coach = await makeCoach("edit-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const res = await request(app).patch("/api/coach/profile").set("Authorization", token).send({
      bio: "Strength & conditioning coach",
      yearsExperience: 8,
      specializations: ["strength", "mobility"],
      languages: ["en", "es"],
      coachingTypes: ["online"],
      nutritionSupport: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.specializations).toEqual(["strength", "mobility"]);
    expect(res.body.profile.nutritionSupport).toBe(true);

    const badYears = await request(app).patch("/api/coach/profile").set("Authorization", token).send({ yearsExperience: 100 });
    expect(badYears.status).toBe(400);
    expect(badYears.body.error).toBe("invalid_yearsExperience");
  });

  test("activate/deactivate toggles marketplace visibility — opt-in, never automatic", async () => {
    const coach = await makeCoach("toggle-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    await request(app).get("/api/coach/profile").set("Authorization", token);
    expect((await CoachProfile.findOne({ userId: coach._id }))!.active).toBe(false);

    await request(app).post("/api/coach/profile/activate").set("Authorization", token);
    expect((await CoachProfile.findOne({ userId: coach._id }))!.active).toBe(true);

    await request(app).post("/api/coach/profile/deactivate").set("Authorization", token);
    expect((await CoachProfile.findOne({ userId: coach._id }))!.active).toBe(false);
  });
});

describe("Coach pricing plans", () => {
  test("create + versioning: price edit bumps version, description-only edit does not", async () => {
    const coach = await makeCoach("price-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const created = await request(app).post("/api/coach/pricing-plans").set("Authorization", token).send({ name: "Basic", monthlyPrice: 49, currency: "usd", liveSessionsPerCycle: 2 });
    expect(created.status).toBe(201);
    expect(created.body.pricingPlan.currency).toBe("USD");
    expect(created.body.pricingPlan.version).toBe(1);

    const descOnly = await request(app).patch(`/api/coach/pricing-plans/${created.body.pricingPlan.id}`).set("Authorization", token).send({ description: "tweak" });
    expect(descOnly.body.pricingPlan.version).toBe(1);

    const priceEdit = await request(app).patch(`/api/coach/pricing-plans/${created.body.pricingPlan.id}`).set("Authorization", token).send({ monthlyPrice: 59 });
    expect(priceEdit.body.pricingPlan.version).toBe(2);
  });

  test("a coach cannot edit another coach's pricing plan", async () => {
    const owner = await makeCoach("pp-owner");
    const intruder = await makeCoach("pp-intruder");
    const app = buildApp();
    const created = await request(app).post("/api/coach/pricing-plans").set("Authorization", `Bearer ${tokenFor(owner._id, "coach")}`).send({ name: "Pro", monthlyPrice: 99, currency: "USD" });

    const res = await request(app).patch(`/api/coach/pricing-plans/${created.body.pricingPlan.id}`).set("Authorization", `Bearer ${tokenFor(intruder._id, "coach")}`).send({ monthlyPrice: 1 });
    expect(res.status).toBe(404);
  });

  test("invalid currency and negative price are rejected", async () => {
    const coach = await makeCoach("badinput-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const badCurrency = await request(app).post("/api/coach/pricing-plans").set("Authorization", token).send({ name: "X", monthlyPrice: 10, currency: "US" });
    expect(badCurrency.status).toBe(400);
    const badPrice = await request(app).post("/api/coach/pricing-plans").set("Authorization", token).send({ name: "X", monthlyPrice: -5, currency: "USD" });
    expect(badPrice.status).toBe(400);
  });
});

describe("Marketplace discovery — visible to ANY authenticated User, no coach relationship needed", () => {
  async function makeActiveCoach(name: string, opts: { specializations?: string[]; yearsExperience?: number; avgRating?: number; price?: number; nutritionSupport?: boolean; coachingTypes?: string[]; languages?: string[] } = {}) {
    const coach = await makeCoach(name);
    await CoachProfile.create({
      userId: coach._id,
      active: true,
      specializations: opts.specializations ?? [],
      yearsExperience: opts.yearsExperience,
      avgRating: opts.avgRating ?? null,
      nutritionSupport: opts.nutritionSupport ?? false,
      coachingTypes: opts.coachingTypes ?? [],
      languages: opts.languages ?? [],
    });
    if (opts.price !== undefined) {
      await CoachPricingPlan.create({ coachId: coach._id, name: "Basic", monthlyPrice: opts.price, currency: "USD", active: true });
    }
    return coach;
  }

  test("an athlete with NO coach can browse the marketplace", async () => {
    await makeActiveCoach("browse-coach", { specializations: ["strength"] });
    const { user } = await makeAthlete("browse-athlete");
    const res = await request(buildApp()).get("/api/marketplace/coaches").set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.coaches).toHaveLength(1);
  });

  test("a coach who never activated is invisible in the listing and 404s on detail view", async () => {
    const inactive = await makeCoach("inactive-coach");
    await CoachProfile.create({ userId: inactive._id, active: false });
    const { user } = await makeAthlete("visibility-athlete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const list = await request(app).get("/api/marketplace/coaches").set("Authorization", token);
    expect(list.body.coaches).toHaveLength(0);

    const detail = await request(app).get(`/api/marketplace/coaches/${inactive._id}`).set("Authorization", token);
    expect(detail.status).toBe(404);
    expect(detail.body.error).toBe("coach_not_found");
  });

  test("public detail view never leaks email, academyId, or other private fields", async () => {
    const coach = await makeActiveCoach("private-coach", { specializations: ["strength"] });
    const { user } = await makeAthlete("privacy-athlete");
    const res = await request(buildApp()).get(`/api/marketplace/coaches/${coach._id}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.profile);
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("academyId");
    expect(keys).not.toContain("isAcademyOwner");
    expect(keys).not.toContain("passwordHash");
    expect(keys).not.toContain("mustChangePassword");
  });

  test("only ACTIVE pricing plans are shown publicly", async () => {
    const coach = await makeActiveCoach("plan-visibility-coach");
    await CoachPricingPlan.create({ coachId: coach._id, name: "Retired Plan", monthlyPrice: 10, currency: "USD", active: false });
    await CoachPricingPlan.create({ coachId: coach._id, name: "Current Plan", monthlyPrice: 20, currency: "USD", active: true });
    const { user } = await makeAthlete("plan-visibility-athlete");
    const res = await request(buildApp()).get(`/api/marketplace/coaches/${coach._id}`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.body.profile.pricingPlans).toHaveLength(1);
    expect(res.body.profile.pricingPlans[0].name).toBe("Current Plan");
  });

  test("filters: specialization, minExperience, minRating, nutritionSupport, coachingType all narrow the results", async () => {
    await makeActiveCoach("filter-strength", { specializations: ["strength"], yearsExperience: 10, avgRating: 4.8, nutritionSupport: true, coachingTypes: ["online"] });
    await makeActiveCoach("filter-yoga", { specializations: ["yoga"], yearsExperience: 2, avgRating: 3.5, nutritionSupport: false, coachingTypes: ["in_person"] });
    const { user } = await makeAthlete("filter-athlete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const bySpecialization = await request(app).get("/api/marketplace/coaches?specialization=strength").set("Authorization", token);
    expect(bySpecialization.body.coaches).toHaveLength(1);
    expect(bySpecialization.body.coaches[0].specializations).toContain("strength");

    const byExperience = await request(app).get("/api/marketplace/coaches?minExperience=5").set("Authorization", token);
    expect(byExperience.body.coaches).toHaveLength(1);

    const byRating = await request(app).get("/api/marketplace/coaches?minRating=4").set("Authorization", token);
    expect(byRating.body.coaches).toHaveLength(1);

    const byNutrition = await request(app).get("/api/marketplace/coaches?nutritionSupport=true").set("Authorization", token);
    expect(byNutrition.body.coaches).toHaveLength(1);

    const byType = await request(app).get("/api/marketplace/coaches?coachingType=in_person").set("Authorization", token);
    expect(byType.body.coaches).toHaveLength(1);
    expect(byType.body.coaches[0].coachingTypes).toContain("in_person");
  });

  test("maxPrice filters correctly WITH accurate pagination totals (filter applied before skip/limit, not after)", async () => {
    await makeActiveCoach("cheap-coach", { price: 20 });
    await makeActiveCoach("mid-coach", { price: 50 });
    await makeActiveCoach("expensive-coach", { price: 200 });
    const { user } = await makeAthlete("price-athlete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const res = await request(app).get("/api/marketplace/coaches?maxPrice=60").set("Authorization", token);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // total reflects the price filter, not the unfiltered count
    expect(res.body.coaches).toHaveLength(2);
    expect(res.body.coaches.every((c: { startingPrice: { amount: number } | null }) => c.startingPrice === null || c.startingPrice.amount <= 60)).toBe(true);
  });

  test("pagination: page/limit respected, total reflects the full filtered count", async () => {
    for (let i = 0; i < 5; i++) {
      await makeActiveCoach(`page-coach-${i}`, { specializations: ["general"] });
    }
    const { user } = await makeAthlete("page-athlete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const page1 = await request(app).get("/api/marketplace/coaches?limit=2&page=1").set("Authorization", token);
    expect(page1.body.coaches).toHaveLength(2);
    expect(page1.body.total).toBe(5);

    const page3 = await request(app).get("/api/marketplace/coaches?limit=2&page=3").set("Authorization", token);
    expect(page3.body.coaches).toHaveLength(1); // last partial page
  });

  test("avatar file route 404s for a coach who hasn't opted into the marketplace", async () => {
    const inactive = await makeCoach("no-avatar-coach");
    await CoachProfile.create({ userId: inactive._id, active: false });
    const { user } = await makeAthlete("avatar-athlete");
    const res = await request(buildApp()).get(`/api/marketplace/coaches/${inactive._id}/avatar/file`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(404);
  });

  test("a COACH can also browse the marketplace (e.g. to see peers/competition) — not athlete-only", async () => {
    await makeActiveCoach("peer-coach", { specializations: ["strength"] });
    const viewingCoach = await makeCoach("viewing-coach");
    const res = await request(buildApp()).get("/api/marketplace/coaches").set("Authorization", `Bearer ${tokenFor(viewingCoach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.coaches).toHaveLength(1);
  });
});
