import { Types, type PipelineStage } from "mongoose";
import { CoachProfile, type CoachProfileDoc } from "../models/CoachProfile";
import type { CoachPricingPlanDoc } from "../models/CoachPricingPlan";
import { CoachAvailability } from "../models/CoachAvailability";
import { avatarSummary, type AvatarSummary } from "./avatar";

/** Lazily creates a CoachProfile on first access — no backfill migration needed. */
export async function getOrCreateCoachProfile(coachUserId: Types.ObjectId): Promise<InstanceType<typeof CoachProfile>> {
  const existing = await CoachProfile.findOne({ userId: coachUserId });
  if (existing) return existing;
  try {
    return await CoachProfile.create({ userId: coachUserId });
  } catch (err) {
    // Race: two concurrent first-accesses both miss the findOne — the
    // unique index on userId makes the loser's create() fail with 11000;
    // re-read rather than erroring the request.
    if ((err as { code?: number }).code === 11000) {
      const raced = await CoachProfile.findOne({ userId: coachUserId });
      if (raced) return raced;
    }
    throw err;
  }
}

export function serializeOwnCoachProfile(profile: CoachProfileDoc, user: { name?: string; email?: string } | null) {
  return {
    id: profile._id.toString(),
    coachId: (profile.userId as Types.ObjectId).toString(),
    name: user?.name ?? "",
    email: user?.email ?? "",
    bio: profile.bio ?? null,
    philosophy: profile.philosophy ?? null,
    yearsExperience: profile.yearsExperience ?? null,
    certifications: profile.certifications ?? [],
    specializations: profile.specializations ?? [],
    languages: profile.languages ?? [],
    coachingTypes: profile.coachingTypes ?? [],
    nutritionSupport: profile.nutritionSupport,
    verifiedStatus: profile.verifiedStatus,
    avgRating: profile.avgRating ?? null,
    reviewCount: profile.reviewCount ?? 0,
    active: profile.active,
  };
}

function serializePricingPlan(p: CoachPricingPlanDoc) {
  return {
    id: p._id.toString(),
    name: p.name,
    monthlyPrice: p.monthlyPrice,
    currency: p.currency,
    description: p.description ?? null,
    includedServices: p.includedServices ?? [],
    liveSessionsPerCycle: p.liveSessionsPerCycle,
    nutritionIncluded: p.nutritionIncluded,
    workoutPlanningIncluded: p.workoutPlanningIncluded,
    messagingIncluded: p.messagingIncluded,
    priority: p.priority,
    active: p.active,
    version: p.version,
  };
}
export { serializePricingPlan };

/**
 * The PUBLIC marketplace view — an explicit allowlist of fields, never a
 * spread of the underlying User/CoachProfile documents. Deliberately
 * excludes email, academyId, isAcademyOwner, mustChangePassword, and every
 * other User field not named here — adding a new User field can never leak
 * into this response by accident.
 */
export function serializePublicCoachProfile(
  coachUserId: Types.ObjectId,
  profile: CoachProfileDoc,
  user: { name?: string; avatarKind?: string | null; avatarDefaultId?: string | null },
  pricingPlans: CoachPricingPlanDoc[],
  availableDays: number[] = []
) {
  return {
    coachId: coachUserId.toString(),
    name: user.name ?? "",
    avatar: avatarSummary(user as Parameters<typeof avatarSummary>[0]) as AvatarSummary,
    bio: profile.bio ?? null,
    philosophy: profile.philosophy ?? null,
    yearsExperience: profile.yearsExperience ?? null,
    certifications: profile.certifications ?? [],
    specializations: profile.specializations ?? [],
    languages: profile.languages ?? [],
    coachingTypes: profile.coachingTypes ?? [],
    nutritionSupport: profile.nutritionSupport,
    verifiedStatus: profile.verifiedStatus,
    avgRating: profile.avgRating ?? null,
    reviewCount: profile.reviewCount ?? 0,
    pricingPlans: pricingPlans.filter((p) => p.active).map(serializePricingPlan),
    // Recurring weekly pattern only (0=Sun..6=Sat) — never resolved bookable
    // slots, which require an active relationship to compute (see
    // routes/athleteSessions.ts). This is just an honest "does this coach
    // publish any weekly availability at all, and roughly which days"
    // signal for browsing, not a booking surface.
    availableDays,
  };
}

