import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { apiFetch, changePassword, persistUser, type StoredUser } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_THEMES, colors, type RoleTheme } from "../lib/theme";
import { DEFAULT_VOICE_LANGUAGE, VOICE_LANGUAGES, setVoiceLanguagePreference } from "../lib/voiceLanguage";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../components/ui";
import { Avatar, AvatarBadgePicker } from "../components/Avatar";
import { useNotificationPreferences, type NotificationCategories } from "../lib/notificationPreferences";
import { useMobileTour } from "../lib/tour/MobileTourProvider";
import { isKnownRole, type Role } from "../lib/roles";

const CATEGORY_LABELS: Record<keyof NotificationCategories, string> = {
  reminders: "Reminders",
  alerts: "Alerts",
  deadlines: "Deadlines",
  digests: "Weekly summaries",
  milestones: "Milestones",
  messages: "Messages & feedback",
};

function NotificationsCard({ accent }: { accent: string }) {
  const { prefs, status, update } = useNotificationPreferences();
  if (!prefs) return null;
  const saving = status === "saving";

  return (
    <Card style={{ gap: 4 }}>
      <View style={rowStyles.row}>
        <View style={rowStyles.textCol}>
          <Text style={rowStyles.label}>Push notifications</Text>
          <Muted>Phone alerts for messages, reminders, and safety updates.</Muted>
        </View>
        <Switch
          value={prefs.enabled}
          disabled={saving}
          onValueChange={(value) => update({ enabled: value })}
          trackColor={{ true: accent }}
        />
      </View>
      <View style={rowStyles.divider} />
      {(Object.keys(CATEGORY_LABELS) as (keyof NotificationCategories)[]).map((key) => (
        <View key={key} style={rowStyles.row}>
          <Text style={rowStyles.label}>{CATEGORY_LABELS[key]}</Text>
          <Switch
            value={prefs.categories[key]}
            disabled={saving || !prefs.enabled}
            onValueChange={(value) => update({ categories: { [key]: value } })}
            trackColor={{ true: accent }}
          />
        </View>
      ))}
    </Card>
  );
}

function GuidedTourCard({ accent, role }: { accent: string; role: Role }) {
  const { prefs, updatePrefs, replayTour } = useMobileTour();
  const [replaying, setReplaying] = useState(false);

  async function onReplay() {
    setReplaying(true);
    await replayTour(role);
    setReplaying(false);
  }

  return (
    <Card style={{ gap: 4 }}>
      <View style={rowStyles.row}>
        <View style={rowStyles.textCol}>
          <Text style={rowStyles.label}>Show mascot animations</Text>
          <Muted>Pex walks, points, and reacts through the app.</Muted>
        </View>
        <Switch
          value={prefs.mascotAnimationsEnabled}
          onValueChange={(value) => updatePrefs({ mascotAnimationsEnabled: value })}
          trackColor={{ true: accent }}
        />
      </View>
      <View style={rowStyles.divider} />
      <View style={rowStyles.row}>
        <View style={rowStyles.textCol}>
          <Text style={rowStyles.label}>Sound effects</Text>
          <Muted>Optional chimes for tour steps and reactions. No sound files are bundled yet.</Muted>
        </View>
        <Switch
          value={prefs.soundEnabled}
          onValueChange={(value) => updatePrefs({ soundEnabled: value })}
          trackColor={{ true: accent }}
        />
      </View>
      <View style={rowStyles.divider} />
      <PrimaryButton label="Replay guided tour" onPress={onReplay} loading={replaying} accent={accent} accentInk="#fff" />
    </Card>
  );
}

