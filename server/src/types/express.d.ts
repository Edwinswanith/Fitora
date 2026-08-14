import type { Types } from "mongoose";
import type { UserRole } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      actor?: {
        userId: Types.ObjectId;
        role: UserRole;
        academyId?: Types.ObjectId | null;
        isAcademyOwner?: boolean;
        assignedAthleteIds?: Types.ObjectId[];
        linkedAthleteIds?: Types.ObjectId[];
        athleteProfileId?: Types.ObjectId;
      };
    }
  }
}

export {};
