import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { Academy } from "../src/models/Academy";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import { AuditLog } from "../src/models/AuditLog";
import {
  assertCanAccessAthlete,
  assertCanAccessAthleteProfile,
  loadScope,
  requireAthleteAccess,
} from "../src/middleware/coachAthleteAccess";
import { requireAuth } from "../src/middleware/auth";
import { requireRole } from "../src/middleware/role";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

async function makeAcademy(slug: string) {
  return Academy.create({ name: slug, slug });
}

async function makeUser(role: "coach" | "athlete" | "guardian", opts: {
  name: string;
  academyId?: Types.ObjectId;
}) {
  return User.create({
    email: `${opts.name}@test.io`,
    passwordHash: "x",
    role,
    name: opts.name,
    academyId: opts.academyId,
  });
}

async function makeAthleteWithProfile(name: string, academyId?: Types.ObjectId) {
  const user = await makeUser("athlete", { name, academyId });
  const profile = await AthleteProfile.create({
    userId: user._id,
    academyId,
    sport: "football",
  });
  return { user, profile };
}

async function coachActor(coachUserId: Types.ObjectId, academyId?: Types.ObjectId | null) {
  const rows = await CoachAthleteAssignment.find({
    coachId: coachUserId,
    endedAt: null,
  })
    .select("athleteId")
    .lean();
  return {
    userId: coachUserId,
    role: "coach" as const,
    academyId: academyId ?? null,
    assignedAthleteIds: rows.map((r) => r.athleteId as Types.ObjectId),
  };
}

async function guardianActor(guardianUserId: Types.ObjectId) {
  const rows = await GuardianAthleteLink.find({
    guardianId: guardianUserId,
    endedAt: null,
  })
    .select("athleteId")
    .lean();
  return {
    userId: guardianUserId,
    role: "guardian" as const,
    academyId: null,
    linkedAthleteIds: rows.map((r) => r.athleteId as Types.ObjectId),
  };
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
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

describe("RBAC: coach <-> athlete assignment", () => {
  test("1. Coach A cannot see Coach B's athletes", async () => {
    const admin = await makeUser("coach", { name: "root-admin" });
    const coachA = await makeUser("coach", { name: "coach-a" });
    const coachB = await makeUser("coach", { name: "coach-b" });

    const { profile: athleteOfA } = await makeAthleteWithProfile("ath-of-a");
    const { profile: athleteOfB } = await makeAthleteWithProfile("ath-of-b");

    await CoachAthleteAssignment.create({
      coachId: coachA._id,
      athleteId: athleteOfA._id,
      assignedBy: admin._id,
    });
    await CoachAthleteAssignment.create({
      coachId: coachB._id,
      athleteId: athleteOfB._id,
      assignedBy: admin._id,
    });

    const actorA = await coachActor(coachA._id);
    expect(() => assertCanAccessAthlete(actorA, athleteOfA._id)).not.toThrow();
    expect(() => assertCanAccessAthlete(actorA, athleteOfB._id)).toThrow(
      "not_in_assignments"
    );
  });

  test("2. Coach can see only assigned athletes (and not unassigned ones)", async () => {
    const admin = await makeUser("coach", { name: "admin2" });
    const coach = await makeUser("coach", { name: "coach-x" });
    const { profile: assigned } = await makeAthleteWithProfile("assigned");
    const { profile: unassigned } = await makeAthleteWithProfile("unassigned");

    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: assigned._id,
      assignedBy: admin._id,
    });

    const actor = await coachActor(coach._id);
    expect(actor.assignedAthleteIds.map(String)).toEqual([assigned._id.toString()]);
    expect(() => assertCanAccessAthlete(actor, assigned._id)).not.toThrow();
    expect(() => assertCanAccessAthlete(actor, unassigned._id)).toThrow(
      "not_in_assignments"
    );
  });

  test("2b. Ended assignment removes access", async () => {
    const admin = await makeUser("coach", { name: "admin2b" });
    const coach = await makeUser("coach", { name: "coach-end" });
    const { profile } = await makeAthleteWithProfile("ath-end");

    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
      endedAt: new Date(),
    });

    const actor = await coachActor(coach._id);
    expect(() => assertCanAccessAthlete(actor, profile._id)).toThrow(
      "not_in_assignments"
    );
  });
});

