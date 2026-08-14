import fs from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app";
import { signAccessToken } from "../src/lib/tokens";
import { User, type UserRole } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import { DeviceToken } from "../src/models/DeviceToken";
import { NotificationPreference } from "../src/models/NotificationPreference";
import { Notification } from "../src/models/Notification";
import { NotificationDecision } from "../src/models/NotificationDecision";
import { TrainingSession, type SessionSlot } from "../src/models/TrainingSession";
import { RpeMonitoring, type RpeSessionType } from "../src/models/RpeMonitoring";
import { Wellness } from "../src/models/Wellness";
import { WaterIntake } from "../src/models/WaterIntake";
import { Attendance } from "../src/models/Attendance";
import { AthleteNote } from "../src/models/AthleteNote";
import { sendMessage } from "../src/services/messaging";
import { notifyGuardiansOfAthleteUpdate } from "../src/services/notifications";
import { runSweep } from "../src/services/notificationSweep";
import {
  setPushDeliveryAdapterForTests,
  type PushDeliveryAdapter,
  type PushSendInput,
  type PushSendResult,
} from "../src/services/fcmDelivery";

type DummyUser = { _id: Types.ObjectId; name: string; role: UserRole };
type DummyProfile = { _id: Types.ObjectId };
type Actor = {
  user: DummyUser;
  profile?: DummyProfile;
};

type ReportRow = {
  id: string;
  dummyUser: string;
  role: UserRole;
  scenario: string;
  testData: string;
  expectedType: string;
  trigger: string;
  triggeredAt: string | null;
  exactNotificationMessage: string | null;
  pass: boolean;
  proof: {
    notificationDb?: unknown;
    decisionDb?: unknown;
    apiResponse?: unknown;
    pushLog?: unknown;
    codeSearch?: string;
  };
  notes?: string;
};

class AuditPushAdapter implements PushDeliveryAdapter {
  calls: Array<{ at: string; input: PushSendInput }> = [];

  async send(input: PushSendInput): Promise<PushSendResult[]> {
    this.calls.push({ at: new Date().toISOString(), input });
    return input.tokens.map((t, index) => ({
      token: t.token,
      ok: true,
      messageId: `audit-${input.data.type}-${index}`,
    }));
  }

  reset(): void {
    this.calls = [];
  }
}

let mongo: MongoMemoryServer;
const app = createApp();
const pushAdapter = new AuditPushAdapter();
const report: ReportRow[] = [];
const academyId = new Types.ObjectId();

const auditToday = new Date(Date.UTC(2026, 6, 28));

