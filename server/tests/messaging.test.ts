import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { Notification } from "../src/models/Notification";
import { Message } from "../src/models/Message";
import coachRouter from "../src/routes/coach";
import athleteRouter from "../src/routes/athlete";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteRouter);
  return app;
}

/** A coach + an assigned athlete (User + AthleteProfile + active assignment). */
async function seedPair() {
  const coach = await User.create({ email: "coach@m.io", passwordHash: "x", role: "coach", name: "Coach Ada" });
  const athleteUser = await User.create({ email: "ath@m.io", passwordHash: "x", role: "athlete", name: "Bo Athlete" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "football" });
  await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, endedAt: null });
  return { coach, athleteUser, profile };
}

function coachToken(id: Types.ObjectId) {
  return signAccessToken({ sub: id.toString(), role: "coach" });
}
function athleteToken(id: Types.ObjectId) {
  return signAccessToken({ sub: id.toString(), role: "athlete" });
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

describe("Coach⇄athlete direct messaging", () => {
  test("coach sends → athlete reads the thread, athlete replies → coach reads; notifications fan out", async () => {
    const app = buildApp();
    const { coach, athleteUser, profile } = await seedPair();
    const cTok = coachToken(coach._id);
    const aTok = athleteToken(athleteUser._id);

    // Coach sends
    const sent = await request(app)
      .post(`/api/coach/athletes/${profile._id}/messages`)
      .set("Authorization", `Bearer ${cTok}`)
      .send({ body: "Great session today" });
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ senderRole: "coach", mine: true, body: "Great session today" });

    // Athlete sees it (mine=false from their view) + an unread notification exists
    const aThread = await request(app)
      .get(`/api/athlete/messages/${coach._id}`)
      .set("Authorization", `Bearer ${aTok}`);
    expect(aThread.status).toBe(200);
    expect(aThread.body.messages).toHaveLength(1);
    expect(aThread.body.messages[0]).toMatchObject({ senderRole: "coach", mine: false });
    expect(await Notification.countDocuments({ recipientUserId: athleteUser._id, type: "message" })).toBe(1);

    // Athlete replies
    const reply = await request(app)
      .post(`/api/athlete/messages/${coach._id}`)
      .set("Authorization", `Bearer ${aTok}`)
      .send({ body: "Thanks coach!" });
    expect(reply.status).toBe(201);
    expect(reply.body.message).toMatchObject({ senderRole: "athlete", mine: true });

    // Coach sees both, chronological, with the reply as not-mine
    const cThread = await request(app)
      .get(`/api/coach/athletes/${profile._id}/messages`)
      .set("Authorization", `Bearer ${cTok}`);
    expect(cThread.body.messages.map((m: { body: string }) => m.body)).toEqual([
      "Great session today",
      "Thanks coach!",
    ]);
    expect(cThread.body.messages[1]).toMatchObject({ senderRole: "athlete", mine: false });
    expect(await Notification.countDocuments({ recipientUserId: coach._id, type: "message" })).toBe(1);
  });

  test("unread counts + mark-read are per-recipient and symmetric", async () => {
    const app = buildApp();
    const { coach, athleteUser, profile } = await seedPair();
    const cTok = coachToken(coach._id);
    const aTok = athleteToken(athleteUser._id);

    // Coach sends two; athlete has 2 unread, coach has 0
    await request(app).post(`/api/coach/athletes/${profile._id}/messages`).set("Authorization", `Bearer ${cTok}`).send({ body: "one" });
    await request(app).post(`/api/coach/athletes/${profile._id}/messages`).set("Authorization", `Bearer ${cTok}`).send({ body: "two" });

    let aUnread = await request(app).get("/api/athlete/messages/unread-count").set("Authorization", `Bearer ${aTok}`);
    let cUnread = await request(app).get("/api/coach/messages/unread-count").set("Authorization", `Bearer ${cTok}`);
    expect(aUnread.body.unreadCount).toBe(2);
    expect(cUnread.body.unreadCount).toBe(0);

    // Athlete marks the thread read → their unread drops to 0; coach unaffected
    const marked = await request(app).post(`/api/athlete/messages/${coach._id}/read`).set("Authorization", `Bearer ${aTok}`);
    expect(marked.body.marked).toBe(2);
    aUnread = await request(app).get("/api/athlete/messages/unread-count").set("Authorization", `Bearer ${aTok}`);
    expect(aUnread.body.unreadCount).toBe(0);

    // Athlete sends one → coach now has 1 unread; marking read clears it
    await request(app).post(`/api/athlete/messages/${coach._id}`).set("Authorization", `Bearer ${aTok}`).send({ body: "hi" });
    cUnread = await request(app).get("/api/coach/messages/unread-count").set("Authorization", `Bearer ${cTok}`);
    expect(cUnread.body.unreadCount).toBe(1);
    const cMarked = await request(app).post(`/api/coach/athletes/${profile._id}/messages/read`).set("Authorization", `Bearer ${cTok}`);
    expect(cMarked.body.marked).toBe(1);
    cUnread = await request(app).get("/api/coach/messages/unread-count").set("Authorization", `Bearer ${cTok}`);
    expect(cUnread.body.unreadCount).toBe(0);
  });

  test("thread lists surface the last message, counterpart name, and unread count", async () => {
    const app = buildApp();
    const { coach, athleteUser, profile } = await seedPair();
    const cTok = coachToken(coach._id);
    const aTok = athleteToken(athleteUser._id);

    await request(app).post(`/api/coach/athletes/${profile._id}/messages`).set("Authorization", `Bearer ${cTok}`).send({ body: "latest from coach" });

    const cThreads = await request(app).get("/api/coach/messages/threads").set("Authorization", `Bearer ${cTok}`);
    expect(cThreads.body.threads).toHaveLength(1);
    expect(cThreads.body.threads[0]).toMatchObject({
      partyId: profile._id.toString(),
      partyName: "Bo Athlete",
      lastMessage: "latest from coach",
      lastSenderRole: "coach",
      unreadCount: 0, // coach authored it
    });

    const aThreads = await request(app).get("/api/athlete/messages/threads").set("Authorization", `Bearer ${aTok}`);
    expect(aThreads.body.threads[0]).toMatchObject({
      partyId: coach._id.toString(),
      partyName: "Coach Ada",
      lastMessage: "latest from coach",
      unreadCount: 1, // athlete hasn't read it
    });
  });

  test("scope: coach cannot message an unassigned athlete → 403", async () => {
    const app = buildApp();
    const { profile } = await seedPair();
    const otherCoach = await User.create({ email: "other@m.io", passwordHash: "x", role: "coach", name: "Other" });

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id}/messages`)
      .set("Authorization", `Bearer ${coachToken(otherCoach._id)}`)
      .send({ body: "intrusion" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
    expect(await Message.countDocuments()).toBe(0);
  });

  test("scope: athlete cannot message a coach they're not assigned to → 403 coach_not_assigned", async () => {
    const app = buildApp();
    const { athleteUser } = await seedPair();
    const strangerCoach = await User.create({ email: "stranger@m.io", passwordHash: "x", role: "coach", name: "Stranger" });

    const res = await request(app)
      .post(`/api/athlete/messages/${strangerCoach._id}`)
      .set("Authorization", `Bearer ${athleteToken(athleteUser._id)}`)
      .send({ body: "hello?" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("coach_not_assigned");
    expect(await Message.countDocuments()).toBe(0);
  });

  test("empty and over-long bodies are rejected with 400", async () => {
    const app = buildApp();
    const { coach, profile } = await seedPair();
    const cTok = coachToken(coach._id);

    const empty = await request(app).post(`/api/coach/athletes/${profile._id}/messages`).set("Authorization", `Bearer ${cTok}`).send({ body: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe("empty_message");

    const tooLong = await request(app).post(`/api/coach/athletes/${profile._id}/messages`).set("Authorization", `Bearer ${cTok}`).send({ body: "x".repeat(4001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error).toBe("message_too_long");
  });

  test("GET /api/athlete/coaches lists active coaches only (for starting a chat)", async () => {
    const app = buildApp();
    const { coach, athleteUser, profile } = await seedPair();
    // A second coach assigned to the same athlete, plus an unrelated coach.
    const coach2 = await User.create({ email: "c2@m.io", passwordHash: "x", role: "coach", name: "Coach Zed" });
    await CoachAthleteAssignment.create({ coachId: coach2._id, athleteId: profile._id, assignedBy: coach2._id, endedAt: null });
    await User.create({ email: "c3@m.io", passwordHash: "x", role: "coach", name: "Unrelated" });

    const res = await request(app)
      .get("/api/athlete/coaches")
      .set("Authorization", `Bearer ${athleteToken(athleteUser._id)}`);
    expect(res.status).toBe(200);
    const names = res.body.coaches.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["Coach Ada", "Coach Zed"]);
    expect(res.body.coaches.map((c: { coachId: string }) => c.coachId)).toContain(coach._id.toString());
  });

  test("pagination: hasMore + before returns older messages", async () => {
    const app = buildApp();
    const { coach, athleteUser, profile } = await seedPair();
    const cTok = coachToken(coach._id);
    const aTok = athleteToken(athleteUser._id);

    for (let i = 0; i < 5; i++) {
      await request(app).post(`/api/coach/athletes/${profile._id}/messages`).set("Authorization", `Bearer ${cTok}`).send({ body: `m${i}` });
    }

    const firstPage = await request(app)
      .get(`/api/athlete/messages/${coach._id}?limit=3`)
      .set("Authorization", `Bearer ${aTok}`);
    expect(firstPage.body.hasMore).toBe(true);
    // newest 3, chronological → m2,m3,m4
    expect(firstPage.body.messages.map((m: { body: string }) => m.body)).toEqual(["m2", "m3", "m4"]);

    const oldest = firstPage.body.messages[0].createdAt;
    const older = await request(app)
      .get(`/api/athlete/messages/${coach._id}?limit=3&before=${encodeURIComponent(oldest)}`)
      .set("Authorization", `Bearer ${aTok}`);
    expect(older.body.hasMore).toBe(false);
    expect(older.body.messages.map((m: { body: string }) => m.body)).toEqual(["m0", "m1"]);
  });

  test("repeating an athlete message POST with the same clientActionId does not double-send", async () => {
    const app = buildApp();
    const { coach, athleteUser, profile } = await seedPair();
    const aTok = athleteToken(athleteUser._id);
    const body = { body: "Thanks coach!", clientActionId: "msg-voice-1" };

    const first = await request(app).post(`/api/athlete/messages/${coach._id}`).set("Authorization", `Bearer ${aTok}`).send(body);
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/athlete/messages/${coach._id}`).set("Authorization", `Bearer ${aTok}`).send(body);
    expect(second.status).toBe(201);
    expect(second.body.message.id).toBe(first.body.message.id);
    expect(await Message.countDocuments({ athleteId: profile._id })).toBe(1);
  });
});
