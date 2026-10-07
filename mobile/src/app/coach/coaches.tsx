import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson, isAuthFailure, ApiError } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { ActionButton, AppCard, BackHeader, EmptyState, ErrorState, LoadingState, StatusChip } from "../../components/fitora";
import { useTourHighlight, useTourScrollView } from "../../lib/tour/MobileTourProvider";
import { useSpotlightRef } from "../../lib/tour/SpotlightTarget";

type Coach = { userId: string; name: string; email: string; isAcademyOwner: boolean };
type Response = { coaches: Coach[] };
const accent = ROLE_THEMES.coach.accent;

export default function Coaches() {
  const { highlightStyle: coachesHighlight } = useTourHighlight("mobile-coach-coaches");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const { ref: coachesSpotlightRef, onLayout: coachesSpotlightOnLayout } = useSpotlightRef("mobile-coach-coaches");
  const [coaches, setCoaches] = useState<Coach[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; tempPassword: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiJson<Response>("/api/coach/coaches");
      setCoaches(res.coaches);
    } catch (e) {
      if (e instanceof ApiError && isAuthFailure(e.status)) setForbidden(true);
      else setError("Couldn't load coaches. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setFormError(null);
    if (!name.trim() || !email.trim()) {
      setFormError("Name and email are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/coach/coaches", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { coach?: { userId: string; name: string; email: string }; tempPassword?: string };
      if (res.status === 409) {
        setFormError("That email already has an account.");
        return;
      }
      if (!res.ok || !json.tempPassword) {
        setFormError("Couldn't create coach. Try again.");
        return;
      }
      setCreated({ name: json.coach?.name ?? name.trim(), email: json.coach?.email ?? email.trim(), tempPassword: json.tempPassword });
      setName("");
      setEmail("");
      setAdding(false);
      // The response already has everything needed for the list row — no
      // need to re-fetch the whole coaches list to add one entry.
      if (json.coach) {
        setCoaches((prev) => [...(prev ?? []), { userId: json.coach!.userId, name: json.coach!.name, email: json.coach!.email, isAcademyOwner: false }]);
      }
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={tourScrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
        >
          <BackHeader title="Coaches" subtitle="Coaches in your academy" />
          {!forbidden ? (
                <Pressable
                  ref={coachesSpotlightRef}
                  onLayout={coachesSpotlightOnLayout}
                  onPress={() => { setAdding((a) => !a); setCreated(null); }}
                  style={[styles.addBtn, { backgroundColor: accent }, coachesHighlight]}
                  hitSlop={8}
                  accessibilityLabel={adding ? "Cancel add coach" : "Add coach"}
                >
                  <Ionicons name={adding ? "close" : "add"} size={20} color="#fff" />
                  <Text style={styles.addBtnLabel}>{adding ? "Cancel" : "Add coach"}</Text>
                </Pressable>
          ) : null}

          {created ? (
            <AppCard style={[styles.created, { gap: 10 }]}>
              <Text style={styles.createdTitle}>Coach added — {created.name}</Text>
              <Secret label="Email" value={created.email} />
              <Secret label="Temporary password" value={created.tempPassword} />
              <Text style={styles.once}>Shown once — copy it now.</Text>
            </AppCard>
          ) : null}

          {adding ? (
            <AppCard style={{ gap: 14, marginBottom: 16 }}>
              <View>
                <Text style={styles.fieldLabel}>Full name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Jane Doe"
                  placeholderTextColor={colors.inkFaint}
                  autoCapitalize="words"
                  style={[styles.input, { marginTop: 6 }]}
                />
              </View>
              <View>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="jane@academy.com"
                  placeholderTextColor={colors.inkFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  style={[styles.input, { marginTop: 6 }]}
                />
              </View>
              {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
              <ActionButton label={saving ? "Creating..." : "Create coach"} icon="person-add-outline" variant="filled" onPress={submit} disabled={saving} />
            </AppCard>
          ) : null}

          {loading && !coaches && !forbidden ? (
            <LoadingState label="Loading coaches..." variant="inline" />
          ) : forbidden ? (
            <EmptyState icon="lock-closed-outline" title="Owner only" body="Only the academy owner can manage coaches." />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : coaches && coaches.length > 0 ? (
            <View style={{ gap: 10 }}>
              {coaches.map((c) => (
                <AppCard key={c.userId} style={styles.row}>
                  <View style={[styles.avatar, { backgroundColor: accent + "1e" }]}>
                    <Ionicons name="person" size={18} color={accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.name}</Text>
                    <Text style={styles.meta}>{c.email}</Text>
                  </View>
                  {c.isAcademyOwner ? <StatusChip label="OWNER" tone="primary" /> : null}
                </AppCard>
              ))}
            </View>
          ) : (
            <EmptyState icon="people-outline" title="No coaches found" />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  addBtn: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 12 },
  addBtnLabel: { color: "#fff", fontWeight: "800", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { height: 40, width: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  fieldLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  errorText: { color: colors.bad, fontSize: 13, fontWeight: "800" },
  created: { borderColor: colors.ok + "55", marginBottom: 16 },
  createdTitle: { fontSize: 15, fontWeight: "800", color: colors.ink },
  secret: { backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 12 },
  secretLabel: { fontSize: 12, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1 },
  secretValue: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  once: { fontSize: 12, color: colors.inkFaint },
});
