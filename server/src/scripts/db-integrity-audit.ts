/**
 * Phase 12 §36 — read-only database integrity audit against a real (or
 * connected) MongoDB. Reports inconsistencies; NEVER writes, deletes, or
 * repairs anything — a finding here is a prompt for a human-reviewed fix, not
 * something this script applies automatically. Safe to run repeatedly.
 *
 * Run with: npx ts-node src/scripts/db-integrity-audit.ts   (from server/)
 */
import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { AthleteCoachSubscription } from "../models/AthleteCoachSubscription";
import { CoachSwitchIntent } from "../models/CoachSwitchIntent";
import { CoachSessionSlotLock } from "../models/CoachSessionSlotLock";
import { CoachSession } from "../models/CoachSession";
import { MealPlanAssignment } from "../models/MealPlanAssignment";
import { MealPlan } from "../models/MealPlan";
import { WorkoutAssignment } from "../models/WorkoutAssignment";
import { CoachReview } from "../models/CoachReview";
import { CoachVideoProgress } from "../models/CoachVideoProgress";
import { CoachVideo } from "../models/CoachVideo";

type Finding = { check: string; severity: "info" | "warn" | "error"; count: number; sampleIds: string[] };

const findings: Finding[] = [];

function report(check: string, severity: Finding["severity"], ids: mongoose.Types.ObjectId[]) {
  findings.push({ check, severity, count: ids.length, sampleIds: ids.slice(0, 10).map((id) => id.toString()) });
}

async function checkDuplicateActiveCoachRelationships() {
  const rows = await CoachAthleteAssignment.aggregate<{ _id: mongoose.Types.ObjectId; count: number; ids: mongoose.Types.ObjectId[] }>([
    { $match: { status: "active" } },
    { $group: { _id: "$athleteId", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  report(
    "athlete has >1 active CoachAthleteAssignment (violates the one-primary-coach invariant)",
    "error",
    rows.flatMap((r) => r.ids)
  );
}

async function checkDuplicateNonTerminalSubscriptions() {
  const rows = await AthleteCoachSubscription.aggregate<{ _id: mongoose.Types.ObjectId; count: number; ids: mongoose.Types.ObjectId[] }>([
    { $match: { status: { $in: ["pending", "active", "payment_due"] } } },
    { $group: { _id: "$athleteId", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  report("athlete has >1 non-terminal AthleteCoachSubscription", "error", rows.flatMap((r) => r.ids));
}

async function checkStalePendingSwitchIntents() {
  // A pending CoachSwitchIntent older than 24h almost certainly means the
  // athlete abandoned checkout — not a corruption, but worth surfacing since
  // it silently blocks that athlete from starting a NEW switch (unique-
  // partial index on {athleteId, status:"pending"}).
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await CoachSwitchIntent.find({ status: "pending", createdAt: { $lt: cutoff } }).select("_id").lean();
  report("CoachSwitchIntent stuck in pending >24h (blocks that athlete from starting a new switch)", "warn", rows.map((r) => r._id));
}

async function checkOrphanSlotLocks() {
  const locks = await CoachSessionSlotLock.find().select("_id sessionId").lean();
  if (locks.length === 0) return;
  const sessionIds = [...new Set(locks.map((l) => l.sessionId.toString()))];
  const existingSessions = await CoachSession.find({ _id: { $in: sessionIds } }).select("_id status").lean();
  const existingById = new Map(existingSessions.map((s) => [s._id.toString(), s.status]));
  const orphanIds: mongoose.Types.ObjectId[] = [];
  for (const lock of locks) {
    const status = existingById.get(lock.sessionId.toString());
    // A lock is orphaned if its session no longer exists, OR the session is
    // already terminal (cancelled/completed/missed) — a live lock should
    // only ever point at a still-open session (see bookingConcurrency.ts).
    if (!status || ["cancelled", "completed", "missed"].includes(status)) {
      orphanIds.push(lock._id);
    }
  }
  report("orphaned CoachSessionSlotLock (session missing or already terminal)", "error", orphanIds);
}

async function checkMealPlanAssignmentOrphans() {
  const assignments = await MealPlanAssignment.find().select("_id mealPlanId").lean();
  if (assignments.length === 0) return;
  const planIds = [...new Set(assignments.map((a) => a.mealPlanId.toString()))];
  const existingPlans = await MealPlan.find({ _id: { $in: planIds } }).select("_id").lean();
  const existingSet = new Set(existingPlans.map((p) => p._id.toString()));
  const orphanIds = assignments.filter((a) => !existingSet.has(a.mealPlanId.toString())).map((a) => a._id);
  report("MealPlanAssignment references a deleted MealPlan (snapshot is self-contained, so this is informational, not broken)", "info", orphanIds);
}

async function checkWorkoutAssignmentSnapshotCorruption() {
  const rows = await WorkoutAssignment.find({
    $or: [{ nameSnapshot: { $in: [null, ""] } }, { templateVersionSnapshot: { $exists: false } }],
  })
    .select("_id")
    .lean();
  report("WorkoutAssignment with a missing/corrupt snapshot (nameSnapshot/templateVersionSnapshot)", "error", rows.map((r) => r._id));
}

async function checkDuplicateReviewsPerRelationship() {
  const rows = await CoachReview.aggregate<{ _id: mongoose.Types.ObjectId; count: number; ids: mongoose.Types.ObjectId[] }>([
    { $group: { _id: "$relationshipId", count: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  report("relationship has >1 CoachReview (violates the one-review-per-relationship unique index)", "error", rows.flatMap((r) => r.ids));
}

async function checkOrphanVideoProgress() {
  const rows = await CoachVideoProgress.find().select("_id videoId").lean();
  if (rows.length === 0) return;
  const videoIds = [...new Set(rows.map((r) => r.videoId.toString()))];
  const existingVideos = await CoachVideo.find({ _id: { $in: videoIds } }).select("_id").lean();
  const existingSet = new Set(existingVideos.map((v) => v._id.toString()));
  const orphanIds = rows.filter((r) => !existingSet.has(r.videoId.toString())).map((r) => r._id);
  report("CoachVideoProgress points at a deleted CoachVideo", "warn", orphanIds);
}

async function run() {
  await connectMongo();
  console.log("[db-integrity-audit] connected to", mongoose.connection.db?.databaseName);

  await checkDuplicateActiveCoachRelationships();
  await checkDuplicateNonTerminalSubscriptions();
  await checkStalePendingSwitchIntents();
  await checkOrphanSlotLocks();
  await checkMealPlanAssignmentOrphans();
  await checkWorkoutAssignmentSnapshotCorruption();
  await checkDuplicateReviewsPerRelationship();
  await checkOrphanVideoProgress();

  console.log("\n[db-integrity-audit] REPORT (read-only — nothing was modified)\n");
  let worst: Finding["severity"] = "info";
  for (const f of findings) {
    const marker = f.count === 0 ? "OK  " : f.severity === "error" ? "FAIL" : f.severity === "warn" ? "WARN" : "INFO";
    console.log(`[${marker}] ${f.check}: ${f.count}${f.count > 0 ? ` (sample ids: ${f.sampleIds.join(", ")})` : ""}`);
    if (f.count > 0 && f.severity === "error") worst = "error";
    else if (f.count > 0 && f.severity === "warn" && worst !== "error") worst = "warn";
  }
  console.log(`\n[db-integrity-audit] overall: ${worst.toUpperCase()}`);

  await disconnectMongo();
  process.exit(worst === "error" ? 1 : 0);
}

run().catch(async (err) => {
  console.error("[db-integrity-audit] FAILED:", err);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
