import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { type UserDoc, AVATAR_DEFAULT_IDS, type AvatarDefaultId } from "../models/User";
import { mediaUpload } from "./media";

/** Reuses the same generic image-upload multer instance the coach-media feature uses. */
export { mediaUpload as avatarUpload };

export function isValidAvatarDefaultId(value: unknown): value is AvatarDefaultId {
  return typeof value === "string" && (AVATAR_DEFAULT_IDS as readonly string[]).includes(value);
}

/** Absolute path of a stored avatar photo, guaranteed to stay within the upload dir. */
export function avatarFilePath(user: Pick<UserDoc, "avatarStoredFilename">): string {
  const filename = user.avatarStoredFilename;
  if (!filename) throw new Error("no_avatar_photo");
  const resolved = path.join(env.upload.dir, filename);
  if (path.dirname(resolved) !== env.upload.dir) {
    // Defense in depth — storedFilename is always a server-generated UUID.
    throw new Error("invalid_stored_filename");
  }
  return resolved;
}

/** Deletes the previously-uploaded avatar file on disk, if any (best-effort). */
export async function deletePriorAvatarFile(user: Pick<UserDoc, "avatarStoredFilename">): Promise<void> {
  if (!user.avatarStoredFilename) return;
  await fs.promises.unlink(path.join(env.upload.dir, user.avatarStoredFilename)).catch(() => undefined);
}

export type AvatarSummary = {
  kind: "photo" | "default" | null;
  defaultId: AvatarDefaultId | null;
};

export function avatarSummary(user: Pick<UserDoc, "avatarKind" | "avatarDefaultId">): AvatarSummary {
  return {
    kind: (user.avatarKind as AvatarSummary["kind"]) ?? null,
    defaultId: (user.avatarDefaultId as AvatarDefaultId | undefined) ?? null,
  };
}
