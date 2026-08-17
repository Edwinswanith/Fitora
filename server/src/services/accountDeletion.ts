import fs from "fs";
import { Types } from "mongoose";
import { Announcement } from "../models/Announcement";
import { AthleteNote } from "../models/AthleteNote";
import { AthleteProfile } from "../models/AthleteProfile";
import { Attendance } from "../models/Attendance";
import { AuditLog } from "../models/AuditLog";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachComment } from "../models/CoachComment";
import { DeviceToken } from "../models/DeviceToken";
import { Injury } from "../models/Injury";
import { Message } from "../models/Message";
import { Notification } from "../models/Notification";
import { NotificationDecision } from "../models/NotificationDecision";
import { NotificationPreference } from "../models/NotificationPreference";
import { Performance } from "../models/Performance";
import { Recovery } from "../models/Recovery";
import { RpeMonitoring } from "../models/RpeMonitoring";
import { TrainingSession } from "../models/TrainingSession";
import { User, type UserDoc } from "../models/User";
import { WaterIntake } from "../models/WaterIntake";
import { Wellness } from "../models/Wellness";
import { WorkoutMedia } from "../models/WorkoutMedia";
import { AthleteCoachSubscription } from "../models/AthleteCoachSubscription";
import { Payment } from "../models/Payment";
import { CoachAvailability } from "../models/CoachAvailability";
import { CoachAvailabilityException } from "../models/CoachAvailabilityException";
import { CoachSession } from "../models/CoachSession";
import { CoachSessionSlotLock } from "../models/CoachSessionSlotLock";
import { CoachVideo } from "../models/CoachVideo";
import { CoachVideoProgress } from "../models/CoachVideoProgress";
import { CoachReview } from "../models/CoachReview";
import { CoachPricingPlan } from "../models/CoachPricingPlan";
import { CoachProfile } from "../models/CoachProfile";
import { deletePriorAvatarFile } from "./avatar";
import { mediaFilePath } from "./media";
import { coachVideoFilePath } from "./coachVideo";

async function deleteMediaFiles(filter: Record<string, unknown>): Promise<void> {
  const media = await WorkoutMedia.find(filter).select("storedFilename").lean();
  await Promise.all(
    media.map((item) =>
      fs.promises.unlink(mediaFilePath(item)).catch(() => undefined)
    )
  );
}

/** Payment rows have no direct athleteId/coachId of their own — they're reached only through their owning subscriptions. */
async function deleteSubscriptionsAndPayments(filter: Record<string, unknown>): Promise<void> {
  const subscriptions = await AthleteCoachSubscription.find(filter).select("_id").lean();
  const subscriptionIds = subscriptions.map((s) => s._id);
  await Promise.all([
    Payment.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    AthleteCoachSubscription.deleteMany(filter),
  ]);
}

/** CoachSessionSlotLock rows are reached only through their owning sessions. */
async function deleteSessionsAndLocks(filter: Record<string, unknown>): Promise<void> {
  const sessions = await CoachSession.find(filter).select("_id").lean();
  const sessionIds = sessions.map((s) => s._id);
  await Promise.all([
    CoachSessionSlotLock.deleteMany({ sessionId: { $in: sessionIds } }),
    CoachSession.deleteMany(filter),
  ]);
}

async function deleteAthleteData(athleteId: Types.ObjectId): Promise<void> {
  await deleteMediaFiles({ athleteId });
  await Promise.all([
    AthleteNote.deleteMany({ athleteId }),
    Attendance.deleteMany({ athleteId }),
    CoachAthleteAssignment.deleteMany({ athleteId }),
    CoachComment.deleteMany({ athleteId }),
    Injury.deleteMany({ athleteId }),
    Message.deleteMany({ athleteId }),
    Performance.deleteMany({ athleteId }),
    Recovery.deleteMany({ athleteId }),
    RpeMonitoring.deleteMany({ athleteId }),
    TrainingSession.deleteMany({ athleteId }),
    WaterIntake.deleteMany({ athleteId }),
    Wellness.deleteMany({ athleteId }),
    WorkoutMedia.deleteMany({ athleteId }),
    deleteSubscriptionsAndPayments({ athleteId }),
    deleteSessionsAndLocks({ athleteId }),
    CoachVideoProgress.deleteMany({ athleteId }),
    CoachReview.deleteMany({ athleteId }),
  ]);
  await AthleteProfile.deleteOne({ _id: athleteId });
}

/** Permanently removes a user and all personal rows owned by that account. */
export async function permanentlyDeleteAccount(user: UserDoc): Promise<void> {
  const userId = user._id as Types.ObjectId;

  await deletePriorAvatarFile(user);

  if (user.role === "athlete") {
    const profile = await AthleteProfile.findOne({ userId }).select("_id").lean();
    if (profile) await deleteAthleteData(profile._id);
  } else if (user.role === "coach") {
    await deleteMediaFiles({ coachId: userId });
    const coachVideos = await CoachVideo.find({ coachId: userId }).select("storedFilename").lean();
    await Promise.all(coachVideos.map((v) => fs.promises.unlink(coachVideoFilePath(v)).catch(() => undefined)));
    await Promise.all([
      Announcement.deleteMany({ coachId: userId }),
      CoachAthleteAssignment.deleteMany({
        $or: [{ coachId: userId }, { assignedBy: userId }],
      }),
      CoachComment.deleteMany({ coachId: userId }),
      Message.deleteMany({ coachId: userId }),
      WorkoutMedia.deleteMany({ coachId: userId }),
      Attendance.updateMany({ recordedBy: userId }, { $unset: { recordedBy: "" } }),
      RpeMonitoring.updateMany({ coachId: userId }, { $set: { coachId: null } }),
      TrainingSession.updateMany({ coachId: userId }, { $unset: { coachId: "" } }),
      deleteSubscriptionsAndPayments({ coachId: userId }),
      deleteSessionsAndLocks({ coachId: userId }),
      CoachAvailability.deleteMany({ coachId: userId }),
      CoachAvailabilityException.deleteMany({ coachId: userId }),
      CoachVideoProgress.deleteMany({ videoId: { $in: coachVideos.map((v) => v._id) } }),
      CoachVideo.deleteMany({ coachId: userId }),
      CoachReview.deleteMany({ coachId: userId }),
      CoachPricingPlan.deleteMany({ coachId: userId }),
      CoachProfile.deleteOne({ userId }),
    ]);
  }

  await Promise.all([
    Notification.deleteMany({ recipientUserId: userId }),
    NotificationDecision.deleteMany({ userId }),
    NotificationPreference.deleteOne({ userId }),
    DeviceToken.deleteMany({ userId }),
    AuditLog.deleteMany({ actorId: userId }),
  ]);
  await User.deleteOne({ _id: userId });
}
