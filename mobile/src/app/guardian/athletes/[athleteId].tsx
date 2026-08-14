import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../../../lib/api";
import { ROLE_THEMES, colors } from "../../../lib/theme";
import { Card, Muted } from "../../../components/ui";

type DailyCard = {
  name: string;
  sport: string;
  position?: string | null;
  readinessScore: number | null;
  attendance: { status: string | null };
  sessions: Record<string, { status: string | null; type: string | null }>;
};
type CardResponse = { date?: string; card: DailyCard };

const today = () => new Date().toISOString().slice(0, 10);
const accent = ROLE_THEMES.guardian.accent;

function bandColor(score: number | null) {
  if (score == null) return colors.inkFaint;
  if (score >= 80) return colors.ok;
  if (score >= 60) return colors.warn;
  return colors.bad;
}

export default function GuardianAthleteDetail() {
  const router = useRouter();
  const { athleteId, name } = useLocalSearchParams<{ athleteId: string; name?: string }>();
  const [card, setCard] = useState<DailyCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiJson<CardResponse>(
        `/api/guardian/athletes/${athleteId}/daily-card?date=${today()}`
      );
      setCard(res.card);
    } catch {
      setError("Couldn't load this athlete. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, [athleteId]);

  useEffect(() => {
    load();
  }, [load]);

  const sessions = card ? Object.entries(card.sessions) : [];
  const title = card?.name || name || "Athlete";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
      >
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <Ionicons name="arrow-back" size={18} color={colors.inkFaint} />
          <Text style={styles.backText}>BACK</Text>
        </Pressable>

        <Text style={styles.title}>{title}</Text>
        {card?.sport ? (
          <Muted style={{ marginBottom: 16, textTransform: "capitalize" }}>
            {[card.sport, card.position].filter(Boolean).join(" · ")}
          </Muted>
        ) : (
          <View style={{ height: 16 }} />
        )}

        {loading && !card ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card>
            <Muted>{error}</Muted>
          </Card>
        ) : card ? (
          <>
            <Card style={{ alignItems: "flex-start" }}>
              <Text style={styles.section}>Readiness</Text>
              <Text style={[styles.rValue, { color: bandColor(card.readinessScore) }]}>
                {card.readinessScore ?? "—"}
              </Text>
            </Card>
            <Card style={{ marginTop: 12 }}>
              <Text style={styles.section}>Attendance</Text>
              <Text style={styles.value}>{card.attendance?.status ?? "—"}</Text>
            </Card>
            <Card style={{ marginTop: 12 }}>
              <Text style={styles.section}>Sessions</Text>
              <View style={{ marginTop: 6, gap: 6 }}>
                {sessions.length === 0 ? (
                  <Muted>No sessions scheduled.</Muted>
                ) : (
                  sessions.map(([slot, s]) => (
                    <View key={slot} style={styles.sessionRow}>
                      <Text style={styles.slot}>{slot}</Text>
                      <Text style={styles.sessionMeta}>
                        {s.type ?? "—"} · {s.status ?? "—"}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </Card>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  backText: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  section: { fontSize: 12, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1 },
  rValue: { fontSize: 52, fontWeight: "800", marginTop: 4 },
  value: { fontSize: 18, fontWeight: "700", color: colors.ink, marginTop: 6, textTransform: "capitalize" },
  sessionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  slot: { fontSize: 15, fontWeight: "700", color: colors.ink },
  sessionMeta: { fontSize: 14, color: colors.inkMuted, textTransform: "capitalize" },
});
