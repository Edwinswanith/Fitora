// The athlete Progress tab. All numbers come from lib/progressModel.ts (unit
// tested); this file only lays them out:
//   header > range picker > HeroCard (one verdict, one action) >
//   three area tiles (tap one to open its detail) > that area's detail >
//   this week > coach feedback (passed in as children).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { Text } from "./AppText";
import { AppCard, HeroCard, IconTile, PrimaryAppBar, SectionLabel } from "./fitora";
import { apiJson } from "../lib/api";
import { colors, metricColors, type MetricKey, fonts } from "../lib/theme";
import { localDayOf, type JudgedTone } from "../lib/progressWindow";
import {
  checkInStreak,
  nutritionSummary,
  progressHeadline,
  rangeDatesLabel,
  rangeStart,
  readinessTone,
  recoverySummary,
  trainingSummary,
  weeklyCounts,
  type ChartPoint,
  type NutritionDayLike,
  type ProgressArea,
  type ProgressRange,
} from "../lib/progressModel";
import { todayKey, type AthleteDashboardData, type TrendPoint, type WorkoutAssignmentSummary } from "../lib/fitoraData";

type RangeData = { trends: TrendPoint[]; workouts: WorkoutAssignmentSummary[]; nutrition: NutritionDayLike[] | null };

const RANGES: ProgressRange[] = ["7D", "4W", "3M"];
const RANGE_DAY_COUNT: Record<ProgressRange, number> = { "7D": 7, "4W": 28, "3M": 90 };

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

