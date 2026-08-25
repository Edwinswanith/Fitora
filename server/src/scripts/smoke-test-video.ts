/**
 * One-off manual verification against the REAL fitora Atlas database — proves
 * the Phase 8 live-video join-token flow persists videoRoomRef correctly and
 * that room termination actually happens on cancel/complete. Uses the mock
 * video provider (no live LiveKit project needed) but with spy-able
 * create/terminate calls verified against the real database round-trip.
 * Cleans up everything it creates.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachSession } from "../models/CoachSession";
import { requestSession, confirmSession, issueJoinToken, cancelSession } from "../services/coachSession";
import { setVideoProviderForTests, MockVideoProvider } from "../services/videoProvider";
import { CoachAvailability } from "../models/CoachAvailability";
import { findMatchingWindow } from "../services/coachAvailability";

async function run() {
  await connectMongo();
  console.log("[smoke-video] connected to", mongoose.connection.db?.databaseName);

  const provider = new MockVideoProvider();
  setVideoProviderForTests(provider);

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const coach = await User.create({ email: "smoke-video-coach@fitora.test", passwordHash, role: "coach", name: "Smoke Coach" });
  const athleteUser = await User.create({ email: "smoke-video-athlete@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
  const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

  // Book a session 5 minutes from now, on whatever weekday "now" happens to
  // be, by creating an availability rule matching today's UTC weekday.
  const now = new Date();
  const rule = await CoachAvailability.create({
    coachId: coach._id,
    dayOfWeek: now.getUTCDay(),
    startMinute: 0,
    endMinute: 1440,
    timezone: "UTC",
    sessionDurationMin: 30,
    bufferMin: 0,
  });
  const scheduledStart = new Date(now.getTime() + 5 * 60_000);
  const window = await findMatchingWindow(coach._id, scheduledStart);
  if (!window) throw new Error("smoke setup failed: no matching availability window");

  const { session } = await requestSession({
    coachId: coach._id,
    athleteId: profile._id,
    relationshipId: relationship._id,
    type: "general",
    scheduledStart,
    requestedBy: athleteUser._id,
  });
  await confirmSession(session, coach._id);
  console.log("[smoke-video] session confirmed:", session._id.toString());

  const issued = await issueJoinToken(session, "coach", coach._id, "Smoke Coach");
  console.log("[smoke-video] join token issued, serverUrl:", issued.serverUrl, "(expect mock URL)");

  const persisted = await CoachSession.findById(session._id).lean();
  console.log("[smoke-video] videoRoomRef persisted:", persisted?.videoRoomRef, "(expect non-null)");
  console.log("[smoke-video] provider recorded room as created:", provider.wasCreated(persisted?.videoRoomRef ?? ""), "(expect true)");

  await cancelSession(session, coach._id, "smoke test cleanup");
  console.log("[smoke-video] provider recorded room as terminated after cancel:", provider.wasTerminated(persisted?.videoRoomRef ?? ""), "(expect true)");

  const cancelledPersisted = await CoachSession.findById(session._id).lean();

  const ok =
    Boolean(persisted?.videoRoomRef) &&
    provider.wasCreated(persisted?.videoRoomRef ?? "") &&
    provider.wasTerminated(persisted?.videoRoomRef ?? "") &&
    cancelledPersisted?.status === "cancelled";

  await Promise.all([
    CoachSession.deleteOne({ _id: session._id }),
    CoachAvailability.deleteOne({ _id: rule._id }),
    CoachAthleteAssignment.deleteOne({ _id: relationship._id }),
    AthleteProfile.deleteOne({ _id: profile._id }),
    User.deleteOne({ _id: coach._id }),
    User.deleteOne({ _id: athleteUser._id }),
  ]);
  console.log("[smoke-video] cleanup complete — database left as found");

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke-video] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke-video] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
