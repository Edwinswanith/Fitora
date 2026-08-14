import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const USER_ROLES = ["coach", "athlete", "guardian"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// Profile-photo alternative: a small catalog of bundled badge icons the client
// renders locally (no server-side image asset) — the server only stores which
// one was picked. Distinct from an uploaded photo (avatarKind: "photo").
export const AVATAR_DEFAULT_IDS = ["male-1", "male-2", "female-1", "female-2"] as const;
export type AvatarDefaultId = (typeof AVATAR_DEFAULT_IDS)[number];

export const AVATAR_KINDS = ["photo", "default"] as const;
export type AvatarKind = (typeof AVATAR_KINDS)[number];

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    // Scoped coach capability (NOT an admin role): an "academy owner" is a coach
    // who can also create/list other coaches in their academy. See CLAUDE.md.
    isAcademyOwner: { type: Boolean, default: false },
    // Set when a coach provisions the account with a temp password — the user is
    // nudged to set their own password on first sign-in. Cleared on change.
    mustChangePassword: { type: Boolean, default: false },
    refreshTokenHash: { type: String },
    // Stable identifier returned by Sign in with Apple. Email/name are not a
    // reliable account key because Apple may only disclose them on first use.
    appleSubject: { type: String, unique: true, sparse: true, index: true },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", index: true },
    // Profile avatar — either an uploaded photo or a bundled default badge.
    // null/unset means the client falls back to rendering initials.
    avatarKind: { type: String, enum: AVATAR_KINDS, default: null },
    avatarStoredFilename: { type: String, default: null },
    avatarMimeType: { type: String, default: null },
    avatarDefaultId: { type: String, enum: AVATAR_DEFAULT_IDS, default: null },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete (ret as Record<string, unknown>).passwordHash;
    delete (ret as Record<string, unknown>).refreshTokenHash;
    delete (ret as Record<string, unknown>).avatarStoredFilename;
    return ret;
  },
});

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User: Model<UserDoc> = model<UserDoc>("User", userSchema);
