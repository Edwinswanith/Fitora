import { useCallback, useEffect, useState } from "react";
import { apiJson } from "./api";
import type { AvatarInfo } from "../components/Avatar";
import type { SessionSlot } from "./sessions";

export type Band = "green" | "amber" | "red";

export type DailySession = {
  status: string | null;
  type: string | null;
  durationMin?: number | null;
  intensityRpe?: number | null;
  workoutType?: string | null;
  actualDurationMin?: number | null;
};

export type DailyCard = {
  athleteId: string;
  name: string;
  sport?: string | null;
  position?: string | null;
  date: string;
  attendance?: { status: string | null; note?: string | null };
  sessions?: Record<SessionSlot, DailySession>;
  readinessScore: number | null;
  sleep?: { hours: number | null; quality: number | null };
  soreness?: number | null;
  fatigue?: number | null;
  recovery?: { status: string | null; score: number | null; restingHr?: number | null; hrv?: number | null };
  injury?: { active: boolean; bodyPart: string | null; severity?: string | null; restriction?: string | null };
  rpe?: { calculatedTrainingLoad: number; riskFlag: Band; rpe?: number; readinessScore?: number } | null;
  rpeEntries?: Record<SessionSlot, { riskFlag: Band; rpe?: number; calculatedTrainingLoad?: number } | null>;
};

export type WorkoutAssignmentSummary = {
  id: string;
  templateId: string;
  name: string;
  scheduledDate: string;
  slot: SessionSlot | null;
  status: string;
  exerciseCount: number;
  completedCount: number;
  progressPercent: number;
};

