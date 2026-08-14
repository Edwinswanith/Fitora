import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import { apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { SESSION_SLOTS, type SessionSlot } from "../../lib/sessions";
import { Card, Muted } from "../../components/ui";
import { Avatar } from "../../components/Avatar";
import { ScreenHeader } from "../../components/ScreenHeader";
import { DatePickerPill } from "../../components/DatePickerPill";
import { useAutoStartMobileTour, useTourHighlight, useTourScrollView } from "../../lib/tour/MobileTourProvider";
import { SpotlightTarget } from "../../lib/tour/SpotlightTarget";

type DailyCard = {
  athleteId: string;
  name: string;
  sport: string;
  position?: string | null;
  attendance?: { status: string | null; note?: string | null };
  sessions?: Record<SessionSlot, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  injury?: { active: boolean; bodyPart: string | null; severity?: string | null; restriction?: string | null };
  rpe?: {
    calculatedTrainingLoad: number;
    riskFlag: "green" | "amber" | "red";
  } | null;
};

type DashboardResponse = { date: string; count: number; cards: DailyCard[] };
type SquadPoint = {
  date: string;
  avgReadiness: number | null;
  attendanceRate: number | null;
  avgLoad: number | null;
  redFlags: number;
  athleteCount: number;
};
type NotesInbox = {
  openCount: number;
  notes: { noteId: string; athleteId: string; athleteName: string; date: string; body: string; needsReply: boolean }[];
};
type RosterFilter = "all" | "attention" | "injury" | "nocheck";
type CoachAskReportRow = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  status: string;
  detail: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  action?: "attention" | "injury" | "nocheck" | "roster" | "notes" | "analytics" | "messages" | "announcements";
};
type CoachAskReport = {
  title: string;
  subtitle: string;
  summary: string;
  rows: CoachAskReportRow[];
};

const ROSTER_FILTERS: { key: RosterFilter; label: string; icon?: keyof typeof Ionicons.glyphMap; color?: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Attention", icon: "megaphone-outline", color: colors.warn },
  { key: "injury", label: "Injury", icon: "bandage-outline", color: colors.bad },
  { key: "nocheck", label: "No check-in", icon: "time-outline", color: colors.inkMuted },
];

