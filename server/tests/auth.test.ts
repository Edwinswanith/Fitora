import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "crypto";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { Wellness } from "../src/models/Wellness";
import { Notification } from "../src/models/Notification";
import authRouter, { __resetLoginRateLimit } from "../src/routes/auth";
import coachRouter from "../src/routes/coach";
import athleteRouter from "../src/routes/athlete";
import { env } from "../src/config/env";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteRouter);
  return app;
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

async function makeCoach(password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.create({
    email: "coach@test.io",
    passwordHash,
    role: "coach",
    name: "Coach One",
  });
}

describe("POST /api/auth/login", () => {
  test("returns access token + safe user, then access token unlocks /api/coach/athletes", async () => {
    const coach = await makeCoach("s3cret!");

    const athleteUser = await User.create({
      email: "ath@test.io",
      passwordHash: "x",
      role: "athlete",
      name: "Ath One",
    });
    const profile = await AthleteProfile.create({
      userId: athleteUser._id,
      sport: "football",
    });
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: coach._id,
    });

    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "s3cret!" });

    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe("string");
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.body.user).toEqual({
      id: coach._id.toString(),
      name: "Coach One",
      email: "coach@test.io",
      role: "coach",
      academyId: null,
      isAcademyOwner: false,
      mustChangePassword: false,
      avatar: { kind: null, defaultId: null },
    });
    expect(login.body.user).not.toHaveProperty("passwordHash");
    expect(login.body.user).not.toHaveProperty("refreshTokenHash");

    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(",") : String(setCookie ?? "");
    expect(cookieHeader).toMatch(/accessToken=/);
    expect(cookieHeader).toMatch(/refreshToken=/);
    expect(cookieHeader).toMatch(/HttpOnly/);

    const me = await request(app)
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.athletes).toHaveLength(1);
    expect(me.body.athletes[0]).toMatchObject({
      athleteId: profile._id.toString(),
      name: "Ath One",
      sport: "football",
    });

    const accessCookie = (Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")])
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("accessToken="));
    expect(accessCookie).toBeTruthy();

    const meByCookie = await request(app)
      .get("/api/auth/me")
      .set("Cookie", accessCookie!);

    expect(meByCookie.status).toBe(200);
    expect(meByCookie.body.user).toEqual({
      id: coach._id.toString(),
      name: "Coach One",
      email: "coach@test.io",
      role: "coach",
      academyId: null,
      isAcademyOwner: false,
      mustChangePassword: false,
      avatar: { kind: null, defaultId: null },
    });
  });

  test("wrong password returns 401", async () => {
    await makeCoach("right-password");
    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_credentials" });
  });

  test("unknown email returns 401", async () => {
    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "nobody@test.io", password: "whatever" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_credentials" });
  });
});

describe("POST /api/auth/register-athlete (self-signup)", () => {
  const body = {
    name: "Solo Sam",
    email: "sam@solo.io",
    password: "longenough1",
    sport: "Athletics",
    position: "Sprinter",
  };

  test("creates an unassigned athlete + profile, signs them in, and unlocks athlete self-service", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/auth/register-athlete").send(body);

    expect(res.status).toBe(201);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.user).toMatchObject({ role: "athlete", email: "sam@solo.io", name: "Solo Sam" });
    expect(res.body.user).not.toHaveProperty("passwordHash");

    const user = await User.findOne({ email: "sam@solo.io" }).lean();
    expect(user?.role).toBe("athlete");
    expect(user?.academyId).toBeFalsy();
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(profile).toMatchObject({ sport: "Athletics", position: "Sprinter" });
    // No coach assignment — invisible to every coach (scope invariant intact).
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id })).toBe(0);

    // The returned token works against the athlete self-service surface.
    const me = await request(app)
      .get("/api/athlete/me")
      .set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.athlete).toMatchObject({ sport: "Athletics" });
  });

  test("duplicate email returns 409 and creates no orphan profile", async () => {
    const app = buildApp();
    await request(app).post("/api/auth/register-athlete").send(body);
    const dup = await request(app).post("/api/auth/register-athlete").send(body);
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: "email_already_exists" });
    expect(await AthleteProfile.countDocuments()).toBe(1);
  });

  test("short password returns 400 weak_password and creates nothing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/register-athlete")
      .send({ ...body, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "weak_password" });
    expect(await User.countDocuments()).toBe(0);
  });

  test("missing sport returns 400 invalid_sport", async () => {
    const res = await request(buildApp())
      .post("/api/auth/register-athlete")
      .send({ ...body, sport: "" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_sport" });
  });
});

