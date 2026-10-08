import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { dashboardPathForRole, isKnownRole } from "../../lib/roles";
import { useAuth } from "../../lib/auth";
import { Banner, H1, Label, Muted, PrimaryButton, TextField } from "../../components/ui";
import { GoogleSignInButton } from "../../components/GoogleSignInButton";
import { AppleSignInButton } from "../../components/AppleSignInButton";

export default function LoginScreen() {
  const params = useLocalSearchParams<{ role: string }>();
  const role = isKnownRole(params.role ?? "") ? (params.role as keyof typeof ROLE_THEMES) : "coach";
  const theme = ROLE_THEMES[role];
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    const result = await signIn(email, password);
    setLoading(false);
    if (!result.ok) {
      // Only report "wrong credentials" for the specific case the server
      // actually reported — a server/network failure must never be
      // misreported as a bad password (it isn't one, and it hides the
      // real problem from anyone diagnosing it).
      if (result.status === 429) setError("Too many sign-in attempts. Wait a minute and try again.");
      else if (result.status === 0) setError("Unable to reach the server. Check your connection.");
      else if (result.status === 401) setError("Invalid email or password.");
      else setError("Something went wrong signing in. Please try again.");
      return;
    }
    const dest = dashboardPathForRole(result.user.role);
    if (!dest) {
      setError(`The ${result.user.role} workspace isn't available yet.`);
      return;
    }
    router.replace(dest as never);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}
            style={({ pressed }) => [styles.back, pressed ? { opacity: 0.7 } : null]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back to all roles"
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>

          <LinearGradient colors={[colors.primary, colors.primaryStrong]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandTile}>
            <Ionicons name={`${theme.icon}` as never} size={26} color={colors.onPrimary} />
          </LinearGradient>

          <View style={[styles.chip, { backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.chipText, { color: theme.accentStrong }]}>{theme.label} sign in</Text>
          </View>

          <H1 style={{ marginTop: 10 }}>{theme.heading}</H1>
          <Muted style={{ marginTop: 8, maxWidth: 320 }}>{theme.subcopy}</Muted>

          <View style={styles.form}>
            <View>
              <Label>Email</Label>
              <View style={{ marginTop: 6 }}>
                <TextField
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@academy.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  editable={!loading}
                />
              </View>
            </View>

            <View>
              <Label>Password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  isPassword
                  editable={!loading}
                />
              </View>
            </View>

            {error ? <Banner kind="error">{error}</Banner> : null}

            <PrimaryButton
              label={`Sign in as ${theme.label.toLowerCase()}`}
              onPress={onSubmit}
              loading={loading}
              accent={theme.accent}
              accentInk={theme.accentInk}
            />

            <GoogleSignInButton requestedRole={role} onError={setError} />
            <AppleSignInButton requestedRole={role} onError={setError} />

            {role === "athlete" ? (
              <Pressable onPress={() => router.push("/register" as never)} style={styles.registerLink} hitSlop={8}>
                <Text style={styles.registerText}>
                  New here? <Text style={{ color: theme.accentStrong, fontWeight: "700" }}>Create an account</Text>
                </Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line, marginBottom: 20 },
  brandTile: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  form: { marginTop: 24, gap: 16, padding: 16, borderRadius: 16, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: "800" },
  registerLink: { alignItems: "center", paddingVertical: 6 },
  registerText: { fontSize: 13, color: colors.inkMuted },
});
