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
import { GuardianAthleteLink } from "../models/GuardianAthleteLink";
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
import { deletePriorAvatarFile } from "./avatar";
import { mediaFilePath } from "./media";

async function deleteMediaFiles(filter: Record<string, unknown>): Promise<void> {
  const media = await WorkoutMedia.find(filter).select("storedFilename").lean();
  await Promise.all(
    media.map((item) =>
      fs.promises.unlink(mediaFilePath(item)).catch(() => undefined)
    )
  );
}

async function deleteAthleteData(athleteId: Types.ObjectId): Promise<void> {
  await deleteMediaFiles({ athleteId });
  await Promise.all([
    AthleteNote.deleteMany({ athleteId }),
    Attendance.deleteMany({ athleteId }),
    CoachAthleteAssignment.deleteMany({ athleteId }),
    CoachComment.deleteMany({ athleteId }),
    GuardianAthleteLink.deleteMany({ athleteId }),
    Injury.deleteMany({ athleteId }),
    Message.deleteMany({ athleteId }),
    Performance.deleteMany({ athleteId }),
    Recovery.deleteMany({ athleteId }),
    RpeMonitoring.deleteMany({ athleteId }),
    TrainingSession.deleteMany({ athleteId }),
    WaterIntake.deleteMany({ athleteId }),
    Wellness.deleteMany({ athleteId }),
    WorkoutMedia.deleteMany({ athleteId }),
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
    ]);
  } else {
    await GuardianAthleteLink.deleteMany({ guardianId: userId });
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
