import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";

const EMAIL = "edwinswanith006@gmail.com";

async function run() {
  await connectMongo();
  if (mongoose.connection.readyState !== 1) {
    throw new Error("Mongo not connected");
  }

  const user = await User.findOne({ email: EMAIL });
  if (!user) throw new Error(`User not found: ${EMAIL}`);

  user.role = "athlete";
  user.isAcademyOwner = false;
  user.mustChangePassword = false;
  user.isActive = true;
  await user.save();

  const profile = await AthleteProfile.findOneAndUpdate(
    { userId: user._id },
    {
      $setOnInsert: {
        userId: user._id,
        ...(user.academyId ? { academyId: user.academyId } : {}),
        sport: "Not set",
        timezone: "Asia/Kolkata",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const ended = await CoachAthleteAssignment.updateMany(
    { coachId: user._id, endedAt: null },
    { $set: { endedAt: new Date() } }
  );

  console.log("[repair-edwin-athlete] updated", {
    email: user.email,
    role: user.role,
    athleteProfileId: String(profile._id),
    endedCoachAssignments: ended.modifiedCount,
  });
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[repair-edwin-athlete] failed:", (err as Error).message);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
