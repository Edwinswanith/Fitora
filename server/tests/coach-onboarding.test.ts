import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import authRouter, { __resetLoginRateLimit } from "../src/routes/auth";
import coachRouter from "../src/routes/coach";
import athleteRouter from "../src/routes/athlete";
import guardianRouter from "../src/routes/guardian";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteRouter);
  app.use("/api/guardian", guardianRouter);
  return app;
}

async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}

function coachToken(userId: Types.ObjectId) {
  return signAccessToken({ sub: userId.toString(), role: "coach" });
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
  __resetLoginRateLimit();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

describe("Coach-led athlete onboarding", () => {
  test("creates athlete + profile + assignment, returns temp password; athlete can log in and is on the roster", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);

    const res = await request(app)
      .post("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "New Athlete", email: "New.Athlete@Acme.test", sport: "athletics", position: "sprinter" });

    expect(res.status).toBe(201);
    expect(typeof res.body.tempPassword).toBe("string");
    expect(res.body.tempPassword.length).toBeGreaterThanOrEqual(8);
    expect(res.body.athlete.email).toBe("new.athlete@acme.test"); // normalized
    expect(res.body.athlete.sport).toBe("athletics");

    // Data layer: User (athlete) + AthleteProfile + active assignment to this coach
    const user = await User.findOne({ email: "new.athlete@acme.test" }).lean();
    expect(user?.role).toBe("athlete");
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(profile?.sport).toBe("athletics");
    const assignment = await CoachAthleteAssignment.findOne({
      coachId: coach._id,
      athleteId: profile!._id,
      endedAt: null,
    }).lean();
    expect(assignment).toBeTruthy();

    // The new athlete can immediately log in with the temp password…
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "new.athlete@acme.test", password: res.body.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("athlete");

    // …and reach their own workspace
    const me = await request(app)
      .get("/api/athlete/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);

    // …and shows up on the coach's roster
    const roster = await request(app)
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`);
    expect(roster.status).toBe(200);
    expect(roster.body.athletes.map((a: { email: string }) => a.email)).toContain(
      "new.athlete@acme.test"
    );
  });

  test("duplicate email → 409", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);
    const body = { name: "Dup", email: "dup@acme.test", sport: "football" };

    const first = await request(app).post("/api/coach/athletes").set("Authorization", `Bearer ${token}`).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/coach/athletes").set("Authorization", `Bearer ${token}`).send(body);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("email_already_exists");
  });

  test("missing name / email / sport → 400", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);

    const noName = await request(app).post("/api/coach/athletes").set("Authorization", `Bearer ${token}`).send({ email: "a@b.co", sport: "x" });
    expect(noName.status).toBe(400);
    const badEmail = await request(app).post("/api/coach/athletes").set("Authorization", `Bearer ${token}`).send({ name: "A", email: "nope", sport: "x" });
    expect(badEmail.status).toBe(400);
    const noSport = await request(app).post("/api/coach/athletes").set("Authorization", `Bearer ${token}`).send({ name: "A", email: "a@b.co" });
    expect(noSport.status).toBe(400);
  });

  test("coach-created athlete is flagged mustChangePassword; changing it clears the flag and the new password works", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);

    const created = await request(app)
      .post("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Temp Pwd Athlete", email: "tmp@acme.test", sport: "football" });
    const temp = created.body.tempPassword as string;

    const login = await request(app).post("/api/auth/login").send({ email: "tmp@acme.test", password: temp });
    expect(login.body.user.mustChangePassword).toBe(true);
    const athleteToken = login.body.accessToken as string;

    // Wrong current password → 401
    const wrong = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${athleteToken}`)
      .send({ currentPassword: "nope", newPassword: "BrandNewPass1" });
    expect(wrong.status).toBe(401);

    // Too short → 400
    const weak = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${athleteToken}`)
      .send({ currentPassword: temp, newPassword: "short" });
    expect(weak.status).toBe(400);

    // Valid change → flag cleared
    const ok = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${athleteToken}`)
      .send({ currentPassword: temp, newPassword: "BrandNewPass1" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);

    // Old temp password no longer works; new one does
    const oldLogin = await request(app).post("/api/auth/login").send({ email: "tmp@acme.test", password: temp });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/api/auth/login").send({ email: "tmp@acme.test", password: "BrandNewPass1" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(false);
  });

  test("an athlete (non-coach) cannot create athletes → 403 forbidden_role", async () => {
    const athleteUser = await User.create({ email: "ath@test.io", passwordHash: "x", role: "athlete", name: "Ath" });
    const app = buildApp();
    const token = signAccessToken({ sub: athleteUser._id.toString(), role: "athlete" });

    const res = await request(app)
      .post("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "X", email: "x@y.co", sport: "z" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_role");
  });
});

