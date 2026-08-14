import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_THEMES, colors, radius, type RoleTheme } from "../lib/theme";
import { dashboardPathForRole } from "../lib/roles";
import { Card, Muted } from "../components/ui";
import { ScreenHeader } from "../components/ScreenHeader";
import { fireMascotReaction } from "../lib/tour/reactions";

// Routes that actually exist in the mobile app. Notification `link`s are
// authored for the web app, so we only follow ones with a mobile screen and
// otherwise fall back to the role dashboard (never an "Unmatched Route").
const KNOWN_MOBILE_ROUTES = [
  "/athlete/dashboard", "/athlete/check-in", "/athlete/rpe", "/athlete/water", "/athlete/trends",
  "/coach/dashboard", "/coach/athletes", "/coach/messages", "/coach/announcements", "/coach/coaches",
  "/account", "/notifications",
];

function parseQuery(q: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of q.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
    if (key) params[key] = value;
  }
  return params;
}

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  link: string | null;
  read?: boolean;
  readAt?: string | null;
  createdAt: string;
};
type Response = { notifications: Notif[]; unreadCount: number; hasUrgentUnread: boolean };

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export default function Notifications() {
  const router = useRouter();
  const { user } = useAuth();
  const theme: RoleTheme = ROLE_THEMES[(user?.role as keyof typeof ROLE_THEMES) ?? "coach"] ?? ROLE_THEMES.coach;
  const accent = theme.accentStrong;

  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const firedEmptyReaction = useRef(false);

  useEffect(() => {
    if (!data || user?.role !== "athlete") return;
    if (data.notifications.length === 0) {
      if (!firedEmptyReaction.current) {
        firedEmptyReaction.current = true;
        fireMascotReaction("notifications.empty");
      }
    } else {
      firedEmptyReaction.current = false;
    }
  }, [data, user?.role]);

  const load = useCallback(async () => {
    try {
      setData(await apiJson<Response>("/api/notifications"));
    } catch {
      // keep
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    setData((d) =>
      d ? { ...d, notifications: d.notifications.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)), unreadCount: Math.max(0, d.unreadCount - 1) } : d
    );
    await apiFetch(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => undefined);
  }

  async function markAll() {
    setData((d) => (d ? { ...d, notifications: d.notifications.map((n) => ({ ...n, read: true, readAt: n.readAt ?? new Date().toISOString() })), unreadCount: 0 } : d));
    await apiFetch("/api/notifications/read-all", { method: "POST" }).catch(() => undefined);
  }

  async function openNotification(n: Notif) {
    if (!n.read && !n.readAt) await markRead(n.id);
    const home = dashboardPathForRole(user?.role ?? "") ?? "/notifications";
    const link = n.link;
    if (!link || !link.startsWith("/")) {
      router.push(home as never);
      return;
    }

    // Direct-message notifications: the web links to dedicated thread screens
    // (/athlete/messages/:coachId, /coach/messages/:athleteId) that have no
    // standalone mobile screen. On mobile, athlete messaging lives in the
    // dashboard "coach" section and coach messaging at /coach/messages.
    const athleteMsg = /^\/athlete\/messages\/([^/?]+)/.exec(link);
    if (athleteMsg) {
      router.push({ pathname: "/athlete/dashboard", params: { section: "coach", coachId: athleteMsg[1] } } as never);
      return;
    }
    const coachMsg = /^\/coach\/messages(?:\/([^/?]+))?/.exec(link);
    if (coachMsg) {
      router.push((coachMsg[1] ? { pathname: "/coach/messages", params: { athleteId: coachMsg[1] } } : "/coach/messages") as never);
      return;
    }

    const qIdx = link.indexOf("?");
    const path = qIdx === -1 ? link : link.slice(0, qIdx);
    const known = KNOWN_MOBILE_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
    if (!known) {
      router.push(home as never);
      return;
    }
    // expo-router won't resolve a query string baked into the pathname string,
    // so split a known route into pathname + params object.
    if (qIdx === -1) {
      router.push(path as never);
      return;
    }
    router.push({ pathname: path, params: parseQuery(link.slice(qIdx + 1)) } as never);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}>
        <ScreenHeader
          title="Notifications"
          accent={accent}
          roleLabel={theme.label}
          subtitle={data && data.unreadCount > 0 ? `${data.unreadCount} unread` : "You're all caught up"}
          headerActions={
            data && data.unreadCount > 0 ? (
              <Pressable onPress={markAll} hitSlop={8} style={styles.markAllButton}>
                <Text style={[styles.markAll, { color: accent }]}>Mark all read</Text>
              </Pressable>
            ) : null
          }
        />

        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.push(dashboardPathForRole(user?.role ?? "") as never))} style={styles.backButton} hitSlop={10}>
          <Ionicons name="arrow-back" size={15} color={colors.inkMuted} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        {loading && !data ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : data && data.notifications.length > 0 ? (
          <View style={{ gap: 10 }}>
            {data.notifications.map((n) => {
              const unread = !n.read && !n.readAt;
              return (
                <Pressable key={n.id} onPress={() => openNotification(n)}>
                  <Card style={[styles.item, unread ? { borderColor: accent + "66" } : null]}>
                    <View style={styles.itemHead}>
                      {unread ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null}
                      {n.priority === "high" ? (
                        <View style={[styles.pri, { backgroundColor: colors.bad + "1e" }]}>
                          <Text style={[styles.priText, { color: colors.bad }]}>URGENT</Text>
                        </View>
                      ) : null}
                      <Text style={[styles.itemTitle, unread ? { color: colors.ink } : { color: colors.inkMuted }]} numberOfLines={1}>
                        {n.title}
                      </Text>
                      <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
                    </View>
                    {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
                  </Card>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Card style={{ marginTop: 8 }}>
            <Text style={styles.empty}>You’re all caught up.</Text>
            <Muted style={{ marginTop: 4 }}>No notifications right now.</Muted>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 32 },
  markAllButton: { minHeight: 34, justifyContent: "center" },
  markAll: { fontSize: 13, fontWeight: "700" },
  backButton: {
    alignSelf: "flex-start",
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  backText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  item: { gap: 6 },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { height: 8, width: 8, borderRadius: 4 },
  pri: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  priText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  time: { fontSize: 12, color: colors.inkFaint },
  body: { fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  empty: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