/** Loads trends, workouts and per-day meal totals for a range; cached per range. */
function useRangeData(range: ProgressRange, fallback: RangeData) {
  const [cache, setCache] = useState<Record<string, RangeData & { complete: boolean }>>({});
  const today = todayKey();
  const key = `${range}:${today}`;
  const entry = cache[key];
  const needsLoad = !entry?.complete;

  useEffect(() => {
    if (!needsLoad) return;
    let active = true;
    const from = rangeStart(range, today);
    Promise.all([
      apiJson<{ series: TrendPoint[] }>(`/api/athlete/trends?days=${RANGE_DAY_COUNT[range]}`).then((r) => r.series ?? []).catch(() => null),
      apiJson<{ assignments: WorkoutAssignmentSummary[] }>(`/api/athlete/workout-assignments?from=${from}&to=${today}`).then((r) => r.assignments ?? []).catch(() => null),
      apiJson<{ days: NutritionDayLike[] }>(`/api/athlete/nutrition/daily-summary?from=${from}&to=${today}`).then((r) => r.days ?? []).catch(() => null),
    ]).then(([trends, workouts, nutrition]) => {
      if (!active) return;
      // A partial load is shown but not marked complete, so it's retried next time.
      setCache((prev) => ({
        ...prev,
        [key]: { trends: trends ?? fallback.trends, workouts: workouts ?? fallback.workouts, nutrition, complete: Boolean(trends && workouts && nutrition) },
      }));
    });
    return () => {
      active = false;
    };
    // fallback is derived from `data`, which only changes on a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data: entry ?? fallback, loading: !entry };
}

export function ProgressView({
  data,
  onOpenTab,
  children,
}: {
  data: AthleteDashboardData;
  onOpenTab: (tab: "workouts" | "nutrition") => void;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [range, setRange] = useState<ProgressRange>("4W");
  const [area, setArea] = useState<ProgressArea>("training");
  const today = todayKey();
  const joined = localDayOf(data.profile?.createdAt);

  const fallback = useMemo<RangeData>(
    () => ({ trends: data.trends, workouts: dedupeById([...data.recentWorkouts, ...data.workouts]), nutrition: null }),
    [data]
  );
  const { data: rangeData, loading } = useRangeData(range, fallback);

  const currentScore = data.daily?.readinessScore ?? data.daily?.recovery?.score ?? null;
  const training = trainingSummary(rangeData.workouts, range, today);
  // If the range request failed, say plainly that meals cover the last week only.
  const nutritionRange: ProgressRange = rangeData.nutrition ? range : "7D";
  const nutrition = nutritionSummary(rangeData.nutrition ?? data.nutritionWeek, nutritionRange, today, joined);
  const recovery = recoverySummary(rangeData.trends, range, today, currentScore);
  const headline = progressHeadline(training, nutrition, recovery);
  const week = weeklyCounts(dedupeById([...fallback.workouts, ...rangeData.workouts]), rangeData.nutrition ?? data.nutritionWeek, rangeData.trends, today, joined);

  const header = <PrimaryAppBar title="Progress" showNotifications={false} showAvatar={false} rightIcon="calendar-outline" onRightPress={() => router.push("/athlete/trends" as never)} />;

  if (!headline.hasData && !loading) {
    return (
      <>
        {header}
        <RangeTabs value={range} onChange={setRange} />
        <HeroCard calm icon="trending-up-outline" eyebrow="Progress" title={headline.title} body={headline.body} actionLabel="Check In" onAction={() => router.push("/athlete/check-in" as never)} />
      </>
    );
  }

  const checkedInToday = currentScore != null;
  const action =
    headline.focus === "training"
      ? { label: "Open Training", run: () => onOpenTab("workouts") }
      : headline.focus === "nutrition"
        ? { label: "Log a Meal", run: () => onOpenTab("nutrition") }
        : headline.focus === "recovery" && !checkedInToday
          ? { label: "Check In", run: () => router.push("/athlete/check-in" as never) }
          : null;
  const calm = headline.status === "strong" || headline.status === "steady";

  return (
    <>
      {header}
      <RangeTabs value={range} onChange={setRange} />

      <HeroCard
        calm={calm}
        icon={headline.status === "strong" ? "trophy-outline" : calm ? "checkmark-circle-outline" : headline.status === "attention" ? "alert-circle-outline" : "trending-down-outline"}
        eyebrow={rangeDatesLabel(range, today)}
        title={headline.title}
        body={headline.body}
        actionLabel={action?.label}
        onAction={action?.run}
      />

      <View style={styles.tiles} accessibilityRole="tablist">
        <AreaTile
          metric="training"
          icon="barbell-outline"
          title="Training"
          value={training.rate == null ? "--" : `${Math.round(training.rate * 100)}%`}
          tone={training.tone}
          basis={training.total ? `${training.completed} of ${training.total} done` : "None scheduled"}
          selected={area === "training"}
          onPress={() => setArea("training")}
        />
        <AreaTile
          metric="nutrition"
          icon="nutrition-outline"
          title="Meals"
          value={`${Math.round((nutrition.rate ?? 0) * 100)}%`}
          tone={nutrition.tone}
          basis={`${nutrition.loggedDays} of ${nutrition.totalDays} days`}
          selected={area === "nutrition"}
          onPress={() => setArea("nutrition")}
        />
        <AreaTile
          metric="readiness"
          icon="heart-outline"
          title="Readiness"
          value={recovery.avgReadiness == null ? "--" : String(recovery.avgReadiness)}
          tone={recovery.problem ? "warning" : recovery.avgTone === "success" ? "success" : "neutral"}
          basis={recovery.delta != null ? `${recovery.delta > 0 ? "+" : ""}${recovery.delta} pts` : `${recovery.checkIns} check-in${recovery.checkIns === 1 ? "" : "s"}`}
          selected={area === "recovery"}
          onPress={() => setArea("recovery")}
        />
      </View>

      {area === "training" ? (
        <AreaDetail
          title="Workout consistency"
          basis={`${training.basis}. Completed out of scheduled.`}
          loading={loading}
          chart={<TrendChart kind="line" metric="training" points={training.series} max={100} format={(v) => `${v}%`} gridLines={[0, 50, 100]} empty="No workouts scheduled in this range" />}
        >
          {recovery.loadDeltaPct != null ? (
            <DetailStat icon="trending-up-outline" label="Training load" value={`${recovery.loadDeltaPct > 0 ? "+" : ""}${recovery.loadDeltaPct}%`} sub="vs. first half" />
          ) : recovery.avgLoad != null ? (
            <DetailStat icon="bar-chart-outline" label="Avg load" value={String(Math.round(recovery.avgLoad))} sub="per logged day" />
          ) : null}
          <DetailStat icon="calendar-outline" label="Scheduled" value={String(training.total)} sub={training.total === 1 ? "workout" : "workouts"} />
        </AreaDetail>
      ) : null}

      {area === "nutrition" ? (
        <AreaDetail
          title="Calories on logged days"
          basis={`${nutrition.basis}${nutritionRange !== range ? " (last 7 days only)" : ""}.`}
          loading={loading}
          chart={<TrendChart kind="bar" metric="nutrition" points={nutrition.series} target={data.target?.calories ?? null} format={(v) => `${v.toLocaleString()} kcal`} empty="No meals logged in this range" />}
        >
          <DetailStat icon="flame-outline" label="Avg intake" value={nutrition.avgCalories == null ? "--" : nutrition.avgCalories.toLocaleString()} sub="kcal a day" />
          {data.target?.calories ? <DetailStat icon="flag-outline" label="Target" value={data.target.calories.toLocaleString()} sub="kcal a day" /> : null}
        </AreaDetail>
      ) : null}

      {area === "recovery" ? (
        <AreaDetail
          title="Readiness"
          basis={`${recovery.basis}. From your daily check-ins.`}
          loading={loading}
          chart={<TrendChart kind="line" metric="readiness" points={recovery.series} max={100} format={(v) => String(v)} gridLines={[0, 50, 100]} empty="No check-ins in this range" />}
        >
          <DetailStat icon="alert-circle-outline" label="Low days" value={String(recovery.lowDays)} sub="under 60" tone={recovery.problem ? "warning" : undefined} />
          {recovery.avgSleep != null ? <DetailStat icon="moon-outline" label="Avg sleep" value={recovery.avgSleep.toFixed(1)} sub="hours" /> : null}
          <DetailStat icon="flame-outline" label="Check-in streak" value={String(checkInStreak(rangeData.trends, today).current)} sub="days in a row" />
          {currentScore != null ? <DetailStat icon="today-outline" label="Today" value={String(Math.round(currentScore))} sub="readiness" tone={readinessTone(currentScore) === "danger" ? "warning" : undefined} /> : null}
        </AreaDetail>
      ) : null}

      {/* With 7D selected the range already is this week. */}
      {range !== "7D" ? (
        <>
          <SectionLabel title="This week" />
          <AppCard style={styles.weekCard}>
            <WeekStat color={metricColors.training.to} title="Workouts" value={week.workoutTotal ? `${week.workoutDone} of ${week.workoutTotal}` : "None"} rate={week.workoutTotal ? week.workoutDone / week.workoutTotal : 0} />
            <WeekStat color={metricColors.nutrition.to} title="Meal days" value={`${week.mealDays} of ${week.days}`} rate={week.mealDays / week.days} />
            <WeekStat color={metricColors.readiness.to} title="Check-ins" value={`${week.checkIns} of ${week.days}`} rate={week.checkIns / week.days} />
          </AppCard>
        </>
      ) : null}

      {children}
    </>
  );
}

function RangeTabs({ value, onChange }: { value: ProgressRange; onChange: (value: ProgressRange) => void }) {
  return (
    <View style={styles.rangeTabs} accessibilityRole="tablist">
      {RANGES.map((item) => {
        const active = value === item;
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            style={({ pressed }) => [styles.rangeTab, active ? styles.rangeTabActive : null, pressed ? { opacity: 0.75 } : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item === "7D" ? "Last 7 days" : item === "4W" ? "Last 4 weeks" : "Last 3 months"}
          >
            <Text style={[styles.rangeText, active ? styles.rangeTextActive : null]}>{item}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function toneInk(tone: JudgedTone | "warning" | undefined): string {
  if (tone === "success") return colors.ok;
  if (tone === "warning") return colors.warn;
  if (tone === "danger") return colors.bad;
  return colors.ink;
}

function AreaTile({
  metric,
  icon,
  title,
  value,
  tone,
  basis,
  selected,
  onPress,
}: {
  metric: MetricKey;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  tone: JudgedTone;
  basis: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}: ${value}, ${basis}`}
      style={({ pressed }) => [styles.tile, selected ? styles.tileSelected : null, pressed ? { opacity: 0.8 } : null]}
    >
      <View style={styles.tileHead}>
        <Ionicons name={icon} size={16} color={metricColors[metric].ink} />
        <Text style={styles.tileTitle} numberOfLines={1}>{title}</Text>
      </View>
      <Text style={[styles.tileValue, { color: toneInk(tone) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
      <Text style={styles.tileBasis} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{basis}</Text>
    </Pressable>
  );
}

function AreaDetail({ title, basis, loading, chart, children }: { title: string; basis: string; loading: boolean; chart: ReactNode; children?: ReactNode }) {
  return (
    <AppCard style={styles.detailCard}>
      <View>
        <Text style={styles.detailTitle}>{title}</Text>
        <Text style={styles.detailBasis}>{loading ? "Updating..." : basis}</Text>
      </View>
      {chart}
      {children ? <View style={styles.statGrid}>{children}</View> : null}
    </AppCard>
  );
}

function DetailStat({ icon, label, value, sub, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; sub: string; tone?: "warning" }) {
  return (
    <View style={styles.stat}>
      <IconTile icon={icon} tone={tone ?? "neutral"} size={36} />
      <View style={styles.statCopy}>
        <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
        <Text style={[styles.statValue, tone ? { color: colors.warn } : null]} numberOfLines={1}>{value}</Text>
        <Text style={styles.statSub} numberOfLines={1}>{sub}</Text>
      </View>
    </View>
  );
}

function WeekStat({ color, title, value, rate }: { color: string; title: string; value: string; rate: number }) {
  return (
    <View style={styles.weekStat}>
      <Text style={styles.weekTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.weekValue} numberOfLines={1}>{value}</Text>
      <View style={styles.weekTrack}>
        <View style={[styles.weekFill, { width: `${Math.max(4, Math.min(100, Math.round(rate * 100)))}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const CHART_HEIGHT = 150;

/**
 * One chart style for every area: evenly spaced slots, tap a slot to read
 * its exact value (the latest is shown by default).
 */
function TrendChart({
  kind,
  metric,
  points,
  max,
  target,
  gridLines,
  format,
  empty,
}: {
  kind: "line" | "bar";
  metric: MetricKey;
  points: ChartPoint[];
  max?: number;
  target?: number | null;
  gridLines?: number[];
  format: (value: number) => string;
  empty: string;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setSelected(null), [points.length]);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  if (!points.length) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>{empty}</Text>
      </View>
    );
  }

  const active = selected != null && selected < points.length ? selected : points.length - 1;
  const point = points[active];
  const color = metricColors[metric].to;
  const left = gridLines ? 30 : 4;
  const right = 4;
  const top = 10;
  const bottom = 24;
  const chartW = Math.max(1, width - left - right);
  const chartH = CHART_HEIGHT - top - bottom;
  const scaleMax = Math.max(1, max ?? 0, target ?? 0, ...points.map((p) => p.value)) * (max ? 1 : 1.1);
  const slot = chartW / points.length;
  const xAt = (i: number) => left + slot * (i + 0.5);
  const yAt = (v: number) => top + (1 - Math.max(0, Math.min(scaleMax, v)) / scaleMax) * chartH;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(p.value)}`).join(" ");
  const barW = Math.min(28, slot * 0.6);
  // With many slots, label every other one so dates never collide.
  const labelEvery = slot < 40 ? 2 : 1;

  return (
    <View>
      <View style={styles.readout}>
        <Text style={styles.readoutDetail} numberOfLines={2}>{point.detail}</Text>
        <Text style={[styles.readoutValue, { color: metricColors[metric].ink }]}>{format(point.value)}</Text>
      </View>
      <View onLayout={onLayout} style={{ height: CHART_HEIGHT }}>
        {width > 0 ? (
          <>
            <Svg width={width} height={CHART_HEIGHT}>
              {(gridLines ?? []).map((g) => (
                <Line key={`g${g}`} x1={left} x2={left + chartW} y1={yAt(g)} y2={yAt(g)} stroke={colors.line} strokeWidth={1} strokeDasharray="3 4" />
              ))}
              {(gridLines ?? []).map((g) => (
                <SvgText key={`gl${g}`} x={0} y={yAt(g) + 4} fontSize={12} fontFamily="Manrope_600SemiBold" fill={colors.inkMuted}>{g}</SvgText>
              ))}
              {target ? (
                <>
                  <Line x1={left} x2={left + chartW} y1={yAt(target)} y2={yAt(target)} stroke={colors.inkMuted} strokeWidth={1} strokeDasharray="5 4" />
                  <SvgText x={left + chartW} y={yAt(target) - 4} fontSize={12} fontFamily="Manrope_600SemiBold" fill={colors.inkMuted} textAnchor="end">Target</SvgText>
                </>
              ) : null}
              {kind === "bar"
                ? points.map((p, i) => (
                    <Rect
                      key={`b${i}`}
                      x={xAt(i) - barW / 2}
                      y={yAt(p.value)}
                      width={barW}
                      height={Math.max(2, top + chartH - yAt(p.value))}
                      rx={Math.min(6, barW / 2)}
                      fill={color}
                      opacity={i === active ? 1 : 0.4}
                    />
                  ))
                : (
                  <>
                    <Line x1={xAt(active)} x2={xAt(active)} y1={top} y2={top + chartH} stroke={color} strokeOpacity={0.25} strokeWidth={1} />
                    <Path d={linePath} stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    {points.map((p, i) => (
                      <Circle key={`c${i}`} cx={xAt(i)} cy={yAt(p.value)} r={i === active ? 6 : 3.5} fill={i === active ? color : colors.surfaceRaised} stroke={color} strokeWidth={2.2} />
                    ))}
                  </>
                )}
              <Line x1={left} x2={left + chartW} y1={top + chartH} y2={top + chartH} stroke={colors.lineStrong} strokeWidth={1} />
              {points.map((p, i) =>
                i % labelEvery === (points.length - 1) % labelEvery ? (
                  <SvgText key={`x${i}`} x={xAt(i)} y={CHART_HEIGHT - 6} fontSize={12} fontFamily={i === active ? "Manrope_800ExtraBold" : "Manrope_600SemiBold"} fill={i === active ? colors.ink : colors.inkMuted} textAnchor="middle">
                    {p.label}
                  </SvgText>
                ) : null
              )}
            </Svg>
            <View style={[styles.hitRow, { left, width: chartW }]}>
              {points.map((p, i) => (
                <Pressable key={`h${i}`} style={styles.hit} onPress={() => setSelected(i)} accessibilityRole="button" accessibilityLabel={`${p.detail}`} />
              ))}
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rangeTabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 12, backgroundColor: colors.surfaceInset },
  rangeTab: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rangeTabActive: { backgroundColor: colors.primary },
  rangeText: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  rangeTextActive: { color: colors.onPrimary, fontWeight: "900" },
  tiles: { flexDirection: "row", gap: 8 },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tileSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  tileTitle: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  tileValue: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 26, lineHeight: 29 },
  tileBasis: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  detailCard: { gap: 12 },
  detailTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "900" },
  detailBasis: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: "600", marginTop: 2 },
  readout: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36, borderRadius: 10, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 },
  readoutDetail: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  readoutValue: { fontSize: 16, lineHeight: 20, fontWeight: "900" },
  hitRow: { position: "absolute", top: 0, bottom: 0, flexDirection: "row" },
  hit: { flex: 1 },
  chartEmpty: { height: 96, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.surfaceInset, paddingHorizontal: 12 },
  chartEmptyText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: "700", textAlign: "center" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
  },
  statCopy: { flex: 1, minWidth: 0 },
  statLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  statValue: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  statSub: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  weekCard: { flexDirection: "row", gap: 14 },
  weekStat: { flex: 1, minWidth: 0, gap: 4 },
  weekTitle: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  weekValue: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  weekTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceInset, overflow: "hidden" },
  weekFill: { height: "100%", borderRadius: 3 },
});