describe("POST /api/auth/google self-signup roles", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let previousGoogleClientId: string;
  let previousGoogleClientIds: string[];

  beforeEach(() => {
    previousGoogleClientId = env.googleClientId;
    previousGoogleClientIds = [...env.googleClientIds];
    env.googleClientId = "web-client";
    env.googleClientIds = ["web-client", "android-client"];
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    env.googleClientId = previousGoogleClientId;
    env.googleClientIds = previousGoogleClientIds;
  });

  function mockGoogleToken(email: string, name = "Google User") {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        aud: "web-client",
        iss: "accounts.google.com",
        email,
        email_verified: "true",
        name,
      }),
    } as Response);
  }

  test("brand-new Google athlete creates an independent athlete account", async () => {
    mockGoogleToken("google.athlete@test.io", "Google Athlete");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "athlete-token", requestedRole: "athlete" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "google.athlete@test.io",
      name: "Google Athlete",
      role: "athlete",
      academyId: null,
      mustChangePassword: false,
    });
    const user = await User.findOne({ email: "google.athlete@test.io" }).lean();
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(profile?.sport).toBe("Not set");
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id })).toBe(0);
  });

  test("brand-new Google coach creates a coach account and can link an existing athlete", async () => {
    const app = buildApp();
    await request(app)
      .post("/api/auth/register-athlete")
      .send({
        name: "Existing Athlete",
        email: "existing.athlete@test.io",
        password: "longenough1",
        sport: "Athletics",
      });
    mockGoogleToken("google.coach@test.io", "Google Coach");

    const coachLogin = await request(app)
      .post("/api/auth/google")
      .send({ credential: "coach-token", requestedRole: "coach" });

    expect(coachLogin.status).toBe(200);
    expect(coachLogin.body.user).toMatchObject({
      email: "google.coach@test.io",
      name: "Google Coach",
      role: "coach",
      academyId: null,
      isAcademyOwner: false,
      mustChangePassword: false,
    });
    const coach = await User.findOne({ email: "google.coach@test.io" }).lean();
    expect(await AthleteProfile.exists({ userId: coach!._id })).toBeFalsy();

    const link = await request(app)
      .post("/api/coach/athletes/link")
      .set("Authorization", `Bearer ${coachLogin.body.accessToken}`)
      .send({ email: "existing.athlete@test.io" });

    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({ linkedExisting: true });

    const roster = await request(app)
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${coachLogin.body.accessToken}`);
    expect(roster.status).toBe(200);
    expect(roster.body.athletes.map((a: { email: string }) => a.email)).toContain("existing.athlete@test.io");
  });

  test("native Google sign-in returns an explicit refresh token", async () => {
    mockGoogleToken("native.google.coach@test.io", "Native Google Coach");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "native-coach-token", requestedRole: "coach", client: "native" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "native.google.coach@test.io",
      role: "coach",
    });
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  test("existing Google email keeps its stored role even if another role page is selected", async () => {
    const user = await User.create({
      email: "existing-role@test.io",
      passwordHash: "x",
      role: "athlete",
      name: "Existing Role",
      isActive: true,
    });
    await AthleteProfile.create({ userId: user._id, sport: "Football" });
    mockGoogleToken("existing-role@test.io", "Wrong Role Attempt");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "existing-token", requestedRole: "coach" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "existing-role@test.io",
      role: "athlete",
      name: "Existing Role",
    });
    expect(await User.countDocuments({ email: "existing-role@test.io" })).toBe(1);
    expect(await AthleteProfile.countDocuments({ userId: user._id })).toBe(1);
  });
});

describe("POST /api/auth/apple self-signup roles", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let previousAppleClientIds: string[];
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;

  beforeEach(() => {
    previousAppleClientIds = [...env.appleClientIds];
    env.appleClientIds = ["app.apex.coaching"];
    fetchSpy = jest.spyOn(global, "fetch");
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        keys: [{ ...publicJwk, kid: "apple-test-key", alg: "RS256", use: "sig" }],
      }),
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    env.appleClientIds = previousAppleClientIds;
  });

  function appleToken(
    email: string,
    audience = "app.apex.coaching",
    subject = `apple-${email}`
  ) {
    return jwt.sign(
      {
        iss: "https://appleid.apple.com",
        aud: audience,
        email,
        email_verified: "true",
        sub: subject,
      },
      privateKey,
      { algorithm: "RS256", keyid: "apple-test-key", expiresIn: "5m" }
    );
  }

  test("brand-new Apple athlete creates an independent athlete account", async () => {
    const res = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("apple.athlete@test.io"),
        requestedRole: "athlete",
        fullName: "Apple Athlete",
      });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "apple.athlete@test.io",
      name: "Apple Athlete",
      role: "athlete",
      academyId: null,
      mustChangePassword: false,
    });
    const user = await User.findOne({ email: "apple.athlete@test.io" }).lean();
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(profile?.sport).toBe("Not set");
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id })).toBe(0);
  });

  test("native Apple sign-in returns an explicit refresh token", async () => {
    const res = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("apple.coach@test.io"),
        requestedRole: "coach",
        client: "native",
      });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "apple.coach@test.io",
      role: "coach",
    });
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  test("repeat Apple sign-in uses the stable subject even if the disclosed email changes", async () => {
    const subject = "stable-apple-user";
    const first = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("first@privaterelay.appleid.com", "app.apex.coaching", subject),
        requestedRole: "athlete",
      });
    const second = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("changed@privaterelay.appleid.com", "app.apex.coaching", subject),
        requestedRole: "coach",
      });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.user.role).toBe("athlete");
    expect(await User.countDocuments({ appleSubject: subject })).toBe(1);
  });

  test("repeat Apple sign-in succeeds when Apple omits email on later authorization", async () => {
    const subject = "returning-apple-user";
    const first = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("returning@privaterelay.appleid.com", "app.apex.coaching", subject),
        requestedRole: "athlete",
      });
    const tokenWithoutProfile = jwt.sign(
      {
        iss: "https://appleid.apple.com",
        aud: "app.apex.coaching",
        sub: subject,
      },
      privateKey,
      { algorithm: "RS256", keyid: "apple-test-key", expiresIn: "5m" }
    );
    const second = await request(buildApp())
      .post("/api/auth/apple")
      .send({ identityToken: tokenWithoutProfile, requestedRole: "coach" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  test("Apple token with wrong audience is rejected", async () => {
    const res = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("wrong.aud@test.io", "other.bundle"),
        requestedRole: "athlete",
      });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_apple_token" });
  });

  test("prefix/suffix near-misses of the real bundle ID are rejected — only an exact match is accepted", async () => {
    const suffixTrick = await request(buildApp())
      .post("/api/auth/apple")
      .send({ identityToken: appleToken("suffix@test.io", "app.apex.coaching.evil"), requestedRole: "athlete" });
    const prefixTrick = await request(buildApp())
      .post("/api/auth/apple")
      .send({ identityToken: appleToken("prefix@test.io", "evil.app.apex.coaching"), requestedRole: "athlete" });

    expect(suffixTrick.status).toBe(401);
    expect(suffixTrick.body).toEqual({ error: "invalid_apple_token" });
    expect(prefixTrick.status).toBe(401);
    expect(prefixTrick.body).toEqual({ error: "invalid_apple_token" });
  });

  test("expired Apple token is rejected safely, not a 500", async () => {
    const expiredToken = jwt.sign(
      {
        iss: "https://appleid.apple.com",
        aud: "app.apex.coaching",
        email: "expired@test.io",
        email_verified: "true",
        sub: "expired-subject",
      },
      privateKey,
      { algorithm: "RS256", keyid: "apple-test-key", expiresIn: -10 }
    );
    const res = await request(buildApp())
      .post("/api/auth/apple")
      .send({ identityToken: expiredToken, requestedRole: "athlete" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_apple_token" });
  });

  test("the real native bundle ID is always accepted, even if APPLE_CLIENT_ID is misconfigured to a different (e.g. web Services ID) value", async () => {
    // Simulates the exact App Store rejection risk: an env var set to
    // something other than the native bundle ID must never lock out the
    // native app's own tokens, which always carry the bundle ID as `aud`.
    env.appleClientIds = ["com.apex.coaching.webservice"];

    const res = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("native.user@test.io", "app.apex.coaching"),
        requestedRole: "athlete",
      });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "native.user@test.io" });
  });

  test("an existing email/password account signing in with Apple links by email, without creating a duplicate", async () => {
    const passwordUser = await User.create({
      email: "linked.account@test.io",
      passwordHash: await bcrypt.hash("s3cret!", 10),
      role: "athlete",
      name: "Password First",
    });
    await AthleteProfile.create({ userId: passwordUser._id, sport: "Football" });

    const res = await request(buildApp())
      .post("/api/auth/apple")
      .send({
        identityToken: appleToken("linked.account@test.io", "app.apex.coaching", "linking-subject"),
        requestedRole: "athlete",
      });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(passwordUser._id.toString());
    expect(await User.countDocuments({ email: "linked.account@test.io" })).toBe(1);
    const updated = await User.findById(passwordUser._id).lean();
    expect(updated?.appleSubject).toBe("linking-subject");

    // A second Apple sign-in now finds the account purely by subject, even
    // if Apple stops disclosing the email on this later authorization.
    const tokenWithoutEmail = jwt.sign(
      { iss: "https://appleid.apple.com", aud: "app.apex.coaching", sub: "linking-subject" },
      privateKey,
      { algorithm: "RS256", keyid: "apple-test-key", expiresIn: "5m" }
    );
    const second = await request(buildApp())
      .post("/api/auth/apple")
      .send({ identityToken: tokenWithoutEmail, requestedRole: "athlete" });
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(passwordUser._id.toString());
  });
});

describe("DELETE /api/auth/account", () => {
  test("requires explicit confirmation", async () => {
    await makeCoach("delete-me");
    const login = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "delete-me" });

    const res = await request(buildApp())
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "confirmation_required" });
    expect(await User.countDocuments({ email: "coach@test.io" })).toBe(1);
  });

  test("permanently deletes an athlete account and its athlete-scoped personal data", async () => {
    const passwordHash = await bcrypt.hash("delete-me", 10);
    const athlete = await User.create({
      email: "delete@test.io",
      passwordHash,
      role: "athlete",
      name: "Delete Me",
    });
    const profile = await AthleteProfile.create({
      userId: athlete._id,
      sport: "Athletics",
    });
    await Wellness.create({
      athleteId: profile._id,
      date: new Date("2026-07-24T00:00:00.000Z"),
      sleepQuality: 4,
    });
    await Notification.create({
      recipientUserId: athlete._id,
      type: "test",
      title: "Personal notification",
    });

    const login = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "delete@test.io", password: "delete-me" });
    const res = await request(buildApp())
      .delete("/api/auth/account")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ confirmation: "DELETE" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await User.countDocuments({ _id: athlete._id })).toBe(0);
    expect(await AthleteProfile.countDocuments({ _id: profile._id })).toBe(0);
    expect(await Wellness.countDocuments({ athleteId: profile._id })).toBe(0);
    expect(await Notification.countDocuments({ recipientUserId: athlete._id })).toBe(0);
  });
});

describe("protected routes", () => {
  test("GET /api/coach/athletes without token returns 401", async () => {
    const res = await request(buildApp()).get("/api/coach/athletes");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
  });
});

describe("POST /api/auth/refresh", () => {
  test("refresh cookie issues a new access token", async () => {
    await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw" });

    const setCookie = login.headers["set-cookie"];
    const cookieArr = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];
    const refreshCookie = cookieArr
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("refreshToken="));
    expect(refreshCookie).toBeTruthy();

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", refreshCookie!);

    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.accessToken).toBe("string");
    expect(refresh.body.refreshToken).toBeUndefined();
  });

  test("native refresh token in body rotates native tokens", async () => {
    await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw", client: "native" });

    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe("string");
    expect(typeof login.body.refreshToken).toBe("string");

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken, client: "native" });

    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.accessToken).toBe("string");
    expect(typeof refresh.body.refreshToken).toBe("string");
    expect(refresh.body.refreshToken).not.toBe(login.body.refreshToken);
  });

  test("refresh without cookie returns 401", async () => {
    const res = await request(buildApp()).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  test("clears refreshTokenHash on the user", async () => {
    const coach = await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw" });

    const before = await User.findById(coach._id).lean();
    expect(before?.refreshTokenHash).toBeTruthy();

    const setCookie = login.headers["set-cookie"];
    const cookieArr = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];
    const refreshCookie = cookieArr
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("refreshToken="));

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", refreshCookie!);

    expect(logout.status).toBe(200);
    const after = await User.findById(coach._id).lean();
    expect(after?.refreshTokenHash).toBeFalsy();
  });

  test("native logout clears refreshTokenHash from body refresh token", async () => {
    const coach = await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw", client: "native" });

    expect(typeof login.body.refreshToken).toBe("string");
    const before = await User.findById(coach._id).lean();
    expect(before?.refreshTokenHash).toBeTruthy();

    const logout = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: login.body.refreshToken, client: "native" });

    expect(logout.status).toBe(200);
    const after = await User.findById(coach._id).lean();
    expect(after?.refreshTokenHash).toBeFalsy();
  });
});
