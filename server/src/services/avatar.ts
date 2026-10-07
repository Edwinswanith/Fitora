import { deleteStoredObject } from "./objectStorage";
import { type UserDoc, AVATAR_DEFAULT_IDS, type AvatarDefaultId } from "../models/User";
import { mediaUpload } from "./media";

/** Reuses the same generic image-upload multer instance the coach-media feature uses. */
export { mediaUpload as avatarUpload };

export function isValidAvatarDefaultId(value: unknown): value is AvatarDefaultId {
  return typeof value === "string" && (AVATAR_DEFAULT_IDS as readonly string[]).includes(value);
}

/** Deletes the previously-uploaded avatar photo, if any (best-effort). */
export async function deletePriorAvatarFile(user: Pick<UserDoc, "avatarStoredFilename">): Promise<void> {
  await deleteStoredObject(user.avatarStoredFilename);
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
