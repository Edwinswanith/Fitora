import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../src/models/User";
import { DeviceToken } from "../src/models/DeviceToken";
import { NotificationPreference } from "../src/models/NotificationPreference";
import { NotificationDecision } from "../src/models/NotificationDecision";
import { Notification } from "../src/models/Notification";
import {
  evaluateAndDispatch,
  type NotificationCandidate,
} from "../src/services/notificationEligibility";
import {
  setPushDeliveryAdapterForTests,
  type PushDeliveryAdapter,
  type PushSendInput,
  type PushSendResult,
} from "../src/services/fcmDelivery";

let mongo: MongoMemoryServer;

class FakeAdapter implements PushDeliveryAdapter {
  calls: PushSendInput[] = [];
  async send(input: PushSendInput): Promise<PushSendResult[]> {
    this.calls.push(input);
    return input.tokens.map((t) => ({ token: t.token, ok: true, messageId: `fake-${t.token}` }));
  }
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

let fake: FakeAdapter;
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  fake = new FakeAdapter();
  setPushDeliveryAdapterForTests(fake);
});
afterAll(() => setPushDeliveryAdapterForTests(null));

async function makeUserWithToken() {
  const user = await User.create({ email: `u${Date.now()}${Math.random()}@t.io`, passwordHash: "x", role: "athlete", name: "A" });
  await DeviceToken.create({ userId: user._id, platform: "android", token: `tok-${user._id}` });
  return user;
}

function baseCandidate(userId: Types.ObjectId, overrides: Partial<NotificationCandidate> = {}): NotificationCandidate {
  return {
    userId,
    type: "daily_checkin_reminder",
    category: "reminders",
    priorityTier: 2,
    dedupKey: `daily_checkin_reminder:${userId.toString()}:${Math.random()}`,
    title: "Check-in reminder",
    body: "Don't forget today's check-in.",
    link: "/athlete/dashboard",
    timezone: "UTC",
    ...overrides,
  };
}

// Noon UTC — outside the default 22:00-07:00 quiet-hours window, so tests
// that aren't specifically exercising quiet hours behave the same regardless
// of the real wall-clock time the suite happens to run at.
const NOON = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));

describe("evaluateAndDispatch — core gates", () => {
  test("no active device token → skipped, no decision row, no push attempted", async () => {
    const user = await User.create({ email: "notoken@t.io", passwordHash: "x", role: "athlete", name: "A" });
    const candidate = baseCandidate(user._id);
    const outcome = await evaluateAndDispatch(candidate, { now: NOON });
    expect(outcome).toBe("skipped");
    expect(await NotificationDecision.countDocuments({})).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  test("happy path: sends push, creates in-app Notification row, records a sent decision", async () => {
    const user = await makeUserWithToken();
    const candidate = baseCandidate(user._id);
    const outcome = await evaluateAndDispatch(candidate, { now: NOON });
    expect(outcome).toBe("sent");

    const decision = await NotificationDecision.findOne({ dedupKey: candidate.dedupKey }).lean();
    expect(decision?.status).toBe("sent");
    expect(decision?.deliveryResult?.attempted).toBe(true);
    expect(decision?.deliveryResult?.providerMessageIds).toHaveLength(1);

    expect(await Notification.countDocuments({ recipientUserId: user._id })).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });

  test("createInAppNotification:false skips the in-app row (used for message/announcement/coach_feedback)", async () => {
    const user = await makeUserWithToken();
    const candidate = baseCandidate(user._id, { category: "messages", type: "message" });
    const outcome = await evaluateAndDispatch(candidate, { createInAppNotification: false, now: NOON });
    expect(outcome).toBe("sent");
    expect(await Notification.countDocuments({ recipientUserId: user._id })).toBe(0);
  });

  test("same dedupKey twice → second call is a no-op skip, only one push sent", async () => {
    const user = await makeUserWithToken();
    const candidate = baseCandidate(user._id);
    const first = await evaluateAndDispatch({ ...candidate }, { now: NOON });
    const second = await evaluateAndDispatch({ ...candidate }, { now: NOON });
    expect(first).toBe("sent");
    expect(second).toBe("skipped");
    expect(await NotificationDecision.countDocuments({ dedupKey: candidate.dedupKey })).toBe(1);
    expect(fake.calls).toHaveLength(1);
  });

  test("isActionAlreadyCompleted → permanently suppressed, no push", async () => {
    const user = await makeUserWithToken();
    const candidate = baseCandidate(user._id, {
      isActionAlreadyCompleted: async () => true,
    });
    const outcome = await evaluateAndDispatch(candidate);
    expect(outcome).toBe("suppressed");
    const decision = await NotificationDecision.findOne({ dedupKey: candidate.dedupKey }).lean();
    expect(decision?.suppressReason).toBe("already_completed");
    expect(fake.calls).toHaveLength(0);
  });

  test("user_disabled → suppressed", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({ userId: user._id, enabled: false });
    const outcome = await evaluateAndDispatch(baseCandidate(user._id));
    expect(outcome).toBe("suppressed");
    const decision = await NotificationDecision.findOne({}).lean();
    expect(decision?.suppressReason).toBe("user_disabled");
  });

  test("category_disabled → suppressed", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({
      userId: user._id,
      categories: { reminders: false, alerts: true, deadlines: true, digests: true, milestones: true, messages: true },
    });
    const outcome = await evaluateAndDispatch(baseCandidate(user._id, { category: "reminders" }));
    expect(outcome).toBe("suppressed");
    const decision = await NotificationDecision.findOne({}).lean();
    expect(decision?.suppressReason).toBe("category_disabled");
  });
});

