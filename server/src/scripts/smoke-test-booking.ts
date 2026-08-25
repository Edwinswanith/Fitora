/**
 * One-off manual verification against the REAL fitora Atlas database — proves
 * the Phase 7 availability/booking system persists correctly, and — since
 * Atlas is a genuine replica set — that the transactional double-booking
 * guard (CoachSessionSlotLock's unique index inside a real Mongo
 * transaction) actually serializes two concurrent booking requests in
 * production, not just against the in-memory replica set used in tests.
 * Cleans up everything it creates.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachAvailability } from "../models/CoachAvailability";
import { CoachSession } from "../models/CoachSession";
import { CoachSessionSlotLock } from "../models/CoachSessionSlotLock";
import { requestSession, confirmSession, completeSession, CoachSessionError } from "../services/coachSession";

async function run() {
  await connectMongo();
  console.log("[smoke-booking] connected to", mongoose.connection.db?.databaseName);

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const coach = await User.create({ email: "smoke-booking-coach@fitora.test", passwordHash, role: "coach", name: "Smoke Coach" });
  const athleteA = await User.create({ email: "smoke-booking-athlete-a@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete A" });
  const athleteB = await User.create({ email: "smoke-booking-athlete-b@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete B" });
  const profileA = await AthleteProfile.create({ userId: athleteA._id, sport: "general" });
  const profileB = await AthleteProfile.create({ userId: athleteB._id, sport: "general" });
  const relA = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profileA._id, assignedBy: coach._id, status: "active" });
  const relB = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profileB._id, assignedBy: coach._id, status: "active" });
  const rule = await CoachAvailability.create({
    coachId: coach._id,
    dayOfWeek: 1, // Monday
    startMinute: 480,
    endMinute: 600,
    timezone: "UTC",
    sessionDurationMin: 30,
    bufferMin: 10,
  });

  const scheduledStart = new Date("2026-01-05T08:00:00.000Z");

  const { session } = await requestSession({
    coachId: coach._id,
    athleteId: profileA._id,
    relationshipId: relA._id,
    type: "general",
    scheduledStart,
    requestedBy: athleteA._id,
  });
  const statusAfterRequest = session.status;
  console.log("[smoke-booking] session requested, status:", statusAfterRequest, "(expect requested)");

  // confirmSession/completeSession mutate-and-return the SAME document — snapshot
  // each status string immediately, since `session`/`confirmed`/`completed` all
  // point to one in-memory object that keeps changing underneath.
  const confirmed = await confirmSession(session, coach._id);
  const statusAfterConfirm = confirmed.status;
  console.log("[smoke-booking] session confirmed, status:", statusAfterConfirm, "(expect confirmed)");

  const completed = await completeSession(confirmed, coach._id, "Great work", "private note");
  console.log("[smoke-booking] session completed, status:", completed.status, "coachNotes set:", Boolean(completed.coachNotes), "(expect completed / true)");

  const locksAfterComplete = await CoachSessionSlotLock.countDocuments({ sessionId: session._id });
  console.log("[smoke-booking] locks released after completion:", locksAfterComplete, "(expect 0)");

  // Real concurrent race against a genuine Atlas replica set (not the
  // in-memory MongoMemoryReplSet used in the test suite).
  const raceStart = new Date("2026-01-05T09:00:00.000Z");
  const [raceA, raceB] = await Promise.allSettled([
    requestSession({ coachId: coach._id, athleteId: profileA._id, relationshipId: relA._id, type: "general", scheduledStart: raceStart, requestedBy: athleteA._id }),
    requestSession({ coachId: coach._id, athleteId: profileB._id, relationshipId: relB._id, type: "general", scheduledStart: raceStart, requestedBy: athleteB._id }),
  ]);
  const raceOutcomes = [raceA, raceB].map((r) => (r.status === "fulfilled" ? "ok" : r.reason instanceof CoachSessionError ? r.reason.message : "error"));
  console.log("[smoke-booking] real Atlas concurrent race outcomes:", raceOutcomes, "(expect exactly one 'ok' and one 'slot_conflict')");
  const raceSessionsCreated = await CoachSession.countDocuments({ coachId: coach._id, scheduledStart: raceStart });
  console.log("[smoke-booking] sessions actually created for the raced slot:", raceSessionsCreated, "(expect 1)");

  const checks = {
    sessionRequested: statusAfterRequest === "requested",
    confirmedStatus: statusAfterConfirm === "confirmed",
    completedStatus: completed.status === "completed",
    coachNotesSaved: completed.coachNotes === "private note",
    locksReleased: locksAfterComplete === 0,
    oneRaceOk: raceOutcomes.filter((o) => o === "ok").length === 1,
    oneRaceConflict: raceOutcomes.filter((o) => o === "slot_conflict").length === 1,
    raceSessionsCreated: raceSessionsCreated === 1,
  };
  console.log("[smoke-booking] check results:", checks);
  const ok = Object.values(checks).every(Boolean);

  await Promise.all([
    CoachSession.deleteMany({ coachId: coach._id }),
    CoachSessionSlotLock.deleteMany({ coachId: coach._id }),
    CoachAvailability.deleteOne({ _id: rule._id }),
    CoachAthleteAssignment.deleteMany({ coachId: coach._id }),
    AthleteProfile.deleteMany({ _id: { $in: [profileA._id, profileB._id] } }),
    User.deleteMany({ _id: { $in: [coach._id, athleteA._id, athleteB._id] } }),
  ]);
  console.log("[smoke-booking] cleanup complete — database left as found");

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke-booking] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke-booking] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
