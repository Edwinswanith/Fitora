import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../../lib/theme";
import { updateCachedData, type CoachHomeData } from "../../../lib/fitoraData";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../../../components/ui";

const theme = ROLE_THEMES.coach;

type Created = { name: string; email: string; tempPassword?: string };
type Mode = "create" | "link";

const LINK_ERROR_MESSAGES: Record<string, string> = {
  athlete_not_found: "No self-registered athlete found with that email.",
  already_linked: "This athlete is already on your roster.",
  athlete_has_active_coach: "This athlete already has another coach.",
};

export default function NewAthlete() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sport, setSport] = useState("");
  const [position, setPosition] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  function addToRosterCache(athlete: { athleteId: string; userId?: string; name: string; email: string; sport: string; position?: string | null }) {
    // The roster screen (coach/athletes/index.tsx) shares this cache key —
    // patch it directly instead of leaving the new athlete invisible there
    // until a manual pull-to-refresh.
    updateCachedData<CoachHomeData>("coach-dashboard", (prev) =>
      prev
        ? {
            ...prev,
            roster: [
              ...prev.roster,
              {
                athleteId: athlete.athleteId,
                userId: athlete.userId,
                name: athlete.name,
                email: athlete.email,
                sport: athlete.sport,
                position: athlete.position ?? null,
              },
            ],
          }
        : prev
    );
  }

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
      const json = (await res.json().catch(() => ({}))) as {
        athlete?: { athleteId: string; userId?: string; name: string; email: string; sport: string; position?: string | null };
        tempPassword?: string;
        error?: string;
      };
      if (res.status === 409) {
        setError("That email already has an account.");
        return;
      }
      if (!res.ok || !json.tempPassword) {
        setError("Couldn't create athlete. Check the details and try again.");
        return;
      }
      if (json.athlete) addToRosterCache(json.athlete);
      setCreated({ name: json.athlete?.name ?? name.trim(), email: json.athlete?.email ?? email.trim(), tempPassword: json.tempPassword });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function submitLink() {
    setError(null);
    if (!linkEmail.trim()) {
      setError("Enter the athlete's email.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/coach/athletes/link", {
        method: "POST",
        body: JSON.stringify({ email: linkEmail.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        athlete?: { athleteId: string; userId?: string; name: string; email: string; sport: string; position?: string | null };
        error?: string;
      };
      if (!res.ok || !json.athlete) {
        setError((json.error && LINK_ERROR_MESSAGES[json.error]) || "Couldn't link this athlete. Check the email and try again.");
        return;
      }
      addToRosterCache(json.athlete);
      setCreated({ name: json.athlete.name, email: json.athlete.email });
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
          <Text style={styles.title}>{created.tempPassword ? "Athlete added" : "Client linked"}</Text>
          <Muted style={{ marginBottom: 16 }}>
            {created.tempPassword ? `Share these sign-in details with ${created.name}.` : `You're now coaching ${created.name}.`}
          </Muted>
          {created.tempPassword ? (
            <Card style={{ gap: 12 }}>
              <Secret label="Email" value={created.email} />
              <Secret label="Temporary password" value={created.tempPassword} />
              <Text style={styles.once}>Shown once — copy it now.</Text>
            </Card>
          ) : null}
          <View style={{ marginTop: 16, gap: 10 }}>
            <PrimaryButton
              label={mode === "link" ? "Link another" : "Add another"}
              onPress={() => { setCreated(null); setName(""); setEmail(""); setSport(""); setPosition(""); setLinkEmail(""); }}
              accent={theme.accent}
              accentInk={theme.accentInk}
            />
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
          <Muted style={{ marginBottom: 16 }}>Create a new account, or link an athlete who already signed up on their own.</Muted>

          <View style={styles.modeToggle}>
            <Pressable onPress={() => { setMode("create"); setError(null); }} style={[styles.modeButton, mode === "create" ? styles.modeButtonActive : null]}>
              <Text style={[styles.modeButtonText, mode === "create" ? styles.modeButtonTextActive : null]}>Create new</Text>
            </Pressable>
            <Pressable onPress={() => { setMode("link"); setError(null); }} style={[styles.modeButton, mode === "link" ? styles.modeButtonActive : null]}>
              <Text style={[styles.modeButtonText, mode === "link" ? styles.modeButtonTextActive : null]}>Link existing</Text>
            </Pressable>
          </View>

          {mode === "create" ? (
            <Card style={{ gap: 14 }}>
              <Field label="Full name" value={name} onChange={setName} placeholder="Jane Doe" />
              <Field label="Email" value={email} onChange={setEmail} placeholder="jane@academy.com" email />
              <Field label="Sport" value={sport} onChange={setSport} placeholder="Football" />
              <Field label="Position (optional)" value={position} onChange={setPosition} placeholder="Striker" />
              {error ? <Banner kind="error">{error}</Banner> : null}
              <PrimaryButton label="Create athlete" onPress={submit} loading={saving} accent={theme.accent} accentInk={theme.accentInk} />
            </Card>
          ) : (
            <Card style={{ gap: 14 }}>
              <Muted>Links a self-registered athlete to your roster by email. No new account or password is created.</Muted>
              <Field label="Athlete email" value={linkEmail} onChange={setLinkEmail} placeholder="jane@academy.com" email />
              {error ? <Banner kind="error">{error}</Banner> : null}
              <PrimaryButton label="Link athlete" onPress={submitLink} loading={saving} accent={theme.accent} accentInk={theme.accentInk} />
            </Card>
          )}
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
  modeToggle: { flexDirection: "row", gap: 8, marginBottom: 16 },
  modeButton: { flex: 1, minHeight: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  modeButtonActive: { backgroundColor: colors.ink },
  modeButtonText: { fontSize: 13, fontWeight: "800", color: colors.inkMuted },
  modeButtonTextActive: { color: "#fff" },
  secret: { backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 12 },
  secretLabel: { fontSize: 11, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1 },
  secretValue: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  once: { fontSize: 11, color: colors.inkFaint },
  secondary: { height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  secondaryText: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