describe("evaluateAndDispatch — quiet hours", () => {
  test("inside a wrap-past-midnight window → skipped (transient, no row written)", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({
      userId: user._id,
      quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 },
    });
    // 23:00 UTC falls inside a 22:00–07:00 wrap-around window.
    const now = new Date(Date.UTC(2026, 0, 1, 23, 0, 0));
    const outcome = await evaluateAndDispatch(baseCandidate(user._id), { now });
    expect(outcome).toBe("skipped");
    expect(await NotificationDecision.countDocuments({})).toBe(0);
  });

  test("outside the window → sends normally", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({
      userId: user._id,
      quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 },
    });
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0)); // noon — outside 22:00-07:00
    const outcome = await evaluateAndDispatch(baseCandidate(user._id), { now });
    expect(outcome).toBe("sent");
  });

  test("messages category still respects quiet hours (only cap/min-interval/presence are skipped)", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({
      userId: user._id,
      quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 },
    });
    const now = new Date(Date.UTC(2026, 0, 1, 23, 0, 0));
    const outcome = await evaluateAndDispatch(
      baseCandidate(user._id, { category: "messages", type: "message" }),
      { now }
    );
    expect(outcome).toBe("skipped");
  });

  test("override (severe injury_alert) bypasses quiet hours", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({
      userId: user._id,
      quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 },
    });
    const now = new Date(Date.UTC(2026, 0, 1, 23, 0, 0));
    const outcome = await evaluateAndDispatch(
      baseCandidate(user._id, { category: "alerts", type: "injury_alert", priorityTier: 1, override: true }),
      { now }
    );
    expect(outcome).toBe("sent");
  });
});

describe("evaluateAndDispatch — daily cap and min-interval", () => {
  test("daily cap: the (cap+1)th candidate in a category-respecting type is skipped", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({ userId: user._id, dailyCap: 1, minIntervalMinutes: 0 });
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));

    const first = await evaluateAndDispatch(baseCandidate(user._id), { now });
    expect(first).toBe("sent");

    const second = await evaluateAndDispatch(
      baseCandidate(user._id, { type: "training_session_reminder" }),
      { now: new Date(now.getTime() + 60_000) }
    );
    expect(second).toBe("skipped");
    // Transient rejection — no row written for the second candidate's dedupKey.
    expect(await NotificationDecision.countDocuments({})).toBe(1);
  });

  test("messages category is exempt from the daily cap", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({ userId: user._id, dailyCap: 1, minIntervalMinutes: 0 });
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));

    await evaluateAndDispatch(baseCandidate(user._id), { now }); // uses up the cap
    const messageOutcome = await evaluateAndDispatch(
      baseCandidate(user._id, { category: "messages", type: "message" }),
      { now: new Date(now.getTime() + 60_000) }
    );
    expect(messageOutcome).toBe("sent");
  });

  test("min-interval: a second send too soon after the last is skipped", async () => {
    const user = await makeUserWithToken();
    await NotificationPreference.create({ userId: user._id, dailyCap: 10, minIntervalMinutes: 60 });
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));

    await evaluateAndDispatch(baseCandidate(user._id), { now });
    const tooSoon = await evaluateAndDispatch(
      baseCandidate(user._id, { type: "training_session_reminder" }),
      { now: new Date(now.getTime() + 30 * 60_000) } // only 30 min later
    );
    expect(tooSoon).toBe("skipped");

    const afterInterval = await evaluateAndDispatch(
      baseCandidate(user._id, { type: "rpe_monitoring_reminder" }),
      { now: new Date(now.getTime() + 61 * 60_000) }
    );
    expect(afterInterval).toBe("sent");
  });
});

describe("evaluateAndDispatch — presence", () => {
  test("a recent heartbeat suppresses a non-transactional push (transient — no row written)", async () => {
    const user = await makeUserWithToken();
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    await NotificationPreference.create({ userId: user._id, lastActiveAt: new Date(now.getTime() - 60_000) });
    const outcome = await evaluateAndDispatch(baseCandidate(user._id), { now });
    expect(outcome).toBe("skipped");
    expect(await NotificationDecision.countDocuments({})).toBe(0);
  });

  test("a stale heartbeat does not suppress", async () => {
    const user = await makeUserWithToken();
    const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    await NotificationPreference.create({
      userId: user._id,
      lastActiveAt: new Date(now.getTime() - 60 * 60_000),
    });
    const outcome = await evaluateAndDispatch(baseCandidate(user._id), { now });
    expect(outcome).toBe("sent");
  });
});

describe("evaluateAndDispatch — invalid FCM tokens", () => {
  test("an invalidToken result soft-disables the DeviceToken row", async () => {
    const user = await makeUserWithToken();
    const badAdapter: PushDeliveryAdapter = {
      async send(input) {
        return input.tokens.map((t) => ({ token: t.token, ok: false, invalidToken: true, error: "UNREGISTERED" }));
      },
    };
    setPushDeliveryAdapterForTests(badAdapter);
    const outcome = await evaluateAndDispatch(baseCandidate(user._id), { now: NOON });
    expect(outcome).toBe("sent"); // the decision itself still "sent" — delivery failure is recorded separately
    const token = await DeviceToken.findOne({ userId: user._id }).lean();
    expect(token?.disabledAt).toBeTruthy();
    const decision = await NotificationDecision.findOne({}).lean();
    expect(decision?.deliveryResult?.errors).toContain("UNREGISTERED");
  });
});
