import express from "express";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { env } from "../src/config/env";
import { signAccessToken } from "../src/lib/tokens";
import { User } from "../src/models/User";
import voiceRouter from "../src/routes/voice";

let mongo: MongoMemoryServer;
const originalFetch = global.fetch;
const originalDeepgram = { ...env.deepgram };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/voice", voiceRouter);
  return app;
}

async function makeAthlete() {
  const user = await User.create({
    email: "voice-deepgram@test.io",
    passwordHash: "x",
    role: "athlete",
    name: "Voice Deepgram",
  });
  return user;
}

function tokenFor(userId: Types.ObjectId) {
  return signAccessToken({ sub: userId.toString(), role: "athlete" });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  global.fetch = originalFetch;
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  env.deepgram.apiKey = "test_deepgram_key";
  env.deepgram.sttModel = "flux-general-multi";
  env.deepgram.ttsModel = originalDeepgram.ttsModel;
  global.fetch = jest.fn(async () => {
    return new Response(
      JSON.stringify({
        results: { channels: [{ alternatives: [{ transcript: "open water" }] }] },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  env.deepgram.apiKey = originalDeepgram.apiKey;
  env.deepgram.sttModel = originalDeepgram.sttModel;
  env.deepgram.ttsModel = originalDeepgram.ttsModel;
});

test("pre-recorded transcription uses a /v1-compatible model when streaming is configured for Flux", async () => {
  const app = buildApp();
  const user = await makeAthlete();
  const token = tokenFor(user._id as Types.ObjectId);

  const res = await request(app)
    .post("/api/voice/transcribe?language=en")
    .set("Authorization", `Bearer ${token}`)
    .attach("audio", Buffer.alloc(2_000, 1), { filename: "voice.wav", contentType: "audio/wav" });

  expect(res.status).toBe(200);
  expect(res.body.transcript).toBe("open water");

  const callUrl = String((global.fetch as jest.Mock).mock.calls[0]?.[0] ?? "");
  expect(callUrl).toContain("/v1/listen?");
  expect(callUrl).toContain("model=nova-3");
  expect(callUrl).toContain("language=en");
  expect(callUrl).not.toContain("language_hint");
});
