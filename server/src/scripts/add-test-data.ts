/**
 * Adds a little test data for the REAL (currently-empty) accounts so they're
 * worth logging into:
 *   - assigns the owner coach (Edwin) a small squad reusing the demo athletes,
 *     so his coach dashboard shows readiness/data immediately.
 *   - gives the Google-created athlete (Kishore) ~7 days of check-ins, water and
 *     recovery, plus a coach comment, so the athlete view is populated.
 *
 * Idempotent: assignments upsert; the athlete's recent rows are cleared and
 * reinserted. Safe to re-run. Does NOT touch the seeded demo data.
 */
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { Wellness } from "../models/Wellness";
import { Recovery } from "../models/Recovery";
import { WaterIntake } from "../models/WaterIntake";
import { CoachComment } from "../models/CoachComment";

const OWNER_EMAIL = "edwinswanith006@gmail.com";
const GOOGLE_ATHLETE_EMAIL = "arunkishore757@gmail.com";
const SQUAD_EMAILS = ["athlete.arjun@acme.test", "athlete.bala@acme.test", "athlete.chetan@acme.test"];

function utcDay(daysAgo = 0): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

async function profileForEmail(email: string) {
  const user = await User.findOne({ email }).lean();
  if (!user) return null;
  const profile = await AthleteProfile.findOne({ userId: user._id }).lean();
  return profile ? { user, profile } : null;
}

async function run() {
  await connectMongo();
  if (mongoose.connection.readyState !== 1) throw new Error("Mongo not connected");
  console.log("[test-data] db:", mongoose.connection.db?.databaseName);

  // 1) Owner coach gets a squad (reuse demo athletes; data already exists).
  const owner = await User.findOne({ email: OWNER_EMAIL });
  if (!owner) throw new Error(`Owner ${OWNER_EMAIL} not found`);
  let assigned = 0;
  for (const email of SQUAD_EMAILS) {
    const found = await profileForEmail(email);
    if (!found) continue;
    await CoachAthleteAssignment.updateOne(
      { coachId: owner._id, athleteId: found.profile._id, endedAt: null },
      { $setOnInsert: { coachId: owner._id, athleteId: found.profile._id, assignedBy: owner._id, assignedAt: new Date(), endedAt: null } },
      { upsert: true }
    );
    assigned++;
  }
  console.log(`[test-data] assigned ${assigned} athletes to ${OWNER_EMAIL}`);

  // 2) Google athlete gets ~7 days of check-ins / recovery / water + a comment.
  const ka = await profileForEmail(GOOGLE_ATHLETE_EMAIL);
  if (ka) {
    const aid = ka.profile._id;
    await Promise.all([
      Wellness.deleteMany({ athleteId: aid }),
      Recovery.deleteMany({ athleteId: aid }),
      WaterIntake.deleteMany({ athleteId: aid }),
      CoachComment.deleteMany({ athleteId: aid }),
    ]);

    const wellness: any[] = [];
    const recovery: any[] = [];
    const water: any[] = [];
    for (let d = 6; d >= 0; d--) {
      const date = utcDay(d);
      const wave = Math.sin(d / 2);
      wellness.push({
        athleteId: aid,
        date,
        sleepHours: clamp(7.2 + wave * 0.9, 5, 9),
        sleepQuality: clamp(Math.round(4 + wave), 1, 5),
        mood: clamp(Math.round(4 + wave), 1, 5),
        stress: clamp(Math.round(3 - wave), 1, 5),
        soreness: clamp(Math.round(3 - wave), 1, 5),
        fatigue: clamp(Math.round(3 - wave), 1, 5),
        wakeHrBpm: Math.round(clamp(56 - wave * 4, 45, 70)),
        wakeHrAt: new Date(date.getTime() + 7 * 3600 * 1000),
      });
      const score = Math.round(clamp(78 + wave * 14, 40, 96));
      recovery.push({
        athleteId: aid,
        date,
        recoveryScore: score,
        status: score >= 80 ? "green" : score >= 60 ? "amber" : "red",
        restingHr: Math.round(clamp(56 - wave * 4, 45, 70)),
        hrv: Math.round(clamp(78 + wave * 12, 40, 110)),
        modalities: ["ice"],
      });
      for (const [i, ml] of [500, 600, 750, 500].entries()) {
        water.push({ athleteId: aid, date, amountMl: ml, loggedAt: new Date(date.getTime() + (8 + i * 3) * 3600 * 1000) });
      }
    }
    await Promise.all([
      Wellness.insertMany(wellness),
      Recovery.insertMany(recovery),
      WaterIntake.insertMany(water),
      CoachComment.create({ athleteId: aid, coachId: owner._id, date: utcDay(0), body: "Welcome aboard! Keep logging your daily check-in — readiness is looking solid." }),
    ]);
    // Also put Kishore on the owner's squad so the coach can see them too.
    await CoachAthleteAssignment.updateOne(
      { coachId: owner._id, athleteId: aid, endedAt: null },
      { $setOnInsert: { coachId: owner._id, athleteId: aid, assignedBy: owner._id, assignedAt: new Date(), endedAt: null } },
      { upsert: true }
    );
    console.log(`[test-data] added 7 days of data for ${GOOGLE_ATHLETE_EMAIL} and assigned to owner`);
  } else {
    console.log(`[test-data] ${GOOGLE_ATHLETE_EMAIL} has no athlete profile — skipped`);
  }

  const squadCount = await CoachAthleteAssignment.countDocuments({ coachId: owner._id, endedAt: null });
  console.log(`[test-data] owner now has ${squadCount} athletes on the squad`);
}

run()
  .then(async () => {
    await disconnectMongo();
    console.log("[test-data] done");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[test-data] failed:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