/** Distinct weekday numbers (0=Sun..6=Sat) this coach has ANY availability rule for. */
export async function loadAvailableDays(coachUserId: Types.ObjectId): Promise<number[]> {
  const days = await CoachAvailability.distinct("dayOfWeek", { coachId: coachUserId });
  return (days as number[]).sort((a, b) => a - b);
}

export type MarketplaceFilters = {
  specialization?: string;
  coachingType?: string;
  language?: string;
  minExperience?: number;
  maxPrice?: number;
  minRating?: number;
  nutritionSupport?: boolean;
  page: number;
  limit: number;
};

type MarketplaceAggRow = {
  userId: Types.ObjectId;
  yearsExperience: number | null;
  specializations: string[];
  languages: string[];
  coachingTypes: string[];
  nutritionSupport: boolean;
  verifiedStatus: string;
  avgRating: number | null;
  reviewCount: number;
  user: { name?: string; avatarKind?: string | null; avatarDefaultId?: string | null } | null;
  startingPrice: { amount: number; currency: string } | null;
  hasAvailability: boolean;
};

/**
 * A single aggregation pipeline — matches profiles, joins Users and each
 * coach's minimum active price via $lookup, filters by maxPrice BEFORE
 * paginating (a post-hoc in-memory filter after skip/limit would silently
 * corrupt both the page contents and the total count), and returns the page
 * + total count together via $facet. One round trip, no N+1, and pagination
 * numbers that are actually consistent with the applied filters.
 */
export async function listMarketplaceCoaches(filters: MarketplaceFilters) {
  const match: Record<string, unknown> = { active: true };
  if (filters.specialization) match.specializations = filters.specialization;
  if (filters.coachingType) match.coachingTypes = filters.coachingType;
  if (filters.language) match.languages = filters.language;
  if (filters.nutritionSupport !== undefined) match.nutritionSupport = filters.nutritionSupport;
  if (filters.minExperience !== undefined) match.yearsExperience = { $gte: filters.minExperience };
  if (filters.minRating !== undefined) match.avgRating = { $gte: filters.minRating };

  const skip = (filters.page - 1) * filters.limit;

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    {
      $lookup: {
        from: "coachpricingplans",
        let: { coachId: "$userId" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$coachId", "$$coachId"] }, { $eq: ["$active", true] }] } } },
          { $group: { _id: null, minPrice: { $min: "$monthlyPrice" }, currency: { $first: "$currency" } } },
        ],
        as: "pricing",
      },
    },
    {
      $lookup: {
        from: "coachavailabilities",
        let: { coachId: "$userId" },
        pipeline: [{ $match: { $expr: { $eq: ["$coachId", "$$coachId"] } } }, { $limit: 1 }, { $project: { _id: 1 } }],
        as: "availabilityRows",
      },
    },
    {
      $addFields: {
        startingPrice: {
          $cond: [{ $gt: [{ $size: "$pricing" }, 0] }, { amount: { $arrayElemAt: ["$pricing.minPrice", 0] }, currency: { $arrayElemAt: ["$pricing.currency", 0] } }, null],
        },
        hasAvailability: { $gt: [{ $size: "$availabilityRows" }, 0] },
      },
    },
  ];
  if (filters.maxPrice !== undefined) {
    pipeline.push({ $match: { $or: [{ startingPrice: null }, { "startingPrice.amount": { $lte: filters.maxPrice } }] } });
  }
  pipeline.push(
    { $sort: { avgRating: -1, updatedAt: -1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: filters.limit }],
        totalCount: [{ $count: "count" }],
      },
    }
  );

  const [result] = await CoachProfile.aggregate(pipeline);
  const rows = (result?.data ?? []) as MarketplaceAggRow[];
  const total = (result?.totalCount?.[0]?.count as number | undefined) ?? 0;

  const coaches = rows.map((r) => ({
    coachId: r.userId.toString(),
    name: r.user?.name ?? "",
    avatar: avatarSummary((r.user ?? {}) as Parameters<typeof avatarSummary>[0]),
    yearsExperience: r.yearsExperience ?? null,
    specializations: r.specializations ?? [],
    languages: r.languages ?? [],
    coachingTypes: r.coachingTypes ?? [],
    nutritionSupport: r.nutritionSupport,
    verifiedStatus: r.verifiedStatus,
    avgRating: r.avgRating ?? null,
    reviewCount: r.reviewCount ?? 0,
    startingPrice: r.startingPrice ?? null,
    hasAvailability: Boolean(r.hasAvailability),
  }));

  return { coaches, total, page: filters.page, limit: filters.limit };
}
