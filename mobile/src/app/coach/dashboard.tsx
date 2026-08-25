import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AlertBanner,
  AppCard,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  MetricTile,
  PrimaryAppBar,
  RowLink,
  ScreenContainer,
  SectionHeader,
} from "../../components/fitora";
import { Avatar } from "../../components/Avatar";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { colors } from "../../lib/theme";
import {
  attentionRank,
  attentionReason,
  firstName,
  loadCoachHomeData,
  longDate,
  nextFutureSession,
  titleCase,
  useAsyncData,
  type CoachHomeData,
  type DailyCard,
} from "../../lib/fitoraData";

export default function CoachHome() {
  const state = useAsyncData(loadCoachHomeData, []);

  if (state.loading && !state.data) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer>
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  if (!state.data) return null;

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <CoachHomeView data={state.data} />
    </ScreenContainer>
  );
}

function CoachHomeView({ data }: { data: CoachHomeData }) {
  const router = useRouter();
  const { user } = useAuth();
  const [sessionPanel, setSessionPanel] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);
  const attention = useMemo(
    () => [...data.cards].filter((card) => attentionRank(card) < 2.5).sort((a, b) => attentionRank(a) - attentionRank(b)).slice(0, 4),
    [data.cards]
  );
  const rosterByAthleteId = useMemo(
    () => new Map(data.roster.map((athlete) => [athlete.athleteId, athlete])),
    [data.roster]
  );
  const nextSession = nextFutureSession(data.sessions);
  const sessionsToday = data.sessions.filter((session) => session.scheduledStart.slice(0, 10) === data.date && session.status !== "cancelled").length;
  const trainingToday = data.cards.filter((card) => Object.values(card.sessions ?? {}).some((session) => session?.status)).length;
  const activityRows = buildActivityRows(data);
  const activeClients = data.roster.length;
  const trainingCount = trainingToday;
  const riskAlerts = attention.length;
  const nextSessionCountdown = nextSession ? minutesUntilLabel(nextSession.scheduledStart) : null;

  async function startSession() {
    if (!nextSession) return;
    setSessionBusy("start");
    setSessionMessage(null);
    try {
      const res = await apiFetch(`/api/coach/sessions/${nextSession.id}/join-token`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSessionMessage(json.error === "join_window_closed" ? "Session can only be started inside the join window." : "Could not start this session yet.");
        return;
      }
      setSessionPanel(true);
      setSessionMessage(`Video room ready: ${json.video?.roomRef ?? "live session"}`);
    } catch {
      setSessionMessage("Network error while starting session.");
    } finally {
      setSessionBusy(null);
    }
  }

  async function completeSession() {
    if (!nextSession) return;
    setSessionBusy("complete");
    setSessionMessage(null);
    try {
      const res = await apiFetch(`/api/coach/sessions/${nextSession.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ summary: "Completed from Fitora mobile.", coachNotes: "Session marked complete in coach dashboard." }),
      });
      if (!res.ok) {
        setSessionMessage("Could not complete this session.");
        return;
      }
      setSessionMessage("Session marked complete.");
    } catch {
      setSessionMessage("Network error while completing session.");
    } finally {
      setSessionBusy(null);
    }
  }

  async function rescheduleSession(days: number) {
    if (!nextSession) return;
    setSessionBusy("reschedule");
    setSessionMessage(null);
    try {
      const nextStart = new Date(nextSession.scheduledStart);
      nextStart.setDate(nextStart.getDate() + days);
      const res = await apiFetch(`/api/coach/sessions/${nextSession.id}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledStart: nextStart.toISOString(), note: "Rescheduled from Fitora mobile." }),
      });
      if (!res.ok) {
        setSessionMessage("Could not reschedule this session.");
        return;
      }
      setSessionMessage("Session rescheduled.");
    } catch {
      setSessionMessage("Network error while rescheduling session.");
    } finally {
      setSessionBusy(null);
    }
  }

  return (
    <>
      <PrimaryAppBar
        greeting={`Good morning, ${firstName(user?.name, "Coach")}`}
        title={longDate(data.date)}
      />

      {nextSession ? (
        <AppCard>
          <View style={styles.sessionHead}>
            <IconTile icon="calendar-outline" size={46} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blueTitle}>Next Session</Text>
              <Text style={styles.cardTitle}>{nextSession.athleteName || "Client"}</Text>
              <Text style={styles.muted}>{titleCase(nextSession.type)}</Text>
              <Text style={styles.muted}>{coachSessionSummary(nextSession)}</Text>
              {nextSessionCountdown ? <Text style={styles.timeChip}>{nextSessionCountdown}</Text> : null}
            </View>
          </View>
          <View style={styles.actionRow}>
            <ActionButton label={sessionBusy === "start" ? "Starting..." : "Start Session"} icon="videocam" variant="filled" onPress={startSession} />
            <ActionButton label="View Details" onPress={() => setSessionPanel((value) => !value)} />
          </View>
          {sessionPanel ? (
            <View style={styles.sessionPanel}>
              <Text style={styles.cardTitle}>Session Details</Text>
              <Text style={styles.muted}>{nextSession.athleteName || "Client"} - {titleCase(nextSession.type)}</Text>
              <Text style={styles.muted}>{new Date(nextSession.scheduledStart).toLocaleString()} to {new Date(nextSession.scheduledEnd).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Text>
              <Text style={styles.muted}>Status: {titleCase(nextSession.status)}</Text>
              <View style={styles.actionRow}>
                <ActionButton label={sessionBusy === "reschedule" ? "Moving..." : "+1 Day"} onPress={() => rescheduleSession(1)} />
                <ActionButton label={sessionBusy === "complete" ? "Saving..." : "Complete"} variant="filled" onPress={completeSession} />
              </View>
            </View>
          ) : null}
          {sessionMessage ? <Text style={sessionMessage.includes("ready") || sessionMessage.includes("complete") || sessionMessage.includes("rescheduled") ? styles.successText : styles.errorText}>{sessionMessage}</Text> : null}
        </AppCard>
      ) : null}

      <AppCard>
        <SectionHeader
          title={`Needs Attention${attention.length ? ` - ${attention.length}` : ""}`}
          action={attention.length ? "View all" : undefined}
          onAction={() => router.push("/coach/athletes" as never)}
        />
        {attention.length ? (
          attention.map((card, index) => (
            <View key={card.athleteId}>
              <AttentionRow
                card={card}
                avatar={rosterByAthleteId.get(card.athleteId)?.avatar}
                onPress={() => router.push({ pathname: "/coach/athletes/[athleteId]", params: { athleteId: card.athleteId, name: card.name } } as never)}
              />
              {index < attention.length - 1 ? <Divider /> : null}
            </View>
          ))
        ) : (
          <Text style={styles.muted}>No clients need urgent review right now.</Text>
        )}
      </AppCard>

      <AppCard>
        <View style={styles.metricGrid}>
          <MetricTile icon="people-outline" value={String(activeClients)} label="Active Clients" />
          <MetricTile icon="calendar-outline" value={String(sessionsToday)} label="Sessions Today" />
          <MetricTile icon="barbell-outline" value={String(trainingCount)} label="Training" />
          <MetricTile icon="warning-outline" tone="danger" value={String(riskAlerts)} label="Risk Alerts" />
        </View>
      </AppCard>

      <AppCard>
        <View style={styles.membershipRow}>
          <IconTile icon="ribbon-outline" size={44} />
          <View style={styles.membershipCopy}>
            <Text style={styles.cardTitle}>Memberships</Text>
            <Text style={styles.muted}>Track renewals, failed payments, and active plans.</Text>
          </View>
          <Pressable onPress={() => router.push("/coach/profile" as never)} style={styles.reviewButton}>
            <Text style={styles.reviewButtonText}>Review</Text>
          </Pressable>
        </View>
      </AppCard>

      <AppCard>
        <SectionHeader
          title="Today's Activity"
          action={activityRows.length ? "View all" : undefined}
          onAction={() => router.push("/coach/athletes" as never)}
        />
        {activityRows.length ? (
          activityRows.slice(0, 5).map((item, index) => (
            <View key={`${item.title}-${index}`}>
              <View style={styles.activityRow}>
                <Text style={styles.timeText}>{item.time}</Text>
                <IconTile icon={item.icon} size={36} tone={item.tone} />
                <Text style={styles.activityText}>{item.title}</Text>
              </View>
              {index < Math.min(activityRows.length, 5) - 1 ? <Divider /> : null}
            </View>
          ))
        ) : (
          <EmptyState title="No activity yet" body="Client check-ins, sessions and completions will appear here." icon="pulse-outline" />
        )}
      </AppCard>

      <AppCard>
        <View style={styles.quickTitleRow}>
          <IconTile icon="flash-outline" size={38} />
          <Text style={styles.cardTitle}>Quick Actions</Text>
        </View>
        <View style={styles.actionRow}>
          <ActionButton label="Assign Workout" icon="barbell-outline" variant="filled" onPress={() => router.push("/coach/plan" as never)} />
          <ActionButton label="Create Plan" icon="clipboard-outline" onPress={() => router.push("/coach/plan" as never)} />
          <ActionButton label="Upload Video" icon="cloud-upload-outline" onPress={() => router.push("/coach/content" as never)} />
        </View>
      </AppCard>

      {data.partialIssues.length ? (
        <AlertBanner
          tone="primary"
          title="Some coach data is unavailable"
          body={data.partialIssues.slice(0, 3).join(", ")}
        />
      ) : null}
    </>
  );
}