function today() {
  return new Date().toISOString().slice(0, 10);
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

function reportDateFromCommand(command: string, currentDate: string): string {
  const lower = command.toLowerCase();
  if (/\byesterday\b/.test(lower)) return addDays(today(), -1);
  if (/\btomorrow\b/.test(lower)) return addDays(today(), 1);
  if (/\bnext day\b/.test(lower)) return addDays(currentDate, 1);
  if (/\b(previous|prev|back) day\b/.test(lower)) return addDays(currentDate, -1);
  if (/\btoday\b/.test(lower)) return today();
  return currentDate;
}

function isDateOnlyCommand(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return (
    /\b(calendar|calender|date picker|pick date)\b/.test(lower) ||
    /^(?:open|show|go to|move|switch|change|set)?\s*(?:to\s+)?(?:today|yesterday|tomorrow)\b/.test(lower) ||
    /\b(next|previous|prev|back) day\b/.test(lower)
  );
}

const DANGER = { bg: "#fdecec", border: "#f7c9c9", chipBg: "#fbd9d9", chipBorder: "#f3b3b3" };

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function band(score: number | null): { label: string; color: string } {
  if (score == null) return { label: "-", color: colors.inkFaint };
  if (score >= 80) return { label: String(score), color: colors.ok };
  if (score >= 60) return { label: String(score), color: colors.warn };
  return { label: String(score), color: colors.bad };
}

function riskColor(risk: "green" | "amber" | "red"): string {
  if (risk === "green") return colors.ok;
  if (risk === "amber") return colors.warn;
  return colors.bad;
}

function attentionRank(card: DailyCard): number {
  if (card.rpe?.riskFlag === "red") return 0;
  if (card.injury?.active) return 0.5;
  if (card.readinessScore !== null && card.readinessScore < 60) return 1;
  if (card.rpe?.riskFlag === "amber") return 1.5;
  if (card.readinessScore !== null && card.readinessScore < 80) return 2;
  return 3;
}

function attentionReason(card: DailyCard): string {
  if (card.rpe?.riskFlag === "red") return "High RPM risk";
  if (card.injury?.active) return card.injury.bodyPart ? `Injury - ${card.injury.bodyPart}` : "Injury";
  if (card.readinessScore !== null && card.readinessScore < 60) return `Low readiness ${card.readinessScore}`;
  if (card.rpe?.riskFlag === "amber") return "RPM caution";
  if (card.readinessScore !== null && card.readinessScore < 80) return `Readiness ${card.readinessScore}`;
  return "Check in";
}

export default function CoachDashboard() {
  useAutoStartMobileTour("coach");
  const { highlightStyle: headerHighlight } = useTourHighlight("mobile-coach-header");
  const { highlightStyle: kpiHighlight } = useTourHighlight("mobile-coach-kpis");
  const { highlightStyle: attentionHighlight } = useTourHighlight("mobile-coach-attention");
  const { highlightStyle: notesHighlight } = useTourHighlight("mobile-coach-notes");
  const { highlightStyle: analyticsHighlight } = useTourHighlight("mobile-coach-analytics");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const accent = ROLE_THEMES.coach.accent;
  const router = useRouter();
  const params = useLocalSearchParams<{ ask?: string; t?: string }>();
  const [date, setDate] = useState(() => today());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [squadSeries, setSquadSeries] = useState<SquadPoint[]>([]);
  const [notesInbox, setNotesInbox] = useState<NotesInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [askReport, setAskReport] = useState<CoachAskReport | null>(null);
  const [askInputOpen, setAskInputOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [calendarOpenSignal, setCalendarOpenSignal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboardResult, squadResult, notesResult] = await Promise.allSettled([
        apiJson<DashboardResponse>(`/api/coach/dashboard?date=${date}`),
        apiJson<{ series: SquadPoint[] }>("/api/coach/analytics/squad?days=30"),
        apiJson<NotesInbox>("/api/coach/notes-inbox?days=14"),
      ]);
      if (dashboardResult.status !== "fulfilled") throw new Error("dashboard_failed");
      setData(dashboardResult.value);
      setSquadSeries(squadResult.status === "fulfilled" ? squadResult.value.series ?? [] : []);
      setNotesInbox(notesResult.status === "fulfilled" ? notesResult.value : null);
    } catch {
      setError("Couldn't load your squad. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (params.ask === "calendar") setCalendarOpenSignal((value) => value + 1);
  }, [params.ask, params.t]);

  const cards = useMemo(() => data?.cards ?? [], [data?.cards]);
  const ranked = useMemo(
    () =>
      [...cards].sort(
        (a, b) => attentionRank(a) - attentionRank(b) || (a.readinessScore ?? 101) - (b.readinessScore ?? 101)
      ),
    [cards]
  );
  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter((card) => {
      if (
        q &&
        !card.name.toLowerCase().includes(q) &&
        !(card.sport ?? "").toLowerCase().includes(q) &&
        !(card.position ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filter === "attention") return attentionRank(card) < 2;
      if (filter === "injury") return Boolean(card.injury?.active);
      if (filter === "nocheck") return card.readinessScore === null;
      return true;
    });
  }, [filter, query, ranked]);
  const attentionCards = ranked.filter((card) => attentionRank(card) < 2);
  const present = cards.filter((card) => card.attendance?.status === "present").length;
  const completed = cards.filter((card) =>
    SESSION_SLOTS.some((slot) => card.sessions?.[slot]?.status === "completed")
  ).length;
  const withReadiness = cards.filter((card) => card.readinessScore != null);
  const avg =
    withReadiness.length > 0
      ? Math.round(withReadiness.reduce((sum, card) => sum + (card.readinessScore ?? 0), 0) / withReadiness.length)
      : null;
  const headerSubtitle =
    cards.length === 0
      ? "No athletes assigned"
      : `${cards.length} athlete${cards.length === 1 ? "" : "s"} - ${attentionCards.length} need attention`;

  function openAthlete(card: DailyCard) {
    router.push({
      pathname: "/coach/athletes/[athleteId]",
      params: { athleteId: card.athleteId, name: card.name },
    } as never);
  }

  function showAskReport(report: CoachAskReport) {
    setAskReport(report);
  }

  function athleteRows(list: DailyCard[], emptyLabel: string): CoachAskReportRow[] {
    if (!list.length) {
      return [{
        id: "empty",
        icon: "checkmark-done-outline",
        label: emptyLabel,
        status: "0",
        detail: "No matching athletes found for this request.",
        tone: "ok",
      }];
    }
    return list.map((card) => ({
      id: `athlete-${card.athleteId}`,
      icon: card.injury?.active ? "medkit-outline" : card.attendance?.status === "absent" ? "close-circle-outline" : "person-outline",
      label: card.name || "Athlete",
      status: card.readinessScore == null ? "-" : String(card.readinessScore),
      detail: [
        card.sport,
        card.position,
        card.attendance?.status ? `attendance ${card.attendance.status}` : null,
        card.injury?.active ? attentionReason(card) : null,
      ].filter(Boolean).join(" · ") || "No extra details.",
      tone: card.injury?.active || card.attendance?.status === "absent" ? "bad" : attentionRank(card) < 2 ? "warn" : "ok",
      action: "roster" as const,
    }));
  }

  function buildCoachReport(kind: "summary" | "attention" | "injury" | "absent" | "nocheck" | "notes" | "roster" | "best", sourceCards = cards, reportDate = date): CoachAskReport {
    const latest = squadSeries.length ? squadSeries[squadSeries.length - 1] : null;
    const sourceRanked = [...sourceCards].sort(
      (a, b) => attentionRank(a) - attentionRank(b) || (a.readinessScore ?? 101) - (b.readinessScore ?? 101)
    );
    const sourceAttention = sourceRanked.filter((card) => attentionRank(card) < 2);
    const sourcePresent = sourceCards.filter((card) => card.attendance?.status === "present").length;
    const sourceCompleted = sourceCards.filter((card) => SESSION_SLOTS.some((slot) => card.sessions?.[slot]?.status === "completed")).length;
    const sourceWithReadiness = sourceCards.filter((card) => card.readinessScore != null);
    const sourceAvg = sourceWithReadiness.length > 0
      ? Math.round(sourceWithReadiness.reduce((sum, card) => sum + (card.readinessScore ?? 0), 0) / sourceWithReadiness.length)
      : null;
    const attentionCount = sourceAttention.length;
    const injuryCount = sourceCards.filter((card) => card.injury?.active).length;
    const absentCards = sourceCards.filter((card) => card.attendance?.status === "absent");
    const nocheckCards = sourceCards.filter((card) => card.readinessScore === null);
    const nocheckCount = nocheckCards.length;
    const noteCount = notesInbox?.openCount ?? 0;
    const best = [...sourceCards].sort((a, b) => {
      const aSessions = SESSION_SLOTS.filter((slot) => a.sessions?.[slot]?.status === "completed").length;
      const bSessions = SESSION_SLOTS.filter((slot) => b.sessions?.[slot]?.status === "completed").length;
      const aPenalty = attentionRank(a) < 2 ? 30 : 0;
      const bPenalty = attentionRank(b) < 2 ? 30 : 0;
      const aScore = (a.readinessScore ?? 0) + aSessions * 8 - aPenalty;
      const bScore = (b.readinessScore ?? 0) + bSessions * 8 - bPenalty;
      return bScore - aScore;
    })[0] ?? null;
    const rows: CoachAskReportRow[] = [
      {
        id: "athletes",
        icon: "people-outline",
        label: "Athletes",
        status: String(sourceCards.length),
        detail: `${sourcePresent} present on ${reportDate}.`,
        tone: "neutral",
        action: "roster",
      },
      {
        id: "attention",
        icon: "alert-circle-outline",
        label: "Needs attention",
        status: String(attentionCount),
        detail: sourceAttention.slice(0, 2).map((card) => `${card.name}: ${attentionReason(card)}`).join(" · ") || "No current attention flags.",
        tone: attentionCount ? "bad" : "ok",
        action: "attention",
      },
      {
        id: "readiness",
        icon: "pulse-outline",
        label: "Avg readiness",
        status: sourceAvg == null ? "-" : String(sourceAvg),
        detail: latest?.avgReadiness == null ? "Current dashboard average." : `30d latest readiness ${Math.round(latest.avgReadiness)}.`,
        tone: sourceAvg == null ? "neutral" : sourceAvg >= 75 ? "ok" : sourceAvg >= 60 ? "warn" : "bad",
        action: "analytics",
      },
      {
        id: "load",
        icon: "flame-outline",
        label: "Avg load",
        status: latest?.avgLoad == null ? "-" : String(Math.round(latest.avgLoad)),
        detail: `${latest?.redFlags ?? attentionCards.filter((card) => card.rpe?.riskFlag === "red").length} red load flag${(latest?.redFlags ?? 0) === 1 ? "" : "s"}.`,
        tone: (latest?.redFlags ?? 0) > 0 ? "warn" : "ok",
        action: "analytics",
      },
      {
        id: "sessions",
        icon: "checkmark-done-outline",
        label: "Sessions done",
        status: String(sourceCompleted),
        detail: `${sourceCompleted} athlete${sourceCompleted === 1 ? "" : "s"} have a completed session on ${reportDate}.`,
        tone: sourceCompleted >= sourceCards.length ? "ok" : "warn",
        action: "analytics",
      },
      {
        id: "notes",
        icon: "document-text-outline",
        label: "Athlete notes",
        status: String(noteCount),
        detail: notesInbox ? `${noteCount} note${noteCount === 1 ? "" : "s"} need reply.` : "Notes are not loaded yet.",
        tone: noteCount ? "warn" : "ok",
        action: "notes",
      },
    ];
    const filtered =
      kind === "attention" ? rows.filter((row) => row.id === "attention" || row.id === "load" || row.id === "readiness")
      : kind === "best" ? [
          {
            id: "best-athlete",
            icon: "trophy-outline" as keyof typeof Ionicons.glyphMap,
            label: best?.name ?? "Best athlete",
            status: best?.readinessScore == null ? "-" : String(best.readinessScore),
            detail: best
              ? `Top today from readiness, completed sessions, and risk flags. ${attentionRank(best) < 2 ? attentionReason(best) : "No major risk flag."}`
              : "No athlete data is available yet.",
            tone: best && attentionRank(best) >= 2 ? "ok" as const : "warn" as const,
            action: "roster" as const,
          },
        ]
      : kind === "injury" ? athleteRows(sourceCards.filter((card) => card.injury?.active), "No injured athletes")
      : kind === "absent" ? athleteRows(absentCards, "No absent athletes")
      : kind === "nocheck" ? athleteRows(nocheckCards, "Everyone checked in")
      : kind === "notes" ? rows.filter((row) => row.id === "notes" || row.id === "athletes")
      : kind === "roster" ? athleteRows(sourceRanked, "No athletes")
      : rows;
    return {
      title:
        kind === "attention" ? "Attention Report"
        : kind === "best" ? "Best Athlete"
        : kind === "injury" ? "Injury Report"
        : kind === "absent" ? "Absent Athletes"
        : kind === "nocheck" ? "Check-in Report"
        : kind === "notes" ? "Athlete Notes"
        : kind === "roster" ? "Roster Report"
        : "Squad Report",
      subtitle: reportDate,
      summary:
        kind === "best"
          ? (best ? `${best.name} is top today from readiness, completed sessions, and risk flags.` : "No athlete data is available yet.")
          : kind === "injury"
            ? `${injuryCount} injured athlete${injuryCount === 1 ? "" : "s"} on ${reportDate}.`
            : kind === "absent"
              ? `${absentCards.length} absent athlete${absentCards.length === 1 ? "" : "s"} on ${reportDate}.`
              : kind === "nocheck"
                ? `${nocheckCount} athlete${nocheckCount === 1 ? "" : "s"} have not checked in on ${reportDate}.`
                : `${sourceCards.length} athletes · ${sourcePresent} present · ${sourceCompleted} sessions done · readiness ${sourceAvg == null ? "-" : sourceAvg}`,
      rows: filtered,
    };
  }

  async function buildCoachReportForCommand(kind: "summary" | "attention" | "injury" | "absent" | "nocheck" | "notes" | "roster" | "best", command: string) {
    const reportDate = reportDateFromCommand(command, date);
    if (reportDate === date) return buildCoachReport(kind);
    const reportData = await apiJson<DashboardResponse>(`/api/coach/dashboard?date=${reportDate}`);
    setDate(reportDate);
    return buildCoachReport(kind, reportData.cards ?? [], reportData.date);
  }

  function handleAskReportRow(row: CoachAskReportRow) {
    setAskReport(null);
    if (row.action === "messages") return router.push("/coach/messages" as never);
    if (row.action === "announcements") return router.push("/coach/announcements" as never);
    if (row.action === "attention") return setFilter("attention");
    if (row.action === "injury") return setFilter("injury");
    if (row.action === "nocheck") return setFilter("nocheck");
    if (row.action === "roster") {
      setQuery("");
      return setFilter("all");
    }
    if (row.action === "notes" || row.action === "analytics") return;
  }

  async function handleAskAgent(command: string) {
    const lower = command.toLowerCase().replace(/\bcouch\b/g, "coach").trim();
    setAskReport(null);
    if (!lower) {
      showAskReport({
        title: "Ask Agent",
        subtitle: "Coach commands",
        summary: "Try: squad report, show attention, open roster, open messages, or add athlete.",
        rows: [],
      });
      return;
    }
    const mentionedAthlete = cards.find((card) => {
      const name = card.name.toLowerCase();
      return name && (lower.includes(name) || name.split(/\s+/).some((part) => part.length > 2 && lower.includes(part)));
    });
    if (mentionedAthlete && /\b(open|show|view|see|check|profile|details?)\b/.test(lower)) {
      openAthlete(mentionedAthlete);
      return;
    }
    if (/\b(notification|notifications|bell|alerts?)\b/.test(lower)) {
      router.push("/notifications" as never);
      return;
    }
    if (isDateOnlyCommand(lower)) {
      if (/\b(calendar|calender|date picker|pick date)\b/.test(lower)) {
        setCalendarOpenSignal((value) => value + 1);
        return;
      }
      setDate(reportDateFromCommand(lower, date));
      return;
    }
    if (/\b(message|messages|chat|inbox|dm|direct)\b/.test(lower)) {
      router.push("/coach/messages" as never);
      return;
    }
    if (/\b(announce|announcement|announcements|broadcast)\b/.test(lower)) {
      router.push("/coach/announcements" as never);
      return;
    }
    if (/\b(add|create|new|invite)\b.*\b(athlete|player|student)\b/.test(lower) || /\b(add athlete|new athlete)\b/.test(lower)) {
      router.push("/coach/athletes/new" as never);
      return;
    }
    if (/\b(attention|needs attention|risk|risks|flag|flags|red flag|low readiness|who needs|need attention)\b/.test(lower)) {
      setFilter("attention");
      showAskReport(await buildCoachReportForCommand("attention", lower));
      return;
    }
    if (/\b(absent|absented|absence|missing|not present|who is absent|who are absent)\b/.test(lower)) {
      showAskReport(await buildCoachReportForCommand("absent", lower));
      return;
    }
    if (/\b(injury|injuries|injured|hurt|pain)\b/.test(lower)) {
      setFilter("injury");
      showAskReport(await buildCoachReportForCommand("injury", lower));
      return;
    }
    if (/\b(no check|no check-in|not check|not check-in|nocheck|missing check|not checked|without check|check-int|checked in|check in)\b/.test(lower) && /\b(no|not|missing|without|who|which)\b/.test(lower)) {
      setFilter("nocheck");
      showAskReport(await buildCoachReportForCommand("nocheck", lower));
      return;
    }
    if (/\b(best|top|strongest|highest|leader|leading)\b.*\b(athlete|player|student|performer)\b/.test(lower) || /\bwho\s+is\s+(?:the\s+)?best\b/.test(lower)) {
      showAskReport(await buildCoachReportForCommand("best", lower));
      return;
    }
    if (/\b(note|notes|reply|replies|feedback)\b/.test(lower)) {
      showAskReport(await buildCoachReportForCommand("notes", lower));
      return;
    }
    if (/\b(analytics|trend|trends|report|reports|summary|readiness|attendance|present|load|sessions?)\b/.test(lower)) {
      showAskReport(await buildCoachReportForCommand("summary", lower));
      return;
    }
    if (/\b(list|listout|list out|show|who|which)\b.*\b(roster|athletes|athlete|players|player|squad|team)\b/.test(lower) || /\b(roster|athletes|players|squad|team|all)\b/.test(lower)) {
      setFilter("all");
      setQuery("");
      showAskReport(await buildCoachReportForCommand("roster", lower));
      return;
    }
    showAskReport({
      title: "Ask Agent",
      subtitle: "Coach commands",
      summary: "Try: show attention, open roster, open messages, open announcements, add athlete, show notes, or squad report.",
      rows: [],
    });
  }

  const filterCounts = useMemo(
    () => ({
      attention: cards.filter((card) => attentionRank(card) < 2).length,
      injury: cards.filter((card) => card.injury?.active).length,
      nocheck: cards.filter((card) => card.readinessScore === null).length,
    }),
    [cards]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        ref={tourScrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
      >
        <ScreenHeader
          title="Squad readiness"
          accent={accent}
          roleLabel="Coach"
          subtitle={headerSubtitle}
          dense
          inlineActions
          headerActions={
            <SpotlightTarget id="mobile-coach-header" style={[styles.headerActionRow, headerHighlight]}>
              <DatePickerPill value={date} onChange={setDate} accent={accent} accentInk="#fff" compact openSignal={calendarOpenSignal} />
              <Pressable
                onPress={() => router.push("/coach/athletes/new" as never)}
                style={[styles.addButton, { backgroundColor: accent }]}
                accessibilityLabel="Add athlete"
              >
                <Text style={styles.addButtonText}>+ Add</Text>
              </Pressable>
            </SpotlightTarget>
          }
        />

        {loading && !data ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card>
            <Muted>{error}</Muted>
          </Card>
        ) : (
          <>
            <SpotlightTarget id="mobile-coach-kpis" style={[styles.statGrid, kpiHighlight]}>
              <Stat
                label="Athletes"
                value={String(data?.count ?? 0)}
                caption="Total"
                icon="people"
                iconColor={colors.ok}
                iconBg={colors.ok + "16"}
              />
              <Stat
                label="Present"
                value={String(present)}
                caption="Today"
                icon="checkmark-circle"
                iconColor={colors.ok}
                iconBg={colors.ok + "16"}
              />
              <Stat
                label="Sessions done"
                value={String(completed)}
                caption="Today"
                icon="calendar"
                iconColor="#2f7df6"
                iconBg="#2f7df616"
              />
              <Stat
                label="Avg readiness"
                value={avg == null ? "-" : String(avg)}
                caption={avg == null ? "No data" : "Today"}
                icon="trending-up"
                iconColor={colors.warn}
                iconBg={colors.warn + "16"}
                highlight={band(avg).color}
              />
            </SpotlightTarget>

            {cards.length > 0 ? (
              <>
                {attentionCards.length > 0 ? (
                  <SpotlightTarget id="mobile-coach-attention" style={attentionHighlight}>
                  <Card style={styles.attentionCard}>
                    <View style={styles.sectionRow}>
                      <View style={styles.attentionLabelRow}>
                        <View style={styles.attentionIconTile}>
                          <Ionicons name="warning" size={13} color="#fff" />
                        </View>
                        <Text style={[styles.sectionLabel, { color: colors.bad }]}>Needs attention</Text>
                      </View>
                      <View style={styles.attentionCountBadge}>
                        <Text style={styles.attentionCountText}>{attentionCards.length}</Text>
                      </View>
                    </View>
                    <View style={styles.attentionList}>
                      {attentionCards.map((card) => (
                        <Pressable key={card.athleteId} onPress={() => openAthlete(card)} style={styles.attentionPill}>
                          <Avatar avatar={null} name={card.name || "Athlete"} size={30} accentSoft={DANGER.chipBg} accentStrong={colors.bad} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.attentionName} numberOfLines={1}>{card.name || "Athlete"}</Text>
                            <Text style={styles.attentionReason} numberOfLines={1}>{attentionReason(card).replace(" - ", " • ")}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
                        </Pressable>
                      ))}
                    </View>
                  </Card>
                  </SpotlightTarget>
                ) : null}

                <SpotlightTarget id="mobile-coach-notes" style={notesHighlight}>
                <CoachNotesInbox
                  inbox={notesInbox}
                  onOpen={(athleteId) => {
                    const card = cards.find((item) => item.athleteId === athleteId);
                    if (card) openAthlete(card);
                  }}
                  onViewAll={() => showAskReport(buildCoachReport("notes"))}
                />
                </SpotlightTarget>

                <SpotlightTarget id="mobile-coach-analytics" style={analyticsHighlight}>
                <SquadTrendCard series={squadSeries} />
                </SpotlightTarget>

                <View style={styles.rosterHeader}>
                  <Text style={styles.rosterHeaderTitle}>Full Roster</Text>
                  <Text style={styles.rosterMeta}>{filteredCards.length} of {cards.length}</Text>
                </View>

                <View style={styles.searchBlock}>
                  <View style={styles.searchWrap}>
                    <Ionicons name="search-outline" size={15} color={colors.inkFaint} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search name, sport, position..."
                      placeholderTextColor={colors.inkFaint}
                      style={styles.searchInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                    {ROSTER_FILTERS.map((item) => {
                      const active = item.key === filter;
                      const count =
                        item.key === "attention"
                          ? filterCounts.attention
                          : item.key === "injury"
                          ? filterCounts.injury
                          : item.key === "nocheck"
                          ? filterCounts.nocheck
                          : 0;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => setFilter(item.key)}
                          style={[styles.filterChip, active ? { backgroundColor: accent, borderColor: accent } : null]}
                        >
                          {item.icon && !active ? <Ionicons name={item.icon} size={13} color={item.color ?? colors.inkMuted} /> : null}
                          <Text
                            style={[
                              styles.filterText,
                              active ? { color: "#fff" } : item.color ? { color: item.color } : null,
                            ]}
                          >
                            {item.label}
                            {item.key !== "all" && count > 0 ? ` ${count}` : ""}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {filteredCards.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    {filteredCards.map((card) => (
                      <RosterRow key={card.athleteId} card={card} onPress={() => openAthlete(card)} />
                    ))}
                  </View>
                ) : (
                  <Card>
                    <Muted>No athletes match the current search or filter.</Muted>
                  </Card>
                )}
              </>
            ) : (
              <Card style={{ marginTop: 8 }}>
                <Text style={styles.emptyTitle}>No athletes on your squad yet.</Text>
                <Muted style={{ marginTop: 4 }}>Add athletes from the roster screen and they will appear here.</Muted>
              </Card>
            )}
          </>
        )}
      </ScrollView>
      {!askInputOpen ? <CoachAskReportSheet report={askReport} onClose={() => setAskReport(null)} onRowPress={handleAskReportRow} /> : null}
    </SafeAreaView>
  );
}

function CoachNotesInbox({
  inbox,
  onOpen,
  onViewAll,
}: {
  inbox: NotesInbox | null;
  onOpen: (athleteId: string) => void;
  onViewAll: () => void;
}) {
  const notes = inbox?.notes ?? [];
  const open = inbox?.openCount ?? 0;
  return (
    <Card style={styles.notesCard}>
      <View style={styles.sectionRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={styles.rosterTitle}>Athlete notes</Text>
          {notes.length > 0 ? <Chip label={open > 0 ? `${open} need reply` : "all replied"} color={open > 0 ? colors.warn : colors.ok} /> : null}
        </View>
        <Text style={styles.sectionCount}>14d</Text>
      </View>
      {inbox === null ? (
        <Text style={styles.noteEmpty}>Notes could not be loaded.</Text>
      ) : notes.length === 0 ? (
        <Text style={styles.noteEmpty}>No athlete notes in the last 14 days.</Text>
      ) : (
        <>
          <View style={styles.notesList}>
            {notes.slice(0, 4).map((note) => (
              <Pressable key={note.noteId} onPress={() => onOpen(note.athleteId)} style={styles.noteRow}>
                <Avatar avatar={null} name={note.athleteName} size={30} accentSoft={colors.ok + "16"} accentStrong={colors.ok} style={styles.noteAvatar} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.noteTop}>
                    <Text style={styles.noteName} numberOfLines={1}>{note.athleteName}</Text>
                    <Chip label={note.needsReply ? "needs reply" : "replied"} color={note.needsReply ? colors.warn : colors.ok} />
                    <Text style={styles.noteDate}>{shortDate(note.date)}</Text>
                  </View>
                  <Text style={styles.noteBody} numberOfLines={2}>{note.body}</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onViewAll} style={styles.noteViewAll}>
            <Text style={styles.noteViewAllText}>View all notes</Text>
            <Ionicons name="chevron-forward" size={14} color={ROLE_THEMES.coach.accent} />
          </Pressable>
        </>
      )}
    </Card>
  );
}

function reportToneColor(tone: CoachAskReportRow["tone"]) {
  if (tone === "ok") return colors.ok;
  if (tone === "warn") return colors.warn;
  if (tone === "bad") return colors.bad;
  return colors.inkMuted;
}

function CoachAskReportSheet({
  report,
  onClose,
  onRowPress,
}: {
  report: CoachAskReport | null;
  onClose: () => void;
  onRowPress: (row: CoachAskReportRow) => void;
}) {
  if (!report) return null;
  return (
    <View style={styles.askReportOverlay} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.askReportSheet}>
        <View style={styles.askReportHandle} />
        <View style={styles.askReportHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.askReportTitle}>{report.title}</Text>
            <Text style={styles.askReportSubtitle}>{report.subtitle}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.askReportClose} accessibilityRole="button" accessibilityLabel="Close result">
            <Ionicons name="close" size={18} color={colors.inkMuted} />
          </Pressable>
        </View>
        <View style={styles.askReportSummary}>
          <Ionicons name="sparkles-outline" size={15} color={ROLE_THEMES.coach.accent} />
          <Text style={styles.askReportSummaryText}>{report.summary}</Text>
        </View>
        {report.rows.length ? (
          <>
            <View style={styles.askReportTableHead}>
              <Text style={[styles.askReportHeadText, { flex: 1.2 }]}>Item</Text>
              <Text style={[styles.askReportHeadText, styles.askReportStatusHead]}>Status</Text>
            </View>
            <ScrollView style={styles.askReportScroll} contentContainerStyle={styles.askReportRows} showsVerticalScrollIndicator>
              {report.rows.map((row) => {
                const toneColor = reportToneColor(row.tone);
                return (
                  <Pressable
                    key={row.id}
                    onPress={() => onRowPress(row)}
                    style={({ pressed }) => [styles.askReportRow, row.action ? styles.askReportRowAction : null, pressed ? { opacity: 0.82 } : null]}
                    accessibilityRole={row.action ? "button" : undefined}
                    accessibilityLabel={row.action ? `Open ${row.label}` : undefined}
                  >
                    <View style={[styles.askReportIconBox, { backgroundColor: `${toneColor}16`, borderColor: `${toneColor}44` }]}>
                      <Ionicons name={row.icon} size={16} color={toneColor} />
                    </View>
                    <View style={styles.askReportMainCell}>
                      <Text style={styles.askReportLabel} numberOfLines={1}>{row.label}</Text>
                      <Text style={styles.askReportDetail} numberOfLines={2}>{row.detail}</Text>
                    </View>
                    <View style={[styles.askReportStatusPill, { borderColor: `${toneColor}44`, backgroundColor: `${toneColor}12` }]}>
                      <Text style={[styles.askReportStatusText, { color: toneColor }]} numberOfLines={1}>{row.status}</Text>
                    </View>
                    {row.action ? <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </View>
    </View>
  );
}

function SquadTrendCard({ series }: { series: SquadPoint[] }) {
  const points = series;
  const latest = series.length > 0 ? series[series.length - 1] : null;
  return (
    <Card style={styles.trendCard}>
      <View style={styles.sectionRow}>
        <View>
          <Text style={styles.rosterTitle}>Squad analytics</Text>
          <Text style={styles.trendSubtitle}>
            {latest ? `${latest.athleteCount} logging • ${latest.redFlags} red flag${latest.redFlags === 1 ? "" : "s"}` : "Across assigned athletes"}
          </Text>
        </View>
        <Text style={styles.sectionCount}>30d</Text>
      </View>
      {points.length === 0 ? (
        <Text style={styles.noteEmpty}>No trend data yet.</Text>
      ) : (
        <>
          <View style={styles.trendTiles}>
            <MiniMetric
              label="Readiness"
              value={latest?.avgReadiness == null ? "-" : String(Math.round(latest.avgReadiness))}
              caption={latest?.avgReadiness == null ? "No data" : undefined}
              color={colors.ok}
              icon="trending-up"
            />
            <MiniMetric
              label="Attendance"
              value={latest?.attendanceRate == null ? "-" : `${Math.round(latest.attendanceRate)}%`}
              caption={latest?.attendanceRate == null ? "No data" : undefined}
              color="#2f7df6"
              icon="trending-up"
            />
            <MiniMetric
              label="Avg load"
              value={latest?.avgLoad == null ? "-" : String(Math.round(latest.avgLoad))}
              caption={latest?.avgLoad == null ? "No data" : undefined}
              color={colors.warn}
              icon="trending-up"
            />
          </View>
          <SquadLineChart points={points} />
          <View style={styles.legendRow}>
            <Legend color={colors.warn} label="Load" />
            <Legend color={colors.ok} label="Readiness" />
            <Legend color="#2f7df6" label="Attendance" />
          </View>
        </>
      )}
    </Card>
  );
}

function SquadLineChart({ points }: { points: SquadPoint[] }) {
  const [width, setWidth] = useState(0);
  const height = 96;
  const top = 8;
  const bottom = 20;
  const plotH = height - top - bottom;
  const maxLoad = Math.max(1, ...points.map((point) => point.avgLoad ?? 0));

  function x(index: number) {
    return points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
  }
  function yPct(value: number | null) {
    const pct = Math.max(0, Math.min(100, value ?? 0));
    return top + plotH * (1 - pct / 100);
  }
  function yLoad(value: number | null) {
    const pct = Math.max(0, Math.min(1, (value ?? 0) / maxLoad));
    return top + plotH * (1 - pct);
  }
  function pathFor(getY: (point: SquadPoint) => number) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${getY(point).toFixed(1)}`).join(" ");
  }

  const labelStep = Math.max(1, Math.round(points.length / 5));

  return (
    <View style={styles.chart} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Path d={pathFor((point) => yLoad(point.avgLoad))} stroke={colors.warn} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={pathFor((point) => yPct(point.attendanceRate))} stroke="#2f7df6" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={pathFor((point) => yPct(point.avgReadiness))} stroke={colors.ok} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => (
            <Circle key={`dot-${point.date}`} cx={x(index)} cy={yPct(point.avgReadiness)} r={2.4} fill={colors.ok} />
          ))}
          {points.map((point, index) =>
            index % labelStep === 0 || index === points.length - 1 ? (
              <SvgText
                key={`label-${point.date}`}
                x={Math.min(width - 16, Math.max(16, x(index)))}
                y={height - 6}
                fill={colors.inkFaint}
                fontSize="9"
                fontWeight="700"
                textAnchor="middle"
              >
                {shortDate(point.date)}
              </SvgText>
            ) : null
          )}
        </Svg>
      ) : null}
    </View>
  );
}

function MiniMetric({
  label,
  value,
  caption,
  color,
  icon,
}: {
  label: string;
  value: string;
  caption?: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.miniMetric}>
      <View style={styles.miniMetricTop}>
        <Ionicons name={icon} size={12} color={color} />
        <Text style={styles.miniMetricLabel}>{label}</Text>
      </View>
      <Text style={[styles.miniMetricValue, { color }]}>{value}</Text>
      {caption ? <Text style={styles.miniMetricCaption}>{caption}</Text> : null}
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legend}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Stat({
  label,
  value,
  caption,
  icon,
  iconColor,
  iconBg,
  highlight,
}: {
  label: string;
  value: string;
  caption?: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  highlight?: string;
}) {
  return (
    <Card style={styles.stat}>
      <View style={styles.statTop}>
        <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={15} color={iconColor} />
        </View>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, highlight ? { color: highlight } : null]}>{value}</Text>
      {caption ? <Text style={styles.statCaption}>{caption}</Text> : null}
    </Card>
  );
}

function RosterRow({ card, onPress }: { card: DailyCard; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card style={styles.athleteCard}>
        <Avatar avatar={null} name={card.name || "Athlete"} size={42} accentSoft={colors.ok + "16"} accentStrong={colors.ok} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.athleteName} numberOfLines={1}>{card.name || "Athlete"}</Text>
            {card.injury?.active ? <Chip label="Injury" color={colors.bad} mixedCase /> : null}
            {card.rpe ? <Chip label={card.rpe.riskFlag} color={riskColor(card.rpe.riskFlag)} /> : null}
          </View>
          <Text style={styles.athleteSport} numberOfLines={1}>
            {[card.sport, card.position, card.attendance?.status].filter(Boolean).join(" • ") || "-"}
          </Text>
        </View>
        <View style={styles.loadBlock}>
          {card.rpe ? (
            <>
              <Text style={styles.loadValue}>{card.rpe.calculatedTrainingLoad}</Text>
              <Text style={styles.loadLabel}>load</Text>
            </>
          ) : (
            <Text style={styles.noRpe}>No RPE</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
      </Card>
    </Pressable>
  );
}

function Chip({ label, color, mixedCase }: { label: string; color: string; mixedCase?: boolean }) {
  return (
    <View style={[styles.chip, { backgroundColor: color + "18" }]}>
      <Text style={[styles.chipText, mixedCase ? { textTransform: "none" } : null, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 26 },
  headerActionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  addButton: { height: 38, borderRadius: radius.md, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  addButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  askReportOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1600,
    elevation: 28,
    justifyContent: "flex-end",
  },
  askReportSheet: {
    marginHorizontal: 12,
    marginBottom: 86,
    maxHeight: 340,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  askReportHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 999, backgroundColor: colors.lineStrong, marginBottom: 10 },
  askReportHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  askReportTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  askReportSubtitle: { marginTop: 1, color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  askReportClose: {
    height: 34,
    width: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  askReportSummary: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${ROLE_THEMES.coach.accent}22`,
    backgroundColor: "#e9f8f2",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  askReportSummaryText: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12, fontWeight: "800" },
  askReportTableHead: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 6,
  },
  askReportHeadText: { color: colors.inkFaint, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4 },
  askReportStatusHead: { width: 78, textAlign: "center" },
  askReportScroll: { maxHeight: 190 },
  askReportRows: { paddingTop: 4, gap: 6 },
  askReportRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  askReportRowAction: { borderWidth: 1, borderColor: "rgba(0,0,0,0.03)" },
  askReportIconBox: {
    height: 34,
    width: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  askReportMainCell: { flex: 1, minWidth: 0 },
  askReportLabel: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  askReportDetail: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 14 },
  askReportStatusPill: {
    width: 78,
    minHeight: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
  },
  askReportStatusText: { fontSize: 11, fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  stat: { flexGrow: 1, flexBasis: "47%", padding: 12 },
  statTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  statIcon: { height: 26, width: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 10, color: colors.inkMuted, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.ink, marginTop: 8 },
  statCaption: { fontSize: 11, color: colors.inkFaint, fontWeight: "700", marginTop: 2 },
  attentionCard: { marginBottom: 16, gap: 10, backgroundColor: DANGER.bg, borderColor: DANGER.border },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  attentionLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  attentionIconTile: { height: 26, width: 26, borderRadius: 13, backgroundColor: colors.bad, alignItems: "center", justifyContent: "center" },
  attentionCountBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: DANGER.chipBg, borderWidth: 1, borderColor: DANGER.chipBorder, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  attentionCountText: { color: colors.bad, fontSize: 11, fontWeight: "900" },
  sectionLabel: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  sectionCount: { color: colors.inkFaint, fontSize: 12, fontWeight: "800" },
  attentionList: { gap: 8 },
  attentionPill: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
  },
  attentionName: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  attentionReason: { marginTop: 1, color: colors.inkMuted, fontSize: 11 },
  rosterHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  rosterTitle: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  rosterHeaderTitle: { color: colors.ink, fontSize: 19, fontWeight: "800" },
  rosterMeta: { color: colors.inkFaint, fontSize: 11, fontWeight: "700" },
  searchBlock: { gap: 8, marginBottom: 12 },
  searchWrap: {
    height: 46,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  filterRow: { gap: 6, paddingRight: 2 },
  filterChip: {
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  filterText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800" },
  notesCard: { marginBottom: 16, gap: 10 },
  notesList: { gap: 8 },
  noteEmpty: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
  noteRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  noteAvatar: { marginTop: 1 },
  noteTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  noteName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12, fontWeight: "800" },
  noteDate: { color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  noteBody: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  noteViewAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 4 },
  noteViewAllText: { color: ROLE_THEMES.coach.accent, fontSize: 12, fontWeight: "900" },
  trendCard: { marginBottom: 16, gap: 12 },
  trendSubtitle: { color: colors.inkFaint, fontSize: 11, marginTop: 3 },
  trendTiles: { flexDirection: "row", gap: 8 },
  miniMetric: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
  },
  miniMetricTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  miniMetricLabel: { color: colors.inkFaint, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  miniMetricValue: { fontSize: 18, fontWeight: "900", marginTop: 4 },
  miniMetricCaption: { fontSize: 10, color: colors.inkFaint, fontWeight: "700", marginTop: 1 },
  chart: {
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceInset,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legend: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { height: 8, width: 8, borderRadius: 4 },
  legendText: { color: colors.inkFaint, fontSize: 10, fontWeight: "800" },
  athleteCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  athleteName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  athleteSport: { fontSize: 13, color: colors.inkMuted, marginTop: 2, textTransform: "capitalize" },
  chip: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  loadBlock: { minWidth: 52, alignItems: "flex-end" },
  loadValue: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  loadLabel: { color: colors.inkFaint, fontSize: 10 },
  noRpe: { color: colors.inkFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
