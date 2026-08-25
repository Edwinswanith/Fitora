import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import type { ImageSourcePropType } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AlertBanner,
  AppCard,
  BottomNavigation,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  PrimaryAppBar,
  ProgressBar,
  ProgressRing,
  RowLink,
  ScreenContainer,
  SectionHeader,
  SettingsRow,
  StatusChip,
  VideoThumb,
} from "../../components/fitora";
import { Avatar } from "../../components/Avatar";
import { apiFetch, apiJson } from "../../lib/api";
import { exerciseVisual, mealVisual, planVisual, workoutVisual, type FitoraIconAsset, type FitoraVisual } from "../../lib/fitoraIcons";
import { colors, radius } from "../../lib/theme";
import {
  addDays,
  firstName,
  formatCurrency,
  formatDuration,
  loadAthleteDashboardData,
  longDate,
  mealCalories,
  nextFutureSession,
  sessionClock,
  shortDate,
  titleCase,
  todayKey,
  useAsyncData,
  workoutStatusText,
  type AthleteDashboardData,
  type CoachReview,
  type CoachSession,
  type Meal,
  type PlannedMeal,
  type TrendPoint,
  type WorkoutAssignmentDetail,
  type WorkoutAssignmentSummary,
} from "../../lib/fitoraData";

type AthleteTab = "today" | "workouts" | "nutrition" | "coach" | "progress";
type WorkoutSegment = "today" | "upcoming" | "history";

const NAV_ITEMS = [
  { key: "today", label: "Today", icon: "home-outline" as const },
  { key: "workouts", label: "Workouts", icon: "barbell-outline" as const },
  { key: "nutrition", label: "Nutrition", icon: "nutrition-outline" as const },
  { key: "progress", label: "Progress", icon: "bar-chart-outline" as const },
  { key: "profile", label: "Profile", icon: "person-circle-outline" as const },
];

const WORKOUT_IMAGE_ASSETS: Record<FitoraIconAsset, ImageSourcePropType> = {
  torso: require("../../../assets/fitora/workout-torso.png"),
  bench: require("../../../assets/fitora/workout-icon-bench.png"),
  pulldown: require("../../../assets/fitora/workout-icon-pulldown.png"),
  shoulder: require("../../../assets/fitora/workout-icon-shoulder.png"),
};

function workoutImageSource(asset?: FitoraIconAsset) {
  return asset ? WORKOUT_IMAGE_ASSETS[asset] : undefined;
}

function normalizeTab(value?: string | string[]): AthleteTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "workouts" || raw === "log") return "workouts";
  if (raw === "nutrition" || raw === "water") return "nutrition";
  if (raw === "coach" || raw === "messages" || raw === "chat") return "coach";
  if (raw === "progress" || raw === "trends" || raw === "achievements") return "progress";
  return "today";
}

function readinessLabel(score: number | null | undefined): string {
  if (score == null) return "No check-in";
  if (score >= 75) return "Good";
  if (score >= 60) return "Moderate";
  return "Low";
}

function readinessTone(score: number | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (score == null) return "neutral";
  if (score >= 75) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

function wellnessWord(value: number | null | undefined, inverse = false): string {
  if (value == null) return "Not logged";
  if (inverse) {
    if (value <= 2) return "Low";
    if (value <= 3.5) return "Moderate";
    return "High";
  }
  if (value >= 4) return "Good";
  if (value >= 2.5) return "Moderate";
  return "Low";
}

function inverseWellnessTone(value: number | null | undefined): "success" | "warning" | "neutral" {
  if (value == null) return "neutral";
  return value <= 2 ? "success" : "warning";
}

function daysUntil(dateString?: string | null): number | null {
  if (!dateString) return null;
  const now = new Date();
  const then = new Date(dateString);
  if (Number.isNaN(then.getTime())) return null;
  return Math.ceil((then.getTime() - now.getTime()) / 86400000);
}

function calorieTarget(data: AthleteDashboardData): number | null {
  return data.target?.calories ?? null;
}

function consumedCalories(data: AthleteDashboardData): number {
  return Math.round(data.mealTotals?.calories ?? 0);
}

function progress(value: number, total: number | null | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.max(0, Math.min(1, value / total));
}

function sampleSeries(points: number[], count = 5): number[] {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => points[Math.round(i * step)]);
}

function rangeToDays(range: "7D" | "4W" | "3M"): number {
  return range === "7D" ? 7 : range === "3M" ? 90 : 28;
}

function macroLine(value: number | null | undefined, target: number | null | undefined, unit = "g") {
  if (!target) return value ? `${Math.round(value)} ${unit}` : "Not set";
  return `${Math.round(value ?? 0)} / ${Math.round(target)} ${unit}`;
}

function mealName(meal: Meal | PlannedMeal): string {
  return meal.name || titleCase(meal.mealType) || "Meal";
}

function fitnessGoalLabel(value?: string | null): string {
  const label = titleCase(value);
  if (label === "Lose Weight") return "Weight Loss";
  if (label === "Gain Weight") return "Build Muscle";
  return label;
}

function orderedMealPlanRows(meals: PlannedMeal[]): PlannedMeal[] {
  const order = new Map(["breakfast", "lunch", "snack", "dinner"].map((type, index) => [type, index]));
  return [...meals].sort((a, b) => (order.get(a.mealType) ?? 99) - (order.get(b.mealType) ?? 99));
}

function estimatedWorkoutDuration(exerciseCount: number): string {
  if (exerciseCount >= 7) return "Approx. 55 min";
  if (exerciseCount >= 6) return "Approx. 45 min";
  if (exerciseCount >= 4) return "Approx. 30 min";
  return "Approx. 25 min";
}

function workoutListDuration(workout: WorkoutAssignmentSummary): string {
  const name = workout.name.toLowerCase();
  if (name.includes("lower")) return "50 min";
  if (name.includes("recovery") || name.includes("mobility")) return "25 min";
  if (name.includes("upper")) return "45 min";
  return `${workout.exerciseCount >= 6 ? 45 : 25} min`;
}

export default function AthleteDashboard() {
  const params = useLocalSearchParams<{ section?: string; refresh?: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AthleteTab>(() => normalizeTab(params.section));
  const [loggingWater, setLoggingWater] = useState(false);
  const state = useAsyncData(loadAthleteDashboardData, []);
  const reloadDashboard = state.reload;

  useEffect(() => {
    setActiveTab(normalizeTab(params.section));
  }, [params.section]);

  useEffect(() => {
    if (params.refresh) reloadDashboard();
  }, [params.refresh, reloadDashboard]);

  const bottomNav = (
    <BottomNavigation
      items={NAV_ITEMS}
      active={activeTab}
      onChange={(key) => {
        if (key === "profile") {
          router.push("/account" as never);
          return;
        }
        setActiveTab(key as AthleteTab);
      }}
    />
  );

  if (state.loading && !state.data) {
    return (
      <ScreenContainer bottomNav={bottomNav}>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer bottomNav={bottomNav}>
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  const data = state.data;
  if (!data) return null;

  async function logWater(amountMl = 250) {
    if (loggingWater) return;
    setLoggingWater(true);
    try {
      const res = await apiFetch("/api/athlete/water", {
        method: "POST",
        body: JSON.stringify({ amountMl, date: todayKey() }),
      });
      if (res.ok) state.reload();
    } finally {
      setLoggingWater(false);
    }
  }

  const isWorkoutsTab = activeTab === "workouts";
  const isProgressTab = activeTab === "progress";

  return (
    <ScreenContainer
      refreshing={state.refreshing}
      onRefresh={state.reload}
      bottomNav={bottomNav}
      avoidTopSafeArea={isWorkoutsTab || isProgressTab}
      contentStyle={isWorkoutsTab ? styles.workoutsScreenContent : isProgressTab ? styles.progressScreenContent : undefined}
    >
      {activeTab === "today" ? <TodayView data={data} onLogWater={logWater} loggingWater={loggingWater} /> : null}
      {activeTab === "workouts" ? <WorkoutsView data={data} /> : null}
      {activeTab === "nutrition" ? <NutritionView data={data} onLogWater={logWater} loggingWater={loggingWater} onReload={state.reload} /> : null}
      {activeTab === "coach" ? <CoachView data={data} /> : null}
      {activeTab === "progress" ? <ProgressView data={data} /> : null}
      {data.partialIssues.length > 0 ? (
        <Text style={styles.partialNote}>
          Some Fitora data is temporarily unavailable: {data.partialIssues.slice(0, 3).join(", ")}.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

function TodayView({
  data,
  onLogWater,
  loggingWater,
}: {
  data: AthleteDashboardData;
  onLogWater: () => void;
  loggingWater: boolean;
}) {
  const router = useRouter();
  const name = data.profile?.name ?? data.daily?.name ?? "User";
  const workout = data.workouts[0] ?? null;
  const target = calorieTarget(data);
  const consumed = consumedCalories(data);
  const nextSession = nextFutureSession(data.sessions);
  const activeCoach = data.coachProfile?.name || data.coaches[0]?.name || "your coach";
  const alert = buildTodayAlert(data, activeCoach, {
    membership: () => router.push({ pathname: "/athlete/dashboard", params: { section: "coach" } } as never),
    progress: () => router.push({ pathname: "/athlete/dashboard", params: { section: "progress" } } as never),
    checkIn: () => router.push("/athlete/check-in" as never),
  });

  return (
    <>
      <PrimaryAppBar
        greeting={`Good morning, ${firstName(name, "there")}`}
        title={longDate(data.date)}
      />

      {alert}

      <ReadinessCard data={data} />

      <AppCard>
        <Text style={styles.cardTitle}>{"Today's Plan"}</Text>
        <RowLink
          icon="barbell-outline"
          title="Workout"
          subtitle={workout?.name ?? "No workout planned"}
          value={workout ? workoutStatusText(workout) : undefined}
          progress={workout ? workout.progressPercent / 100 : null}
          onPress={() => workout && router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never)}
        />
        <Divider />
        <RowLink
          icon="restaurant-outline"
          title="Meals"
          subtitle={`${data.meals.length} logged${data.plannedMeals.length ? ` / ${data.plannedMeals.length} planned` : ""}`}
          value={target ? `${consumed} / ${target} kcal` : `${consumed} kcal`}
          progress={progress(consumed, target)}
          tone="success"
          onPress={() => router.push({ pathname: "/athlete/dashboard", params: { section: "nutrition" } } as never)}
        />
        <Divider />
        <RowLink
          icon="clipboard-outline"
          title="Coach Tasks"
          subtitle={data.coachComments[0]?.body ?? "No open coach tasks"}
          value={data.coachComments.length ? `${data.coachComments.length} notes` : undefined}
          onPress={() => router.push({ pathname: "/athlete/dashboard", params: { section: "coach" } } as never)}
        />
      </AppCard>

      {workout ? (
        <AppCard>
          <View style={styles.workoutHeaderRow}>
            <IconTile icon="body-outline" size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>{workout.name}</Text>
              <Text style={styles.muted}>{workout.exerciseCount} exercises</Text>
              <Text style={styles.muted}>Coach {firstName(activeCoach, "Coach")}</Text>
            </View>
            <View style={styles.countBlock}>
              <Text style={styles.countBlue}>{workout.completedCount}</Text>
              <Text style={styles.countMuted}>/ {workout.exerciseCount}</Text>
            </View>
          </View>
          <ProgressBar value={workout.progressPercent / 100} style={{ marginTop: 8 }} />
          <ActionButton
            label={workout.status === "completed" ? "View Workout" : "Continue Workout"}
            icon="play-outline"
            variant="filled"
            style={styles.compactButton}
            onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never)}
          />
        </AppCard>
      ) : null}

      <NutritionSummaryCard data={data} />

      <AppCard>
        <View style={styles.splitRow}>
        <View style={styles.splitPane}>
          <View style={styles.splitTitleRow}>
            <IconTile icon="water-outline" size={34} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>Water</Text>
              <Text style={styles.bigInline}>{((data.water?.totalMl ?? 0) / 1000).toFixed(1)} / {((data.water?.goalMl ?? 0) / 1000).toFixed(1)} L</Text>
            </View>
          </View>
          <ProgressBar value={progress(data.water?.totalMl ?? 0, data.water?.goalMl)} />
          <ActionButton label={loggingWater ? "Logging..." : "+250 ml"} style={styles.splitButton} onPress={() => onLogWater()} />
        </View>
        <Divider vertical />
        <View style={styles.splitPane}>
          <View style={styles.splitTitleRow}>
            <IconTile icon="leaf-outline" size={34} tone={readinessTone(data.daily?.recovery?.score ?? data.daily?.readinessScore)} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle}>Recovery</Text>
              <Text style={[styles.bigInline, { color: colors.ok }]}>{data.daily?.recovery?.status ? titleCase(data.daily.recovery.status) : readinessLabel(data.daily?.readinessScore)}</Text>
            </View>
          </View>
          <ActionButton label="View" style={styles.splitButton} onPress={() => router.push("/athlete/trends" as never)} />
        </View>
        </View>
      </AppCard>

      {data.coachComments[0] ? (
        <AppCard>
          <View style={styles.messageRow}>
        <Avatar avatar={data.coachProfile?.avatar} name={activeCoach} size={38} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.messageTitle}>From Coach {firstName(activeCoach, "Coach")}</Text>
              <Text style={styles.messageBody} numberOfLines={2}>{data.coachComments[0].body}</Text>
            </View>
            <Pressable onPress={() => router.push({ pathname: "/athlete/dashboard", params: { section: "coach" } } as never)} hitSlop={8}>
              <Text style={styles.linkText}>Reply</Text>
            </Pressable>
          </View>
        </AppCard>
      ) : null}

      {data.upcomingWorkouts[0] ? (
        <AppCard>
          <RowLink
            icon="calendar-outline"
            title="Tomorrow"
            subtitle={`${data.upcomingWorkouts[0].name} - ${Math.max(data.plannedMeals.length, 0)} planned meals`}
            value="View routine"
            onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: data.upcomingWorkouts[0].id } } as never)}
          />
        </AppCard>
      ) : null}

      {nextSession ? <SessionCard session={nextSession} coachName={activeCoach} /> : null}
    </>
  );
}