describe("RBAC: athlete scope", () => {
  test("4. Athlete can see only their own data", async () => {
    const { user: meUser, profile: meProfile } = await makeAthleteWithProfile("me");
    const { profile: otherProfile } = await makeAthleteWithProfile("other");

    const actor = {
      userId: meUser._id,
      role: "athlete" as const,
      academyId: null,
      athleteProfileId: meProfile._id,
    };
    expect(() => assertCanAccessAthlete(actor, meProfile._id)).not.toThrow();
    expect(() => assertCanAccessAthlete(actor, otherProfile._id)).toThrow("not_self");
  });
});

describe("RBAC: guardian scope", () => {
  test("5. Guardian can see only their linked athlete", async () => {
    const guardian = await makeUser("guardian", { name: "parent-1" });
    const { profile: child } = await makeAthleteWithProfile("child");
    const { profile: notMyChild } = await makeAthleteWithProfile("not-my-child");

    await GuardianAthleteLink.create({
      guardianId: guardian._id,
      athleteId: child._id,
      relationship: "parent",
    });

    const actor = await guardianActor(guardian._id);
    expect(actor.linkedAthleteIds.map(String)).toEqual([child._id.toString()]);
    expect(() => assertCanAccessAthlete(actor, child._id)).not.toThrow();
    expect(() => assertCanAccessAthlete(actor, notMyChild._id)).toThrow(
      "not_linked_guardian"
    );
  });

  test("5b. Ended guardian link removes access", async () => {
    const guardian = await makeUser("guardian", { name: "parent-end" });
    const { profile: child } = await makeAthleteWithProfile("former-child");

    await GuardianAthleteLink.create({
      guardianId: guardian._id,
      athleteId: child._id,
      endedAt: new Date(),
    });

    const actor = await guardianActor(guardian._id);
    expect(() => assertCanAccessAthlete(actor, child._id)).toThrow(
      "not_linked_guardian"
    );
  });
});

describe("RBAC: unauthorized HTTP access returns 401/403", () => {
  function buildApp() {
    const app = express();
    app.use(express.json());

    // protected resource: only coaches, scoped to assigned athletes
    app.get(
      "/api/athletes/:athleteId/wellness",
      requireAuth,
      requireRole("coach"),
      loadScope,
      requireAthleteAccess("athleteId"),
      (_req, res) => res.json({ ok: true })
    );

    return app;
  }

  test("6a. No token → 401", async () => {
    const res = await request(buildApp()).get(
      `/api/athletes/${new Types.ObjectId().toString()}/wellness`
    );
    expect(res.status).toBe(401);
  });

  test("6b. Wrong role (athlete hitting coach endpoint) → 403", async () => {
    const { user: athleteUser, profile } = await makeAthleteWithProfile("a-403");
    const token = signAccessToken({ sub: athleteUser._id.toString(), role: "athlete" });

    const res = await request(buildApp())
      .get(`/api/athletes/${profile._id.toString()}/wellness`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden_role" });
  });

  test("6c. Coach hitting unassigned athlete → 403 not_in_assignments", async () => {
    const coach = await makeUser("coach", { name: "coach-403" });
    const { profile } = await makeAthleteWithProfile("ath-403");
    const token = signAccessToken({ sub: coach._id.toString(), role: "coach" });

    const res = await request(buildApp())
      .get(`/api/athletes/${profile._id.toString()}/wellness`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "not_in_assignments" });

    const audit = await AuditLog.findOne({
      actorId: coach._id,
      targetId: profile._id,
      outcome: "deny",
    }).lean();
    expect(audit).toMatchObject({
      actorRole: "coach",
      targetType: "athlete",
      reason: "not_in_assignments",
    });
  });

  test("6d. Coach hitting assigned athlete → 200", async () => {
    const admin = await makeUser("coach", { name: "admin-ok" });
    const coach = await makeUser("coach", { name: "coach-ok" });
    const { profile } = await makeAthleteWithProfile("ath-ok");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });
    const token = signAccessToken({ sub: coach._id.toString(), role: "coach" });

    const res = await request(buildApp())
      .get(`/api/athletes/${profile._id.toString()}/wellness`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
