import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { dashboardPathForRole } from "../lib/roles";
import { ROLE_THEMES, colors } from "../lib/theme";
import { Banner, Card, H1, Label, Muted, PrimaryButton, TextField } from "../components/ui";

const theme = ROLE_THEMES.athlete;

// Mirrors the backend's REG_EMAIL_RE (server/src/routes/auth.ts) so obviously
// invalid addresses are caught before a round trip, not just re-validated.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sport, setSport] = useState("");
  const [position, setPosition] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Field-specific, checked in the order a user fills the form — required before any request is sent. */
  function validate(): string | null {
    if (!name.trim()) return "Full name is required.";
    if (!email.trim()) return "Email is required.";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (!sport.trim()) return "Sport is required.";
    return null;
  }

  async function submit() {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    const result = await signUp({ name: name.trim(), email: email.trim(), password, sport: sport.trim(), position: position.trim() || undefined });
    setSaving(false);
    if (!result.ok) {
      // Map every backend error code we can to a specific, actionable
      // message — a server/network failure must never be presented as if
      // the athlete's own input was the problem.
      if (result.status === 409) setError("That email already has an account.");
      else if (result.error === "weak_password") setError("Password must be at least 8 characters.");
      else if (result.error === "invalid_email") setError("Enter a valid email address.");
      else if (result.error === "invalid_name") setError("Full name is required.");
      else if (result.error === "invalid_sport") setError("Sport is required.");
      else if (result.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else if (result.status === 0) setError("Unable to reach the server. Check your connection.");
      else setError("Something went wrong creating your account. Please try again.");
      return;
    }
    const dest = dashboardPathForRole(result.user.role) ?? "/athlete/dashboard";
    router.replace(dest as never);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={colors.inkFaint} />
            <Text style={styles.backText}>BACK</Text>
          </Pressable>

          <H1>Create your account</H1>
          <Muted style={{ marginTop: 8, marginBottom: 20 }}>Join as an athlete and start logging in under a minute.</Muted>

          <Card style={{ gap: 14 }}>
            <Field label="Full name" value={name} onChange={setName} placeholder="Jane Doe" />
            <Field label="Email" value={email} onChange={setEmail} placeholder="you@academy.com" email />
            <View>
              <Label>Password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={password} onChangeText={setPassword} placeholder="At least 8 characters" isPassword editable={!saving} />
              </View>
            </View>
            <Field label="Sport" value={sport} onChange={setSport} placeholder="Football" />
            <Field label="Position (optional)" value={position} onChange={setPosition} placeholder="Striker" />
            {error ? <Banner kind="error">{error}</Banner> : null}
            <PrimaryButton label="Create account" onPress={submit} loading={saving} accent={theme.accent} accentInk={theme.accentInk} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, email }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; email?: boolean }) {
  return (
    <View>
      <Label>{label}</Label>
      <View style={{ marginTop: 6 }}>
        <TextField value={value} onChangeText={onChange} placeholder={placeholder} autoCapitalize={email ? "none" : "words"} autoCorrect={false} keyboardType={email ? "email-address" : "default"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 24, paddingTop: 16, paddingBottom: 32 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 20 },
  backText: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
});
