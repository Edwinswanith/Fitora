import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { Academy } from "../models/Academy";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../models/GuardianAthleteLink";
import { Attendance } from "../models/Attendance";
import { TrainingSession } from "../models/TrainingSession";
import { Wellness } from "../models/Wellness";
import { Recovery } from "../models/Recovery";
import { Performance } from "../models/Performance";
import { Injury } from "../models/Injury";
import { AthleteNote } from "../models/AthleteNote";
import { CoachComment } from "../models/CoachComment";
import { RpeMonitoring } from "../models/RpeMonitoring";
import { Notification } from "../models/Notification";
import { Announcement } from "../models/Announcement";
import { WaterIntake } from "../models/WaterIntake";
import { deriveLoadAndRisk, dayOfWeek } from "../lib/trainingCategories";

function utcDay(daysAgo = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}

async function upsertUser(args: {
  email: string;
  role: "coach" | "athlete" | "guardian";
  name: string;
  password: string;
  academyId?: mongoose.Types.ObjectId;
}) {
  const passwordHash = await bcrypt.hash(args.password, 10);
  return User.findOneAndUpdate(
    { email: args.email },
    {
      $set: {
        email: args.email,
        role: args.role,
        name: args.name,
        passwordHash,
        academyId: args.academyId,
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function run() {
  await connectMongo();
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Mongo not connected");
  }
  console.log("[seed] connected to", mongoose.connection.db?.databaseName);

  const academy = await Academy.findOneAndUpdate(
    { slug: "acme-academy" },
    {
      $set: {
        name: "Acme Sports Academy",
        slug: "acme-academy",
        timezone: "Asia/Kolkata",
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Admin flow has been removed — purge any legacy admin users left in the DB.
  await User.deleteMany({ role: "admin" });

  const coach = await upsertUser({
    email: "coach.kumar@acme.test",
    role: "coach",
    name: "Coach Kumar",
    password: "Coach@123",
    academyId: academy._id,
  });
  // Coach Kumar is the academy owner — can add other coaches in-app.
  await User.updateOne({ _id: coach._id }, { $set: { isAcademyOwner: true } });

  const otherCoach = await upsertUser({
    email: "coach.singh@acme.test",
    role: "coach",
    name: "Coach Singh",
    password: "Coach@123",
    academyId: academy._id,
  });

  const guardianUser = await upsertUser({
    email: "parent.rao@acme.test",
    role: "guardian",
    name: "Mr. Rao",
    password: "Guardian@123",
    academyId: academy._id,
  });

  // Athletes
  const athleteSpecs = [
    { email: "athlete.arjun@acme.test", name: "Arjun Rao", sport: "football", position: "striker" },
    { email: "athlete.bala@acme.test", name: "Bala Iyer", sport: "football", position: "midfielder" },
    { email: "athlete.chetan@acme.test", name: "Chetan Das", sport: "cricket", position: "bowler" },
    // Belongs to otherCoach — used to prove RBAC isolation
    { email: "athlete.diya@acme.test", name: "Diya Mehta", sport: "athletics", position: "sprinter" },
  ];

  const athletes: { user: any; profile: any }[] = [];
  for (const spec of athleteSpecs) {
    const user = await upsertUser({
      email: spec.email,
      role: "athlete",
      name: spec.name,
      password: "Athlete@123",
      academyId: academy._id,
    });
    const profile = await AthleteProfile.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          userId: user._id,
          academyId: academy._id,
          sport: spec.sport,
          position: spec.position,
          timezone: "Asia/Kolkata",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    athletes.push({ user, profile });
  }

  // Assignments: Coach Kumar → first 3 athletes; Coach Singh → 4th athlete
  const kumarAthletes = athletes.slice(0, 3);
  const singhAthletes = athletes.slice(3, 4);

  for (const a of kumarAthletes) {
    await CoachAthleteAssignment.updateOne(
      { coachId: coach._id, athleteId: a.profile._id, endedAt: null },
      {
        $setOnInsert: {
          coachId: coach._id,
          athleteId: a.profile._id,
          assignedBy: coach._id,
          assignedAt: new Date(),
          endedAt: null,
        },
      },
      { upsert: true }
    );
  }
  for (const a of singhAthletes) {
    await CoachAthleteAssignment.updateOne(
      { coachId: otherCoach._id, athleteId: a.profile._id, endedAt: null },
      {
        $setOnInsert: {
          coachId: otherCoach._id,
          athleteId: a.profile._id,
          assignedBy: otherCoach._id,
          assignedAt: new Date(),
          endedAt: null,
        },
      },
      { upsert: true }
    );
  }

  // Guardian → links to Arjun
  const arjun = athletes[0];
  await GuardianAthleteLink.updateOne(
    { guardianId: guardianUser._id, athleteId: arjun.profile._id, endedAt: null },
    {
      $setOnInsert: {
        guardianId: guardianUser._id,
        athleteId: arjun.profile._id,
        relationship: "father",
        endedAt: null,
      },
    },
    { upsert: true }
  );

  // ── Backfill ~30 days of realistic daily history per athlete ──────────────
  // Deterministic (no Math.random) so re-seeds reproduce the same charts. Each
  // athlete has a personality baseline; daily values oscillate around it.
  const DAYS = 30;
  const coachFor = (ai: number) => (ai < 3 ? coach : otherCoach);

  const TRAINING_CATS = [
    "MAX SPEED",
    "TEMPO / EXTENSIVE",
    "ACCELERATION (SHORT)",
    "SPEED ENDURANCE",
    "GENERAL STRENGTH & MOBILITY",
    "SPECIAL ENDURANCE I",
    "ACTIVE REST / REST",
  ];
  const PERF_METRICS = [
    { metric: "100m", unit: "s", base: 11.7, perDay: -0.004, jitter: 0.1, context: "test" },
    { metric: "vertical_jump", unit: "cm", base: 53, perDay: 0.06, jitter: 1.1, context: "test" },
    { metric: "1rm_squat", unit: "kg", base: 105, perDay: 0.3, jitter: 2, context: "training" },
  ];
  // Per-athlete baselines (Arjun strong, Bala niggle, Chetan poor sleeper, Diya sprinter).
  const personas = [
    { sleep: 7.6, qual: 4.2, loadBias: 1.0, recov: 80, hr: 53 },
    { sleep: 6.4, qual: 3.0, loadBias: 0.85, recov: 58, hr: 61 },
    { sleep: 6.0, qual: 2.6, loadBias: 0.72, recov: 50, hr: 66 },
    { sleep: 7.8, qual: 4.0, loadBias: 1.1, recov: 78, hr: 52 },
  ];

  const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const osc = (seed: number, day: number, period: number) =>
    (Math.sin(((day + seed * 1.7) / period) * Math.PI * 2) + 1) / 2; // 0..1
  const r0 = (v: number) => Math.round(v);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const i5 = (v: number) => clampN(Math.round(v), 1, 5);
  const i10 = (v: number) => clampN(Math.round(v), 1, 10);

  const athleteIds = athletes.map((a) => a.profile._id);
  // Idempotent: clear dynamic history for these athletes, then re-insert fresh.
  await Promise.all([
    Attendance.deleteMany({ athleteId: { $in: athleteIds } }),
    Wellness.deleteMany({ athleteId: { $in: athleteIds } }),
    Recovery.deleteMany({ athleteId: { $in: athleteIds } }),
    TrainingSession.deleteMany({ athleteId: { $in: athleteIds } }),
    RpeMonitoring.deleteMany({ athleteId: { $in: athleteIds } }),
    Performance.deleteMany({ athleteId: { $in: athleteIds } }),
    Injury.deleteMany({ athleteId: { $in: athleteIds } }),
    AthleteNote.deleteMany({ athleteId: { $in: athleteIds } }),
    CoachComment.deleteMany({ athleteId: { $in: athleteIds } }),
    WaterIntake.deleteMany({ athleteId: { $in: athleteIds } }),
  ]);

  const attendanceDocs: any[] = [];
  const wellnessDocs: any[] = [];
  const recoveryDocs: any[] = [];
  const sessionDocs: any[] = [];
  const rpeDocs: any[] = [];
  const perfDocs: any[] = [];
  const waterDocs: any[] = [];

  for (let ai = 0; ai < athletes.length; ai++) {
    const a = athletes[ai];
    const aCoach = coachFor(ai);
    const p = personas[ai] ?? personas[0];

    for (let di = DAYS - 1; di >= 0; di--) {
      const date = utcDay(di);
      const isToday = di === 0;
      const elapsed = DAYS - 1 - di; // 0 = oldest day

      // Wellness (0–5 scales; sleep in hours)
      const sleepHours = r1(clampN(p.sleep + (osc(ai, di, 7) - 0.5) * 2.4, 4, 9.5));
      const sleepQuality = i5(p.qual + (osc(ai + 1, di, 6) - 0.5) * 2.6);
      const mood = i5(3.3 + (osc(ai + 2, di, 9) - 0.5) * 2.8);
      const stress = i5(2.7 + (osc(ai + 3, di, 5) - 0.5) * 2.8);
      const soreness = i5(2.7 + (osc(ai + 4, di, 4) - 0.5) * 3);
      const fatigue = i5(2.7 + (osc(ai + 5, di, 8) - 0.5) * 3);
      // Twice-daily resting HR: waking near the persona baseline, before-bed a
      // little higher. Each stamped with its own time of day.
      const wakeHrBpm = r0(clampN(p.hr + (osc(ai + 9, di, 7) - 0.5) * 12, 40, 95));
      const bedHrBpm = r0(clampN(wakeHrBpm + 9 + (osc(ai + 10, di, 6) - 0.5) * 8, 45, 105));
      wellnessDocs.push({
        athleteId: a.profile._id,
        date,
        sleepHours,
        sleepQuality,
        mood,
        stress,
        soreness,
        fatigue,
        wakeHrBpm,
        wakeHrAt: new Date(date.getTime() + 7 * 60 * 60 * 1000),
        bedHrBpm,
        bedHrAt: new Date(date.getTime() + 22 * 60 * 60 * 1000),
      });

      // Water intake: a few entries through the day summing near the 3 L goal
      // (some days under, some over). Today logs only the morning so far.
      const sips = isToday ? [500, 350] : [500, 500, 750, 500, r0(clampN(400 + (osc(ai + 11, di, 5) - 0.5) * 700, 0, 900))];
      sips.forEach((amountMl, idx) => {
        if (amountMl <= 0) return;
        waterDocs.push({
          athleteId: a.profile._id,
          date,
          amountMl,
          loggedAt: new Date(date.getTime() + (8 + idx * 3) * 60 * 60 * 1000),
        });
      });

      // Attendance (today always present so the default dashboard view is normal)
      const attStatus = isToday
        ? "present"
        : di % 19 === 0
        ? "absent"
        : di % 9 === 0
        ? "late"
        : "present";
      attendanceDocs.push({ athleteId: a.profile._id, date, status: attStatus, recordedBy: aCoach._id });

      // Training sessions (AM strength, Afternoon conditioning, PM skill)
      const amStatus = !isToday && di % 13 === 0 ? "skipped" : "completed";
      const aftStatus = isToday ? "planned" : di % 11 === 0 ? "skipped" : "completed";
      const pmStatus = isToday ? "planned" : di % 7 === 0 ? "skipped" : "completed";
      sessionDocs.push(
        { athleteId: a.profile._id, coachId: aCoach._id, date, slot: "AM", type: "strength", status: amStatus },
        { athleteId: a.profile._id, coachId: aCoach._id, date, slot: "AFT", type: "conditioning", status: aftStatus },
        { athleteId: a.profile._id, coachId: aCoach._id, date, slot: "PM", type: "skill", status: pmStatus }
      );

      // Recovery
      const recoveryScore = r0(clampN(p.recov + (osc(ai + 6, di, 7) - 0.5) * 46, 25, 96));
      const recStatus = recoveryScore >= 80 ? "green" : recoveryScore >= 60 ? "amber" : "red";
      const restingHr = r0(clampN(p.hr + (osc(ai + 7, di, 6) - 0.5) * 16, 44, 92));
      const hrv = r0(clampN(86 - (restingHr - 54) * 1.3 + (osc(ai + 8, di, 5) - 0.5) * 20, 35, 110));
      recoveryDocs.push({
        athleteId: a.profile._id,
        date,
        recoveryScore,
        status: recStatus,
        restingHr,
        hrv,
        modalities: ["ice"],
      });

      // RPE — AM always (unless skipped); PM strength block ~ every 3rd day
      const pushRpe = (sessionType: "AM" | "PM", cat: string, intensity: number, rpeVal: number) => {
        const derived = deriveLoadAndRisk({
          plannedIntensityPercent: intensity,
          rpe: rpeVal,
          fatigue,
          muscleSoreness: soreness,
          sleepQuality,
          moodMotivation: mood,
          restingHeartRate: restingHr,
        });
        rpeDocs.push({
          academyId: academy._id,
          athleteId: a.profile._id,
          coachId: aCoach._id,
          date,
          day: dayOfWeek(date),
          sessionType,
          trainingCategory: cat,
          plannedIntensityPercent: intensity,
          rpe: rpeVal,
          bodyConditionFeedback: "",
          restingHeartRate: restingHr,
          sleepQuality,
          muscleSoreness: soreness,
          fatigue,
          moodMotivation: mood,
          ...derived,
        });
      };
      const amCat = TRAINING_CATS[(di + ai) % TRAINING_CATS.length];
      const amIntensity = r0(clampN(70 + (osc(ai, di, 7) - 0.5) * 50, 30, 95));
      const amRpe = i10((4 + osc(ai + 1, di, 7) * 5) * p.loadBias);
      if (amStatus !== "skipped") pushRpe("AM", amCat, amIntensity, amRpe);
      if (!isToday && di % 3 === 0 && pmStatus !== "skipped") {
        pushRpe("PM", "GENERAL STRENGTH & MOBILITY", r0(clampN(amIntensity - 10, 30, 90)), i10(amRpe - 1));
      }

      // Performance — every 5 days, all metrics, improving over time
      if (di % 5 === 0) {
        for (const m of PERF_METRICS) {
          const value = r1(m.base + m.perDay * elapsed + (osc(ai, di, 11) - 0.5) * 2 * m.jitter);
          perfDocs.push({ athleteId: a.profile._id, date, metric: m.metric, value, unit: m.unit, context: m.context });
        }
      }
    }
  }

  await Promise.all([
    Attendance.insertMany(attendanceDocs),
    Wellness.insertMany(wellnessDocs),
    Recovery.insertMany(recoveryDocs),
    TrainingSession.insertMany(sessionDocs),
    RpeMonitoring.insertMany(rpeDocs),
    Performance.insertMany(perfDocs),
    WaterIntake.insertMany(waterDocs),
  ]);

  // Active injury window on Bala (index 1)
  await Injury.create({
    athleteId: athletes[1].profile._id,
    bodyPart: "hamstring",
    severity: "mild",
    status: "monitoring",
    restriction: "no sprints",
    description: "Felt tightness post session — monitoring.",
    startedAt: utcDay(9),
  });

  // A few recent notes + coach comments on Arjun for timeline/feedback content
  await AthleteNote.insertMany([
    { athleteId: arjun.profile._id, date: utcDay(0), body: "Right calf felt tight during warm-up — manageable, will monitor." },
    { athleteId: arjun.profile._id, date: utcDay(3), body: "Legs heavy after yesterday's speed work." },
  ]);
  await CoachComment.insertMany([
    { athleteId: arjun.profile._id, coachId: coach._id, date: utcDay(0), body: "Good warm-up. Drop intensity 10% on PM skill block; ice the calf after." },
    { athleteId: arjun.profile._id, coachId: coach._id, date: utcDay(4), body: "Strong session — keep sleep above 7h this week." },
  ]);

  // ── Sample in-app notifications, per role (idempotent: clear + reinsert) ──
  const notifyRecipients = [coach._id, arjun.user._id, guardianUser._id];
  await Notification.deleteMany({ recipientUserId: { $in: notifyRecipients } });
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
  await Notification.insertMany([
    // Coach Kumar
    { recipientUserId: coach._id, academyId: academy._id, type: "readiness_flag", priority: "high",
      title: "Bala Iyer flagged red", body: "Low readiness 50 with high RPE load — review before today's session.",
      link: `/coach/athletes/${athletes[1].profile._id}`, readAt: null, createdAt: minsAgo(25), updatedAt: minsAgo(25) },
    { recipientUserId: coach._id, academyId: academy._id, type: "note_needs_reply", priority: "medium",
      title: "Arjun Rao left a note", body: "Right calf felt tight during warm-up — manageable, will monitor.",
      link: `/coach/athletes/${arjun.profile._id}`, readAt: null, createdAt: minsAgo(180), updatedAt: minsAgo(180) },
    { recipientUserId: coach._id, academyId: academy._id, type: "squad_digest", priority: "low",
      title: "Today's squad digest", body: "3 athletes logging · 1 red flag · avg readiness 53.",
      link: "/coach/dashboard", readAt: minsAgo(60), createdAt: minsAgo(300), updatedAt: minsAgo(300) },
    // Athlete Arjun
    { recipientUserId: arjun.user._id, academyId: academy._id, type: "coach_feedback", priority: "high",
      title: "New feedback from Coach Kumar", body: "Good warm-up. Drop intensity 10% on PM skill block; ice the calf after.",
      link: "/athlete/dashboard", readAt: null, createdAt: minsAgo(40), updatedAt: minsAgo(40) },
    { recipientUserId: arjun.user._id, academyId: academy._id, type: "checkin_reminder", priority: "medium",
      title: "Log today's check-in", body: "Add sleep, soreness and mood to update your readiness.",
      link: "/athlete/dashboard", readAt: null, createdAt: minsAgo(150), updatedAt: minsAgo(150) },
    { recipientUserId: arjun.user._id, academyId: academy._id, type: "streak_milestone", priority: "low",
      title: "7-day check-in streak", body: "Nice consistency — keep the daily logging going.",
      link: "/athlete/dashboard", readAt: minsAgo(120), createdAt: minsAgo(1440), updatedAt: minsAgo(1440) },
    // Guardian Rao
    { recipientUserId: guardianUser._id, academyId: academy._id, type: "coach_feedback", priority: "medium",
      title: "Coach feedback for Arjun", body: "Strong session — keep sleep above 7h this week.",
      link: "/guardian/dashboard", readAt: null, createdAt: minsAgo(200), updatedAt: minsAgo(200) },
    { recipientUserId: guardianUser._id, academyId: academy._id, type: "weekly_summary", priority: "low",
      title: "Arjun's weekly summary", body: "Readiness trending up · 5 sessions completed this week.",
      link: "/guardian/dashboard", readAt: minsAgo(60), createdAt: minsAgo(2880), updatedAt: minsAgo(2880) },
  ]);

  // ── Sample coach broadcasts (Coach Kumar → his 3 assigned athletes) ──
  await Announcement.deleteMany({ coachId: coach._id });
  await Announcement.insertMany([
    {
      coachId: coach._id,
      academyId: academy._id,
      body: "Sunday swimming class starts at 7:00 AM — bring your kit.",
      recipientCount: kumarAthletes.length,
      createdAt: minsAgo(90),
      updatedAt: minsAgo(90),
    },
    {
      coachId: coach._id,
      academyId: academy._id,
      body: "Training schedule updated for next week — check your sessions.",
      recipientCount: kumarAthletes.length,
      createdAt: minsAgo(1440),
      updatedAt: minsAgo(1440),
    },
  ]);

  // Summary
  const counts: Record<string, number> = {};
  for (const [name, m] of Object.entries({
    academies: Academy,
    users: User,
    athletes: AthleteProfile,
    coach_assignments: CoachAthleteAssignment,
    guardian_links: GuardianAthleteLink,
    attendance: Attendance,
    training_sessions: TrainingSession,
    wellness: Wellness,
    recovery: Recovery,
    performance: Performance,
    injuries: Injury,
    athlete_notes: AthleteNote,
    coach_comments: CoachComment,
    rpe_monitoring: RpeMonitoring,
    notifications: Notification,
    announcements: Announcement,
    water_intake: WaterIntake,
  })) {
    counts[name] = await (m as mongoose.Model<any>).countDocuments();
  }
  console.log("[seed] counts:", counts);
}

run()
  .then(async () => {
    await disconnectMongo();
    console.log("[seed] done");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[seed] failed:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
