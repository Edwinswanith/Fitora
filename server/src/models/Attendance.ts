import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const ATTENDANCE_STATUS = ["present", "absent", "late", "excused", "rest"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[number];

const attendanceSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUS, required: true },
    note: { type: String },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

attendanceSchema.index({ athleteId: 1, date: -1 }, { unique: true });

export type AttendanceDoc = InferSchemaType<typeof attendanceSchema> & {
  _id: Types.ObjectId;
};
export const Attendance: Model<AttendanceDoc> = model<AttendanceDoc>(
  "Attendance",
  attendanceSchema
);