function buildTodayAlert(
  data: AthleteDashboardData,
  coachName: string,
  actions: { membership: () => void; progress: () => void; checkIn: () => void }
) {
  const sub = data.subscription;
  const renewalDays = daysUntil(sub?.currentPeriodEnd);
  if (sub?.status === "payment_failed") {
    return (
      <AlertBanner
        tone="danger"
        title="Payment failed"
        body={`Update payment to continue coaching with ${firstName(coachName, "your coach")}.`}
        action="View Membership"
        onPress={actions.membership}
      />
    );
  }
  if (sub && renewalDays != null && renewalDays >= 0 && renewalDays <= 7) {
    return (
      <AlertBanner
        title={`Membership renews in ${renewalDays} day${renewalDays === 1 ? "" : "s"}`}
        body={`Renew to continue coaching with ${firstName(coachName, "your coach")}.`}
        action="View Membership"
        onPress={actions.membership}
      />
    );
  }
  if (data.daily?.readinessScore != null && data.daily.readinessScore < 60) {
    return (
      <AlertBanner
        title="Readiness is low today"
        body="Keep today's training moderate and message your coach if anything feels off."
        action="View"
        onPress={actions.checkIn}
      />
    );
  }
  if (
    data.daily?.rpe?.riskFlag === "amber" ||
    data.daily?.recovery?.status === "moderate" ||
    (data.daily?.fatigue != null && data.daily.fatigue >= 3)
  ) {
    return (
      <AlertBanner
        title="Recovery slightly lower than usual"
        body="Keep today's workout moderate."
        action="View Progress"
        onPress={actions.progress}
      />
    );
  }
  return null;
}

function ReadinessCard({ data }: { data: AthleteDashboardData }) {
  const router = useRouter();
  const score = data.daily?.recovery?.score ?? data.daily?.readinessScore ?? null;
  const tone = readinessTone(score);
  const color = tone === "success" ? colors.ok : tone === "warning" ? colors.warn : tone === "danger" ? colors.bad : colors.primary;

  if (score == null) {
    return (
      <AppCard>
        <Text style={styles.cardTitle}>How are you feeling today?</Text>
        <Text style={styles.muted}>Complete a quick check-in so Fitora can show readiness and recovery guidance.</Text>
        <ActionButton label="Complete Check-in" icon="checkmark-circle-outline" variant="filled" style={styles.compactButton} onPress={() => router.push("/athlete/check-in" as never)} />
      </AppCard>
    );
  }

  return (
    <AppCard style={styles.readinessCard}>
      <View style={styles.readinessRow}>
        <View style={styles.readinessLeft}>
          <ProgressRing value={score / 100} label={String(Math.round(score))} color={colors.primary} size={62} />
          <View style={styles.readinessCopy}>
            <Text style={styles.readinessTitle}>Readiness</Text>
            <Text style={[styles.readinessStatus, { color }]}>{readinessLabel(score)}</Text>
            <Pressable onPress={() => router.push("/athlete/trends" as never)} hitSlop={8}>
              <Text style={styles.linkText}>View</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.readinessDivider} />
        <View style={styles.factorList}>
          <ReadinessFactor icon="moon-outline" label="Sleep" value={wellnessWord(data.daily?.sleep?.quality)} />
          <Divider />
          <ReadinessFactor icon="body-outline" label="Soreness" value={wellnessWord(data.daily?.soreness, true)} tone={inverseWellnessTone(data.daily?.soreness)} />
          <Divider />
          <ReadinessFactor icon="flash-outline" label="Fatigue" value={wellnessWord(data.daily?.fatigue, true)} tone={inverseWellnessTone(data.daily?.fatigue)} />
        </View>
      </View>
    </AppCard>
  );
}

function ReadinessFactor({
  icon,
  label,
  value,
  tone = "success",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone?: "success" | "warning" | "neutral";
}) {
  const color = tone === "success" ? colors.ok : tone === "warning" ? colors.warn : colors.inkMuted;
  return (
    <View style={styles.factorRow}>
      <Ionicons name={icon} size={15} color={colors.ink} />
      <Text style={styles.factorLabel}>{label}</Text>
      <Text style={[styles.factorValue, { color }]}>{value}</Text>
    </View>
  );
}

function SessionCard({ session, coachName }: { session: CoachSession; coachName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const scheduledStart = new Date(session.scheduledStart);
  const scheduledEnd = new Date(session.scheduledEnd);

  async function joinSession() {
    if (joining) return;
    setJoining(true);
    setSessionMessage(null);
    try {
      const res = await apiFetch(`/api/athlete/sessions/${session.id}/join-token`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string; video?: { roomRef?: string } };
      if (!res.ok) {
        const reason = body.error === "outside_join_window"
          ? "This session can be joined 10 minutes before it starts."
          : body.error === "session_not_joinable"
            ? "This session is not joinable in its current status."
            : "Could not open the video session.";
        setSessionMessage(reason);
        return;
      }
      setSessionMessage(body.video?.roomRef ? "Video room is ready." : "Session token created.");
    } catch {
      setSessionMessage("Could not reach the session service.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <AppCard>
      <Text style={styles.cardTitle}>Upcoming Session</Text>
      <View style={styles.sessionRow}>
        <Avatar avatar={undefined} name={coachName} size={46} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle}>Coach {coachName}</Text>
          <Text style={styles.muted}>{titleCase(session.type)}</Text>
          <Text style={styles.muted}>{sessionClock(session)}</Text>
        </View>
        <View style={styles.sessionActions}>
          <ActionButton
            label={expanded ? "Hide Details" : "View Session"}
            style={styles.compactButton}
            onPress={() => {
              setExpanded((value) => !value);
              setSessionMessage(null);
            }}
          />
        </View>
      </View>
      {expanded ? (
        <View style={styles.sessionDetail}>
          <View style={styles.sessionDetailRow}>
            <Text style={styles.sessionDetailLabel}>Status</Text>
            <StatusChip label={titleCase(session.status)} tone={session.status === "confirmed" || session.status === "rescheduled" ? "success" : "warning"} />
          </View>
          <View style={styles.sessionDetailRow}>
            <Text style={styles.sessionDetailLabel}>Start</Text>
            <Text style={styles.sessionDetailValue}>{scheduledStart.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
          </View>
          <View style={styles.sessionDetailRow}>
            <Text style={styles.sessionDetailLabel}>Duration</Text>
            <Text style={styles.sessionDetailValue}>{Math.max(0, Math.round((scheduledEnd.getTime() - scheduledStart.getTime()) / 60000))} min</Text>
          </View>
          <ActionButton
            label={joining ? "Opening..." : "Join Call"}
            icon="videocam-outline"
            variant="filled"
            style={styles.compactButton}
            onPress={joinSession}
          />
          {sessionMessage ? <Text style={styles.sessionMessage}>{sessionMessage}</Text> : null}
        </View>
      ) : null}
    </AppCard>
  );
}

function NutritionSummaryCard({ data }: { data: AthleteDashboardData }) {
  const router = useRouter();
  const target = data.target;
  const totals = data.mealTotals;
  const consumed = consumedCalories(data);
  if (!target) {
    return (
      <EmptyState
        icon="nutrition-outline"
        title="Nutrition target is not set"
        body="Set your profile details or ask your coach to create a meal plan."
      />
    );
  }
  return (
    <AppCard>
      <View style={styles.nutritionSummaryHead}>
        <IconTile icon="restaurant-outline" size={42} tone="success" />
        <View style={{ flex: 1 }}>
          <Text style={styles.bigInline}>{consumed} / {target.calories} kcal</Text>
          <Text style={styles.muted}>{Math.max(0, target.calories - consumed)} kcal remaining</Text>
        </View>
        <ActionButton label="Log Meal" style={styles.compactButton} onPress={() => router.push("/athlete/log-meal" as never)} />
      </View>
      <View style={styles.macroGrid}>
        <MacroMini label="Protein" value={totals?.proteinG ?? 0} target={target.proteinG} color={colors.ok} />
        <MacroMini label="Carbs" value={totals?.carbsG ?? 0} target={target.carbsG} color={colors.primary} />
        <MacroMini label="Fat" value={totals?.fatG ?? 0} target={target.fatG} color={colors.warn} />
      </View>
    </AppCard>
  );
}

function MacroMini({ label, value, target, color }: { label: string; value: number; target?: number | null; color: string }) {
  return (
    <View style={styles.macroMini}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroText}>{macroLine(value, target)}</Text>
      <ProgressBar value={progress(value, target)} color={color} height={6} />
    </View>
  );
}

function WorkoutsView({ data }: { data: AthleteDashboardData }) {
  const [segment, setSegment] = useState<WorkoutSegment>("today");
  const workout = data.workouts[0] ?? null;
  const coachName = data.coaches[0]?.name ?? data.coachProfile?.name ?? "Alex";

  return (
    <>
      <WorkoutAppBar onCalendarPress={() => setSegment("upcoming")} />
      <WorkoutSegmentedControl value={segment} onChange={setSegment} />
      {segment === "today" ? (
        <>
          {workout ? <WorkoutHero workout={workout} detail={data.workoutDetail} coachName={coachName} /> : <EmptyState title="No workout today" body="Your coach has not scheduled a workout for today." icon="barbell-outline" />}
          {data.workoutDetail ? <ExercisePreview detail={data.workoutDetail} /> : null}
          {workout ? <QuickWorkoutCard workout={workout} detail={data.workoutDetail} /> : null}
          <WorkoutScheduleCard title="Upcoming" workouts={data.upcomingWorkouts} />
          <RecentWorkoutCard workouts={data.recentWorkouts} onViewHistory={() => setSegment("history")} />
        </>
      ) : null}
      {segment === "upcoming" ? (
        <AppCard>
          {data.upcomingWorkouts.length ? (
            data.upcomingWorkouts.map((item, index) => {
              const visual = workoutVisual(item.name);
              return (
                <View key={item.id}>
                  <RowLink icon={visual.icon} tone={visual.tone} title={shortDate(item.scheduledDate)} subtitle={item.name} value={`${item.exerciseCount} exercises`} />
                  {index < data.upcomingWorkouts.length - 1 ? <Divider /> : null}
                </View>
              );
            })
          ) : (
            <EmptyState title="No upcoming workouts" body="Future assignments will show here." icon="calendar-outline" />
          )}
        </AppCard>
      ) : null}
      {segment === "history" ? (
        <AppCard>
          {data.recentWorkouts.length ? (
            data.recentWorkouts.slice(0, 8).reverse().map((item, index) => {
              const visual = workoutVisual(item.name);
              return (
                <View key={item.id}>
                  <RowLink icon={visual.icon} tone={visual.tone} title={item.name} subtitle={shortDate(item.scheduledDate)} value={titleCase(item.status)} />
                  {index < Math.min(data.recentWorkouts.length, 8) - 1 ? <Divider /> : null}
                </View>
              );
            })
          ) : (
            <EmptyState title="No workout history yet" body="Complete a few workouts to build your history." icon="time-outline" />
          )}
        </AppCard>
      ) : null}
    </>
  );
}

function WorkoutSegmentedControl({ value, onChange }: { value: WorkoutSegment; onChange: (value: WorkoutSegment) => void }) {
  const options: { value: WorkoutSegment; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "upcoming", label: "Upcoming" },
    { value: "history", label: "History" },
  ];
  return (
    <View style={styles.workoutSegmented}>
      {options.map((option, index) => {
        const active = value === option.value;
        return (
          <Fragment key={option.value}>
            <Pressable
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.workoutSegment,
                active ? styles.workoutSegmentActive : null,
                pressed ? { opacity: 0.78 } : null,
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.workoutSegmentText, active ? styles.workoutSegmentTextActive : null]}>{option.label}</Text>
            </Pressable>
            {index === 1 ? <View style={styles.workoutSegmentDivider} /> : null}
          </Fragment>
        );
      })}
    </View>
  );
}

