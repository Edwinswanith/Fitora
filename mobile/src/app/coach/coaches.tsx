import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, apiJson, isAuthFailure, ApiError } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../../components/ui";
import { ScreenHeader } from "../../components/ScreenHeader";
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
      const json = (await res.json().catch(() => ({}))) as { coach?: { name: string; email: string }; tempPassword?: string };
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
      load();
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
          <ScreenHeader
            title="Coaches"
            accent={accent}
            roleLabel="Coach"
            subtitle="Academy owner"
            inlineActions
            headerActions={
              !forbidden ? (
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
              ) : undefined
            }
          />

          {created ? (
            <Card style={[styles.created, { gap: 10 }]}>
              <Text style={styles.createdTitle}>Coach added — {created.name}</Text>
              <Secret label="Email" value={created.email} />
              <Secret label="Temporary password" value={created.tempPassword} />
              <Text style={styles.once}>Shown once — copy it now.</Text>
            </Card>
          ) : null}

          {adding ? (
            <Card style={{ gap: 14, marginBottom: 16 }}>
              <View>
                <Label>Full name</Label>
                <View style={{ marginTop: 6 }}>
                  <TextField value={name} onChangeText={setName} placeholder="Jane Doe" autoCapitalize="words" />
                </View>
              </View>
              <View>
                <Label>Email</Label>
                <View style={{ marginTop: 6 }}>
                  <TextField value={email} onChangeText={setEmail} placeholder="jane@academy.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
                </View>
              </View>
              {formError ? <Banner kind="error">{formError}</Banner> : null}
              <PrimaryButton label="Create coach" onPress={submit} loading={saving} accent={accent} accentInk="#fff" />
            </Card>
          ) : null}

          {loading && !coaches && !forbidden ? (
            <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
          ) : forbidden ? (
            <Card>
              <Text style={styles.empty}>Owner only</Text>
              <Muted style={{ marginTop: 4 }}>Only the academy owner can manage coaches.</Muted>
            </Card>
          ) : error ? (
            <Card>
              <Muted>{error}</Muted>
            </Card>
          ) : coaches && coaches.length > 0 ? (
            <View style={{ gap: 10 }}>
              {coaches.map((c) => (
                <Card key={c.userId} style={styles.row}>
                  <View style={[styles.avatar, { backgroundColor: accent + "1e" }]}>
                    <Ionicons name="person" size={18} color={accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.name}</Text>
                    <Text style={styles.meta}>{c.email}</Text>
                  </View>
                  {c.isAcademyOwner ? (
                    <View style={[styles.ownerChip, { backgroundColor: accent + "1e" }]}>
                      <Text style={[styles.ownerText, { color: accent }]}>OWNER</Text>
                    </View>
                  ) : null}
                </Card>
              ))}
            </View>
          ) : (
            <Card>
              <Text style={styles.empty}>No coaches found.</Text>
            </Card>
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
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 12 },
  addBtnLabel: { color: "#fff", fontWeight: "800", fontSize: 13 },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  avatar: { height: 40, width: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  ownerChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  ownerText: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  empty: { fontSize: 15, fontWeight: "700", color: colors.ink },
  created: { borderColor: colors.ok + "55", marginBottom: 16 },
  createdTitle: { fontSize: 15, fontWeight: "800", color: colors.ink },
  secret: { backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 12 },
  secretLabel: { fontSize: 11, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1 },
  secretValue: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 4, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  once: { fontSize: 11, color: colors.inkFaint },
});
