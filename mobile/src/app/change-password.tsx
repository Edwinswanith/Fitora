// Shown instead of the app while the account still has the temporary password
// a coach (or academy owner) issued. The server refuses everything outside
// /api/auth until it is changed (403 must_change_password), because whoever
// created the account knows that password.

import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Text } from "../components/AppText";
import { ActionButton, AppCard, FormField } from "../components/fitora";
import { changePassword } from "../lib/api";
import { useAuth } from "../lib/auth";
import { celebrate } from "../lib/feedback";
import { dashboardPathForRole } from "../lib/roles";
import { colors, fonts } from "../lib/theme";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { user, setUser, signOut } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!current || !next || !confirm) {
      setError("Fill in all three fields.");
      return;
    }
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    const res = await changePassword(current, next);
    setSaving(false);
    if (!res.ok) {
      setError(
        res.status === 401
          ? "The temporary password is incorrect."
          : res.error === "same_password"
            ? "Choose a password different from the temporary one."
            : "Couldn't update your password. Try again."
      );
      return;
    }
    setUser(res.user);
    celebrate({ title: "Password set", body: "Only you know it now." });
    router.replace((dashboardPathForRole(res.user.role) ?? "/") as never);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Set your password</Text>
          <Text style={styles.body}>
            {`${user?.name ? `${user.name.split(" ")[0]}, your` : "Your"} account was created with a temporary password. Choose your own before you continue.`}
          </Text>
          <AppCard style={styles.card}>
            <View style={styles.field}>
              <FormField value={current} onChangeText={(v) => { setCurrent(v); setError(null); }} placeholder="Temporary password" secureTextEntry autoCapitalize="none" />
            </View>
            <View style={styles.field}>
              <FormField value={next} onChangeText={(v) => { setNext(v); setError(null); }} placeholder="New password (8+ characters)" secureTextEntry autoCapitalize="none" />
            </View>
            <View style={styles.field}>
              <FormField value={confirm} onChangeText={(v) => { setConfirm(v); setError(null); }} placeholder="Confirm new password" secureTextEntry autoCapitalize="none" error={error} onSubmitEditing={() => void save()} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ActionButton label="Save Password" variant="filled" busy={saving} onPress={() => void save()} style={styles.button} />
          </AppCard>
          <Pressable onPress={() => void signOut().then(() => router.replace("/"))} style={styles.signOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 32, gap: 14 },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: 32, lineHeight: 36, textTransform: "uppercase" },
  body: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  card: { gap: 12, padding: 16 },
  field: { minHeight: 48 },
  error: { color: colors.bad, fontSize: 13, fontWeight: "700" },
  button: { minHeight: 48, borderRadius: 10 },
  signOut: { alignSelf: "center", padding: 12 },
  signOutText: { color: colors.primary, fontSize: 14, fontWeight: "800" },
});
