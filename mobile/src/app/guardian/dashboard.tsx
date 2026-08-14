import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppFrame, type NativeNavItem } from "../../components/AppFrame";
import { Card, Muted } from "../../components/ui";
import { DatePickerPill } from "../../components/DatePickerPill";
import { AskAgentControl } from "../../components/AskAgentControl";
import { apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { useAutoStartMobileTour, useTourHighlight, useTourScrollView } from "../../lib/tour/MobileTourProvider";
import { SpotlightTarget } from "../../lib/tour/SpotlightTarget";

type LinkedAthlete = { athleteId: string; name: string; sport: string; position: string | null };
type AthletesResponse = { athletes: LinkedAthlete[] };
type GuardianSummary = {
  date: string;
  sleep: { quality: number | null; hours: number | null };
  attendance: { status: string | null; note: string | null };
  water: { totalMl: number; goalMl: number };
};
type Band = "green" | "amber" | "red" | "neutral";

const theme = ROLE_THEMES.guardian;
const today = () => new Date().toISOString().slice(0, 10);

const NAV: NativeNavItem[] = [{ key: "today", label: "Summary", icon: "home-outline" }];

const BAND_COLOR: Record<Band, string> = {
  green: colors.ok,
  amber: colors.warn,
  red: colors.bad,
  neutral: colors.inkFaint,
};

function litres(ml: number) {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function keyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(key: string, days: number) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return keyFromDate(date);
}


function sleepBand(quality: number | null): Band {
  if (quality === null) return "neutral";
  if (quality <= 2) return "red";
  if (quality === 3) return "amber";
  return "green";
}

function sleepLabel(quality: number | null): string {
  if (quality === null) return "No check-in yet";
  return ["", "Poor", "Fair", "Good", "Great", "Excellent"][quality] ?? "—";
}

function waterBand(pct: number, hasGoal: boolean): Band {
  if (!hasGoal) return "neutral";
  if (pct >= 90) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

function attendanceBand(status: string | null): Band {
  if (status === null) return "neutral";
  if (status === "present" || status === "rest") return "green";
  if (status === "late" || status === "excused") return "amber";
  return "red";
}

function attendanceLabel(status: string | null) {
  if (status === null) return "Not logged";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Guardian dashboard — deliberately narrow. Guardians may see ONLY three data
 * points for their linked athlete: Sleep quality, Water intake, and Attendance
 * for a given day. No readiness, training load, injuries, coach feedback, or
 * messages — see server/src/routes/guardian.ts for the matching server-side
 * restriction (the API itself never returns anything else).
 */
export default function GuardianDashboard() {
  const router = useRouter();
  useAutoStartMobileTour("guardian");
  const { highlightStyle: headerHighlight } = useTourHighlight("mobile-guardian-header");
  const { highlightStyle: switcherHighlight } = useTourHighlight("mobile-guardian-switcher");
  const { highlightStyle: sleepHighlight } = useTourHighlight("mobile-guardian-sleep");
  const { highlightStyle: waterHighlight } = useTourHighlight("mobile-guardian-water");
  const { highlightStyle: attendanceHighlight } = useTourHighlight("mobile-guardian-attendance");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const [date, setDate] = useState(today());
  const [athletes, setAthletes] = useState<LinkedAthlete[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<GuardianSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarOpenSignal, setCalendarOpenSignal] = useState(0);

  const loadAthletes = useCallback(async () => {
    setError(null);
    try {
      const res = await apiJson<AthletesResponse>("/api/guardian/athletes");
      const list = res.athletes ?? [];
      setAthletes(list);
      setSelectedId((prev) => prev ?? list[0]?.athleteId ?? null);
    } catch {
      setError("Couldn't load your athletes. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    if (!selectedId) {
      setSummary(null);
      return;
    }
    setError(null);
    try {
      const res = await apiJson<GuardianSummary>(`/api/guardian/athletes/${selectedId}/summary?date=${date}`);
      setSummary(res);
    } catch {
      setError("Couldn't load this athlete summary.");
    }
  }, [date, selectedId]);

  useEffect(() => {
    loadAthletes();
  }, [loadAthletes]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const selected = athletes.find((athlete) => athlete.athleteId === selectedId) ?? null;
  const hasGoal = Boolean(summary && summary.water.goalMl > 0);
  const waterPct = summary && hasGoal ? Math.min(100, Math.round((summary.water.totalMl / summary.water.goalMl) * 100)) : 0;

  async function handleAskAgent(command: string): Promise<string> {
    const lower = command.toLowerCase();
    setError(null);
    if (/\bnotification/.test(lower)) {
      router.push("/notifications" as never);
      return "Opening notifications.";
    }
    if (/\bcalendar|calender/.test(lower)) {
      setCalendarOpenSignal((value) => value + 1);
      return "Opening calendar.";
    }
    if (/\byesterday\b/.test(lower)) {
      setDate(addDays(today(), -1));
      return "Opening yesterday.";
    }
    if (/\btomorrow\b/.test(lower)) {
      setDate(addDays(today(), 1));
      return "Opening tomorrow.";
    }
    if (/\bnext day\b/.test(lower)) {
      setDate((value) => addDays(value, 1));
      return "Opening next day.";
    }
    if (/\b(previous|prev|back) day\b/.test(lower)) {
      setDate((value) => addDays(value, -1));
      return "Opening previous day.";
    }
    if (/\bathlete|child|detail\b/.test(lower) && selectedId) {
      router.push({ pathname: "/guardian/athletes/[athleteId]", params: { athleteId: selectedId } } as never);
      return "Opening athlete details.";
    }
    const message = "Try: open calendar, next day, open athlete details, or open notifications.";
    setError(message);
    return message;
  }

  return (
    <AppFrame
      role="guardian"
      title={selected?.name ?? "Your athletes"}
      subtitle="Sleep, water & attendance only"
      nav={NAV}
      activeKey="today"
      onNavigate={() => undefined}
      headerAction={
        <SpotlightTarget id="mobile-guardian-header" style={headerHighlight}>
          <DatePickerPill value={date} onChange={setDate} openSignal={calendarOpenSignal} />
        </SpotlightTarget>
      }
    >
      <ScrollView
        ref={tourScrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAthletes} tintColor={theme.accent} />}
      >
        {error ? <Notice text={error} /> : null}

        {athletes.length > 1 ? (
          <SpotlightTarget id="mobile-guardian-switcher" style={switcherHighlight}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.athleteSwitch}>
            {athletes.map((athlete) => {
              const active = athlete.athleteId === selectedId;
              return (
                <Pressable
                  key={athlete.athleteId}
                  onPress={() => setSelectedId(athlete.athleteId)}
                  style={[styles.athleteChip, active ? { backgroundColor: theme.accent, borderColor: theme.accent } : null]}
                >
                  <View style={[styles.athleteAvatar, active ? { backgroundColor: "rgba(255,255,255,0.28)" } : null]}>
                    <Text style={[styles.athleteAvatarText, active ? { color: theme.accentInk } : null]}>
                      {initialsOf(athlete.name)}
                    </Text>
                  </View>
                  <Text style={[styles.athleteChipText, active ? { color: theme.accentInk } : null]}>{athlete.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          </SpotlightTarget>
        ) : null}

        {loading && athletes.length === 0 ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
        ) : athletes.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>No linked athletes yet.</Text>
            <Muted style={{ marginTop: 4 }}>A coach links your athlete to your account.</Muted>
          </Card>
        ) : !summary ? (
          <Card>
            <Muted>No data for this date.</Muted>
          </Card>
        ) : (
          <View style={styles.stack}>
            <SummaryHeroCard summary={summary} />
            <View style={styles.grid3}>
              <SpotlightTarget id="mobile-guardian-sleep" style={[styles.gridSlot, sleepHighlight]}>
                <SleepCard quality={summary.sleep.quality} hours={summary.sleep.hours} />
              </SpotlightTarget>
              <SpotlightTarget id="mobile-guardian-water" style={[styles.gridSlot, waterHighlight]}>
                <WaterCard totalMl={summary.water.totalMl} goalMl={summary.water.goalMl} pct={waterPct} hasGoal={hasGoal} />
              </SpotlightTarget>
              <SpotlightTarget id="mobile-guardian-attendance" style={[styles.gridSlot, attendanceHighlight]}>
                <AttendanceCard status={summary.attendance.status} note={summary.attendance.note} />
              </SpotlightTarget>
            </View>
          </View>
        )}
      </ScrollView>
      <AskAgentControl accent={theme.accent} accentInk={theme.accentInk} onCommand={handleAskAgent} />
    </AppFrame>
  );
}

function SummaryHeroCard({ summary }: { summary: GuardianSummary }) {
  const hasAnyData = summary.sleep.quality !== null || summary.attendance.status !== null || summary.water.totalMl > 0;
  return (
    <Card style={styles.heroCard}>
      <View style={styles.heroRow}>
        <View style={[styles.heroRing, hasAnyData ? { borderColor: theme.accent + "55" } : null]}>
          <Ionicons
            name={hasAnyData ? "shield-checkmark-outline" : "shield-outline"}
            size={22}
            color={hasAnyData ? theme.accent : colors.inkFaint}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroLabel}>Today's summary</Text>
          <Text style={styles.heroTitle}>{hasAnyData ? "Checked in today" : "No check-in yet"}</Text>
          <Text style={styles.heroSub}>
            {hasAnyData ? "Today's logged updates are below." : "We're waiting for today's update."}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function GridMetric({
  icon,
  color,
  label,
  value,
  sub,
  pillText,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  value: string;
  sub?: string;
  pillText: string;
}) {
  return (
    <Card style={styles.gridCard}>
      <View style={[styles.gridRing, { borderColor: color + "40" }]}>
        <Ionicons name={icon} size={19} color={color} />
      </View>
      <Text style={styles.gridLabel}>{label}</Text>
      <Text style={styles.gridValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? (
        <Text style={styles.gridSub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
      <View style={[styles.gridPill, { backgroundColor: color + "1a" }]}>
        <Text style={[styles.gridPillText, { color }]} numberOfLines={2}>
          {pillText}
        </Text>
      </View>
    </Card>
  );
}

function SleepCard({ quality, hours }: { quality: number | null; hours: number | null }) {
  const band = sleepBand(quality);
  return (
    <GridMetric
      icon="moon"
      color={BAND_COLOR[band]}
      label="Sleep quality"
      value={sleepLabel(quality)}
      sub={`${quality ?? "—"} / 5${hours != null ? ` · ${hours}h` : ""}`}
      pillText={quality === null ? "Awaiting update" : "Logged"}
    />
  );
}

function WaterCard({
  totalMl,
  goalMl,
  pct,
  hasGoal,
}: {
  totalMl: number;
  goalMl: number;
  pct: number;
  hasGoal: boolean;
}) {
  void hasGoal;
  return (
    <GridMetric
      icon="water"
      color="#2f7df6"
      label="Water intake"
      value={`${litres(totalMl)} / ${litres(goalMl)} L goal`}
      sub={`${litres(totalMl)}L consumed · ${pct}%`}
      pillText={`Goal: ${litres(goalMl)} Liters`}
    />
  );
}

function AttendanceCard({ status, note }: { status: string | null; note: string | null }) {
  const band = attendanceBand(status);
  return (
    <GridMetric
      icon="checkmark-circle-outline"
      color={BAND_COLOR[band]}
      label="Attendance"
      value={attendanceLabel(status)}
      sub={note ?? undefined}
      pillText={status === null ? "Awaiting update" : "Logged"}
    />
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 22 },
  stack: { gap: 12 },
  athleteSwitch: { gap: 8, paddingBottom: 12 },
  athleteChip: {
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 4,
    paddingRight: 14,
  },
  athleteAvatar: {
    height: 28,
    width: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  athleteAvatarText: { fontSize: 10, fontWeight: "800", color: colors.inkMuted },
  athleteChipText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  notice: { borderWidth: 1, borderColor: colors.bad + "55", backgroundColor: colors.bad + "14", borderRadius: radius.md, padding: 10, marginBottom: 12 },
  noticeText: { color: colors.bad, fontSize: 13, fontWeight: "700" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  heroCard: { padding: 16 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  heroRing: {
    height: 56,
    width: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  heroLabel: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1.5 },
  heroTitle: { marginTop: 3, fontSize: 18, fontWeight: "800", color: colors.ink },
  heroSub: { marginTop: 2, fontSize: 12, color: colors.inkMuted },
  grid3: { flexDirection: "row", gap: 10 },
  gridSlot: { flex: 1 },
  gridCard: { flex: 1, alignItems: "center", padding: 12, gap: 4 },
  gridRing: {
    height: 48,
    width: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  gridLabel: { fontSize: 9, fontWeight: "900", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1, textAlign: "center" },
  gridValue: { fontSize: 14, fontWeight: "800", color: colors.ink, textAlign: "center", maxWidth: "100%" },
  gridSub: { fontSize: 10, color: colors.inkMuted, textAlign: "center" },
  gridPill: { marginTop: 4, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 4, maxWidth: "100%", alignSelf: "stretch" },
  gridPillText: { fontSize: 8.5, fontWeight: "800", textAlign: "center", lineHeight: 11 },
});
