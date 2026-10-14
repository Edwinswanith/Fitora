import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import authRouter, { __resetLoginRateLimit } from "../src/routes/auth";
import coachRouter from "../src/routes/coach";
import athleteRouter from "../src/routes/athlete";
import { athleteJoinRequestsRouter } from "../src/routes/coachJoinRequests";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteRouter);
  app.use("/api/athlete", athleteJoinRequestsRouter);
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

    // …and, once the temporary password is replaced, reach their own workspace
    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: res.body.tempPassword, newPassword: "MyOwnPass123" });
    expect(changed.status).toBe(200);
    const me = await request(app)
      .get("/api/athlete/me")
      .set("Authorization", `Bearer ${changed.body.accessToken}`);
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

    // Until the temporary password is changed, everything outside /api/auth
    // is refused: the coach who issued it knows it.
    const blocked = await request(app).get("/api/athlete/me").set("Authorization", `Bearer ${athleteToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("must_change_password");
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${athleteToken}`);
    expect(me.status).toBe(200);

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
    const unblocked = await request(app).get("/api/athlete/me").set("Authorization", `Bearer ${ok.body.accessToken}`);
    expect(unblocked.status).toBe(200);

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

describe("Coach invites an existing (self-registered) athlete", () => {
  async function selfRegister(app: express.Express, email: string, sport = "Tennis") {
    const res = await request(app)
      .post("/api/auth/register-athlete")
      .set("X-Client-Type", "native")
      .send({ name: "Self Athlete", email, password: "longenough1", sport });
    return res;
  }
  const invite = (app: express.Express, coachId: Types.ObjectId, email: string) =>
    request(app).post("/api/coach/athletes/link").set("Authorization", `Bearer ${coachToken(coachId)}`).send({ email });
  const athleteAuth = (accessToken: string) => `Bearer ${accessToken}`;

  test("nothing is shared until the athlete accepts; then they appear on the roster", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const token = coachToken(coach._id);
    const athlete = await selfRegister(app, "self@solo.io");

    const res = await invite(app, coach._id, "self@solo.io");
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ invited: true });
    expect(await CoachAthleteAssignment.countDocuments()).toBe(0);
    const profile = await AthleteProfile.findOne({}).lean();
    const blocked = await request(app).get(`/api/coach/athletes/${profile!._id}/daily-card`).set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(403);

    const sent = await request(app).get("/api/coach/invites").set("Authorization", `Bearer ${token}`);
    expect(sent.body.invites).toHaveLength(1);

    const inbox = await request(app).get("/api/athlete/coach-invites").set("Authorization", athleteAuth(athlete.body.accessToken));
    expect(inbox.body.invites).toHaveLength(1);
    expect(inbox.body.invites[0].coach).toMatchObject({ name: "kumar" });

    const accepted = await request(app)
      .post(`/api/athlete/coach-invites/${inbox.body.invites[0].id}/accept`)
      .set("Authorization", athleteAuth(athlete.body.accessToken));
    expect(accepted.status).toBe(200);
    expect(await CoachAthleteAssignment.countDocuments({ coachId: coach._id, athleteId: profile!._id, status: "active" })).toBe(1);

    const roster = await request(app).get("/api/coach/athletes").set("Authorization", `Bearer ${token}`);
    expect(roster.body.athletes.map((a: { email: string }) => a.email)).toContain("self@solo.io");
  });

  test("declining links nothing and removes the invite", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    const athlete = await selfRegister(app, "no@solo.io");
    await invite(app, coach._id, "no@solo.io");
    const inbox = await request(app).get("/api/athlete/coach-invites").set("Authorization", athleteAuth(athlete.body.accessToken));
    const declined = await request(app)
      .post(`/api/athlete/coach-invites/${inbox.body.invites[0].id}/decline`)
      .set("Authorization", athleteAuth(athlete.body.accessToken));
    expect(declined.status).toBe(200);
    expect(await CoachAthleteAssignment.countDocuments()).toBe(0);
    const after = await request(app).get("/api/athlete/coach-invites").set("Authorization", athleteAuth(athlete.body.accessToken));
    expect(after.body.invites).toHaveLength(0);
  });

  test("accepting adopts an unaffiliated athlete into the coach's academy", async () => {
    const academy = new Types.ObjectId();
    const coach = await User.create({
      email: "owner-coach@test.io",
      passwordHash: "x",
      role: "coach",
      name: "Owner",
      academyId: academy,
    });
    const app = buildApp();
    const athlete = await selfRegister(app, "adopt@solo.io");
    await invite(app, coach._id, "adopt@solo.io");
    const inbox = await request(app).get("/api/athlete/coach-invites").set("Authorization", athleteAuth(athlete.body.accessToken));
    await request(app).post(`/api/athlete/coach-invites/${inbox.body.invites[0].id}/accept`).set("Authorization", athleteAuth(athlete.body.accessToken));

    const user = await User.findOne({ email: "adopt@solo.io" }).lean();
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(String(profile?.academyId)).toBe(String(academy));
    expect(String(user?.academyId)).toBe(String(academy));
  });

  test("the answer never reveals whether an email has an account, a coach or an invite", async () => {
    const coach = await makeCoach("kumar");
    const other = await makeCoach("other");
    const app = buildApp();
    await User.create({ email: "another.coach@test.io", passwordHash: "x", role: "coach", name: "C" });
    const coached = await selfRegister(app, "coached@solo.io");
    await invite(app, other._id, "coached@solo.io");
    const inbox = await request(app).get("/api/athlete/coach-invites").set("Authorization", athleteAuth(coached.body.accessToken));
    await request(app).post(`/api/athlete/coach-invites/${inbox.body.invites[0].id}/accept`).set("Authorization", athleteAuth(coached.body.accessToken));
    await selfRegister(app, "twice@solo.io");
    await invite(app, coach._id, "twice@solo.io");

    for (const email of ["nobody@solo.io", "another.coach@test.io", "coached@solo.io", "twice@solo.io"]) {
      const res = await invite(app, coach._id, email);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ invited: true });
    }
    const twice = await User.findOne({ email: "twice@solo.io" }).lean();
    const { CoachInvite } = await import("../src/models/CoachInvite");
    expect(await CoachInvite.countDocuments({ athleteUserId: twice!._id, status: "pending" })).toBe(1);
    expect(await CoachAthleteAssignment.countDocuments({ coachId: coach._id })).toBe(0);
  });

  test("one primary coach at a time: once one invite is accepted, the others close", async () => {
    const coachA = await makeCoach("a");
    const coachB = await makeCoach("b");
    const app = buildApp();
    const athlete = await selfRegister(app, "shared@solo.io");
    await invite(app, coachA._id, "shared@solo.io");
    await invite(app, coachB._id, "shared@solo.io");
    const inbox = await request(app).get("/api/athlete/coach-invites").set("Authorization", athleteAuth(athlete.body.accessToken));
    expect(inbox.body.invites).toHaveLength(2);
    const [first, second] = inbox.body.invites;
    expect((await request(app).post(`/api/athlete/coach-invites/${first.id}/accept`).set("Authorization", athleteAuth(athlete.body.accessToken))).status).toBe(200);
    const late = await request(app).post(`/api/athlete/coach-invites/${second.id}/accept`).set("Authorization", athleteAuth(athlete.body.accessToken));
    expect(late.status).toBe(404);
    const profile = await AthleteProfile.findOne({}).lean();
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id, status: "active" })).toBe(1);
  });

  test("an athlete can't answer someone else's invite", async () => {
    const coach = await makeCoach("kumar");
    const app = buildApp();
    await selfRegister(app, "target@solo.io");
    const intruder = await selfRegister(app, "intruder@solo.io");
    await invite(app, coach._id, "target@solo.io");
    const { CoachInvite } = await import("../src/models/CoachInvite");
    const row = await CoachInvite.findOne({}).lean();
    const res = await request(app).post(`/api/athlete/coach-invites/${row!._id}/accept`).set("Authorization", athleteAuth(intruder.body.accessToken));
    expect(res.status).toBe(404);
    expect(await CoachAthleteAssignment.countDocuments()).toBe(0);
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

    // …replaces the temporary password, then can onboard their own athlete (the chain works).
    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: temp, newPassword: "MyOwnPass123" });
    expect(changed.status).toBe(200);
    const athlete = await request(app)
      .post("/api/coach/athletes")
      .set("Authorization", `Bearer ${changed.body.accessToken}`)
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

