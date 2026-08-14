import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { DeviceToken } from "../src/models/DeviceToken";
import deviceTokensRouter from "../src/routes/deviceTokens";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/device-tokens", deviceTokensRouter);
  return app;
}

async function makeAthlete(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
}

function tokenFor(userId: Types.ObjectId) {
  return signAccessToken({ sub: userId.toString(), role: "athlete" });
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
});

describe("POST /api/device-tokens", () => {
  test("registers a token for the caller", async () => {
    const user = await makeAthlete("alpha");
    const res = await request(buildApp())
      .post("/api/device-tokens")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({
        token: "tok-1",
        platform: "android",
        appVersion: "1.0.16 (17)",
        deviceName: "Pixel 8",
        osName: "Android",
        osVersion: "15",
      });
    expect(res.status).toBe(201);
    const rows = await DeviceToken.find({ userId: user._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe("android");
    expect(rows[0].appVersion).toBe("1.0.16 (17)");
    expect(rows[0].deviceName).toBe("Pixel 8");
    expect(rows[0].osName).toBe("Android");
    expect(rows[0].osVersion).toBe("15");
    expect(rows[0].disabledAt).toBeNull();
  });

  test("re-registering the same token to a different user reassigns it (upsert-by-token)", async () => {
    const userA = await makeAthlete("alpha");
    const userB = await makeAthlete("beta");
    const app = buildApp();

    await request(app)
      .post("/api/device-tokens")
      .set("Authorization", `Bearer ${tokenFor(userA._id)}`)
      .send({ token: "shared-device", platform: "ios" });
    await request(app)
      .post("/api/device-tokens")
      .set("Authorization", `Bearer ${tokenFor(userB._id)}`)
      .send({ token: "shared-device", platform: "ios" });

    const rows = await DeviceToken.find({ token: "shared-device" }).lean();
    expect(rows).toHaveLength(1);
    expect((rows[0].userId as Types.ObjectId).toString()).toBe(userB._id.toString());
  });

  test("invalid platform → 400", async () => {
    const user = await makeAthlete("alpha");
    const res = await request(buildApp())
      .post("/api/device-tokens")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({ token: "tok-1", platform: "windows-phone" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_platform");
  });

  test("missing token → 400", async () => {
    const user = await makeAthlete("alpha");
    const res = await request(buildApp())
      .post("/api/device-tokens")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({ platform: "android" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("token_required");
  });
});

describe("DELETE /api/device-tokens", () => {
  test("deletes only the caller's own token", async () => {
    const userA = await makeAthlete("alpha");
    const userB = await makeAthlete("beta");
    await DeviceToken.create({ userId: userA._id, platform: "android", token: "tok-a" });
    await DeviceToken.create({ userId: userB._id, platform: "android", token: "tok-b" });

    const res = await request(buildApp())
      .delete("/api/device-tokens")
      .set("Authorization", `Bearer ${tokenFor(userA._id)}`)
      .send({ token: "tok-b" }); // not theirs — should silently no-op, not delete
    expect(res.status).toBe(200);
    expect(await DeviceToken.countDocuments({})).toBe(2);

    const own = await request(buildApp())
      .delete("/api/device-tokens")
      .set("Authorization", `Bearer ${tokenFor(userA._id)}`)
      .send({ token: "tok-a" });
    expect(own.status).toBe(200);
    expect(await DeviceToken.countDocuments({})).toBe(1);
    expect(await DeviceToken.exists({ token: "tok-b" })).toBeTruthy();
  });
});