export default function Account() {
  const router = useRouter();
  const { user, setUser, signOut, deleteAccount } = useAuth();
  const theme: RoleTheme = ROLE_THEMES[(user?.role as keyof typeof ROLE_THEMES) ?? "coach"] ?? ROLE_THEMES.coach;
  const tourRole: Role | null = user && isKnownRole(user.role) ? user.role : null;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [voiceLanguage, setVoiceLanguage] = useState(user?.voiceLanguage ?? DEFAULT_VOICE_LANGUAGE);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setVoiceLanguage(user?.voiceLanguage ?? DEFAULT_VOICE_LANGUAGE);
  }, [user?.voiceLanguage]);

  async function applyAvatarResponse(res: Response) {
    const json = (await res.json().catch(() => ({}))) as {
      avatar?: StoredUser["avatar"];
      error?: string;
    };
    if (!res.ok || !json.avatar) {
      setAvatarError(
        json?.error === "file_too_large"
          ? "That image is too large."
          : json?.error === "unsupported_file_type"
            ? "Please choose a JPG, PNG, or WEBP image."
            : "Could not update your profile photo."
      );
      return;
    }
    if (user) {
      const updated = { ...user, avatar: json.avatar };
      setUser(updated);
      await persistUser(updated);
    }
  }

  async function pickAvatarPhoto() {
    const result = await DocumentPicker.getDocumentAsync({ type: "image/*" });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const body = new FormData();
      body.append("file", {
        uri: asset.uri,
        name: asset.name ?? "avatar.jpg",
        type: asset.mimeType ?? "image/jpeg",
      } as unknown as Blob);
      const res = await apiFetch("/api/me/avatar", { method: "POST", body });
      await applyAvatarResponse(res);
    } catch {
      setAvatarError("Network error - please try again.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function chooseAvatarDefault(defaultId: string) {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const res = await apiFetch("/api/me/avatar/default", {
        method: "POST",
        body: JSON.stringify({ defaultId }),
      });
      await applyAvatarResponse(res);
    } catch {
      setAvatarError("Network error - please try again.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const res = await apiFetch("/api/me/avatar", { method: "DELETE" });
      await applyAvatarResponse(res);
    } catch {
      setAvatarError("Network error - please try again.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function chooseVoiceLanguage(code: string) {
    const nextCode = await setVoiceLanguagePreference(code);
    setVoiceLanguage(nextCode);
    if (user) {
      const updated = { ...user, voiceLanguage: nextCode };
      setUser(updated);
      await persistUser(updated);
    }
  }

  const localError = useMemo(() => {
    if (next && next.length < 8) return "New password must be at least 8 characters.";
    if (confirm && next !== confirm) return "Passwords don’t match.";
    return null;
  }, [next, confirm]);

  async function save() {
    setMsg(null);
    if (!current || !next || !confirm) {
      setMsg({ kind: "error", text: "Fill in all three fields." });
      return false;
    }
    if (localError) {
      setMsg({ kind: "error", text: localError });
      return false;
    }
    setSaving(true);
    const res = await changePassword(current, next);
    setSaving(false);
    if (res.ok) {
      setUser(res.user);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ kind: "ok", text: "Password updated. Use it next time you sign in." });
      return true;
    }
    if (res.status === 401) setMsg({ kind: "error", text: "Your current password is incorrect." });
    else if (res.error === "weak_password") setMsg({ kind: "error", text: "New password must be at least 8 characters." });
    else if (res.error === "same_password") setMsg({ kind: "error", text: "New password must be different from the current one." });
    else setMsg({ kind: "error", text: "Couldn’t update password. Try again." });
    return false;
  }

  async function onSignOut() {
    await signOut();
    router.replace("/");
  }

  function confirmAccountDeletion() {
    Alert.alert(
      "Permanently delete account?",
      "This permanently deletes your account and associated personal data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Final confirmation",
              "Are you sure? Your account cannot be recovered after deletion.",
              [
                { text: "Keep account", style: "cancel" },
                {
                  text: "Delete permanently",
                  style: "destructive",
                  onPress: async () => {
                    setDeleting(true);
                    setMsg(null);
                    const result = await deleteAccount();
                    setDeleting(false);
                    if (result.ok) {
                      router.replace("/");
                    } else {
                      setMsg({
                        kind: "error",
                        text:
                          result.status === 0
                            ? "Couldn’t reach the server. Check your connection and try again."
                            : "Couldn’t delete your account. Please try again.",
                      });
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
            <Ionicons name="arrow-back" size={18} color={colors.inkFaint} />
            <Text style={styles.backText}>BACK</Text>
          </Pressable>

          <Text style={styles.title}>Account</Text>

          <Card style={{ marginTop: 12, gap: 4 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Muted>{user?.email}</Muted>
            <View style={[styles.roleChip, { backgroundColor: theme.accentSoft }]}>
              <Text style={[styles.roleText, { color: theme.accentStrong }]}>{theme.label}</Text>
            </View>
          </Card>

          <Text style={styles.section}>Profile photo</Text>
          <Card style={{ gap: 14 }}>
            <View style={styles.photoRow}>
              <Avatar
                avatar={user?.avatar}
                name={user?.name ?? ""}
                size={64}
                accentSoft={theme.accentSoft}
                accentStrong={theme.accentStrong}
              />
              <View style={styles.photoActions}>
                <Pressable
                  onPress={pickAvatarPhoto}
                  disabled={avatarBusy}
                  style={[styles.photoButton, { borderColor: theme.accent }]}
                >
                  {avatarBusy ? (
                    <ActivityIndicator size="small" color={theme.accentStrong} />
                  ) : (
                    <Text style={[styles.photoButtonText, { color: theme.accentStrong }]}>Upload photo</Text>
                  )}
                </Pressable>
                {user?.avatar?.kind ? (
                  <Pressable onPress={removeAvatar} disabled={avatarBusy} style={styles.photoRemove}>
                    <Text style={styles.photoRemoveText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <Label>Or pick a badge icon</Label>
            <AvatarBadgePicker
              selectedId={user?.avatar?.kind === "default" ? user.avatar.defaultId : null}
              onSelect={chooseAvatarDefault}
              accentColor={theme.accent}
            />

            {avatarError ? <Text style={styles.localErr}>{avatarError}</Text> : null}
          </Card>

          <Text style={styles.section}>Voice language</Text>
          <Card style={{ gap: 12 }}>
            <Muted>Ask Agent listens and speaks using this language. Commands are translated before the agent runs them.</Muted>
            <View style={styles.languageGrid}>
              {VOICE_LANGUAGES.map((language) => {
                const selected = voiceLanguage === language.code;
                return (
                  <Pressable
                    key={language.code}
                    onPress={() => chooseVoiceLanguage(language.code)}
                    style={[
                      styles.languageOption,
                      selected ? { borderColor: theme.accent, backgroundColor: theme.accentSoft } : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.languageLabel, selected ? { color: theme.accentStrong } : null]}>
                      {language.label}
                    </Text>
                    <Text style={[styles.languageNative, selected ? { color: theme.accentStrong } : null]}>
                      {language.nativeLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Text style={styles.section}>Notifications</Text>
          <NotificationsCard accent={theme.accentStrong} />

          {tourRole ? (
            <>
              <Text style={styles.section}>Guided tour</Text>
              <GuidedTourCard accent={theme.accentStrong} role={tourRole} />
            </>
          ) : null}

          <Text style={styles.section}>Change password</Text>
          <Card style={{ gap: 14 }}>
            <View>
              <Label>Current password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={current} onChangeText={setCurrent} isPassword placeholder="••••••••" editable={!saving} />
              </View>
            </View>
            <View>
              <Label>New password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={next} onChangeText={setNext} isPassword placeholder="At least 8 characters" editable={!saving} />
              </View>
            </View>
            <View>
              <Label>Confirm new password</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={confirm} onChangeText={setConfirm} isPassword placeholder="Re-enter new password" editable={!saving} />
              </View>
            </View>

            {localError ? <Text style={styles.localErr}>{localError}</Text> : null}
            {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}

            <PrimaryButton
              label="Update password"
              onPress={save}
              loading={saving}
              successLabel="Updated"
              accent={theme.accent}
              accentInk={theme.accentInk}
            />
          </Card>

          <Pressable onPress={onSignOut} style={styles.signOut}>
            <Ionicons name="log-out-outline" size={18} color={colors.bad} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>

          <Text style={styles.section}>Delete account</Text>
          <Card style={{ gap: 12 }}>
            <Text style={styles.deleteDescription}>
              Permanently remove your account and associated personal data. This action cannot be undone.
            </Text>
            <Pressable
              onPress={confirmAccountDeletion}
              disabled={deleting}
              style={[styles.deleteButton, deleting && styles.disabled]}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.bad} />
              ) : (
                <Text style={styles.deleteButtonText}>Delete account permanently</Text>
              )}
            </Pressable>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 16, paddingBottom: 32 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  backText: { fontSize: 11, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  name: { fontSize: 18, fontWeight: "700", color: colors.ink },
  roleChip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  roleText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  section: { fontSize: 12, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 1, marginTop: 22, marginBottom: 10 },
  localErr: { fontSize: 12, color: colors.bad },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  photoActions: { gap: 8 },
  photoButton: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  photoButtonText: { fontSize: 13, fontWeight: "700" },
  photoRemove: { paddingVertical: 4, paddingHorizontal: 4 },
  photoRemoveText: { fontSize: 12, fontWeight: "700", color: colors.bad },
  languageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  languageOption: {
    width: "47%",
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  languageLabel: { fontSize: 13, fontWeight: "800", color: colors.ink },
  languageNative: { marginTop: 2, fontSize: 12, fontWeight: "600", color: colors.inkMuted },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 24, paddingVertical: 12 },
  signOutText: { fontSize: 15, fontWeight: "700", color: colors.bad },
  deleteDescription: { fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  deleteButton: {
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: colors.bad,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  deleteButtonText: { fontSize: 14, fontWeight: "800", color: colors.bad },
  disabled: { opacity: 0.55 },
});

const rowStyles = StyleSheet.create({
  row: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  textCol: { flex: 1, minWidth: 0, gap: 3 },
  label: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.ink },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
});
