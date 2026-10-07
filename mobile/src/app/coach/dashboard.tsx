import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
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
  MiniLineChart,
  PrimaryAppBar,
  RowLink,
  ScreenContainer,
  SectionHeader,
  StaleDataNotice,
} from "../../components/fitora";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "../../components/Avatar";
import { DateField, TimeField } from "../../components/DateTimeField";
import { combineLocalDateTime, isInFuture, isoToLocalParts, todayLocalDate } from "../../lib/dateTimeValues";
import { apiFetch } from "../../lib/api";
import { PAYMENTS_ENABLED } from "../../lib/features";
import { joinSessionCall } from "../../lib/videoCall";
import { celebrate, errorFeedback } from "../../lib/feedback";
import { useAuth } from "../../lib/auth";
import { colors } from "../../lib/theme";
import {
  attentionRank,
  attentionReason,
  firstName,
  timeOfDayGreeting,
  loadCoachHomeData,
  longDate,
  nextFutureSession,
  titleCase,
  useAsyncData,
  type CoachHomeData,
  type CoachSession,
  type DailyCard,
} from "../../lib/fitoraData";

export default function CoachHome() {
  const state = useAsyncData(loadCoachHomeData, [], "coach-dashboard");

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

  function patchSession(sessionId: string, patch: Partial<CoachSession>) {
    state.setData((prev) =>
      prev ? { ...prev, sessions: prev.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)) } : prev
    );
  }

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      {state.stale ? <StaleDataNotice onRetry={state.reload} /> : null}
      <CoachHomeView data={state.data} onSessionUpdate={patchSession} />
    </ScreenContainer>
  );
}

