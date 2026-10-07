import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import type { ImageSourcePropType } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AlertBanner,
  StaleDataNotice,
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
  StatusChip,
} from "../../components/fitora";
import { Avatar } from "../../components/Avatar";
import type { MessageView } from "../../components/MessageCenter";
import { apiFetch, apiJson } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PAYMENTS_ENABLED } from "../../lib/features";
import { celebrate, showError } from "../../lib/feedback";
import { joinSessionCall } from "../../lib/videoCall";
import { eligibleDays, judgeRate, localDayOf, windowStart } from "../../lib/progressWindow";
import { exerciseVisual, mealVisual, workoutVisual, type FitoraIconAsset, type FitoraVisual } from "../../lib/fitoraIcons";
import { colors, radius } from "../../lib/theme";
import {
  addDays,
  dateKey,
  firstName,
  headerDate,
  timeOfDayGreeting,
  formatCurrency,
  formatDuration,
  loadAthleteDashboardData,
  loadWorkoutDetail,
  longDate,
  mealCalories,
  nextFutureSession,
  sessionClock,
  shortDate,
  titleCase,
  todayKey,
  useAsyncData,
  type AthleteDashboardData,
  type CoachSession,
  type CoachVideo,
  type Meal,
  type PlannedMeal,
  type TrendPoint,
  type WorkoutAssignmentDetail,
  type WorkoutAssignmentSummary,
} from "../../lib/fitoraData";
import { VideoPlayerModal } from "../../components/VideoPlayerModal";

type AthleteTab = "today" | "workouts" | "nutrition" | "coach" | "progress";
type WorkoutSegment = "today" | "upcoming" | "history";

const NAV_ITEMS = [
  { key: "today", label: "Today", icon: "home-outline" as const },
  { key: "workouts", label: "Training", icon: "barbell-outline" as const },
  { key: "nutrition", label: "Nutrition", icon: "nutrition-outline" as const },
  { key: "coach", label: "Coach", icon: "people-outline" as const },
  { key: "progress", label: "Progress", icon: "bar-chart-outline" as const },
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

function daysUntil(dateString?: string | null): number | null {
  if (!dateString) return null;
  const now = new Date();
  const then = new Date(dateString);
  if (Number.isNaN(then.getTime())) return null;
  return Math.ceil((then.getTime() - now.getTime()) / 86400000);
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

export default function AthleteDashboard() {
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string; refresh?: string }>();
  const [activeTab, setActiveTab] = useState<AthleteTab>(() => normalizeTab(params.section));
  const [loggingWater, setLoggingWater] = useState(false);
  const state = useAsyncData(loadAthleteDashboardData, [], "athlete-dashboard");
  const reloadDashboard = state.reload;
  const hasFocusedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (
        hasFocusedOnce.current
        && (activeTab === "workouts" || activeTab === "nutrition" || activeTab === "coach" || activeTab === "progress")
      ) {
        reloadDashboard();
      }
      hasFocusedOnce.current = true;
      return undefined;
    }, [activeTab, reloadDashboard])
  );

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
        setActiveTab(key as AthleteTab);
        router.setParams({ section: key });
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
      if (!res.ok) throw new Error();
      // The response is the athlete's whole updated water day — apply it
      // directly instead of re-running the full ~15-request dashboard
      // loader just to reflect one water log.
      const water = (await res.json().catch(() => null)) as AthleteDashboardData["water"];
      if (water) {
        const before = data?.water?.totalMl ?? 0;
        state.setData((prev) => (prev ? { ...prev, water } : prev));
        const liters = (ml: number) => (ml / 1000).toFixed(1);
        if (before < water.goalMl && water.totalMl >= water.goalMl) {
          celebrate({ title: "Water goal reached!", body: `${liters(water.totalMl)} L today. Nice work.`, big: true });
        } else {
          celebrate({ title: `+${amountMl} ml logged`, body: `${liters(water.totalMl)} of ${liters(water.goalMl)} L today` });
        }
      }
    } catch {
      showError("Couldn't log water", "Check your connection and try again.");
    } finally {
      setLoggingWater(false);
    }
  }

  const isTodayTab = activeTab === "today";
  const isWorkoutsTab = activeTab === "workouts";
  const isNutritionTab = activeTab === "nutrition";
  const isCoachTab = activeTab === "coach";
  const isProgressTab = activeTab === "progress";

  return (
    <ScreenContainer
      refreshing={state.refreshing}
      onRefresh={state.reload}
      bottomNav={bottomNav}
      avoidTopSafeArea={isWorkoutsTab || isProgressTab}
      contentStyle={
        isTodayTab
          ? styles.todayScreenContent
          : isWorkoutsTab
            ? styles.workoutsScreenContent
            : isNutritionTab
              ? styles.nutritionScreenContent
              : isCoachTab
                ? styles.coachScreenContent
                : isProgressTab
                  ? styles.progressScreenContent
                  : undefined
      }
    >
      {state.stale ? <StaleDataNotice onRetry={state.reload} /> : null}
      {activeTab === "today" ? <TodayView data={data} onNavigate={setActiveTab} /> : null}
      {activeTab === "workouts" ? <WorkoutsView data={data} /> : null}
      {activeTab === "nutrition" ? <NutritionViewV2 data={data} onLogWater={logWater} loggingWater={loggingWater} onUpdateData={state.setData} /> : null}
      {activeTab === "coach" ? <CoachView data={data} onReload={state.reload} onNavigate={setActiveTab} /> : null}
      {activeTab === "progress" ? <ProgressView data={data} onNavigate={setActiveTab} /> : null}
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
  onNavigate,
}: {
  data: AthleteDashboardData;
  onNavigate: (tab: AthleteTab) => void;
}) {
  const router = useRouter();
  const name = data.profile?.name ?? data.daily?.name ?? "User";
  const workout = data.workouts[0] ?? null;
  const todaySession = nextSessionForDate(data.sessions, data.date);
  const tomorrow = tomorrowPreview(data);
  const activeCoach = data.coachProfile?.name || data.coaches[0]?.name || "your coach";
  const [sessionExpanded, setSessionExpanded] = useState(false);

  const alert = buildTodayAlert(data, activeCoach, { membership: () => onNavigate("coach") });

  function goToWorkout(target = workout) {
    if (target) router.push({ pathname: "/athlete/active-workout", params: { assignmentId: target.id } } as never);
  }

  function handleReadinessPress() {
    if (data.daily?.readinessScore == null) router.push("/athlete/check-in" as never);
    else router.push("/athlete/trends" as never);
  }

  function handleWorkoutReview() {
    if (!workout) return;
    router.push({ pathname: "/athlete/rpe", params: workout.slot ? { sessionType: workout.slot } : {} } as never);
  }

  function handleTomorrowPress() {
    if (!tomorrow) return;
    if (tomorrow.kind === "workout") goToWorkout(tomorrow.workout);
    else onNavigate("coach");
  }

  function handleSchedulePress(item: TodayScheduleItem) {
    switch (item.kind) {
      case "checkin":
        router.push("/athlete/check-in" as never);
        return;
      case "workout":
        goToWorkout();
        return;
      case "session":
        setSessionExpanded(true);
        return;
      case "water":
        router.push("/athlete/water" as never);
        return;
      case "nutrition":
        onNavigate("nutrition");
        return;
    }
  }

  return (
    <>
      <TodayHeader name={name} date={data.date} />

      {alert}

      <ReadinessStrip score={data.daily?.readinessScore ?? null} onPress={handleReadinessPress} />

      <NextWorkoutCard data={data} workout={workout} onWorkoutPress={() => goToWorkout()} onReviewPress={handleWorkoutReview} onFindCoach={() => onNavigate("coach")} />

      <TodayScheduleCard
        data={data}
        workout={workout}
        session={todaySession}
        onViewAll={() => onNavigate("workouts")}
        onPressItem={handleSchedulePress}
      />

      {sessionExpanded && todaySession ? (
        <SessionCard session={todaySession} coachName={activeCoach} expanded={sessionExpanded} onExpandedChange={setSessionExpanded} />
      ) : null}

      <DailyStatusCard data={data} onNavigate={onNavigate} />

      <CoachUpdateCard data={data} coachName={activeCoach} tomorrow={tomorrow} onReply={() => onNavigate("coach")} onTomorrowPress={handleTomorrowPress} />
    </>
  );
}

function TodayHeader({ name, date }: { name: string; date: string }) {
  return (
    <PrimaryAppBar
      variant="today"
      greeting={`${timeOfDayGreeting()}, ${firstName(name, "there")}`}
      title={headerDate(date)}
    />
  );
}

function ReadinessStrip({ score, onPress }: { score: number | null; onPress: () => void }) {
  const tone = readinessTone(score);
  const palette = readinessPalette(tone);
  const label = readinessLabel(score);
  const value = score == null ? "Check-in needed" : `${Math.round(score)} · ${label}`;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.readinessStrip, pressed ? { opacity: 0.75 } : null]}>
      <View style={[styles.readinessIcon, { backgroundColor: palette.soft }]}>
        <Ionicons name="stats-chart" size={23} color={palette.strong} />
      </View>
      <View style={styles.readinessCopy}>
        <View style={styles.readinessTitleLine}>
          <Text style={styles.readinessTitle}>Readiness</Text>
          <Text style={[styles.readinessValue, { color: palette.strong }]} numberOfLines={1}>{value}</Text>
        </View>
        <Text style={styles.readinessBody} numberOfLines={2}>{readinessDetail(score)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.inkFaint} />
    </Pressable>
  );
}

function NextWorkoutCard({
  data,
  workout,
  onWorkoutPress,
  onReviewPress,
  onFindCoach,
}: {
  data: AthleteDashboardData;
  workout: WorkoutAssignmentSummary | null;
  onWorkoutPress: () => void;
  onReviewPress: () => void;
  onFindCoach: () => void;
}) {
  const exerciseCount = workoutExerciseCount(workout, data.workoutDetail);
  const completed = workout?.status === "completed";
  const skipped = workout?.status === "skipped";
  const inProgress = Boolean(workout && (workout.status === "in_progress" || (workout.completedCount > 0 && workout.completedCount < exerciseCount)));
  const rpeLogged = workout?.slot ? data.daily?.rpeEntries?.[workout.slot] : data.daily?.rpe;
  const visual = workout ? workoutVisual(workout.name) : null;
  const imageSource = workoutImageSource(visual?.asset);
  const ctaLabel = completed
    ? rpeLogged ? "Completed" : "Log RPE"
    : skipped ? "Skipped"
    : inProgress ? "Continue Workout"
    : "Start Workout";
  const ctaIcon: keyof typeof Ionicons.glyphMap = completed && rpeLogged
    ? "checkmark-circle"
    : completed ? "speedometer-outline"
    : inProgress ? "play-forward-outline"
    : "arrow-forward";
  const ctaDisabled = !workout || skipped || (completed && Boolean(rpeLogged));
  const ctaAction = completed && !rpeLogged ? onReviewPress : onWorkoutPress;

  if (!workout) {
    const hasCoach = athleteHasCoach(data);
    return (
      <AppCard style={styles.nextWorkoutCard}>
        <View style={styles.nextWorkoutTop}>
          <View style={styles.nextWorkoutIcon}>
            <Ionicons name="barbell-outline" size={25} color={colors.primary} />
          </View>
          <View style={styles.nextWorkoutCopy}>
            <Text style={styles.nextWorkoutEyebrow}>NEXT UP</Text>
            <Text style={styles.nextWorkoutTitle}>{hasCoach ? "No training scheduled today" : "Get a training plan"}</Text>
            <Text style={styles.nextWorkoutMeta}>
              {hasCoach
                ? "Your coach has not assigned a workout for today."
                : "Workouts appear here once you're connected with a coach. Until then, start with your check-in, meals and water."}
            </Text>
          </View>
        </View>
        {hasCoach ? null : <ActionButton label="Find a Coach" icon="search-outline" onPress={onFindCoach} />}
      </AppCard>
    );
  }

  return (
    <AppCard style={styles.nextWorkoutCard}>
      <View style={styles.nextWorkoutTop}>
        <View style={styles.nextWorkoutIcon}>
          <Ionicons name="barbell-outline" size={26} color={colors.primary} />
        </View>
        <View style={styles.nextWorkoutCopy}>
          <Text style={styles.nextWorkoutEyebrow}>NEXT UP</Text>
          <Text style={styles.nextWorkoutTitle} numberOfLines={2}>{workout.name}</Text>
          <Text style={styles.nextWorkoutMeta}>
            {exerciseCount} exercise{exerciseCount === 1 ? "" : "s"} · {workoutDurationRange(exerciseCount)}
          </Text>
          <View style={styles.nextWorkoutNoteRow}>
            <Ionicons name={completed ? "checkmark-circle-outline" : "chatbubble-outline"} size={16} color={completed ? colors.ok : colors.inkFaint} />
            <Text style={styles.nextWorkoutNote} numberOfLines={1}>{workoutNote(data, workout)}</Text>
          </View>
        </View>
        <View style={styles.nextWorkoutArt}>
          {imageSource ? (
            <Image source={imageSource} style={styles.nextWorkoutImage} resizeMode="contain" />
          ) : (
            <Ionicons name="barbell-outline" size={44} color={colors.primary} />
          )}
        </View>
      </View>
      <ActionButton
        label={ctaLabel}
        icon={ctaIcon}
        variant="filled"
        style={[styles.nextWorkoutButton, ctaDisabled ? styles.nextWorkoutButtonDisabled : null]}
        textStyle={styles.nextWorkoutButtonText}
        onPress={ctaDisabled ? undefined : ctaAction}
        disabled={ctaDisabled}
      />
    </AppCard>
  );
}

type TodayScheduleKind = "checkin" | "workout" | "water" | "nutrition" | "session";

type TodayScheduleItem = {
  id: string;
  kind: TodayScheduleKind;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  completed: boolean;
  statusLabel?: string;
  statusTone?: "success" | "primary" | "neutral" | "warning";
  value?: string;
  chevron?: boolean;
};

function TodayScheduleCard({
  data,
  workout,
  session,
  onViewAll,
  onPressItem,
}: {
  data: AthleteDashboardData;
  workout: WorkoutAssignmentSummary | null;
  session: CoachSession | null;
  onViewAll: () => void;
  onPressItem: (item: TodayScheduleItem) => void;
}) {
  const items = buildTodayScheduleItems(data, workout, session);

  return (
    <AppCard style={styles.scheduleCard}>
      <View style={styles.todaySectionHeader}>
        <Text style={styles.todaySectionTitle}>{"Today's Schedule"}</Text>
        {workout ? (
          <Pressable onPress={onViewAll} hitSlop={8} style={styles.todaySectionAction}>
            <Text style={styles.todaySectionActionText}>View All</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {items.map((item, index) => (
        <ScheduleRow key={item.id} item={item} index={index} total={items.length} onPress={() => onPressItem(item)} />
      ))}
    </AppCard>
  );
}

function ScheduleRow({
  item,
  index,
  total,
  onPress,
}: {
  item: TodayScheduleItem;
  index: number;
  total: number;
  onPress: () => void;
}) {
  const chipPalette = scheduleChipPalette(item.statusTone ?? "neutral");
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.scheduleRow, pressed ? { opacity: 0.72 } : null]}>
      <View style={styles.timelineCell}>
        {index > 0 ? <View style={[styles.timelineLine, styles.timelineLineTop]} /> : null}
        {index < total - 1 ? <View style={[styles.timelineLine, styles.timelineLineBottom]} /> : null}
        <View style={[styles.timelineDot, item.completed ? styles.timelineDotDone : null, !item.completed && index === 1 ? styles.timelineDotActive : null]}>
          {item.completed ? <Ionicons name="checkmark" size={13} color="#ffffff" /> : null}
        </View>
      </View>
      <View style={styles.scheduleIconBubble}>
        <Ionicons name={item.icon} size={20} color={item.kind === "workout" ? colors.primary : colors.inkMuted} />
      </View>
      <View style={styles.scheduleCopy}>
        <Text style={styles.scheduleTitle} numberOfLines={item.kind === "workout" ? 2 : 1}>{item.title}</Text>
        <Text style={styles.scheduleSubtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86}>{item.subtitle}</Text>
      </View>
      <View style={styles.scheduleRight}>
        {item.statusLabel ? (
          <View style={[styles.schedulePill, { backgroundColor: chipPalette.bg }]}>
            <Text style={[styles.schedulePillText, { color: chipPalette.text }]} numberOfLines={1}>{item.statusLabel}</Text>
          </View>
        ) : item.value ? (
          <View style={styles.scheduleValuePill}>
            <Text style={styles.scheduleValueText} numberOfLines={1}>{item.value}</Text>
          </View>
        ) : null}
        {item.chevron ? <Ionicons name="chevron-forward" size={20} color={colors.inkFaint} /> : null}
      </View>
    </Pressable>
  );
}

function DailyStatusCard({ data, onNavigate }: { data: AthleteDashboardData; onNavigate: (tab: AthleteTab) => void }) {
  const router = useRouter();
  const readiness = data.daily?.readinessScore ?? null;
  const consumed = consumedCalories(data);
  const workoutsToday = data.workouts.length;
  const workoutsDone = data.workouts.filter((w) => w.status === "completed").length;
  const waterTotal = formatLiters(data.water?.totalMl ?? 0);
  const waterGoal = formatLiters(data.water?.goalMl ?? 0);

  return (
    <AppCard style={styles.dailyStatusCard}>
      <View style={styles.todaySectionHeader}>
        <Text style={styles.todaySectionTitle}>Daily Status</Text>
        <Pressable onPress={() => onNavigate("progress")} hitSlop={8} style={styles.todaySectionAction}>
          <Text style={styles.todaySectionActionText}>View Details</Text>
          <Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </Pressable>
      </View>
      <View style={styles.statusGrid}>
        <StatusMetric
          icon="stats-chart"
          label="Readiness"
          value={readiness != null ? String(Math.round(readiness)) : "--"}
          sub={readinessLabel(readiness)}
          tone={readinessTone(readiness)}
          onPress={() => router.push("/athlete/trends" as never)}
        />
        <StatusMetric
          icon="nutrition-outline"
          label="Nutrition"
          value={consumed > 0 ? String(consumed) : "--"}
          sub={consumed > 0 ? "kcal" : "Log a meal"}
          tone="success"
          onPress={() => onNavigate("nutrition")}
        />
        <StatusMetric
          icon="water-outline"
          label="Water"
          value={waterTotal}
          sub={`/ ${waterGoal} L`}
          tone="primary"
          onPress={() => router.push("/athlete/water" as never)}
        />
        <StatusMetric
          icon="barbell-outline"
          label="Training"
          value={workoutsToday ? `${workoutsDone} / ${workoutsToday}` : "Rest"}
          sub={workoutsToday ? "complete" : "Nothing planned"}
          tone="purple"
          onPress={() => onNavigate("workouts")}
        />
      </View>
    </AppCard>
  );
}

function StatusMetric({
  icon,
  label,
  value,
  sub,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  sub: string;
  tone: "success" | "warning" | "danger" | "neutral" | "primary" | "purple";
  onPress?: () => void;
}) {
  const palette = metricPalette(tone);
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.statusMetric, pressed ? { opacity: 0.72 } : null]}>
      <View style={[styles.statusMetricIcon, { backgroundColor: palette.soft }]}>
        <Ionicons name={icon} size={20} color={palette.strong} />
      </View>
      <View style={styles.statusMetricCopy}>
        <Text style={styles.statusLabel} numberOfLines={1}>{label}</Text>
        <Text style={[styles.statusValue, { color: palette.strong }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{value}</Text>
        <Text style={styles.statusSub} numberOfLines={1}>{sub}</Text>
      </View>
    </Pressable>
  );
}

type TomorrowPreview =
  | { kind: "workout"; title: string; meta: string; workout: WorkoutAssignmentSummary }
  | { kind: "session"; title: string; meta: string; session: CoachSession };