export type WorkoutAssignmentDetail = WorkoutAssignmentSummary & {
  exercises: {
    title: string;
    type: string;
    sets: number | null;
    reps: string | null;
    durationSec: number | null;
    restSec: number | null;
    instructions: string | null;
    mediaId: string | null;
    notes: string | null;
    order: number;
  }[];
  progress: {
    exerciseIndex: number;
    status: string;
    setsCompleted: { setNumber: number; reps: number | null; weightKg: number | null; durationSec: number | null }[];
    notes: string | null;
    completedAt: string | null;
  }[];
  assignedBy?: string;
  assignedByRole?: string;
  trainingSessionId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type AthleteProfile = {
  name: string;
  email: string;
  createdAt: string | null;
  sport?: string | null;
  position?: string | null;
  dob?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  timezone?: string | null;
  hydrationGoalMl?: number | null;
  fitnessGoal?: string | null;
  goalIntensity?: string | null;
  activityLevel?: string | null;
  dietaryPreferences?: string[];
  allergies?: string[];
  cuisinePreferences?: string[];
};

export type NutritionTarget = {
  id: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fitnessGoal?: string | null;
  goalIntensity?: string | null;
  effectiveFrom?: string;
};

export type MealFood = {
  id?: string;
  name: string;
  quantity?: number;
  unit?: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence?: number | null;
};

export type Meal = {
  id: string;
  date: string;
  mealType: string;
  source: string;
  name: string | null;
  plannedMealId?: string | null;
  loggedAt?: string;
  foods: MealFood[];
};

export type PlannedMeal = {
  id: string;
  date: string;
  mealType: string;
  source: string;
  name: string | null;
  foods: MealFood[];
};

export type WaterDay = {
  date: string;
  goalMl: number;
  totalMl: number;
  entries: { id: string; amountMl: number; loggedAt: string }[];
};

export type AssignedCoach = { coachId: string; name: string };

export type PricingPlanSnapshot = {
  name: string;
  monthlyPrice: number;
  currency: string;
  includedServices?: string[];
  liveSessionsPerCycle?: number | null;
  nutritionIncluded?: boolean;
  workoutPlanningIncluded?: boolean;
  messagingIncluded?: boolean;
};

export type Subscription = {
  id: string;
  athleteId: string;
  coachId: string;
  status: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  pricingPlanSnapshot?: PricingPlanSnapshot;
  pricingPlan?: PricingPlanSnapshot;
};

export type CoachSession = {
  id: string;
  coachId: string;
  athleteId: string;
  athleteName?: string | null;
  coachName?: string | null;
  type: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  bufferMin?: number;
};

export type CoachVideo = {
  id: string;
  coachId: string;
  title: string;
  description: string | null;
  category: string;
  visibility: string;
  selectedClientIds: string[];
  durationSec: number | null;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicCoachProfile = {
  coachId: string;
  name: string;
  avatar?: AvatarInfo;
  bio?: string | null;
  philosophy?: string | null;
  yearsExperience?: number | null;
  certifications?: string[];
  specializations?: string[];
  languages?: string[];
  coachingTypes?: string[];
  nutritionSupport?: boolean;
  verifiedStatus?: string;
  avgRating?: number | null;
  reviewCount?: number;
  pricingPlans?: PricingPlan[];
};

export type MarketplaceCoach = Omit<PublicCoachProfile, "pricingPlans" | "bio" | "philosophy" | "certifications"> & {
  startingPrice?: { amount: number; currency: string } | null;
};

export type PricingPlan = {
  id: string;
  name: string;
  monthlyPrice: number;
  currency: string;
  description?: string | null;
  includedServices?: string[];
  liveSessionsPerCycle?: number | null;
  nutritionIncluded?: boolean;
  workoutPlanningIncluded?: boolean;
  messagingIncluded?: boolean;
  priority?: number;
  active?: boolean;
};

export type CoachAvailabilityRule = {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
  sessionDurationMin: number;
  bufferMin: number;
};

export type CoachReview = {
  id: string;
  athleteName?: string | null;
  overallRating: number;
  body?: string | null;
  createdAt: string;
};

export type CoachOwnProfile = {
  id: string;
  coachId?: string;
  name: string;
  email: string;
  bio: string | null;
  philosophy: string | null;
  yearsExperience: number | null;
  certifications: string[];
  specializations: string[];
  languages: string[];
  coachingTypes: string[];
  nutritionSupport: boolean;
  verifiedStatus: string;
  avgRating: number | null;
  reviewCount: number;
  active: boolean;
};

export type CoachRosterAthlete = {
  athleteId: string;
  userId?: string;
  name: string;
  email?: string;
  sport: string;
  position: string | null;
  avatar?: AvatarInfo;
  hasActiveMembership?: boolean;
};

export type TrendPoint = {
  date: string;
  readiness: number | null;
  load: number | null;
  sleepHours?: number | null;
  recoveryScore?: number | null;
};

export type ActivityItem = {
  id: string;
  at: string;
  kind: string;
  title: string;
  subtitle?: string;
  detail?: string;
  band?: Band;
};

export type CoachComment = {
  _id: string;
  body: string;
  date: string;
  createdAt: string;
  coachId: string;
};

export type AthleteDashboardData = {
  date: string;
  profile: AthleteProfile | null;
  daily: DailyCard | null;
  workouts: WorkoutAssignmentSummary[];
  workoutDetail: WorkoutAssignmentDetail | null;
  upcomingWorkouts: WorkoutAssignmentSummary[];
  recentWorkouts: WorkoutAssignmentSummary[];
  target: NutritionTarget | null;
  meals: Meal[];
  mealTotals: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  plannedMeals: PlannedMeal[];
  water: WaterDay | null;
  coaches: AssignedCoach[];
  subscription: Subscription | null;
  sessions: CoachSession[];
  videos: CoachVideo[];
  coachProfile: PublicCoachProfile | null;
  trends: TrendPoint[];
  nutritionWeek: { date: string; loggedMeals: number; calories: number }[];
  coachComments: CoachComment[];
  partialIssues: string[];
};

export type CoachHomeData = {
  date: string;
  cards: DailyCard[];
  roster: CoachRosterAthlete[];
  sessions: CoachSession[];
  squadSeries: { date: string; avgReadiness: number | null; attendanceRate: number | null; avgLoad: number | null; redFlags: number; athleteCount: number }[];
  notesInbox: { openCount: number; notes: { noteId: string; athleteId: string; athleteName: string; body: string; date: string; needsReply: boolean }[] } | null;
  partialIssues: string[];
};

export type CoachPlanData = CoachHomeData & {
  templates: { id: string; name: string; exercises?: unknown[]; estimatedDurationMin?: number | null; version?: number }[];
  mealPlans: { id: string; name: string; durationDays?: number; days?: unknown[]; status?: string }[];
  tomorrowWorkouts: (WorkoutAssignmentSummary & { athleteId: string; athleteName: string })[];
};

export type CoachContentData = {
  videos: CoachVideo[];
  roster: CoachRosterAthlete[];
  templates: CoachPlanData["templates"];
  partialIssues: string[];
};

export type CoachProfileData = {
  profile: CoachOwnProfile | null;
  pricingPlans: PricingPlan[];
  availabilityRules: CoachAvailabilityRule[];
  reviews: CoachReview[];
  partialIssues: string[];
};

export type CoachClientDetailData = {
  athleteId: string;
  daily: DailyCard | null;
  workouts: WorkoutAssignmentSummary[];
  trends: TrendPoint[];
  activity: ActivityItem[];
  partialIssues: string[];
};

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
};

export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const firstLoad = data === null;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);
    setError(null);

    loader()
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch(() => {
        if (!active) return;
        setError("Check your connection and try again.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  return { data, loading, refreshing, error, reload };
}

async function optional<T>(label: string, task: Promise<T>, issues: string[]): Promise<T | null> {
  try {
    return await task;
  } catch {
    issues.push(label);
    return null;
  }
}

function normalizeSubscription(subscription?: Subscription | null): Subscription | null {
  if (!subscription) return null;
  return {
    ...subscription,
    pricingPlanSnapshot: subscription.pricingPlanSnapshot ?? subscription.pricingPlan,
  };
}

export function todayKey(): string {
  if (__DEV__ && process.env.EXPO_PUBLIC_FITORA_QA_DATE) {
    return process.env.EXPO_PUBLIC_FITORA_QA_DATE;
  }
  return dateKey(new Date());
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function longDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function shortDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function firstName(name?: string | null, fallback = "there"): string {
  const value = (name ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return value || fallback;
}

export function titleCase(value?: string | null): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function mealCalories(meal: { foods?: MealFood[]; name?: string | null }): number {
  return Math.round((meal.foods ?? []).reduce((sum, food) => sum + (Number(food.calories) || 0), 0));
}

export function formatDuration(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatCurrency(amount?: number | null, currency = "INR"): string {
  if (!Number.isFinite(Number(amount))) return "";
  const prefix = currency === "INR" ? "Rs " : `${currency} `;
  return `${prefix}${Math.round(Number(amount)).toLocaleString()}`;
}

export function nextFutureSession(sessions: CoachSession[]): CoachSession | null {
  const qaNow = __DEV__ && process.env.EXPO_PUBLIC_FITORA_QA_DATE
    ? new Date(`${process.env.EXPO_PUBLIC_FITORA_QA_DATE}T17:15:00+05:30`).getTime()
    : null;
  const now = qaNow ?? Date.now();
  return sessions
    .filter((session) => new Date(session.scheduledStart).getTime() >= now && session.status !== "cancelled")
    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())[0] ?? null;
}

export function sessionClock(session: CoachSession): string {
  const start = new Date(session.scheduledStart);
  const end = new Date(session.scheduledEnd);
  const durationMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return `${start.toLocaleDateString(undefined, { weekday: "long" })} - ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${durationMin ? ` - ${durationMin} min` : ""}`;
}

export function attentionRank(card: DailyCard): number {
  if (card.rpe?.riskFlag === "red") return 0;
  if (card.injury?.active) return 0.5;
  if (card.readinessScore != null && card.readinessScore < 60) return 1;
  if (card.rpe?.riskFlag === "amber") return 1.5;
  if (card.readinessScore != null && card.readinessScore < 75) return 2;
  return 3;
}

export function attentionReason(card: DailyCard): string {
  if (card.rpe?.riskFlag === "red") return `High RPE${card.rpe.rpe ? ` ${card.rpe.rpe}` : ""}`;
  if (card.injury?.active) return card.injury.bodyPart ? `Injury - ${card.injury.bodyPart}` : "Injury active";
  if (card.readinessScore != null && card.readinessScore < 60) return `Low readiness ${card.readinessScore}`;
  if (card.rpe?.riskFlag === "amber") return "Training load caution";
  if (card.readinessScore != null && card.readinessScore < 75) return `Readiness ${card.readinessScore}`;
  return "Review today";
}

export function workoutStatusText(workout?: WorkoutAssignmentSummary | null): string {
  if (!workout) return "No workout planned";
  if (workout.exerciseCount <= 0) return titleCase(workout.status);
  return `${workout.completedCount} / ${workout.exerciseCount} exercises complete`;
}

export async function loadAthleteDashboardData(): Promise<AthleteDashboardData> {
  const date = todayKey();
  const issues: string[] = [];
  const tomorrow = addDays(date, 1);
  const nextWeek = addDays(date, 14);
  const historyStart = addDays(date, -30);
  const yesterday = addDays(date, -1);

  const [
    profileResult,
    dailyResult,
    targetResult,
    mealsResult,
    plannedResult,
    waterResult,
    coachesResult,
    subscriptionResult,
    sessionsResult,
    trendsResult,
    commentsResult,
    upcomingResult,
    historyResult,
  ] = await Promise.all([
    optional("profile", apiJson<{ athlete: AthleteProfile }>("/api/athlete/me"), issues),
    optional("daily", apiJson<{ card: DailyCard; workoutAssignments?: WorkoutAssignmentSummary[] }>(`/api/athlete/daily?date=${date}`), issues),
    optional("nutrition target", apiJson<{ target: NutritionTarget | null }>(`/api/athlete/nutrition/target?date=${date}`), issues),
    optional("meals", apiJson<{ meals: Meal[]; totals: { calories: number; proteinG: number; carbsG: number; fatG: number } }>(`/api/athlete/nutrition/meals?date=${date}`), issues),
    optional("planned meals", apiJson<{ plannedMeals: PlannedMeal[] }>(`/api/athlete/nutrition/planned-meals?date=${date}`), issues),
    optional("water", apiJson<WaterDay>(`/api/athlete/water?date=${date}`), issues),
    optional("coaches", apiJson<{ coaches: AssignedCoach[] }>("/api/athlete/coaches"), issues),
    optional("subscription", apiJson<{ subscription: Subscription | null }>("/api/athlete/coach-subscriptions/current"), issues),
    optional("sessions", apiJson<{ sessions: CoachSession[] }>("/api/athlete/sessions"), issues),
    optional("trends", apiJson<{ series: TrendPoint[] }>("/api/athlete/trends?days=28"), issues),
    optional("coach comments", apiJson<{ comments: CoachComment[] }>("/api/athlete/coach-comments?limit=5"), issues),
    optional("upcoming workouts", apiJson<{ assignments: WorkoutAssignmentSummary[] }>(`/api/athlete/workout-assignments?from=${tomorrow}&to=${nextWeek}`), issues),
    optional("recent workouts", apiJson<{ assignments: WorkoutAssignmentSummary[] }>(`/api/athlete/workout-assignments?from=${historyStart}&to=${yesterday}`), issues),
  ]);

  const workouts = dailyResult?.workoutAssignments ?? [];
  const firstWorkout = workouts[0] ?? null;
  const detailResult = firstWorkout
    ? await optional("workout detail", apiJson<{ assignment: WorkoutAssignmentDetail }>(`/api/athlete/workout-assignments/${firstWorkout.id}`), issues)
    : null;

  const coaches = coachesResult?.coaches ?? [];
  const coachId = coaches[0]?.coachId ?? subscriptionResult?.subscription?.coachId ?? null;
  const coachNames = new Map(coaches.map((coach) => [coach.coachId, coach.name]));
  const sessions = (sessionsResult?.sessions ?? []).map((session) => ({
    ...session,
    coachName: session.coachName ?? coachNames.get(session.coachId) ?? null,
  }));
  const [coachProfileResult, videosResult] = coachId
    ? await Promise.all([
        optional("coach profile", apiJson<{ profile: PublicCoachProfile }>(`/api/marketplace/coaches/${coachId}`), issues),
        optional("coach videos", apiJson<{ videos: CoachVideo[] }>(`/api/athlete/coach-videos?coachId=${coachId}`), issues),
      ])
    : [null, null] as const;
  const nutritionWeekDates = Array.from({ length: 7 }, (_, index) => addDays(date, index - 6));
  const nutritionWeek = await Promise.all(
    nutritionWeekDates.map(async (day) => {
      if (day === date && mealsResult) {
        return {
          date: day,
          loggedMeals: mealsResult.meals.length,
          calories: Math.round(mealsResult.totals?.calories ?? 0),
        };
      }
      try {
        const result = await apiJson<{ meals: Meal[]; totals: { calories: number; proteinG: number; carbsG: number; fatG: number } }>(
          `/api/athlete/nutrition/meals?date=${day}`
        );
        return {
          date: day,
          loggedMeals: result.meals?.length ?? 0,
          calories: Math.round(result.totals?.calories ?? 0),
        };
      } catch {
        issues.push(`meals: ${day}`);
        return { date: day, loggedMeals: 0, calories: 0 };
      }
    })
  );

  return {
    date,
    profile: profileResult?.athlete ?? null,
    daily: dailyResult?.card ?? null,
    workouts,
    workoutDetail: detailResult?.assignment ?? null,
    upcomingWorkouts: upcomingResult?.assignments ?? [],
    recentWorkouts: historyResult?.assignments ?? [],
    target: targetResult?.target ?? null,
    meals: mealsResult?.meals ?? [],
    mealTotals: mealsResult?.totals ?? null,
    plannedMeals: plannedResult?.plannedMeals ?? [],
    water: waterResult,
    coaches,
    subscription: normalizeSubscription(subscriptionResult?.subscription),
    sessions,
    videos: videosResult?.videos ?? [],
    coachProfile: coachProfileResult?.profile ?? null,
    trends: trendsResult?.series ?? [],
    nutritionWeek,
    coachComments: commentsResult?.comments ?? [],
    partialIssues: issues,
  };
}

export async function loadWorkoutDetail(assignmentId: string): Promise<WorkoutAssignmentDetail> {
  const result = await apiJson<{ assignment: WorkoutAssignmentDetail }>(`/api/athlete/workout-assignments/${assignmentId}`);
  return result.assignment;
}

export async function loadCoachHomeData(): Promise<CoachHomeData> {
  const date = todayKey();
  const issues: string[] = [];
  const [dashboard, roster, sessions, squad, notes] = await Promise.all([
    optional("dashboard", apiJson<{ cards: DailyCard[] }>(`/api/coach/dashboard?date=${date}`), issues),
    optional("clients", apiJson<{ athletes: CoachRosterAthlete[] }>("/api/coach/athletes"), issues),
    optional("sessions", apiJson<{ sessions: CoachSession[] }>("/api/coach/sessions"), issues),
    optional("squad analytics", apiJson<{ series: CoachHomeData["squadSeries"] }>("/api/coach/analytics/squad?days=7"), issues),
    optional("notes", apiJson<CoachHomeData["notesInbox"]>("/api/coach/notes-inbox?days=14"), issues),
  ]);
  const rosterRows = roster?.athletes ?? [];
  const athleteNames = new Map(rosterRows.map((athlete) => [athlete.athleteId, athlete.name]));
  const enrichedSessions = (sessions?.sessions ?? []).map((session) => ({
    ...session,
    athleteName: session.athleteName ?? athleteNames.get(session.athleteId) ?? null,
  }));

  return {
    date,
    cards: dashboard?.cards ?? [],
    roster: rosterRows,
    sessions: enrichedSessions,
    squadSeries: squad?.series ?? [],
    notesInbox: notes,
    partialIssues: issues,
  };
}

export async function loadCoachPlanData(): Promise<CoachPlanData> {
  const base = await loadCoachHomeData();
  const issues = [...base.partialIssues];
  const tomorrow = addDays(base.date, 1);
  const [templates, mealPlans, tomorrowGroups] = await Promise.all([
    optional("workout templates", apiJson<{ templates: CoachPlanData["templates"] }>("/api/workout-templates"), issues),
    optional("meal plans", apiJson<{ mealPlans: CoachPlanData["mealPlans"] }>("/api/coach/meal-plans"), issues),
    Promise.all(
      base.roster.slice(0, 20).map(async (athlete) => {
        try {
          const result = await apiJson<{ assignments: WorkoutAssignmentSummary[] }>(
            `/api/coach/athletes/${athlete.athleteId}/workout-assignments?date=${tomorrow}`
          );
          return result.assignments.map((assignment) => ({
            ...assignment,
            athleteId: athlete.athleteId,
            athleteName: athlete.name,
          }));
        } catch {
          issues.push(`tomorrow workouts: ${athlete.name}`);
          return [];
        }
      })
    ),
  ]);
  return {
    ...base,
    templates: templates?.templates ?? [],
    mealPlans: mealPlans?.mealPlans ?? [],
    tomorrowWorkouts: tomorrowGroups.flat(),
    partialIssues: issues,
  };
}

export async function loadCoachContentData(): Promise<CoachContentData> {
  const issues: string[] = [];
  const [videos, roster, templates] = await Promise.all([
    optional("videos", apiJson<{ videos: CoachVideo[] }>("/api/coach/videos"), issues),
    optional("clients", apiJson<{ athletes: CoachRosterAthlete[] }>("/api/coach/athletes"), issues),
    optional("workout templates", apiJson<{ templates: CoachPlanData["templates"] }>("/api/workout-templates"), issues),
  ]);
  return {
    videos: videos?.videos ?? [],
    roster: roster?.athletes ?? [],
    templates: templates?.templates ?? [],
    partialIssues: issues,
  };
}

export async function loadCoachProfileData(): Promise<CoachProfileData> {
  const issues: string[] = [];
  const [profile, pricingPlans, availability] = await Promise.all([
    optional("profile", apiJson<{ profile: CoachOwnProfile }>("/api/coach/profile"), issues),
    optional("pricing plans", apiJson<{ pricingPlans: PricingPlan[] }>("/api/coach/pricing-plans"), issues),
    optional("availability", apiJson<{ rules: CoachAvailabilityRule[] }>("/api/coach/availability"), issues),
  ]);
  const publicCoachId = profile?.profile?.coachId ?? profile?.profile?.id;
  const reviews = profile?.profile?.active && publicCoachId
    ? await optional("reviews", apiJson<{ reviews: CoachReview[] }>(`/api/marketplace/coaches/${publicCoachId}/reviews?limit=5`), issues)
    : null;
  return {
    profile: profile?.profile ?? null,
    pricingPlans: pricingPlans?.pricingPlans ?? [],
    availabilityRules: availability?.rules ?? [],
    reviews: reviews?.reviews ?? [],
    partialIssues: issues,
  };
}

export async function loadCoachClientDetailData(athleteId: string): Promise<CoachClientDetailData> {
  const date = todayKey();
  const issues: string[] = [];
  const [daily, workouts, trends, activity] = await Promise.all([
    optional("daily card", apiJson<{ card: DailyCard; workoutAssignments?: WorkoutAssignmentSummary[] }>(`/api/coach/athletes/${athleteId}/daily-card?date=${date}`), issues),
    optional("workouts", apiJson<{ assignments: WorkoutAssignmentSummary[] }>(`/api/coach/athletes/${athleteId}/workout-assignments?date=${date}`), issues),
    optional("trends", apiJson<{ series: TrendPoint[] }>(`/api/coach/athletes/${athleteId}/trends?days=28`), issues),
    optional("activity", apiJson<{ items: ActivityItem[] }>(`/api/coach/athletes/${athleteId}/activity?limit=20`), issues),
  ]);
  return {
    athleteId,
    daily: daily?.card ?? null,
    workouts: workouts?.assignments ?? daily?.workoutAssignments ?? [],
    trends: trends?.series ?? [],
    activity: activity?.items ?? [],
    partialIssues: issues,
  };
}