function CoachHomeView({ data, onSessionUpdate }: { data: CoachHomeData; onSessionUpdate: (sessionId: string, patch: Partial<CoachSession>) => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const [sessionPanel, setSessionPanel] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleMinDate, setRescheduleMinDate] = useState(() => todayLocalDate());
  const [rescheduleNote, setRescheduleNote] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [completeSummary, setCompleteSummary] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const attention = useMemo(
    () => [...data.cards].filter((card) => attentionRank(card) < 2.5).sort((a, b) => attentionRank(a) - attentionRank(b)).slice(0, 4),
    [data.cards]
  );
  const rosterByAthleteId = useMemo(
    () => new Map(data.roster.map((athlete) => [athlete.athleteId, athlete])),
    [data.roster]
  );
  const membershipStats = useMemo(() => {
    const total = data.roster.length;
    const paid = data.roster.filter((athlete) => athlete.hasActiveMembership).length;
    return { total, paid, unpaid: total - paid };
  }, [data.roster]);
  const latestSquadPoint = data.squadSeries.length ? data.squadSeries[data.squadSeries.length - 1] : null;
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
      const athleteLabel = nextSession.athleteName || "your client";
      const result = await joinSessionCall("coach", nextSession.id, { withName: athleteLabel, title: `Session with ${athleteLabel}` });
      if (!result.ok) setSessionMessage(result.message);
    } finally {
      setSessionBusy(null);
    }
  }

  async function confirmSession() {
    if (!nextSession) return;
    setSessionBusy("confirm");
    setSessionMessage(null);
    try {
      const res = await apiFetch(`/api/coach/sessions/${nextSession.id}/confirm`, { method: "POST" });
      if (!res.ok) {
        setSessionMessage("Could not confirm this session.");
        return;
      }
      onSessionUpdate(nextSession.id, { status: "confirmed" });
      setSessionMessage("Session confirmed.");
    } catch {
      setSessionMessage("Network error while confirming session.");
    } finally {
      setSessionBusy(null);
    }
  }

  async function cancelSession() {
    if (!nextSession) return;
    setSessionBusy("cancel");
    setSessionMessage(null);
    try {
      const res = await apiFetch(`/api/coach/sessions/${nextSession.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ note: cancelNote.trim() || undefined }),
      });
      if (!res.ok) {
        setSessionMessage("Could not cancel this session.");
        return;
      }
      onSessionUpdate(nextSession.id, { status: "cancelled" });
      setCancelNote("");
      setSessionMessage("Session cancelled.");
    } catch {
      setSessionMessage("Network error while cancelling session.");
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
        body: JSON.stringify({
          summary: completeSummary.trim() || undefined,
          coachNotes: completeNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setSessionMessage("Could not complete this session.");
        return;
      }
      onSessionUpdate(nextSession.id, { status: "completed" });
      setSessionMessage("Session marked complete.");
    } catch {
      setSessionMessage("Network error while completing session.");
    } finally {
      setSessionBusy(null);
    }
  }

  async function rescheduleSession() {
    if (!nextSession) return;
    if (!rescheduleDate || !rescheduleTime) {
      setSessionMessage("Pick a new date and time first.");
      return;
    }
    // The pickers return the coach's LOCAL date and time; build the instant
    // from those local fields, then send it to the server as UTC ISO.
    const nextStart = combineLocalDateTime(rescheduleDate, rescheduleTime);
    if (!nextStart) {
      setSessionMessage("That date and time aren't valid.");
      return;
    }
    if (!isInFuture(nextStart)) {
      setSessionMessage("Pick a time in the future.");
      return;
    }
    setSessionBusy("reschedule");
    setSessionMessage(null);
    try {
      const res = await apiFetch(`/api/coach/sessions/${nextSession.id}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledStart: nextStart.toISOString(), note: rescheduleNote.trim() || undefined }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        const reasons: Record<string, string> = {
          outside_availability: "That time is outside your working hours. Pick a time within your availability.",
          slot_conflict: "You already have a session at that time. Pick another slot.",
          // Avoid "confirmed"/"rescheduled" etc. here: the message color below keys off those words.
          invalid_transition: "This session can't be moved right now. If it's still a request, accept it first.",
          relationship_ended: "You no longer coach this client, so the session can't be moved.",
        };
        setSessionMessage((json.error && reasons[json.error]) || "Could not reschedule this session.");
        return;
      }
      onSessionUpdate(nextSession.id, { status: "rescheduled", scheduledStart: nextStart.toISOString() });
      setSessionMessage("Session rescheduled.");
    } catch {
      setSessionMessage("Network error while rescheduling session.");
    } finally {
      setSessionBusy(null);
    }
  }

  function toggleSessionPanel() {
    const next = !sessionPanel;
    if (next && nextSession) {
      // Pre-fill with the session's LOCAL date/time (toISOString() slices
      // would show UTC, e.g. 5:30 behind for a coach in India).
      const local = isoToLocalParts(nextSession.scheduledStart);
      setRescheduleDate(local.date);
      setRescheduleTime(local.time);
      setRescheduleMinDate(todayLocalDate());
    }
    setSessionPanel(next);
  }

  return (
    <>
      <PrimaryAppBar
        greeting={`${timeOfDayGreeting()}, ${firstName(user?.name, "Coach")}`}
        title={longDate(data.date)}
      />

      {data.roster.length === 0 ? <CoachGettingStartedCard /> : null}

      <SessionRequestsCard sessions={data.sessions} today={data.date} onSessionUpdate={onSessionUpdate} />

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
            <ActionButton label="View Details" onPress={toggleSessionPanel} />
          </View>
          {sessionPanel ? (
            <View style={styles.sessionPanel}>
              <Text style={styles.cardTitle}>Session Details</Text>
              <Text style={styles.muted}>{nextSession.athleteName || "Client"} - {titleCase(nextSession.type)}</Text>
              <Text style={styles.muted}>{new Date(nextSession.scheduledStart).toLocaleString()} to {new Date(nextSession.scheduledEnd).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Text>
              <Text style={styles.muted}>Status: {titleCase(nextSession.status)}</Text>

              <View style={styles.actionRow}>
                <ActionButton label={sessionBusy === "confirm" ? "Confirming..." : "Confirm"} variant="filled" onPress={confirmSession} />
                <ActionButton
                  label={sessionBusy === "cancel" ? "Cancelling..." : "Cancel"}
                  onPress={cancelSession}
                  style={styles.cancelButton}
                  textStyle={styles.cancelButtonText}
                />
              </View>
              <TextInput
                value={cancelNote}
                onChangeText={setCancelNote}
                style={styles.input}
                placeholder="Reason for cancelling (optional)"
                placeholderTextColor={colors.inkFaint}
              />

              <View style={styles.sessionDivider} />
              <Text style={styles.formLabel}>Reschedule</Text>
              <View style={styles.actionRow}>
                <DateField
                  value={rescheduleDate}
                  onChange={setRescheduleDate}
                  accessibilityLabel="New session date"
                  placeholder="New date"
                  minimumDate={rescheduleMinDate}
                  style={styles.inputHalf}
                />
                <TimeField
                  value={rescheduleTime}
                  onChange={setRescheduleTime}
                  accessibilityLabel="New session start time"
                  placeholder="New time"
                  minuteInterval={5}
                  style={styles.inputHalf}
                />
              </View>
              <TextInput value={rescheduleNote} onChangeText={setRescheduleNote} style={styles.input} placeholder="Note to athlete (optional)" placeholderTextColor={colors.inkFaint} />
              <ActionButton label={sessionBusy === "reschedule" ? "Moving..." : "Reschedule"} onPress={rescheduleSession} />

              <View style={styles.sessionDivider} />
              <Text style={styles.formLabel}>Mark Complete</Text>
              <TextInput value={completeSummary} onChangeText={setCompleteSummary} style={styles.input} placeholder="Summary (visible to athlete)" placeholderTextColor={colors.inkFaint} />
              <TextInput value={completeNotes} onChangeText={setCompleteNotes} style={styles.input} placeholder="Private coach notes" placeholderTextColor={colors.inkFaint} />
              <ActionButton label={sessionBusy === "complete" ? "Saving..." : "Complete"} variant="filled" onPress={completeSession} />
            </View>
          ) : null}
          {sessionMessage ? (
            <Text
              style={
                sessionMessage.includes("ready") ||
                sessionMessage.includes("complete") ||
                sessionMessage.includes("rescheduled") ||
                sessionMessage.includes("confirmed") ||
                sessionMessage.includes("cancelled")
                  ? styles.successText
                  : styles.errorText
              }
            >
              {sessionMessage}
            </Text>
          ) : null}
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
          <Text style={styles.muted}>{data.roster.length ? "No clients need urgent review right now." : "No clients yet. Add one to see their check-ins here."}</Text>
        )}
      </AppCard>

      {data.squadSeries.length ? (
        <AppCard>
          <SectionHeader title="Squad Readiness - 7 Days" />
          <MiniLineChart values={data.squadSeries.map((point) => point.avgReadiness)} height={72} />
          <View style={styles.squadStatRow}>
            <Text style={styles.muted}>Attendance today: {latestSquadPoint?.attendanceRate == null ? "--" : `${latestSquadPoint.attendanceRate}%`}</Text>
            <Text style={styles.muted}>Red flags today: {latestSquadPoint?.redFlags ?? 0}</Text>
          </View>
        </AppCard>
      ) : null}

      <AppCard>
        <View style={styles.metricGrid}>
          <MetricTile icon="people-outline" value={String(activeClients)} label="Active Clients" />
          <MetricTile icon="calendar-outline" value={String(sessionsToday)} label="Sessions Today" />
          <MetricTile icon="barbell-outline" value={String(trainingCount)} label="Training" />
          <MetricTile icon="warning-outline" tone="danger" value={String(riskAlerts)} label="Risk Alerts" />
        </View>
      </AppCard>

      {PAYMENTS_ENABLED ? (
      <AppCard>
        <View style={styles.membershipRow}>
          <IconTile icon="ribbon-outline" size={44} />
          <View style={styles.membershipCopy}>
            <Text style={styles.cardTitle}>Memberships</Text>
            <Text style={styles.muted}>
              {membershipStats.total === 0
                ? "No clients yet."
                : membershipStats.unpaid === 0
                  ? `All ${membershipStats.total} clients on a paid plan.`
                  : `${membershipStats.paid} of ${membershipStats.total} clients on a paid plan - ${membershipStats.unpaid} unpaid.`}
            </Text>
          </View>
          <Pressable onPress={() => router.push({ pathname: "/coach/athletes", params: { filter: "membership" } } as never)} style={styles.reviewButton}>
            <Text style={styles.reviewButtonText}>Review</Text>
          </Pressable>
        </View>
      </AppCard>
      ) : null}

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
          {/* Short labels: three buttons share one row on a 360-390dp phone; longer labels truncated ("Assign W..."). */}
          <ActionButton label="Workout" icon="barbell-outline" variant="filled" onPress={() => router.push("/coach/plan" as never)} />
          <ActionButton label="Plans" icon="clipboard-outline" onPress={() => router.push("/coach/plan" as never)} />
          <ActionButton label="Video" icon="cloud-upload-outline" onPress={() => router.push("/coach/content" as never)} />
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

