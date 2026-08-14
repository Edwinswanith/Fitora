import { useState } from "react";
import { Modal, Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { Text } from "./AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { colors, radius, type RoleTheme } from "../lib/theme";
import { Avatar } from "./Avatar";
import { PexHeaderBadge } from "./mascot/PexHeaderBadge";

export function ProfileMenu({
  theme,
  size = 38,
  textSize = 12,
  style,
}: {
  theme: RoleTheme;
  size?: number;
  textSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const name = user?.name || "Your account";
  const email = user?.email ?? "";

  async function onSignOut() {
    setOpen(false);
    await signOut();
    router.replace("/");
  }

  function openAccount() {
    setOpen(false);
    router.push("/account" as never);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={({ pressed }) => [
          styles.avatarButton,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: theme.accent,
          },
          style,
          pressed ? { opacity: 0.82 } : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Profile and account"
      >
        <PexHeaderBadge size={size} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.menu, { top: Math.max(insets.top + 54, 64) }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.identityRow}>
              <Avatar
                avatar={user?.avatar}
                name={name}
                size={42}
                accentSoft={theme.accentSoft}
                accentStrong={theme.accentStrong}
              />
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1}>
                  {name}
                </Text>
                {email ? (
                  <Text style={styles.email} numberOfLines={1}>
                    {email}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={[styles.roleChip, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.roleText, { color: theme.accentStrong }]}>{theme.label}</Text>
            </View>

            <View style={styles.divider} />

            <Pressable onPress={openAccount} style={styles.menuItem} accessibilityRole="button">
              <Ionicons name="key-outline" size={18} color={colors.inkMuted} />
              <Text style={styles.menuItemText}>Account</Text>
            </Pressable>
            <Pressable onPress={onSignOut} style={styles.menuItem} accessibilityRole="button">
              <Ionicons name="log-out-outline" size={18} color={colors.bad} />
              <Text style={[styles.menuItemText, { color: colors.bad }]}>Sign out</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  avatarButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28,26,22,0.14)",
  },
  menu: {
    position: "absolute",
    right: 14,
    width: 264,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    padding: 12,
    shadowColor: "#2b251f",
    shadowOpacity: 0.07,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
  },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: "800", color: colors.ink },
  email: { marginTop: 2, fontSize: 11, color: colors.inkMuted },
  roleChip: { alignSelf: "flex-start", marginTop: 10, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  menuItem: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radius.sm, paddingHorizontal: 8 },
  menuItemText: { fontSize: 14, fontWeight: "700", color: colors.ink },
});
