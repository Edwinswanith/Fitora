import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { AppCard, EmptyState, LoadingState, ScreenContainer } from "../../components/fitora";
import { apiJson } from "../../lib/api";
import { colors } from "../../lib/theme";

type Point = {
  date: string;
  readiness: number | null;
  load: number | null;
  sleepHours: number | null;
  recoveryScore: number | null;
};
type Response = { days: number; series: Point[] };

function bandColor(score: number | null) {
  if (score == null) return colors.line;
  if (score >= 80) return colors.ok;
  if (score >= 60) return colors.warn;
  return colors.bad;
}

export default function Trends() {
  const router = useRouter();
  const [series, setSeries] = useState<Point[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<Response>("/api/athlete/trends?days=14");
      setSeries(res.series);
    } catch {
      // keep state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const withReadiness = series?.filter((p) => p.readiness != null) ?? [];
  const latest = withReadiness.length ? withReadiness[withReadiness.length - 1].readiness : null;
  const avg = withReadiness.length
    ? Math.round(withReadiness.reduce((s, p) => s + (p.readiness ?? 0), 0) / withReadiness.length)
    : null;

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>Trends</Text>
      </View>
      <Text style={styles.tagline}>Last 14 days</Text>

      {loading && !series ? (
        <LoadingState label="Loading trends..." />
      ) : series && series.length ? (
        <>
          <View style={styles.statRow}>
            <Stat label="Latest readiness" value={latest == null ? "—" : String(latest)} />
            <Stat label="14-day average" value={avg == null ? "—" : String(avg)} />
          </View>

          <AppCard>
            <Text style={styles.cardLabel}>Readiness</Text>
            <View style={styles.bars}>
              {series.map((p) => {
                const h = p.readiness == null ? 4 : Math.max(4, (p.readiness / 100) * 120);
                return (
                  <View key={p.date} style={styles.barCol}>
                    <View style={[styles.bar, { height: h, backgroundColor: bandColor(p.readiness) }]} />
                  </View>
                );
              })}
            </View>
            <View style={styles.axis}>
              <Text style={styles.axisText}>{series[0]?.date.slice(5)}</Text>
              <Text style={styles.axisText}>{series[series.length - 1]?.date.slice(5)}</Text>
            </View>
          </AppCard>

          <AppCard>
            <Text style={styles.cardLabel}>Recent days</Text>
            <View style={{ marginTop: 8, gap: 8 }}>
              {[...series].reverse().slice(0, 7).map((p) => (
                <View key={p.date} style={styles.dayRow}>
                  <Text style={styles.dayDate}>{p.date.slice(5)}</Text>
                  <Text style={styles.dayMeta}>
                    R {p.readiness ?? "—"} · Sleep {p.sleepHours ?? "—"}h · Rec {p.recoveryScore ?? "—"}
                  </Text>
                </View>
              ))}
            </View>
          </AppCard>
        </>
      ) : (
        <EmptyState title="No trend data yet" body="Log a few daily check-ins to see your trends." icon="trending-up-outline" />
      )}
    </ScreenContainer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <AppCard style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: {
    height: 42,
    width: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { flex: 1, color: colors.ink, fontSize: 26, lineHeight: 32, fontWeight: "900" },
  tagline: { color: colors.inkMuted, fontSize: 14, lineHeight: 19, marginTop: -6, marginBottom: 4 },
  statRow: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, padding: 12 },
  statLabel: { fontSize: 11, color: colors.inkMuted, fontWeight: "700" },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.ink, marginTop: 4 },
  cardLabel: { fontSize: 12, fontWeight: "800", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 124, marginTop: 12 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 4 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  axisText: { fontSize: 11, color: colors.inkFaint, fontWeight: "600" },
  dayRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dayDate: { fontSize: 14, fontWeight: "700", color: colors.ink },
  dayMeta: { fontSize: 13, color: colors.inkMuted },
});