describe("Coach links an existing (self-registered) athlete", () => {
  async function selfRegister(app: express.Express, email: string, sport = "Tennis") {
    const res = await request(app)
      .post("/api/auth/register-athlete")
      .send({ name: "Self Athlete", email, password: "longenough1", sport });
    return res;
  }

  test("links a coachless athlete by email, no temp password, athlete appears on roster", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);

    await selfRegister(app, "self@solo.io");

    const res = await request(app)
      .post("/api/coach/athletes/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "self@solo.io" });

    expect(res.status).toBe(201);
    expect(res.body.linkedExisting).toBe(true);
    expect(res.body.athlete.email).toBe("self@solo.io");
    expect(res.body).not.toHaveProperty("tempPassword");

    const profile = await AthleteProfile.findOne({}).lean();
    const assignment = await CoachAthleteAssignment.findOne({
      coachId: coach._id,
      athleteId: profile!._id,
      endedAt: null,
    }).lean();
    expect(assignment).toBeTruthy();

    const roster = await request(app)
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`);
    expect(roster.body.athletes.map((a: { email: string }) => a.email)).toContain("self@solo.io");
  });

  test("adopts an unaffiliated athlete into the coach's academy", async () => {
    const academy = new Types.ObjectId();
    const coach = await User.create({
      email: "owner-coach@test.io",
      passwordHash: "x",
      role: "coach",
      name: "Owner",
      academyId: academy,
    });
    const app = buildApp();
    await selfRegister(app, "adopt@solo.io");

    const res = await request(app)
      .post("/api/coach/athletes/link")
      .set("Authorization", `Bearer ${coachToken(coach._id)}`)
      .send({ email: "adopt@solo.io" });
    expect(res.status).toBe(201);

    const user = await User.findOne({ email: "adopt@solo.io" }).lean();
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(String(profile?.academyId)).toBe(String(academy));
    expect(String(user?.academyId)).toBe(String(academy));
  });

  test("re-linking an already-assigned athlete → 409 already_linked", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);
    await selfRegister(app, "twice@solo.io");

    const first = await request(app).post("/api/coach/athletes/link").set("Authorization", `Bearer ${token}`).send({ email: "twice@solo.io" });
    expect(first.status).toBe(201);
    const dup = await request(app).post("/api/coach/athletes/link").set("Authorization", `Bearer ${token}`).send({ email: "twice@solo.io" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("already_linked");
  });

  test("unknown email or a non-athlete account → 404 athlete_not_found", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);
    await User.create({ email: "aguardian@test.io", passwordHash: "x", role: "guardian", name: "G" });

    const unknown = await request(app).post("/api/coach/athletes/link").set("Authorization", `Bearer ${token}`).send({ email: "nobody@solo.io" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("athlete_not_found");

    const nonAthlete = await request(app).post("/api/coach/athletes/link").set("Authorization", `Bearer ${token}`).send({ email: "aguardian@test.io" });
    expect(nonAthlete.status).toBe(404);
  });

  test("two coaches can both link the same athlete (shared squad member)", async () => {
    const coachA = await makeCoach("a");
    const coachB = await makeCoach("b");
    const app = buildApp();
    await selfRegister(app, "shared@solo.io");

    const ra = await request(app).post("/api/coach/athletes/link").set("Authorization", `Bearer ${coachToken(coachA._id)}`).send({ email: "shared@solo.io" });
    const rb = await request(app).post("/api/coach/athletes/link").set("Authorization", `Bearer ${coachToken(coachB._id)}`).send({ email: "shared@solo.io" });
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    const profile = await AthleteProfile.findOne({}).lean();
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id, endedAt: null })).toBe(2);
  });
});

describe("Academy owner manages coaches", () => {
  const ACADEMY = new Types.ObjectId();

  async function makeOwner(name: string) {
    return User.create({
      email: `${name}@test.io`,
      passwordHash: "x",
      role: "coach",
      name,
      academyId: ACADEMY,
      isAcademyOwner: true,
    });
  }

  test("owner creates a coach; new coach logs in and can add an athlete", async () => {
    const owner = await makeOwner("owner");
    const app = buildApp();
    const ownerToken = coachToken(owner._id);

    const res = await request(app)
      .post("/api/coach/coaches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "New Coach", email: "new.coach@acme.test" });
    expect(res.status).toBe(201);
    const temp = res.body.tempPassword as string;
    expect(typeof temp).toBe("string");

    const created = await User.findOne({ email: "new.coach@acme.test" }).lean();
    expect(created?.role).toBe("coach");
    expect(String(created?.academyId)).toBe(String(ACADEMY));
    expect(created?.isAcademyOwner).toBe(false);
    expect(created?.mustChangePassword).toBe(true);

    // New coach logs in with the temp password…
    const login = await request(app).post("/api/auth/login").send({ email: "new.coach@acme.test", password: temp });
    expect(login.status).toBe(200);
    expect(login.body.user.isAcademyOwner).toBe(false);

    // …and can immediately onboard their own athlete (the chain works).
    const athlete = await request(app)
      .post("/api/coach/athletes")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ name: "Their Athlete", email: "their.ath@acme.test", sport: "football" });
    expect(athlete.status).toBe(201);

    // …but the new coach is NOT an owner — cannot create further coaches.
    const denied = await request(app)
      .post("/api/coach/coaches")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ name: "X", email: "x@acme.test" });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("forbidden_not_owner");
  });

  test("a non-owner coach cannot list or create coaches → 403 forbidden_not_owner", async () => {
    const coach = await makeCoach("plain");
    const app = buildApp();
    const token = coachToken(coach._id);

    const list = await request(app).get("/api/coach/coaches").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(403);
    expect(list.body.error).toBe("forbidden_not_owner");

    const create = await request(app)
      .post("/api/coach/coaches")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Y", email: "y@acme.test" });
    expect(create.status).toBe(403);
  });

  test("owner: duplicate email → 409; missing fields → 400", async () => {
    const owner = await makeOwner("owner2");
    const app = buildApp();
    const token = coachToken(owner._id);

    const ok = await request(app).post("/api/coach/coaches").set("Authorization", `Bearer ${token}`).send({ name: "A", email: "dupcoach@acme.test" });
    expect(ok.status).toBe(201);
    const dup = await request(app).post("/api/coach/coaches").set("Authorization", `Bearer ${token}`).send({ name: "A", email: "dupcoach@acme.test" });
    expect(dup.status).toBe(409);
    const bad = await request(app).post("/api/coach/coaches").set("Authorization", `Bearer ${token}`).send({ email: "noname@acme.test" });
    expect(bad.status).toBe(400);
  });
});

describe("Coach-led guardian onboarding", () => {
  async function coachWithAthlete(coachName: string) {
    const coach = await makeCoach(coachName);
    const app = buildApp();
    const token = coachToken(coach._id);
    const created = await request(app)
      .post("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Athlete", email: `${coachName}-ath@acme.test`, sport: "football" });
    return { coach, token, app, athleteId: created.body.athlete.athleteId as string };
  }

  test("adds a guardian who can log in and see the linked athlete", async () => {
    const { token, app, athleteId } = await coachWithAthlete("kumar");

    const res = await request(app)
      .post(`/api/coach/athletes/${athleteId}/guardians`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Parent", email: "parent@acme.test", relationship: "father" });

    expect(res.status).toBe(201);
    expect(res.body.linkedExisting).toBe(false);
    expect(typeof res.body.tempPassword).toBe("string");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "parent@acme.test", password: res.body.tempPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("guardian");

    const linked = await request(app)
      .get("/api/guardian/athletes")
      .set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(linked.status).toBe(200);
    expect(linked.body.athletes.map((a: { athleteId: string }) => a.athleteId)).toContain(athleteId);
  });

  test("reuses an existing guardian account (parent of two athletes) — no new user, no temp password", async () => {
    const { token, app, athleteId } = await coachWithAthlete("kumar");
    // second athlete for the same coach
    const second = await request(app)
      .post("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Sibling", email: "sibling@acme.test", sport: "football" });
    const athleteId2 = second.body.athlete.athleteId as string;

    const first = await request(app)
      .post(`/api/coach/athletes/${athleteId}/guardians`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Parent", email: "parent@acme.test", relationship: "mother" });
    expect(first.status).toBe(201);

    const reuse = await request(app)
      .post(`/api/coach/athletes/${athleteId2}/guardians`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Parent", email: "parent@acme.test", relationship: "mother" });
    expect(reuse.status).toBe(201);
    expect(reuse.body.linkedExisting).toBe(true);
    expect(reuse.body.tempPassword).toBeUndefined();

    // exactly one guardian User, two links
    expect(await User.countDocuments({ role: "guardian" })).toBe(1);
    const guardian = await User.findOne({ role: "guardian" }).lean();
    expect(await GuardianAthleteLink.countDocuments({ guardianId: guardian!._id, endedAt: null })).toBe(2);
  });

  test("duplicate active guardian link → 409 already_linked", async () => {
    const { token, app, athleteId } = await coachWithAthlete("kumar");
    const body = { name: "Parent", email: "parent@acme.test", relationship: "father" };
    await request(app).post(`/api/coach/athletes/${athleteId}/guardians`).set("Authorization", `Bearer ${token}`).send(body);
    const dup = await request(app).post(`/api/coach/athletes/${athleteId}/guardians`).set("Authorization", `Bearer ${token}`).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("already_linked");
  });

  test("coach A cannot add a guardian to coach B's athlete → 403", async () => {
    const { athleteId } = await coachWithAthlete("kumar"); // coach A's athlete
    const coachB = await makeCoach("singh");
    const app = buildApp();
    const tokenB = coachToken(coachB._id);

    const res = await request(app)
      .post(`/api/coach/athletes/${athleteId}/guardians`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Parent", email: "intruder@acme.test", relationship: "father" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
  });
});
