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
import { ExerciseMedia } from "../models/ExerciseMedia";
import { WorkoutTemplate } from "../models/WorkoutTemplate";
import { CoachSwitchIntent } from "../models/CoachSwitchIntent";
import { CoachJoinRequest } from "../models/CoachJoinRequest";
import { Meal } from "../models/Meal";
import { MealFood } from "../models/MealFood";
import { MealScan } from "../models/MealScan";
import { MealScanItem } from "../models/MealScanItem";
import { NutritionTarget } from "../models/NutritionTarget";
import { PlannedMeal } from "../models/PlannedMeal";
import { Routine } from "../models/Routine";
import { VoiceActionReceipt } from "../models/VoiceActionReceipt";
import { deletePriorAvatarFile } from "./avatar";
import { deleteStoredObject } from "./objectStorage";

async function deleteObjects(keys: (string | null | undefined)[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteStoredObject(key)));
}

async function deleteMediaFiles(filter: Record<string, unknown>): Promise<void> {
  const media = await WorkoutMedia.find(filter).select("storedFilename").lean();
  await deleteObjects(media.map((item) => item.storedFilename));
}

/** Meals and meal scans own child rows (foods, scan items) and scan photos. */
async function deleteNutritionData(athleteId: Types.ObjectId): Promise<void> {
  const [meals, scans] = await Promise.all([
    Meal.find({ athleteId }).select("_id").lean(),
    MealScan.find({ athleteId }).select("_id storedFilename").lean(),
  ]);
  await deleteObjects(scans.map((scan) => scan.storedFilename));
  await Promise.all([
    MealFood.deleteMany({ mealId: { $in: meals.map((meal) => meal._id) } }),
    MealScanItem.deleteMany({ scanId: { $in: scans.map((scan) => scan._id) } }),
  ]);
  await Promise.all([
    Meal.deleteMany({ athleteId }),
    MealScan.deleteMany({ athleteId }),
    NutritionTarget.deleteMany({ athleteId }),
    PlannedMeal.deleteMany({ athleteId }),
    Routine.deleteMany({ athleteId }),
  ]);
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
  const sessions = await TrainingSession.find({ athleteId }).select("photos.storedFilename").lean();
  await deleteObjects(sessions.flatMap((session) => (session.photos ?? []).map((photo) => photo.storedFilename)));
  await deleteNutritionData(athleteId);
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
    CoachSwitchIntent.deleteMany({ athleteId }),
    CoachJoinRequest.deleteMany({ athleteId }),
  ]);
  await AthleteProfile.deleteOne({ _id: athleteId });
}

/** Permanently removes a user and all personal rows owned by that account. */
export async function permanentlyDeleteAccount(user: UserDoc): Promise<void> {
  const userId = user._id as Types.ObjectId;

  await deletePriorAvatarFile(user);
  await VoiceActionReceipt.deleteMany({ userId });

  if (user.role === "athlete") {
    const profile = await AthleteProfile.findOne({ userId }).select("_id").lean();
    if (profile) await deleteAthleteData(profile._id);
  } else if (user.role === "coach") {
    await deleteMediaFiles({ coachId: userId });
    const coachVideos = await CoachVideo.find({ coachId: userId }).select("storedFilename").lean();
    await deleteObjects(coachVideos.map((v) => v.storedFilename));
    const exerciseMedia = await ExerciseMedia.find({ coachId: userId }).select("storedFilename").lean();
    await deleteObjects(exerciseMedia.map((m) => m.storedFilename));
    // A pending switch to this coach can never complete now.
    await CoachSwitchIntent.deleteMany({ toCoachId: userId });
    await CoachJoinRequest.deleteMany({ coachId: userId });
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
      ExerciseMedia.deleteMany({ coachId: userId }),
      WorkoutTemplate.deleteMany({ ownerId: userId }),
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
