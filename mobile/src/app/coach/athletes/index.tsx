import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "../../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../../lib/theme";
import { Card, Muted } from "../../../components/ui";
import { ScreenHeader } from "../../../components/ScreenHeader";
import { Avatar, type AvatarInfo } from "../../../components/Avatar";
import { useTourHighlight, useTourScrollView } from "../../../lib/tour/MobileTourProvider";
import { SpotlightTarget } from "../../../lib/tour/SpotlightTarget";

type Athlete = {
  athleteId: string;
  name: string;
  email: string;
  sport: string;
  position: string | null;
  avatar?: AvatarInfo;
};
type Response = { athletes: Athlete[] };
type SummaryCard = {
  athleteId: string;
  attendance?: { status: string | null };
  readinessScore: number | null;
  injury?: { active: boolean; bodyPart: string | null };
  rpe?: { calculatedTrainingLoad: number; riskFlag: "green" | "amber" | "red" } | null;
};
type RosterFilter = "all" | "attention" | "injury" | "nocheck";

const ROSTER_FILTERS: { key: RosterFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Attention" },
  { key: "injury", label: "Injury" },
  { key: "nocheck", label: "No check-in" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function band(score: number | null | undefined): { label: string; color: string } {
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

function attentionRank(summary: SummaryCard | undefined): number {
  if (!summary) return 3;
  if (summary.rpe?.riskFlag === "red") return 0;
  if (summary.injury?.active) return 0.5;
  if (summary.readinessScore !== null && summary.readinessScore < 60) return 1;
  if (summary.rpe?.riskFlag === "amber") return 1.5;
  if (summary.readinessScore !== null && summary.readinessScore < 80) return 2;
  return 3;
}

export default function Roster() {
  const { highlightStyle: rosterHighlight } = useTourHighlight("mobile-coach-roster");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const accent = ROLE_THEMES.coach.accent;
  const router = useRouter();
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [summary, setSummary] = useState<Record<string, SummaryCard>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterResult, dashboardResult] = await Promise.allSettled([
        apiJson<Response>("/api/coach/athletes"),
        apiJson<{ cards: SummaryCard[] }>(`/api/coach/dashboard?date=${today()}`),
      ]);
      if (rosterResult.status !== "fulfilled") throw new Error("roster_failed");
      setAthletes(rosterResult.value.athletes);
      if (dashboardResult.status === "fulfilled") {
        setSummary(
          Object.fromEntries((dashboardResult.value.cards ?? []).map((card) => [card.athleteId, card]))
        );
      } else {
        setSummary({});
      }
    } catch {
      setError("Couldn't load your roster. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(athletes ?? [])]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .filter((athlete) => {
        const item = summary[athlete.athleteId];
        if (
          q &&
          !athlete.name.toLowerCase().includes(q) &&
          !athlete.sport.toLowerCase().includes(q) &&
          !(athlete.position ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
        if (filter === "attention") return attentionRank(item) < 2;
        if (filter === "injury") return Boolean(item?.injury?.active);
        if (filter === "nocheck") return !item || item.readinessScore === null;
        return true;
      });
  }, [athletes, filter, query, summary]);

  const counts = useMemo(
    () => ({
      attention: Object.values(summary).filter((item) => attentionRank(item) < 2).length,
      injury: Object.values(summary).filter((item) => item.injury?.active).length,
      nocheck: Object.values(summary).filter((item) => item.readinessScore === null).length,
    }),
    [summary]
  );
  const total = athletes?.length ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        ref={tourScrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
      >
        <ScreenHeader
          title="Roster"
          accent={accent}
          roleLabel="Coach"
          subtitle={`${total} assigned athlete${total === 1 ? "" : "s"}`}
        />

        {loading && !athletes ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card>
            <Muted>{error}</Muted>
          </Card>
        ) : athletes && athletes.length > 0 ? (
          <View style={{ gap: 10 }}>
            <SpotlightTarget id="mobile-coach-roster" style={[styles.searchBlock, rosterHighlight]}>
              <View style={styles.searchRow}>
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={15} color={colors.inkFaint} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search by name, sport, position..."
                    placeholderTextColor={colors.inkFaint}
                    style={styles.searchInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <Pressable
                  onPress={() => router.push("/coach/athletes/new" as never)}
                  style={[styles.addButton, { backgroundColor: accent }]}
                  hitSlop={8}
                  accessibilityLabel="Add athlete"
                >
                  <Text style={styles.addButtonText}>+ Add</Text>
                </Pressable>
              </View>
              <View style={styles.filterMetaRow}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.filterScroll}
                  contentContainerStyle={styles.filterRow}
                >
                  {ROSTER_FILTERS.map((item) => {
                    const active = item.key === filter;
                    const count =
                      item.key === "attention"
                        ? counts.attention
                        : item.key === "injury"
                        ? counts.injury
                        : item.key === "nocheck"
                        ? counts.nocheck
                        : 0;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => setFilter(item.key)}
                        style={[styles.filterChip, active ? { backgroundColor: accent, borderColor: accent } : null]}
                      >
                        <Text style={[styles.filterText, active ? { color: "#fff" } : null]}>
                          {item.label}
                          {item.key !== "all" && count > 0 ? ` ${count}` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text style={styles.resultCount}>
                  {filtered.length} of {athletes.length}
                </Text>
              </View>
            </SpotlightTarget>

            {filtered.length > 0 ? (
              filtered.map((athlete) => (
                <RosterRow
                  key={athlete.athleteId}
                  athlete={athlete}
                  summary={summary[athlete.athleteId]}
                  onPress={() =>
                    router.push({
                      pathname: "/coach/athletes/[athleteId]",
                      params: { athleteId: athlete.athleteId, name: athlete.name },
                    } as never)
                  }
                />
              ))
            ) : (
              <Card>
                <Muted>No athletes match the current search or filter.</Muted>
              </Card>
            )}
          </View>
        ) : (
          <Card>
            <Text style={styles.emptyTitle}>No athletes yet.</Text>
            <Muted style={{ marginTop: 4 }}>Add athletes from the web app to build your roster.</Muted>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RosterRow({
  athlete,
  summary,
  onPress,
}: {
  athlete: Athlete;
  summary?: SummaryCard;
  onPress: () => void;
}) {
  const readiness = band(summary?.readinessScore);
  return (
    <Pressable onPress={onPress}>
      <Card style={styles.row}>
        <View style={styles.avatarWrap}>
          <Avatar
            avatar={athlete.avatar}
            name={athlete.name || "Athlete"}
            size={42}
            photoPath={`/api/coach/athletes/${athlete.athleteId}/avatar/file`}
          />
          {summary?.readinessScore != null ? (
            <View style={[styles.readinessBadge, { backgroundColor: readiness.color }]}>
              <Text style={styles.readinessBadgeText}>{readiness.label}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{athlete.name || "Athlete"}</Text>
            {summary?.injury?.active ? <Chip label="Injury" color={colors.bad} /> : null}
            {summary?.rpe ? <Chip label={summary.rpe.riskFlag} color={riskColor(summary.rpe.riskFlag)} /> : null}
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {[athlete.sport, athlete.position, summary?.attendance?.status].filter(Boolean).join(" / ") || "-"}
          </Text>
        </View>
        <View style={styles.loadBlock}>
          {summary?.rpe ? (
            <>
              <Text style={styles.loadValue}>{summary.rpe.calculatedTrainingLoad}</Text>
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

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: color + "18" }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 26 },
  addButton: { height: 46, borderRadius: radius.md, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  addButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  searchBlock: { gap: 8, marginBottom: 4 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchWrap: {
    flex: 1,
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
  filterMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterScroll: { flex: 1 },
  filterRow: { gap: 6, paddingRight: 2 },
  filterChip: {
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  filterText: { color: colors.inkMuted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  resultCount: { color: colors.inkFaint, fontSize: 11, fontWeight: "700", textAlign: "right", minWidth: 38 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  avatarWrap: { width: 42, height: 42 },
  readinessBadge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  readinessBadgeText: { fontSize: 9, fontWeight: "900", color: "#fff" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  name: { flexShrink: 1, minWidth: 0, fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 13, color: colors.inkMuted, marginTop: 2, textTransform: "capitalize" },
  chip: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  loadBlock: { minWidth: 48, alignItems: "flex-end" },
  loadValue: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  loadLabel: { color: colors.inkFaint, fontSize: 10 },
  noRpe: { color: colors.inkFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