function WorkoutAppBar({ onCalendarPress }: { onCalendarPress: () => void }) {
  return (
    <View style={styles.workoutAppBar}>
      <Text style={styles.workoutScreenTitle}>Workouts</Text>
      <Pressable onPress={onCalendarPress} style={({ pressed }) => [styles.workoutCalendarButton, pressed ? { opacity: 0.72 } : null]}>
        <Ionicons name="calendar-outline" size={22} color={colors.ink} />
      </Pressable>
    </View>
  );
}

function WorkoutHero({
  workout,
  detail,
  coachName,
}: {
  workout: WorkoutAssignmentSummary;
  detail: WorkoutAssignmentDetail | null;
  coachName: string;
}) {
  const router = useRouter();
  const videoCount = detail?.exercises.filter((exercise) => exercise.mediaId).length ?? 0;
  const progressPercent = Math.max(0, Math.min(100, Math.round(workout.progressPercent / 5) * 5));
  const exerciseCount = workout.exerciseCount;
  const visual = workoutVisual(workout.name);
  const heroImage = workoutImageSource(visual.asset);
  return (
    <AppCard style={styles.workoutHeroCard}>
      <Text style={styles.workoutTodayChip}>TODAY</Text>
      <View style={styles.workoutHeroTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroWorkoutTitle}>{workout.name}</Text>
          <Text style={styles.workoutHeroMeta}>{exerciseCount} exercises  -  {estimatedWorkoutDuration(exerciseCount)}</Text>
          <Text style={styles.workoutHeroCoach}>Coach {firstName(coachName, "Alex")}</Text>
        </View>
        <View style={styles.workoutBodyIcon}>
          {heroImage ? (
            <Image source={heroImage} style={styles.workoutTorsoImage} resizeMode="contain" />
          ) : (
            <Ionicons name={visual.icon} size={62} color={visual.color} />
          )}
        </View>
      </View>
      <View style={styles.progressLineRow}>
        <ProgressBar value={progressPercent / 100} height={6} style={styles.progressLineBar} />
        <Text style={styles.progressPercent}>{progressPercent}%</Text>
      </View>
      <View style={styles.videoMetaRow}>
        <View style={styles.videoMetaIcon}>
          <Ionicons name="play" size={12} color={colors.inkMuted} />
        </View>
        <Text style={styles.workoutVideoMeta}>{videoCount} exercise video{videoCount === 1 ? "" : "s"}</Text>
      </View>
      <ActionButton
        label={workout.status === "completed" ? "View Workout" : "Continue Workout"}
        variant="filled"
        style={styles.workoutHeroButton}
        textStyle={styles.workoutHeroButtonText}
        onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never)}
      />
    </AppCard>
  );
}

function ExercisePreview({ detail }: { detail: WorkoutAssignmentDetail }) {
  const router = useRouter();
  const progressByIndex = new Map(detail.progress.map((item) => [item.exerciseIndex, item]));
  return (
    <AppCard style={styles.workoutExerciseCard}>
      <Text style={styles.workoutCardTitle}>Exercise Preview</Text>
      {detail.exercises.slice(0, 3).map((exercise, index) => {
        const status = progressByIndex.get(index)?.status ?? "not_started";
        const setsDone = progressByIndex.get(index)?.setsCompleted.length ?? 0;
        const hasSets = Boolean(exercise.sets);
        const visual = exerciseVisual(exercise.title, exercise.type);
        return (
          <View key={`${exercise.title}-${index}`}>
            <WorkoutExerciseRow
              visual={visual}
              title={exercise.title}
              subtitle={exercise.sets && exercise.reps ? `${exercise.sets} x ${exercise.reps}` : [exercise.sets ? `${exercise.sets} sets` : null, exercise.durationSec ? `${exercise.durationSec}s` : null].filter(Boolean).join(" - ")}
              status={status}
              value={status !== "completed" && status !== "not_started" && hasSets ? `${setsDone} / ${exercise.sets} sets` : undefined}
              showVideo={status !== "completed" && Boolean(exercise.mediaId)}
              onPress={status !== "completed" ? () => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: detail.id } } as never) : undefined}
            />
            {index < Math.min(detail.exercises.length, 3) - 1 ? <Divider /> : null}
          </View>
        );
      })}
    </AppCard>
  );
}

function WorkoutExerciseRow({
  visual,
  title,
  subtitle,
  status,
  value,
  showVideo,
  onPress,
}: {
  visual: FitoraVisual;
  title: string;
  subtitle: string;
  status?: string;
  value?: string;
  showVideo?: boolean;
  onPress?: () => void;
}) {
  const completed = status === "completed";
  const notStarted = status === "not_started";
  const imageSource = workoutImageSource(visual.asset);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.workoutExerciseRow, pressed ? { opacity: 0.78 } : null]}
    >
      <View style={[styles.workoutExerciseIcon, imageSource ? styles.workoutExerciseImageShell : null]}>
        {imageSource ? (
          <Image source={imageSource} style={styles.workoutExerciseIconImage} resizeMode="contain" />
        ) : (
          <Ionicons name={visual.icon} size={26} color={visual.color} />
        )}
      </View>
      <View style={styles.workoutExerciseCopy}>
        <Text style={styles.workoutExerciseTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.workoutExerciseSubtitle}>{subtitle}</Text>
      </View>
      {showVideo ? (
        <View style={styles.workoutSmallVideo}>
          <Ionicons name="play" size={12} color={colors.inkMuted} />
        </View>
      ) : null}
      <View style={styles.workoutExerciseRight}>
        {completed ? <WorkoutStatusPill label="Completed" tone="success" icon="checkmark-circle-outline" /> : null}
        {!completed && value ? <Text style={styles.workoutSetValue}>{value}</Text> : null}
        {notStarted ? <WorkoutStatusPill label="Not Started" tone="neutral" /> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={24} color={colors.ink} /> : null}
    </Pressable>
  );
}

function WorkoutStatusPill({ label, tone, icon }: { label: string; tone: "success" | "neutral"; icon?: keyof typeof Ionicons.glyphMap }) {
  const success = tone === "success";
  return (
    <View style={[styles.workoutStatusPill, success ? styles.workoutStatusPillSuccess : styles.workoutStatusPillNeutral]}>
      {icon ? <Ionicons name={icon} size={12} color={success ? colors.ok : colors.inkMuted} /> : null}
      <Text style={[styles.workoutStatusPillText, success ? styles.workoutStatusPillTextSuccess : null]}>{label}</Text>
    </View>
  );
}

function QuickWorkoutCard({ workout, detail }: { workout: WorkoutAssignmentSummary; detail: WorkoutAssignmentDetail | null }) {
  const router = useRouter();
  const progressByIndex = new Map((detail?.progress ?? []).map((item) => [item.exerciseIndex, item]));
  const tasks = (detail?.exercises ?? []).map((exercise, index) => ({
    label: exercise.title,
    done: progressByIndex.get(index)?.status === "completed",
  }));
  const doneCount = tasks.length ? tasks.filter((task) => task.done).length : workout.completedCount;
  const total = tasks.length || workout.exerciseCount;
  const goToWorkout = () => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never);
  return (
    <AppCard style={styles.quickWorkoutCard}>
      <View style={styles.sectionInline}>
        <View>
          <Text style={styles.workoutCardTitle}>Quick Workout</Text>
          <Text style={styles.quickWorkoutSubtitle}>{workout.name}</Text>
        </View>
        <Text style={styles.quickWorkoutCount}><Text style={{ color: colors.primary }}>{doneCount}</Text> / {total} complete</Text>
      </View>
      {tasks.length ? (
        <View style={styles.quickTaskGrid}>
          {tasks.map((task, index) => (
            <Pressable key={`${task.label}-${index}`} style={styles.quickTask} onPress={goToWorkout}>
              <Ionicons
                name={task.done ? "checkmark-circle" : "ellipse-outline"}
                size={16}
                color={task.done ? colors.ok : colors.inkMuted}
              />
              <Text style={styles.quickTaskText}>{task.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ActionButton
        label="Continue"
        style={styles.quickWorkoutButton}
        textStyle={styles.quickWorkoutButtonText}
        onPress={goToWorkout}
      />
    </AppCard>
  );
}

function WorkoutScheduleCard({ title, workouts }: { title: string; workouts: WorkoutAssignmentSummary[] }) {
  const router = useRouter();
  if (!workouts.length) return null;
  const rows = workouts.slice(0, 3).map((item) => ({
    id: item.id,
    day: shortDate(item.scheduledDate),
    name: item.name,
    duration: workoutListDuration(item),
    assignmentId: item.id,
  }));
  return (
    <AppCard style={styles.workoutListCard}>
      <Text style={styles.workoutCardTitle}>{title}</Text>
      {rows.map((item, index) => (
        <View key={item.id}>
          <WorkoutScheduleRow
            day={item.day}
            name={item.name}
            duration={item.duration}
            visual={workoutVisual(item.name)}
            onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: item.assignmentId } } as never)}
          />
          {index < rows.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </AppCard>
  );
}

function WorkoutScheduleRow({ day, name, duration, visual, onPress }: { day: string; name: string; duration: string; visual: FitoraVisual; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.workoutScheduleRow, pressed ? { opacity: 0.78 } : null]}>
      <Ionicons name={visual.icon} size={17} color={visual.color} style={styles.workoutCalendarIcon} />
      <Text style={styles.workoutScheduleDay} numberOfLines={1}>{day}</Text>
      <Text style={styles.workoutScheduleName} numberOfLines={1}>{name}</Text>
      <Text style={styles.workoutScheduleDuration} numberOfLines={1}>{duration}</Text>
      <Ionicons name="chevron-forward" size={24} color={colors.ink} />
    </Pressable>
  );
}

function RecentWorkoutCard({ workouts, onViewHistory }: { workouts: WorkoutAssignmentSummary[]; onViewHistory: () => void }) {
  const router = useRouter();
  const recent = workouts.slice(0, 2);
  if (!recent.length) return null;
  return (
    <AppCard style={styles.workoutListCard}>
      <Text style={styles.workoutCardTitle}>Recent</Text>
      {recent.map((item, index) => (
        <View key={item.id}>
          <RecentWorkoutRow
            title={item.name}
            status={item.status}
            onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: item.id } } as never)}
          />
          {index < recent.length - 1 ? <Divider /> : null}
        </View>
      ))}
      <Pressable onPress={onViewHistory} hitSlop={8}>
        <Text style={[styles.linkText, styles.trailingLink]}>View History</Text>
      </Pressable>
    </AppCard>
  );
}

function RecentWorkoutRow({ title, status, rpe, onPress }: { title: string; status: string; rpe?: string; onPress: () => void }) {
  const visual = workoutVisual(title);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.recentWorkoutRow, pressed ? { opacity: 0.78 } : null]}>
      <View style={styles.recentWorkoutIcon}>
        <Ionicons name={visual.icon} size={20} color={visual.color} />
      </View>
      <Text style={styles.recentWorkoutTitle} numberOfLines={1}>{title}</Text>
      <WorkoutStatusPill label={titleCase(status)} tone={status === "completed" ? "success" : "neutral"} icon={status === "completed" ? "checkmark-circle-outline" : undefined} />
      {rpe ? <Text style={styles.recentWorkoutRpe}>{rpe}</Text> : null}
      <Ionicons name="chevron-forward" size={24} color={colors.ink} />
    </Pressable>
  );
}

