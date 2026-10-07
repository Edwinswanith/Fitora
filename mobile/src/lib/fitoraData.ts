import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiJson } from "./api";
import type { AvatarInfo } from "../components/Avatar";
import type { SessionSlot } from "./sessions";
import type { JoinRequest } from "./joinRequests";

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
  /**
   * Only populated on items from the /workout-assignments?from=&to= range
   * endpoint (used for upcomingWorkouts/recentWorkouts) — that endpoint
   * returns the full WorkoutAssignmentView, not this lighter summary shape,
   * so exerciseCount/completedCount/progressPercent are NOT reliable there.
   * Prefer a loaded WorkoutAssignmentDetail's `exercises.length` instead.
   */
  assignedByRole?: string;
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
  targetWeightKg?: number | null;
  timezone?: string | null;
  hydrationGoalMl?: number | null;
  fitnessGoal?: string | null;
  goalIntensity?: string | null;
  activityLevel?: string | null;
  biologicalSex?: string | null;
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
  /** Step-by-step numbers behind `calories` (server: explainNutritionTarget). */
  breakdown?: NutritionTargetBreakdown | null;
};

export type NutritionTargetBreakdown = {
  inputs: { weightKg: number; heightCm: number; age: number; biologicalSex: string; activityLevel: string; goal: string; goalIntensity: string };
  bmr: number;
  activityFactor: number;
  tdee: number;
  goalDelta: number;
  floorApplied: "minimum" | "resting_burn" | null;
  calories: number;
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
  /** Distinct weekday numbers (0=Sun..6=Sat) this coach has ANY recurring availability rule for — a weekly pattern, never resolved bookable slots (those require an active relationship to compute). */
  availableDays?: number[];
};

export type MarketplaceCoach = Omit<PublicCoachProfile, "pricingPlans" | "bio" | "philosophy" | "certifications"> & {
  startingPrice?: { amount: number; currency: string } | null;
  hasAvailability?: boolean;
};

export type MarketplaceFilters = {
  specialization?: string;
  nutritionSupport?: boolean;
  minExperience?: number;
  minRating?: number;
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

export type CoachAvailabilityException = {
  id: string;
  date: string;
  type: "unavailable" | "custom_hours";
  startMinute?: number | null;
  endMinute?: number | null;
  reason?: string | null;
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
  /** Athletes asking to join (payments-off path). Optional: older saved data won't have it. */
  joinRequests?: JoinRequest[];
  partialIssues: string[];
};

export type CoachPlanData = CoachHomeData & {
  templates: { id: string; name: string; exercises?: unknown[]; estimatedDurationMin?: number | null; version?: number }[];
  mealPlans: { id: string; name: string; durationDays?: number; days?: unknown[]; status?: string }[];
  tomorrowWorkouts: (WorkoutAssignmentSummary & { athleteId: string; athleteName: string })[];
  routineStatus: {
    athleteId: string;
    athleteName: string;
    workoutName: string | null;
    workoutStatus: string | null;
    mealPlanName: string | null;
    mealPlanActive: boolean;
    /** True when a fetch for this athlete failed — workoutName/mealPlanName are unknown, not genuinely empty. */
    dataUnavailable?: boolean;
  }[];
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
  availabilityExceptions: CoachAvailabilityException[];
  reviews: CoachReview[];
  partialIssues: string[];
};

export type CoachClientNutrition = {
  target: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  } | null;
  mealsLoggedCount: number;
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
};

export type CoachClientDetailData = {
  athleteId: string;
  daily: DailyCard | null;
  workouts: WorkoutAssignmentSummary[];
  trends: TrendPoint[];
  activity: ActivityItem[];
  nutrition: CoachClientNutrition | null;
  sessions: CoachSession[];
  partialIssues: string[];
};

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** True when saved data is on screen but the latest refresh failed (e.g. offline). */
  stale: boolean;
  reload: () => void;
  /**
   * Patches this screen's data in place — no network call. Use after a
   * mutation whose response (or request body) already tells you the new
   * shape, instead of calling `reload()` and re-running the whole loader
   * just to reflect one small change. Also updates the shared cache entry
   * (if this hook has a cacheKey), so a background `reload()` started
   * afterward reconciles against the patched value, not stale pre-mutation
   * data.
   */
  setData: (value: T | ((prev: T | null) => T | null)) => void;
};

