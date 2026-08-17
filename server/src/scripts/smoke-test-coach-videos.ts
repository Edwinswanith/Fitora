/**
 * One-off manual verification against the REAL fitora Atlas database — proves
 * the Phase 9 content library persists correctly: upload, visibility
 * resolution (subscribers tier, backward-compatible legacy relationship),
 * and progress checkpointing (upsert, not duplicate rows). Writes a real
 * file to disk under env.upload.dir as part of the flow. Cleans up
 * everything it creates, including the file.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachVideo } from "../models/CoachVideo";
import { CoachVideoProgress } from "../models/CoachVideoProgress";
import { coachVideoFilePath, deleteCoachVideoFile, isVideoVisible, loadAthleteVideoAccessContext } from "../services/coachVideo";
import fs from "fs";

async function run() {
  await connectMongo();
  console.log("[smoke-coach-videos] connected to", mongoose.connection.db?.databaseName);

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const coach = await User.create({ email: "smoke-video-lib-coach@fitora.test", passwordHash, role: "coach", name: "Smoke Coach" });
  const athleteUser = await User.create({ email: "smoke-video-lib-athlete@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
  const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

  const storedFilename = `smoke-${Date.now()}.mp4`;
  const video = await CoachVideo.create({
    coachId: coach._id,
    title: "Smoke Test Video",
    category: "mobility",
    visibility: "subscribers",
    originalName: "smoke.mp4",
    storedFilename,
    mimeType: "video/mp4",
    sizeBytes: 42,
    durationSec: 100,
  });
  const filePath = coachVideoFilePath(video);
  await fs.promises.writeFile(filePath, "not a real video, just bytes for the smoke test");
  console.log("[smoke-coach-videos] file written to disk:", fs.existsSync(filePath));

  const context = await loadAthleteVideoAccessContext(coach._id, profile._id);
  const visibleLegacy = isVideoVisible(video, profile._id, context);
  console.log("[smoke-coach-videos] visible to legacy (no-subscription) relationship:", visibleLegacy, "(expect true — backward-compatible)");

  await CoachVideoProgress.findOneAndUpdate(
    { videoId: video._id, athleteId: profile._id },
    { $set: { status: "viewed", progressPercent: 40, lastPositionSec: 40 } },
    { upsert: true, new: true }
  );
  await CoachVideoProgress.findOneAndUpdate(
    { videoId: video._id, athleteId: profile._id },
    { $set: { status: "completed", progressPercent: 100, lastPositionSec: 100 } },
    { upsert: true, new: true }
  );
  const progressCount = await CoachVideoProgress.countDocuments({ videoId: video._id, athleteId: profile._id });
  const finalProgress = await CoachVideoProgress.findOne({ videoId: video._id, athleteId: profile._id }).lean();
  console.log("[smoke-coach-videos] progress rows (expect 1, upsert not duplicate):", progressCount, "final status:", finalProgress?.status);

  const ok = visibleLegacy === true && progressCount === 1 && finalProgress?.status === "completed" && fs.existsSync(filePath);

  await deleteCoachVideoFile(video);
  await Promise.all([
    CoachVideoProgress.deleteMany({ videoId: video._id }),
    CoachVideo.deleteOne({ _id: video._id }),
    CoachAthleteAssignment.deleteOne({ _id: relationship._id }),
    AthleteProfile.deleteOne({ _id: profile._id }),
    User.deleteOne({ _id: coach._id }),
    User.deleteOne({ _id: athleteUser._id }),
  ]);
  console.log("[smoke-coach-videos] cleanup complete — database and disk left as found, file still exists:", fs.existsSync(filePath));

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke-coach-videos] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke-coach-videos] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
