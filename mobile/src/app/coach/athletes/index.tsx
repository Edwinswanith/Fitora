import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../../components/AppText";
import {
  ActionButton,
  AppCard,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  ScreenContainer,
  SegmentedControl,
  StatusChip,
} from "../../../components/fitora";
import { Avatar } from "../../../components/Avatar";
import { planVisual, workoutVisual, type FitoraIconName, type FitoraTone } from "../../../lib/fitoraIcons";
import { colors } from "../../../lib/theme";
import {
  attentionRank,
  attentionReason,
  loadCoachHomeData,
  titleCase,
  useAsyncData,
  type CoachHomeData,
  type CoachRosterAthlete,
  type CoachSession,
  type DailyCard,
} from "../../../lib/fitoraData";
import { PAYMENTS_ENABLED } from "../../../lib/features";

type Filter = "all" | "attention" | "active" | "membership";

const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function hasRecentOrUpcomingSession(sessions: CoachSession[]): boolean {
  const now = Date.now();
  return sessions.some((session) => {
    if (session.status === "cancelled") return false;
    const start = new Date(session.scheduledStart).getTime();
    return Math.abs(start - now) <= ACTIVITY_WINDOW_MS;
  });
}

export default function CoachClients() {
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

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <ClientsView data={state.data} />
    </ScreenContainer>
  );
}

function ClientsView({ data }: { data: CoachHomeData }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: Filter }>();
  const initialFilter: Filter = ["all", "attention", "active", ...(PAYMENTS_ENABLED ? ["membership"] : [])].includes(params.filter ?? "") ? (params.filter as Filter) : "all";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const summary = useMemo(() => Object.fromEntries(data.cards.map((card) => [card.athleteId, card])), [data.cards]);
  const sessionsByAthlete = useMemo(() => {
    const map = new Map<string, CoachSession[]>();
    for (const session of data.sessions) {
      const list = map.get(session.athleteId) ?? [];
      list.push(session);
      map.set(session.athleteId, list);
    }
    return map;
  }, [data.sessions]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.roster]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((athlete) => {
        const card = summary[athlete.athleteId];
        if (q && !`${athlete.name} ${athlete.sport} ${athlete.position ?? ""}`.toLowerCase().includes(q)) return false;
        if (filter === "attention") return card ? attentionRank(card) < 2.5 : false;
        if (filter === "active") return hasRecentOrUpcomingSession(sessionsByAthlete.get(athlete.athleteId) ?? []);
        if (filter === "membership") return Boolean(athlete.hasActiveMembership);
        return true;
      });
  }, [data.roster, filter, query, summary, sessionsByAthlete]);

  const attentionCount = data.cards.filter((card) => attentionRank(card) < 2.5).length;

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Clients</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={23} color={colors.inkFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search clients..."
          placeholderTextColor={colors.inkFaint}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "attention", label: "Attention" },
          { value: "active", label: "Active" },
          ...(PAYMENTS_ENABLED ? [{ value: "membership" as const, label: "Membership" }] : []),
        ]}
      />

      <Pressable onPress={() => router.push("/coach/athletes/new" as never)} style={styles.inviteLink}>
        <Ionicons name="person-add-outline" size={22} color={colors.primary} />
        <Text style={styles.inviteText}>Add / Invite Client</Text>
      </Pressable>

      <AppCard>
        {filtered.length ? (
          filtered.map((athlete, index) => (
            <View key={athlete.athleteId}>
              <ClientRow
                athlete={athlete}
                summary={summary[athlete.athleteId]}
                onPress={() => router.push(`/coach/athletes/${encodeURIComponent(athlete.athleteId)}?name=${encodeURIComponent(athlete.name)}` as never)}
              />
              {index < filtered.length - 1 ? <Divider /> : null}
            </View>
          ))
        ) : filter === "membership" ? (
          <EmptyState title="No membership rows yet" body="Client membership status will appear here as plans become active." icon="card-outline" />
        ) : (
          <EmptyState title="No clients found" body="Try a different search or filter." icon="people-outline" />
        )}
      </AppCard>

      <AppCard>
        <View style={styles.summaryRow}>
          <IconTile icon="people-outline" size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{data.roster.length} Active Clients</Text>
            <Text style={styles.attentionText}>{attentionCount} need your attention</Text>
          </View>
          <ActionButton label="View Insights" icon="bar-chart-outline" onPress={() => router.push("/coach/dashboard" as never)} />
        </View>
      </AppCard>
    </>
  );
}

