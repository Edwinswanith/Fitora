import { ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "../lib/api";
import { ROLE_THEMES, colors, radius, type RoleTheme } from "../lib/theme";
import type { Role } from "../lib/roles";
import { useReportChrome } from "../lib/tour/MobileTourProvider";
import { ProfileMenu } from "./ProfileMenu";

export type NativeNavItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number;
};

export function AppFrame({
  role,
  title,
  subtitle,
  nav,
  activeKey,
  onNavigate,
  headerAction,
  renderHeader,
  children,
}: {
  role: Role;
  title: string;
  subtitle?: string;
  nav: NativeNavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  headerAction?: ReactNode;
  renderHeader?: (ctx: { theme: RoleTheme; unread: number; openNotifications: () => void }) => ReactNode;
  children: ReactNode;
}) {
  const theme = ROLE_THEMES[role];
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const insets = useSafeAreaInsets();
  const athleteNav = theme.role === "athlete";
  const navActiveColor = athleteNav ? "#f26a0a" : theme.accentStrong;
  const navPrimaryColor = athleteNav ? "#ff7e1a" : theme.accent;
  const openNotifications = () => router.push("/notifications" as never);
  const { ref: topChromeRef, onLayout: onTopChromeLayout } = useReportChrome("top");
  const { ref: bottomChromeRef, onLayout: onBottomChromeLayout } = useReportChrome("bottom");

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
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {renderHeader ? (
        <View ref={topChromeRef} onLayout={onTopChromeLayout} collapsable={false}>
          {renderHeader({ theme, unread, openNotifications })}
        </View>
      ) : (
        <View ref={topChromeRef} onLayout={onTopChromeLayout} collapsable={false} style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.role, { color: theme.accentStrong }]}>{theme.label}</Text>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <View style={styles.headerActions}>
            {headerAction}
            <IconButton icon="notifications-outline" onPress={openNotifications} theme={theme} badge={unread} />
            <ProfileMenu theme={theme} />
          </View>
        </View>
      )}

      <View style={styles.body}>{children}</View>

      <View
        ref={bottomChromeRef}
        onLayout={onBottomChromeLayout}
        collapsable={false}
        style={[styles.tabBar, { paddingBottom: Math.max(4, insets.bottom) }]}
      >
        {nav.map((item) => {
          const active = item.key === activeKey;
          const primary = item.key === "log";
          const icon = active && !primary && item.icon.endsWith("-outline")
            ? (item.icon.replace(/-outline$/, "") as keyof typeof Ionicons.glyphMap)
            : item.icon;
          return (
            <Pressable
              key={item.key}
              onPress={() => onNavigate(item.key)}
              style={[styles.tab, primary ? styles.tabPrimary : null]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View
                style={[
                  styles.tabIconWrap,
                  primary ? { backgroundColor: navPrimaryColor } : active && !athleteNav ? { backgroundColor: theme.accentSoft } : null,
                  primary ? styles.tabIconPrimary : null,
                ]}
              >
                <Ionicons name={icon} size={primary ? 24 : 17} color={primary ? "#ffffff" : active ? navActiveColor : colors.inkFaint} />
                {item.badge ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{item.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[styles.tabText, active ? { color: navActiveColor } : null, primary ? styles.tabTextPrimary : null]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function IconButton({
  icon,
  onPress,
  theme,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  theme: RoleTheme;
  badge?: number;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed ? { opacity: 0.82 } : null]}>
      <Ionicons name={icon} size={20} color={colors.inkMuted} />
      {badge ? <View style={[styles.dot, { backgroundColor: theme.role === "athlete" ? colors.bad : theme.accent }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  header: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  headerLeft: { flex: 1, minWidth: 0 },
  role: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 2.2 },
  title: { marginTop: 2, fontSize: 19, fontWeight: "800", color: colors.ink },
  subtitle: { marginTop: 1, fontSize: 11, color: colors.inkFaint },
  headerActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flexShrink: 0 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2b251f",
    shadowOpacity: 0.024,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  dot: { position: "absolute", top: 7, right: 7, height: 10, width: 10, borderRadius: 5 },
  body: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 4,
    marginHorizontal: 10,
    marginBottom: 3,
    paddingTop: 2,
    paddingHorizontal: 9,
    paddingBottom: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 28,
    backgroundColor: "rgba(255,254,253,0.992)",
    shadowColor: "#2b251f",
    shadowOpacity: 0.026,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: -4 },
    elevation: 1,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1, minHeight: 38 },
  tabPrimary: { justifyContent: "center" },
  tabIconWrap: {
    position: "relative",
    height: 28,
    minWidth: 44,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconPrimary: {
    height: 42,
    width: 42,
    minWidth: 42,
    borderRadius: 21,
    marginTop: 12,
    shadowColor: "#2b251f",
    shadowOpacity: 0.075,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  tabText: {
    fontSize: 9.3,
    fontWeight: "800",
    color: colors.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 0.55,
  },
  tabTextPrimary: { height: 0, opacity: 0 },
  tabBadge: {
    position: "absolute",
    top: -3,
    right: 2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.bad,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  tabBadgeText: { color: "#fff", fontSize: 9, fontWeight: "900" },
});
