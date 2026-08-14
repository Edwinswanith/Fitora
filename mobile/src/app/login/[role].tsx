import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={colors.inkFaint} />
            <Text style={styles.backText}>ALL ROLES</Text>
          </Pressable>

          <View style={[styles.chip, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name={`${theme.icon}` as never} size={14} color={theme.accentStrong} />
            <Text style={[styles.chipText, { color: theme.accentStrong }]}>{theme.label} login</Text>
          </View>

          <H1 style={{ marginTop: 14 }}>{theme.heading}</H1>
          <Muted style={{ marginTop: 10, maxWidth: 300 }}>{theme.subcopy}</Muted>

          <View style={{ marginTop: 28, gap: 16 }}>
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
  content: { padding: 24, paddingTop: 16, paddingBottom: 36 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 24 },
  backText: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  registerLink: { alignItems: "center", paddingVertical: 6 },
  registerText: { fontSize: 13, color: colors.inkMuted },
});