type CacheEntry = { key: string; data: unknown; listeners: Set<(data: unknown) => void> };

/**
 * Cross-mount, in-memory cache keyed by screen identity (e.g. "athlete-dashboard").
 * Lets a screen that remounts (navigated away and back, not just re-rendered)
 * paint instantly from last-known data instead of a full loading screen, while
 * a fresh fetch still runs in the background — stale-while-revalidate, not a
 * substitute for actually refetching. Also saved on the device per user (see
 * hydrateDataCache below) so a cold start paints instantly too.
 *
 * Also doubles as a tiny pub/sub: `updateCachedData` lets a *different*
 * screen (e.g. a "log meal" detail screen) patch another screen's data (e.g.
 * the dashboard it's about to navigate back to) and have that screen's
 * `useAsyncData` instance pick up the change immediately if it's still
 * mounted underneath — no network round-trip, no remount.
 */
const asyncDataCache = new Map<string, CacheEntry>();

function getCacheEntry(key: string): CacheEntry {
  let entry = asyncDataCache.get(key);
  if (!entry) {
    entry = { key, data: undefined, listeners: new Set() };
    asyncDataCache.set(key, entry);
  }
  return entry;
}

/*
 * On-device copy of the cache, so a cold app start paints the last-known
 * screens instantly instead of a loading state. The server/database stays the
 * source of truth: every screen still refetches on mount and the fresh result
 * replaces the saved copy. Stored per signed-in user and wiped on sign-out,
 * account deletion and session rejection (see lib/auth.tsx), so one person
 * never sees another person's data on a shared device.
 */
const PERSIST_PREFIX = "fitora.cache.v1:";
const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 400;
let cacheOwner: string | null = null;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

type PersistedEntry = { savedAt: number; data: unknown };

function persistKey(owner: string, key: string): string {
  return `${PERSIST_PREFIX}${owner}:${key}`;
}

function schedulePersist(entry: CacheEntry): void {
  const owner = cacheOwner;
  if (!owner || entry.data === undefined || entry.data === null) return;
  const existing = pendingWrites.get(entry.key);
  if (existing) clearTimeout(existing);
  pendingWrites.set(
    entry.key,
    setTimeout(() => {
      pendingWrites.delete(entry.key);
      if (cacheOwner !== owner) return;
      const value: PersistedEntry = { savedAt: Date.now(), data: entry.data };
      AsyncStorage.setItem(persistKey(owner, entry.key), JSON.stringify(value)).catch(() => undefined);
    }, PERSIST_DEBOUNCE_MS)
  );
}

/**
 * Data stamped with a calendar day (a `date: "YYYY-MM-DD"` field, like the
 * dashboards) is only reused on that same day: yesterday's "today" numbers
 * shown as today's would be wrong, not just stale.
 */
function isReusable(entry: PersistedEntry, today: string, now: number): boolean {
  if (now - entry.savedAt > PERSIST_MAX_AGE_MS) return false;
  const data = entry.data as { date?: unknown } | null;
  if (data && typeof data === "object" && typeof data.date === "string" && data.date !== today) return false;
  return true;
}

/**
 * Loads the signed-in user's saved screens into the in-memory cache. Call
 * once per session start, before screens mount. Only touches local storage.
 */
export async function hydrateDataCache(owner: string): Promise<void> {
  if (cacheOwner !== owner) clearInMemoryCache();
  cacheOwner = owner;
  try {
    const prefix = persistKey(owner, "");
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    if (!keys.length) return;
    const today = todayKey();
    const now = Date.now();
    const stale: string[] = [];
    for (const [storageKey, raw] of await AsyncStorage.multiGet(keys)) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as PersistedEntry;
        if (!isReusable(parsed, today, now)) {
          stale.push(storageKey);
          continue;
        }
        const entry = getCacheEntry(storageKey.slice(prefix.length));
        if (entry.data === undefined) entry.data = parsed.data;
      } catch {
        stale.push(storageKey);
      }
    }
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    // Saved data is only an optimization; screens load from the server anyway.
  }
}

