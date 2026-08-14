import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const DEVICE_TOKEN_PLATFORMS = ["android", "ios", "web"] as const;
export type DeviceTokenPlatform = (typeof DEVICE_TOKEN_PLATFORMS)[number];

/**
 * One row per registered push token. Registration is upsert-by-`token` (see
 * routes/deviceTokens.ts), so a token correctly reassigns to a new user if the
 * same device signs into a different account. `disabledAt` is a soft-disable —
 * set when FCM reports the token as UNREGISTERED/NOT_FOUND — rather than a
 * hard delete, so a stale token still shows up in delivery-history debugging.
 */
const deviceTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    platform: { type: String, enum: DEVICE_TOKEN_PLATFORMS, required: true },
    token: { type: String, required: true },
    appVersion: { type: String, default: null },
    deviceName: { type: String, default: null },
    osName: { type: String, default: null },
    osVersion: { type: String, default: null },
    lastSeenAt: { type: Date, default: () => new Date() },
    disabledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ token: 1 }, { unique: true });
deviceTokenSchema.index({ userId: 1, disabledAt: 1 });

export type DeviceTokenDoc = InferSchemaType<typeof deviceTokenSchema> & {
  _id: Types.ObjectId;
};
export const DeviceToken: Model<DeviceTokenDoc> = model<DeviceTokenDoc>(
  "DeviceToken",
  deviceTokenSchema
);
