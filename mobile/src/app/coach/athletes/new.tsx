import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { apiFetch } from "../../../lib/api";
import { ROLE_THEMES, colors, radius, fonts } from "../../../lib/theme";
import { updateCachedData, type CoachHomeData } from "../../../lib/fitoraData";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../../../components/ui";
import { BackHeader } from "../../../components/fitora";

const theme = ROLE_THEMES.coach;

type Created = { name: string; email: string; tempPassword?: string };
type Mode = "create" | "link";

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
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

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
    const target = linkEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError("Enter the athlete's email.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/coach/athletes/link", {
        method: "POST",
        body: JSON.stringify({ email: target }),
      });
      if (!res.ok) {
        setError(res.status === 429 ? "Too many invites at once. Wait a minute and try again." : "Couldn't send the invite. Check the email and try again.");
        return;
      }
      // The server answers the same way whether or not the email has an
      // account, so all we can say is that the invite went out if it could.
      setInvitedEmail(target);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (invitedEmail) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Invite sent</Text>
          <Muted style={{ marginBottom: 16 }}>
            {`If ${invitedEmail} has a Fitora athlete account without a coach, they'll get your invite. They'll appear in your clients once they accept.`}
          </Muted>
          <View style={{ marginTop: 16, gap: 10 }}>
            <PrimaryButton
              label="Invite Another"
              onPress={() => { setInvitedEmail(null); setLinkEmail(""); }}
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

  if (created) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Client added</Text>
          <Muted style={{ marginBottom: 16 }}>{`Share these sign-in details with ${created.name}.`}</Muted>
          {created.tempPassword ? (
            <Card style={{ gap: 12 }}>
              <Secret label="Email" value={created.email} />
              <Secret label="Temporary password" value={created.tempPassword} />
              <Text style={styles.once}>Shown once — copy it now.</Text>
            </Card>
          ) : null}
          <View style={{ marginTop: 16, gap: 10 }}>
            <PrimaryButton
              label="Add Another"
              onPress={() => { setCreated(null); setName(""); setEmail(""); setSport(""); setPosition(""); }}
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
          <BackHeader title="Add client" subtitle="Create a new account, or invite someone who already signed up." />

          <View style={styles.modeToggle}>
            <Pressable onPress={() => { setMode("create"); setError(null); }} style={[styles.modeButton, mode === "create" ? styles.modeButtonActive : null]}>
              <Text style={[styles.modeButtonText, mode === "create" ? styles.modeButtonTextActive : null]}>Create new</Text>
            </Pressable>
            <Pressable onPress={() => { setMode("link"); setError(null); }} style={[styles.modeButton, mode === "link" ? styles.modeButtonActive : null]}>
              <Text style={[styles.modeButtonText, mode === "link" ? styles.modeButtonTextActive : null]}>Invite existing</Text>
            </Pressable>
          </View>

          {mode === "create" ? (
            <Card style={{ gap: 14 }}>
              <Field label="Full name" value={name} onChange={setName} placeholder="Jane Doe" />
              <Field label="Email" value={email} onChange={setEmail} placeholder="jane@academy.com" email />
              <Field label="Sport" value={sport} onChange={setSport} placeholder="Football" />
              <Field label="Position (optional)" value={position} onChange={setPosition} placeholder="Striker" />
              {error ? <Banner kind="error">{error}</Banner> : null}
              <PrimaryButton label="Create Client" onPress={submit} loading={saving} accent={theme.accent} accentInk={theme.accentInk} />
            </Card>
          ) : (
            <Card style={{ gap: 14 }}>
              <Muted>Sends an invite to an athlete who already has a Fitora account. They join your clients only after they accept.</Muted>
              <Field label="Athlete email" value={linkEmail} onChange={setLinkEmail} placeholder="jane@academy.com" email />
              {error ? <Banner kind="error">{error}</Banner> : null}
              <PrimaryButton label="Send Invite" onPress={submitLink} loading={saving} accent={theme.accent} accentInk={theme.accentInk} />
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
  title: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 30, color: colors.ink },
  modeToggle: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 16 },
  modeButton: { flex: 1, minHeight: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  modeButtonActive: { backgroundColor: colors.primary },
  modeButtonText: { fontSize: 13, fontWeight: "800", color: colors.inkMuted },
  modeButtonTextActive: { color: colors.onPrimary },
  secret: { backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 12 },
  secretLabel: { fontSize: 12, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1 },
  secretValue: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  once: { fontSize: 12, color: colors.inkFaint },
  secondary: { height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  secondaryText: { fontSize: 15, fontWeight: "700", color: colors.ink },
});
