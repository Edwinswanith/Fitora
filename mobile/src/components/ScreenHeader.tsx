import { ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Text } from "./AppText";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_THEMES, colors, type RoleTheme } from "../lib/theme";
import { ProfileMenu } from "./ProfileMenu";

export function ScreenHeader({
  title,
  accent,
  roleLabel,
  subtitle,
  headerActions,
  headerActionsAlign = "start",
  inlineActions = false,
  dense = false,
}: {
  title: string;
  accent: string;
  roleLabel?: string;
  subtitle?: string;
  headerActions?: ReactNode;
  headerActionsAlign?: "start" | "end";
  /** Render headerActions on the same row as the bell/profile (left of them)
   *  instead of in a separate row below the title. */
  inlineActions?: boolean;
  dense?: boolean;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const displayRole = roleLabel ?? user?.role ?? "";
  const theme: RoleTheme =
    ROLE_THEMES[(user?.role as keyof typeof ROLE_THEMES) ?? "coach"] ?? ROLE_THEMES.coach;

  useEffect(() => {
    let active = true;
    apiJson<{ unreadCount: number }>("/api/notifications/unread-count")
      .then((r) => active && setUnread(r.unreadCount))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={[styles.shell, dense ? styles.shellDense : null]}>
      <View style={[styles.row, compact ? styles.rowCompact : null]}>
        <View style={styles.titleBlock}>
          {displayRole ? <Text style={[styles.kicker, { color: accent }]}>{displayRole}</Text> : null}
          <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={inlineActions ? 0.7 : 0.82}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>

        <View style={[styles.actions, compact ? styles.actionsCompact : null]}>
          {inlineActions && headerActions ? headerActions : null}
          <Pressable
            onPress={() => router.push("/notifications" as never)}
            hitSlop={10}
            style={[styles.iconBtn, { borderColor: colors.line }]}
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={20} color={colors.inkMuted} />
            {unread > 0 ? <View style={[styles.badge, { backgroundColor: colors.bad }]} /> : null}
          </Pressable>

          <ProfileMenu theme={theme} />
        </View>
      </View>
      {!inlineActions && headerActions ? (
        <View style={[styles.headerActions, headerActionsAlign === "end" ? styles.headerActionsEnd : null]}>
          {headerActions}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { gap: 12, marginBottom: 18 },
  shellDense: { gap: 8, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowCompact: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  titleBlock: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flexShrink: 0 },
  actionsCompact: { width: "100%" },
  headerActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  headerActionsEnd: { justifyContent: "flex-end" },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: 0 },
  subtitle: { marginTop: 2, color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  iconBtn: {
    height: 40,
    width: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { position: "absolute", top: 8, right: 8, height: 8, width: 8, borderRadius: 4 },
});