function NutritionView({
  data,
  onLogWater,
  loggingWater,
  onReload,
}: {
  data: AthleteDashboardData;
  onLogWater: () => void;
  loggingWater: boolean;
  onReload: () => void;
}) {
  const router = useRouter();
  const [expandedPlan, setExpandedPlan] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [nutritionMessage, setNutritionMessage] = useState<string | null>(null);
  const [sendingRequest, setSendingRequest] = useState(false);
  const [savingPlannedMealId, setSavingPlannedMealId] = useState<string | null>(null);
  const target = data.target;
  const consumed = consumedCalories(data);
  const remaining = target ? Math.max(0, target.calories - consumed) : null;
  const coachName = data.coaches[0]?.name ?? data.coachProfile?.name ?? "Arjun";
  const coachId = data.coaches[0]?.coachId ?? data.subscription?.coachId ?? data.coachProfile?.coachId ?? null;
  const plannedCalories = data.plannedMeals.reduce((sum, meal) => sum + mealCalories(meal), 0);
  const plannedMealRows = orderedMealPlanRows(data.plannedMeals);
  const goalLabel = fitnessGoalLabel(target?.fitnessGoal || data.profile?.fitnessGoal) || "Weight Loss";

  async function logPlannedMeal(meal: PlannedMeal) {
    if (savingPlannedMealId) return;
    setNutritionMessage(null);
    setSavingPlannedMealId(meal.id);
    try {
      const res = await apiFetch("/api/athlete/nutrition/meals", {
        method: "POST",
        body: JSON.stringify({
          date: data.date,
          mealType: meal.mealType,
          source: "confirmed_from_plan",
          name: mealName(meal),
          plannedMealId: meal.id,
          foods: meal.foods.map((food) => ({
            name: food.name,
            quantity: food.quantity ?? 1,
            unit: food.unit ?? "serving",
            calories: food.calories,
            proteinG: food.proteinG,
            carbsG: food.carbsG,
            fatG: food.fatG,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNutritionMessage(body.error ?? "Could not log this planned meal.");
        return;
      }
      setNutritionMessage(`${titleCase(meal.mealType)} logged.`);
      onReload();
    } catch {
      setNutritionMessage("Network failed while logging this meal.");
    } finally {
      setSavingPlannedMealId(null);
    }
  }

  async function sendMealPlanRequest() {
    const body = requestText.trim();
    if (!body) {
      setNutritionMessage("Write what you want changed before sending.");
      return;
    }
    if (!coachId) {
      setNutritionMessage("No assigned coach is available for meal-plan requests.");
      return;
    }
    setSendingRequest(true);
    setNutritionMessage(null);
    try {
      const res = await apiFetch(`/api/athlete/messages/${coachId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNutritionMessage(payload.error === "message_too_long" ? "Message is too long." : "Could not send this request.");
        return;
      }
      setNutritionMessage("Request sent to your coach.");
      setRequestText("");
      setRequestOpen(false);
    } catch {
      setNutritionMessage("Network failed while sending your request.");
    } finally {
      setSendingRequest(false);
    }
  }

  return (
    <>
      <PrimaryAppBar title="Nutrition" subtitle={shortDate(data.date)} showNotifications={false} rightIcon="calendar-outline" />
      {target ? (
        <AppCard style={styles.nutritionTargetCard}>
          <View style={styles.nutritionTargetRow}>
            <ProgressRing value={progress(consumed, target.calories)} label={consumed.toLocaleString()} sublabel={`/ ${target.calories.toLocaleString()} kcal`} size={86} />
            <View style={styles.nutritionTargetCopy}>
              <Text style={styles.targetRemaining}>{remaining?.toLocaleString()} kcal remaining</Text>
              <View style={styles.nutritionGoalBadge}>
                <Text style={styles.nutritionGoalDisplayText}>{goalLabel} - {titleCase(target.goalIntensity) || "Moderate"}</Text>
                <Text style={styles.nutritionGoalText}>{titleCase(target.fitnessGoal) || "Goal"}  -  {titleCase(target.goalIntensity) || "Target"}</Text>
              </View>
            </View>
          </View>
        </AppCard>
      ) : (
        <EmptyState title="No nutrition target" body="Add profile details to calculate calories and macros." icon="calculator-outline" />
      )}

      {target ? (
        <AppCard style={styles.macroCard}>
          <MacroRow icon="fitness-outline" label="Protein" value={data.mealTotals?.proteinG ?? 0} target={target.proteinG} color={colors.ok} />
          <MacroRow icon="leaf-outline" label="Carbs" value={data.mealTotals?.carbsG ?? 0} target={target.carbsG} color={colors.primary} />
          <MacroRow icon="flame-outline" label="Fat" value={data.mealTotals?.fatG ?? 0} target={target.fatG} color={colors.warn} />
        </AppCard>
      ) : null}

      <View style={styles.nutritionActionRow}>
        <ActionButton label="Add Meal" icon="add-outline" style={styles.nutritionActionButton} onPress={() => router.push("/athlete/log-meal" as never)} />
        <ActionButton label="Scan Meal" icon="camera-outline" style={styles.nutritionActionButton} onPress={() => router.push("/athlete/meal-scan" as never)} />
      </View>

      {data.plannedMeals.length ? (
        <AppCard style={styles.coachMealCard}>
          <View style={styles.sectionInline}>
            <View style={styles.rowIconTitle}>
              <IconTile icon="clipboard-outline" size={31} />
              <View>
                <Text style={styles.nutritionCardTitle}>Coach Meal Plan</Text>
                <Text style={styles.muted}>Coach {firstName(coachName, "Coach")}  -  {shortDate(data.date)}</Text>
              </View>
            </View>
            <StatusChip label="ACTIVE PLAN" tone="success" />
          </View>
          <View style={styles.mealPlanInnerList}>
            {plannedMealRows.slice(0, 4).map((meal, index) => (
              <View key={meal.id}>
                <MealPlanRow meal={meal} />
                {index < Math.min(plannedMealRows.length, 4) - 1 ? <Divider /> : null}
              </View>
            ))}
            {expandedPlan && plannedMealRows.slice(4).map((meal) => (
              <Fragment key={meal.id}>
                <Divider />
                <MealPlanRow meal={meal} />
              </Fragment>
            ))}
            <View style={styles.mealPlanActions}>
              <Pressable style={styles.mealPlanAction} onPress={() => setExpandedPlan((value) => !value)}>
                <Text style={styles.mealPlanActionText}>{expandedPlan ? "Hide Plan" : "View Full Plan"}</Text>
                <Ionicons name="chevron-forward" size={17} color={colors.primary} />
              </Pressable>
              <Divider vertical />
              <Pressable style={styles.mealPlanAction} onPress={() => setRequestOpen((value) => !value)}>
                <Ionicons name="create-outline" size={17} color={colors.primary} />
                <Text style={styles.mealPlanActionText}>Request Change</Text>
              </Pressable>
            </View>
            {requestOpen ? (
              <View style={styles.inlineActionPanel}>
                <TextInput
                  value={requestText}
                  onChangeText={setRequestText}
                  placeholder="Tell your coach what you want changed"
                  placeholderTextColor={colors.inkFaint}
                  style={styles.inlineTextInput}
                  multiline
                />
                <ActionButton
                  label={sendingRequest ? "Sending..." : "Send Request"}
                  icon="send-outline"
                  variant="filled"
                  onPress={sendMealPlanRequest}
                  disabled={sendingRequest}
                />
              </View>
            ) : null}
          </View>
        </AppCard>
      ) : null}

      {nutritionMessage ? <Text style={nutritionMessage.includes("sent") || nutritionMessage.includes("logged") ? styles.successText : styles.errorText}>{nutritionMessage}</Text> : null}

      <AppCard style={styles.consumedCard}>
        <View style={styles.consumedHeader}>
          <IconTile icon="restaurant-outline" size={31} tone="success" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.nutritionCardTitle}>Consumed Today</Text>
            {data.meals.length || data.plannedMeals.length ? (
              <MealStatusList
                meals={data.meals}
                plannedMeals={data.plannedMeals}
                savingPlannedMealId={savingPlannedMealId}
                onLogPlanned={logPlannedMeal}
                onAddMeal={() => router.push("/athlete/log-meal" as never)}
              />
            ) : (
              <Text style={styles.muted}>Log meals to see consumed nutrition here.</Text>
            )}
          </View>
        </View>
      </AppCard>

      <AppCard style={styles.nutritionMiniCard}>
        <View style={styles.waterRow}>
          <IconTile icon="water-outline" size={26} />
          <View style={styles.waterCopy}>
            <Text style={styles.nutritionCardTitle}>Water</Text>
            <Text style={styles.bigInline}>{((data.water?.totalMl ?? 0) / 1000).toFixed(1)} / {((data.water?.goalMl ?? 0) / 1000).toFixed(1)} L</Text>
            <ProgressBar value={progress(data.water?.totalMl ?? 0, data.water?.goalMl)} style={styles.waterProgress} />
          </View>
          <ActionButton label={loggingWater ? "Logging..." : "+ 250 ml"} style={styles.waterButton} onPress={() => onLogWater()} />
        </View>
      </AppCard>

      {data.plannedMeals.length ? (
        <AppCard style={styles.nutritionMiniCard}>
          <View style={styles.routineRow}>
            <IconTile icon="calendar-outline" size={26} tone="primary" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.nutritionCardTitle}>Coach Plan</Text>
              <Text style={styles.muted}>{shortDate(data.date)}  -  {data.plannedMeals.length} planned meal{data.plannedMeals.length === 1 ? "" : "s"}</Text>
              <Text style={styles.routineDetail}>{plannedCalories > 0 ? `${plannedCalories.toLocaleString()} kcal planned` : "Calories pending"}</Text>
            </View>
            <View style={styles.routineAction}>
              <Pressable onPress={() => setExpandedPlan((value) => !value)} style={styles.routinePressable}>
                <Text style={styles.linkText}>View Plan</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        </AppCard>
      ) : null}
    </>
  );
}

function MacroRow({ icon, label, value, target, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number; target?: number | null; color: string }) {
  return (
    <View style={styles.macroRow}>
      <Ionicons name={icon} size={20} color={color} style={styles.macroBareIcon} />
      <Text style={styles.nutritionMacroLabel}>{label}</Text>
      <Text style={styles.nutritionMacroValue}>{macroLine(value, target)}</Text>
      <View style={styles.nutritionMacroProgress}>
        <ProgressBar value={progress(value, target)} color={color} />
      </View>
    </View>
  );
}

function MealPlanRow({ meal }: { meal: PlannedMeal }) {
  const visual = mealVisual(meal.mealType);
  return (
    <View style={styles.mealRow}>
      <View style={[styles.mealIconBubble, { backgroundColor: `${visual.color}14` }]}>
        <Ionicons name={visual.icon} size={15} color={visual.color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.nutritionMealTitle}>{titleCase(meal.mealType)}</Text>
        <Text style={styles.nutritionMealMuted} numberOfLines={1}>{mealName(meal)}</Text>
      </View>
      <Text style={styles.nutritionMealValue}>{mealCalories(meal)} kcal</Text>
    </View>
  );
}

function MealStatusList({
  meals,
  plannedMeals,
  savingPlannedMealId,
  onLogPlanned,
  onAddMeal,
}: {
  meals: Meal[];
  plannedMeals: PlannedMeal[];
  savingPlannedMealId?: string | null;
  onLogPlanned: (meal: PlannedMeal) => void;
  onAddMeal: () => void;
}) {
  const mealTypes = ["breakfast", "lunch", "snack"];
  return (
    <View style={styles.consumedList}>
      {mealTypes.map((type) => {
        const consumed = meals.find((meal) => meal.mealType === type);
        const planned = type === "snack" ? undefined : plannedMeals.find((meal) => meal.mealType === type);
        const source = consumed ?? planned;
        const dotColor = consumed ? colors.ok : planned ? colors.primary : "#a8b0bd";
        const saving = planned?.id === savingPlannedMealId;
        return (
          <View key={type} style={styles.consumedMealRow}>
            <View style={[styles.mealDot, { backgroundColor: dotColor }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.nutritionMealTitle}>{titleCase(type)}</Text>
              <Text style={styles.nutritionMealMuted} numberOfLines={1}>{source ? mealName(source) : "Not logged"}</Text>
            </View>
            {consumed ? (
              <>
                <Text style={styles.nutritionMealValue}>{mealCalories(consumed)} kcal</Text>
                <StatusChip label="CONSUMED" tone="success" />
              </>
            ) : planned ? (
              <View style={styles.plannedActionGroup}>
                <StatusChip label="PLANNED" tone="primary" />
                <Pressable onPress={() => onLogPlanned(planned)} disabled={saving} hitSlop={8}>
                  <Text style={[styles.linkText, saving ? styles.disabledLinkText : null]}>{saving ? "Logging..." : "Log as Eaten"}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={onAddMeal} hitSlop={8}>
                <Text style={styles.linkText}>+ Add</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function CoachView({ data }: { data: AthleteDashboardData }) {
  const router = useRouter();
  const coachName = data.coachProfile?.name || data.coaches[0]?.name || "";
  const coachId = data.coaches[0]?.coachId ?? data.subscription?.coachId ?? data.coachProfile?.coachId ?? null;
  const subscription = data.subscription;
  const nextSession = nextFutureSession(data.sessions);
  const workoutPlanVisual = planVisual("workout plan");
  const mealPlanVisual = planVisual("meal plan");
  const [panel, setPanel] = useState<"message" | "profile" | "membership" | "sessions" | "videos" | "reviews" | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [coachActionMessage, setCoachActionMessage] = useState<string | null>(null);
  const [reviews, setReviews] = useState<CoachReview[] | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    if (panel !== "reviews" || !coachId || reviews !== null) return;
    setReviewsLoading(true);
    apiJson<{ reviews: CoachReview[] }>(`/api/marketplace/coaches/${coachId}/reviews`)
      .then((result) => setReviews(result.reviews ?? []))
      .catch(() => setReviews([]))
      .finally(() => setReviewsLoading(false));
  }, [panel, coachId, reviews]);

  async function sendCoachMessage() {
    const body = messageDraft.trim();
    if (!body) {
      setCoachActionMessage("Write a message before sending.");
      return;
    }
    if (!coachId) {
      setCoachActionMessage("No assigned coach is available.");
      return;
    }
    setSendingMessage(true);
    setCoachActionMessage(null);
    try {
      const res = await apiFetch(`/api/athlete/messages/${coachId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCoachActionMessage(payload.error === "message_too_long" ? "Message is too long." : "Could not send this message.");
        return;
      }
      setCoachActionMessage("Message sent to your coach.");
      setMessageDraft("");
    } catch {
      setCoachActionMessage("Network failed while sending your message.");
    } finally {
      setSendingMessage(false);
    }
  }

  return (
    <>
      <PrimaryAppBar title="My Coach" />
      {!coachName ? (
        <EmptyState
          icon="people-outline"
          title="Find the right coach for your goals"
          body="Personalized training, nutrition and live coaching will appear here once you connect with a coach."
        />
      ) : (
        <>
          <AppCard>
            <View style={styles.coachHeader}>
              <Avatar avatar={data.coachProfile?.avatar} name={coachName} size={78} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.inlineTitleRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>Coach {coachName}</Text>
                  {data.coachProfile?.verifiedStatus === "verified" ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
                </View>
                <Text style={styles.muted}>{data.coachProfile?.coachingTypes?.[0] || "Fitness Coach"}</Text>
                <Text style={styles.ratingText}>{data.coachProfile?.avgRating ? `${data.coachProfile.avgRating.toFixed(1)} rating` : "No rating yet"} - {data.coachProfile?.reviewCount ?? 0} reviews</Text>
                <Text style={styles.muted}>{data.coachProfile?.yearsExperience ? `${data.coachProfile.yearsExperience} years experience` : "Experience not listed"}</Text>
              </View>
            </View>
            <View style={styles.chipWrap}>
              {(data.coachProfile?.specializations ?? []).slice(0, 3).map((item) => (
                <StatusChip key={item} label={titleCase(item)} tone="primary" />
              ))}
            </View>
            <View style={styles.actionRow}>
              <ActionButton label="Message" icon="chatbubble-outline" onPress={() => setPanel(panel === "message" ? null : "message")} />
              <ActionButton label="View Profile" icon="person-outline" variant="filled" onPress={() => setPanel(panel === "profile" ? null : "profile")} />
            </View>
          </AppCard>

          {panel === "message" ? (
            <AppCard style={styles.inlineActionPanel}>
              <Text style={styles.cardTitle}>Message Coach</Text>
              <TextInput
                value={messageDraft}
                onChangeText={setMessageDraft}
                placeholder={`Message ${coachName}`}
                placeholderTextColor={colors.inkFaint}
                style={styles.inlineTextInput}
                multiline
              />
              <ActionButton
                label={sendingMessage ? "Sending..." : "Send Message"}
                icon="send-outline"
                variant="filled"
                onPress={sendCoachMessage}
                disabled={sendingMessage}
              />
            </AppCard>
          ) : null}

          {panel === "profile" ? (
            <AppCard style={styles.inlineActionPanel}>
              <Text style={styles.cardTitle}>Coach Profile</Text>
              <Text style={styles.muted}>{data.coachProfile?.bio || data.coachProfile?.philosophy || "Profile details will appear as your coach updates their public profile."}</Text>
              <View style={styles.chipWrap}>
                {(data.coachProfile?.certifications ?? []).slice(0, 4).map((item) => (
                  <StatusChip key={item} label={titleCase(item)} tone="neutral" />
                ))}
                {(data.coachProfile?.languages ?? []).slice(0, 4).map((item) => (
                  <StatusChip key={item} label={titleCase(item)} tone="primary" />
                ))}
              </View>
            </AppCard>
          ) : null}

          <AppCard>
            <View style={styles.sectionInline}>
              <View style={styles.rowIconTitle}>
                <IconTile icon="ribbon-outline" size={58} />
                <View>
                  <Text style={styles.muted}>Membership</Text>
                  <Text style={styles.cardTitle}>{subscription?.pricingPlanSnapshot?.name ?? "No active plan"}</Text>
                  {subscription?.pricingPlanSnapshot ? (
                    <Text style={styles.bigInline}>{formatCurrency(subscription.pricingPlanSnapshot.monthlyPrice, subscription.pricingPlanSnapshot.currency)} / month</Text>
                  ) : null}
                </View>
              </View>
              {subscription ? <StatusChip label={titleCase(subscription.status)} tone={subscription.status === "active" ? "success" : "warning"} /> : null}
            </View>
            {subscription?.currentPeriodEnd ? <Text style={styles.muted}>Next billing: {shortDate(subscription.currentPeriodEnd.slice(0, 10))}</Text> : null}
            <View style={styles.bulletRow}>
              {subscription?.pricingPlanSnapshot?.includedServices?.slice(0, 3).map((service) => (
                <Text key={service} style={styles.bulletText}>{titleCase(service)}</Text>
              ))}
            </View>
            <ActionButton label="Manage Membership" variant="filled" style={styles.compactButton} onPress={() => setPanel(panel === "membership" ? null : "membership")} />
          </AppCard>

          {panel === "membership" ? (
            <AppCard style={styles.inlineActionPanel}>
              <Text style={styles.cardTitle}>Membership Details</Text>
              <Text style={styles.muted}>Status: {subscription ? titleCase(subscription.status) : "No active subscription"}</Text>
              {subscription?.currentPeriodEnd ? <Text style={styles.muted}>Current period ends {shortDate(subscription.currentPeriodEnd.slice(0, 10))}</Text> : null}
              <ActionButton label="Find / Change Coach" icon="search-outline" onPress={() => router.push("/athlete/coach-discovery" as never)} />
            </AppCard>
          ) : null}

          {nextSession ? <SessionCard session={nextSession} coachName={coachName} /> : null}

          <AppCard>
            <SectionHeader title={`Recommended by ${firstName(coachName, "Coach")}`} action={data.videos.length ? "View All Videos" : undefined} onAction={() => setPanel(panel === "videos" ? null : "videos")} />
            {data.videos.length ? (
              <View style={styles.videoStrip}>
                {data.videos.slice(0, 3).map((video) => (
                  <View key={video.id} style={styles.videoItem}>
                    <VideoThumb duration={formatDuration(video.durationSec)} title={video.title} category={video.category} mini />
                    <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
                    <Text style={styles.videoMetaText}>{titleCase(video.visibility)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.muted}>Coach videos will appear here once shared with you.</Text>
            )}
          </AppCard>

          {panel === "videos" ? (
            <AppCard style={styles.inlineActionPanel}>
              <Text style={styles.cardTitle}>All Coach Videos</Text>
              {data.videos.length ? data.videos.map((video, index) => (
                <Fragment key={video.id}>
                  <RowLink icon="play-circle-outline" title={video.title} subtitle={titleCase(video.category)} value={formatDuration(video.durationSec) ?? undefined} />
                  {index < data.videos.length - 1 ? <Divider /> : null}
                </Fragment>
              )) : <Text style={styles.muted}>No videos are assigned yet.</Text>}
            </AppCard>
          ) : null}

          <AppCard>
            <Text style={styles.cardTitle}>My Coaching Plan</Text>
            <View style={styles.twoColumnRows}>
              <RowLink icon={workoutPlanVisual.icon} tone={workoutPlanVisual.tone} title="Workout Plan" subtitle={`${data.upcomingWorkouts.length + data.workouts.length} workouts scheduled`} onPress={() => router.push({ pathname: "/athlete/dashboard", params: { section: "workouts" } } as never)} />
              <Divider vertical />
              <RowLink icon={mealPlanVisual.icon} tone={mealPlanVisual.tone} title="Meal Plan" subtitle={data.plannedMeals.length ? `${data.plannedMeals.length} meals active` : "No active plan"} onPress={() => router.push({ pathname: "/athlete/dashboard", params: { section: "nutrition" } } as never)} />
            </View>
          </AppCard>

          <AppCard>
            <SettingsRow icon="calendar-outline" label="Sessions" value="Bookings" onPress={() => setPanel(panel === "sessions" ? null : "sessions")} />
            <SettingsRow icon="card-outline" label="Membership & Payments" value="Manage" onPress={() => setPanel(panel === "membership" ? null : "membership")} />
            <SettingsRow icon="play-circle-outline" label="Coach Videos" onPress={() => setPanel(panel === "videos" ? null : "videos")} />
            <SettingsRow icon="star-outline" label="Reviews" onPress={() => setPanel(panel === "reviews" ? null : "reviews")} />
            <SettingsRow icon="person-remove-outline" label="Change Coach" onPress={() => router.push("/athlete/coach-discovery" as never)} />
          </AppCard>

          {panel === "reviews" ? (
            <AppCard style={styles.inlineActionPanel}>
              <Text style={styles.cardTitle}>Reviews</Text>
              {reviewsLoading ? (
                <Text style={styles.muted}>Loading reviews...</Text>
              ) : reviews && reviews.length ? (
                reviews.map((review, index) => (
                  <Fragment key={review.id}>
                    <RowLink
                      icon="star-outline"
                      title={review.athleteName || "Athlete"}
                      subtitle={review.body || "No written feedback"}
                      value={`${review.overallRating.toFixed(1)} / 5`}
                    />
                    {index < reviews.length - 1 ? <Divider /> : null}
                  </Fragment>
                ))
              ) : (
                <Text style={styles.muted}>No reviews yet.</Text>
              )}
            </AppCard>
          ) : null}

          {panel === "sessions" ? (
            <AppCard style={styles.inlineActionPanel}>
              <Text style={styles.cardTitle}>Sessions</Text>
              {data.sessions.length ? data.sessions.map((session, index) => (
                <Fragment key={session.id}>
                  <RowLink icon="calendar-outline" title={titleCase(session.type)} subtitle={sessionClock(session)} value={titleCase(session.status)} />
                  {index < data.sessions.length - 1 ? <Divider /> : null}
                </Fragment>
              )) : <Text style={styles.muted}>No sessions are scheduled yet.</Text>}
            </AppCard>
          ) : null}

          {coachActionMessage ? <Text style={coachActionMessage.includes("sent") ? styles.successText : styles.errorText}>{coachActionMessage}</Text> : null}
        </>
      )}
      {!coachName ? <ActionButton label="Find a Coach" icon="search-outline" variant="filled" onPress={() => router.push("/athlete/coach-discovery" as never)} /> : null}
    </>
  );
}

function ProgressView({ data }: { data: AthleteDashboardData }) {
  const [range, setRange] = useState<"7D" | "4W" | "3M">("4W");
  const [rangeTrends, setRangeTrends] = useState<TrendPoint[] | null>(null);
  const [chartTab, setChartTab] = useState<"readiness" | "load" | "recovery">("readiness");
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    if (range === "4W") {
      setRangeTrends(null);
      return;
    }
    let active = true;
    apiJson<{ series: TrendPoint[] }>(`/api/athlete/trends?days=${rangeToDays(range)}`)
      .then((result) => {
        if (active) setRangeTrends(result.series ?? []);
      })
      .catch(() => {
        if (active) setRangeTrends(null);
      });
    return () => {
      active = false;
    };
  }, [range]);

  const trendsForRange = range === "4W" ? data.trends : rangeTrends ?? data.trends;
  const recent = [...data.recentWorkouts, ...data.workouts].filter((item) => item.scheduledDate >= addDays(todayKey(), -6));
  const completed = recent.filter((item) => item.status === "completed").length;
  const target = data.target;
  const totals = data.mealTotals;
  const currentWeight = data.profile?.weightKg != null ? roundOne(data.profile.weightKg) : null;
  const goalWeight = null;
  const startedWeight = null;
  const weightProgressKg = currentWeight != null && startedWeight != null ? roundOne(Math.max(0, startedWeight - currentWeight)) : null;
  const goalProgress = currentWeight != null && goalWeight != null && startedWeight != null
    ? Math.max(0.08, Math.min(0.92, (startedWeight - currentWeight) / Math.max(1, startedWeight - goalWeight)))
    : null;
  const readinessScore = data.daily?.readinessScore ?? data.daily?.recovery?.score ?? null;
  const workoutDone = completed;
  const workoutTotal = recent.length;
  const nutritionDone = data.nutritionWeek.filter((day) => day.loggedMeals > 0).length;
  const nutritionTotal = 7;
  const checkInDone = data.trends.filter((point) => point.date >= addDays(todayKey(), -6) && point.readiness != null).length;
  const checkInTotal = 7;
  const calorieAdherence = Math.round((progress(totals?.calories ?? 0, target?.calories) ?? 0) * 100);
  const proteinAdherence = Math.round((progress(totals?.proteinG ?? 0, target?.proteinG) ?? 0) * 100);
  const consistentDays = nutritionDone;
  const weightTrend = currentWeight == null ? [] : [currentWeight];
  const readinessTrend = sampleSeries(trendsForRange.map((point) => point.readiness).filter((value): value is number => Number.isFinite(Number(value))));
  const loadTrend = sampleSeries(trendsForRange.map((point) => point.load).filter((value): value is number => Number.isFinite(Number(value))));
  const recoveryTrend = sampleSeries(trendsForRange.map((point) => point.recoveryScore).filter((value): value is number => Number.isFinite(Number(value))));
  const activeChartValues = chartTab === "load" ? loadTrend : chartTab === "recovery" ? recoveryTrend : readinessTrend;
  const recoveryLabel = readinessLabel(readinessScore);
  const coachFeedback = data.coachComments[0]?.body || "No coach feedback yet.";
  const streak = buildCheckInStreak(data.trends);

  return (
    <>
      <PrimaryAppBar title="Progress" showNotifications={false} showAvatar={false} rightIcon="calendar-outline" />
      <ProgressRangeTabs value={range} onChange={setRange} />

      <ProgressGoalCard
        currentWeight={currentWeight}
        goalWeight={goalWeight}
        startedWeight={startedWeight}
        progressKg={weightProgressKg}
        progressValue={goalProgress}
      />

      <ProgressWeekCard
        workoutDone={workoutDone}
        workoutTotal={workoutTotal}
        nutritionDone={nutritionDone}
        nutritionTotal={nutritionTotal}
        checkInDone={checkInDone}
        checkInTotal={checkInTotal}
        recoveryLabel={recoveryLabel}
      />

      <WeightTrendCard values={weightTrend} />

      <ReadinessChartCard
        tab={chartTab}
        onChange={setChartTab}
        score={readinessScore}
        label={recoveryLabel}
        values={activeChartValues}
      />

      <ProgressNutritionCard
        calorieAdherence={calorieAdherence}
        proteinAdherence={proteinAdherence}
        consistentDays={consistentDays}
      />

      <ProgressInsightsCard data={data} recentWorkouts={recent} />
      <ProgressStreakCard current={streak.current} longest={streak.longest} />
      <ProgressFeedbackCard
        body={coachFeedback}
        comments={data.coachComments}
        expanded={showFeedback}
        onPress={() => setShowFeedback((value) => !value)}
      />
    </>
  );
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function buildCheckInStreak(trends: AthleteDashboardData["trends"]) {
  const checkedDates = new Set(trends.filter((point) => point.readiness != null).map((point) => point.date.slice(0, 10)));
  const sorted = Array.from(checkedDates).sort();
  let longest = 0;
  let running = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    running = previous && addDays(previous, 1) === date ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = date;
  }

  let current = 0;
  let cursor = todayKey();
  while (checkedDates.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

function ProgressRangeTabs({ value, onChange }: { value: "7D" | "4W" | "3M"; onChange: (value: "7D" | "4W" | "3M") => void }) {
  return (
    <View style={styles.progressRangeTabs}>
      {(["7D", "4W", "3M"] as const).map((item) => {
        const active = value === item;
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            style={({ pressed }) => [styles.progressRangeTab, pressed ? { opacity: 0.75 } : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.progressRangeText, active ? styles.progressRangeTextActive : null]}>{item}</Text>
            <View style={[styles.progressRangeUnderline, active ? styles.progressRangeUnderlineActive : null]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function ProgressGoalCard({
  currentWeight,
  goalWeight,
  startedWeight,
  progressKg,
  progressValue,
}: {
  currentWeight: number | null;
  goalWeight: number | null;
  startedWeight: number | null;
  progressKg: number | null;
  progressValue: number | null;
}) {
  const pct = progressValue == null ? 0 : Math.round(progressValue * 100);
  return (
    <AppCard style={styles.progressCard}>
      <View style={styles.progressCardHeader}>
        <Text style={styles.progressCardTitle}>Goal Progress</Text>
        <View style={styles.onTrackPill}>
          <Text style={styles.onTrackText}>{progressValue == null ? "Set Goal" : "On Track"}</Text>
        </View>
      </View>
      <View style={styles.progressGoalMetrics}>
        <ProgressGoalMetric label="Current" value={currentWeight == null ? "--" : currentWeight.toFixed(1)} suffix={currentWeight == null ? "" : "kg"} />
        <View style={styles.progressMetricDivider} />
        <ProgressGoalMetric label="Goal" value={goalWeight == null ? "Not set" : goalWeight.toFixed(1)} suffix={goalWeight == null ? "" : "kg"} highlight />
        <View style={styles.progressMetricDivider} />
        <ProgressGoalMetric label="Started" value={startedWeight == null ? "--" : startedWeight.toFixed(1)} suffix={startedWeight == null ? "" : "kg"} />
      </View>
      <View style={styles.goalScaleTrack}>
        <View style={[styles.goalScaleFill, { width: `${pct}%` }]} />
        {progressValue != null ? <View style={[styles.goalScaleThumb, { left: `${pct}%` }]} /> : null}
      </View>
      <View style={styles.goalScaleLabels}>
        <Text style={styles.goalScaleText}>{progressKg == null ? "Weight goal not set" : `${progressKg.toFixed(1)} kg progress`}</Text>
        <Text style={styles.goalScaleText}>{goalWeight == null ? "" : `${goalWeight.toFixed(1)} kg`}</Text>
      </View>
    </AppCard>
  );
}

function ProgressGoalMetric({ label, value, suffix, highlight }: { label: string; value: string; suffix: string; highlight?: boolean }) {
  return (
    <View style={styles.progressGoalMetric}>
      <Text style={styles.progressGoalLabel}>{label}</Text>
      <Text style={[styles.progressGoalValue, highlight ? styles.progressGoalValueActive : null]}>
        {value} <Text style={styles.progressGoalSuffix}>{suffix}</Text>
      </Text>
    </View>
  );
}

function ProgressWeekCard({
  workoutDone,
  workoutTotal,
  nutritionDone,
  nutritionTotal,
  checkInDone,
  checkInTotal,
  recoveryLabel,
}: {
  workoutDone: number;
  workoutTotal: number;
  nutritionDone: number;
  nutritionTotal: number;
  checkInDone: number;
  checkInTotal: number;
  recoveryLabel: string;
}) {
  const workoutPct = workoutTotal ? workoutDone / workoutTotal : 0;
  const nutritionPct = nutritionTotal ? nutritionDone / nutritionTotal : 0;
  const checkInPct = checkInTotal ? checkInDone / checkInTotal : 0;
  return (
    <AppCard style={styles.progressCard}>
      <Text style={styles.progressCardTitle}>This Week</Text>
      <View style={styles.progressWeekGrid}>
        <View style={styles.progressWeekVerticalDivider} />
        <View style={styles.progressWeekHorizontalDivider} />
        <ProgressWeekMetric icon="barbell-outline" title="Workout" value={`${workoutDone} / ${workoutTotal} - ${Math.round(workoutPct * 100)}%`} progress={workoutPct} color={colors.primary} />
        <ProgressWeekMetric icon="nutrition-outline" title="Nutrition" value={`${nutritionDone} / ${nutritionTotal} - ${Math.round(nutritionPct * 100)}%`} progress={nutritionPct} color={colors.ok} tone="success" />
        <ProgressWeekMetric icon="checkbox-outline" title="Check-ins" value={`${checkInDone} / ${checkInTotal} - ${Math.round(checkInPct * 100)}%`} progress={checkInPct} color={colors.primary} />
        <ProgressWeekMetric icon="heart-outline" title="Recovery" value={recoveryLabel} valueColor={colors.ok} tone="success" />
      </View>
    </AppCard>
  );
}

function ProgressWeekMetric({
  icon,
  title,
  value,
  progress,
  color,
  tone = "primary",
  valueColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  progress?: number;
  color?: string;
  tone?: "primary" | "success";
  valueColor?: string;
}) {
  return (
    <View style={styles.progressWeekMetric}>
      <IconTile icon={icon} tone={tone} size={24} />
      <View style={styles.progressWeekCopy}>
        <Text style={styles.progressMetricTitle}>{title}</Text>
        <Text style={[styles.progressMetricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
        {progress != null ? <ProgressTinyBar value={progress} color={color ?? colors.primary} /> : null}
      </View>
    </View>
  );
}

function WeightTrendCard({ values }: { values: number[] }) {
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.max(0, Math.floor((minValue - 2) / 2) * 2) : 0;
  const max = values.length ? Math.ceil((maxValue + 2) / 2) * 2 : 100;
  const mid = values.length ? Math.round((min + max) / 2) : 50;
  return (
    <AppCard style={styles.progressCard}>
      <View style={styles.progressCardHeader}>
        <Text style={styles.progressCardTitle}>Weight Trend</Text>
        <View style={styles.unitPicker}>
          <Text style={styles.unitText}>kg</Text>
          <Ionicons name="chevron-down" size={13} color={colors.ink} />
        </View>
      </View>
      <ProgressLineChart
        values={values}
        yLabels={values.length ? [max, mid, min] : []}
        xLabels={["4 weeks ago", "3 weeks ago", "2 weeks ago", "Last week", "This week"]}
        min={min}
        max={max}
        height={72}
        showEndpoint
        emptyLabel="No weight history yet"
      />
    </AppCard>
  );
}

function ReadinessChartCard({
  tab,
  onChange,
  score,
  label,
  values,
}: {
  tab: "readiness" | "load" | "recovery";
  onChange: (tab: "readiness" | "load" | "recovery") => void;
  score: number | null;
  label: string;
  values: number[];
}) {
  return (
    <AppCard style={styles.progressCard}>
      <View style={styles.progressChartTabs}>
        {[
          { key: "readiness", label: "Readiness" },
          { key: "load", label: "Training Load" },
          { key: "recovery", label: "Recovery" },
        ].map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(item.key as "readiness" | "load" | "recovery")}
              style={styles.progressChartTab}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.progressChartTabText, active ? styles.progressChartTabTextActive : null]}>{item.label}</Text>
              <View style={[styles.progressChartUnderline, active ? styles.progressChartUnderlineActive : null]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.readinessChartBody}>
        <View style={styles.readinessScoreBlock}>
          <Text style={styles.readinessScoreLabel}>Readiness Score</Text>
          <Text style={styles.readinessScoreValue}><Text style={styles.readinessScoreNumber}>{score == null ? "--" : score}</Text>{score == null ? "" : " / 100"}</Text>
          <View style={styles.goodRow}>
            <View style={styles.goodDot} />
            <Text style={styles.goodText}>{label}</Text>
          </View>
        </View>
        <View style={styles.readinessChartPane}>
          <ProgressLineChart
            values={values}
            yLabels={[100, 75, 50, 25, 0]}
            xLabels={["4w ago", "3w ago", "2w ago", "Last week", "This week"]}
            min={0}
            max={100}
            height={62}
            compact
            emptyLabel="No readiness history yet"
          />
        </View>
      </View>
    </AppCard>
  );
}

function ProgressLineChart({
  values,
  yLabels,
  xLabels,
  min,
  max,
  height,
  compact,
  showEndpoint,
  emptyLabel,
}: {
  values: number[];
  yLabels: number[];
  xLabels: string[];
  min: number;
  max: number;
  height: number;
  compact?: boolean;
  showEndpoint?: boolean;
  emptyLabel?: string;
}) {
  const width = compact ? 286 : 332;
  const left = compact ? 34 : 20;
  const right = compact ? 8 : 5;
  const top = compact ? 8 : 10;
  const bottom = compact ? 20 : 24;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  if (!values.length) {
    return (
      <View style={[styles.progressEmptyChart, { height }]}>
        <Text style={styles.progressEmptyChartText}>{emptyLabel ?? "Not enough data yet"}</Text>
      </View>
    );
  }
  const points = values.map((value, index) => {
    const x = values.length === 1 ? left + chartWidth : left + (index / Math.max(1, values.length - 1)) * chartWidth;
    const y = top + (1 - (Math.max(min, Math.min(max, value)) - min) / Math.max(1, max - min)) * chartHeight;
    return { x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? left} ${top + chartHeight} L ${points[0]?.x ?? left} ${top + chartHeight} Z`;

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <SvgLinearGradient id={compact ? "readinessFill" : "weightFill"} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.primary} stopOpacity="0.14" />
          <Stop offset="1" stopColor={colors.primary} stopOpacity="0.02" />
        </SvgLinearGradient>
      </Defs>
      {yLabels.map((label) => {
        const y = top + (1 - (label - min) / Math.max(1, max - min)) * chartHeight;
        return (
          <Fragment key={`y-${label}`}>
            <SvgText x={compact ? 0 : 0} y={y + 4} fontSize={compact ? 8 : 9} fill={colors.inkMuted}>{label}</SvgText>
            <Line x1={left} y1={y} x2={left + chartWidth} y2={y} stroke="#d9dee8" strokeWidth="1" strokeDasharray="2 3" />
          </Fragment>
        );
      })}
      <Path d={areaPath} fill={`url(#${compact ? "readinessFill" : "weightFill"})`} />
      <Path d={linePath} stroke={colors.primary} strokeWidth={compact ? 2 : 2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => (
        <Circle key={`point-${index}`} cx={point.x} cy={point.y} r={showEndpoint && index === points.length - 1 ? 7 : 3.6} fill="#ffffff" stroke={colors.primary} strokeWidth={showEndpoint && index === points.length - 1 ? 3.3 : 2.3} />
      ))}
      <Line x1={left} y1={top + chartHeight} x2={left + chartWidth} y2={top + chartHeight} stroke="#cbd5e1" strokeWidth="1" />
      {xLabels.map((label, index) => {
        const x = left + (index / Math.max(1, xLabels.length - 1)) * chartWidth;
        return (
          <SvgText key={label} x={x} y={height - 4} fontSize={compact ? 7.2 : 8.5} fill={colors.inkMuted} textAnchor={index === 0 ? "start" : index === xLabels.length - 1 ? "end" : "middle"}>
            {label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

function ProgressNutritionCard({
  calorieAdherence,
  proteinAdherence,
  consistentDays,
}: {
  calorieAdherence: number;
  proteinAdherence: number;
  consistentDays: number;
}) {
  return (
    <AppCard style={styles.progressCard}>
      <Text style={styles.progressCardTitle}>Nutrition Adherence</Text>
      <View style={styles.nutritionAdherenceRow}>
        <ProgressNutritionMetric icon="water-outline" label="Calorie adherence" value={`${calorieAdherence} %`} progress={calorieAdherence / 100} color={colors.primary} />
        <View style={styles.progressMetricDivider} />
        <ProgressNutritionMetric icon="fitness-outline" label="Protein target" value={`${proteinAdherence} %`} progress={proteinAdherence / 100} color={colors.ok} tone="success" />
        <View style={styles.progressMetricDivider} />
        <ProgressNutritionMetric icon="calendar-outline" label="Consistent days" value={`${consistentDays} / 7`} progress={consistentDays / 7} color={colors.primary} />
      </View>
    </AppCard>
  );
}

function ProgressNutritionMetric({
  icon,
  label,
  value,
  progress,
  color,
  tone = "primary",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  progress: number;
  color: string;
  tone?: "primary" | "success";
}) {
  return (
    <View style={styles.nutritionAdherenceMetric}>
      <IconTile icon={icon} tone={tone} size={24} />
      <View style={styles.nutritionAdherenceCopy}>
        <Text style={styles.nutritionAdherenceLabel}>{label}</Text>
        <Text style={styles.nutritionAdherenceValue}>{value}</Text>
        <ProgressTinyBar value={progress} color={color} />
      </View>
    </View>
  );
}

function ProgressInsightsCard({ data, recentWorkouts }: { data: AthleteDashboardData; recentWorkouts: WorkoutAssignmentSummary[] }) {
  const insights = (() => {
    const rows: { direction: "up" | "down"; text: ReactNode }[] = [];
    const readiness = data.trends.map((point) => point.readiness).filter((value): value is number => Number.isFinite(Number(value)));
    if (readiness.length >= 2) {
      const delta = Math.round(readiness[readiness.length - 1] - readiness[0]);
      if (delta !== 0) {
        const positive = delta > 0;
        rows.push({
          direction: positive ? "up" : "down",
          text: <Text>Readiness {positive ? "improved" : "changed"} <Text style={positive ? styles.greenText : styles.orangeText}>{Math.abs(delta)} pts</Text></Text>,
        });
      }
    }
    if (recentWorkouts.length) {
      const completed = recentWorkouts.filter((item) => item.status === "completed").length;
      const pct = Math.round((completed / recentWorkouts.length) * 100);
      rows.push({
        direction: pct >= 70 ? "up" : "down",
        text: <Text>Workout completion <Text style={pct >= 70 ? styles.greenText : styles.orangeText}>{pct}%</Text></Text>,
      });
    }
    if (data.target?.proteinG) {
      const pct = Math.round(((data.mealTotals?.proteinG ?? 0) / data.target.proteinG) * 100);
      rows.push({
        direction: pct >= 80 ? "up" : "down",
        text: <Text>Protein target at <Text style={pct >= 80 ? styles.greenText : styles.orangeText}>{Math.min(100, pct)}%</Text></Text>,
      });
    }
    return rows.slice(0, 3);
  })();

  return (
    <AppCard style={styles.progressCard}>
      <Text style={styles.progressCardTitle}>Your Progress</Text>
      {insights.length ? insights.map((insight, index) => (
        <Fragment key={index}>
          <ProgressInsightRow direction={insight.direction} text={insight.text} />
          {index < insights.length - 1 ? <Divider /> : null}
        </Fragment>
      )) : <Text style={styles.progressEmptyText}>Complete workouts, check-ins and meals to unlock progress insights.</Text>}
    </AppCard>
  );
}

function ProgressInsightRow({ direction, text }: { direction: "up" | "down"; text: ReactNode }) {
  const positive = direction === "up";
  return (
    <View style={styles.progressInsightRow}>
      <View style={[styles.progressInsightIcon, positive ? styles.progressInsightIconUp : styles.progressInsightIconDown]}>
        <Ionicons name={positive ? "arrow-up-outline" : "arrow-down-outline"} size={15} color={positive ? colors.ok : "#f97316"} />
      </View>
      <Text style={styles.progressInsightText}>{text}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.ink} />
    </View>
  );
}

function ProgressStreakCard({ current, longest }: { current: number; longest: number }) {
  return (
    <AppCard style={styles.progressMiniCard}>
      <IconTile icon="flame-outline" tone="warning" size={32} />
      <View>
        <Text style={styles.streakTitle}><Text style={styles.orangeText}>{current}</Text> day streak</Text>
        <Text style={styles.streakSub}>Longest: {longest} days</Text>
      </View>
    </AppCard>
  );
}

function ProgressFeedbackCard({
  body,
  comments,
  expanded,
  onPress,
}: {
  body: string;
  comments: AthleteDashboardData["coachComments"];
  expanded: boolean;
  onPress: () => void;
}) {
  const hasComments = comments.length > 0;
  return (
    <AppCard style={styles.feedbackProgressCard}>
      <View style={styles.feedbackProgressCopy}>
        <Text style={styles.progressCardTitle}>Coach Feedback</Text>
        <Text style={styles.feedbackProgressText}>{body}</Text>
        {expanded && comments.length > 1 ? comments.slice(1).map((comment) => (
          <Text key={comment._id} style={styles.feedbackProgressText}>{comment.body}</Text>
        )) : null}
      </View>
      <ActionButton
        label={!hasComments ? "No Feedback" : expanded ? "Hide Feedback" : "View Feedback"}
        style={styles.feedbackProgressButton}
        textStyle={styles.feedbackProgressButtonText}
        onPress={hasComments ? onPress : undefined}
      />
    </AppCard>
  );
}

function ProgressTinyBar({ value, color }: { value: number; color: string }) {
  return (
    <View style={styles.progressTinyTrack}>
      <View style={[styles.progressTinyFill, { width: `${Math.max(4, Math.min(100, Math.round(value * 100)))}%`, backgroundColor: color }]} />
    </View>
  );
}

function Divider({ vertical }: { vertical?: boolean }) {
  return <View style={vertical ? styles.verticalDivider : styles.divider} />;
}

const styles = StyleSheet.create({
  partialNote: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: -4 },
  cardTitle: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  rowTitle: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  rowValue: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  linkText: { color: colors.primary, fontSize: 11, lineHeight: 14, fontWeight: "900" },
  disabledLinkText: { color: colors.inkFaint },
  successText: { color: colors.ok, fontSize: 11, lineHeight: 15, fontWeight: "800", textAlign: "center" },
  errorText: { color: colors.bad, fontSize: 11, lineHeight: 15, fontWeight: "800", textAlign: "center" },
  inlineActionPanel: { gap: 9 },
  inlineTextInput: {
    minHeight: 78,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 11,
    paddingVertical: 9,
    textAlignVertical: "top",
  },
  divider: { height: 1, backgroundColor: colors.line, width: "100%" },
  verticalDivider: { width: 1, backgroundColor: colors.line, alignSelf: "stretch" },
  readinessCard: { paddingVertical: 8, paddingHorizontal: 11 },
  readinessRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12 },
  readinessLeft: { width: 174, flexDirection: "row", alignItems: "center", gap: 12 },
  readinessCopy: { minWidth: 0, gap: 2 },
  readinessTitle: { color: colors.ink, fontSize: 10, lineHeight: 13, fontWeight: "900" },
  readinessStatus: { fontSize: 11, lineHeight: 14, fontWeight: "900" },
  readinessDivider: { width: 1, height: 64, backgroundColor: colors.line },
  factorList: { flex: 1 },
  factorRow: { minHeight: 21, flexDirection: "row", alignItems: "center", gap: 8 },
  factorLabel: { flex: 1, color: colors.ink, fontSize: 10, lineHeight: 13, fontWeight: "700" },
  factorValue: { fontSize: 10, lineHeight: 13, fontWeight: "900" },
  workoutHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  countBlock: { flexDirection: "row", alignItems: "baseline" },
  countBlue: { color: colors.primary, fontSize: 19, fontWeight: "900" },
  countMuted: { color: colors.inkMuted, fontSize: 15, fontWeight: "800" },
  bigInline: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  splitRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  splitPane: { flex: 1, gap: 5 },
  splitTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  splitButton: { flex: 0, minHeight: 30, marginTop: 3 },
  messageRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  messageTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  messageBody: { color: colors.ink, fontSize: 12, lineHeight: 16, marginTop: 1 },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  sessionActions: { width: 112 },
  sessionDetail: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  sessionDetailRow: { minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sessionDetailLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  sessionDetailValue: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  sessionMessage: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  nutritionSummaryHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  macroGrid: { flexDirection: "row", gap: 8, marginTop: 9 },
  macroMini: { flex: 1, gap: 4 },
  macroLabel: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  macroText: { color: colors.inkMuted, fontSize: 10, fontWeight: "700" },
  workoutsScreenContent: { paddingTop: 34 },
  progressScreenContent: { paddingHorizontal: 18, paddingTop: 24, gap: 5 },
  workoutAppBar: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  workoutScreenTitle: {
    marginTop: 14,
    color: colors.ink,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
    letterSpacing: 0,
  },
  workoutCalendarButton: {
    marginTop: 9,
    height: 32,
    width: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  workoutSegmented: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    padding: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d9e0eb",
    backgroundColor: "#fdfeff",
  },
  workoutSegment: { flex: 1, minHeight: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  workoutSegmentActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  workoutSegmentText: { color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "600" },
  workoutSegmentTextActive: { color: "#ffffff", fontWeight: "900" },
  workoutSegmentDivider: { width: 1, height: 22, backgroundColor: colors.line },
  workoutHeroCard: { paddingHorizontal: 12, paddingVertical: 8 },
  workoutTodayChip: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 5,
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: 4,
  },
  workoutHeroTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  heroWorkoutTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900", marginBottom: 2 },
  workoutHeroMeta: { color: colors.inkMuted, fontSize: 10.5, lineHeight: 14, fontWeight: "700" },
  workoutHeroCoach: { color: colors.ink, fontSize: 10.5, lineHeight: 14, fontWeight: "700", marginTop: 3 },
  workoutBodyIcon: { width: 58, height: 48, alignItems: "center", justifyContent: "center", marginRight: 8, marginTop: 0 },
  workoutTorsoImage: { width: 44, height: 48 },
  progressLineRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10 },
  progressLineBar: { flex: 1 },
  progressPercent: { width: 42, color: colors.primary, fontSize: 14, fontWeight: "900", textAlign: "right" },
  videoMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  videoMetaIcon: { width: 24, height: 18, borderRadius: 3, borderWidth: 1, borderColor: colors.inkMuted, alignItems: "center", justifyContent: "center" },
  workoutVideoMeta: { color: colors.ink, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  workoutHeroButton: { minHeight: 28, borderRadius: 6, marginTop: 8 },
  workoutHeroButtonText: { fontSize: 12, lineHeight: 16 },
  workoutExerciseCard: { paddingHorizontal: 12, paddingVertical: 9 },
  workoutCardTitle: { color: colors.ink, fontSize: 13, lineHeight: 16, fontWeight: "900" },
  workoutExerciseRow: { minHeight: 43, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  workoutExerciseIcon: { width: 35, height: 35, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  workoutExerciseImageShell: { backgroundColor: "transparent" },
  workoutExerciseIconImage: { width: 35, height: 35 },
  workoutExerciseCopy: { flex: 1, minWidth: 0 },
  workoutExerciseTitle: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  workoutExerciseSubtitle: { color: colors.ink, fontSize: 11, lineHeight: 15, fontWeight: "500", marginTop: 1 },
  workoutSmallVideo: { width: 23, height: 18, borderRadius: 3, borderWidth: 1, borderColor: colors.inkMuted, alignItems: "center", justifyContent: "center" },
  workoutExerciseRight: { minWidth: 64, alignItems: "flex-end" },
  workoutSetValue: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900", textAlign: "right" },
  workoutStatusPill: {
    minHeight: 18,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  workoutStatusPillSuccess: { backgroundColor: colors.okSoft, borderColor: "#bfe8c9" },
  workoutStatusPillNeutral: { backgroundColor: colors.surfaceInset, borderColor: colors.line },
  workoutStatusPillText: { color: colors.inkMuted, fontSize: 10, lineHeight: 13, fontWeight: "800" },
  workoutStatusPillTextSuccess: { color: colors.ok },
  targetRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 9 },
  nutritionCardTitle: { color: colors.ink, fontSize: 13, lineHeight: 16, fontWeight: "900" },
  nutritionTargetCard: { paddingVertical: 7, paddingHorizontal: 12 },
  nutritionTargetRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 18 },
  nutritionTargetCopy: { flex: 1, alignItems: "center", gap: 10 },
  targetRemaining: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  nutritionGoalBadge: { alignSelf: "center", borderRadius: radius.pill, backgroundColor: "#fff1e5", paddingHorizontal: 11, paddingVertical: 4 },
  nutritionGoalDisplayText: { color: "#d45b00", fontSize: 10.5, lineHeight: 14, fontWeight: "900" },
  nutritionGoalText: { display: "none" },
  actionRow: { flexDirection: "row", gap: 10 },
  compactButton: { flex: 0, alignSelf: "stretch", marginTop: 7 },
  quickWorkoutCard: { paddingHorizontal: 12, paddingVertical: 8 },
  quickWorkoutSubtitle: { color: colors.inkMuted, fontSize: 11, lineHeight: 14, marginTop: 1 },
  quickWorkoutCount: { color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "700" },
  quickTaskGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 4, columnGap: 18, marginTop: 7 },
  quickTask: { width: "45%", minHeight: 19, flexDirection: "row", alignItems: "center", gap: 7 },
  quickTaskText: { color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "700" },
  quickWorkoutButton: { minHeight: 24, borderRadius: 6, marginTop: 6 },
  quickWorkoutButtonText: { fontSize: 11, lineHeight: 14 },
  workoutListCard: { paddingHorizontal: 12, paddingVertical: 8 },
  workoutScheduleRow: { minHeight: 26, flexDirection: "row", alignItems: "center", gap: 6 },
  workoutCalendarIcon: { width: 22, textAlign: "center" },
  workoutScheduleDay: { width: 64, color: colors.ink, fontSize: 9.5, lineHeight: 12, fontWeight: "900" },
  workoutScheduleName: { flex: 1, color: colors.ink, fontSize: 10.5, lineHeight: 13, fontWeight: "500" },
  workoutScheduleDuration: { width: 42, color: colors.ink, fontSize: 9.5, lineHeight: 12, fontWeight: "700", textAlign: "right" },
  recentWorkoutRow: { minHeight: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 0 },
  recentWorkoutIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  recentWorkoutTitle: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "700" },
  recentWorkoutRpe: { width: 40, color: colors.ink, fontSize: 10, lineHeight: 13, fontWeight: "700", textAlign: "right" },
  trailingLink: { alignSelf: "flex-end", marginTop: 2, fontSize: 11, lineHeight: 14 },
  macroCard: { paddingVertical: 7, paddingHorizontal: 12, gap: 2 },
  macroRow: { minHeight: 23, flexDirection: "row", alignItems: "center", gap: 9 },
  macroBareIcon: { width: 20, textAlign: "center" },
  nutritionMacroLabel: { width: 70, color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "900" },
  nutritionMacroValue: { width: 68, color: colors.ink, fontSize: 10.5, lineHeight: 14, fontWeight: "700", textAlign: "right" },
  nutritionMacroProgress: { flex: 1 },
  nutritionActionRow: { flexDirection: "row", gap: 10 },
  nutritionActionButton: { minHeight: 34, borderRadius: 7 },
  macroCount: { alignSelf: "flex-end", fontSize: 12, fontWeight: "900" },
  sectionInline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowIconTitle: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  innerList: { marginTop: 9, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: "hidden", paddingHorizontal: 8 },
  coachMealCard: { padding: 8, backgroundColor: "#f8faff" },
  mealPlanInnerList: { marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 9, overflow: "hidden", backgroundColor: "#ffffff", paddingHorizontal: 7 },
  mealPlanActions: { minHeight: 32, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.line },
  mealPlanAction: { flex: 1, minHeight: 32, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  mealPlanActionText: { color: colors.primary, fontSize: 11, lineHeight: 14, fontWeight: "900" },
  mealRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7 },
  mealIconBubble: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  nutritionMealTitle: { color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "900" },
  nutritionMealMuted: { color: colors.inkMuted, fontSize: 10, lineHeight: 13 },
  nutritionMealValue: { color: colors.ink, fontSize: 10.5, lineHeight: 14, fontWeight: "800" },
  consumedCard: { backgroundColor: "#f8fffa", borderColor: "#dbeee2", padding: 8 },
  consumedHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  consumedList: { marginTop: 6, gap: 3 },
  consumedMealRow: { minHeight: 25, flexDirection: "row", alignItems: "center", gap: 7 },
  mealDot: { width: 6, height: 6, borderRadius: 3, marginTop: 1 },
  plannedActionGroup: { flexDirection: "row", alignItems: "center", gap: 8 },
  nutritionMiniCard: { paddingVertical: 5, paddingHorizontal: 10 },
  waterRow: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 8 },
  waterCopy: { flex: 1, minWidth: 0, gap: 1 },
  waterProgress: { marginTop: 1, maxWidth: 150 },
  waterButton: { flex: 0, width: 76, minHeight: 27, borderRadius: 7 },
  routineRow: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 8 },
  routineDetail: { color: colors.ink, fontSize: 10, lineHeight: 13, fontWeight: "700", marginTop: 2 },
  routineAction: { flexDirection: "row", alignItems: "center", gap: 3 },
  routinePressable: { flexDirection: "row", alignItems: "center", gap: 3 },
  twoLinks: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8, paddingTop: 8 },
  coachHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  inlineTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  ratingText: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 4 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  bulletRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 8 },
  bulletText: { color: colors.inkMuted, fontSize: 10, fontWeight: "700" },
  videoStrip: { flexDirection: "row", gap: 8, marginTop: 8 },
  videoItem: { flex: 1, minWidth: 0, gap: 5 },
  videoTitle: { color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "900" },
  videoMetaText: { color: colors.inkMuted, fontSize: 9, lineHeight: 12, fontWeight: "800" },
  twoColumnRows: { flexDirection: "row", gap: 8 },
  progressRangeTabs: {
    minHeight: 25,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbe2ed",
    backgroundColor: "#fdfeff",
    flexDirection: "row",
    overflow: "hidden",
  },
  progressRangeTab: { flex: 1, alignItems: "center", justifyContent: "center" },
  progressRangeText: { color: colors.ink, fontSize: 11, lineHeight: 14, fontWeight: "700" },
  progressRangeTextActive: { color: colors.primary, fontWeight: "900" },
  progressRangeUnderline: { position: "absolute", left: 20, right: 20, bottom: 0, height: 2, backgroundColor: "transparent" },
  progressRangeUnderlineActive: { backgroundColor: colors.primary },
  progressCard: { paddingHorizontal: 11, paddingVertical: 6 },
  progressEmptyChart: { alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.surfaceInset },
  progressEmptyChartText: { color: colors.inkMuted, fontSize: 10, lineHeight: 13, fontWeight: "800" },
  progressEmptyText: { color: colors.inkMuted, fontSize: 10.5, lineHeight: 14, fontWeight: "700", marginTop: 6 },
  progressMiniCard: { minHeight: 33, paddingHorizontal: 10, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 8 },
  progressCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  progressCardTitle: { color: colors.ink, fontSize: 11.5, lineHeight: 15, fontWeight: "900" },
  onTrackPill: { minHeight: 17, borderRadius: 9, backgroundColor: colors.okSoft, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  onTrackText: { color: "#137a2a", fontSize: 9, lineHeight: 12, fontWeight: "800" },
  progressGoalMetrics: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  progressGoalMetric: { flex: 1, gap: 1 },
  progressMetricDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.line, marginHorizontal: 8 },
  progressGoalLabel: { color: colors.inkMuted, fontSize: 9.5, lineHeight: 12, fontWeight: "600" },
  progressGoalValue: { color: colors.ink, fontSize: 13.5, lineHeight: 17, fontWeight: "900" },
  progressGoalValueActive: { color: colors.primary },
  progressGoalSuffix: { color: colors.ink, fontSize: 9.5, fontWeight: "600" },
  goalScaleTrack: { height: 5, borderRadius: 3, backgroundColor: "#dfe4ed", marginTop: 7, overflow: "visible" },
  goalScaleFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: colors.primary },
  goalScaleThumb: {
    position: "absolute",
    top: -2.5,
    marginLeft: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  goalScaleLabels: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  goalScaleText: { color: colors.ink, fontSize: 10, lineHeight: 13, fontWeight: "800" },
  progressWeekGrid: { position: "relative", flexDirection: "row", flexWrap: "wrap", marginTop: 5, rowGap: 3 },
  progressWeekVerticalDivider: { position: "absolute", top: 2, bottom: 2, left: "50%", width: 1, backgroundColor: colors.line },
  progressWeekHorizontalDivider: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: colors.line },
  progressWeekMetric: { width: "50%", minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 8 },
  progressWeekCopy: { flex: 1, minWidth: 0, gap: 2 },
  progressMetricTitle: { color: colors.ink, fontSize: 10.5, lineHeight: 13, fontWeight: "900" },
  progressMetricValue: { color: colors.ink, fontSize: 10, lineHeight: 12, fontWeight: "700" },
  progressTinyTrack: { height: 3, borderRadius: 2, backgroundColor: "#dfe4ed", overflow: "hidden", marginTop: 0 },
  progressTinyFill: { height: "100%", borderRadius: 2 },
  unitPicker: {
    minHeight: 24,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ffffff",
  },
  unitText: { color: colors.ink, fontSize: 10, lineHeight: 13, fontWeight: "700" },
  progressChartTabs: { minHeight: 23, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", marginBottom: 4 },
  progressChartTab: { flex: 1, alignItems: "center", justifyContent: "center" },
  progressChartTabText: { color: colors.inkMuted, fontSize: 10, lineHeight: 13, fontWeight: "700" },
  progressChartTabTextActive: { color: colors.primary, fontWeight: "900" },
  progressChartUnderline: { position: "absolute", left: 8, right: 8, bottom: -1, height: 2, backgroundColor: "transparent" },
  progressChartUnderlineActive: { backgroundColor: colors.primary },
  readinessChartBody: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 7 },
  readinessScoreBlock: { width: 86, gap: 2 },
  readinessScoreLabel: { color: colors.ink, fontSize: 9.5, lineHeight: 12, fontWeight: "900" },
  readinessScoreValue: { color: colors.ink, fontSize: 12, lineHeight: 15, fontWeight: "600" },
  readinessScoreNumber: { color: colors.primary, fontSize: 20, lineHeight: 24, fontWeight: "900" },
  goodRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  goodDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok, borderWidth: 1, borderColor: "#c8f0d2" },
  goodText: { color: "#137a2a", fontSize: 10, lineHeight: 13, fontWeight: "800" },
  readinessChartPane: { flex: 1, minWidth: 0 },
  nutritionAdherenceRow: { minHeight: 36, flexDirection: "row", alignItems: "center", marginTop: 6 },
  nutritionAdherenceMetric: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  nutritionAdherenceCopy: { flex: 1, minWidth: 0, gap: 2 },
  nutritionAdherenceLabel: { color: colors.ink, fontSize: 9, lineHeight: 11, fontWeight: "700" },
  nutritionAdherenceValue: { color: colors.ink, fontSize: 11.5, lineHeight: 14, fontWeight: "900" },
  progressInsightRow: { minHeight: 23, flexDirection: "row", alignItems: "center", gap: 8 },
  progressInsightIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  progressInsightIconUp: { backgroundColor: colors.okSoft },
  progressInsightIconDown: { backgroundColor: "#fff1e5" },
  progressInsightText: { flex: 1, color: colors.ink, fontSize: 10.5, lineHeight: 14, fontWeight: "700" },
  greenText: { color: colors.ok, fontWeight: "900" },
  orangeText: { color: "#f97316", fontWeight: "900" },
  streakTitle: { color: colors.ink, fontSize: 11.5, lineHeight: 15, fontWeight: "800" },
  streakSub: { color: colors.ink, fontSize: 9.5, lineHeight: 12, marginTop: 1 },
  feedbackProgressCard: { minHeight: 45, paddingHorizontal: 10, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 9 },
  feedbackProgressCopy: { flex: 1, minWidth: 0 },
  feedbackProgressText: { color: colors.ink, fontSize: 10, lineHeight: 13, marginTop: 2 },
  feedbackProgressButton: { flex: 0, width: 112, minHeight: 27, borderRadius: 5 },
  feedbackProgressButtonText: { fontSize: 10, lineHeight: 13 },
  metricGrid: { flexDirection: "row", gap: 8, marginTop: 12 },
  goalGrid: { flexDirection: "row", gap: 12, marginTop: 12 },
  goalMetric: { flex: 1, borderRightWidth: 1, borderRightColor: colors.line, paddingRight: 10 },
  goalLabel: { color: colors.inkMuted, fontSize: 14, marginBottom: 4 },
  goalValue: { color: colors.ink, fontSize: 16, fontWeight: "900" },
});
