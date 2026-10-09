import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "../../../components/AppText";
import {
  ActionButton,
  AlertBanner,
  AppCard,
  BackHeader as SharedBackHeader,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  MiniLineChart,
  RowLink,
  ScreenContainer,
  StatusChip,
} from "../../../components/fitora";
import { apiFetch } from "../../../lib/api";
import { activityVisual, planVisual, workoutVisual, type FitoraIconName } from "../../../lib/fitoraIcons";
import { colors } from "../../../lib/theme";
import { animateNextLayout } from "../../../lib/motion";
import {
  attentionRank,
  attentionReason,
  loadCoachClientDetailData,
  nextFutureSession,
  sessionClock,
  todayKey,
  titleCase,
  useAsyncData,
  workoutStatusText,
  type CoachClientDetailData,
} from "../../../lib/fitoraData";

export default function CoachClientDetail() {
  const params = useLocalSearchParams<{ athleteId?: string; name?: string }>();
  const athleteId = Array.isArray(params.athleteId) ? params.athleteId[0] : params.athleteId;
  const name = Array.isArray(params.name) ? params.name[0] : params.name;
  const state = useAsyncData(
    () => {
      if (!athleteId) throw new Error("missing_athlete");
      return loadCoachClientDetailData(athleteId);
    },
    [athleteId],
    athleteId ? `coach-athlete-${athleteId}` : undefined
  );

  if (!athleteId) {
    return (
      <ScreenContainer>
        <BackHeader title="Client" />
        <EmptyState title="No client selected" body="Open a client from the Clients tab." icon="people-outline" />
      </ScreenContainer>
    );
  }

  if (state.loading && !state.data) {
    return (
      <ScreenContainer>
        <BackHeader title={name || "Client"} athleteId={athleteId} />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer>
        <BackHeader title={name || "Client"} athleteId={athleteId} />
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  if (!state.data) return null;

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <BackHeader title={state.data.daily?.name || name || "Client"} athleteId={athleteId} />
      <ClientDetailView data={state.data} />
    </ScreenContainer>
  );
}

function BackHeader({ title, athleteId }: { title: string; athleteId?: string }) {
  const router = useRouter();
  const openMessages = () => {
    if (!athleteId) return;
    router.push({ pathname: "/coach/messages", params: { athleteId } } as never);
  };
  return <SharedBackHeader title={title} actionIcon="chatbubble-outline" actionLabel="Message" onAction={athleteId ? openMessages : undefined} />;
}

function ClientDetailView({ data }: { data: CoachClientDetailData }) {
  const router = useRouter();
  const card = data.daily;
  const alert = card && attentionRank(card) < 2.5 ? attentionReason(card) : null;
  const workout = data.workouts[0] ?? null;
  const sessions = Object.values(card?.sessions ?? {});
  const activeSessions = sessions.filter((session) => session?.status);
  const completedSessions = activeSessions.filter((session) => session.status === "completed");
  const trendValues = useMemo(() => data.trends.map((point) => point.readiness), [data.trends]);
  const nextSession = nextFutureSession(data.sessions);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const goPlan = () => router.push({ pathname: "/coach/plan", params: { athleteId: data.athleteId } } as never);
  const goAssignWorkout = () => router.push({ pathname: "/coach/plan", params: { athleteId: data.athleteId, mode: "workout" } } as never);
  const goMessages = () => router.push({ pathname: "/coach/messages", params: { athleteId: data.athleteId } } as never);

  async function saveNote() {
    const body = noteText.trim();
    if (!body) {
      setNoteMessage("Enter a note before saving.");
      return;
    }
    setSavingNote(true);
    setNoteMessage(null);
    try {
      const res = await apiFetch(`/api/coach/athletes/${data.athleteId}/comment`, {
        method: "POST",
        body: JSON.stringify({ date: todayKey(), body }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNoteMessage(json.error ?? "Could not save this note.");
        return;
      }
      setNoteText("");
      setNoteOpen(false);
      setNoteMessage("Note saved.");
    } catch {
      setNoteMessage("Network error while saving this note.");
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <>
      {alert ? <AlertBanner title={alert} body="Review today's plan before making changes." action="Review" onPress={goPlan} /> : null}

      <AppCard>
        <Text style={styles.cardTitle}>Today</Text>
        <View style={styles.metricGrid}>
          <ClientMetric icon="speedometer-outline" label="Readiness" value={card?.readinessScore == null ? "--" : String(card.readinessScore)} />
          <ClientMetric icon="barbell-outline" label="Workout" value={workout ? `${workout.completedCount} / ${workout.exerciseCount}` : "--"} />
          <ClientMetric icon="restaurant-outline" label="Nutrition" value={data.nutrition && data.nutrition.mealsLoggedCount > 0 ? `${data.nutrition.mealsLoggedCount} meal${data.nutrition.mealsLoggedCount === 1 ? "" : "s"}` : "--"} />
          <ClientMetric icon="checkbox-outline" label="Tasks" value={completedSessions.length ? `${completedSessions.length} done` : "--"} />
        </View>
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Workout</Text>
        {workout ? (
          <>
            <WorkoutRow workout={workout} />
            <View style={styles.actionRow}>
              <ActionButton label="View" onPress={goPlan} />
              <ActionButton label="Adjust" variant="filled" onPress={goAssignWorkout} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.muted}>No workout today.</Text>
            <ActionButton label="Assign Workout" icon="add-outline" variant="filled" onPress={goAssignWorkout} style={styles.assignEmptyButton} />
          </>
        )}
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Nutrition</Text>
        {data.nutrition?.target ? (
          <>
            <View style={styles.metricGrid}>
              <ClientMetric icon="flame-outline" label="Calories" value={`${data.nutrition.totals.calories} / ${data.nutrition.target.calories}`} />
              <ClientMetric icon="fitness-outline" label="Protein" value={`${data.nutrition.totals.proteinG}g`} />
              <ClientMetric icon="nutrition-outline" label="Carbs" value={`${data.nutrition.totals.carbsG}g`} />
              <ClientMetric icon="water-outline" label="Fat" value={`${data.nutrition.totals.fatG}g`} />
            </View>
            <StatusChip
              label={data.nutrition.mealsLoggedCount > 0 ? `${data.nutrition.mealsLoggedCount} meal${data.nutrition.mealsLoggedCount === 1 ? "" : "s"} logged today` : "No meals logged today"}
              tone={data.nutrition.mealsLoggedCount > 0 ? "success" : "neutral"}
            />
          </>
        ) : (
          <>
            <Text style={styles.muted}>No nutrition target yet.</Text>
          </>
        )}
      </AppCard>

      {activeSessions.length ? (
      <AppCard>
        <Text style={styles.cardTitle}>{"Today's sessions"}</Text>
        {activeSessions.slice(0, 2).map((session, index) => {
            const visual = planVisual(session.type, "session");
            return (
              <View key={`${session.type}-${index}`}>
                <RowLink icon={visual.icon} tone={visual.tone} title={titleCase(session.type) || "Session"} subtitle={titleCase(session.status)} />
                {index < Math.min(activeSessions.length, 2) - 1 ? <Divider /> : null}
              </View>
            );
        })}
      </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.cardTitle}>Next session</Text>
        {nextSession ? (
          <RowLink
            icon="calendar-outline"
            title={titleCase(nextSession.type) || "Session"}
            subtitle={sessionClock(nextSession)}
            value={titleCase(nextSession.status)}
            onPress={() => router.push("/coach/dashboard" as never)}
          />
        ) : (
          <Text style={styles.muted}>None booked.</Text>
        )}
      </AppCard>

      {trendValues.some((value) => value != null) ? (
      <AppCard>
        <Text style={styles.cardTitle}>Readiness trend</Text>
        <MiniLineChart values={trendValues} />
      </AppCard>
      ) : null}

      {data.activity.length ? (
      <AppCard>
        <Text style={styles.cardTitle}>Recent activity</Text>
        {data.activity.slice(0, 5).map((item, index) => {
            const visual = activityVisual(item.kind, `${item.title} ${item.subtitle ?? ""} ${item.detail ?? ""}`);
            return (
              <View key={item.id}>
                <RowLink icon={visual.icon} tone={visual.tone} title={item.title} subtitle={item.subtitle || item.detail || titleCase(item.kind)} />
                {index < Math.min(data.activity.length, 5) - 1 ? <Divider /> : null}
              </View>
            );
        })}
      </AppCard>
      ) : null}

      <AppCard>
        <View style={styles.actionRow}>
          <ActionButton label="Assign" icon="add-outline" variant="filled" onPress={goAssignWorkout} />
          <ActionButton label="Message" icon="chatbubble-outline" onPress={goMessages} />
          <ActionButton label="Add Note" icon="create-outline" onPress={() => { animateNextLayout(); setNoteOpen((value) => !value); }} />
        </View>
        {noteOpen ? (
          <View style={styles.notePanel}>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Add a private coach note..."
              placeholderTextColor={colors.inkFaint}
              multiline
              style={styles.noteInput}
            />
            <ActionButton label={savingNote ? "Saving..." : "Save Note"} variant="filled" onPress={saveNote} />
          </View>
        ) : null}
        {noteMessage ? <Text style={noteMessage.includes("saved") ? styles.successText : styles.errorText}>{noteMessage}</Text> : null}
      </AppCard>
    </>
  );
}

function WorkoutRow({ workout }: { workout: NonNullable<CoachClientDetailData["workouts"][number]> }) {
  const visual = workoutVisual(workout.name);
  return (
    <RowLink
      icon={visual.icon}
      tone={visual.tone}
      title={workout.name}
      subtitle={workoutStatusText(workout)}
      value={titleCase(workout.status)}
      progress={workout.progressPercent / 100}
    />
  );
}

function ClientMetric({ icon, label, value }: { icon: FitoraIconName; label: string; value: string }) {
  return (
    <View style={styles.clientMetric}>
      <IconTile icon={icon} size={42} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  cardTitle: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: "900", marginBottom: 10 },
  muted: { color: colors.inkMuted, fontSize: 15, lineHeight: 21, marginBottom: 12 },
  metricGrid: { flexDirection: "row", gap: 8 },
  clientMetric: { flex: 1, alignItems: "center", gap: 6 },
  metricValue: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  metricLabel: { color: colors.inkMuted, fontSize: 12, textAlign: "center" },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  assignEmptyButton: { marginTop: 10 },
  notePanel: { gap: 9, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  noteInput: { minHeight: 82, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surfaceInset, padding: 10, color: colors.ink, fontSize: 14, fontWeight: "700", textAlignVertical: "top" },
  successText: { color: colors.ok, fontSize: 12, lineHeight: 17, fontWeight: "800", marginTop: 8 },
  errorText: { color: colors.bad, fontSize: 12, lineHeight: 17, fontWeight: "800", marginTop: 8 },
  divider: { height: 1, backgroundColor: colors.line },
});