function ClientRow({
  athlete,
  summary,
  onPress,
}: {
  athlete: CoachRosterAthlete;
  summary?: DailyCard;
  onPress: () => void;
}) {
  const readiness = summary?.readinessScore;
  const workoutSessions = Object.values(summary?.sessions ?? {});
  const completed = workoutSessions.filter((session) => session?.status === "completed").length;
  const planned = workoutSessions.filter((session) => session?.status).length;
  const rank = summary ? attentionRank(summary) : 3;
  const statusTone = rank <= 1 ? "danger" : rank < 2.5 ? "warning" : "success";
  const statusLabel = rank < 2.5 ? attentionReason(summary!) : "ACTIVE";
  const lastSession = workoutSessions.find((session) => session?.status);
  const workoutIcon = workoutVisual(lastSession?.workoutType || lastSession?.type || "workout");
  const sessionIcon = planVisual(lastSession?.type || "session", "session");

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.clientRow, pressed ? styles.pressed : null]}>
      <View style={[styles.clientDot, { backgroundColor: statusTone === "danger" ? colors.bad : statusTone === "warning" ? colors.warn : colors.ok }]} />
      <Avatar avatar={athlete.avatar} name={athlete.name || "Client"} size={58} photoPath={`/api/coach/athletes/${athlete.athleteId}/avatar/file`} />
      <View style={styles.clientMain}>
        <View style={styles.nameLine}>
          <Text style={styles.clientName} numberOfLines={1}>{athlete.name || "Client"}</Text>
          <StatusChip label={statusLabel} tone={statusTone} />
        </View>
        <Text style={styles.goalText} numberOfLines={1}>{athlete.sport || "General Fitness"}</Text>
        <View style={styles.clientMetrics}>
          <SmallMetric icon="speedometer-outline" label="Readiness" value={readiness == null ? "--" : `${readiness} /100`} tone={statusTone} />
          <SmallMetric icon={workoutIcon.icon} label="Workout" value={planned ? `${completed} / ${planned}` : "No plan"} tone={workoutIcon.tone} />
          <SmallMetric icon={sessionIcon.icon} label="Next session" value={lastSession?.type ? titleCase(lastSession.type) : "None"} tone={sessionIcon.tone} />
        </View>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.ink} />
    </Pressable>
  );
}

function SmallMetric({
  icon,
  label,
  value,
  tone = "primary",
}: {
  icon: FitoraIconName;
  label: string;
  value: string;
  tone?: FitoraTone;
}) {
  const color = tone === "success" ? colors.ok : tone === "warning" ? colors.warn : tone === "danger" ? colors.bad : colors.primary;
  return (
    <View style={styles.smallMetric}>
      <Ionicons name={icon} size={15} color={color} />
      <Text style={styles.smallMetricLabel}>{label}</Text>
      <Text style={styles.smallMetricValue}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pageTitle: { color: colors.ink, fontSize: 27, lineHeight: 33, fontWeight: "900" },
  searchWrap: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surfaceRaised, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, fontFamily: "Inter_400Regular" },
  inviteLink: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 3 },
  inviteText: { color: colors.primary, fontSize: 15, fontWeight: "900" },
  clientRow: { minHeight: 104, flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10 },
  clientDot: { width: 10, height: 10, borderRadius: 5 },
  clientMain: { flex: 1, minWidth: 0, gap: 4 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  clientName: { flex: 1, color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "900" },
  goalText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  clientMetrics: { flexDirection: "row", gap: 6 },
  smallMetric: { flex: 1, minWidth: 0, gap: 1 },
  smallMetricLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  smallMetricValue: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  divider: { height: 1, backgroundColor: colors.line },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  attentionText: { color: colors.warn, fontSize: 15, lineHeight: 20, marginTop: 2 },
  pressed: { opacity: 0.72 },
});
