import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { Banner, Card, Muted, PrimaryButton } from "../../components/ui";
import { ScreenHeader } from "../../components/ScreenHeader";
import { useTourHighlight, useTourScrollView } from "../../lib/tour/MobileTourProvider";
import { SpotlightTarget } from "../../lib/tour/SpotlightTarget";

type Announcement = { id?: string; body: string; recipientCount?: number; createdAt?: string };
type AnnouncementsResponse = { announcements: Announcement[] };
type RosterResponse = { athletes: { athleteId: string }[] };

function announcementIcon(body: string): keyof typeof Ionicons.glyphMap {
  const lower = body.toLowerCase();
  if (/\b(schedule|training|session|plan)\b/.test(lower)) return "clipboard-outline";
  if (/\b(class|practice|\d{1,2}(:\d{2})?\s*(am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(lower)) return "calendar-outline";
  return "megaphone-outline";
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Announcements() {
  const { highlightStyle: announceHighlight } = useTourHighlight("mobile-coach-announce");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const accent = ROLE_THEMES.coach.accent;
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [recipientCount, setRecipientCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [announcementResult, rosterResult] = await Promise.allSettled([
        apiJson<AnnouncementsResponse>("/api/coach/announcements"),
        apiJson<RosterResponse>("/api/coach/athletes"),
      ]);
      if (announcementResult.status !== "fulfilled") throw new Error("announcements_failed");
      setItems(announcementResult.value.announcements);
      if (rosterResult.status === "fulfilled") {
        setRecipientCount(rosterResult.value.athletes.length);
      }
    } catch {
      setError("Couldn't load announcements. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post() {
    setPostError(null);
    const body = draft.trim();
    if (!body) return false;
    setPosting(true);
    try {
      const res = await apiFetch("/api/coach/announcements", {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setPostError("Couldn't post. Try again.");
        return false;
      }
      setDraft("");
      load();
      return true;
    } catch {
      setPostError("Network error. Please try again.");
      return false;
    } finally {
      setPosting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={tourScrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
        >
          <ScreenHeader
            title="Announcements"
            accent={accent}
            roleLabel="Coach"
            subtitle="Broadcast to your whole squad"
          />

          <SpotlightTarget id="mobile-coach-announce" style={announceHighlight}>
          <Card style={styles.composeCard}>
            <View style={styles.cardTitleRow}>
              <View style={styles.cardTitleIcon}>
                <Ionicons name="megaphone-outline" size={15} color={accent} />
              </View>
              <Text style={[styles.cardTitle, { color: accent }]}>Message your squad</Text>
            </View>
            <View style={styles.composeWrap}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder='e.g. "Sunday swimming class starts at 7:00 AM."'
                placeholderTextColor={colors.inkFaint}
                multiline
                maxLength={1000}
                editable={!posting}
                style={styles.compose}
              />
              <Ionicons name="pencil-outline" size={15} color={colors.inkFaint} style={styles.composeEditIcon} />
            </View>
            <View style={styles.composeMeta}>
              <View style={styles.composeMetaLeft}>
                <Ionicons name="people-outline" size={14} color={accent} />
                <Text style={styles.helper}>
                  Goes to all {recipientCount} assigned athlete{recipientCount === 1 ? "" : "s"}
                </Text>
              </View>
              <Text style={styles.helper}>{1000 - draft.length}</Text>
            </View>
            {postError ? <Banner kind="error">{postError}</Banner> : null}
            <PrimaryButton
              label={`Send to ${recipientCount} athlete${recipientCount === 1 ? "" : "s"}`}
              onPress={post}
              loading={posting}
              disabled={!draft.trim() || recipientCount === 0}
              successLabel="Sent"
              accent={accent}
              accentInk="#fff"
              icon="paper-plane"
            />
          </Card>
          </SpotlightTarget>

          <View style={styles.sentHeaderRow}>
            <Text style={styles.sentLabel}>Sent</Text>
            <View style={styles.sentDivider} />
            {items && items.length > 0 ? (
              <View style={styles.sentViewAllRow}>
                <Text style={styles.sentViewAll}>View all</Text>
                <Ionicons name="chevron-forward" size={14} color={accent} />
              </View>
            ) : null}
          </View>

          {loading && !items ? (
            <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
          ) : error ? (
            <Card>
              <Muted>{error}</Muted>
            </Card>
          ) : items && items.length > 0 ? (
            <View style={{ gap: 10 }}>
              {items.map((a, i) => (
                <Card key={a.id ?? i} style={styles.sentCard}>
                  <View style={styles.sentIconTile}>
                    <Ionicons name={announcementIcon(a.body)} size={16} color={accent} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.body}>{a.body}</Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.meta}>{timeAgo(a.createdAt)}</Text>
                      {typeof a.recipientCount === "number" ? (
                        <Text style={styles.meta}>• {a.recipientCount} recipients</Text>
                      ) : null}
                    </View>
                  </View>
                  <Ionicons name="ellipsis-horizontal" size={16} color={colors.inkFaint} style={styles.sentMenuIcon} />
                </Card>
              ))}
            </View>
          ) : (
            <Card style={styles.emptyCard}>
              <Ionicons name="chatbox-outline" size={18} color={colors.inkMuted} />
              <Text style={styles.emptyTitle}>No announcements yet</Text>
              <Muted style={styles.emptyCopy}>Your team updates will appear here.</Muted>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12 },
  composeCard: { marginBottom: 20, gap: 10 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitleIcon: {
    height: 30,
    width: 30,
    borderRadius: 15,
    backgroundColor: ROLE_THEMES.coach.accent + "16",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    color: colors.inkMuted,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  composeWrap: { position: "relative", justifyContent: "flex-end" },
  compose: {
    minHeight: 80,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    padding: 12,
    paddingRight: 34,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: "top",
  },
  composeEditIcon: { position: "absolute", right: 10, bottom: 10 },
  composeMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  composeMetaLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  helper: { color: colors.inkMuted, fontSize: 13, fontWeight: "500" },
  sentHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  sentLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  sentDivider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.lineStrong },
  sentViewAllRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  sentViewAll: { color: ROLE_THEMES.coach.accent, fontSize: 12, fontWeight: "900" },
  sentCard: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  sentMenuIcon: { marginTop: 2 },
  sentIconTile: {
    height: 34,
    width: 34,
    borderRadius: 17,
    backgroundColor: ROLE_THEMES.coach.accent + "16",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { fontSize: 15, fontWeight: "600", color: colors.ink, lineHeight: 21 },
  metaRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  meta: { fontSize: 12, fontWeight: "500", color: colors.inkFaint },
  emptyCard: { minHeight: 140, alignItems: "center", justifyContent: "center" },
  emptyTitle: { marginTop: 8, fontSize: 15, fontWeight: "700", color: colors.ink },
  emptyCopy: { marginTop: 4, textAlign: "center" },
});