function AttentionRow({ card, avatar, onPress }: { card: DailyCard; avatar?: CoachHomeData["roster"][number]["avatar"]; onPress: () => void }) {
  const rank = attentionRank(card);
  const tone = rank <= 1 ? "danger" : "warning";
  return (
    <RowLink
      icon={tone === "danger" ? "alert-circle-outline" : "warning-outline"}
      tone={tone}
      title={card.name || "Client"}
      subtitle={attentionReason(card)}
      value={card.readinessScore == null ? undefined : `Readiness ${card.readinessScore}`}
      onPress={onPress}
      right={<Avatar avatar={avatar} name={card.name || "Client"} size={42} accentSoft={colors.surfaceInset} accentStrong={colors.inkMuted} />}
    />
  );
}

function minutesUntilLabel(scheduledStart: string): string | null {
  const minutes = Math.round((new Date(scheduledStart).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "Starting now";
  if (minutes < 60) return `Starts in ${minutes} min`;
  if (minutes < 24 * 60) return `Starts in ${Math.round(minutes / 60)} hr`;
  return null;
}

function coachSessionSummary(session: ReturnType<typeof nextFutureSession>) {
  if (!session) return "";
  const start = new Date(session.scheduledStart);
  const end = new Date(session.scheduledEnd);
  const durationMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${durationMin ? ` - ${durationMin} min` : ""}`;
}

function buildActivityRows(data: CoachHomeData) {
  const rows: { time: string; title: string; icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap; tone: "primary" | "success" | "warning" | "danger" }[] = [];
  for (const card of data.cards) {
    for (const session of Object.values(card.sessions ?? {})) {
      if (session?.status === "completed") {
        rows.push({ time: "Today", title: `${card.name} completed ${session.workoutType || session.type || "training"}`, icon: "checkmark-circle-outline", tone: "success" });
      } else if (session?.status === "in_progress") {
        rows.push({ time: "Today", title: `${card.name} started ${session.workoutType || session.type || "training"}`, icon: "play-circle-outline", tone: "primary" });
      } else if (session?.status === "skipped") {
        rows.push({ time: "Today", title: `${card.name} missed ${session.workoutType || session.type || "training"}`, icon: "alert-circle-outline", tone: "danger" });
      }
    }
  }
  for (const note of data.notesInbox?.notes ?? []) {
    rows.push({ time: "Note", title: `${note.athleteName} sent a coach note`, icon: "chatbubble-outline", tone: note.needsReply ? "warning" : "primary" });
  }
  return rows;
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  cardTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  blueTitle: { color: colors.primary, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  sessionHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeChip: {
    alignSelf: "flex-start",
    marginTop: 5,
    borderRadius: 8,
    backgroundColor: colors.warnSoft,
    color: "#b45309",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  actionRow: { flexDirection: "row", gap: 9, marginTop: 9 },
  metricGrid: { flexDirection: "row", gap: 8 },
  membershipRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  membershipCopy: { flex: 1, minWidth: 0 },
  reviewButton: { width: 86, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  reviewButtonText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  quickTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  activityRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 9 },
  timeText: { width: 48, color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  activityText: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  sessionPanel: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9, gap: 5 },
  successText: { color: colors.ok, fontSize: 12, fontWeight: "800", marginTop: 6 },
  errorText: { color: colors.bad, fontSize: 12, fontWeight: "800", marginTop: 6 },
  divider: { height: 1, backgroundColor: colors.line },
});
