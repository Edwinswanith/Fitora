import fs from "fs";
import { randomUUID } from "crypto";
import multer from "multer";
import { Types, type HydratedDocument } from "mongoose";
import { env } from "../config/env";
import { deleteStoredObject } from "./objectStorage";
import {
  ExerciseMedia,
  type ExerciseMediaDoc,
  ALLOWED_EXERCISE_MEDIA_MIME_TYPES,
  type AllowedExerciseMediaMimeType,
  type ExerciseMediaKind,
} from "../models/ExerciseMedia";

const EXT_BY_MIME: Record<AllowedExerciseMediaMimeType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

const VIDEO_MIME_TYPES = new Set<AllowedExerciseMediaMimeType>(["video/mp4", "video/webm", "video/quicktime"]);

export function kindForMime(mimeType: string): ExerciseMediaKind {
  return VIDEO_MIME_TYPES.has(mimeType as AllowedExerciseMediaMimeType) ? "video" : "image";
}

fs.mkdirSync(env.upload.dir, { recursive: true });

/**
 * Same local-disk-under-env.upload.dir pattern as services/media.ts's
 * mediaUpload (never a statically-served directory; server-generated
 * filename, never the client's originalname). A separate multer instance
 * because the allowed mime whitelist differs (images + short video here).
 */
export const exerciseMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.upload.dir),
    filename: (_req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype as AllowedExerciseMediaMimeType] ?? "";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: env.upload.maxSizeBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_EXERCISE_MEDIA_MIME_TYPES.includes(file.mimetype as AllowedExerciseMediaMimeType)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});

export type ExerciseMediaView = {
  id: string;
  coachId: string;
  originalName: string;
  mimeType: string;
  kind: ExerciseMediaKind;
  sizeBytes: number;
  durationSec: number | null;
  createdAt: string;
};

export function serializeExerciseMedia(m: ExerciseMediaDoc): ExerciseMediaView {
  return {
    id: m._id.toString(),
    coachId: (m.coachId as Types.ObjectId).toString(),
    originalName: m.originalName,
    mimeType: m.mimeType,
    kind: m.kind as ExerciseMediaKind,
    sizeBytes: m.sizeBytes,
    durationSec: (m.durationSec as number | undefined) ?? null,
    createdAt: (m.createdAt as Date).toISOString(),
  };
}

export async function deleteExerciseMediaFile(doc: HydratedDocument<ExerciseMediaDoc>): Promise<void> {
  await deleteStoredObject(doc.storedFilename);
}
