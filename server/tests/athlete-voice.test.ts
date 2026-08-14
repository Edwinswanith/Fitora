import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import athleteRouter from "../src/routes/athlete";
import { signAccessToken } from "../src/lib/tokens";
import {
  setVoiceIntentInterpreterForTests,
  MockVoiceIntentInterpreter,
  sanitizeVoiceIntentResult,
  type VoiceIntentInterpreter,
} from "../src/services/voiceIntentInterpreter";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
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
  setVoiceIntentInterpreterForTests(new MockVoiceIntentInterpreter());
});

afterEach(() => {
  setVoiceIntentInterpreterForTests(null);
});

describe("POST /api/athlete/voice/interpret — RBAC", () => {
  test("rejects unauthenticated requests", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/athlete/voice/interpret").send({ transcript: "open recovery" });
    expect(res.status).toBe(401);
  });

  test("rejects non-athlete roles", async () => {
    const app = buildApp();
    const coach = await makeUser("coach", "Coach");
    const token = tokenFor(coach._id as Types.ObjectId, "coach");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open recovery" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_role");
  });
});

describe("POST /api/athlete/voice/interpret — contract", () => {
  test("returns a navigate intent with no confirmation required", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Arjun");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open recovery" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("navigate");
    expect(res.body.requiresConfirmation).toBe(false);
    expect(res.body.fields.target).toBe("log");
  });

  test("returns fill_wellness with extracted fields and requires confirmation", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Bala");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "sleepquality is 8 and fatigue is 6" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("fill_wellness");
    expect(res.body.requiresConfirmation).toBe(true);
  });

  test("maps sleep score to sleepQuality, not sleepHours", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Harini");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "sleep score is 8" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("fill_wellness");
    expect(res.body.fields.sleepQuality).toBe(8);
    expect(res.body.fields.sleepHours).toBeUndefined();
  });

  test("extracts Tanglish sleep hours and sleep score", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Ishaan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "naan 7 mani neram thoonginen sleep score 6" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("fill_wellness");
    expect(res.body.fields.sleepHours).toBe(7);
    expect(res.body.fields.sleepQuality).toBe(6);
  });

  test("sanitizes out-of-range wellness values from model output", () => {
    const result = sanitizeVoiceIntentResult({
      intent: "fill_wellness",
      fields: { sleepHours: 8, sleepQuality: 15 },
      missingFields: [],
      spokenResponse: "Save this check-in?",
    });
    expect(result.fields.sleepHours).toBe(8);
    expect(result.fields.sleepQuality).toBeUndefined();
    expect(result.missingFields).toContain("sleepQuality");
    expect(result.followUpQuestion).toMatch(/1 to 10/);
  });

  test("returns add_water with missingFields when amount isn't spoken", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Chetan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "I drank some water" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("add_water");
    expect(res.body.missingFields).toContain("amountMl");
    expect(res.body.followUpQuestion).toBeTruthy();
  });

  test("returns add_water with amountMl parsed when spoken", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Diya");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "drink 500 ml of water" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("add_water");
    expect(res.body.fields.amountMl).toBe(500);
    expect(res.body.missingFields).toEqual([]);
  });

  test("covers broader app feature commands", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Jaya");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");

    const cases: Array<{
      transcript: string;
      intent: string;
      assert: (body: any) => void;
    }> = [
      {
        transcript: "how am i today",
        intent: "query_status",
        assert: (body) => expect(body.fields.topic).toBe("readiness"),
      },
      {
        transcript: "mark attendance present",
        intent: "fill_attendance",
        assert: (body) => expect(body.fields.status).toBe("present"),
      },
      {
        transcript: "save recovery stretching and ice bath",
        intent: "fill_recovery",
        assert: (body) => expect(body.fields.modalities).toEqual(expect.arrayContaining(["stretching", "ice_bath"])),
      },
      {
        transcript: "add note that left knee feels tight",
        intent: "add_note",
        assert: (body) => expect(body.fields.body).toContain("left knee feels tight"),
      },
      {
        transcript: "wake heart rate is 62",
        intent: "fill_heart_rate",
        assert: (body) => expect(body.fields.wakeHr).toBe(62),
      },
      {
        transcript: "PM RPE 7 planned intensity 80 soreness 3 fatigue 4 mood 8",
        intent: "fill_rpe",
        assert: (body) => {
          expect(body.fields.slot).toBe("PM");
          expect(body.fields.rpe).toBe(7);
          expect(body.fields.plannedIntensityPercent).toBe(80);
          expect(body.fields.soreness).toBe(3);
          expect(body.fields.fatigue).toBe(4);
          expect(body.fields.mood).toBe(8);
        },
      },
      {
        transcript: "PM RPE seven planned intensity eighty fatigue four soreness three mood eight",
        intent: "fill_rpe",
        assert: (body) => {
          expect(body.fields.slot).toBe("PM");
          expect(body.fields.rpe).toBe(7);
          expect(body.fields.effortRating).toBe(7);
          expect(body.fields.plannedIntensityPercent).toBe(80);
          expect(body.fields.soreness).toBe(3);
          expect(body.fields.fatigue).toBe(4);
          expect(body.fields.mood).toBe(8);
          expect(body.missingFields).toEqual([]);
        },
      },
      {
        transcript: "send message to coach I will be late",
        intent: "send_coach_message",
        assert: (body) => expect(body.fields.body).toContain("I will be late"),
      },
    ];

    for (const item of cases) {
      const res = await request(app)
        .post("/api/athlete/voice/interpret")
        .set("Cookie", [`accessToken=${token}`])
        .send({ transcript: item.transcript });
      expect(res.status).toBe(200);
      expect(res.body.intent).toBe(item.intent);
      expect(res.body.requiresConfirmation).toBe(item.intent !== "query_status");
      item.assert(res.body);
    }
  });

  test("sanitizes out-of-range RPE and heart-rate values from model output", () => {
    const rpe = sanitizeVoiceIntentResult({
      intent: "fill_rpe",
      fields: { slot: "PM", rpe: 13, plannedIntensityPercent: 80 },
      missingFields: [],
      spokenResponse: "Save session RPE?",
    });
    expect(rpe.fields.plannedIntensityPercent).toBe(80);
    expect(rpe.fields.rpe).toBeUndefined();
    expect(rpe.missingFields).toContain("rpe");

    const heartRate = sanitizeVoiceIntentResult({
      intent: "fill_heart_rate",
      fields: { wakeHr: 500 },
      missingFields: [],
      spokenResponse: "Save heart rate?",
    });
    expect(heartRate.fields.wakeHr).toBeUndefined();
    expect(heartRate.missingFields).toContain("wakeHr");
  });

  test("keeps fill_rpe compatible with clients reading effortRating or rpe", () => {
    const fromRpe = sanitizeVoiceIntentResult({
      intent: "fill_rpe",
      fields: { slot: "PM", rpe: 7 },
      missingFields: [],
      spokenResponse: "Save session RPE?",
    });
    expect(fromRpe.fields.rpe).toBe(7);
    expect(fromRpe.fields.effortRating).toBe(7);

    const fromEffort = sanitizeVoiceIntentResult({
      intent: "fill_rpe",
      fields: { slot: "PM", effortRating: 8 },
      missingFields: [],
      spokenResponse: "Save session RPE?",
    });
    expect(fromEffort.fields.rpe).toBe(8);
    expect(fromEffort.fields.effortRating).toBe(8);
  });

  test("rejects a missing or oversized transcript", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Esha");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const missing = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({});
    expect(missing.status).toBe(400);

    const oversized = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "a".repeat(2001) });
    expect(oversized.status).toBe(400);
  });

  test("falls back to a graceful unsupported response when the interpreter throws", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Farhan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const throwing: VoiceIntentInterpreter = {
      interpret: async () => {
        throw new Error("boom");
      },
    };
    setVoiceIntentInterpreterForTests(throwing);
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open recovery" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("unsupported");
  });
});

describe("POST /api/athlete/voice/interpret — rate limiting", () => {
  test("the generous voice limiter is independent of the 40/min write limiter", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Guru");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    // 41 calls exceeds the strict write limiter (40/min) but must still succeed,
    // since /voice/interpret performs no DB write and uses its own 120/min limit.
    for (let i = 0; i < 41; i++) {
      const res = await request(app)
        .post("/api/athlete/voice/interpret")
        .set("Cookie", [`accessToken=${token}`])
        .send({ transcript: "open recovery" });
      expect(res.status).toBe(200);
    }
  });
});
