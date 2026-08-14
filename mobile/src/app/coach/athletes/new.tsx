import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../../lib/theme";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../../../components/ui";

const theme = ROLE_THEMES.coach;

type Created = { name: string; email: string; tempPassword: string };

export default function NewAthlete() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sport, setSport] = useState("");
  const [position, setPosition] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim() || !email.trim() || !sport.trim()) {
      setError("Name, email and sport are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/coach/athletes", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), sport: sport.trim(), position: position.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { athlete?: { name: string; email: string }; tempPassword?: string; error?: string };
      if (res.status === 409) {
        setError("That email already has an account.");
        return;
      }
      if (!res.ok || !json.tempPassword) {
        setError("Couldn't create athlete. Check the details and try again.");
        return;
      }
      setCreated({ name: json.athlete?.name ?? name.trim(), email: json.athlete?.email ?? email.trim(), tempPassword: json.tempPassword });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Athlete added</Text>
          <Muted style={{ marginBottom: 16 }}>Share these sign-in details with {created.name}.</Muted>
          <Card style={{ gap: 12 }}>
            <Secret label="Email" value={created.email} />
            <Secret label="Temporary password" value={created.tempPassword} />
            <Text style={styles.once}>Shown once — copy it now.</Text>
          </Card>
          <View style={{ marginTop: 16, gap: 10 }}>
            <PrimaryButton label="Add another" onPress={() => { setCreated(null); setName(""); setEmail(""); setSport(""); setPosition(""); }} accent={theme.accent} accentInk={theme.accentInk} />
            <Pressable onPress={() => router.back()} style={styles.secondary}>
              <Text style={styles.secondaryText}>Back to roster</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={colors.inkFaint} />
            <Text style={styles.backText}>ROSTER</Text>
          </Pressable>
          <Text style={styles.title}>Add athlete</Text>
          <Muted style={{ marginBottom: 16 }}>Creates an account in your academy.</Muted>

          <Card style={{ gap: 14 }}>
            <Field label="Full name" value={name} onChange={setName} placeholder="Jane Doe" />
            <Field label="Email" value={email} onChange={setEmail} placeholder="jane@academy.com" email />
            <Field label="Sport" value={sport} onChange={setSport} placeholder="Football" />
            <Field label="Position (optional)" value={position} onChange={setPosition} placeholder="Striker" />
            {error ? <Banner kind="error">{error}</Banner> : null}
            <PrimaryButton label="Create athlete" onPress={submit} loading={saving} accent={theme.accent} accentInk={theme.accentInk} />
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

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.secret}>
      <Text style={styles.secretLabel}>{label}</Text>
      <Text selectable style={styles.secretValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 32 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  backText: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  secret: { backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 12 },
  secretLabel: { fontSize: 11, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1 },
  secretValue: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  once: { fontSize: 11, color: colors.inkFaint },
  secondary: { height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  secondaryText: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
