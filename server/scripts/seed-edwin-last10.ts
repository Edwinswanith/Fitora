import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { Attendance } from "../src/models/Attendance";
import { TrainingSession } from "../src/models/TrainingSession";
import { Wellness } from "../src/models/Wellness";
import { Recovery } from "../src/models/Recovery";
import { Performance } from "../src/models/Performance";
import { WaterIntake } from "../src/models/WaterIntake";
import { RpeMonitoring } from "../src/models/RpeMonitoring";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { deriveLoadAndRisk, dayOfWeek } from "../src/lib/trainingCategories";

const EMAIL = "edwinswanith006@gmail.com";
const DAYS = 10;

function todayInTimezone(timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function atHour(date: Date, hour: number): Date {
  return new Date(date.getTime() + hour * 60 * 60 * 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function wave(index: number, period: number): number {
  return (Math.sin((index / period) * Math.PI * 2) + 1) / 2;
}

async function run() {
  await connectMongo();
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Mongo not connected");
  }

  const user = await User.findOne({ email: EMAIL, role: "athlete" });
  if (!user) throw new Error(`Athlete user not found: ${EMAIL}`);

  const profile = await AthleteProfile.findOne({ userId: user._id });
  if (!profile) throw new Error(`Athlete profile not found for: ${EMAIL}`);

  const assignment = await CoachAthleteAssignment.findOne({
    athleteId: profile._id,
    endedAt: null,
  }).sort({ assignedAt: -1 });
  const coachId = assignment?.coachId ?? null;

  const tz = profile.timezone || "Asia/Kolkata";
  const today = todayInTimezone(tz);
  const start = addDays(today, -(DAYS - 1));
  const endExclusive = addDays(today, 1);

  await Promise.all([
    Attendance.deleteMany({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    Wellness.deleteMany({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    Recovery.deleteMany({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    TrainingSession.deleteMany({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    RpeMonitoring.deleteMany({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    Performance.deleteMany({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    WaterIntake.deleteMany({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
  ]);

  const trainingCategories = [
    "ENDURANCE",
    "TEMPO / EXTENSIVE",
    "MAX SPEED",
    "GENERAL STRENGTH & MOBILITY",
    "SPEED ENDURANCE",
    "ACTIVE REST / REST",
  ];

  const attendanceDocs: any[] = [];
  const wellnessDocs: any[] = [];
  const recoveryDocs: any[] = [];
  const sessionDocs: any[] = [];
  const rpeDocs: any[] = [];
  const perfDocs: any[] = [];
  const waterDocs: any[] = [];

  for (let offset = DAYS - 1; offset >= 0; offset--) {
    const date = addDays(today, -offset);
    const index = DAYS - 1 - offset;
    const isToday = offset === 0;

    const sleepHours = round1(clamp(6.2 + wave(index, 5) * 2.1, 5.2, 8.6));
    const sleepQuality = Math.round(clamp(3 + wave(index + 1, 6) * 2, 1, 5));
    const mood = Math.round(clamp(3 + wave(index + 2, 7) * 2, 1, 5));
    const stress = Math.round(clamp(2 + wave(index + 3, 5) * 2, 1, 5));
    const soreness = Math.round(clamp(2 + wave(index + 4, 4) * 3, 1, 5));
    const fatigue = Math.round(clamp(2 + wave(index + 5, 6) * 3, 1, 5));
    const restingHr = Math.round(clamp(52 + wave(index + 2, 6) * 16, 48, 76));
    const bedHrBpm = Math.round(clamp(restingHr + 8 + wave(index + 3, 5) * 7, 56, 90));
    const recoveryScore = Math.round(clamp(58 + sleepQuality * 6 + mood * 3 - fatigue * 4 - soreness * 3, 35, 92));
    const recoveryStatus = recoveryScore >= 80 ? "green" : recoveryScore >= 60 ? "amber" : "red";

    wellnessDocs.push({
      athleteId: profile._id,
      date,
      sleepHours,
      sleepQuality,
      mood,
      stress,
      soreness,
      fatigue,
      wakeHrBpm: restingHr,
      wakeHrAt: atHour(date, 6),
      bedHrBpm,
      bedHrAt: atHour(date, 22),
      note: isToday ? "Dummy check-in for live Ask Agent testing." : "Dummy historical check-in.",
    });

    recoveryDocs.push({
      athleteId: profile._id,
      date,
      restingHr,
      hrv: Math.round(clamp(82 - (restingHr - 55) * 1.2 + wave(index, 5) * 14, 42, 98)),
      recoveryScore,
      status: recoveryStatus,
      modalities: recoveryStatus === "red" ? ["ice", "stretching"] : ["stretching"],
      note: recoveryStatus === "red" ? "Reduce intensity and prioritise recovery." : "Normal recovery work.",
    });

    attendanceDocs.push({
      athleteId: profile._id,
      date,
      status: offset === 6 ? "late" : offset === 3 ? "rest" : "present",
      recordedBy: coachId,
    });

    const amStatus = offset === 3 ? "rest" : "completed";
    const aftStatus = isToday ? "planned" : offset === 5 ? "skipped" : "completed";
    const pmStatus = isToday ? "planned" : offset === 2 ? "skipped" : "completed";

    sessionDocs.push(
      {
        athleteId: profile._id,
        coachId,
        date,
        slot: "AM",
        type: "endurance",
        workoutType: "ENDURANCE",
        status: amStatus,
        durationMin: 45,
        actualDurationMin: amStatus === "completed" ? 44 + index : undefined,
        intensityRpe: 62 + index,
        effortRating: amStatus === "completed" ? Math.round(clamp(5 + wave(index, 5) * 4, 1, 10)) : undefined,
        attended: amStatus === "completed",
        notes: "Dummy AM session.",
      },
      {
        athleteId: profile._id,
        coachId,
        date,
        slot: "AFT",
        type: "conditioning",
        workoutType: "TEMPO / EXTENSIVE",
        status: aftStatus,
        durationMin: 50,
        actualDurationMin: aftStatus === "completed" ? 48 + index : undefined,
        intensityRpe: 68 + index,
        effortRating: aftStatus === "completed" ? Math.round(clamp(5 + wave(index + 1, 5) * 4, 1, 10)) : undefined,
        attended: aftStatus === "completed",
        notes: "Dummy afternoon session.",
      },
      {
        athleteId: profile._id,
        coachId,
        date,
        slot: "PM",
        type: "skill",
        workoutType: "TECHNIQUE / COORDINATION DRILLS",
        status: pmStatus,
        durationMin: 35,
        actualDurationMin: pmStatus === "completed" ? 34 + index : undefined,
        intensityRpe: 55 + index,
        effortRating: pmStatus === "completed" ? Math.round(clamp(4 + wave(index + 2, 5) * 4, 1, 10)) : undefined,
        attended: pmStatus === "completed",
        notes: "Dummy PM skills session.",
      }
    );

    const pushRpe = (sessionType: "AM" | "AFT" | "PM", plannedIntensityPercent: number, rpe: number) => {
      const derived = deriveLoadAndRisk({
        plannedIntensityPercent,
        rpe,
        fatigue,
        muscleSoreness: soreness,
        sleepQuality,
        moodMotivation: mood,
        restingHeartRate: restingHr,
      });
      rpeDocs.push({
        academyId: profile.academyId,
        athleteId: profile._id,
        coachId,
        date,
        day: dayOfWeek(date),
        sessionType,
        trainingCategory: trainingCategories[(index + sessionType.length) % trainingCategories.length],
        plannedIntensityPercent,
        rpe,
        bodyConditionFeedback: "Dummy RPE entry for Ask Agent and report testing.",
        restingHeartRate: restingHr,
        sleepQuality,
        muscleSoreness: soreness,
        fatigue,
        moodMotivation: mood,
        ...derived,
      });
    };

    if (amStatus === "completed") pushRpe("AM", 62 + index, Math.round(clamp(4 + wave(index, 5) * 5, 1, 10)));
    if (aftStatus === "completed") pushRpe("AFT", 68 + index, Math.round(clamp(5 + wave(index + 1, 5) * 4, 1, 10)));
    if (pmStatus === "completed" && index % 2 === 0) pushRpe("PM", 55 + index, Math.round(clamp(4 + wave(index + 2, 5) * 4, 1, 10)));

    const waterAmounts = isToday ? [500, 400, 350] : [500, 500, 750, 500, 400 + index * 25];
    waterAmounts.forEach((amountMl, sipIndex) => {
      waterDocs.push({
        athleteId: profile._id,
        date,
        amountMl,
        loggedAt: atHour(date, 7 + sipIndex * 3),
      });
    });

    if (offset % 2 === 0) {
      perfDocs.push(
        { athleteId: profile._id, date, metric: "100m", value: round1(12.2 - index * 0.03 + wave(index, 4) * 0.12), unit: "s", context: "dummy test" },
        { athleteId: profile._id, date, metric: "vertical_jump", value: Math.round(49 + index * 0.4 + wave(index, 5) * 2), unit: "cm", context: "dummy test" },
        { athleteId: profile._id, date, metric: "1rm_squat", value: Math.round(94 + index * 1.2 + wave(index, 6) * 3), unit: "kg", context: "dummy training" }
      );
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

  const counts = {
    attendance: await Attendance.countDocuments({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    wellness: await Wellness.countDocuments({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    recovery: await Recovery.countDocuments({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    trainingSessions: await TrainingSession.countDocuments({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    rpeMonitoring: await RpeMonitoring.countDocuments({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    performance: await Performance.countDocuments({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
    waterIntake: await WaterIntake.countDocuments({ athleteId: profile._id, date: { $gte: start, $lt: endExclusive } }),
  };

  console.log("[seed-edwin-last10] user:", user.email);
  console.log("[seed-edwin-last10] athleteId:", profile._id.toString());
  console.log("[seed-edwin-last10] range:", start.toISOString().slice(0, 10), "to", today.toISOString().slice(0, 10));
  console.log("[seed-edwin-last10] counts:", counts);
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[seed-edwin-last10] failed:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
