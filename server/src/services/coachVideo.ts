import fs from "fs";
import { randomUUID } from "crypto";
import multer from "multer";
import { Types } from "mongoose";
import { env } from "../config/env";
import { deleteStoredObject } from "./objectStorage";
import { CoachVideo, type CoachVideoDoc, ALLOWED_COACH_VIDEO_MIME_TYPES, type AllowedCoachVideoMimeType } from "../models/CoachVideo";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { AthleteCoachSubscription } from "../models/AthleteCoachSubscription";

const EXT_BY_MIME: Record<AllowedCoachVideoMimeType, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

fs.mkdirSync(env.upload.dir, { recursive: true });

/** Same local-disk-under-env.upload.dir pattern as services/exerciseMedia.ts, with a much higher size cap (full-length content, not short demo clips). */
export const coachVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.upload.dir),
    filename: (_req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype as AllowedCoachVideoMimeType] ?? "";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: env.upload.coachVideoMaxSizeBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_COACH_VIDEO_MIME_TYPES.includes(file.mimetype as AllowedCoachVideoMimeType)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});

export async function deleteCoachVideoFile(doc: Pick<CoachVideoDoc, "storedFilename">): Promise<void> {
  await deleteStoredObject(doc.storedFilename);
}

export type CoachVideoView = {
  id: string;
  coachId: string;
  title: string;
  description: string | null;
  category: string;
  visibility: string;
  selectedClientIds: string[];
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

export function serializeCoachVideo(v: CoachVideoDoc): CoachVideoView {
  return {
    id: v._id.toString(),
    coachId: (v.coachId as Types.ObjectId).toString(),
    title: v.title,
    description: v.description ?? null,
    category: v.category,
    visibility: v.visibility,
    selectedClientIds: (v.selectedClientIds as Types.ObjectId[]).map((id) => id.toString()),
    originalName: v.originalName,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    durationSec: (v.durationSec as number | undefined) ?? null,
    isArchived: v.isArchived,
    createdAt: (v.createdAt as Date).toISOString(),
    updatedAt: (v.updatedAt as Date).toISOString(),
  };
}

export type AthleteVideoAccessContext = {
  hasActiveRelationship: boolean;
  /** Only meaningful when hasActiveRelationship is true — active/payment_due subscription, or no subscription linked at all (backward-compatible, unpaywalled). */
  subscriberEntitled: boolean;
};

/**
 * One-round-trip lookup of an athlete's relationship/subscription state
 * against a specific coach — hoisted out of the per-video visibility check
 * so listing a coach's library doesn't re-query the same relationship once
 * per video (see isVideoVisible below).
 */
export async function loadAthleteVideoAccessContext(coachId: Types.ObjectId, athleteId: Types.ObjectId): Promise<AthleteVideoAccessContext> {
  const relationship = await CoachAthleteAssignment.findOne({ coachId, athleteId, status: "active" })
    .select("subscriptionId")
    .lean();
  if (!relationship) return { hasActiveRelationship: false, subscriberEntitled: false };

  if (!relationship.subscriptionId) return { hasActiveRelationship: true, subscriberEntitled: true };
  const subscription = await AthleteCoachSubscription.findById(relationship.subscriptionId).select("status").lean();
  const subscriberEntitled = !subscription || ["active", "payment_due"].includes(subscription.status);
  return { hasActiveRelationship: true, subscriberEntitled };
}

/**
 * Pure visibility check given an already-loaded access context — see
 * CoachVideo's own doc comment for the full per-tier rule set.
 */
export function isVideoVisible(
  video: Pick<CoachVideoDoc, "visibility" | "selectedClientIds">,
  athleteId: Types.ObjectId,
  context: AthleteVideoAccessContext
): boolean {
  if (video.visibility === "public_preview") return true;
  if (!context.hasActiveRelationship) return false;
  if (video.visibility === "selected_clients") {
    return (video.selectedClientIds as Types.ObjectId[]).some((id) => id.equals(athleteId));
  }
  if (video.visibility === "subscribers") return context.subscriberEntitled;
  return false; // "private" — never athlete-visible, regardless of relationship.
}

/** Convenience single-video wrapper (stream/progress routes) — internally does the one-off context lookup. */
export async function canAthleteAccessVideo(video: Pick<CoachVideoDoc, "coachId" | "visibility" | "selectedClientIds">, athleteId: Types.ObjectId): Promise<boolean> {
  const context = await loadAthleteVideoAccessContext(video.coachId as Types.ObjectId, athleteId);
  return isVideoVisible(video, athleteId, context);
}
