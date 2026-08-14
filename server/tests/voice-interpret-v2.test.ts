import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { VoicePendingState } from "../src/models/VoicePendingState";
import { Wellness } from "../src/models/Wellness";
import { WaterIntake } from "../src/models/WaterIntake";
import athleteVoiceV2Router from "../src/routes/athleteVoiceV2";
import { signAccessToken } from "../src/lib/tokens";
import {
  sanitizeModelOutput,
  setVoiceIntentInterpreterV2ForTests,
  MockVoiceIntentInterpreterV2,
  type VoiceIntentInterpreterV2,
} from "../src/services/voiceIntentInterpreterV2";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete/voice", athleteVoiceV2Router);
  return app;
}

async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

async function makeAthlete(name: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "football" });
  return { user, profile };
}

function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
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
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  setVoiceIntentInterpreterV2ForTests(new MockVoiceIntentInterpreterV2());
});

afterEach(() => {
  setVoiceIntentInterpreterV2ForTests(null);
});

describe("POST /api/athlete/voice/interpret-v2 — RBAC", () => {
  test("rejects unauthenticated requests", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/athlete/voice/interpret-v2").send({ transcript: "open today" });
    expect(res.status).toBe(401);
  });

  test("rejects non-athlete roles", async () => {
    const app = buildApp();
    const coach = await makeUser("coach", "Coach");
    const token = tokenFor(coach._id as Types.ObjectId, "coach");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open today" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_role");
  });
});

describe("POST /api/athlete/voice/interpret-v2 — contract", () => {
  test("a fresh navigate command needs no confirmation and writes no pending state", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("Arjun");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open progress" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("open_screen");
    expect(res.body.action).toBe("navigate");
    expect(res.body.requiresConfirmation).toBe(false);
    const pending = await VoicePendingState.findOne({ athleteProfileId: profile._id });
    expect(pending).toBeNull();
  });

  test("a complete write command is ready to confirm and persists pending state server-side", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("Bala");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "drink 500 ml of water" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("add_water");
    expect(res.body.action).toBe("ready_to_confirm");
    expect(res.body.requiresConfirmation).toBe(true);
    const pending = await VoicePendingState.findOne({ athleteProfileId: profile._id }).lean();
    expect(pending).not.toBeNull();
    expect(pending?.intent).toBe("add_water");
    expect((pending?.entities as Record<string, unknown>).amountMl).toBe(500);
  });

  test("an incomplete session log asks a follow-up and keeps collecting", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Chetan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "I did a training session" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("log_session");
    expect(res.body.action).toBe("collect_fields");
    expect(res.body.missingFields.length).toBeGreaterThan(0);
  });

  test("one-sentence multi-value session log extracts rpe and effortScore independently", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Diya");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "I completed my morning sprint session for 45 minutes rpe 8 and effort 9" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("log_session");
    expect(res.body.entities.sessionType).toBe("AM");
    expect(res.body.entities.rpe).toBe(8);
    expect(res.body.entities.effortScore).toBe(9);
    expect(res.body.entities.actualDurationMin).toBe(45);
  });

  test("a real multi-turn correction updates only the mentioned field via server-persisted state", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("Esha");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");

    const first = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({
        transcript:
          "I completed my morning max speed session for 45 minutes at planned intensity 80 percent rpe 8 and effort 9",
      });
    expect(first.body.action).toBe("ready_to_confirm");

    const fakeCorrection: VoiceIntentInterpreterV2 = {
      interpret: async () => ({ intent: "update_field", entities: { rpe: 7 }, confidence: 0.8 }),
    };
    setVoiceIntentInterpreterV2ForTests(fakeCorrection);

    const second = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "actually rpe was 7" });

    expect(second.status).toBe(200);
    expect(second.body.intent).toBe("log_session");
    expect(second.body.entities.rpe).toBe(7);
    expect(second.body.entities.effortScore).toBe(9); // preserved, not overwritten
    expect(second.body.entities.actualDurationMin).toBe(45); // preserved
    expect(second.body.entities.sessionType).toBe("AM"); // preserved

    const pending = await VoicePendingState.findOne({ athleteProfileId: profile._id }).lean();
    expect((pending?.entities as Record<string, unknown>).rpe).toBe(7);
  });

  test("confirm_action against real persisted pending state resolves to execute and clears it", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("Farhan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");

    await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "drink 500 ml of water" });

    const fakeYes: VoiceIntentInterpreterV2 = {
      interpret: async () => ({ intent: "confirm_action", entities: {}, confidence: 0.95 }),
    };
    setVoiceIntentInterpreterV2ForTests(fakeYes);

    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "yes" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("execute");
    expect(res.body.entities.amountMl).toBe(500);

    const pending = await VoicePendingState.findOne({ athleteProfileId: profile._id });
    expect(pending).toBeNull();
  });

  test("cancel_action clears the pending workflow without executing anything", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("Guru");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");

    await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "drink 500 ml of water" });

    const fakeNo: VoiceIntentInterpreterV2 = {
      interpret: async () => ({ intent: "cancel_action", entities: {}, confidence: 0.95 }),
    };
    setVoiceIntentInterpreterV2ForTests(fakeNo);

    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "no, cancel that" });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("reject");
    expect(res.body.spokenResponse).toMatch(/cancelled/i);

    const pending = await VoicePendingState.findOne({ athleteProfileId: profile._id });
    expect(pending).toBeNull();
  });

  test("an unrelated question is redirected, not answered like a general chatbot", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Harini");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "what's the weather like today" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("unknown_intent");
    expect(res.body.action).toBe("reject");
    expect(res.body.spokenResponse).toMatch(/log RPE|readiness|coach/i);
  });

  test("explain_app_field gives a controlled explanation for a known Apex term", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Ishaan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "what is RPE" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("explain_app_field");
    expect(res.body.action).toBe("answer");
    expect(res.body.spokenResponse).toMatch(/RPE is how hard/i);
  });

  test("rejects a missing or oversized transcript", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Jaya");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const missing = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({});
    expect(missing.status).toBe(400);

    const oversized = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "a".repeat(2001) });
    expect(oversized.status).toBe(400);
  });

  test("falls back to unknown_intent, never a 500, when the interpreter throws", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Kavya");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const throwing: VoiceIntentInterpreterV2 = {
      interpret: async () => {
        throw new Error("boom");
      },
    };
    setVoiceIntentInterpreterV2ForTests(throwing);
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "anything" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("unknown_intent");
    expect(res.body.action).toBe("reject");
  });
});

