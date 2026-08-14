import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const AUDIT_OUTCOMES = ["allow", "deny"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRole: { type: String, required: true, index: true },
    // Academy the acting user belongs to (null if unset). Tags audit rows.
    academyId: {
      type: Schema.Types.ObjectId,
      ref: "Academy",
      default: null,
      index: true,
    },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true, index: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    outcome: { type: String, enum: AUDIT_OUTCOMES, required: true, index: true },
    reason: { type: String },
    ip: { type: String },
  },
  { timestamps: true }
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ outcome: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & {
  _id: Types.ObjectId;
};

export const AuditLog: Model<AuditLogDoc> = model<AuditLogDoc>(
  "AuditLog",
  auditLogSchema
);