/** First-day guide for a coach with no clients yet, instead of a wall of zeros. */
function CoachGettingStartedCard() {
  const router = useRouter();
  const steps: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress: () => void }[] = [
    {
      icon: "person-add-outline",
      title: "Add your first client",
      body: "Create their account, or link one by email.",
      onPress: () => router.push("/coach/athletes/new" as never),
    },
    {
      icon: "barbell-outline",
      title: "Build a workout template",
      body: "Reuse it for every client you coach.",
      onPress: () => router.push({ pathname: "/coach/plan/workout-template", params: { kind: "workout" } } as never),
    },
    {
      icon: "calendar-outline",
      title: "Set your availability",
      body: "So clients can book video sessions with you.",
      onPress: () => router.push("/coach/profile" as never),
    },
  ];
  return (
    <AppCard>
      <Text style={styles.blueTitle}>Welcome to Fitora</Text>
      <Text style={styles.cardTitle}>Get set up in 3 steps</Text>
      {steps.map((step, index) => (
        <View key={step.title}>
          <Pressable onPress={step.onPress} style={({ pressed }) => [styles.setupRow, pressed ? { opacity: 0.75 } : null]} accessibilityRole="button">
            <IconTile icon={step.icon} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.setupTitle}>{step.title}</Text>
              <Text style={styles.muted}>{step.body}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.inkFaint} />
          </Pressable>
          {index < steps.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </AppCard>
  );
}

/** Every pending booking request, so a coach can act on more than just the next session. */
function SessionRequestsCard({
  sessions,
  today,
  onSessionUpdate,
}: {
  sessions: CoachSession[];
  /** YYYY-MM-DD; requests that ended before today are stale and hidden. */
  today: string;
  onSessionUpdate: (sessionId: string, patch: Partial<CoachSession>) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const requests = useMemo(
    () =>
      sessions
        .filter((session) => session.status === "requested" && session.scheduledEnd >= today)
        .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
    [sessions, today]
  );
  if (!requests.length && !message) return null;

  async function act(session: CoachSession, action: "confirm" | "cancel") {
    setBusy(`${action}:${session.id}`);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/coach/sessions/${session.id}/${action}`, {
        method: "POST",
        body: action === "cancel" ? JSON.stringify({ note: "Declined by coach" }) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        errorFeedback();
        setMessage({
          kind: "error",
          text:
            json.error === "relationship_ended"
              ? "This athlete is no longer your client."
              : json.error === "invalid_transition"
                ? "This request was already handled. Pull to refresh."
                : `Could not ${action === "confirm" ? "confirm" : "decline"} this request.`,
        });
        return;
      }
      onSessionUpdate(session.id, { status: action === "confirm" ? "confirmed" : "cancelled" });
      setMessage({ kind: "ok", text: action === "confirm" ? `Confirmed ${session.athleteName || "the session"}.` : "Request declined." });
      if (action === "confirm") celebrate({ title: "Session confirmed", body: `${session.athleteName || "Your client"} has been notified.` });
    } catch {
      setMessage({ kind: "error", text: "Network error. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppCard>
      <SectionHeader title={`Session Requests${requests.length ? ` - ${requests.length}` : ""}`} />
      {requests.map((session, index) => (
        <View key={session.id}>
          <View style={styles.requestRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>{session.athleteName || "Client"}</Text>
              <Text style={styles.muted} numberOfLines={1}>{titleCase(session.type)}</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {new Date(session.scheduledStart).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </Text>
            </View>
          </View>
          <View style={styles.actionRow}>
            <ActionButton
              label={busy === `confirm:${session.id}` ? "Confirming..." : "Confirm"}
              variant="filled"
              disabled={Boolean(busy)}
              onPress={() => void act(session, "confirm")}
            />
            <ActionButton
              label={busy === `cancel:${session.id}` ? "Declining..." : "Decline"}
              disabled={Boolean(busy)}
              onPress={() => void act(session, "cancel")}
              style={styles.cancelButton}
              textStyle={styles.cancelButtonText}
            />
          </View>
          {index < requests.length - 1 ? <Divider /> : null}
        </View>
      ))}
      {message ? <Text style={message.kind === "ok" ? styles.successText : styles.errorText}>{message.text}</Text> : null}
    </AppCard>
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
  muted: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  sessionHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeChip: {
    alignSelf: "flex-start",
    marginTop: 5,
    borderRadius: 8,
    backgroundColor: colors.warnSoft,
    color: "#b45309",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  actionRow: { flexDirection: "row", gap: 9, marginTop: 9 },
  squadStatRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  metricGrid: { flexDirection: "row", gap: 8 },
  membershipRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  membershipCopy: { flex: 1, minWidth: 0 },
  reviewButton: { width: 86, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  reviewButtonText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  quickTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  activityRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 9 },
  timeText: { width: 48, color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  activityText: { flex: 1, color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  setupRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  setupTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  requestRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  sessionPanel: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9, gap: 8 },
  sessionDivider: { height: 1, backgroundColor: colors.line, marginVertical: 2 },
  formLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  input: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    color: colors.ink,
    fontSize: 13,
  },
  inputHalf: { flex: 1 },
  cancelButton: { borderColor: colors.bad },
  cancelButtonText: { color: colors.bad },
  successText: { color: colors.ok, fontSize: 12, fontWeight: "800", marginTop: 6 },
  errorText: { color: colors.bad, fontSize: 12, fontWeight: "800", marginTop: 6 },
  divider: { height: 1, backgroundColor: colors.line },
});