function isoDay(offset = 0): string {
  return new Date(auditToday.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function day(offset = 0): Date {
  return new Date(`${isoDay(offset)}T00:00:00.000Z`);
}

function bearer(user: { _id: Types.ObjectId; role: UserRole }): string {
  return `Bearer ${signAccessToken({ sub: user._id.toString(), role: user.role })}`;
}

async function clearDb(): Promise<void> {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
  pushAdapter.reset();
}

async function makeUser(name: string, role: UserRole): Promise<DummyUser> {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${role}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}@audit.test`;
  const user = await User.create({
    email,
    passwordHash: "x",
    role,
    name,
    academyId,
    isActive: true,
  });
  return { _id: user._id as Types.ObjectId, name: user.name as string, role: user.role as UserRole };
}

async function makeAthlete(name: string, timezone = "UTC"): Promise<Actor> {
  const user = await makeUser(name, "athlete");
  const profile = await AthleteProfile.create({
    userId: user._id,
    academyId,
    sport: "Track",
    position: "Sprinter",
    timezone,
    hydrationGoalMl: 3000,
  });
  return { user, profile: { _id: profile._id as Types.ObjectId } };
}

async function makeCoach(name: string): Promise<Actor> {
  return { user: await makeUser(name, "coach") };
}

async function makeGuardian(name: string): Promise<Actor> {
  return { user: await makeUser(name, "guardian") };
}

async function allowPush(userId: Types.ObjectId, tokenName?: string): Promise<void> {
  await DeviceToken.create({
    userId,
    platform: "android",
    token: tokenName ?? `token-${userId.toString()}`,
  });
  await NotificationPreference.create({
    userId,
    quietHours: { enabled: false },
    dailyCap: 50,
    minIntervalMinutes: 0,
  });
}

async function assign(coachId: Types.ObjectId, athleteId: Types.ObjectId): Promise<void> {
  await CoachAthleteAssignment.create({ coachId, athleteId, assignedBy: coachId });
}

async function linkGuardian(guardianId: Types.ObjectId, athleteId: Types.ObjectId): Promise<void> {
  await GuardianAthleteLink.create({ guardianId, athleteId, relationship: "Parent" });
}

async function seedRpe(athleteId: Types.ObjectId, date: Date, sessionType: RpeSessionType): Promise<void> {
  await RpeMonitoring.create({
    academyId,
    athleteId,
    date,
    day: "Tuesday",
    sessionType,
    trainingCategory: "ENDURANCE",
    plannedIntensityPercent: 60,
    rpe: 4,
    sleepQuality: 4,
    muscleSoreness: 1,
    fatigue: 1,
    moodMotivation: 4,
  });
}

async function seedAllRpeSlots(athleteId: Types.ObjectId, date: Date): Promise<void> {
  await Promise.all((["AM", "AFT", "PM"] as RpeSessionType[]).map((slot) => seedRpe(athleteId, date, slot)));
}

async function seedCompletedCheckIn(athleteId: Types.ObjectId, date: Date): Promise<void> {
  await Wellness.create({
    athleteId,
    date,
    sleepHours: 8,
    sleepQuality: 4,
    mood: 4,
    stress: 2,
    soreness: 2,
    fatigue: 2,
  });
}

async function seedCompletedSession(athleteId: Types.ObjectId, date: Date, slot: SessionSlot = "AM"): Promise<void> {
  await TrainingSession.create({
    athleteId,
    coachId: new Types.ObjectId(),
    date,
    slot,
    status: "completed",
    attended: true,
    type: "Speed",
  });
}

async function apiInbox(user: { _id: Types.ObjectId; role: UserRole }, expectedType: string): Promise<unknown> {
  const res = await request(app).get("/api/notifications?limit=20").set("Authorization", bearer(user));
  expect(res.status).toBe(200);
  return {
    unreadCount: res.body.unreadCount,
    matching: (res.body.notifications as Array<Record<string, unknown>>).filter((n) => n.type === expectedType),
  };
}

async function capture(
  id: string,
  dummyUser: { _id: Types.ObjectId; name: string; role: UserRole },
  scenario: string,
  testData: string,
  expectedType: string,
  trigger: string,
  notes?: string
): Promise<ReportRow> {
  const notification = await Notification.findOne({
    recipientUserId: dummyUser._id,
    type: expectedType,
  })
    .sort({ createdAt: -1 })
    .lean();
  const decision = await NotificationDecision.findOne({
    userId: dummyUser._id,
    type: expectedType,
    status: "sent",
  })
    .sort({ sentTime: -1 })
    .lean();
  const matchingPush = pushAdapter.calls
    .flatMap((call) =>
      call.input.tokens.map((token) => ({
        at: call.at,
        token: token.token,
        type: call.input.data.type,
        title: call.input.data.title,
        body: call.input.data.body,
        link: call.input.data.link,
      }))
    )
    .filter((call) => call.type === expectedType && call.token === `token-${dummyUser._id.toString()}`);
  const apiResponse = await apiInbox(dummyUser, expectedType);
  const pass = Boolean(notification && decision?.status === "sent" && matchingPush.length > 0);
  const row: ReportRow = {
    id,
    dummyUser: dummyUser.name,
    role: dummyUser.role,
    scenario,
    testData,
    expectedType,
    trigger,
    triggeredAt: (decision?.sentTime as Date | undefined)?.toISOString() ?? null,
    exactNotificationMessage: notification ? `${notification.title}: ${notification.body ?? ""}` : null,
    pass,
    proof: {
      notificationDb: notification
        ? {
            id: notification._id.toString(),
            type: notification.type,
            title: notification.title,
            body: notification.body,
            priority: notification.priority,
            link: notification.link,
            createdAt: (notification.createdAt as Date).toISOString(),
          }
        : null,
      decisionDb: decision
        ? {
            id: decision._id.toString(),
            status: decision.status,
            dedupKey: decision.dedupKey,
            sentTime: (decision.sentTime as Date).toISOString(),
            deliveryResult: decision.deliveryResult,
          }
        : null,
      apiResponse,
      pushLog: matchingPush,
    },
    notes,
  };
  report.push(row);
  expect(row.pass).toBe(true);
  return row;
}

async function runSweepScenario(now: Date): Promise<void> {
  const result = await runSweep({ limit: 100, pages: 1, cursor: null, now });
  expect(result.usersProcessed).toBeGreaterThan(0);
}

function recordMissing(expectedType: string, label: string): void {
  report.push({
    id: `missing-${expectedType}`,
    dummyUser: "N/A",
    role: "athlete",
    scenario: label,
    testData: "Static code audit only; no candidate builder or notification type exists in notificationSweep/templates.",
    expectedType,
    trigger: "No trigger available",
    triggeredAt: null,
    exactNotificationMessage: null,
    pass: false,
    proof: {
      codeSearch: `rg found no implemented notification type named "${expectedType}" in server/src notification sweep/templates/routes.`,
    },
    notes: "Product gap: requested by audit, but not implemented in the current notification feature.",
  });
}

function writeReport(): void {
  const outDir = path.resolve(__dirname, "../../builds");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "notification-scenario-audit.json"),
    JSON.stringify(report, null, 2)
  );
  const lines = [
    "# Notification Scenario Audit",
    "",
    "| ID | Dummy user | Role | Expected notification | Triggered at | Result | Message | Proof |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.map((row) => {
      const proof = row.pass
        ? row.proof.decisionDb
          ? "Notification DB + decision DB + API inbox + push log"
          : "Notification DB + API inbox"
        : row.proof.codeSearch ?? "No proof";
      const cells = [
        row.id,
        row.dummyUser,
        row.role,
        row.expectedType,
        row.triggeredAt ?? "not triggered",
        row.pass ? "PASS" : "FAIL",
        (row.exactNotificationMessage ?? row.notes ?? "").replace(/\|/g, "/"),
        proof.replace(/\|/g, "/"),
      ];
      return `| ${cells.join(" | ")} |`;
    }),
  ];
  fs.writeFileSync(path.join(outDir, "notification-scenario-audit.md"), `${lines.join("\n")}\n`);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  setPushDeliveryAdapterForTests(pushAdapter);
});

afterAll(async () => {
  writeReport();
  setPushDeliveryAdapterForTests(null);
  await mongoose.disconnect();
  await mongo.stop();
});

describe("notification scenario audit with dummy users", () => {
  test("sweep-driven athlete reminders, digests, milestones, and coach digests", async () => {
    await clearDb();
    const athlete = await makeAthlete("Daily Reminder Athlete");
    await allowPush(athlete.user._id);
    await seedAllRpeSlots(athlete.profile!._id, day());
    await runSweepScenario(new Date(`${isoDay()}T20:15:00.000Z`));
    await capture(
      "athlete-daily-checkin",
      athlete.user,
      "Athlete did not complete today's wellness check-in before the 20:00 local reminder.",
      `Date ${isoDay()}; timezone UTC; all RPE slots already logged to isolate the daily check-in reminder.`,
      "daily_checkin_reminder",
      "runSweep at 2026-07-28T20:15:00.000Z"
    );

    await clearDb();
    const trainingAthlete = await makeAthlete("Training Reminder Athlete");
    await allowPush(trainingAthlete.user._id);
    await seedCompletedCheckIn(trainingAthlete.profile!._id, day());
    await seedAllRpeSlots(trainingAthlete.profile!._id, day());
    await TrainingSession.create({
      athleteId: trainingAthlete.profile!._id,
      coachId: new Types.ObjectId(),
      date: day(),
      slot: "AFT",
      status: "planned",
      type: "Strength",
    });
    await runSweepScenario(new Date(`${isoDay()}T12:05:00.000Z`));
    await capture(
      "athlete-training-session",
      trainingAthlete.user,
      "Athlete has a planned Afternoon session and has not marked it completed/skipped/rest.",
      `Date ${isoDay()}; planned TrainingSession slot AFT; check-in and RPE already completed.`,
      "training_session_reminder",
      "runSweep at 2026-07-28T12:05:00.000Z"
    );

    await clearDb();
    const rpeAthlete = await makeAthlete("RPE Reminder Athlete");
    await allowPush(rpeAthlete.user._id);
    await seedCompletedCheckIn(rpeAthlete.profile!._id, day());
    await seedRpe(rpeAthlete.profile!._id, day(), "AM");
    await seedRpe(rpeAthlete.profile!._id, day(), "AFT");
    await runSweepScenario(new Date(`${isoDay()}T16:05:00.000Z`));
    await capture(
      "athlete-rpe-pm",
      rpeAthlete.user,
      "Athlete logged AM/Afternoon RPE but has not logged PM RPE after the PM threshold.",
      `Date ${isoDay()}; RPE AM and AFT exist; RPE PM missing.`,
      "rpe_monitoring_reminder",
      "runSweep at 2026-07-28T16:05:00.000Z"
    );

    await clearDb();
    const hydrationAthlete = await makeAthlete("Hydration Reminder Athlete");
    await allowPush(hydrationAthlete.user._id);
    await seedCompletedCheckIn(hydrationAthlete.profile!._id, day());
    await seedAllRpeSlots(hydrationAthlete.profile!._id, day());
    await runSweepScenario(new Date(`${isoDay()}T14:05:00.000Z`));
    await capture(
      "athlete-hydration-reminder",
      hydrationAthlete.user,
      "Athlete has not met today's hydration goal after the 14:00 local reminder time.",
      `Date ${isoDay()}; hydrationGoalMl=3000; WaterIntake total=0ml; check-in and RPE already completed.`,
      "hydration_reminder",
      "runSweep at 2026-07-28T14:05:00.000Z",
      "This is an Apex/system reminder, not a coach message."
    );

    await clearDb();
    const missedAthlete = await makeAthlete("Missed Activity Athlete");
    await allowPush(missedAthlete.user._id);
    await seedRpe(missedAthlete.profile!._id, day(), "AM");
    await TrainingSession.create({
      athleteId: missedAthlete.profile!._id,
      coachId: new Types.ObjectId(),
      date: day(-1),
      slot: "PM",
      status: "planned",
      type: "Strength",
    });
    await runSweepScenario(new Date(`${isoDay()}T08:30:00.000Z`));
    await capture(
      "athlete-missed-activity",
      missedAthlete.user,
      "Athlete has an unresolved planned training session from yesterday.",
      `TrainingSession date=${isoDay(-1)}; slot=PM; status=planned.`,
      "missed_activity_reminder",
      "runSweep at 2026-07-28T08:30:00.000Z"
    );

    await clearDb();
    const weeklyAthlete = await makeAthlete("Weekly Summary Athlete");
    await allowPush(weeklyAthlete.user._id);
    await seedAllRpeSlots(weeklyAthlete.profile!._id, day());
    for (const offset of [-6, -4, -2, 0]) {
      await seedCompletedCheckIn(weeklyAthlete.profile!._id, day(offset));
    }
    for (const offset of [-5, -3]) {
      await seedCompletedSession(weeklyAthlete.profile!._id, day(offset));
    }
    await runSweepScenario(new Date(`${isoDay()}T09:10:00.000Z`));
    await capture(
      "athlete-weekly-summary",
      weeklyAthlete.user,
      "Athlete has weekly activity data and is past the 09:00 weekly summary threshold.",
      "4 check-ins and 2 completed sessions in the 7-day window.",
      "athlete_weekly_summary",
      "runSweep at 2026-07-28T09:10:00.000Z"
    );

    await clearDb();
    const streakAthlete = await makeAthlete("Streak Milestone Athlete");
    await allowPush(streakAthlete.user._id);
    await seedAllRpeSlots(streakAthlete.profile!._id, day());
    for (let offset = -6; offset <= 0; offset++) {
      await seedCompletedCheckIn(streakAthlete.profile!._id, day(offset));
    }
    await runSweepScenario(new Date(`${isoDay()}T09:15:00.000Z`));
    await capture(
      "athlete-streak-milestone",
      streakAthlete.user,
      "Athlete completed a 7-day check-in streak.",
      `Wellness rows exist for ${isoDay(-6)} through ${isoDay(0)}.`,
      "streak_milestone",
      "runSweep at 2026-07-28T09:15:00.000Z",
      "This is the implemented achievement notification."
    );

    await clearDb();
    const coach = await makeCoach("Squad Digest Coach");
    const athleteOne = await makeAthlete("Squad Athlete One");
    const athleteTwo = await makeAthlete("Squad Athlete Two");
    await allowPush(coach.user._id);
    await assign(coach.user._id, athleteOne.profile!._id);
    await assign(coach.user._id, athleteTwo.profile!._id);
    await Attendance.create({ athleteId: athleteOne.profile!._id, date: day(-1), status: "present" });
    await Attendance.create({ athleteId: athleteTwo.profile!._id, date: day(-1), status: "present" });
    await RpeMonitoring.create({
      academyId,
      athleteId: athleteTwo.profile!._id,
      coachId: coach.user._id,
      date: day(-1),
      day: "Monday",
      sessionType: "AM",
      trainingCategory: "ENDURANCE",
      plannedIntensityPercent: 90,
      rpe: 9,
      sleepQuality: 2,
      muscleSoreness: 4,
      fatigue: 5,
      moodMotivation: 2,
    });
    await runSweepScenario(new Date(`${isoDay()}T09:20:00.000Z`));
    await capture(
      "coach-squad-digest",
      coach.user,
      "Coach has assigned athletes with attendance and one readiness flag this week.",
      "2 present attendance rows and 1 red RPE row in the 7-day window.",
      "coach_squad_digest",
      "runSweep at 2026-07-28T09:20:00.000Z"
    );

    await clearDb();
    const noteCoach = await makeCoach("Note Reply Coach");
    const noteAthlete = await makeAthlete("Note Athlete");
    await allowPush(noteCoach.user._id);
    await assign(noteCoach.user._id, noteAthlete.profile!._id);
    const note = await AthleteNote.create({
      athleteId: noteAthlete.profile!._id,
      date: day(-2),
      body: "Knee felt tight after cooldown.",
    });
    await AthleteNote.collection.updateOne(
      { _id: note._id },
      { $set: { createdAt: new Date(`${isoDay(-2)}T07:00:00.000Z`) } }
    );
    await runSweepScenario(new Date(`${isoDay()}T08:00:00.000Z`));
    await capture(
      "coach-note-needs-reply",
      noteCoach.user,
      "Athlete note is older than the 24h reply window and no coach comment exists after it.",
      `AthleteNote createdAt ${isoDay(-2)}T07:00:00.000Z.`,
      "note_needs_reply",
      "runSweep at 2026-07-28T08:00:00.000Z"
    );
  });

  test("event-driven notifications through services and API routes", async () => {
    await clearDb();
    const coach = await makeCoach("Message Coach");
    const athlete = await makeAthlete("Message Athlete");
    await allowPush(athlete.user._id);
    await assign(coach.user._id, athlete.profile!._id);
    await sendMessage({
      coachId: coach.user._id,
      athleteId: athlete.profile!._id,
      senderRole: "coach",
      body: "Bring spikes tomorrow.",
    });
    await capture(
      "message-coach-to-athlete",
      athlete.user,
      "Coach sends athlete a direct message.",
      "Direct message body: Bring spikes tomorrow.",
      "message",
      "sendMessage service"
    );

    await clearDb();
    const announcementCoach = await makeCoach("Announcement Coach");
    const announcementAthlete = await makeAthlete("Announcement Athlete");
    await allowPush(announcementAthlete.user._id);
    await assign(announcementCoach.user._id, announcementAthlete.profile!._id);
    const announcementRes = await request(app)
      .post("/api/coach/announcements")
      .set("Authorization", bearer(announcementCoach.user))
      .send({ body: "Team meeting at 6 PM." });
    expect(announcementRes.status).toBe(201);
    await capture(
      "coach-announcement",
      announcementAthlete.user,
      "Coach broadcasts to assigned athletes.",
      `API response recipientCount=${announcementRes.body.recipientCount}; body=Team meeting at 6 PM.`,
      "announcement",
      "POST /api/coach/announcements"
    );

    await clearDb();
    const feedbackCoach = await makeCoach("Feedback Coach");
    const feedbackAthlete = await makeAthlete("Feedback Athlete");
    await allowPush(feedbackAthlete.user._id);
    await assign(feedbackCoach.user._id, feedbackAthlete.profile!._id);
    const commentRes = await request(app)
      .post(`/api/coach/athletes/${feedbackAthlete.profile!._id.toString()}/comment`)
      .set("Authorization", bearer(feedbackCoach.user))
      .send({ date: isoDay(), body: "Good posture today. Keep cadence relaxed." });
    expect(commentRes.status).toBe(201);
    await capture(
      "coach-feedback",
      feedbackAthlete.user,
      "Coach posts feedback on an assigned athlete.",
      "Comment body: Good posture today. Keep cadence relaxed.",
      "coach_feedback",
      "POST /api/coach/athletes/:athleteId/comment"
    );

    await clearDb();
    const riskCoach = await makeCoach("Risk Flag Coach");
    const riskAthlete = await makeAthlete("Risk Flag Athlete");
    await allowPush(riskCoach.user._id);
    await assign(riskCoach.user._id, riskAthlete.profile!._id);
    const rpeRes = await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", bearer(riskAthlete.user))
      .send({
        date: isoDay(),
        sessionType: "AM",
        trainingCategory: "ENDURANCE",
        plannedIntensityPercent: 90,
        rpe: 9,
        sleepQuality: 2,
        muscleSoreness: 4,
        fatigue: 5,
        moodMotivation: 2,
      });
    expect([200, 201]).toContain(rpeRes.status);
    await capture(
      "readiness-risk-flag",
      riskCoach.user,
      "Athlete submits red/amber RPE readiness data.",
      `API riskFlag=${rpeRes.body.entry.riskFlag}; reasons=${rpeRes.body.entry.riskReasons.join("; ")}`,
      "readiness_risk_flag",
      "POST /api/athlete/rpe-monitoring"
    );

    await clearDb();
    const injuryCoach = await makeCoach("Injury Coach");
    const injuryAthlete = await makeAthlete("Injury Athlete");
    const injuryGuardian = await makeGuardian("Injury Guardian");
    await allowPush(injuryCoach.user._id);
    await allowPush(injuryGuardian.user._id);
    await assign(injuryCoach.user._id, injuryAthlete.profile!._id);
    await linkGuardian(injuryGuardian.user._id, injuryAthlete.profile!._id);
    const injuryRes = await request(app)
      .post(`/api/coach/athletes/${injuryAthlete.profile!._id.toString()}/injuries`)
      .set("Authorization", bearer(injuryCoach.user))
      .send({ bodyPart: "Right hamstring", severity: "severe", restriction: "No sprinting for 7 days" });
    expect(injuryRes.status).toBe(201);
    await capture(
      "injury-alert-coach",
      injuryCoach.user,
      "Coach logs severe injury for assigned athlete.",
      "bodyPart=Right hamstring; severity=severe; restriction=No sprinting for 7 days.",
      "injury_alert",
      "POST /api/coach/athletes/:athleteId/injuries",
      "Severe injury bypasses quiet hours and caps."
    );
    await capture(
      "injury-alert-guardian",
      injuryGuardian.user,
      "Linked guardian receives the same severe injury alert.",
      "GuardianAthleteLink active for the injured athlete.",
      "injury_alert",
      "POST /api/coach/athletes/:athleteId/injuries",
      "Severe injury bypasses quiet hours and caps."
    );

    await clearDb();
    const guardian = await makeGuardian("Update Guardian");
    const updateAthlete = await makeAthlete("Update Athlete");
    await linkGuardian(guardian.user._id, updateAthlete.profile!._id);
    await notifyGuardiansOfAthleteUpdate(
      updateAthlete.profile!._id,
      "Update Athlete - Wellness",
      "Update Athlete just logged wellness."
    );
    const notification = await Notification.findOne({ recipientUserId: guardian.user._id, type: "athlete_update" }).lean();
    const inbox = await apiInbox(guardian.user, "athlete_update");
    report.push({
      id: "guardian-athlete-update",
      dummyUser: guardian.user.name,
      role: guardian.user.role,
      scenario: "Linked athlete logs a guardian-visible data point.",
      testData: "Called notifyGuardiansOfAthleteUpdate with Wellness copy.",
      expectedType: "athlete_update",
      trigger: "notifyGuardiansOfAthleteUpdate helper",
      triggeredAt: (notification?.createdAt as Date | undefined)?.toISOString() ?? null,
      exactNotificationMessage: notification ? `${notification.title}: ${notification.body ?? ""}` : null,
      pass: Boolean(notification),
      proof: {
        notificationDb: notification
          ? {
              id: notification._id.toString(),
              type: notification.type,
              title: notification.title,
              body: notification.body,
              createdAt: (notification.createdAt as Date).toISOString(),
            }
          : null,
        apiResponse: inbox,
        pushLog: [],
      },
      notes: "Existing guardian update is in-app only; no NotificationDecision/push row is created.",
    });
    expect(notification).toBeTruthy();
  });

  test("requested notification types that are not implemented yet are reported as product gaps", () => {
    recordMissing("weigh_in_reminder", "Weigh-in reminder requested by audit.");
    recordMissing("streak_warning", "Streak warning requested by audit.");
    recordMissing("inactive_user_reminder", "Inactive-user reminder requested by audit.");
  });
});
