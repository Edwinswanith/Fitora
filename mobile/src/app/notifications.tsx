import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_THEMES, colors, layout, type RoleTheme } from "../lib/theme";
import { dashboardPathForRole } from "../lib/roles";
import { BackHeader, EmptyState, LoadingState } from "../components/fitora";
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
      router.replace(home as never);
      return;
    }

    // Direct-message notifications: the web links to dedicated thread screens
    // (/athlete/messages/:coachId, /coach/messages/:athleteId) that have no
    // standalone mobile screen. On mobile, athlete messaging lives in the
    // dashboard "coach" section and coach messaging at /coach/messages.
    // replace, not push — landing back on the dashboard from notifications
    // should reuse/refresh it, not stack a fresh instance on top.
    const athleteMsg = /^\/athlete\/messages\/([^/?]+)/.exec(link);
    if (athleteMsg) {
      router.replace({ pathname: "/athlete/dashboard", params: { section: "coach", coachId: athleteMsg[1] } } as never);
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
        <BackHeader
          title="Notifications"
          subtitle={data && data.unreadCount > 0 ? `${data.unreadCount} unread` : "You're all caught up"}
          onBack={() => (router.canGoBack() ? router.back() : router.push(dashboardPathForRole(user?.role ?? "") as never))}
          actionLabel={data && data.unreadCount > 0 ? "Mark all read" : undefined}
          onAction={data && data.unreadCount > 0 ? markAll : undefined}
        />

        {loading && !data ? (
          <LoadingState variant="inline" label="Loading notifications..." />
        ) : data && data.notifications.length > 0 ? (
          <View style={styles.list}>
            {data.notifications.map((n) => {
              const unread = !n.read && !n.readAt;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => openNotification(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${unread ? "Unread. " : ""}${n.title}`}
                  style={({ pressed }) => [styles.item, unread ? styles.itemUnread : null, pressed ? { opacity: 0.8 } : null]}
                >
                  <View style={[styles.itemIcon, n.priority === "high" ? { backgroundColor: colors.badSoft } : null]}>
                    <Ionicons
                      name={n.priority === "high" ? "alert-circle-outline" : n.type === "message" ? "chatbubble-outline" : "notifications-outline"}
                      size={19}
                      color={n.priority === "high" ? colors.bad : colors.primary}
                    />
                  </View>
                  <View style={styles.itemCopy}>
                    <View style={styles.itemHead}>
                      <Text style={[styles.itemTitle, unread ? null : { color: colors.inkMuted }]} numberOfLines={1}>{n.title}</Text>
                      <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
                    </View>
                    {n.priority === "high" ? <Text style={styles.priText}>Urgent</Text> : null}
                    {n.body ? <Text style={styles.body} numberOfLines={3}>{n.body}</Text> : null}
                  </View>
                  {unread ? <View style={styles.dot} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <EmptyState icon="notifications-outline" title="You're all caught up" body="New reminders, messages and updates will show up here." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: 32, gap: layout.sectionGap },
  list: { gap: 8 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: "#e1ece9", backgroundColor: colors.surfaceRaised },
  itemUnread: { backgroundColor: "#f3fbf9", borderColor: colors.primary + "55" },
  itemIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  itemCopy: { flex: 1, minWidth: 0, gap: 3 },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { height: 9, width: 9, borderRadius: 5, marginTop: 6, backgroundColor: colors.energy },
  priText: { fontSize: 12, fontWeight: "800", color: colors.bad },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: colors.ink },
  time: { fontSize: 12, color: colors.inkFaint },
  body: { fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
});