function CoachUpdateCard({
  data,
  coachName,
  tomorrow,
  onReply,
  onTomorrowPress,
}: {
  data: AthleteDashboardData;
  coachName: string;
  tomorrow: TomorrowPreview | null;
  onReply: () => void;
  onTomorrowPress: () => void;
}) {
  const comment = data.coachComments[0] ?? null;
  const hasCoach = Boolean(data.coachProfile || data.coaches.length);
  if (!comment && !hasCoach && !tomorrow) return null;

  return (
    <AppCard style={styles.coachUpdateCard}>
      <View style={styles.coachUpdateRow}>
        <View style={styles.coachUpdateAvatarWrap}>
          {comment || hasCoach ? (
            <Avatar avatar={data.coachProfile?.avatar} name={coachName} size={34} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
          ) : (
            <IconTile icon="calendar-outline" size={34} />
          )}
          {comment ? <View style={styles.coachUnreadDot} /> : null}
        </View>
        <View style={styles.coachUpdateCopy}>
          <View style={styles.coachUpdateTitleRow}>
            <Text style={styles.coachUpdateTitle}>Coach Update</Text>
            {comment ? <Text style={styles.coachUpdateTime}>{relativeTime(comment.createdAt ?? comment.date)}</Text> : null}
          </View>
          <Text style={styles.coachUpdateBody} numberOfLines={3}>
            {comment?.body ?? "No new coach updates today."}
          </Text>
          {comment ? (
            <Pressable onPress={onReply} hitSlop={8} style={styles.replyButton}>
              <Ionicons name="chatbubble-outline" size={17} color={colors.primary} />
              <Text style={styles.replyText}>Reply</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {tomorrow ? (
        <>
          <Divider />
          <Pressable onPress={onTomorrowPress} style={({ pressed }) => [styles.tomorrowRow, pressed ? { opacity: 0.72 } : null]}>
            <View style={styles.tomorrowIcon}>
              <Ionicons name="calendar-outline" size={20} color={colors.inkMuted} />
            </View>
            <Text style={styles.tomorrowText} numberOfLines={1}>
              <Text style={styles.tomorrowStrong}>Tomorrow:</Text> {tomorrow.title}{tomorrow.meta ? ` · ${tomorrow.meta}` : ""}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
          </Pressable>
        </>
      ) : null}
    </AppCard>
  );
}

function readinessPalette(tone: "success" | "warning" | "danger" | "neutral" | "primary") {
  if (tone === "success") return { strong: colors.ok, soft: colors.okSoft };
  if (tone === "warning") return { strong: colors.warn, soft: colors.warnSoft };
  if (tone === "danger") return { strong: colors.bad, soft: colors.badSoft };
  return { strong: colors.primary, soft: colors.primarySoft };
}

function metricPalette(tone: "success" | "warning" | "danger" | "neutral" | "primary" | "purple") {
  if (tone === "purple") return { strong: "#6d28d9", soft: "#f0e7ff" };
  return readinessPalette(tone);
}

function readinessDetail(score: number | null | undefined): string {
  if (score == null) return "Complete your check-in to unlock today's readiness.";
  if (score >= 75) return "Good recovery today · You are cleared to push.";
  if (score >= 60) return "Moderate recovery today · Keep effort controlled.";
  return "Low recovery today · Take it slightly lighter.";
}

function workoutExerciseCount(workout: WorkoutAssignmentSummary | null, detail?: WorkoutAssignmentDetail | null): number {
  if (!workout) return 0;
  return detail?.id === workout.id && detail.exercises.length ? detail.exercises.length : workout.exerciseCount;
}

function workoutDurationRange(exerciseCount: number): string {
  if (exerciseCount >= 7) return "50-60 min";
  if (exerciseCount >= 6) return "45-55 min";
  if (exerciseCount >= 4) return "30-40 min";
  if (exerciseCount > 0) return "20-30 min";
  return "Duration TBD";
}

function workoutNote(data: AthleteDashboardData, workout: WorkoutAssignmentSummary): string {
  if (workout.status === "completed") return "Completed. Log RPE.";
  if (workout.status === "skipped") return "Skipped for today.";
  const score = data.daily?.readinessScore;
  if (score == null) return "Check in first to tune today's effort.";
  if (score < 60) return "Keep effort moderate today.";
  if (score < 75) return "Hold clean form and avoid max efforts.";
  return "Ready to train. Focus on quality reps.";
}

function formatLiters(ml: number): string {
  return (Math.max(0, ml) / 1000).toFixed(1);
}

function scheduleChipPalette(tone: "success" | "primary" | "neutral" | "warning") {
  if (tone === "success") return { text: colors.ok, bg: colors.okSoft };
  if (tone === "primary") return { text: colors.primary, bg: colors.primarySoft };
  if (tone === "warning") return { text: colors.warn, bg: colors.warnSoft };
  return { text: colors.inkMuted, bg: colors.surfaceInset };
}

function workoutScheduleStatus(workout: WorkoutAssignmentSummary | null): { label: string; tone: TodayScheduleItem["statusTone"]; completed: boolean } {
  if (!workout) return { label: "No workout", tone: "neutral", completed: false };
  if (workout.status === "completed") return { label: "Completed", tone: "success", completed: true };
  if (workout.status === "skipped") return { label: "Skipped", tone: "neutral", completed: true };
  if (workout.status === "in_progress" || workout.completedCount > 0) return { label: "In progress", tone: "primary", completed: false };
  return { label: "Not started", tone: "neutral", completed: false };
}

function buildTodayScheduleItems(data: AthleteDashboardData, workout: WorkoutAssignmentSummary | null, session: CoachSession | null): TodayScheduleItem[] {
  const readinessDone = data.daily?.readinessScore != null;
  const items: TodayScheduleItem[] = [
    {
      id: "checkin",
      kind: "checkin",
      icon: "clipboard-outline",
      title: "Morning Check-in",
      subtitle: readinessDone ? "Readiness updated" : "How are you feeling today?",
      completed: readinessDone,
      statusLabel: readinessDone ? "Completed" : "Due",
      statusTone: readinessDone ? "success" : "warning",
    },
  ];

  if (workout) {
    const status = workoutScheduleStatus(workout);
    const count = workoutExerciseCount(workout, data.workoutDetail);
    items.push({
      id: "workout",
      kind: "workout",
      icon: "barbell-outline",
      title: workout.name,
      subtitle: `${count} exercise${count === 1 ? "" : "s"} · ${workoutDurationRange(count)}`,
      completed: status.completed,
      statusLabel: status.label,
      statusTone: status.tone,
    });
  }

  if (data.water) {
    const reached = data.water.goalMl > 0 && data.water.totalMl >= data.water.goalMl;
    items.push({
      id: "water",
      kind: "water",
      icon: "water-outline",
      title: "Water Goal",
      subtitle: "Track your hydration",
      completed: reached,
      value: `${formatLiters(data.water.totalMl)} / ${formatLiters(data.water.goalMl)} L`,
      chevron: true,
    });
  }

  if (data.target) {
    const consumed = consumedCalories(data);
    items.push({
      id: "nutrition",
      kind: "nutrition",
      icon: "restaurant-outline",
      title: "Nutrition Goal",
      subtitle: "Log your food intake",
      completed: consumed >= data.target.calories,
      value: `${consumed} / ${data.target.calories} kcal`,
      chevron: true,
    });
  }

  if (session) {
    items.push({
      id: "session",
      kind: "session",
      icon: "videocam-outline",
      title: titleCase(session.type) || "Coach Session",
      subtitle: sessionTimeLabel(session),
      completed: session.status === "completed",
      statusLabel: titleCase(session.status) || "Scheduled",
      statusTone: session.status === "completed" ? "success" : "primary",
      chevron: true,
    });
  }

  return items;
}

function nextSessionForDate(sessions: CoachSession[], key: string): CoachSession | null {
  return sessions
    .filter((session) => dateKey(new Date(session.scheduledStart)) === key && session.status !== "cancelled")
    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())[0] ?? null;
}

function sessionTimeLabel(session: CoachSession): string {
  const start = new Date(session.scheduledStart);
  const end = new Date(session.scheduledEnd);
  const duration = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const time = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return duration ? `${time} · ${duration} min` : time;
}

function slotLabel(slot?: string | null): string {
  if (slot === "AM") return "AM";
  if (slot === "AFT") return "Afternoon";
  if (slot === "PM") return "PM";
  return "";
}

function tomorrowPreview(data: AthleteDashboardData): TomorrowPreview | null {
  const tomorrowKey = addDays(data.date, 1);
  const workout = data.upcomingWorkouts.find((item) => item.scheduledDate === tomorrowKey) ?? null;
  if (workout) {
    return { kind: "workout", title: workout.name, meta: slotLabel(workout.slot), workout };
  }
  const session = nextSessionForDate(data.sessions, tomorrowKey);
  if (session) {
    return { kind: "session", title: titleCase(session.type) || "Coach Session", meta: sessionTimeLabel(session), session };
  }
  return null;
}

function relativeTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function buildTodayAlert(
  data: AthleteDashboardData,
  coachName: string,
  actions: { membership: () => void }
) {
  if (!PAYMENTS_ENABLED) return null;
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
  return null;
}

function SessionCard({
  session,
  coachName,
  expanded: expandedProp,
  onExpandedChange,
}: {
  session: CoachSession;
  coachName: string;
  expanded?: boolean;
  onExpandedChange?: (value: boolean) => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = expandedProp ?? internalExpanded;
  const setExpanded = (next: boolean) => {
    if (onExpandedChange) onExpandedChange(next);
    else setInternalExpanded(next);
  };
  const [joining, setJoining] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const scheduledStart = new Date(session.scheduledStart);
  const scheduledEnd = new Date(session.scheduledEnd);

  async function joinSession() {
    if (joining) return;
    setJoining(true);
    setSessionMessage(null);
    try {
      const result = await joinSessionCall("athlete", session.id, { withName: coachName, title: `Session with ${coachName}` });
      if (!result.ok) setSessionMessage(result.message);
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
              setExpanded(!expanded);
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

const WEEKDAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** The Monday-Sunday week (as date keys) containing `centerKey`. */
function weekDatesFor(centerKey: string): string[] {
  const [year, month, day] = centerKey.split("-").map(Number);
  const center = new Date(year, (month || 1) - 1, day || 1);
  const isoDow = center.getDay() === 0 ? 7 : center.getDay(); // 1=Mon..7=Sun
  const monday = addDays(centerKey, 1 - isoDow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function dayNumber(key: string): number {
  return Number(key.split("-")[2]);
}

type WorkoutStateTone = "success" | "primary" | "warning" | "danger" | "neutral";

/** Derives a display state from real assignment fields — never invents a state for a day with no assignment (that's a rest day, handled separately). */
function workoutState(workout: WorkoutAssignmentSummary, todayKeyValue: string): { label: string; tone: WorkoutStateTone } {
  if (workout.status === "completed") return { label: "Completed", tone: "success" };
  if (workout.status === "in_progress" || workout.completedCount > 0) return { label: "In progress", tone: "primary" };
  if (workout.status === "skipped") return { label: "Skipped", tone: "neutral" };
  if (workout.scheduledDate < todayKeyValue) return { label: "Missed", tone: "danger" };
  return { label: "Not started", tone: "neutral" };
}

function WorkoutsView({ data }: { data: AthleteDashboardData }) {
  const [segment, setSegment] = useState<WorkoutSegment>("today");
  const [selectedDate, setSelectedDate] = useState(data.date);
  const coachName = data.coachProfile?.name ?? data.coaches[0]?.name ?? "your coach";

  const workoutsByDate = useMemo(() => {
    const map = new Map<string, WorkoutAssignmentSummary[]>();
    for (const workout of [...data.recentWorkouts, ...data.workouts, ...data.upcomingWorkouts]) {
      const list = map.get(workout.scheduledDate) ?? [];
      list.push(workout);
      map.set(workout.scheduledDate, list);
    }
    return map;
  }, [data.recentWorkouts, data.workouts, data.upcomingWorkouts]);

  const weekDates = useMemo(() => weekDatesFor(data.date), [data.date]);
  const selectedWorkout = (workoutsByDate.get(selectedDate) ?? [])[0] ?? null;
  const isSelectedToday = selectedDate === data.date;

  const [lazyDetail, setLazyDetail] = useState<WorkoutAssignmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const selectedWorkoutId = selectedWorkout?.id ?? null;
  useEffect(() => {
    if (isSelectedToday || !selectedWorkoutId) {
      setLazyDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    loadWorkoutDetail(selectedWorkoutId)
      .then((detail) => active && setLazyDetail(detail))
      .catch(() => active && setLazyDetail(null))
      .finally(() => active && setDetailLoading(false));
    return () => {
      active = false;
    };
  }, [isSelectedToday, selectedWorkoutId]);

  const selectedDetail = isSelectedToday ? data.workoutDetail : lazyDetail;
  const upNextWorkout = data.upcomingWorkouts.find((item) => item.scheduledDate > selectedDate) ?? data.upcomingWorkouts[0] ?? null;

  return (
    <>
      <WorkoutAppBar
        onCalendarPress={() => {
          setSegment("today");
          setSelectedDate(data.date);
        }}
      />
      <WorkoutSegmentedControl value={segment} onChange={setSegment} />
      {segment === "today" ? (
        <>
          <WeeklyCalendarStrip
            dates={weekDates}
            selected={selectedDate}
            todayKeyValue={data.date}
            workoutsByDate={workoutsByDate}
            onSelect={setSelectedDate}
          />
          {selectedWorkout ? (
            <TrainingWorkoutHero
              workout={selectedWorkout}
              detail={selectedDetail}
              detailLoading={!isSelectedToday && detailLoading}
              coachName={coachName}
              dateStr={selectedDate}
              todayKeyValue={data.date}
            />
          ) : (
            <TrainingNoWorkoutCard dateStr={selectedDate} todayKeyValue={data.date} hasCoach={athleteHasCoach(data)} />
          )}
          {selectedDetail && selectedDetail.exercises.length ? <TrainingExercisePreview detail={selectedDetail} /> : null}
          <TrainingUpNextCard workout={upNextWorkout} onViewCalendar={() => setSegment("upcoming")} />
        </>
      ) : null}
      {segment === "upcoming" ? (
        <AppCard>
          {data.upcomingWorkouts.length ? (
            data.upcomingWorkouts.map((item, index) => (
              <Fragment key={item.id}>
                <WorkoutListRow workout={item} todayKeyValue={data.date} />
                {index < data.upcomingWorkouts.length - 1 ? <Divider /> : null}
              </Fragment>
            ))
          ) : (
            <EmptyState title="No upcoming workouts" body="Future assignments will show here." icon="calendar-outline" />
          )}
        </AppCard>
      ) : null}
      {segment === "history" ? (
        <AppCard>
          {data.recentWorkouts.length ? (
            data.recentWorkouts.slice(0, 8).reverse().map((item, index) => (
              <Fragment key={item.id}>
                <WorkoutListRow workout={item} todayKeyValue={data.date} />
                {index < Math.min(data.recentWorkouts.length, 8) - 1 ? <Divider /> : null}
              </Fragment>
            ))
          ) : (
            <EmptyState title="No workout history yet" body="Complete a few workouts to build your history." icon="time-outline" />
          )}
        </AppCard>
      ) : null}
    </>
  );
}

function WeeklyCalendarStrip({
  dates,
  selected,
  todayKeyValue,
  workoutsByDate,
  onSelect,
}: {
  dates: string[];
  selected: string;
  todayKeyValue: string;
  workoutsByDate: Map<string, WorkoutAssignmentSummary[]>;
  onSelect: (date: string) => void;
}) {
  return (
    <View style={styles.weekStrip}>
      {dates.map((date, index) => {
        const isSelected = date === selected;
        const isToday = date === todayKeyValue;
        const workouts = workoutsByDate.get(date) ?? [];
        const state = workouts.length ? workoutState(workouts[0], todayKeyValue) : null;
        const dotColor = state?.tone === "success" ? colors.ok : state?.tone === "danger" ? colors.bad : state?.tone === "primary" ? colors.primary : "transparent";
        return (
          <Pressable
            key={date}
            onPress={() => onSelect(date)}
            style={[styles.weekDay, isToday && !isSelected ? styles.weekDayToday : null, isSelected ? styles.weekDaySelected : null]}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.weekDayLabel, isSelected ? styles.weekDayLabelSelected : null]}>{WEEKDAY_SHORT[index]}</Text>
            <Text style={[styles.weekDayNumber, isSelected ? styles.weekDayNumberSelected : null]}>{dayNumber(date)}</Text>
            <View style={[styles.weekDayDot, { backgroundColor: dotColor }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function WorkoutAppBar({ onCalendarPress }: { onCalendarPress: () => void }) {
  return (
    <View style={styles.workoutAppBar}>
      <Text style={styles.workoutScreenTitle}>Training</Text>
      <Pressable onPress={onCalendarPress} style={({ pressed }) => [styles.workoutCalendarButton, pressed ? { opacity: 0.72 } : null]}>
        <Ionicons name="today-outline" size={22} color={colors.ink} />
      </Pressable>
    </View>
  );
}

function TrainingWorkoutHero({
  workout,
  detail,
  detailLoading,
  coachName,
  dateStr,
  todayKeyValue,
}: {
  workout: WorkoutAssignmentSummary;
  detail: WorkoutAssignmentDetail | null;
  detailLoading: boolean;
  coachName: string;
  dateStr: string;
  todayKeyValue: string;
}) {
  const router = useRouter();
  const exerciseCount = detail?.exercises.length ?? workout.exerciseCount ?? 0;
  const completedCount = detail
    ? detail.progress.filter((item) => item.status === "completed" || item.status === "skipped").length
    : workout.completedCount ?? 0;
  const progressPercent = exerciseCount > 0 ? Math.round((completedCount / exerciseCount) * 100) : 0;
  const state = workoutState(workout, todayKeyValue);
  const isToday = dateStr === todayKeyValue;
  const source = detail?.assignedByRole ?? workout.assignedByRole;
  const visual = workoutVisual(workout.name);
  const heroImage = workoutImageSource(visual.asset);
  const note = workoutCoachNote(detail);
  const hasProgress = progressPercent > 0 || workout.status === "in_progress";
  const buttonLabel =
    state.label === "Completed" ? "View Summary" : state.label === "In progress" ? "Continue Workout" : isToday ? "Start Workout" : "View Workout";
  const buttonIcon: keyof typeof Ionicons.glyphMap =
    state.label === "Completed" ? "checkmark-circle-outline" : state.label === "In progress" ? "play-forward-outline" : "play";

  return (
    <AppCard style={styles.trainingHeroCard}>
      <View style={styles.trainingHeroImageWash} />
      <View style={styles.trainingHeroTopLine}>
        <Text style={styles.trainingHeroEyebrow}>{isToday ? "TODAY'S WORKOUT" : `${shortDate(dateStr).toUpperCase()} WORKOUT`}</Text>
        <TrainingStatusBadge label={state.label} tone={state.tone} />
      </View>
      <View style={styles.trainingHeroBody}>
        <View style={styles.trainingHeroCopy}>
          <Text style={styles.trainingHeroTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{workout.name}</Text>
          <Text style={styles.trainingHeroMeta} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.84}>
            {detailLoading
              ? "Loading exercises..."
              : `${workoutTrainingType(workout.name)} · ${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"} · ${workoutDurationEstimate(exerciseCount)}`}
          </Text>
          <View style={styles.trainingAssignedRow}>
            <View style={styles.trainingCoachIcon}>
              <Ionicons name={source === "athlete" ? "person-outline" : "ribbon-outline"} size={18} color={colors.primary} />
            </View>
            <Text style={styles.trainingAssignedText} numberOfLines={1}>
              {source === "athlete" ? "Assigned by you" : `Assigned by ${coachAssignmentDisplay(coachName)}`}
            </Text>
          </View>
        </View>
        <View style={styles.trainingHeroVisual}>
          {heroImage ? <Image source={heroImage} style={styles.trainingHeroImage} resizeMode="contain" /> : <Ionicons name={visual.icon} size={56} color={visual.color} />}
        </View>
      </View>
      {note ? (
        <View style={styles.trainingCoachNote}>
          <Ionicons name="chatbox-outline" size={18} color={colors.primary} />
          <Text style={styles.trainingCoachNoteText} numberOfLines={2}>{note}</Text>
        </View>
      ) : null}
      {hasProgress ? (
        <View style={styles.trainingProgressRow}>
          <ProgressBar value={progressPercent / 100} height={6} style={styles.trainingProgressBar} />
          <Text style={styles.trainingProgressText}>{completedCount} / {exerciseCount}</Text>
        </View>
      ) : null}
      <ActionButton
        label={buttonLabel}
        icon={buttonIcon}
        variant="filled"
        style={styles.trainingHeroButton}
        textStyle={styles.trainingHeroButtonText}
        onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never)}
      />
    </AppCard>
  );
}

function TrainingExercisePreview({ detail }: { detail: WorkoutAssignmentDetail }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const progressByIndex = new Map(detail.progress.map((item) => [item.exerciseIndex, item]));
  const visibleExercises = expanded ? detail.exercises : detail.exercises.slice(0, 3);

  return (
    <AppCard style={styles.trainingPreviewCard}>
      <View style={styles.trainingSectionHeader}>
        <Text style={styles.trainingSectionTitle}>Exercise Preview</Text>
        {detail.exercises.length > 3 ? (
          <Pressable onPress={() => setExpanded((value) => !value)} hitSlop={8} style={styles.trainingSectionAction}>
            <Text style={styles.trainingSectionActionText}>{expanded ? "Show less" : "View all"}</Text>
            <Ionicons name={expanded ? "chevron-up" : "chevron-forward"} size={20} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {visibleExercises.map((exercise, index) => {
        const status = progressByIndex.get(index)?.status ?? "not_started";
        const setsDone = progressByIndex.get(index)?.setsCompleted.length ?? 0;
        const visual = exerciseVisual(exercise.title, exercise.type);
        const value = status === "in_progress" && exercise.sets ? `${setsDone} / ${exercise.sets} sets` : undefined;
        return (
          <Fragment key={`${exercise.title}-${exercise.order}-${index}`}>
            <TrainingExercisePreviewRow
              visual={visual}
              title={exercise.title}
              subtitle={exercisePrescription(exercise)}
              status={status}
              value={value}
              showVideo={status !== "completed" && Boolean(exercise.mediaId)}
              onPress={status !== "completed" ? () => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: detail.id } } as never) : undefined}
            />
            {index < visibleExercises.length - 1 ? <Divider /> : null}
          </Fragment>
        );
      })}
    </AppCard>
  );
}

function TrainingExercisePreviewRow({
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
  status: string;
  value?: string;
  showVideo?: boolean;
  onPress?: () => void;
}) {
  const imageSource = workoutImageSource(visual.asset);
  const completed = status === "completed";
  const inProgress = status === "in_progress";
  const skipped = status === "skipped";

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.trainingExerciseRow, pressed ? { opacity: 0.76 } : null]}
    >
      <View style={[styles.trainingExerciseIcon, imageSource ? styles.trainingExerciseImageShell : null]}>
        {imageSource ? <Image source={imageSource} style={styles.trainingExerciseImage} resizeMode="contain" /> : <Ionicons name={visual.icon} size={25} color={visual.color} />}
      </View>
      <View style={styles.trainingExerciseCopy}>
        <Text style={styles.trainingExerciseTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.trainingExerciseSubtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      {showVideo ? (
        <View style={styles.trainingVideoBadge}>
          <Ionicons name="play" size={11} color={colors.inkMuted} />
        </View>
      ) : null}
      <View style={styles.trainingExerciseRight}>
        {completed ? <WorkoutStatusPill label="Completed" tone="success" icon="checkmark-circle-outline" /> : null}
        {inProgress ? <WorkoutStatusPill label="In progress" tone="primary" /> : null}
        {skipped ? <WorkoutStatusPill label="Skipped" tone="neutral" /> : null}
        {value ? <Text style={styles.workoutSetValue}>{value}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={25} color={colors.ink} /> : null}
    </Pressable>
  );
}

function TrainingUpNextCard({
  workout,
  onViewCalendar,
}: {
  workout: WorkoutAssignmentSummary | null;
  onViewCalendar: () => void;
}) {
  const router = useRouter();
  if (!workout) {
    return (
      <AppCard style={styles.trainingUpNextCard}>
        <View style={styles.trainingSectionHeader}>
          <Text style={styles.trainingSectionTitle}>Up Next</Text>
        </View>
        <Text style={styles.trainingEmptyBody}>No upcoming workout scheduled.</Text>
      </AppCard>
    );
  }
  return (
    <AppCard style={styles.trainingUpNextCard}>
      <View style={styles.trainingUpNextWash} />
      <View style={styles.trainingSectionHeader}>
        <Text style={styles.trainingSectionTitle}>Up Next</Text>
        <Pressable onPress={onViewCalendar} hitSlop={8} style={styles.trainingSectionAction}>
          <Text style={styles.trainingSectionActionText}>View calendar</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </Pressable>
      </View>
      <Pressable
        onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never)}
        style={({ pressed }) => [styles.trainingUpNextRow, pressed ? { opacity: 0.76 } : null]}
      >
        <View style={styles.trainingUpNextIcon}>
          <Ionicons name="calendar-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.trainingUpNextCopy}>
          <Text style={styles.trainingUpNextDate} numberOfLines={1}>{longDate(workout.scheduledDate)}</Text>
          <Text style={styles.trainingUpNextTitle} numberOfLines={1}>{workout.name}</Text>
          <Text style={styles.trainingUpNextMeta} numberOfLines={1}>
            {workout.exerciseCount} exercise{workout.exerciseCount === 1 ? "" : "s"} · {workoutDurationEstimate(workout.exerciseCount)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={25} color={colors.ink} />
      </Pressable>
    </AppCard>
  );
}

function TrainingNoWorkoutCard({ dateStr, todayKeyValue, hasCoach }: { dateStr: string; todayKeyValue: string; hasCoach: boolean }) {
  const title = dateStr === todayKeyValue ? "No training scheduled for today" : "No training scheduled";
  const body = !hasCoach
    ? "Workouts are planned by your coach. Connect with one from the Coach tab to get a schedule here."
    : dateStr < todayKeyValue
      ? "No workout was assigned for this day."
      : "Future assignments will show here when your coach schedules them.";
  return (
    <AppCard style={styles.trainingNoWorkoutCard}>
      <IconTile icon="bed-outline" tone="primary" size={52} />
      <View style={styles.trainingNoWorkoutCopy}>
        <Text style={styles.trainingNoWorkoutTitle}>{title}</Text>
        <Text style={styles.trainingEmptyBody}>{body}</Text>
      </View>
    </AppCard>
  );
}

function TrainingStatusBadge({ label, tone }: { label: string; tone: WorkoutStateTone }) {
  const color = tone === "success" ? colors.ok : tone === "primary" ? colors.primary : tone === "danger" ? colors.bad : colors.inkMuted;
  return (
    <View style={styles.trainingStatusBadge}>
      <View style={[styles.trainingStatusDot, { backgroundColor: color }]} />
      <Text style={[styles.trainingStatusText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained until the older dashboard layout block is fully removed.
function WorkoutHero({
  workout,
  detail,
  detailLoading,
  coachName,
  dateStr,
  todayKeyValue,
}: {
  workout: WorkoutAssignmentSummary;
  detail: WorkoutAssignmentDetail | null;
  detailLoading: boolean;
  coachName: string;
  dateStr: string;
  todayKeyValue: string;
}) {
  const router = useRouter();
  const videoCount = detail?.exercises.filter((exercise) => exercise.mediaId).length ?? 0;
  const exerciseCount = detail?.exercises.length ?? workout.exerciseCount ?? 0;
  const completedCount = detail ? detail.progress.filter((item) => item.status === "completed").length : workout.completedCount ?? 0;
  const progressPercent = exerciseCount > 0 ? Math.round((completedCount / exerciseCount) * 100) : 0;
  const visual = workoutVisual(workout.name);
  const heroImage = workoutImageSource(visual.asset);
  const isToday = dateStr === todayKeyValue;
  const state = workoutState(workout, todayKeyValue);
  const source = detail?.assignedByRole ?? workout.assignedByRole;
  const sourceLabel = source === "athlete" ? "My Workout" : "Coach Assigned";
  const buttonLabel =
    state.label === "Completed" ? "View Summary" : state.label === "In Progress" ? "Continue Workout" : isToday ? "Start Workout" : "View Workout";

  return (
    <AppCard style={styles.workoutHeroCard}>
      <View style={styles.workoutHeroChipsRow}>
        <Text style={styles.workoutTodayChip}>{isToday ? "TODAY" : shortDate(dateStr).toUpperCase()}</Text>
        <StatusChip label={sourceLabel} tone="neutral" icon={source === "athlete" ? "person-outline" : "school-outline"} />
        <StatusChip label={state.label} tone={state.tone} />
      </View>
      <View style={styles.workoutHeroTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroWorkoutTitle}>{workout.name}</Text>
          <Text style={styles.workoutHeroMeta}>
            {detailLoading ? "Loading exercises..." : `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"} · ${estimatedWorkoutDuration(exerciseCount)}`}
          </Text>
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
      {videoCount > 0 ? (
        <View style={styles.videoMetaRow}>
          <View style={styles.videoMetaIcon}>
            <Ionicons name="play" size={12} color={colors.inkMuted} />
          </View>
          <Text style={styles.workoutVideoMeta}>{videoCount} exercise video{videoCount === 1 ? "" : "s"}</Text>
        </View>
      ) : null}
      <ActionButton
        label={buttonLabel}
        variant="filled"
        style={styles.workoutHeroButton}
        textStyle={styles.workoutHeroButtonText}
        onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never)}
      />
    </AppCard>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained until the older dashboard layout block is fully removed.
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
      {detail.exercises.length > 3 ? (
        <Pressable onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: detail.id } } as never)} hitSlop={8}>
          <Text style={[styles.linkText, styles.trailingLink]}>View all {detail.exercises.length} exercises</Text>
        </Pressable>
      ) : null}
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

function WorkoutStatusPill({ label, tone, icon }: { label: string; tone: "success" | "primary" | "neutral"; icon?: keyof typeof Ionicons.glyphMap }) {
  const success = tone === "success";
  const primary = tone === "primary";
  return (
    <View style={[styles.workoutStatusPill, success ? styles.workoutStatusPillSuccess : primary ? styles.workoutStatusPillPrimary : styles.workoutStatusPillNeutral]}>
      {icon ? <Ionicons name={icon} size={12} color={success ? colors.ok : primary ? colors.primary : colors.inkMuted} /> : null}
      <Text style={[styles.workoutStatusPillText, success ? styles.workoutStatusPillTextSuccess : primary ? styles.workoutStatusPillTextPrimary : null]}>{label}</Text>
    </View>
  );
}

function coachAssignmentDisplay(name?: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return "your coach";
  return /^coach\b/i.test(trimmed) ? trimmed : `Coach ${trimmed}`;
}

function workoutTrainingType(name?: string | null): string {
  const text = (name ?? "").toLowerCase();
  if (text.includes("mobility") || text.includes("recovery") || text.includes("stretch")) return "Mobility";
  if (text.includes("cardio") || text.includes("run") || text.includes("conditioning") || text.includes("hiit")) return "Conditioning";
  if (text.includes("power")) return "Power";
  if (text.includes("strength") || text.includes("upper") || text.includes("lower") || text.includes("lift")) return "Strength";
  return "Training";
}

function workoutDurationEstimate(exerciseCount: number): string {
  if (exerciseCount >= 7) return "~55 min";
  if (exerciseCount >= 6) return "~45 min";
  if (exerciseCount >= 4) return "~35 min";
  if (exerciseCount > 0) return "~25 min";
  return "TBD";
}

function workoutCoachNote(detail: WorkoutAssignmentDetail | null): string | null {
  const note = detail?.exercises.find((exercise) => exercise.notes?.trim() || exercise.instructions?.trim());
  return note?.notes?.trim() || note?.instructions?.trim() || null;
}

function exercisePrescription(exercise: WorkoutAssignmentDetail["exercises"][number]): string {
  const parts: string[] = [];
  if (exercise.sets && exercise.reps) parts.push(`${exercise.sets} x ${exercise.reps}`);
  else if (exercise.sets) parts.push(`${exercise.sets} set${exercise.sets === 1 ? "" : "s"}`);
  if (exercise.durationSec) parts.push(formatSecondsLabel(exercise.durationSec));
  if (exercise.restSec) parts.push(`${exercise.restSec} sec rest`);
  return parts.length ? parts.join(" · ") : titleCase(exercise.type.replace("_", " "));
}

function formatSecondsLabel(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} sec`;
}

function WorkoutListRow({ workout, todayKeyValue }: { workout: WorkoutAssignmentSummary; todayKeyValue: string }) {
  const router = useRouter();
  const visual = workoutVisual(workout.name);
  const state = workoutState(workout, todayKeyValue);
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/athlete/active-workout", params: { assignmentId: workout.id } } as never)}
      style={({ pressed }) => [styles.workoutScheduleRow, pressed ? { opacity: 0.78 } : null]}
    >
      <Ionicons name={visual.icon} size={17} color={visual.color} style={styles.workoutCalendarIcon} />
      <Text style={styles.workoutScheduleDay} numberOfLines={1}>{shortDate(workout.scheduledDate)}</Text>
      <Text style={styles.workoutScheduleName} numberOfLines={1}>{workout.name}</Text>
      <StatusChip label={state.label} tone={state.tone} />
      <Ionicons name="chevron-forward" size={24} color={colors.ink} />
    </Pressable>
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function NutritionView({
  data,
  onLogWater,
  loggingWater,
  onUpdateData,
}: {
  data: AthleteDashboardData;
  onLogWater: () => void;
  loggingWater: boolean;
  onUpdateData: (updater: (prev: AthleteDashboardData | null) => AthleteDashboardData | null) => void;
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
  const coachName = data.coaches[0]?.name ?? data.coachProfile?.name ?? "your coach";
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
      const body = (await res.json().catch(() => ({}))) as { error?: string; meal?: Meal };
      if (!res.ok) {
        showError("Couldn't log this meal", "Check your connection and try again.");
        setNutritionMessage("Could not log this planned meal.");
        return;
      }
      setNutritionMessage(`${titleCase(meal.mealType)} logged.`);
      celebrate({ title: `${titleCase(meal.mealType)} logged`, body: "From your coach's plan." });
      // Append the newly-created Meal and roll its macros into the running
      // totals locally — avoids re-running the whole dashboard loader (which
      // includes a 7-day sequential nutrition-history fetch) just to reflect
      // one meal.
      const createdMeal = body.meal;
      if (createdMeal) {
        const addedCalories = mealCalories(createdMeal);
        const addedProtein = createdMeal.foods.reduce((sum, f) => sum + (Number(f.proteinG) || 0), 0);
        const addedCarbs = createdMeal.foods.reduce((sum, f) => sum + (Number(f.carbsG) || 0), 0);
        const addedFat = createdMeal.foods.reduce((sum, f) => sum + (Number(f.fatG) || 0), 0);
        onUpdateData((prev) =>
          prev
            ? {
                ...prev,
                meals: [...prev.meals, createdMeal],
                mealTotals: {
                  calories: (prev.mealTotals?.calories ?? 0) + addedCalories,
                  proteinG: (prev.mealTotals?.proteinG ?? 0) + addedProtein,
                  carbsG: (prev.mealTotals?.carbsG ?? 0) + addedCarbs,
                  fatG: (prev.mealTotals?.fatG ?? 0) + addedFat,
                },
              }
            : prev
        );
      }
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
      const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: MessageView };
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
        <ActionButton label="Log Meal" icon="add-outline" variant="filled" style={styles.nutritionActionButton} onPress={() => router.push("/athlete/log-meal" as never)} />
        <ActionButton label="Scan Food" icon="camera-outline" style={styles.nutritionActionButton} onPress={() => router.push("/athlete/meal-scan" as never)} />
      </View>

      {data.plannedMeals.length ? (
        <AppCard style={styles.coachMealCard}>
          <View style={styles.sectionInline}>
            <View style={styles.rowIconTitle}>
              <IconTile icon="clipboard-outline" size={31} />
              <View>
                <Text style={styles.nutritionCardTitle}>Coach Meal Plan</Text>
                <Text style={styles.muted}>
                  Coach {firstName(coachName, "Coach")} · {plannedCalories > 0 ? `${plannedCalories.toLocaleString()} kcal planned` : shortDate(data.date)}
                </Text>
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
  const mealTypes = ["breakfast", "lunch", "dinner", "snack"];
  return (
    <View style={styles.consumedList}>
      {mealTypes.map((type) => {
        const consumed = meals.find((meal) => meal.mealType === type);
        const planned = type === "snack" ? undefined : plannedMeals.find((meal) => meal.mealType === type);
        const source = consumed ?? planned;
        const dotColor = consumed ? colors.ok : planned ? colors.primary : "#a8b0bd";
        const saving = planned?.id === savingPlannedMealId;
        // A coach-prescribed meal and what the athlete actually ate are never
        // the same data — only show them as equivalent when the logged meal
        // really was confirmed from this plan (Meal.plannedMealId).
        const divergedFromPlan = Boolean(consumed && planned && consumed.plannedMealId !== planned.id);
        return (
          <View key={type} style={styles.consumedMealRow}>
            <View style={[styles.mealDot, { backgroundColor: dotColor }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.nutritionMealTitle}>{titleCase(type)}</Text>
              <Text style={styles.nutritionMealMuted} numberOfLines={1}>{source ? mealName(source) : "Not logged"}</Text>
              {divergedFromPlan ? (
                <Text style={styles.nutritionMealPlannedNote} numberOfLines={1}>Planned: {mealName(planned!)}</Text>
              ) : null}
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

function NutritionViewV2({
  data,
  onLogWater,
  loggingWater,
  onUpdateData,
}: {
  data: AthleteDashboardData;
  onLogWater: (amountMl?: number) => void;
  loggingWater: boolean;
  onUpdateData: (updater: (prev: AthleteDashboardData | null) => AthleteDashboardData | null) => void;
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
  const coachName = data.coaches[0]?.name ?? data.coachProfile?.name ?? "your coach";
  const coachId = data.coaches[0]?.coachId ?? data.subscription?.coachId ?? data.coachProfile?.coachId ?? null;
  const plannedMealRows = orderedMealPlanRows(data.plannedMeals);
  const plannedCalories = data.plannedMeals.reduce((sum, meal) => sum + mealCalories(meal), 0);
  const mealRows = nutritionMealRowsV2(data.meals, data.plannedMeals);

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
      const body = (await res.json().catch(() => ({}))) as { error?: string; meal?: Meal };
      if (!res.ok) {
        showError("Couldn't log this meal", "Check your connection and try again.");
        setNutritionMessage("Could not log this planned meal.");
        return;
      }
      setNutritionMessage(`${titleCase(meal.mealType)} logged.`);
      celebrate({ title: `${titleCase(meal.mealType)} logged`, body: "From your coach's plan." });
      const createdMeal = body.meal;
      if (createdMeal) {
        const addedCalories = mealCalories(createdMeal);
        const addedProtein = createdMeal.foods.reduce((sum, food) => sum + (Number(food.proteinG) || 0), 0);
        const addedCarbs = createdMeal.foods.reduce((sum, food) => sum + (Number(food.carbsG) || 0), 0);
        const addedFat = createdMeal.foods.reduce((sum, food) => sum + (Number(food.fatG) || 0), 0);
        onUpdateData((prev) =>
          prev
            ? {
                ...prev,
                meals: [...prev.meals, createdMeal],
                mealTotals: {
                  calories: (prev.mealTotals?.calories ?? 0) + addedCalories,
                  proteinG: (prev.mealTotals?.proteinG ?? 0) + addedProtein,
                  carbsG: (prev.mealTotals?.carbsG ?? 0) + addedCarbs,
                  fatG: (prev.mealTotals?.fatG ?? 0) + addedFat,
                },
              }
            : prev
        );
      }
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
      const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: MessageView };
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
        <NutritionSummaryCardV2 data={data} target={target} consumed={consumed} />
      ) : (
        <NutritionSetupCardV2 profile={data.profile} onComplete={() => router.push("/account" as never)} />
      )}

      <View style={styles.nutritionActionRowV2}>
        <ActionButton label="Log Meal" icon="add-outline" variant="filled" style={styles.nutritionPrimaryAction} onPress={() => router.push("/athlete/log-meal" as never)} />
        <ActionButton label="Scan Food" icon="camera-outline" style={styles.nutritionPrimaryAction} onPress={() => router.push("/athlete/meal-scan" as never)} />
      </View>

      {nutritionMessage ? <Text style={nutritionMessage.includes("sent") || nutritionMessage.includes("logged") ? styles.successText : styles.errorText}>{nutritionMessage}</Text> : null}

      <TodaysMealsCardV2
        rows={mealRows}
        savingPlannedMealId={savingPlannedMealId}
        onLogPlanned={logPlannedMeal}
        onAddMeal={() => router.push("/athlete/log-meal" as never)}
      />

      <HydrationCardV2 water={data.water} loggingWater={loggingWater} onLogWater={onLogWater} onView={() => router.push("/athlete/water" as never)} />

      {data.plannedMeals.length ? (
        <CoachMealPlanCardV2
          date={data.date}
          coachName={coachName}
          plannedCalories={plannedCalories}
          plannedMeals={plannedMealRows}
          expanded={expandedPlan}
          requestOpen={requestOpen}
          requestText={requestText}
          sendingRequest={sendingRequest}
          onToggleExpanded={() => setExpandedPlan((value) => !value)}
          onToggleRequest={() => setRequestOpen((value) => !value)}
          onRequestTextChange={setRequestText}
          onSendRequest={sendMealPlanRequest}
        />
      ) : null}
    </>
  );
}

function NutritionSummaryCardV2({
  data,
  target,
  consumed,
}: {
  data: AthleteDashboardData;
  target: NonNullable<AthleteDashboardData["target"]>;
  consumed: number;
}) {
  const status = nutritionStatusV2(consumed, target.calories);
  const calorieProgress = progress(consumed, target.calories) ?? 0;
  const caloriePercent = Math.round(calorieProgress * 100);
  const remaining = target.calories - consumed;
  const remainingLabel = remaining >= 0 ? `${remaining.toLocaleString()} kcal left` : `${Math.abs(remaining).toLocaleString()} kcal over`;

  return (
    <AppCard style={styles.nutritionSummaryCard}>
      <View style={styles.nutritionSummaryTop}>
        <View style={styles.nutritionSummaryCopy}>
          <Text style={styles.nutritionEyebrow}>{"TODAY'S NUTRITION"}</Text>
          <View style={styles.nutritionCaloriesRow}>
            <Text style={styles.nutritionCaloriesValue}>{consumed.toLocaleString()}</Text>
            <Text style={styles.nutritionCaloriesTarget}> / {target.calories.toLocaleString()} kcal</Text>
          </View>
        </View>
        <View style={[styles.nutritionStatusPill, { backgroundColor: status.background }]}>
          <View style={[styles.nutritionStatusDot, { backgroundColor: status.dot }]} />
          <Text style={[styles.nutritionStatusText, { color: status.text }]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.nutritionProgressRowV2}>
        <View style={styles.nutritionProgressTrackV2}>
          <ProgressBar value={calorieProgress} color={colors.primary} />
        </View>
        <Text style={styles.nutritionProgressPercent}>{caloriePercent}%</Text>
      </View>
      <Text style={styles.nutritionRemainingText}>{remainingLabel}</Text>

      <View style={styles.nutritionMacroGrid}>
        <MacroTileV2 icon="fitness-outline" label="Protein" value={data.mealTotals?.proteinG ?? 0} target={target.proteinG} color="#f56565" />
        <MacroTileV2 icon="leaf-outline" label="Carbs" value={data.mealTotals?.carbsG ?? 0} target={target.carbsG} color="#f6b63b" />
        <MacroTileV2 icon="water-outline" label="Fat" value={data.mealTotals?.fatG ?? 0} target={target.fatG} color="#25b56b" />
      </View>
    </AppCard>
  );
}

function NutritionSetupCardV2({ profile, onComplete }: { profile: AthleteDashboardData["profile"]; onComplete: () => void }) {
  const missing = missingNutritionInputsV2(profile);
  return (
    <AppCard style={styles.nutritionSetupCard}>
      <View style={styles.nutritionSetupTop}>
        <IconTile icon="calculator-outline" size={30} tone="primary" />
        <View style={styles.nutritionSetupCopy}>
          <Text style={styles.nutritionCardTitle}>Set your nutrition target</Text>
          <Text style={styles.nutritionMealMuted}>Complete your profile to calculate calories and macros.</Text>
        </View>
      </View>
      <View style={styles.nutritionMissingGrid}>
        {missing.slice(0, 4).map((item) => (
          <View key={item} style={styles.nutritionMissingChip}>
            <Text style={styles.nutritionMissingText}>{item}</Text>
          </View>
        ))}
      </View>
      <ActionButton label="Complete Profile" icon="person-outline" variant="filled" onPress={onComplete} />
    </AppCard>
  );
}

function MacroTileV2({
  icon,
  label,
  value,
  target,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  target?: number | null;
  color: string;
}) {
  const macroProgress = progress(value, target) ?? 0;
  const percent = Math.round(macroProgress * 100);
  return (
    <View style={styles.nutritionMacroTile}>
      <View style={[styles.nutritionMacroIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={21} color={color} />
      </View>
      <Text style={styles.nutritionMacroLabel}>{label}</Text>
      <Text style={styles.nutritionMacroValue}>{macroLine(value, target)}</Text>
      <View style={styles.nutritionMacroProgressRow}>
        <View style={styles.nutritionMacroBar}>
          <ProgressBar value={macroProgress} color={color} />
        </View>
        <Text style={styles.nutritionMacroPercent}>{percent}%</Text>
      </View>
    </View>
  );
}

function TodaysMealsCardV2({
  rows,
  savingPlannedMealId,
  onLogPlanned,
  onAddMeal,
}: {
  rows: NutritionMealRowV2[];
  savingPlannedMealId?: string | null;
  onLogPlanned: (meal: PlannedMeal) => void;
  onAddMeal: () => void;
}) {
  return (
    <AppCard style={styles.nutritionMealsCard}>
      <View style={styles.nutritionSectionHeader}>
        <Text style={styles.nutritionSectionTitle}>{"Today's Meals"}</Text>
      </View>
      <NutritionMealListV2 rows={rows} savingPlannedMealId={savingPlannedMealId} onLogPlanned={onLogPlanned} onAddMeal={onAddMeal} />
    </AppCard>
  );
}

function NutritionMealListV2({
  rows,
  savingPlannedMealId,
  onLogPlanned,
  onAddMeal,
}: {
  rows: NutritionMealRowV2[];
  savingPlannedMealId?: string | null;
  onLogPlanned: (meal: PlannedMeal) => void;
  onAddMeal: () => void;
}) {
  return (
    <View style={styles.nutritionMealList}>
      {rows.map((row, index) => {
        const saving = row.plannedMeal?.id === savingPlannedMealId;
        return (
          <Fragment key={row.type}>
            <View style={styles.nutritionMealRowV2}>
              <View style={[styles.nutritionMealIcon, { backgroundColor: row.background }]}>
                <Ionicons name={row.icon} size={24} color={row.color} />
              </View>
              <View style={styles.nutritionMealCopy}>
                <Text style={styles.nutritionMealTitle}>{row.label}</Text>
                <Text style={styles.nutritionMealSubtitle} numberOfLines={2}>{row.subtitle}</Text>
                {row.detail ? <Text style={styles.nutritionMealDetail} numberOfLines={1}>{row.detail}</Text> : null}
              </View>
              {row.status === "logged" ? (
                <View style={styles.nutritionMealRight}>
                  {typeof row.calories === "number" ? <Text style={styles.nutritionMealKcal}>{row.calories.toLocaleString()} kcal</Text> : null}
                  <View style={styles.nutritionLoggedBadge}>
                    <Ionicons name="checkmark" size={13} color="#ffffff" />
                    <Text style={styles.nutritionLoggedText}>Logged</Text>
                  </View>
                </View>
              ) : row.status === "planned" && row.plannedMeal ? (
                <Pressable
                  style={({ pressed }) => [styles.nutritionSmallButton, pressed ? { opacity: 0.8 } : null, saving ? styles.nutritionSmallButtonDisabled : null]}
                  onPress={() => onLogPlanned(row.plannedMeal!)}
                  disabled={saving}
                >
                  <Text style={styles.nutritionSmallButtonText}>{saving ? "Logging" : "Log meal"}</Text>
                </Pressable>
              ) : (
                <Pressable style={({ pressed }) => [styles.nutritionSmallButton, pressed ? { opacity: 0.8 } : null]} onPress={onAddMeal}>
                  <Text style={styles.nutritionSmallButtonText}>Add</Text>
                </Pressable>
              )}
            </View>
            {index < rows.length - 1 ? <Divider /> : null}
          </Fragment>
        );
      })}
    </View>
  );
}

function HydrationCardV2({
  water,
  loggingWater,
  onLogWater,
  onView,
}: {
  water: AthleteDashboardData["water"];
  loggingWater: boolean;
  onLogWater: (amountMl?: number) => void;
  onView: () => void;
}) {
  const totalMl = water?.totalMl ?? 0;
  const goalMl = water?.goalMl ?? 0;
  const waterProgress = progress(totalMl, goalMl) ?? 0;
  const percent = Math.round(waterProgress * 100);
  return (
    <AppCard style={styles.nutritionHydrationCard}>
      <View style={styles.nutritionHydrationTop}>
        <View style={styles.nutritionHydrationIcon}>
          <Ionicons name="water-outline" size={29} color={colors.primary} />
        </View>
        <View style={styles.nutritionHydrationCopy}>
          <Text style={styles.nutritionCardTitle}>Hydration</Text>
          <View style={styles.nutritionHydrationValueRow}>
            <Text style={styles.nutritionHydrationValue}>{(totalMl / 1000).toFixed(1)} / {(goalMl / 1000).toFixed(1)} L</Text>
            <Text style={styles.nutritionHydrationPercent}>{percent}%</Text>
          </View>
          <ProgressBar value={waterProgress} color={colors.primary} />
        </View>
      </View>
      <View style={styles.nutritionHydrationActions}>
        <ActionButton label="+ 250 ml" style={styles.nutritionHydrationButton} onPress={() => onLogWater(250)} disabled={loggingWater} />
        <ActionButton label="+ 500 ml" style={styles.nutritionHydrationButton} onPress={() => onLogWater(500)} disabled={loggingWater} />
        <ActionButton label="View" style={styles.nutritionHydrationButton} onPress={onView} />
      </View>
    </AppCard>
  );
}

function CoachMealPlanCardV2({
  date,
  coachName,
  plannedCalories,
  plannedMeals,
  expanded,
  requestOpen,
  requestText,
  sendingRequest,
  onToggleExpanded,
  onToggleRequest,
  onRequestTextChange,
  onSendRequest,
}: {
  date: string;
  coachName: string;
  plannedCalories: number;
  plannedMeals: PlannedMeal[];
  expanded: boolean;
  requestOpen: boolean;
  requestText: string;
  sendingRequest: boolean;
  onToggleExpanded: () => void;
  onToggleRequest: () => void;
  onRequestTextChange: (value: string) => void;
  onSendRequest: () => void;
}) {
  const visibleMeals = expanded ? plannedMeals : plannedMeals.slice(0, 3);
  const planSummary = `${plannedMeals.length} planned ${plannedMeals.length === 1 ? "meal" : "meals"} today${plannedCalories > 0 ? ` - ${plannedCalories.toLocaleString()} kcal` : ""}.`;
  return (
    <AppCard style={styles.nutritionCoachPlanCard}>
      <View style={styles.nutritionCoachPlanTop}>
        <View style={styles.nutritionCoachIcon}>
          <Ionicons name="clipboard-outline" size={27} color={colors.primary} />
        </View>
        <View style={styles.nutritionCoachCopy}>
          <Text style={styles.nutritionCardTitle}>Coach Meal Plan</Text>
          <Text style={styles.nutritionMealMuted}>Coach {firstName(coachName, "Coach")} planned this for {shortDate(date)}.</Text>
          <Text style={styles.nutritionCoachSummary}>{planSummary}</Text>
        </View>
        <Pressable style={({ pressed }) => [styles.nutritionPlanButton, pressed ? { opacity: 0.78 } : null]} onPress={onToggleExpanded}>
          <Text style={styles.nutritionPlanButtonText}>{expanded ? "Hide" : "View Plan"}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
      </View>
      {expanded ? (
        <View style={styles.nutritionPlanExpanded}>
          {visibleMeals.map((meal, index) => (
            <Fragment key={meal.id}>
              <MealPlanRowV2 meal={meal} />
              {index < visibleMeals.length - 1 ? <Divider /> : null}
            </Fragment>
          ))}
          <View style={styles.nutritionPlanActions}>
            <Pressable style={({ pressed }) => [styles.nutritionPlanTextAction, pressed ? { opacity: 0.75 } : null]} onPress={onToggleRequest}>
              <Ionicons name="create-outline" size={17} color={colors.primary} />
              <Text style={styles.nutritionPlanTextActionLabel}>{requestOpen ? "Close request" : "Request change"}</Text>
            </Pressable>
          </View>
          {requestOpen ? (
            <View style={styles.inlineActionPanel}>
              <TextInput
                value={requestText}
                onChangeText={onRequestTextChange}
                placeholder="Tell your coach what you want changed"
                placeholderTextColor={colors.inkFaint}
                style={styles.inlineTextInput}
                multiline
              />
              <ActionButton
                label={sendingRequest ? "Sending..." : "Send Request"}
                icon="send-outline"
                variant="filled"
                onPress={onSendRequest}
                disabled={sendingRequest}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </AppCard>
  );
}

function MealPlanRowV2({ meal }: { meal: PlannedMeal }) {
  const visual = nutritionMealVisualV2(meal.mealType);
  return (
    <View style={styles.nutritionPlanMealRow}>
      <View style={[styles.nutritionPlanMealIcon, { backgroundColor: visual.background }]}>
        <Ionicons name={visual.icon} size={18} color={visual.color} />
      </View>
      <View style={styles.nutritionMealCopy}>
        <Text style={styles.nutritionMealTitle}>{titleCase(meal.mealType)}</Text>
        <Text style={styles.nutritionMealSubtitle} numberOfLines={1}>{nutritionMealLineV2(meal)}</Text>
      </View>
      <Text style={styles.nutritionMealKcal}>{mealCalories(meal).toLocaleString()} kcal</Text>
    </View>
  );
}

type NutritionMealRowV2 = {
  type: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  background: string;
  subtitle: string;
  detail?: string;
  calories?: number;
  status: "logged" | "planned" | "empty";
  plannedMeal?: PlannedMeal;
};

const NUTRITION_MEAL_TYPES_V2 = ["breakfast", "lunch", "snack", "dinner"];

function nutritionMealRowsV2(meals: Meal[], plannedMeals: PlannedMeal[]): NutritionMealRowV2[] {
  return NUTRITION_MEAL_TYPES_V2.map((type) => {
    const visual = nutritionMealVisualV2(type);
    const loggedMeals = meals.filter((meal) => meal.mealType === type);
    const plannedMeal = plannedMeals.find((meal) => meal.mealType === type);
    const loggedCalories = loggedMeals.reduce((sum, meal) => sum + mealCalories(meal), 0);
    if (loggedMeals.length) {
      const firstMeal = loggedMeals[0];
      const subtitle = loggedMeals.length > 1 ? `${nutritionMealLineV2(firstMeal)} + ${loggedMeals.length - 1} more` : nutritionMealLineV2(firstMeal);
      const detail = plannedMeal && !loggedMeals.some((meal) => meal.plannedMealId === plannedMeal.id) ? `Planned: ${nutritionMealLineV2(plannedMeal)}` : undefined;
      return {
        type,
        label: titleCase(type),
        ...visual,
        subtitle,
        detail,
        calories: loggedCalories,
        status: "logged",
      };
    }
    if (plannedMeal) {
      const plannedCaloriesForMeal = mealCalories(plannedMeal);
      return {
        type,
        label: titleCase(type),
        ...visual,
        subtitle: nutritionMealLineV2(plannedMeal),
        detail: plannedCaloriesForMeal > 0 ? `Coach planned - ${plannedCaloriesForMeal.toLocaleString()} kcal` : "Coach planned",
        calories: plannedCaloriesForMeal,
        status: "planned",
        plannedMeal,
      };
    }
    return {
      type,
      label: titleCase(type),
      ...visual,
      subtitle: "Not logged",
      status: "empty",
    };
  });
}

function nutritionMealVisualV2(type: string): Pick<NutritionMealRowV2, "icon" | "color" | "background"> {
  if (type === "breakfast") return { icon: "sunny-outline", color: "#f5a300", background: "#fff4d9" };
  if (type === "lunch") return { icon: "restaurant-outline", color: colors.primary, background: "#eaf3ff" };
  if (type === "snack") return { icon: "nutrition-outline", color: "#7c3aed", background: "#f1e9ff" };
  if (type === "dinner") return { icon: "moon-outline", color: "#5277d8", background: "#eaf0ff" };
  const visual = mealVisual(type);
  return { icon: visual.icon, color: visual.color, background: `${visual.color}16` };
}

function nutritionMealLineV2(meal: Meal | PlannedMeal) {
  const foodNames = meal.foods.map((food) => food.name).filter(Boolean);
  if (meal.name) return meal.name;
  if (foodNames.length) {
    const visible = foodNames.slice(0, 2).join(", ");
    return foodNames.length > 2 ? `${visible} + ${foodNames.length - 2} more` : visible;
  }
  return titleCase(meal.mealType);
}

function missingNutritionInputsV2(profile: AthleteDashboardData["profile"]) {
  const missing: string[] = [];
  if (!profile?.weightKg) missing.push("Weight");
  if (!profile?.heightCm) missing.push("Height");
  if (!profile?.dob) missing.push("Birthday");
  if (!profile?.activityLevel) missing.push("Activity");
  if (!profile?.fitnessGoal) missing.push("Goal");
  return missing.length ? missing : ["Profile details"];
}

function nutritionStatusV2(consumed: number, targetCalories: number) {
  const ratio = targetCalories > 0 ? consumed / targetCalories : 0;
  if (ratio > 1.05) return { label: "Over target", background: colors.warnSoft, text: colors.warn, dot: colors.warn };
  if (ratio >= 0.7) return { label: "On track", background: colors.okSoft, text: colors.ok, dot: colors.ok };
  if (ratio > 0) return { label: "In progress", background: colors.primarySoft, text: colors.primary, dot: colors.primary };
  return { label: "Ready to log", background: colors.primarySoft, text: colors.primary, dot: colors.primary };
}

type ThreadSummary = {
  partyId: string;
  partyName: string;
  lastMessage: string;
  lastAt: string;
  lastSenderRole: "athlete" | "coach";
  unreadCount: number;
};

function CoachView({
  data,
  onReload,
  onNavigate,
}: {
  data: AthleteDashboardData;
  onReload: () => void;
  onNavigate: (tab: AthleteTab) => void;
}) {
  const router = useRouter();
  const rawCoachName = data.coachProfile?.name || data.coaches[0]?.name || "";
  const coachName = coachDisplayName(rawCoachName, "Your coach");
  const coachId = data.coaches[0]?.coachId ?? data.subscription?.coachId ?? data.coachProfile?.coachId ?? null;
  const subscription = data.subscription;
  const nextSession = nextFutureSession(data.sessions);
  const hasCoach = Boolean(coachId || rawCoachName);
  const [panel, setPanel] = useState<"message" | "membership" | "sessions" | "videos" | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [coachActionMessage, setCoachActionMessage] = useState<string | null>(null);
  const [latestThread, setLatestThread] = useState<ThreadSummary | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageView[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [justEnded, setJustEnded] = useState<{ relationshipId: string; coachName: string } | null>(null);
  const [playingVideo, setPlayingVideo] = useState<CoachVideo | null>(null);
  const latestMessage = useMemo(
    () => latestCoachMessage(threadMessages, latestThread, data.coachComments, coachName),
    [threadMessages, latestThread, data.coachComments, coachName]
  );

  useEffect(() => {
    if (!coachId) {
      setLatestThread(null);
      setThreadMessages([]);
      return;
    }
    let active = true;
    setMessagesLoading(true);
    Promise.allSettled([
      apiJson<{ threads: ThreadSummary[] }>("/api/athlete/messages/threads"),
      apiJson<{ messages: MessageView[]; hasMore: boolean }>(`/api/athlete/messages/${coachId}?limit=30`),
    ])
      .then(([threadsResult, messagesResult]) => {
        if (!active) return;
        setLatestThread(threadsResult.status === "fulfilled" ? threadsResult.value.threads.find((thread) => thread.partyId === coachId) ?? null : null);
        setThreadMessages(messagesResult.status === "fulfilled" ? messagesResult.value.messages ?? [] : []);
      })
      .finally(() => {
        if (active) setMessagesLoading(false);
      });
    return () => {
      active = false;
    };
    // Re-checks every time `data` is replaced (pull-to-refresh, tab
    // revisit) — coachId alone wouldn't change on a refresh, but the
    // message preview should still stay current.
  }, [coachId, data]);

  async function leaveCoach() {
    setLeaving(true);
    setCoachActionMessage(null);
    try {
      const res = await apiFetch("/api/athlete/coach/leave", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { error?: string; relationship?: { id: string } };
      if (!res.ok || !json.relationship) {
        setCoachActionMessage(json.error === "no_active_coach" ? "You don't have an active coach right now." : "Could not leave this coach.");
        return;
      }
      setJustEnded({ relationshipId: json.relationship.id, coachName });
      setPanel(null);
    } catch {
      setCoachActionMessage("Network error while leaving your coach.");
    } finally {
      setLeaving(false);
    }
  }

  function confirmLeaveCoach() {
    Alert.alert(
      `Leave ${coachName}?`,
      PAYMENTS_ENABLED ? "You'll lose access to their workouts, meal plans, and sessions. Any active membership will be cancelled immediately." : "You'll lose access to their workouts, meal plans, and sessions.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave Coach", style: "destructive", onPress: leaveCoach },
      ]
    );
  }


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
      const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: MessageView };
      if (!res.ok) {
        setCoachActionMessage(payload.error === "message_too_long" ? "Message is too long." : "Could not send this message.");
        return;
      }
      setCoachActionMessage("Message sent to your coach.");
      setMessageDraft("");
      if (payload.message) {
        setThreadMessages((current) => [...current, payload.message!]);
        setLatestThread({
          partyId: coachId,
          partyName: coachName,
          lastMessage: payload.message.body,
          lastAt: payload.message.createdAt,
          lastSenderRole: "athlete",
          unreadCount: latestThread?.unreadCount ?? 0,
        });
      }
    } catch {
      setCoachActionMessage("Network failed while sending your message.");
    } finally {
      setSendingMessage(false);
    }
  }

  function openConversation() {
    setPanel((current) => (current === "message" ? null : "message"));
  }

  function openCoachProfile() {
    if (!coachId) return;
    router.push({ pathname: "/athlete/coach-profile/[coachId]", params: { coachId } } as never);
  }

  function confirmSwitchCoach() {
    Alert.alert(
      "Switch coach?",
      "Choosing a new coach can end this active relationship after the new membership is confirmed.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Find Coaches", onPress: () => router.push("/athlete/coach-discovery" as never) },
      ]
    );
  }

  if (justEnded) {
    return <PostLeaveReview relationshipId={justEnded.relationshipId} coachName={justEnded.coachName} onDone={onReload} />;
  }

  return (
    <>
      <PrimaryAppBar title="My Coach" variant="today" />
      {!hasCoach ? (
        <NoCoachState onFindCoach={() => router.push("/athlete/coach-discovery" as never)} />
      ) : (
        <>
          <CoachHeroCard coachId={coachId} name={coachName} profile={data.coachProfile} onMessage={openConversation} onViewProfile={coachId ? openCoachProfile : undefined} />

          {panel === "message" ? (
            <CoachConversationPanel
              coachName={coachName}
              messages={threadMessages}
              loading={messagesLoading}
              draft={messageDraft}
              onDraftChange={setMessageDraft}
              onSend={sendCoachMessage}
              sending={sendingMessage}
            />
          ) : null}

          <NextCoachSessionCard
            session={nextSession}
            sessionCount={data.sessions.length}
            onViewAll={() => setPanel((current) => (current === "sessions" ? null : "sessions"))}
            onBook={
              coachId
                ? () => router.push({ pathname: "/athlete/book-session", params: { coachId, coachName } } as never)
                : undefined
            }
          />

          {panel === "sessions" ? <CoachSessionsPanel sessions={data.sessions} /> : null}

          <LatestCoachMessageCard
            coachName={coachName}
            coachAvatar={data.coachProfile?.avatar}
            coachId={coachId}
            message={latestMessage}
            onReply={openConversation}
          />

          <AthleteProgramCard
            data={data}
            onTraining={() => onNavigate("workouts")}
            onNutrition={() => onNavigate("nutrition")}
            onVideos={() => setPanel((current) => (current === "videos" ? null : "videos"))}
          />

          {panel === "videos" ? <CoachVideosPanel videos={data.videos} onPlay={setPlayingVideo} /> : null}

          {PAYMENTS_ENABLED ? (
          <CoachMembershipCard
            subscription={subscription}
            onPress={() => {
              if (subscription && subscription.status !== "cancelled" && subscription.status !== "expired") {
                setPanel((current) => (current === "membership" ? null : "membership"));
              } else {
                router.push("/athlete/coach-discovery" as never);
              }
            }}
          />

          ) : null}

          {PAYMENTS_ENABLED && panel === "membership" ? <CoachMembershipDetails subscription={subscription} onFindCoach={() => router.push("/athlete/coach-discovery" as never)} /> : null}

          <CoachRelationshipCard leaving={leaving} onSwitch={PAYMENTS_ENABLED ? confirmSwitchCoach : undefined} onLeave={leaving ? undefined : confirmLeaveCoach} />

          {coachActionMessage ? <Text style={coachActionMessage.includes("sent") ? styles.successText : styles.errorText}>{coachActionMessage}</Text> : null}
        </>
      )}
      {playingVideo ? (
        <VideoPlayerModal
          visible
          title={playingVideo.title}
          streamPath={`/api/athlete/coach-videos/${playingVideo.id}/stream`}
          progressPath={`/api/athlete/coach-videos/${playingVideo.id}/progress`}
          onClose={() => setPlayingVideo(null)}
        />
      ) : null}
    </>
  );
}

function CoachHeroCard({
  coachId,
  name,
  profile,
  onMessage,
  onViewProfile,
}: {
  coachId: string | null;
  name: string;
  profile: AthleteDashboardData["coachProfile"];
  onMessage: () => void;
  onViewProfile?: () => void;
}) {
  const title = coachProfessionalTitle(profile);
  const experience = coachExperience(profile);
  const specializations = (profile?.specializations ?? []).filter(Boolean).slice(0, 3);
  return (
    <AppCard style={styles.coachHeroCard}>
      <View style={styles.coachHeroWash} />
      <Ionicons name="barbell-outline" size={37} color="#8aa4d4" style={styles.coachHeroMark} />
      <Text style={styles.coachHeroScribble}>Stronger{"\n"}Every Day</Text>
      <View style={styles.coachHeroIdentity}>
        <Avatar
          avatar={profile?.avatar}
          name={name}
          size={60}
          accentSoft={colors.primarySoft}
          accentStrong={colors.primary}
          photoPath={coachId ? `/api/marketplace/coaches/${coachId}/avatar/file` : undefined}
        />
        <View style={styles.coachHeroCopy}>
          <View style={styles.coachNameLine}>
            <Text style={styles.coachHeroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>{name}</Text>
            {profile?.verifiedStatus === "verified" ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
          </View>
          {title ? <Text style={styles.coachHeroSubtitle} numberOfLines={1}>{title}</Text> : null}
          <Text style={styles.coachHeroRating}>{coachRatingLabel(profile)}</Text>
          {experience ? <Text style={styles.coachHeroSubtitle}>{experience}</Text> : null}
        </View>
      </View>
      {specializations.length ? (
        <View style={styles.coachHeroChips}>
          {specializations.map((item) => (
            <View key={item} style={styles.coachSpecialtyChip}>
              <Text style={styles.coachSpecialtyText} numberOfLines={1}>{titleCase(item)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.coachHeroActions}>
        <ActionButton label="Message" icon="chatbubble-outline" style={styles.coachHeroAction} onPress={onMessage} />
        <ActionButton label="View Profile" icon="person-outline" variant="filled" style={styles.coachHeroAction} onPress={onViewProfile} />
      </View>
    </AppCard>
  );
}

function CoachConversationPanel({
  coachName,
  messages,
  loading,
  draft,
  onDraftChange,
  onSend,
  sending,
}: {
  coachName: string;
  messages: MessageView[];
  loading: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const visible = messages.slice(-4);
  return (
    <AppCard style={styles.coachConversationCard}>
      <Text style={styles.coachCardTitle}>Message {coachName}</Text>
      <View style={styles.coachMessageThread}>
        {loading ? <Text style={styles.coachMutedText}>Loading conversation...</Text> : null}
        {!loading && visible.length === 0 ? <Text style={styles.coachMutedText}>No messages yet. Start the conversation here.</Text> : null}
        {!loading ? visible.map((message) => (
          <View key={message.id} style={[styles.coachBubble, message.mine ? styles.coachBubbleMine : styles.coachBubbleTheirs]}>
            <Text style={[styles.coachBubbleText, message.mine ? styles.coachBubbleTextMine : null]}>
              {message.body || (message.media ? "Shared an image." : "Message")}
            </Text>
            <Text style={[styles.coachBubbleTime, message.mine ? styles.coachBubbleTimeMine : null]}>{relativeTime(message.createdAt)}</Text>
          </View>
        )) : null}
      </View>
      <TextInput
        value={draft}
        onChangeText={onDraftChange}
        placeholder={`Reply to ${coachName}`}
        placeholderTextColor={colors.inkFaint}
        style={styles.coachComposer}
        multiline
      />
      <ActionButton
        label={sending ? "Sending..." : "Send Message"}
        icon="send-outline"
        variant="filled"
        style={styles.coachSendButton}
        onPress={onSend}
        disabled={sending}
      />
    </AppCard>
  );
}

function NextCoachSessionCard({
  session,
  sessionCount,
  onViewAll,
  onBook,
}: {
  session: CoachSession | null;
  sessionCount: number;
  onViewAll: () => void;
  onBook?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const canJoin = session ? canJoinCoachSession(session) : false;

  async function joinSession() {
    if (!session || joining) return;
    setJoining(true);
    setSessionMessage(null);
    try {
      const coachLabel = session.coachName || "your coach";
      const result = await joinSessionCall("athlete", session.id, { withName: coachLabel, title: `Session with ${coachLabel}` });
      if (!result.ok) setSessionMessage(result.message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <AppCard style={styles.nextCoachSessionCard}>
      <CoachSectionHeader title="Next Session" action={sessionCount > 0 ? "View All" : undefined} onAction={sessionCount > 0 ? onViewAll : undefined} />
      {session ? (
        <View style={styles.nextCoachSessionBody}>
          <IconTile icon="calendar-outline" size={56} />
          <View style={styles.nextCoachSessionCopy}>
            <Text style={styles.nextCoachSessionTitle} numberOfLines={1}>{coachSessionDateLine(session)}</Text>
            <Text style={styles.nextCoachSessionMeta} numberOfLines={1}>{coachSessionMeta(session)}</Text>
            <View style={styles.coachCountdownPill}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={styles.coachCountdownText}>{sessionCountdownLabel(session)}</Text>
            </View>
          </View>
          <ActionButton
            label={canJoin ? (joining ? "Opening..." : "Join Session") : "View Session"}
            variant="filled"
            style={styles.nextCoachSessionButton}
            onPress={canJoin ? joinSession : () => setExpanded((value) => !value)}
          />
        </View>
      ) : (
        <View style={styles.nextCoachEmptyBody}>
          <IconTile icon="calendar-outline" size={48} />
          <View style={styles.nextCoachSessionCopy}>
            <Text style={styles.nextCoachSessionTitle}>No upcoming sessions</Text>
            <Text style={styles.nextCoachSessionMeta}>Book a video session with your coach.</Text>
          </View>
        </View>
      )}
      {onBook ? <ActionButton label="Book a Session" icon="calendar-outline" onPress={onBook} /> : null}
      {expanded && session ? (
        <View style={styles.coachSessionDetailBox}>
          <CoachDetailRow label="Status" value={titleCase(session.status)} />
          <CoachDetailRow label="Start" value={new Date(session.scheduledStart).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} />
          <CoachDetailRow label="Duration" value={`${sessionDurationMin(session)} min`} />
          {sessionMessage ? <Text style={styles.sessionMessage}>{sessionMessage}</Text> : null}
        </View>
      ) : sessionMessage ? <Text style={styles.sessionMessage}>{sessionMessage}</Text> : null}
    </AppCard>
  );
}

function LatestCoachMessageCard({
  coachName,
  coachAvatar,
  coachId,
  message,
  onReply,
}: {
  coachName: string;
  coachAvatar?: NonNullable<AthleteDashboardData["coachProfile"]>["avatar"];
  coachId: string | null;
  message: LatestCoachMessage | null;
  onReply: () => void;
}) {
  return (
    <AppCard style={styles.latestCoachMessageCard}>
      <View style={styles.coachMessageHeader}>
        <Text style={styles.coachCardTitle}>Latest Message</Text>
        {message?.at ? <Text style={styles.coachMessageTime}>{relativeTime(message.at)}</Text> : null}
      </View>
      <View style={styles.latestCoachMessageRow}>
        <Avatar
          avatar={coachAvatar}
          name={coachName}
          size={48}
          accentSoft={colors.primarySoft}
          accentStrong={colors.primary}
          photoPath={coachId ? `/api/marketplace/coaches/${coachId}/avatar/file` : undefined}
        />
        <View style={styles.latestCoachMessageCopy}>
          <Text style={styles.latestCoachMessageName}>{message?.senderName ?? coachName}</Text>
          <Text style={styles.latestCoachMessageBody} numberOfLines={3}>
            {message?.body ?? "No coach messages yet."}
          </Text>
          <Pressable onPress={onReply} style={styles.coachReplyButton} hitSlop={8}>
            <Ionicons name="chatbubble-outline" size={17} color={colors.primary} />
            <Text style={styles.replyText}>Reply</Text>
          </Pressable>
        </View>
      </View>
    </AppCard>
  );
}

function AthleteProgramCard({
  data,
  onTraining,
  onNutrition,
  onVideos,
}: {
  data: AthleteDashboardData;
  onTraining: () => void;
  onNutrition: () => void;
  onVideos: () => void;
}) {
  const training = coachTrainingProgramText(data);
  const nutrition = coachNutritionProgramText(data);
  const videoCount = data.videos.length;
  return (
    <AppCard style={styles.coachProgramCard}>
      <Text style={styles.coachCardTitle}>Your Program</Text>
      <CoachProgramRow icon="barbell-outline" tone="primary" title="Training" subtitle={training} onPress={onTraining} />
      <Divider />
      <CoachProgramRow icon="nutrition-outline" tone="success" title="Nutrition" subtitle={nutrition} onPress={onNutrition} />
      <Divider />
      <CoachProgramRow
        icon="play-circle-outline"
        tone="primary"
        title="Coach Videos"
        subtitle={videoCount ? `${videoCount} assigned` : "Nothing assigned yet"}
        onPress={onVideos}
      />
    </AppCard>
  );
}

function CoachProgramRow({
  icon,
  tone,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: "primary" | "success" | "warning" | "danger" | "neutral";
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.coachProgramRow, pressed ? { opacity: 0.74 } : null]}>
      <IconTile icon={icon} tone={tone} size={44} />
      <View style={styles.coachProgramCopy}>
        <Text style={styles.coachProgramTitle}>{title}</Text>
        <Text style={styles.coachProgramSubtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={24} color={colors.ink} />
    </Pressable>
  );
}

function CoachMembershipCard({
  subscription,
  onPress,
}: {
  subscription: AthleteDashboardData["subscription"];
  onPress: () => void;
}) {
  const display = membershipDisplay(subscription);
  return (
    <AppCard style={styles.coachMembershipCard}>
      <IconTile icon="ribbon-outline" size={48} />
      <View style={styles.coachMembershipCopy}>
        <Text style={styles.coachMembershipLabel}>Membership</Text>
        <Text style={styles.coachMembershipTitle} numberOfLines={1}>{display.title}</Text>
        {display.subtitle ? <Text style={styles.coachMembershipSubtitle} numberOfLines={1}>{display.subtitle}</Text> : null}
      </View>
      <ActionButton label={display.cta} style={styles.coachMembershipButton} onPress={onPress} />
    </AppCard>
  );
}

function CoachMembershipDetails({ subscription, onFindCoach }: { subscription: AthleteDashboardData["subscription"]; onFindCoach: () => void }) {
  const services = subscription?.pricingPlanSnapshot?.includedServices ?? [];
  return (
    <AppCard style={styles.inlineActionPanel}>
      <Text style={styles.coachCardTitle}>Membership Details</Text>
      <Text style={styles.coachMutedText}>Status: {subscription ? titleCase(subscription.status) : "No active subscription"}</Text>
      {subscription?.currentPeriodEnd ? <Text style={styles.coachMutedText}>Current period ends {shortDate(subscription.currentPeriodEnd.slice(0, 10))}</Text> : null}
      {services.length ? (
        <View style={styles.coachHeroChips}>
          {services.slice(0, 4).map((service) => <StatusChip key={service} label={titleCase(service)} tone="neutral" />)}
        </View>
      ) : null}
      <ActionButton label="Find / Change Coach" icon="search-outline" onPress={onFindCoach} />
    </AppCard>
  );
}

function CoachRelationshipCard({ leaving, onSwitch, onLeave }: { leaving: boolean; onSwitch?: () => void; onLeave?: () => void }) {
  return (
    <AppCard style={styles.coachRelationshipCard}>
      <Text style={styles.coachCardTitle}>Coach Relationship</Text>
      {onSwitch ? (
        <>
          <CoachRelationshipRow icon="swap-horizontal-outline" label="Switch Coach" onPress={onSwitch} />
          <Divider />
        </>
      ) : null}
      <CoachRelationshipRow icon="person-remove-outline" label="Leave Coach" value={leaving ? "Leaving..." : undefined} onPress={onLeave} danger />
    </AppCard>
  );
}

function CoachRelationshipRow({
  icon,
  label,
  value,
  danger,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.coachRelationshipRow, pressed ? { opacity: 0.74 } : null]}>
      <View style={[styles.coachRelationshipIcon, danger ? styles.coachRelationshipIconDanger : null]}>
        <Ionicons name={icon} size={21} color={danger ? colors.bad : colors.inkMuted} />
      </View>
      <Text style={[styles.coachRelationshipLabel, danger ? styles.coachRelationshipLabelDanger : null]}>{label}</Text>
      {value ? <Text style={styles.coachRelationshipValue}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={22} color={colors.ink} /> : null}
    </Pressable>
  );
}

function CoachSessionsPanel({ sessions }: { sessions: CoachSession[] }) {
  return (
    <AppCard style={styles.inlineActionPanel}>
      <Text style={styles.coachCardTitle}>Sessions</Text>
      {sessions.length ? sessions.map((session, index) => (
        <Fragment key={session.id}>
          <RowLink icon="calendar-outline" title={titleCase(session.type)} subtitle={sessionClock(session)} value={titleCase(session.status)} />
          {index < sessions.length - 1 ? <Divider /> : null}
        </Fragment>
      )) : <Text style={styles.coachMutedText}>No sessions are scheduled yet.</Text>}
    </AppCard>
  );
}

function CoachVideosPanel({ videos, onPlay }: { videos: CoachVideo[]; onPlay: (video: CoachVideo) => void }) {
  return (
    <AppCard style={styles.inlineActionPanel}>
      <Text style={styles.coachCardTitle}>Coach Videos</Text>
      {videos.length ? videos.map((video, index) => (
        <Fragment key={video.id}>
          <RowLink icon="play-circle-outline" title={video.title} subtitle={titleCase(video.category)} value={formatDuration(video.durationSec) ?? undefined} onPress={() => onPlay(video)} />
          {index < videos.length - 1 ? <Divider /> : null}
        </Fragment>
      )) : <Text style={styles.coachMutedText}>No videos are assigned yet.</Text>}
    </AppCard>
  );
}

function athleteHasCoach(data: AthleteDashboardData): boolean {
  return Boolean(data.coachProfile || data.coaches.length);
}

function NoCoachState({ onFindCoach }: { onFindCoach: () => void }) {
  const { user } = useAuth();
  return (
    <AppCard style={styles.noCoachCard}>
      <IconTile icon="people-outline" size={58} />
      <Text style={styles.noCoachTitle}>You don&apos;t have a coach yet</Text>
      <Text style={styles.noCoachBody}>Connect with a coach to unlock personalized training, nutrition planning, and direct feedback.</Text>
      <View style={styles.noCoachBenefits}>
        <CoachBenefit icon="barbell-outline" label="Personalized training" />
        <CoachBenefit icon="nutrition-outline" label="Nutrition plan" />
        <CoachBenefit icon="chatbubble-outline" label="Direct feedback" />
      </View>
      {PAYMENTS_ENABLED ? null : (
        <Text style={styles.noCoachBody}>
          {`Already have a coach? Share your account email${user?.email ? ` (${user.email})` : ""} with them so they can add you.`}
        </Text>
      )}
      <ActionButton label="Find a Coach" icon="search-outline" variant="filled" style={styles.noCoachButton} onPress={onFindCoach} />
    </AppCard>
  );
}

function CoachBenefit({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.noCoachBenefitRow}>
      <Ionicons name={icon} size={17} color={colors.primary} />
      <Text style={styles.noCoachBenefitText}>{label}</Text>
    </View>
  );
}

function CoachSectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.coachSectionHeader}>
      <Text style={styles.coachCardTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} disabled={!onAction} style={styles.coachSectionAction} hitSlop={8}>
          <Text style={styles.coachSectionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function CoachDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.coachDetailRow}>
      <Text style={styles.sessionDetailLabel}>{label}</Text>
      <Text style={styles.sessionDetailValue}>{value}</Text>
    </View>
  );
}

type LatestCoachMessage = { body: string; at: string | null; senderName: string; source: "direct" | "feedback" };

function latestCoachMessage(
  messages: MessageView[],
  thread: ThreadSummary | null,
  comments: AthleteDashboardData["coachComments"],
  coachName: string
): LatestCoachMessage | null {
  const direct = [...messages].reverse().find((message) => message.senderRole === "coach");
  if (direct) {
    return {
      body: direct.body || (direct.media ? "Shared an image." : "Message"),
      at: direct.createdAt,
      senderName: coachName,
      source: "direct",
    };
  }
  if (thread?.lastSenderRole === "coach") {
    return { body: thread.lastMessage || "Message", at: thread.lastAt, senderName: coachName, source: "direct" };
  }
  const comment = comments[0] ?? null;
  if (comment) {
    return { body: comment.body, at: comment.createdAt ?? comment.date, senderName: coachName, source: "feedback" };
  }
  return null;
}

function coachDisplayName(name?: string | null, fallback = "Coach"): string {
  const trimmed = (name ?? "").trim();
  return trimmed || fallback;
}

function coachProfessionalTitle(profile: AthleteDashboardData["coachProfile"]): string | null {
  const type = profile?.coachingTypes?.find(Boolean);
  if (type) return titleCase(type);
  const specialization = profile?.specializations?.find(Boolean);
  return specialization ? titleCase(specialization) : null;
}

function coachRatingLabel(profile: AthleteDashboardData["coachProfile"]): string {
  const reviews = profile?.reviewCount ?? 0;
  const reviewText = `${reviews} review${reviews === 1 ? "" : "s"}`;
  return profile?.avgRating ? `${profile.avgRating.toFixed(1)} rating - ${reviewText}` : `No rating yet - ${reviewText}`;
}

function coachExperience(profile: AthleteDashboardData["coachProfile"]): string | null {
  const years = profile?.yearsExperience;
  if (!years || years <= 0) return null;
  return `${years} year${years === 1 ? "" : "s"} experience`;
}

function coachTrainingProgramText(data: AthleteDashboardData): string {
  const assignments = [...data.workouts, ...data.upcomingWorkouts];
  const count = assignments.length;
  if (!count) return "No workouts assigned";
  const name = data.workouts[0]?.name ?? data.upcomingWorkouts[0]?.name ?? "Training";
  return `${name} - ${count} workout${count === 1 ? "" : "s"} scheduled`;
}

function coachNutritionProgramText(data: AthleteDashboardData): string {
  const count = data.plannedMeals.length;
  if (!count) return "No active meal plan";
  const first = data.plannedMeals[0]?.name;
  return `${first ? `${first} - ` : ""}${count} meal${count === 1 ? "" : "s"} today`;
}

function membershipDisplay(subscription: AthleteDashboardData["subscription"]) {
  if (!subscription || subscription.status === "cancelled" || subscription.status === "expired") {
    return { title: "No active plan", subtitle: subscription ? titleCase(subscription.status) : null, cta: "View Plans" };
  }
  const plan = subscription.pricingPlanSnapshot;
  const price = plan ? `${formatCurrency(plan.monthlyPrice, plan.currency)} / month` : null;
  const period = subscription.currentPeriodEnd
    ? `${subscription.cancelAtPeriodEnd ? "Ends" : "Renews"} ${shortDate(subscription.currentPeriodEnd.slice(0, 10))}`
    : titleCase(subscription.status);
  const statusLabel =
    subscription.status === "payment_failed" || subscription.status === "payment_due"
      ? "Payment needs attention"
      : subscription.status === "pending"
        ? "Activation pending"
        : period;
  return {
    title: plan?.name ?? titleCase(subscription.status),
    subtitle: [price, statusLabel].filter(Boolean).join(" - "),
    cta: "Manage",
  };
}

function coachSessionDateLine(session: CoachSession): string {
  const start = new Date(session.scheduledStart);
  return `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} - ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function coachSessionMeta(session: CoachSession): string {
  return `${titleCase(session.type) || "Video Coaching"} - ${sessionDurationMin(session)} min`;
}

function sessionDurationMin(session: CoachSession): number {
  return Math.max(0, Math.round((new Date(session.scheduledEnd).getTime() - new Date(session.scheduledStart).getTime()) / 60000));
}

function sessionCountdownLabel(session: CoachSession): string {
  const diffMs = new Date(session.scheduledStart).getTime() - Date.now();
  if (diffMs <= 0) return "In progress";
  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `Starts in ${hours} hr`;
  const days = Math.ceil(hours / 24);
  return `Starts in ${days} day${days === 1 ? "" : "s"}`;
}

function canJoinCoachSession(session: CoachSession): boolean {
  if (session.status !== "confirmed" && session.status !== "rescheduled") return false;
  const now = Date.now();
  const start = new Date(session.scheduledStart).getTime();
  const end = new Date(session.scheduledEnd).getTime();
  return now >= start - 10 * 60_000 && now <= end + 15 * 60_000;
}

const REVIEW_SUB_RATING_KEYS = ["trainingQuality", "communication", "knowledge", "responsiveness", "valueForMoney"] as const;
const REVIEW_SUB_RATING_LABELS: Record<(typeof REVIEW_SUB_RATING_KEYS)[number], string> = {
  trainingQuality: "Training Quality",
  communication: "Communication",
  knowledge: "Knowledge",
  responsiveness: "Responsiveness",
  valueForMoney: "Value for Money",
};

/** Shown right after a relationship ends — the only point in the app where the "reviewable only once ended" rule (server/src/services/coachReview.ts) is naturally satisfiable. */
function PostLeaveReview({ relationshipId, coachName, onDone }: { relationshipId: string; coachName: string; onDone: () => void }) {
  const router = useRouter();
  const [overallRating, setOverallRating] = useState(0);
  const [subRatings, setSubRatings] = useState<Record<string, number>>({});
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submitReview() {
    if (overallRating < 1) {
      setMessage("Pick an overall rating before submitting.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/athlete/coach-reviews", {
        method: "POST",
        body: JSON.stringify({
          relationshipId,
          overallRating,
          subRatings: Object.keys(subRatings).length ? subRatings : undefined,
          body: body.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(json.error === "already_reviewed" ? "You've already reviewed this coach." : "Could not submit your review.");
        return;
      }
      setSubmitted(true);
    } catch {
      setMessage("Network error while submitting your review.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PrimaryAppBar title="My Coach" />
      <AppCard>
        <Text style={styles.cardTitle}>You&apos;ve left {coachName}</Text>
        <Text style={styles.muted}>Your membership has been cancelled. You can find a new coach any time.</Text>
      </AppCard>

      <AppCard>
        {submitted ? (
          <>
            <Text style={styles.cardTitle}>Thanks for your feedback</Text>
            <Text style={styles.muted}>Your review of {coachName} has been submitted.</Text>
          </>
        ) : (
          <>
            <Text style={styles.cardTitle}>Rate your experience</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable key={value} onPress={() => setOverallRating(value)} hitSlop={6}>
                  <Ionicons name={value <= overallRating ? "star" : "star-outline"} size={32} color={colors.warn} />
                </Pressable>
              ))}
            </View>
            {REVIEW_SUB_RATING_KEYS.map((key) => (
              <View key={key} style={styles.subRatingRow}>
                <Text style={styles.subRatingLabel}>{REVIEW_SUB_RATING_LABELS[key]}</Text>
                <View style={styles.starRowSmall}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Pressable key={value} onPress={() => setSubRatings((current) => ({ ...current, [key]: value }))} hitSlop={4}>
                      <Ionicons name={value <= (subRatings[key] ?? 0) ? "star" : "star-outline"} size={18} color={colors.warn} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Share more about your experience (optional)"
              placeholderTextColor={colors.inkFaint}
              style={styles.inlineTextInput}
              multiline
            />
            {message ? <Text style={styles.errorText}>{message}</Text> : null}
            <ActionButton label={saving ? "Submitting..." : "Submit Review"} variant="filled" onPress={submitReview} disabled={saving} />
          </>
        )}
      </AppCard>

      <View style={styles.actionRow}>
        <ActionButton label={submitted ? "Done" : "Skip"} onPress={onDone} />
        <ActionButton
          label="Find a New Coach"
          variant="filled"
          onPress={() => {
            onDone();
            router.push("/athlete/coach-discovery" as never);
          }}
        />
      </View>
    </>
  );
}

type ProgressCategory = "training" | "body" | "nutrition" | "recovery";
type ProgressRange = "7D" | "4W" | "3M";
type ProgressTone = "primary" | "success" | "warning" | "danger" | "neutral";

function ProgressView({ data, onNavigate }: { data: AthleteDashboardData; onNavigate: (tab: AthleteTab) => void }) {
  const router = useRouter();
  const [range, setRange] = useState<ProgressRange>("4W");
  const [rangeTrends, setRangeTrends] = useState<TrendPoint[] | null>(null);
  const [rangeWorkouts, setRangeWorkouts] = useState<WorkoutAssignmentSummary[] | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [category, setCategory] = useState<ProgressCategory>("training");

  useEffect(() => {
    if (range === "4W") {
      setRangeTrends(null);
      setRangeWorkouts(null);
      setRangeLoading(false);
      return;
    }
    let active = true;
    const days = rangeToDays(range);
    const from = addDays(todayKey(), -(days - 1));
    const to = todayKey();
    setRangeLoading(true);
    Promise.all([
      apiJson<{ series: TrendPoint[] }>(`/api/athlete/trends?days=${days}`),
      apiJson<{ assignments: WorkoutAssignmentSummary[] }>(`/api/athlete/workout-assignments?from=${from}&to=${to}`),
    ])
      .then(([trendResult, workoutResult]) => {
        if (!active) return;
        setRangeTrends(trendResult.series ?? []);
        setRangeWorkouts(workoutResult.assignments ?? []);
      })
      .catch(() => {
        if (!active) return;
        setRangeTrends(null);
        setRangeWorkouts(null);
      })
      .finally(() => {
        if (active) setRangeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range]);

  const rangeDays = rangeToDays(range);
  const rangeStart = addDays(todayKey(), -(rangeDays - 1));
  const trendsForRange = progressRangeTrends(range === "4W" ? data.trends : rangeTrends ?? data.trends, rangeStart, todayKey());
  const fallbackWorkouts = dedupeWorkouts([...data.recentWorkouts, ...data.workouts]);
  const workoutsForRange = progressRangeWorkouts(range === "4W" ? fallbackWorkouts : rangeWorkouts ?? fallbackWorkouts, rangeStart, todayKey());
  const weekly = buildWeeklyProgress(data);
  const training = buildTrainingProgress(workoutsForRange, trendsForRange, range, data);
  const nutrition = buildNutritionProgress(data);
  const recovery = buildRecoveryProgress(data, trendsForRange);
  const body = buildBodyProgress(data);
  const summary = buildProgressSummary(training, nutrition, recovery);
  const rangeLabel = progressRangeLabel(range);

  return (
    <>
      <ProgressHeader onCalendar={() => router.push("/athlete/trends" as never)} />
      <ProgressRangeTabs value={range} onChange={setRange} />

      <ProgressSummaryCard
        label={rangeLabel.toUpperCase()}
        summary={summary}
        training={training}
        nutrition={nutrition}
        recovery={recovery}
        onSelectCategory={setCategory}
      />

      <ProgressWeeklyCard weekly={weekly} />

      <ProgressCategoryTabs value={category} onChange={setCategory} />

      <ProgressDetailCard
        category={category}
        rangeLabel={rangeLabel}
        loading={rangeLoading}
        training={training}
        body={body}
        nutrition={nutrition}
        recovery={recovery}
      />

      <ProgressFeedbackCard
        comments={data.coachComments}
        onOpen={data.coachComments.length ? () => onNavigate("coach") : undefined}
      />
    </>
  );
}

function ProgressHeader({ onCalendar }: { onCalendar: () => void }) {
  return (
    <PrimaryAppBar
      title="Progress"
      subtitle="Track your performance and see your growth."
      showNotifications={false}
      showAvatar={false}
      rightIcon="calendar-outline"
      onRightPress={onCalendar}
    />
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

function ProgressRangeTabs({ value, onChange }: { value: ProgressRange; onChange: (value: ProgressRange) => void }) {
  return (
    <View style={styles.progressRangeTabs}>
      {(["7D", "4W", "3M"] as const).map((item) => {
        const active = value === item;
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            style={({ pressed }) => [styles.progressRangeTab, active ? styles.progressRangeTabActive : null, pressed ? { opacity: 0.75 } : null]}
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

const PROGRESS_CATEGORIES: { key: ProgressCategory; label: string }[] = [
  { key: "training", label: "Training" },
  { key: "body", label: "Body" },
  { key: "nutrition", label: "Nutrition" },
  { key: "recovery", label: "Recovery" },
];

function ProgressCategoryTabs({ value, onChange }: { value: ProgressCategory; onChange: (value: ProgressCategory) => void }) {
  return (
    <View style={styles.progressCategoryTabs}>
      {PROGRESS_CATEGORIES.map((item) => {
        const active = value === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.progressCategoryTab, active ? styles.progressCategoryTabActive : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.progressCategoryText, active ? styles.progressCategoryTextActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ProgressSummaryCard({
  label,
  summary,
  training,
  nutrition,
  recovery,
  onSelectCategory,
}: {
  label: string;
  summary: ProgressSummaryModel;
  training: TrainingProgressModel;
  nutrition: NutritionProgressModel;
  recovery: RecoveryProgressModel;
  onSelectCategory: (category: ProgressCategory) => void;
}) {
  return (
    <AppCard style={styles.progressHeroCard}>
      <View style={styles.progressHeroArt} pointerEvents="none">
        <ProgressHeroTrend values={summary.trendValues} tone={summary.badgeTone} />
      </View>
      <View style={styles.progressHeroTop}>
        <View style={styles.progressHeroCopy}>
          <Text style={styles.progressOverline}>{label}</Text>
          <Text style={styles.progressHeroTitle}>{summary.headline}</Text>
          <Text style={styles.progressHeroBody} numberOfLines={2}>{summary.body}</Text>
        </View>
        {summary.badge ? (
          <View style={[styles.progressHeroBadge, toneSoftStyle(summary.badgeTone)]}>
            <Ionicons name={summary.badgeIcon} size={16} color={toneColor(summary.badgeTone)} />
            <Text style={[styles.progressHeroBadgeText, { color: toneColor(summary.badgeTone) }]}>{summary.badge}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.progressSummaryGrid}>
        <ProgressSummaryMetric icon="barbell-outline" title="Consistency" value={formatPercent(training.consistency)} tone={training.consistencyTone} onPress={() => onSelectCategory("training")} />
        <ProgressSummaryMetric icon="bar-chart-outline" title="Readiness" value={recovery.readinessDelta == null ? "No trend" : `${formatSigned(recovery.readinessDelta)} pts`} tone={recovery.readinessDelta == null ? "neutral" : recovery.readinessDelta >= 0 ? "success" : "warning"} onPress={() => onSelectCategory("recovery")} />
        <ProgressSummaryMetric icon="nutrition-outline" title="Days Logged" value={formatPercent(nutrition.loggedDayRate)} tone={nutrition.loggedDayTone} onPress={() => onSelectCategory("nutrition")} />
        <ProgressSummaryMetric icon="heart-outline" title="Recovery" value={recovery.currentLabel} tone={recovery.currentTone} onPress={() => onSelectCategory("recovery")} />
      </View>
      <View style={styles.progressInsightLine}>
        <Ionicons name="bulb-outline" size={20} color={colors.primary} />
        <Text style={styles.progressInsightLineText} numberOfLines={2}>{summary.insight}</Text>
      </View>
    </AppCard>
  );
}

function ProgressSummaryMetric({ icon, title, value, tone, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; value: string; tone: ProgressTone; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.progressSummaryMetric, pressed ? { opacity: 0.75 } : null]}>
      <IconTile icon={icon} tone={tone} size={30} />
      <View style={styles.progressSummaryMetricCopy}>
        <Text style={styles.progressSummaryMetricTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{title}</Text>
        <Text style={[styles.progressSummaryMetricValue, { color: toneColor(tone) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.inkFaint} />
    </Pressable>
  );
}

function ProgressHeroTrend({ values, tone }: { values: number[]; tone: ProgressTone }) {
  const chartValues = sampleSeries(values, 5);
  const max = Math.max(1, ...chartValues);
  const points = chartValues.map((value, index) => ({ x: 18 + (index / Math.max(1, chartValues.length - 1)) * 106, y: 14 + (1 - value / max) * 48 }));
  const linePath = points.length ? points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ") : "";
  return (
    <Svg width={142} height={84} viewBox="0 0 142 84">
      <Path d="M2 78 C34 44 50 42 67 51 C84 60 91 16 140 8 L140 84 L2 84 Z" fill="#eaf3ff" />
      {points.map((point, index) => (
        <Path
          key={`bar-${index}`}
          d={`M${point.x - 6} 76 L${point.x - 6} ${Math.min(72, point.y + 12)} Q${point.x - 6} ${point.y + 5} ${point.x + 1} ${point.y + 5} Q${point.x + 8} ${point.y + 5} ${point.x + 8} ${Math.min(72, point.y + 12)} L${point.x + 8} 76 Z`}
          fill="#9bc5ff"
          opacity={index === points.length - 1 ? 1 : 0.72}
        />
      ))}
      {linePath ? <Path d={linePath} stroke={toneColor(tone)} strokeWidth="2.4" fill="none" strokeLinecap="round" /> : null}
    </Svg>
  );
}

function ProgressWeeklyCard({ weekly }: { weekly: WeeklyProgressModel }) {
  return (
    <AppCard style={styles.progressWeekCard}>
      <Text style={styles.progressOverline}>THIS WEEK</Text>
      <View style={styles.progressWeekGrid}>
        <View style={styles.progressWeekVerticalDivider} />
        <View style={styles.progressWeekHorizontalDivider} />
        <ProgressWeekMetric icon="barbell-outline" title="Training" value={`${weekly.workoutDone} / ${weekly.workoutTotal} complete`} progress={weekly.workoutRate} tone="primary" />
        <ProgressWeekMetric icon="nutrition-outline" title="Nutrition" value={`${weekly.nutritionDone} / ${weekly.nutritionTotal} days`} progress={weekly.nutritionRate} tone="success" />
        <ProgressWeekMetric icon="checkbox-outline" title="Check-ins" value={`${weekly.checkInDone} / ${weekly.checkInTotal} days`} progress={weekly.checkInRate} tone="primary" />
        <ProgressWeekMetric icon="heart-outline" title="Recovery" value={weekly.recoveryLabel} tone={weekly.recoveryTone} />
      </View>
    </AppCard>
  );
}

function ProgressWeekMetric({
  icon,
  title,
  value,
  progress,
  tone = "primary",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  progress?: number | null;
  tone?: ProgressTone;
}) {
  return (
    <View style={styles.progressWeekMetric}>
      <IconTile icon={icon} tone={tone} size={32} />
      <View style={styles.progressWeekCopy}>
        <Text style={styles.progressMetricTitle}>{title}</Text>
        <Text style={[styles.progressMetricValue, { color: progress == null ? toneColor(tone) : colors.ink }]} numberOfLines={1}>{value}</Text>
        {progress != null ? <ProgressTinyBar value={progress} color={toneColor(tone)} /> : null}
      </View>
    </View>
  );
}

function ProgressDetailCard({
  category,
  rangeLabel,
  loading,
  training,
  body,
  nutrition,
  recovery,
}: {
  category: ProgressCategory;
  rangeLabel: string;
  loading: boolean;
  training: TrainingProgressModel;
  body: BodyProgressModel;
  nutrition: NutritionProgressModel;
  recovery: RecoveryProgressModel;
}) {
  if (category === "body") return <BodyProgressCard body={body} />;
  if (category === "nutrition") return <NutritionProgressCard nutrition={nutrition} />;
  if (category === "recovery") return <RecoveryProgressCard recovery={recovery} rangeLabel={rangeLabel} loading={loading} />;
  return <TrainingProgressCard training={training} rangeLabel={rangeLabel} loading={loading} />;
}

function ProgressDetailHeader({ title, subtitle, rangeLabel, loading }: { title: string; subtitle: string; rangeLabel?: string; loading?: boolean }) {
  return (
    <View style={styles.progressDetailHeader}>
      <View style={styles.progressDetailHeaderCopy}>
        <Text style={styles.progressDetailTitle}>{title}</Text>
        <Text style={styles.progressDetailSubtitle}>{subtitle}</Text>
      </View>
      {rangeLabel ? (
        <View style={styles.progressRangePill}>
          <Text style={styles.progressRangePillText}>{loading ? "Updating..." : rangeLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.inkMuted} />
        </View>
      ) : null}
    </View>
  );
}

function TrainingProgressCard({ training, rangeLabel, loading }: { training: TrainingProgressModel; rangeLabel: string; loading: boolean }) {
  return (
    <AppCard style={styles.progressDetailCard}>
      <ProgressDetailHeader title="Training" subtitle={`Your training over the ${rangeLabel.toLowerCase()}.`} rangeLabel={rangeLabel} loading={loading} />
      <View style={styles.progressPrimaryChartRow}>
        <View style={styles.progressPrimaryMetric}>
          <IconTile icon="barbell-outline" tone="primary" size={44} />
          <Text style={styles.progressPrimaryLabel}>Workout consistency</Text>
          <Text style={[styles.progressPrimaryValue, { color: toneColor(training.consistencyTone) }]}>{formatPercent(training.consistency)}</Text>
        </View>
        <View style={styles.progressDetailChartPane}>
          <ProgressLineChart values={training.consistencySeries} yLabels={[100, 50, 0]} xLabels={training.seriesLabels} min={0} max={100} height={92} compact emptyLabel="No workout trend yet" />
        </View>
      </View>
      <View style={styles.progressDetailMetricGrid}>
        <ProgressDetailMetric icon="list-outline" tone="neutral" label="Workouts" value={String(training.total)} sub="scheduled" />
        {training.latestRpe != null ? <ProgressDetailMetric icon="speedometer-outline" tone="neutral" label="Latest RPE" value={training.latestRpe.toFixed(1)} sub="last logged" /> : null}
        <ProgressDetailMetric
            icon="flame-outline"
            tone="warning"
            label="Streak"
            value={training.streak.current ? `${training.streak.current} day${training.streak.current === 1 ? "" : "s"}` : "Start today"}
            sub={training.streak.longest ? `longest: ${training.streak.longest} day${training.streak.longest === 1 ? "" : "s"}` : "Check in to begin"}
          />
        {training.loadDeltaPct != null ? (
          <ProgressDetailMetric icon="trending-up-outline" tone={training.loadDeltaPct >= 0 ? "success" : "warning"} label="Training Load" value={`${formatSigned(training.loadDeltaPct)}%`} sub="vs. earlier period" />
        ) : training.avgLoad != null ? (
          <ProgressDetailMetric icon="bar-chart-outline" tone="neutral" label="Avg Load" value={String(Math.round(training.avgLoad))} sub="per logged day" />
        ) : null}
      </View>
    </AppCard>
  );
}

function BodyProgressCard({ body }: { body: BodyProgressModel }) {
  const router = useRouter();
  return (
    <AppCard style={styles.progressDetailCard}>
      <ProgressDetailHeader title="Body" subtitle="Your current body metrics from profile data." />
      {body.currentWeight == null && body.targetWeight == null ? (
        <>
          <Text style={styles.progressEmptyText}>No body metrics are saved yet.</Text>
          <ActionButton label="Update Profile" icon="person-outline" variant="filled" style={styles.progressInlineButton} onPress={() => router.push("/account" as never)} />
        </>
      ) : (
        <View style={styles.progressDetailMetricGrid}>
          {body.currentWeight != null ? <ProgressDetailMetric icon="scale-outline" tone="primary" label="Current Weight" value={body.currentWeight.toFixed(1)} sub="kg" /> : null}
          {body.targetWeight != null ? <ProgressDetailMetric icon="flag-outline" tone="success" label="Goal Weight" value={body.targetWeight.toFixed(1)} sub="kg" /> : null}
          {body.goalGap != null ? <ProgressDetailMetric icon={body.goalGap === 0 ? "checkmark-circle-outline" : body.goalGap > 0 ? "trending-down-outline" : "trending-up-outline"} tone={body.goalGap === 0 ? "success" : "warning"} label="Goal Gap" value={body.goalGap === 0 ? "On goal" : `${Math.abs(body.goalGap).toFixed(1)} kg`} sub={body.goalGap > 0 ? "to lose" : body.goalGap < 0 ? "to gain" : "maintained"} /> : null}
          {body.heightCm != null ? <ProgressDetailMetric icon="body-outline" tone="neutral" label="Height" value={String(Math.round(body.heightCm))} sub="cm" /> : null}
        </View>
      )}
    </AppCard>
  );
}

function NutritionProgressCard({ nutrition }: { nutrition: NutritionProgressModel }) {
  return (
    <AppCard style={styles.progressDetailCard}>
      <ProgressDetailHeader title="Nutrition" subtitle="Your nutrition consistency from logged meals." />
      <View style={styles.progressPrimaryChartRow}>
        <View style={styles.progressPrimaryMetric}>
          <IconTile icon="nutrition-outline" tone="success" size={44} />
          <Text style={styles.progressPrimaryLabel}>Logged days</Text>
          <Text style={[styles.progressPrimaryValue, { color: toneColor(nutrition.loggedDayTone) }]}>{`${nutrition.loggedDays} / ${nutrition.totalDays}`}</Text>
        </View>
        <View style={styles.progressDetailChartPane}>
          <ProgressBarTrendChart values={nutrition.calorieSeries} labels={nutrition.dayLabels} target={nutrition.targetCalories} />
        </View>
      </View>
      <View style={styles.progressDetailMetricGrid}>
        <ProgressDetailMetric icon="calendar-outline" tone="success" label="Adherence" value={formatPercent(nutrition.loggedDayRate)} sub="days logged" />
        {nutrition.avgCalories != null ? <ProgressDetailMetric icon="flame-outline" tone="warning" label="Avg Calories" value={String(Math.round(nutrition.avgCalories))} sub="kcal/day" /> : null}
        {nutrition.calorieAdherence != null ? <ProgressDetailMetric icon="pie-chart-outline" tone="primary" label="Today Calories" value={formatPercent(nutrition.calorieAdherence)} sub="vs target" /> : null}
        {nutrition.proteinAdherence != null ? <ProgressDetailMetric icon="fitness-outline" tone="success" label="Protein" value={formatPercent(nutrition.proteinAdherence)} sub="today target" /> : null}
      </View>
    </AppCard>
  );
}

function RecoveryProgressCard({ recovery, rangeLabel, loading }: { recovery: RecoveryProgressModel; rangeLabel: string; loading: boolean }) {
  return (
    <AppCard style={styles.progressDetailCard}>
      <ProgressDetailHeader title="Recovery" subtitle={`Your recovery trend over the ${rangeLabel.toLowerCase()}.`} rangeLabel={rangeLabel} loading={loading} />
      <View style={styles.progressPrimaryChartRow}>
        <View style={styles.progressPrimaryMetric}>
          <IconTile icon="heart-outline" tone={recovery.currentTone} size={44} />
          <Text style={styles.progressPrimaryLabel}>Avg readiness</Text>
          <Text style={[styles.progressPrimaryValue, { color: toneColor(recovery.avgReadinessTone) }]}>{recovery.avgReadiness == null ? "--" : String(Math.round(recovery.avgReadiness))}</Text>
        </View>
        <View style={styles.progressDetailChartPane}>
          <ProgressLineChart values={recovery.readinessSeries} yLabels={[100, 50, 0]} xLabels={recovery.seriesLabels} min={0} max={100} height={92} compact emptyLabel="No recovery trend yet" />
        </View>
      </View>
      <View style={styles.progressDetailMetricGrid}>
        <ProgressDetailMetric icon="heart-outline" tone={recovery.currentTone} label="Current" value={recovery.currentLabel} sub="latest readiness" />
        <ProgressDetailMetric icon="alert-circle-outline" tone={recovery.lowDays > 0 ? "danger" : "success"} label="Low Days" value={String(recovery.lowDays)} sub="under 60" />
        {recovery.avgSleep != null ? <ProgressDetailMetric icon="moon-outline" tone="neutral" label="Avg Sleep" value={recovery.avgSleep.toFixed(1)} sub="hours" /> : null}
        {recovery.readinessDelta != null ? <ProgressDetailMetric icon="trending-up-outline" tone={recovery.readinessDelta >= 0 ? "success" : "warning"} label="Readiness" value={`${formatSigned(recovery.readinessDelta)} pts`} sub="range change" /> : null}
      </View>
    </AppCard>
  );
}

function ProgressDetailMetric({ icon, tone, label, value, sub }: { icon: keyof typeof Ionicons.glyphMap; tone: ProgressTone; label: string; value: string; sub?: string }) {
  return (
    <View style={styles.progressDetailMetric}>
      <IconTile icon={icon} tone={tone} size={40} />
      <View style={styles.progressDetailMetricCopy}>
        <Text style={styles.progressDetailMetricLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.progressDetailMetricValue} numberOfLines={1}>{value}</Text>
        {sub ? <Text style={styles.progressDetailMetricSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </View>
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
          <SvgText key={`x-${label}-${index}`} x={x} y={height - 4} fontSize={compact ? 7.2 : 8.5} fill={colors.inkMuted} textAnchor={index === 0 ? "start" : index === xLabels.length - 1 ? "end" : "middle"}>
            {label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

function ProgressBarTrendChart({ values, labels, target }: { values: number[]; labels: string[]; target?: number | null }) {
  const maxValue = Math.max(1, target ?? 0, ...values);
  if (!values.some((value) => value > 0)) {
    return (
      <View style={styles.progressEmptyChart}>
        <Text style={styles.progressEmptyChartText}>No meal logs yet</Text>
      </View>
    );
  }
  return (
    <View style={styles.progressBarTrend}>
      {values.map((value, index) => {
        const fillHeight = `${Math.max(8, Math.min(100, Math.round((value / maxValue) * 100)))}%` as `${number}%`;
        return (
          <View key={`${labels[index]}-${index}`} style={styles.progressBarTrendColumn}>
            <View style={styles.progressBarTrendTrack}>
              <View style={[styles.progressBarTrendFill, { height: fillHeight }]} />
            </View>
            <Text style={styles.progressBarTrendLabel}>{labels[index]}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ProgressFeedbackCard({ comments, onOpen }: { comments: AthleteDashboardData["coachComments"]; onOpen?: () => void }) {
  const latest = comments[0] ?? null;
  return (
    <Pressable disabled={!onOpen} onPress={onOpen} style={({ pressed }) => [styles.feedbackProgressCard, pressed ? { opacity: 0.76 } : null]}>
      <IconTile icon="chatbubble-ellipses-outline" tone="neutral" size={48} />
      <View style={styles.feedbackProgressCopy}>
        <Text style={styles.progressCardTitle}>Coach Feedback</Text>
        {latest ? (
          <>
            <Text style={styles.feedbackProgressText} numberOfLines={2}>{latest.body}</Text>
            <Text style={styles.feedbackProgressMeta}>{relativeTime(latest.createdAt ?? latest.date)}</Text>
          </>
        ) : (
          <>
            <Text style={styles.feedbackProgressText}>No feedback this period.</Text>
            <Text style={styles.feedbackProgressMeta}>Your coach will leave feedback here when available.</Text>
          </>
        )}
      </View>
      {onOpen ? <Ionicons name="chevron-forward" size={22} color={colors.ink} /> : null}
    </Pressable>
  );
}

function ProgressTinyBar({ value, color }: { value: number; color: string }) {
  return (
    <View style={styles.progressTinyTrack}>
      <View style={[styles.progressTinyFill, { width: `${Math.max(4, Math.min(100, Math.round(value * 100)))}%`, backgroundColor: color }]} />
    </View>
  );
}

type WeeklyProgressModel = {
  workoutDone: number;
  workoutTotal: number;
  workoutRate: number | null;
  nutritionDone: number;
  nutritionTotal: number;
  nutritionRate: number | null;
  checkInDone: number;
  checkInTotal: number;
  checkInRate: number | null;
  recoveryLabel: string;
  recoveryTone: ProgressTone;
};

type TrainingProgressModel = {
  total: number;
  completed: number;
  consistency: number | null;
  consistencyTone: ProgressTone;
  consistencySeries: number[];
  seriesLabels: string[];
  streak: { current: number; longest: number };
  avgLoad: number | null;
  loadDeltaPct: number | null;
  latestRpe: number | null;
};

type NutritionProgressModel = {
  loggedDays: number;
  totalDays: number;
  loggedDayRate: number | null;
  loggedDayTone: ProgressTone;
  calorieSeries: number[];
  dayLabels: string[];
  avgCalories: number | null;
  targetCalories: number | null;
  calorieAdherence: number | null;
  proteinAdherence: number | null;
};

type RecoveryProgressModel = {
  currentScore: number | null;
  currentLabel: string;
  currentTone: ProgressTone;
  avgReadiness: number | null;
  avgReadinessTone: ProgressTone;
  readinessDelta: number | null;
  readinessSeries: number[];
  seriesLabels: string[];
  lowDays: number;
  avgSleep: number | null;
};

type BodyProgressModel = {
  currentWeight: number | null;
  targetWeight: number | null;
  goalGap: number | null;
  heightCm: number | null;
};

type ProgressSummaryModel = {
  headline: string;
  body: string;
  insight: string;
  badge: string | null;
  badgeIcon: keyof typeof Ionicons.glyphMap;
  badgeTone: ProgressTone;
  trendValues: number[];
};

function joinedDay(data: AthleteDashboardData): string | null {
  return localDayOf(data.profile?.createdAt);
}

function buildWeeklyProgress(data: AthleteDashboardData): WeeklyProgressModel {
  // Count only days the athlete has had an account: a first day is "1 / 1",
  // not "1 / 7".
  const today = todayKey();
  const joined = joinedDay(data);
  const weekStart = windowStart(today, joined, 7);
  const days = eligibleDays(today, joined, 7);
  const workouts = dedupeWorkouts([...data.recentWorkouts, ...data.workouts]).filter((item) => workoutDateKey(item) >= weekStart);
  const workoutDone = workouts.filter(isWorkoutCompleted).length;
  const nutritionDone = data.nutritionWeek.filter((day) => day.date >= weekStart && day.loggedMeals > 0).length;
  const checkInDone = data.trends.filter((point) => point.date >= weekStart && point.readiness != null).length;
  const currentScore = data.daily?.readinessScore ?? data.daily?.recovery?.score ?? null;
  return {
    workoutDone,
    workoutTotal: workouts.length,
    workoutRate: workouts.length ? workoutDone / workouts.length : null,
    nutritionDone,
    nutritionTotal: days,
    nutritionRate: nutritionDone / days,
    checkInDone,
    checkInTotal: days,
    checkInRate: checkInDone / days,
    recoveryLabel: readinessLabel(currentScore),
    recoveryTone: progressToneFromReadiness(currentScore),
  };
}

function buildTrainingProgress(workouts: WorkoutAssignmentSummary[], trends: TrendPoint[], range: ProgressRange, data: AthleteDashboardData): TrainingProgressModel {
  const total = workouts.length;
  const completed = workouts.filter(isWorkoutCompleted).length;
  const consistency = total ? completed / total : null;
  const loads = finiteValues(trends.map((point) => point.load));
  return {
    total,
    completed,
    consistency,
    consistencyTone: judgeRate(consistency, total),
    ...buildWorkoutConsistencySeries(workouts, range),
    streak: buildCheckInStreak(trends),
    avgLoad: average(loads),
    loadDeltaPct: percentDeltaBetweenHalves(loads),
    latestRpe: latestRpeValue(data),
  };
}

function buildNutritionProgress(data: AthleteDashboardData): NutritionProgressModel {
  const start = windowStart(todayKey(), joinedDay(data), Math.max(1, data.nutritionWeek.length || 7));
  const week = data.nutritionWeek.filter((day) => day.date >= start);
  const loggedDays = week.filter((day) => day.loggedMeals > 0).length;
  const totalDays = Math.max(1, week.length);
  const loggedDayRate = loggedDays / totalDays;
  const calories = data.nutritionWeek.map((day) => Math.round(day.calories ?? 0));
  const loggedCalories = calories.filter((value) => value > 0);
  return {
    loggedDays,
    totalDays,
    loggedDayRate,
    loggedDayTone: judgeRate(loggedDayRate, totalDays),
    calorieSeries: calories,
    dayLabels: data.nutritionWeek.map((day) => weekdayShort(day.date)),
    avgCalories: loggedCalories.length ? average(loggedCalories) : null,
    targetCalories: data.target?.calories ?? null,
    calorieAdherence: progress(data.mealTotals?.calories ?? 0, data.target?.calories),
    proteinAdherence: progress(data.mealTotals?.proteinG ?? 0, data.target?.proteinG),
  };
}

function buildRecoveryProgress(data: AthleteDashboardData, trends: TrendPoint[]): RecoveryProgressModel {
  const readinessValues = finiteValues(trends.map((point) => point.readiness));
  const currentScore = data.daily?.readinessScore ?? data.daily?.recovery?.score ?? latestNumber(readinessValues);
  const avgReadiness = average(readinessValues);
  const sleepValues = finiteValues(trends.map((point) => point.sleepHours));
  const readinessSeries = sampleSeries(readinessValues, Math.min(7, Math.max(4, readinessValues.length))).map((value) => Math.round(value));
  return {
    currentScore,
    currentLabel: readinessLabel(currentScore),
    currentTone: progressToneFromReadiness(currentScore),
    avgReadiness,
    avgReadinessTone: progressToneFromReadiness(avgReadiness),
    readinessDelta: pointDelta(readinessValues),
    readinessSeries,
    seriesLabels: buildTrendLabels(readinessSeries.length),
    lowDays: readinessValues.filter((value) => value < 60).length,
    avgSleep: average(sleepValues),
  };
}

function buildBodyProgress(data: AthleteDashboardData): BodyProgressModel {
  const currentWeight = data.profile?.weightKg != null ? roundOne(data.profile.weightKg) : null;
  const targetWeight = data.profile?.targetWeightKg != null ? roundOne(data.profile.targetWeightKg) : null;
  return {
    currentWeight,
    targetWeight,
    goalGap: currentWeight != null && targetWeight != null ? roundOne(currentWeight - targetWeight) : null,
    heightCm: data.profile?.heightCm ?? null,
  };
}

function buildProgressSummary(training: TrainingProgressModel, nutrition: NutritionProgressModel, recovery: RecoveryProgressModel): ProgressSummaryModel {
  const hasData = training.total > 0 || nutrition.loggedDays > 0 || recovery.avgReadiness != null;
  const recoveryProblem = recovery.currentTone === "danger" || recovery.lowDays >= 2;
  const trainingStrong = training.consistency != null && training.consistency >= 0.8;
  const nutritionStrong = nutrition.loggedDayRate != null && nutrition.loggedDayRate >= 0.7;
  const readinessDown = recovery.readinessDelta != null && recovery.readinessDelta <= -8;
  let headline = "More data needed";
  if (hasData) {
    if (recoveryProblem || readinessDown || (training.consistency != null && training.consistency < 0.5)) headline = "Needs attention";
    else if (trainingStrong && nutritionStrong && (recovery.readinessDelta == null || recovery.readinessDelta >= 0)) headline = "Strong progress";
    else if ((trainingStrong || nutritionStrong || (recovery.readinessDelta != null && recovery.readinessDelta >= 5)) && !recoveryProblem) headline = "Steady progress";
    else headline = "Mixed progress";
  }
  const body =
    headline === "Strong progress"
      ? "Consistency is building and the trend is moving in the right direction."
      : headline === "Steady progress"
        ? "You are building a base. Keep the routine predictable."
        : headline === "Needs attention"
          ? "Recovery or consistency needs attention before pushing harder."
          : headline === "Mixed progress"
            ? "Some areas are moving well while others need a steadier rhythm."
            : "Complete workouts, check-ins, and meals to unlock clear progress trends.";
  const trainingInsight =
    training.consistency == null
      ? "Add workout history for training insight."
      : training.consistency >= 0.8
        ? "Training is consistent."
        : "Training consistency needs attention.";
  const recoveryInsight =
    recovery.currentTone === "danger" || recovery.currentTone === "warning"
      ? "Recovery needs attention."
      : recovery.currentScore != null
        ? "Recovery is holding steady."
        : "Add check-ins for recovery insight.";
  const badge =
    recovery.readinessDelta != null
      ? `${formatSigned(recovery.readinessDelta)} pts`
      : training.consistency != null
        ? formatPercent(training.consistency)
        : null;
  return {
    headline,
    body,
    insight: `${trainingInsight} ${recoveryInsight}`,
    badge,
    badgeIcon: recovery.readinessDelta != null && recovery.readinessDelta < 0 ? "arrow-down-outline" : "arrow-up-outline",
    badgeTone: recovery.readinessDelta == null ? training.consistencyTone : recovery.readinessDelta >= 0 ? "success" : "warning",
    trendValues: recovery.readinessSeries.length ? recovery.readinessSeries : training.consistencySeries,
  };
}

function buildWorkoutConsistencySeries(workouts: WorkoutAssignmentSummary[], range: ProgressRange) {
  const bucketCount = range === "7D" ? 7 : range === "3M" ? 6 : 4;
  const days = rangeToDays(range);
  const start = addDays(todayKey(), -(days - 1));
  const buckets = Array.from({ length: bucketCount }, () => ({ total: 0, complete: 0 }));
  for (const workout of workouts) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((daysBetween(start, workoutDateKey(workout)) / Math.max(1, days)) * bucketCount)));
    buckets[index].total += 1;
    if (isWorkoutCompleted(workout)) buckets[index].complete += 1;
  }
  return {
    consistencySeries: buckets.map((bucket) => (bucket.total ? Math.round((bucket.complete / bucket.total) * 100) : 0)),
    seriesLabels: range === "7D" ? ["D1", "D2", "D3", "D4", "D5", "D6", "D7"] : range === "3M" ? ["W1", "W3", "W5", "W7", "W9", "W12"] : ["W1", "W2", "W3", "W4"],
  };
}

function progressRangeTrends(trends: TrendPoint[], from: string, to: string): TrendPoint[] {
  return trends.filter((point) => point.date >= from && point.date <= to);
}

function progressRangeWorkouts(workouts: WorkoutAssignmentSummary[], from: string, to: string): WorkoutAssignmentSummary[] {
  return dedupeWorkouts(workouts).filter((workout) => {
    const date = workoutDateKey(workout);
    return date >= from && date <= to;
  });
}

function dedupeWorkouts(workouts: WorkoutAssignmentSummary[]): WorkoutAssignmentSummary[] {
  const byId = new Map<string, WorkoutAssignmentSummary>();
  for (const workout of workouts) byId.set(workout.id, workout);
  return Array.from(byId.values()).sort((a, b) => workoutDateKey(a).localeCompare(workoutDateKey(b)));
}

function workoutDateKey(workout: WorkoutAssignmentSummary): string {
  return workout.scheduledDate.slice(0, 10);
}

function isWorkoutCompleted(workout: WorkoutAssignmentSummary): boolean {
  return workout.status.toLowerCase() === "completed";
}

function finiteValues(values: (number | null | undefined)[]): number[] {
  return values.filter((value): value is number => Number.isFinite(Number(value)));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latestNumber(values: number[]): number | null {
  return values.length ? values[values.length - 1] : null;
}

function pointDelta(values: number[]): number | null {
  if (values.length < 2) return null;
  return Math.round(values[values.length - 1] - values[0]);
}

function percentDeltaBetweenHalves(values: number[]): number | null {
  if (values.length < 2) return null;
  const midpoint = Math.max(1, Math.floor(values.length / 2));
  const previous = average(values.slice(0, midpoint));
  const current = average(values.slice(midpoint));
  if (!previous || current == null) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function latestRpeValue(data: AthleteDashboardData): number | null {
  const direct = data.daily?.rpe?.rpe;
  const entries = Object.values(data.daily?.rpeEntries ?? {}).map((entry) => entry?.rpe).filter((value): value is number => Number.isFinite(Number(value)));
  return entries[entries.length - 1] ?? (Number.isFinite(Number(direct)) ? direct ?? null : null);
}

function progressToneFromReadiness(score: number | null | undefined): ProgressTone {
  if (score == null) return "neutral";
  if (score >= 75) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

function toneColor(tone: ProgressTone): string {
  if (tone === "success") return colors.ok;
  if (tone === "warning") return colors.warn;
  if (tone === "danger") return colors.bad;
  if (tone === "primary") return colors.primary;
  return colors.inkMuted;
}

function toneSoftStyle(tone: ProgressTone) {
  if (tone === "success") return { backgroundColor: colors.okSoft };
  if (tone === "warning") return { backgroundColor: colors.warnSoft };
  if (tone === "danger") return { backgroundColor: colors.badSoft };
  if (tone === "primary") return { backgroundColor: colors.primarySoft };
  return { backgroundColor: colors.surfaceInset };
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "--";
  return `${Math.round(value * 100)}%`;
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function progressRangeLabel(range: ProgressRange): string {
  if (range === "7D") return "Last 7 days";
  if (range === "3M") return "Last 3 months";
  return "Last 4 weeks";
}

function buildTrendLabels(length: number): string[] {
  if (length <= 3) return ["Start", "Mid", "Now"];
  if (length <= 5) return ["Start", "", "", "", "Now"].slice(0, length);
  return ["Start", "", "", "", "", "Now"];
}

function weekdayShort(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date.slice(5);
  return parsed.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function Divider({ vertical }: { vertical?: boolean }) {
  return <View style={vertical ? styles.verticalDivider : styles.divider} />;
}

const styles = StyleSheet.create({
  partialNote: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: -4 },
  cardTitle: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  rowTitle: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  rowValue: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  linkText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  disabledLinkText: { color: colors.inkFaint },
  successText: { color: colors.ok, fontSize: 12, lineHeight: 16, fontWeight: "800", textAlign: "center" },
  errorText: { color: colors.bad, fontSize: 12, lineHeight: 16, fontWeight: "800", textAlign: "center" },
  inlineActionPanel: { gap: 9 },
  starRow: { flexDirection: "row", gap: 8, marginVertical: 8 },
  starRowSmall: { flexDirection: "row", gap: 4 },
  subRatingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  subRatingLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
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
  bigInline: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  todayScreenContent: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 136, gap: 7 },
  readinessStrip: {
    minHeight: 62,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#dbe3ef",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    shadowColor: "#0f172a",
    shadowOpacity: 0.035,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  readinessIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  readinessCopy: { flex: 1, minWidth: 0, gap: 3 },
  readinessTitleLine: { flexDirection: "row", alignItems: "baseline", gap: 7, flexWrap: "wrap" },
  readinessTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  readinessValue: { fontSize: 15, lineHeight: 19, fontWeight: "900" },
  readinessBody: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  nextWorkoutCard: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, overflow: "hidden" },
  nextWorkoutTop: { minHeight: 74, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  nextWorkoutIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  nextWorkoutCopy: { flex: 1, minWidth: 0, paddingTop: 2 },
  nextWorkoutEyebrow: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900", letterSpacing: 0.4 },
  nextWorkoutTitle: { color: colors.ink, fontSize: 17, lineHeight: 21, fontWeight: "900", marginTop: 2 },
  nextWorkoutMeta: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600", marginTop: 1 },
  nextWorkoutNoteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5, paddingRight: 4 },
  nextWorkoutNote: { flex: 1, minWidth: 0, color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  nextWorkoutArt: { width: 62, height: 50, alignItems: "center", justifyContent: "center", marginRight: -6, marginTop: 3, opacity: 0.72 },
  nextWorkoutImage: { width: 58, height: 50 },
  nextWorkoutButton: { flex: 0, minHeight: 38, borderRadius: 10 },
  nextWorkoutButtonDisabled: { backgroundColor: colors.surfaceInset, borderColor: colors.lineStrong },
  nextWorkoutButtonText: { fontSize: 14, lineHeight: 18 },
  todaySectionHeader: { minHeight: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 },
  todaySectionTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  todaySectionAction: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 24 },
  todaySectionActionText: { color: colors.primary, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  scheduleCard: { paddingHorizontal: 12, paddingVertical: 10 },
  scheduleRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 1 },
  timelineCell: { width: 20, alignSelf: "stretch", alignItems: "center", justifyContent: "center", position: "relative" },
  timelineLine: { position: "absolute", width: 2, backgroundColor: "#dce4ee", borderRadius: 1 },
  timelineLineTop: { top: -4, bottom: "50%" },
  timelineLineBottom: { top: "50%", bottom: -4 },
  timelineDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.lineStrong, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", zIndex: 2 },
  timelineDotActive: { borderColor: colors.primary },
  timelineDotDone: { backgroundColor: colors.ok, borderColor: colors.ok },
  scheduleIconBubble: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceInset, alignItems: "center", justifyContent: "center" },
  scheduleCopy: { flex: 1, minWidth: 0 },
  scheduleTitle: { color: colors.ink, fontSize: 12.5, lineHeight: 15, fontWeight: "900" },
  scheduleSubtitle: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600", marginTop: 1 },
  scheduleRight: { minWidth: 88, maxWidth: 122, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  schedulePill: { minHeight: 22, borderRadius: 11, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  schedulePillText: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  scheduleValuePill: { minHeight: 22, borderRadius: 11, backgroundColor: colors.primarySoft, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  scheduleValueText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  dailyStatusCard: { paddingHorizontal: 12, paddingVertical: 8 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusMetric: { width: "48%", minHeight: 56, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fbfdff", padding: 6, flexDirection: "row", alignItems: "center", gap: 7 },
  statusMetricIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  statusMetricCopy: { flex: 1, minWidth: 0 },
  statusLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  statusValue: { fontSize: 17, lineHeight: 20, fontWeight: "900", marginTop: 0 },
  statusSub: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 0 },
  coachUpdateCard: { paddingHorizontal: 13, paddingVertical: 9, gap: 8 },
  coachUpdateRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  coachUpdateAvatarWrap: { position: "relative" },
  coachUnreadDot: { position: "absolute", right: -1, top: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: "#ffffff" },
  coachUpdateCopy: { flex: 1, minWidth: 0 },
  coachUpdateTitleRow: { minHeight: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  coachUpdateTitle: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  coachUpdateTime: { color: colors.inkFaint, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  coachUpdateBody: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "500", marginTop: 3 },
  replyButton: { alignSelf: "flex-start", minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  replyText: { color: colors.primary, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  tomorrowRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 9, paddingTop: 8 },
  tomorrowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceInset, alignItems: "center", justifyContent: "center" },
  tomorrowText: { flex: 1, color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  tomorrowStrong: { color: colors.ink, fontWeight: "900" },
  messageRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 6 },
  messageTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  messageBody: { color: colors.ink, fontSize: 12, lineHeight: 16, marginTop: 1 },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  sessionActions: { width: 112 },
  sessionDetail: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  sessionDetailRow: { minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sessionDetailLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  sessionDetailValue: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  sessionMessage: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, textAlign: "center" },
  workoutsScreenContent: { paddingTop: 30, paddingBottom: 128, gap: 8 },
  progressScreenContent: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 170, gap: 10 },
  nutritionScreenContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 154, gap: 10 },
  coachScreenContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 164, gap: 10 },
  workoutAppBar: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  workoutScreenTitle: {
    marginTop: 12,
    color: colors.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: 0,
  },
  workoutCalendarButton: {
    marginTop: 9,
    height: 36,
    width: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  trainingHeroCard: { minHeight: 208, paddingHorizontal: 13, paddingVertical: 12, overflow: "hidden", position: "relative" },
  trainingHeroImageWash: { position: "absolute", right: -14, bottom: -8, width: 142, height: 126, borderTopLeftRadius: 88, backgroundColor: "#eef5ff" },
  trainingHeroTopLine: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 5 },
  trainingHeroEyebrow: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900", letterSpacing: 1.1 },
  trainingStatusBadge: { minHeight: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  trainingStatusDot: { width: 8, height: 8, borderRadius: 4 },
  trainingStatusText: { fontSize: 12, lineHeight: 15, fontWeight: "900" },
  trainingHeroBody: { minHeight: 78, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  trainingHeroCopy: { flex: 1, minWidth: 0, zIndex: 1 },
  trainingHeroTitle: { color: colors.ink, fontSize: 23, lineHeight: 28, fontWeight: "900", letterSpacing: 0, marginTop: 1 },
  trainingHeroMeta: { color: colors.inkMuted, fontSize: 14, lineHeight: 19, fontWeight: "800", marginTop: 3 },
  trainingAssignedRow: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 10 },
  trainingCoachIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  trainingAssignedText: { flex: 1, minWidth: 0, color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  trainingHeroVisual: { width: 92, height: 86, alignItems: "center", justifyContent: "center", marginTop: 6, opacity: 0.78 },
  trainingHeroImage: { width: 84, height: 78 },
  trainingCoachNote: { minHeight: 46, borderRadius: 10, backgroundColor: "#eef5ff", paddingHorizontal: 10, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 9, marginTop: 8, zIndex: 1 },
  trainingCoachNoteText: { flex: 1, minWidth: 0, color: colors.inkMuted, fontSize: 12.5, lineHeight: 17, fontWeight: "600" },
  trainingProgressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, zIndex: 1 },
  trainingProgressBar: { flex: 1 },
  trainingProgressText: { width: 44, color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900", textAlign: "right" },
  trainingHeroButton: { minHeight: 43, borderRadius: 10, marginTop: 9, zIndex: 1 },
  trainingHeroButtonText: { fontSize: 15, lineHeight: 19 },
  trainingPreviewCard: { paddingHorizontal: 13, paddingVertical: 12 },
  trainingSectionHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 },
  trainingSectionTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  trainingSectionAction: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 3 },
  trainingSectionActionText: { color: colors.primary, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  trainingExerciseRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 5 },
  trainingExerciseIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  trainingExerciseImageShell: { backgroundColor: colors.primarySoft },
  trainingExerciseImage: { width: 39, height: 39 },
  trainingExerciseCopy: { flex: 1, minWidth: 0 },
  trainingExerciseTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  trainingExerciseSubtitle: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "600", marginTop: 3 },
  trainingVideoBadge: { width: 22, height: 18, borderRadius: 5, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  trainingExerciseRight: { maxWidth: 96, alignItems: "flex-end", justifyContent: "center" },
  trainingUpNextCard: { minHeight: 104, paddingHorizontal: 13, paddingVertical: 12, overflow: "hidden", position: "relative" },
  trainingUpNextWash: { position: "absolute", right: -18, bottom: -28, width: 160, height: 96, borderTopLeftRadius: 110, backgroundColor: "#eef5ff" },
  trainingUpNextRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, zIndex: 1 },
  trainingUpNextIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  trainingUpNextCopy: { flex: 1, minWidth: 0 },
  trainingUpNextDate: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "600" },
  trainingUpNextTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900", marginTop: 2 },
  trainingUpNextMeta: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 2 },
  trainingNoWorkoutCard: { minHeight: 126, flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 14, paddingVertical: 14 },
  trainingNoWorkoutCopy: { flex: 1, minWidth: 0 },
  trainingNoWorkoutTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  trainingEmptyBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  workoutSegmented: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d9e0eb",
    backgroundColor: "#fdfeff",
  },
  workoutSegment: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  workoutSegmentActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  workoutSegmentText: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "700" },
  workoutSegmentTextActive: { color: "#ffffff", fontWeight: "900" },
  workoutSegmentDivider: { width: 1, height: 28, backgroundColor: colors.line },
  weekStrip: { flexDirection: "row", justifyContent: "space-between", paddingTop: 7, paddingBottom: 10 },
  weekDay: { width: 43, minHeight: 54, alignItems: "center", gap: 4, paddingVertical: 7, borderRadius: 11, borderWidth: 1, borderColor: "transparent" },
  weekDayToday: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  weekDaySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekDayLabel: { color: colors.inkFaint, fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 0.3 },
  weekDayLabelSelected: { color: "#e8efff" },
  weekDayNumber: { color: colors.ink, fontSize: 18, lineHeight: 22, fontWeight: "900" },
  weekDayNumberSelected: { color: "#fff" },
  weekDayDot: { width: 5, height: 5, borderRadius: 3 },
  workoutHeroCard: { paddingHorizontal: 12, paddingVertical: 8 },
  workoutHeroChipsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6 },
  workoutTodayChip: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 5,
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  workoutHeroTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  heroWorkoutTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900", marginBottom: 2 },
  workoutHeroMeta: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  workoutHeroCoach: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 3 },
  workoutBodyIcon: { width: 58, height: 48, alignItems: "center", justifyContent: "center", marginRight: 8, marginTop: 0 },
  workoutTorsoImage: { width: 44, height: 48 },
  progressLineRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 10 },
  progressLineBar: { flex: 1 },
  progressPercent: { width: 42, color: colors.primary, fontSize: 14, fontWeight: "900", textAlign: "right" },
  videoMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  videoMetaIcon: { width: 24, height: 18, borderRadius: 3, borderWidth: 1, borderColor: colors.inkMuted, alignItems: "center", justifyContent: "center" },
  workoutVideoMeta: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700" },
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
  workoutExerciseSubtitle: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "500", marginTop: 1 },
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
  workoutStatusPillPrimary: { backgroundColor: colors.primarySoft, borderColor: "#c7d7ff" },
  workoutStatusPillNeutral: { backgroundColor: colors.surfaceInset, borderColor: colors.line },
  workoutStatusPillText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  workoutStatusPillTextSuccess: { color: colors.ok },
  workoutStatusPillTextPrimary: { color: colors.primary },
  targetRow: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 9 },
  nutritionCardTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  nutritionTargetCard: { paddingVertical: 7, paddingHorizontal: 12 },
  nutritionTargetRow: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 18 },
  nutritionTargetCopy: { flex: 1, alignItems: "center", gap: 10 },
  targetRemaining: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  nutritionGoalBadge: { alignSelf: "center", borderRadius: radius.pill, backgroundColor: "#fff1e5", paddingHorizontal: 11, paddingVertical: 4 },
  nutritionGoalDisplayText: { color: colors.warn, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  nutritionGoalText: { display: "none" },
  actionRow: { flexDirection: "row", gap: 10 },
  compactButton: { flex: 0, alignSelf: "stretch", marginTop: 7 },
  workoutScheduleRow: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 8 },
  workoutCalendarIcon: { width: 22, textAlign: "center" },
  workoutScheduleDay: { width: 56, color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  workoutScheduleName: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "500" },
  trailingLink: { alignSelf: "flex-end", marginTop: 2, fontSize: 12, lineHeight: 16 },
  macroCard: { paddingVertical: 7, paddingHorizontal: 12, gap: 2 },
  macroRow: { minHeight: 23, flexDirection: "row", alignItems: "center", gap: 9 },
  macroBareIcon: { width: 20, textAlign: "center" },
  nutritionMacroLabel: { color: colors.ink, fontSize: 12, lineHeight: 15, fontWeight: "800" },
  nutritionMacroValue: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  nutritionMacroProgress: { flex: 1 },
  nutritionActionRow: { flexDirection: "row", gap: 10 },
  nutritionActionButton: { minHeight: 34, borderRadius: 7 },
  nutritionActionRowV2: { flexDirection: "row", gap: 10 },
  nutritionPrimaryAction: { flex: 1, minHeight: 50, borderRadius: 10 },
  nutritionSummaryCard: { paddingHorizontal: 13, paddingVertical: 13, gap: 12 },
  nutritionSummaryTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  nutritionSummaryCopy: { flex: 1, minWidth: 0 },
  nutritionEyebrow: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", letterSpacing: 1.8 },
  nutritionCaloriesRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", marginTop: 9 },
  nutritionCaloriesValue: { color: colors.ink, fontSize: 33, lineHeight: 39, fontWeight: "900", letterSpacing: 0 },
  nutritionCaloriesTarget: { color: colors.inkMuted, fontSize: 21, lineHeight: 28, fontWeight: "800" },
  nutritionStatusPill: { minHeight: 30, borderRadius: 15, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  nutritionStatusDot: { width: 8, height: 8, borderRadius: 4 },
  nutritionStatusText: { fontSize: 13, lineHeight: 17, fontWeight: "900" },
  nutritionProgressRowV2: { flexDirection: "row", alignItems: "center", gap: 12 },
  nutritionProgressTrackV2: { flex: 1 },
  nutritionProgressPercent: { width: 38, color: colors.inkMuted, fontSize: 12.5, lineHeight: 16, fontWeight: "800", textAlign: "right" },
  nutritionRemainingText: { alignSelf: "flex-end", color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700", marginTop: -7 },
  nutritionMacroGrid: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  nutritionMacroTile: { flex: 1, minWidth: 0, gap: 5 },
  nutritionMacroIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  nutritionMacroProgressRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  nutritionMacroBar: { flex: 1, minWidth: 0 },
  nutritionMacroPercent: { width: 28, color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800", textAlign: "right" },
  nutritionSetupCard: { paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  nutritionSetupTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  nutritionSetupCopy: { flex: 1, minWidth: 0 },
  nutritionMissingGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  nutritionMissingChip: { minHeight: 26, borderRadius: 13, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  nutritionMissingText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  nutritionMealsCard: { paddingHorizontal: 13, paddingVertical: 13 },
  nutritionSectionHeader: { minHeight: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  nutritionSectionTitle: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "900" },
  nutritionMealList: { gap: 0 },
  nutritionMealRowV2: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  nutritionMealIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  nutritionMealCopy: { flex: 1, minWidth: 0 },
  nutritionMealSubtitle: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "600", marginTop: 2 },
  nutritionMealDetail: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 2 },
  nutritionMealRight: { minWidth: 92, alignItems: "flex-end", gap: 6 },
  nutritionMealKcal: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "800", textAlign: "right" },
  nutritionLoggedBadge: { minHeight: 26, borderRadius: 13, backgroundColor: colors.ok, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  nutritionLoggedText: { color: "#ffffff", fontSize: 12, lineHeight: 15, fontWeight: "900" },
  nutritionSmallButton: { minWidth: 82, minHeight: 36, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", paddingHorizontal: 11 },
  nutritionSmallButtonDisabled: { opacity: 0.58 },
  nutritionSmallButtonText: { color: colors.primary, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  nutritionHydrationCard: { paddingHorizontal: 13, paddingVertical: 13, gap: 13 },
  nutritionHydrationTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  nutritionHydrationIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  nutritionHydrationCopy: { flex: 1, minWidth: 0, gap: 6 },
  nutritionHydrationValueRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  nutritionHydrationValue: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  nutritionHydrationPercent: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  nutritionHydrationActions: { flexDirection: "row", gap: 8, paddingRight: 58 },
  nutritionHydrationButton: { flex: 1, minHeight: 36, borderRadius: 8 },
  nutritionCoachPlanCard: { paddingHorizontal: 13, paddingVertical: 13, gap: 11 },
  nutritionCoachPlanTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  nutritionCoachIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  nutritionCoachCopy: { flex: 1, minWidth: 0 },
  nutritionCoachSummary: { color: colors.inkMuted, fontSize: 12.5, lineHeight: 17, fontWeight: "700", marginTop: 2 },
  nutritionPlanButton: { minWidth: 104, minHeight: 38, borderRadius: 10, backgroundColor: colors.primarySoft, paddingHorizontal: 10, marginRight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  nutritionPlanButtonText: { color: colors.primary, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  nutritionPlanExpanded: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: "#ffffff", paddingHorizontal: 8 },
  nutritionPlanActions: { minHeight: 36, borderTopWidth: 1, borderTopColor: colors.line, justifyContent: "center" },
  nutritionPlanTextAction: { alignSelf: "flex-start", minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6 },
  nutritionPlanTextActionLabel: { color: colors.primary, fontSize: 12.5, lineHeight: 16, fontWeight: "900" },
  nutritionPlanMealRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 6 },
  nutritionPlanMealIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  macroCount: { alignSelf: "flex-end", fontSize: 12, fontWeight: "900" },
  sectionInline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  rowIconTitle: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  innerList: { marginTop: 9, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: "hidden", paddingHorizontal: 8 },
  coachMealCard: { padding: 8, backgroundColor: "#f8faff" },
  mealPlanInnerList: { marginTop: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 9, overflow: "hidden", backgroundColor: "#ffffff", paddingHorizontal: 7 },
  mealPlanActions: { minHeight: 32, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.line },
  mealPlanAction: { flex: 1, minHeight: 32, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  mealPlanActionText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  mealRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 7 },
  mealIconBubble: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  nutritionMealTitle: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  nutritionMealMuted: { color: colors.inkMuted, fontSize: 12.5, lineHeight: 17, fontWeight: "600" },
  nutritionMealPlannedNote: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 1 },
  nutritionMealValue: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800" },
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
  twoLinks: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8, paddingTop: 8 },
  coachHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  inlineTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  ratingText: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 4 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  bulletRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 8 },
  bulletText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  coachHeroCard: { minHeight: 174, paddingHorizontal: 13, paddingVertical: 11, overflow: "hidden", position: "relative", gap: 8 },
  coachHeroWash: { position: "absolute", right: -28, top: -8, bottom: -6, width: 160, borderTopLeftRadius: 116, borderBottomLeftRadius: 70, backgroundColor: "#eef5ff" },
  coachHeroMark: { position: "absolute", right: 34, top: 34, opacity: 0.9 },
  coachHeroScribble: { position: "absolute", right: 21, top: 82, color: "#7e94bd", fontSize: 13, lineHeight: 15, fontWeight: "800", fontStyle: "italic", textAlign: "center", transform: [{ rotate: "-12deg" }], opacity: 0.8 },
  coachHeroIdentity: { flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 92, zIndex: 1 },
  coachHeroCopy: { flex: 1, minWidth: 0 },
  coachNameLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  coachHeroName: { flex: 1, color: colors.ink, fontSize: 18.5, lineHeight: 23, fontWeight: "900" },
  coachHeroSubtitle: { color: colors.inkMuted, fontSize: 12.5, lineHeight: 16, fontWeight: "700", marginTop: 1 },
  coachHeroRating: { color: colors.ink, fontSize: 12.5, lineHeight: 16, fontWeight: "900", marginTop: 4 },
  coachHeroChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, zIndex: 1 },
  coachSpecialtyChip: { maxWidth: "48%", minHeight: 27, borderRadius: 9, borderWidth: 1, borderColor: "#c9d9ff", backgroundColor: colors.primarySoft, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  coachSpecialtyText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  coachHeroActions: { flexDirection: "row", gap: 10, zIndex: 1 },
  coachHeroAction: { flex: 1, minHeight: 40, borderRadius: 10 },
  coachConversationCard: { paddingHorizontal: 13, paddingVertical: 13, gap: 10 },
  coachCardTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  coachMutedText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  coachMessageThread: { gap: 7 },
  coachBubble: { maxWidth: "88%", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  coachBubbleMine: { alignSelf: "flex-end", backgroundColor: colors.primary },
  coachBubbleTheirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceInset },
  coachBubbleText: { color: colors.ink, fontSize: 12.5, lineHeight: 17, fontWeight: "600" },
  coachBubbleTextMine: { color: "#ffffff" },
  coachBubbleTime: { color: colors.inkFaint, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 3 },
  coachBubbleTimeMine: { color: "#dbe7ff" },
  coachComposer: { minHeight: 70, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: "#ffffff", color: colors.ink, fontSize: 13, lineHeight: 18, paddingHorizontal: 11, paddingVertical: 9, textAlignVertical: "top" },
  coachSendButton: { minHeight: 40, borderRadius: 9 },
  nextCoachSessionCard: { paddingHorizontal: 13, paddingVertical: 11, gap: 7 },
  coachSectionHeader: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  coachSectionAction: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 2 },
  coachSectionActionText: { color: colors.primary, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  nextCoachSessionBody: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 12 },
  nextCoachEmptyBody: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12 },
  nextCoachSessionCopy: { flex: 1, minWidth: 0 },
  nextCoachSessionTitle: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  nextCoachSessionMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "700", marginTop: 4 },
  coachCountdownPill: { alignSelf: "flex-start", minHeight: 27, borderRadius: 14, backgroundColor: colors.primarySoft, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  coachCountdownText: { color: colors.primary, fontSize: 12, lineHeight: 15, fontWeight: "900" },
  nextCoachSessionButton: { flex: 0, width: 126, minHeight: 44, borderRadius: 10 },
  coachSessionDetailBox: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, gap: 6 },
  coachDetailRow: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  latestCoachMessageCard: { paddingHorizontal: 13, paddingVertical: 13, gap: 12 },
  coachMessageHeader: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  coachMessageTime: { color: colors.inkFaint, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  latestCoachMessageRow: { flexDirection: "row", alignItems: "flex-start", gap: 13 },
  latestCoachMessageCopy: { flex: 1, minWidth: 0 },
  latestCoachMessageName: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  latestCoachMessageBody: { color: colors.inkMuted, fontSize: 13.5, lineHeight: 18, fontWeight: "600", marginTop: 4 },
  coachReplyButton: { alignSelf: "flex-start", minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  coachProgramCard: { paddingHorizontal: 13, paddingVertical: 13 },
  coachProgramRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingRight: 48 },
  coachProgramCopy: { flex: 1, minWidth: 0 },
  coachProgramTitle: { color: colors.ink, fontSize: 14.5, lineHeight: 18, fontWeight: "900" },
  coachProgramSubtitle: { color: colors.inkMuted, fontSize: 12.5, lineHeight: 17, fontWeight: "600", marginTop: 2 },
  coachMembershipCard: { minHeight: 78, paddingHorizontal: 13, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  coachMembershipCopy: { flex: 1, minWidth: 0 },
  coachMembershipLabel: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  coachMembershipTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "900", marginTop: 1 },
  coachMembershipSubtitle: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 2 },
  coachMembershipButton: { flex: 0, width: 118, minHeight: 42, borderRadius: 10 },
  coachRelationshipCard: { paddingHorizontal: 13, paddingVertical: 12, paddingRight: 66, marginBottom: 20 },
  coachRelationshipRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
  coachRelationshipIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: colors.surfaceInset, alignItems: "center", justifyContent: "center" },
  coachRelationshipIconDanger: { backgroundColor: colors.badSoft },
  coachRelationshipLabel: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 14.5, lineHeight: 19, fontWeight: "800" },
  coachRelationshipLabelDanger: { color: colors.bad, fontWeight: "900" },
  coachRelationshipValue: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  noCoachCard: { paddingHorizontal: 16, paddingVertical: 18, alignItems: "center", gap: 12 },
  noCoachTitle: { color: colors.ink, fontSize: 21, lineHeight: 26, fontWeight: "900", textAlign: "center" },
  noCoachBody: { color: colors.inkMuted, fontSize: 13.5, lineHeight: 19, fontWeight: "600", textAlign: "center" },
  noCoachBenefits: { alignSelf: "stretch", gap: 8, marginTop: 2 },
  noCoachBenefitRow: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 10, backgroundColor: colors.surfaceInset, paddingHorizontal: 10 },
  noCoachBenefitText: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  noCoachButton: { alignSelf: "stretch", minHeight: 44, borderRadius: 10 },
  progressRangeTabs: {
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d9e0eb",
    backgroundColor: "#fdfeff",
    flexDirection: "row",
    padding: 3,
    overflow: "hidden",
  },
  progressRangeTab: { flex: 1, minHeight: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  progressRangeTabActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  progressRangeText: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  progressRangeTextActive: { color: "#ffffff", fontWeight: "900" },
  progressRangeUnderline: { display: "none" },
  progressRangeUnderlineActive: {},
  progressCategoryTabs: { flexDirection: "row", gap: 6 },
  progressCategoryTab: {
    flex: 1,
    minHeight: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInset,
  },
  progressCategoryTabActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  progressCategoryText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  progressCategoryTextActive: { color: "#ffffff" },
  progressHeroCard: { minHeight: 168, paddingHorizontal: 10, paddingVertical: 9, overflow: "hidden", position: "relative", gap: 6, borderColor: "#cfe1ff" },
  progressHeroArt: { position: "absolute", right: 7, top: 34, width: 120, height: 52, opacity: 0.9, overflow: "hidden", zIndex: 0 },
  progressHeroTop: { minHeight: 72, flexDirection: "row", alignItems: "flex-start", gap: 8, position: "relative", zIndex: 2 },
  progressHeroCopy: { flex: 1, minWidth: 0, paddingRight: 36 },
  progressOverline: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", letterSpacing: 1.6 },
  progressHeroTitle: { color: colors.ink, fontSize: 19, lineHeight: 23, fontWeight: "900", letterSpacing: 0, marginTop: 2 },
  progressHeroBody: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600", marginTop: 2 },
  progressHeroBadge: { minHeight: 23, borderRadius: 12, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 4, zIndex: 2 },
  progressHeroBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  progressSummaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4, position: "relative", zIndex: 2 },
  progressSummaryMetric: {
    width: "49%",
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#ffffff",
    paddingHorizontal: 6,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  progressSummaryMetricCopy: { flex: 1, minWidth: 0, gap: 1 },
  progressSummaryMetricTitle: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  progressSummaryMetricValue: { fontSize: 13.5, lineHeight: 17, fontWeight: "900" },
  progressInsightLine: { minHeight: 23, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 5, position: "relative", zIndex: 2 },
  progressInsightLineText: { flex: 1, color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  progressWeekCard: { paddingHorizontal: 10, paddingVertical: 8 },
  progressWeekGrid: { position: "relative", flexDirection: "row", flexWrap: "wrap", marginTop: 4, rowGap: 1 },
  progressWeekVerticalDivider: { position: "absolute", top: 2, bottom: 2, left: "50%", width: 1, backgroundColor: colors.line },
  progressWeekHorizontalDivider: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: colors.line },
  progressWeekMetric: { width: "50%", minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, paddingRight: 7 },
  progressWeekCopy: { flex: 1, minWidth: 0, gap: 1 },
  progressMetricTitle: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  progressMetricValue: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  progressTinyTrack: { height: 4, borderRadius: 2, backgroundColor: "#dfe4ed", overflow: "hidden", marginTop: 1 },
  progressTinyFill: { height: "100%", borderRadius: 3 },
  progressDetailCard: { paddingHorizontal: 11, paddingVertical: 11, gap: 10 },
  progressDetailHeader: { minHeight: 38, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  progressDetailHeaderCopy: { flex: 1, minWidth: 0 },
  progressDetailTitle: { color: colors.ink, fontSize: 20, lineHeight: 24, fontWeight: "900", letterSpacing: 0 },
  progressDetailSubtitle: { color: colors.inkMuted, fontSize: 12, lineHeight: 15, fontWeight: "600", marginTop: 1 },
  progressRangePill: { minHeight: 30, borderRadius: 9, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fbfdff", paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 4 },
  progressRangePillText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  progressPrimaryChartRow: { minHeight: 102, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: "#ffffff", paddingHorizontal: 9, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  progressPrimaryMetric: { width: 98, alignItems: "flex-start", gap: 4 },
  progressPrimaryLabel: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  progressPrimaryValue: { fontSize: 22, lineHeight: 26, fontWeight: "900" },
  progressDetailChartPane: { flex: 1, minWidth: 0 },
  progressDetailMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  progressDetailMetric: {
    width: "49%",
    minHeight: 66,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#ffffff",
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  progressDetailMetricCopy: { flex: 1, minWidth: 0, gap: 1 },
  progressDetailMetricLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  progressDetailMetricValue: { color: colors.ink, fontSize: 15.5, lineHeight: 19, fontWeight: "900" },
  progressDetailMetricSub: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  progressInlineButton: { marginTop: 10, minHeight: 42, borderRadius: 10 },
  progressEmptyChart: { minHeight: 80, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: colors.surfaceInset, paddingHorizontal: 10 },
  progressEmptyChartText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800", textAlign: "center" },
  progressEmptyText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: "700", marginTop: 2 },
  progressBarTrend: { height: 84, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 6 },
  progressBarTrendColumn: { flex: 1, minWidth: 0, height: "100%", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  progressBarTrendTrack: { width: "70%", flex: 1, borderRadius: 7, backgroundColor: colors.surfaceInset, justifyContent: "flex-end", overflow: "hidden" },
  progressBarTrendFill: { width: "100%", borderRadius: 7, backgroundColor: colors.primary },
  progressBarTrendLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  progressCardTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  feedbackProgressCard: { minHeight: 86, paddingHorizontal: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  feedbackProgressCopy: { flex: 1, minWidth: 0 },
  feedbackProgressText: { color: colors.inkMuted, fontSize: 12.5, lineHeight: 17, fontWeight: "600", marginTop: 2 },
  feedbackProgressMeta: { color: colors.inkFaint, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 2 },
});
