/**
 * One-off manual verification against the REAL fitora Atlas database (not
 * mongodb-memory-server) — proves the Phase 2 workout system actually
 * persists through a real Mongo connection, not just the in-memory test DB.
 * Creates its own throwaway coach/athlete/template/assignment, exercises the
 * full assign -> start -> complete flow, and deletes everything it created
 * before exiting so the database is left exactly as it was found.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { WorkoutTemplate } from "../models/WorkoutTemplate";
import { WorkoutAssignment } from "../models/WorkoutAssignment";
import { ExerciseProgress } from "../models/ExerciseProgress";
import { TrainingSession } from "../models/TrainingSession";
import { Attendance } from "../models/Attendance";
import { assignTemplateToAthlete, startAssignment, updateExerciseProgress } from "../services/workoutAssignment";

async function run() {
  await connectMongo();
  console.log("[smoke] connected to", mongoose.connection.db?.databaseName);

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const coach = await User.create({ email: "smoke-coach@fitora.test", passwordHash, role: "coach", name: "Smoke Coach" });
  const athleteUser = await User.create({ email: "smoke-athlete@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
  const assignment0 = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });

  const template = await WorkoutTemplate.create({
    ownerId: coach._id,
    ownerRole: "coach",
    name: "Smoke Test Push Day",
    exercises: [{ title: "Bench Press", type: "sets_reps", sets: 4, reps: "10", order: 0 }],
    version: 1,
  });

  const assignment = await assignTemplateToAthlete({
    template,
    assignedTo: profile._id,
    assignedBy: coach._id,
    assignedByRole: "coach",
    scheduledDate: new Date(Date.UTC(2026, 0, 1)),
    slot: "AM",
  });
  console.log("[smoke] assignment created:", assignment._id.toString(), "exercises:", assignment.exercisesSnapshot.length);

  await startAssignment(assignment);
  console.log("[smoke] started, status:", assignment.status, "trainingSessionId:", assignment.trainingSessionId?.toString());

  const { assignment: completed } = await updateExerciseProgress(assignment, 0, { status: "completed" });
  console.log("[smoke] completed, status:", completed.status);

  const persistedAssignment = await WorkoutAssignment.findById(assignment._id).lean();
  const persistedProgress = await ExerciseProgress.find({ assignmentId: assignment._id }).lean();
  const persistedSession = await TrainingSession.findById(completed.trainingSessionId).lean();
  const persistedAttendance = await Attendance.findOne({ athleteId: profile._id, date: new Date(Date.UTC(2026, 0, 1)) }).lean();

  console.log("[smoke] re-read from Mongo (fresh queries, not cached objects):");
  console.log("  assignment.status =", persistedAssignment?.status, "(expect completed)");
  console.log("  progress rows =", persistedProgress.length, "(expect 1)");
  console.log("  trainingSession.status =", persistedSession?.status, "(expect completed)");
  console.log("  attendance.status =", persistedAttendance?.status, "(expect present)");

  const ok =
    persistedAssignment?.status === "completed" &&
    persistedProgress.length === 1 &&
    persistedSession?.status === "completed" &&
    persistedAttendance?.status === "present";

  // Clean up everything this script created.
  await Promise.all([
    WorkoutAssignment.deleteOne({ _id: assignment._id }),
    ExerciseProgress.deleteMany({ assignmentId: assignment._id }),
    WorkoutTemplate.deleteOne({ _id: template._id }),
    TrainingSession.deleteMany({ athleteId: profile._id }),
    Attendance.deleteMany({ athleteId: profile._id }),
    CoachAthleteAssignment.deleteOne({ _id: assignment0._id }),
    AthleteProfile.deleteOne({ _id: profile._id }),
    User.deleteOne({ _id: coach._id }),
    User.deleteOne({ _id: athleteUser._id }),
  ]);
  console.log("[smoke] cleanup complete — database left as found");

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