function clearInMemoryCache(): void {
  pendingWrites.forEach((timer) => clearTimeout(timer));
  pendingWrites.clear();
  asyncDataCache.forEach((entry) => {
    entry.data = undefined;
  });
}

/** Forgets every saved screen for every user on this device (sign-out, account deletion). */
export async function clearDataCache(): Promise<void> {
  cacheOwner = null;
  clearInMemoryCache();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PERSIST_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Nothing else to do; a later hydrate for a different owner never reads these keys.
  }
}

/**
 * Patches the cached value for `cacheKey` and immediately pushes the result
 * to every currently-mounted `useAsyncData` instance using that key. `prev`
 * is `undefined` if nothing has ever populated this cache key yet (e.g. that
 * screen was never visited this session) — return `undefined` to no-op in
 * that case rather than fabricate a value; that screen's own mount-time
 * fetch will populate it correctly whenever it's actually opened.
 */
export function updateCachedData<T>(cacheKey: string, updater: (prev: T | undefined) => T | undefined): void {
  const entry = getCacheEntry(cacheKey);
  const next = updater(entry.data as T | undefined);
  if (next === undefined) return;
  entry.data = next;
  schedulePersist(entry);
  entry.listeners.forEach((listener) => listener(next));
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[] = [], cacheKey?: string): AsyncState<T> {
  const entry = cacheKey ? getCacheEntry(cacheKey) : null;
  const cached = entry && entry.data !== undefined ? (entry.data as T) : null;
  const [data, setDataState] = useState<T | null>(cached);
  // Matches whatever the mount-time effect below is about to do — avoids a
  // one-frame gap where neither the loading screen nor the cached content
  // has painted yet (useEffect runs after the first commit, not before it).
  const [loading, setLoading] = useState(cached === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  const setData = useCallback(
    (value: T | ((prev: T | null) => T | null)) => {
      setDataState((prev) => {
        const next = typeof value === "function" ? (value as (prev: T | null) => T | null)(prev) : value;
        if (entry) {
          entry.data = next;
          schedulePersist(entry);
        }
        return next;
      });
    },
    [entry]
  );

  // Picks up patches made by a *different* mounted screen via updateCachedData
  // (e.g. a detail screen that navigated back here after a save).
  useEffect(() => {
    if (!entry) return;
    const listener = (value: unknown) => setDataState(value as T);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }, [entry]);

  useEffect(() => {
    let active = true;
    // Reflects whether this specific effect run started with data already
    // in hand (either from a prior successful load, or hydrated from cache
    // on a fresh mount) — not affected by the setData call below, since this
    // effect doesn't re-run until version/deps change again.
    const hadDataAtStart = data !== null;
    if (hadDataAtStart) setRefreshing(true);
    else setLoading(true);
    setError(null);

    loader()
      .then((result) => {
        if (!active) return;
        setData(result);
        setStale(false);
      })
      .catch(() => {
        if (!active) return;
        // A background revalidation failing shouldn't blow away perfectly
        // good data already on screen — only surface the error state when
        // there's genuinely nothing to show instead.
        if (!hadDataAtStart) setError("Check your connection and try again.");
        else setStale(true);
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

  return { data, loading, refreshing, error, stale, reload, setData };
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

/** Header date that fits one line on a phone: "Wednesday, Oct 7". */
export function headerDate(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function timeOfDayGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

const MEAL_SLOT_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, snack: 2, dinner: 3 };

/** The next PlannedMeal for the day that hasn't been logged yet (by `Meal.plannedMealId`), in meal order. */
export function nextPendingPlannedMeal(plannedMeals: PlannedMeal[], meals: Meal[]): PlannedMeal | null {
  const loggedPlannedIds = new Set(meals.map((meal) => meal.plannedMealId).filter(Boolean) as string[]);
  const pending = plannedMeals.filter((meal) => !loggedPlannedIds.has(meal.id));
  if (!pending.length) return null;
  return [...pending].sort((a, b) => (MEAL_SLOT_ORDER[a.mealType] ?? 99) - (MEAL_SLOT_ORDER[b.mealType] ?? 99))[0];
}

export type NextActionKind =
  | "payment"
  | "checkin"
  | "workout_active"
  | "workout_upcoming"
  | "rpe"
  | "session"
  | "meal"
  | "hydration"
  | "complete";

export type NextAction = {
  kind: NextActionKind;
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
};

/**
 * The single highest-priority thing the athlete should do right now, derived
 * from real dashboard state (Today's "what should I do next?" engine). Order
 * matters: each branch below is only reached once every higher-priority
 * condition is ruled out.
 */
export function deriveNextAction(data: AthleteDashboardData): NextAction {
  if (data.subscription?.status === "payment_failed") {
    return {
      kind: "payment",
      eyebrow: "Action needed",
      title: "Payment failed",
      body: "Update your payment method to keep training with your coach.",
      ctaLabel: "View Membership",
    };
  }

  if (data.daily?.readinessScore == null) {
    return {
      kind: "checkin",
      eyebrow: "Next up",
      title: "Check in",
      body: "Under a minute. It sets your readiness.",
      ctaLabel: "Check In",
    };
  }

  const workout = data.workouts[0] ?? null;
  if (workout) {
    const inProgress = workout.status === "in_progress" || (workout.completedCount > 0 && workout.completedCount < workout.exerciseCount);
    if (inProgress) {
      return {
        kind: "workout_active",
        eyebrow: "Next up",
        title: workout.name,
        body: `${workout.completedCount} / ${workout.exerciseCount} exercises complete`,
        ctaLabel: "Continue Workout",
      };
    }
    if (workout.status === "scheduled" && workout.completedCount === 0) {
      return {
        kind: "workout_upcoming",
        eyebrow: "Next up",
        title: workout.name,
        body: `${workout.exerciseCount} exercise${workout.exerciseCount === 1 ? "" : "s"}`,
        ctaLabel: "Start Workout",
      };
    }
    if (workout.status === "completed") {
      const rpeLogged = workout.slot ? data.daily?.rpeEntries?.[workout.slot] : data.daily?.rpe;
      if (!rpeLogged) {
        return {
          kind: "rpe",
          eyebrow: "Next up",
          title: "Daily review",
          body: "How hard was today's session?",
          ctaLabel: "Log RPE",
        };
      }
    }
  }

  const nextSession = nextFutureSession(data.sessions);
  if (nextSession && dateKey(new Date(nextSession.scheduledStart)) === data.date) {
    return {
      kind: "session",
      eyebrow: "Next up",
      title: "Coach Session",
      body: sessionClock(nextSession),
      ctaLabel: "View Session",
    };
  }

  const pendingMeal = nextPendingPlannedMeal(data.plannedMeals, data.meals);
  if (pendingMeal) {
    return {
      kind: "meal",
      eyebrow: "Next up",
      title: pendingMeal.name || titleCase(pendingMeal.mealType) || "Meal",
      body: `${titleCase(pendingMeal.mealType)} from your plan`,
      ctaLabel: "Log Meal",
    };
  }

  if (data.water && data.water.goalMl > 0 && data.water.totalMl < data.water.goalMl) {
    return {
      kind: "hydration",
      eyebrow: "Next up",
      title: "Hydration",
      body: `${(Math.max(0, data.water.goalMl - data.water.totalMl) / 1000).toFixed(1)} L to go`,
      ctaLabel: "Log Water",
    };
  }

  return {
    kind: "complete",
    eyebrow: "All set",
    title: "Day complete",
    body: "Nice work. Nothing left for today.",
    ctaLabel: "",
  };
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

export type MarketplaceData = {
  coaches: MarketplaceCoach[];
  total: number;
  /** The athlete's current active coach, if any — from the real CoachAthleteAssignment, not just a paid subscription (see coach-discovery.tsx). */
  currentCoachId: string | null;
};

/**
 * Sends every filter the backend actually supports as a real query param
 * (server/src/routes/marketplace.ts) — specialization/coachingType/language
 * are exact-match on coach-entered free text with no enumeration endpoint,
 * so the UI only offers values it has already seen in a loaded batch rather
 * than a fabricated fixed list.
 */
export async function loadMarketplaceCoaches(filters: MarketplaceFilters = {}): Promise<MarketplaceData> {
  const params = new URLSearchParams({ limit: "50" });
  if (filters.specialization) params.set("specialization", filters.specialization);
  if (filters.nutritionSupport) params.set("nutritionSupport", "true");
  if (filters.minExperience != null) params.set("minExperience", String(filters.minExperience));
  if (filters.minRating != null) params.set("minRating", String(filters.minRating));
  const [coaches, assigned] = await Promise.all([
    apiJson<{ coaches: MarketplaceCoach[]; total: number }>(`/api/marketplace/coaches?${params.toString()}`),
    apiJson<{ coaches: { coachId: string; name: string }[] }>("/api/athlete/coaches").catch(() => ({ coaches: [] })),
  ]);
  return { coaches: coaches.coaches, total: coaches.total, currentCoachId: assigned.coaches[0]?.coachId ?? null };
}

export type CoachMarketplaceProfileData = {
  profile: PublicCoachProfile;
  reviews: CoachReview[];
  reviewsTotal: number;
};

const REVIEWS_PAGE_SIZE = 5;

export async function loadCoachMarketplaceProfile(coachId: string): Promise<CoachMarketplaceProfileData> {
  const [profileResult, reviewsResult] = await Promise.all([
    apiJson<{ profile: PublicCoachProfile }>(`/api/marketplace/coaches/${coachId}`),
    apiJson<{ reviews: CoachReview[]; total: number }>(`/api/marketplace/coaches/${coachId}/reviews?limit=${REVIEWS_PAGE_SIZE}`),
  ]);
  return { profile: profileResult.profile, reviews: reviewsResult.reviews, reviewsTotal: reviewsResult.total };
}

export async function loadMoreCoachReviews(coachId: string, page: number): Promise<CoachReview[]> {
  const result = await apiJson<{ reviews: CoachReview[] }>(`/api/marketplace/coaches/${coachId}/reviews?limit=${REVIEWS_PAGE_SIZE}&page=${page}`);
  return result.reviews;
}

export async function loadCoachHomeData(): Promise<CoachHomeData> {
  const date = todayKey();
  const issues: string[] = [];
  const [dashboard, roster, sessions, squad, notes, joinRequests] = await Promise.all([
    optional("dashboard", apiJson<{ cards: DailyCard[] }>(`/api/coach/dashboard?date=${date}`), issues),
    optional("clients", apiJson<{ athletes: CoachRosterAthlete[] }>("/api/coach/athletes"), issues),
    optional("sessions", apiJson<{ sessions: CoachSession[] }>("/api/coach/sessions"), issues),
    optional("squad analytics", apiJson<{ series: CoachHomeData["squadSeries"] }>("/api/coach/analytics/squad?days=7"), issues),
    optional("notes", apiJson<CoachHomeData["notesInbox"]>("/api/coach/notes-inbox?days=14"), issues),
    optional("client requests", apiJson<{ requests: JoinRequest[] }>("/api/coach/join-requests"), issues),
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
    joinRequests: joinRequests?.requests ?? [],
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

  const routineStatus = await Promise.all(
    base.roster.slice(0, 20).map(async (athlete) => {
      const [todayWorkout, mealPlanAssignments] = await Promise.all([
        apiJson<{ assignments: WorkoutAssignmentSummary[] }>(`/api/coach/athletes/${athlete.athleteId}/workout-assignments?date=${base.date}`).catch(() => "error" as const),
        apiJson<{ assignments: { name: string; status: string; isPast: boolean }[] }>(`/api/coach/athletes/${athlete.athleteId}/meal-plan-assignments`).catch(() => "error" as const),
      ]);
      const dataUnavailable = todayWorkout === "error" || mealPlanAssignments === "error";
      if (dataUnavailable) issues.push(`routine status: ${athlete.name}`);
      const workout = todayWorkout === "error" ? null : todayWorkout?.assignments?.[0] ?? null;
      const mealPlan = mealPlanAssignments === "error" ? null : mealPlanAssignments?.assignments?.find((a) => a.status === "active") ?? mealPlanAssignments?.assignments?.[0] ?? null;
      return {
        athleteId: athlete.athleteId,
        athleteName: athlete.name,
        workoutName: workout?.name ?? null,
        workoutStatus: workout?.status ?? null,
        mealPlanName: mealPlan?.name ?? null,
        mealPlanActive: mealPlan ? mealPlan.status === "active" && !mealPlan.isPast : false,
        dataUnavailable,
      };
    })
  );

  return {
    ...base,
    templates: templates?.templates ?? [],
    mealPlans: mealPlans?.mealPlans ?? [],
    tomorrowWorkouts: tomorrowGroups.flat(),
    routineStatus,
    partialIssues: issues,
  };
}

export async function loadCoachContentData(): Promise<CoachContentData> {
  const issues: string[] = [];
  const [videos, roster, templates] = await Promise.all([
    optional("videos", apiJson<{ videos: CoachVideo[] }>("/api/coach/videos?includeArchived=1"), issues),
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
  const exceptionsFrom = todayKey();
  const exceptionsTo = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [profile, pricingPlans, availability, exceptions] = await Promise.all([
    optional("profile", apiJson<{ profile: CoachOwnProfile }>("/api/coach/profile"), issues),
    optional("pricing plans", apiJson<{ pricingPlans: PricingPlan[] }>("/api/coach/pricing-plans"), issues),
    optional("availability", apiJson<{ rules: CoachAvailabilityRule[] }>("/api/coach/availability"), issues),
    optional(
      "availability exceptions",
      apiJson<{ exceptions: CoachAvailabilityException[] }>(`/api/coach/availability/exceptions?from=${exceptionsFrom}&to=${exceptionsTo}`),
      issues
    ),
  ]);
  const publicCoachId = profile?.profile?.coachId ?? profile?.profile?.id;
  const reviews = profile?.profile?.active && publicCoachId
    ? await optional("reviews", apiJson<{ reviews: CoachReview[] }>(`/api/marketplace/coaches/${publicCoachId}/reviews?limit=5`), issues)
    : null;
  return {
    profile: profile?.profile ?? null,
    pricingPlans: pricingPlans?.pricingPlans ?? [],
    availabilityRules: availability?.rules ?? [],
    availabilityExceptions: exceptions?.exceptions ?? [],
    reviews: reviews?.reviews ?? [],
    partialIssues: issues,
  };
}

export async function loadCoachClientDetailData(athleteId: string): Promise<CoachClientDetailData> {
  const date = todayKey();
  const issues: string[] = [];
  const [daily, workouts, trends, activity, nutrition, sessions] = await Promise.all([
    optional("daily card", apiJson<{ card: DailyCard; workoutAssignments?: WorkoutAssignmentSummary[] }>(`/api/coach/athletes/${athleteId}/daily-card?date=${date}`), issues),
    optional("workouts", apiJson<{ assignments: WorkoutAssignmentSummary[] }>(`/api/coach/athletes/${athleteId}/workout-assignments?date=${date}`), issues),
    optional("trends", apiJson<{ series: TrendPoint[] }>(`/api/coach/athletes/${athleteId}/trends?days=28`), issues),
    optional("activity", apiJson<{ items: ActivityItem[] }>(`/api/coach/athletes/${athleteId}/activity?limit=20`), issues),
    optional("nutrition", apiJson<CoachClientNutrition>(`/api/coach/athletes/${athleteId}/nutrition?date=${date}`), issues),
    optional("sessions", apiJson<{ sessions: CoachSession[] }>(`/api/coach/sessions?athleteId=${athleteId}`), issues),
  ]);
  return {
    athleteId,
    daily: daily?.card ?? null,
    workouts: workouts?.assignments ?? daily?.workoutAssignments ?? [],
    trends: trends?.series ?? [],
    activity: activity?.items ?? [],
    nutrition: nutrition ?? null,
    sessions: sessions?.sessions ?? [],
    partialIssues: issues,
  };
}