describe("POST /api/athlete/voice/interpret-v2 — expanded fillable fields", () => {
  test("a standalone heart-rate reading classifies as log_heart_rate, not log_rpe", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Meera");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "my waking heart rate was 52 and resting heart rate before bed was 58" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("log_heart_rate");
    expect(res.body.entities.wakeHr).toBe(52);
    expect(res.body.entities.bedHr).toBe(58);
    expect(res.body.action).toBe("ready_to_confirm");
  });

  test("resting heart rate mentioned inside an RPE workflow still goes to log_rpe, not log_heart_rate", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Naveen");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "log my rpe, category endurance, planned intensity 70 percent, resting heart rate 55" });
    expect(res.body.intent).toBe("log_rpe");
  });

  test("height/weight/position classify as update_profile and never touch name or coachId", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Omkar");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "update my height to 178 centimetres and my position is striker" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("update_profile");
    expect(res.body.entities.heightCm).toBe(178);
    expect(res.body.entities.position).toBe("striker");
    expect(res.body.entities.name).toBeUndefined();
    expect(res.body.entities.coachId).toBeUndefined();
  });

  test("a general 'what am I missing today' question classifies as show_daily_checklist, answers immediately", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Priya");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret-v2")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "what am I missing today" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("show_daily_checklist");
    expect(res.body.action).toBe("answer");
    expect(res.body.requiresConfirmation).toBe(false);
  });
});

describe("GET /api/athlete/voice/today-checklist", () => {
  test("reports every category missing on a day with nothing logged", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Qadir");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .get("/api/athlete/voice/today-checklist")
      .set("Cookie", [`accessToken=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.missing.sort()).toEqual(["recovery", "session", "water", "wellness"]);
    expect(res.body.logged).toEqual([]);
  });

  test("a heart-rate-only Wellness row does not count as a wellness check-in", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("Ravi");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    await Wellness.create({ athleteId: profile._id, date: TODAY, wakeHrBpm: 52, wakeHrAt: new Date() });
    const res = await request(app)
      .get("/api/athlete/voice/today-checklist")
      .set("Cookie", [`accessToken=${token}`]);
    expect(res.body.missing).toContain("wellness");
  });

  test("logging water removes water from the missing list", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("Sana");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    await WaterIntake.create({ athleteId: profile._id, date: TODAY, amountMl: 500, loggedAt: new Date() });
    const res = await request(app)
      .get("/api/athlete/voice/today-checklist")
      .set("Cookie", [`accessToken=${token}`]);
    expect(res.body.logged).toContain("water");
    expect(res.body.missing).not.toContain("water");
  });
});

describe("POST /api/athlete/voice/interpret-v2 — rate limiting", () => {
  test("the generous voice limiter is independent of the 40/min write limiter", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Lakshmi");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    for (let i = 0; i < 41; i++) {
      const res = await request(app)
        .post("/api/athlete/voice/interpret-v2")
        .set("Cookie", [`accessToken=${token}`])
        .send({ transcript: "open today" });
      expect(res.status).toBe(200);
    }
  });
});

describe("sanitizeModelOutput — malformed model output never reaches the policy engine unvalidated", () => {
  test("an unknown intent name is downgraded to unknown_intent with zero confidence", () => {
    const result = sanitizeModelOutput({ intent: "delete_everything", entities: {}, confidence: 0.9 });
    expect(result.intent).toBe("unknown_intent");
    expect(result.confidence).toBe(0);
  });

  test("missing confidence or non-object entities is rejected wholesale", () => {
    expect(sanitizeModelOutput({ intent: "log_wellness", entities: { sleepQuality: 8 } }).intent).toBe("unknown_intent");
    expect(sanitizeModelOutput({ intent: "log_wellness", entities: "not an object", confidence: 0.8 }).intent).toBe("unknown_intent");
    expect(sanitizeModelOutput(null).intent).toBe("unknown_intent");
    expect(sanitizeModelOutput("a plain string").intent).toBe("unknown_intent");
  });

  test("confidence is clamped into [0,1]", () => {
    expect(sanitizeModelOutput({ intent: "show_readiness", entities: {}, confidence: 5 }).confidence).toBe(1);
    expect(sanitizeModelOutput({ intent: "show_readiness", entities: {}, confidence: -3 }).confidence).toBe(0);
  });
});
