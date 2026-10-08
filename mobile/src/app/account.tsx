import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Switch, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../components/AppText";
import { Avatar, AvatarEditorPanel } from "../components/Avatar";
import { DateField } from "../components/DateTimeField";
import { todayLocalDate, yearsAgoLocalDate } from "../lib/dateTimeValues";
import {
  ActionButton,
  AppCard,
  BackHeader,
  ErrorState,
  IconTile,
  LoadingState,
  RowLink,
  ScreenContainer,
  SectionHeader,
  SettingsRow,
  StatusChip,
} from "../components/fitora";
import { apiFetch, changePassword } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PRIVACY_POLICY_URL, SUPPORT_URL, openExternal } from "../lib/links";
import { colors, radius, fonts } from "../lib/theme";
import { useNotificationPreferences, type NotificationCategories } from "../lib/notificationPreferences";
import {
  firstName,
  loadAthleteDashboardData,
  loadCoachProfileData,
  mealCalories,
  titleCase,
  useAsyncData,
  type AthleteDashboardData,
  type AthleteProfile,
  type CoachProfileData,
  type NutritionTarget,
} from "../lib/fitoraData";

const FITNESS_GOALS = ["lose_weight", "maintain_weight", "gain_weight"] as const;
const GOAL_INTENSITIES = ["mild", "moderate", "aggressive"] as const;
const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very_active"] as const;
const BIOLOGICAL_SEXES = ["male", "female"] as const;
const DOB_MIN_DATE = "1920-01-01";

const NOTIFICATION_ROWS: { key: keyof NotificationCategories; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "alerts", label: "Risk Alerts", icon: "notifications-outline" },
  { key: "reminders", label: "Workout Completion", icon: "checkbox-outline" },
  { key: "messages", label: "Messages", icon: "chatbubble-outline" },
  { key: "digests", label: "Weekly Summaries", icon: "bar-chart-outline" },
];

const DEFAULT_NOTIFICATION_CATEGORIES: NotificationCategories = {
  reminders: true,
  alerts: true,
  deadlines: true,
  digests: true,
  milestones: true,
  messages: true,
};

export default function Account() {
  const { user } = useAuth();
  if (user?.role === "athlete") return <AthleteAccount />;
  return <CoachAccount />;
}

function AthleteAccount() {
  const state = useAsyncData(loadAthleteDashboardData, [], "athlete-dashboard");
  const [editOpen, setEditOpen] = useState(false);

  if (state.loading && !state.data) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer>
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  if (!state.data) return null;

  return (
    <ProfileShell refreshing={state.refreshing} onRefresh={state.reload} onEditPress={() => setEditOpen((value) => !value)}>
      {editOpen ? (
        <AthleteEditForm
          data={state.data}
          onClose={() => setEditOpen(false)}
          onSaved={(profile, target) => {
            setEditOpen(false);
            state.setData((prev) => (prev ? { ...prev, profile: profile ?? prev.profile, target: target ?? prev.target } : prev));
          }}
        />
      ) : null}
      <AthleteProfileContent data={state.data} onManageGoal={() => setEditOpen(true)} />
    </ProfileShell>
  );
}

function CoachAccount() {
  const state = useAsyncData(loadCoachProfileData, [], "coach-profile");
  const [editOpen, setEditOpen] = useState(false);

  if (state.loading && !state.data) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer>
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  if (!state.data) return null;

  return (
    <ProfileShell refreshing={state.refreshing} onRefresh={state.reload} onEditPress={() => setEditOpen((value) => !value)}>
      {editOpen ? (
        <CoachEditForm
          data={state.data}
          onClose={() => setEditOpen(false)}
          onSaved={(profile) => {
            setEditOpen(false);
            state.setData((prev) => (prev ? { ...prev, profile: profile ?? prev.profile } : prev));
          }}
        />
      ) : null}
      <CoachProfileContent data={state.data} />
    </ProfileShell>
  );
}

function ProfileShell({
  children,
  refreshing,
  onRefresh,
  onEditPress,
}: {
  children: React.ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  onEditPress: () => void;
}) {
  return (
    <ScreenContainer refreshing={refreshing} onRefresh={onRefresh}>
      <BackHeader title="Profile" actionLabel="Edit" onAction={onEditPress} />
      {children}
      <SupportCard />
      <SecurityCard />
      <DangerZone />
    </ScreenContainer>
  );
}

function AthleteProfileContent({ data, onManageGoal }: { data: AthleteDashboardData; onManageGoal: () => void }) {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const profile = data.profile;
  const target = data.target;
  const coachName = data.coachProfile?.name || data.coaches[0]?.name;
  const consumed = data.mealTotals?.calories ?? data.meals.reduce((sum, meal) => sum + mealCalories(meal), 0);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);

  return (
    <>
      <AppCard>
        <View style={styles.identityRow}>
          <Avatar avatar={user?.avatar} name={profile?.name || user?.name || "Profile"} size={78} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.identityName} numberOfLines={1}>{profile?.name || user?.name}</Text>
            <Text style={styles.identityRole}>{titleCase(profile?.fitnessGoal) || profile?.sport || "Fitness"}</Text>
            <Text style={styles.muted} numberOfLines={1}>{profile?.email || user?.email}</Text>
            <Pressable onPress={() => setAvatarEditorOpen((value) => !value)} hitSlop={8}>
              <Text style={styles.avatarEditLink}>{avatarEditorOpen ? "Close" : "Change Photo"}</Text>
            </Pressable>
          </View>
        </View>
        {avatarEditorOpen && user ? (
          <View style={styles.avatarEditor}>
            <AvatarEditorPanel
              avatar={user.avatar}
              name={profile?.name || user.name}
              onChanged={(avatar) => setUser({ ...user, avatar: avatar ?? undefined })}
            />
          </View>
        ) : null}
      </AppCard>

      <AppCard>
        <SectionHeader title="Your Goal" />
        <View style={styles.goalRow}>
          <IconTile icon="locate-outline" size={50} />
          <View style={{ flex: 1 }}>
            <View style={styles.inlineTitleRow}>
              <Text style={styles.cardTitle}>{titleCase(profile?.fitnessGoal) || "Goal not set"}</Text>
              {profile?.goalIntensity ? <StatusChip label={titleCase(profile.goalIntensity)} tone="primary" /> : null}
            </View>
            <Text style={styles.muted}>
              {target ? `Target: ${target.calories.toLocaleString()} kcal/day` : "Nutrition target not configured"}
            </Text>
          </View>
          <ActionButton label="Manage Goal" onPress={onManageGoal} />
        </View>
      </AppCard>

      <AppCard>
        <SectionHeader title="Personal" />
        <SettingsRow icon="scale-outline" label="Weight" value={profile?.weightKg ? `${profile.weightKg} kg` : "Not set"} onPress={onManageGoal} />
        <SettingsRow icon="flag-outline" label="Target Weight" value={profile?.targetWeightKg ? `${profile.targetWeightKg} kg` : "Not set"} onPress={onManageGoal} />
        <SettingsRow icon="resize-outline" label="Height" value={profile?.heightCm ? `${profile.heightCm} cm` : "Not set"} onPress={onManageGoal} />
        <SettingsRow icon="calendar-outline" label="Age" value={profile?.dob ? String(ageFromDob(profile.dob)) : "Not set"} onPress={onManageGoal} />
        <SettingsRow icon="pulse-outline" label="Activity Level" value={titleCase(profile?.activityLevel) || "Not set"} onPress={onManageGoal} />
      </AppCard>

      <AppCard>
        <SectionHeader title="Nutrition" />
        <SettingsRow icon="restaurant-outline" label="Diet" value={(profile?.dietaryPreferences ?? []).join(", ") || "Not set"} />
        <SettingsRow icon="fast-food-outline" label="Cuisine" value={(profile?.cuisinePreferences ?? []).join(", ") || "Not set"} />
        <SettingsRow icon="warning-outline" label="Allergies" value={(profile?.allergies ?? []).join(", ") || "None"} />
        <RowLink
          icon="nutrition-outline"
          title={`${consumed.toLocaleString()} / ${target?.calories?.toLocaleString() ?? "-"} kcal`}
          subtitle="Today"
          progress={target?.calories ? consumed / target.calories : 0}
          tone="success"
        />
      </AppCard>

      <AppCard>
        <View style={styles.coachRow}>
          <Avatar avatar={data.coachProfile?.avatar} name={coachName || "Coach"} size={48} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardTitle}>{coachName ? "My Coach" : "No coach connected"}</Text>
            <Text style={[styles.statusText, { color: coachName ? colors.ok : colors.inkMuted }]}>
              {coachName ? `Connected with ${firstName(coachName, "your coach")}` : "Browse coaches to start a plan"}
            </Text>
          </View>
          <ActionButton
            label={coachName ? "View Coach" : "Find Coach"}
            onPress={() =>
              coachName
                ? router.replace({ pathname: "/athlete/dashboard", params: { section: "coach" } } as never)
                : router.push("/athlete/coach-discovery" as never)
            }
          />
        </View>
      </AppCard>

      <NotificationCard />
    </>
  );
}

function CoachProfileContent({ data }: { data: CoachProfileData }) {
  const { user, setUser } = useAuth();
  const profile = data.profile;
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  return (
    <>
      <AppCard>
        <View style={styles.identityRow}>
          <Avatar avatar={user?.avatar} name={profile?.name || user?.name || "Coach"} size={78} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.identityName} numberOfLines={1}>{profile?.name || user?.name}</Text>
            <Text style={styles.identityRole}>Fitness Coach</Text>
            <Text style={styles.muted}>{profile?.active ? "Marketplace profile active" : "Marketplace profile hidden"}</Text>
            <Pressable onPress={() => setAvatarEditorOpen((value) => !value)} hitSlop={8}>
              <Text style={styles.avatarEditLink}>{avatarEditorOpen ? "Close" : "Change Photo"}</Text>
            </Pressable>
          </View>
        </View>
        {avatarEditorOpen && user ? (
          <View style={styles.avatarEditor}>
            <AvatarEditorPanel
              avatar={user.avatar}
              name={profile?.name || user.name}
              onChanged={(avatar) => setUser({ ...user, avatar: avatar ?? undefined })}
            />
          </View>
        ) : null}
      </AppCard>

      <AppCard>
        <SectionHeader title="Coaching" />
        <SettingsRow icon="barbell-outline" label="Specialization" value={(profile?.specializations ?? []).join(", ") || "Not set"} />
        <SettingsRow icon="people-outline" label="Pricing Plans" value={String(data.pricingPlans.length)} />
        <SettingsRow icon="globe-outline" label="Languages" value={(profile?.languages ?? []).join(", ") || "Not set"} />
      </AppCard>

      <NotificationCard />
    </>
  );
}

function AthleteEditForm({
  data,
  onClose,
  onSaved,
}: {
  data: AthleteDashboardData;
  onClose: () => void;
  onSaved: (profile: AthleteProfile | undefined, target: NutritionTarget | undefined) => void;
}) {
  const profile = data.profile;
  const [weightKg, setWeightKg] = useState(profile?.weightKg != null ? String(profile.weightKg) : "");
  const [targetWeightKg, setTargetWeightKg] = useState(profile?.targetWeightKg != null ? String(profile.targetWeightKg) : "");
  const [heightCm, setHeightCm] = useState(profile?.heightCm != null ? String(profile.heightCm) : "");
  // The server stores dob as a calendar date (UTC midnight) and returns it as
  // "YYYY-MM-DD", so the first 10 chars are the date itself, no tz shift.
  const [dob, setDob] = useState(profile?.dob ? profile.dob.slice(0, 10) : "");
  // Picker bounds: today (no future birthdays) and, when empty, open around 25 years ago.
  const [dobBounds] = useState(() => ({ today: todayLocalDate(), defaultDate: yearsAgoLocalDate(25) }));
  const [biologicalSex, setBiologicalSex] = useState(profile?.biologicalSex ?? "");
  const [activityLevel, setActivityLevel] = useState(profile?.activityLevel ?? "");
  const [fitnessGoal, setFitnessGoal] = useState(profile?.fitnessGoal ?? "");
  const [goalIntensity, setGoalIntensity] = useState(profile?.goalIntensity ?? "");
  const [dietaryPreferences, setDietaryPreferences] = useState((profile?.dietaryPreferences ?? []).join(", "));
  const [cuisinePreferences, setCuisinePreferences] = useState((profile?.cuisinePreferences ?? []).join(", "));
  const [allergies, setAllergies] = useState((profile?.allergies ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function splitList(value: string): string[] {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  async function save() {
    setError(null);
    const parsedWeight = weightKg.trim() ? Number(weightKg) : null;
    const parsedTargetWeight = targetWeightKg.trim() ? Number(targetWeightKg) : null;
    const parsedHeight = heightCm.trim() ? Number(heightCm) : null;
    if (weightKg.trim() && !Number.isFinite(parsedWeight)) {
      setError("Weight must be a number.");
      return;
    }
    if (targetWeightKg.trim() && !Number.isFinite(parsedTargetWeight)) {
      setError("Target weight must be a number.");
      return;
    }
    if (heightCm.trim() && !Number.isFinite(parsedHeight)) {
      setError("Height must be a number.");
      return;
    }
    if (dob && dob > todayLocalDate()) {
      setError("Date of birth can't be in the future.");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        dietaryPreferences: splitList(dietaryPreferences),
        cuisinePreferences: splitList(cuisinePreferences),
        allergies: splitList(allergies),
      };
      if (parsedWeight != null) body.weightKg = parsedWeight;
      if (parsedTargetWeight != null) body.targetWeightKg = parsedTargetWeight;
      if (parsedHeight != null) body.heightCm = parsedHeight;
      if (dob.trim()) body.dob = dob.trim();
      if (biologicalSex) body.biologicalSex = biologicalSex;
      if (activityLevel) body.activityLevel = activityLevel;
      if (fitnessGoal) body.fitnessGoal = fitnessGoal;
      if (goalIntensity) body.goalIntensity = goalIntensity;
      const res = await apiFetch("/api/athlete/me", { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        setError("Could not save changes. Check your entries and try again.");
        return;
      }
      const patchBody = (await res.json().catch(() => ({}))) as { athlete?: AthleteProfile };
      // Best-effort: the nutrition target is a deterministic calculation, not
      // something the athlete types in directly — recompute it whenever the
      // profile now has everything the formula needs. Never blocks the save
      // itself; profile_incomplete_for_nutrition_target just means one of
      // these fields is still blank, which is a normal, expected state.
      let newTarget: NutritionTarget | undefined;
      if (weightKg.trim() && heightCm.trim() && dob.trim() && biologicalSex && activityLevel && fitnessGoal && goalIntensity) {
        const recalcRes = await apiFetch("/api/athlete/nutrition/target/recalculate", { method: "POST" }).catch(() => null);
        if (recalcRes?.ok) {
          const recalcBody = (await recalcRes.json().catch(() => ({}))) as { target?: NutritionTarget };
          newTarget = recalcBody.target;
        }
      }
      // Both responses already contain everything the dashboard needs to
      // reflect this save — the caller patches its own cached data with
      // them instead of re-running the full ~15-request dashboard loader.
      onSaved(patchBody.athlete, newTarget);
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppCard>
      <View style={styles.editHeader}>
        <Text style={styles.cardTitle}>Edit Profile</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.editText}>Close</Text>
        </Pressable>
      </View>

      <Text style={styles.formLabel}>Weight (kg)</Text>
      <TextInput value={weightKg} onChangeText={setWeightKg} keyboardType="numeric" style={styles.input} placeholder="e.g. 72" placeholderTextColor={colors.inkFaint} />

      <Text style={styles.formLabel}>Target Weight (kg)</Text>
      <TextInput value={targetWeightKg} onChangeText={setTargetWeightKg} keyboardType="numeric" style={styles.input} placeholder="e.g. 68" placeholderTextColor={colors.inkFaint} />

      <Text style={styles.formLabel}>Height (cm)</Text>
      <TextInput value={heightCm} onChangeText={setHeightCm} keyboardType="numeric" style={styles.input} placeholder="e.g. 178" placeholderTextColor={colors.inkFaint} />

      <Text style={styles.formLabel}>Date of Birth</Text>
      <DateField
        value={dob}
        onChange={setDob}
        accessibilityLabel="Date of birth"
        placeholder="Select your date of birth"
        minimumDate={DOB_MIN_DATE}
        maximumDate={dobBounds.today}
        initialPickerDate={dobBounds.defaultDate}
        fieldStyle={styles.dateInput}
        textStyle={styles.dateInputText}
      />

      <Text style={styles.formLabel}>Biological Sex</Text>
      <ChipPicker options={BIOLOGICAL_SEXES} value={biologicalSex} onChange={setBiologicalSex} />

      <Text style={styles.formLabel}>Activity Level</Text>
      <ChipPicker options={ACTIVITY_LEVELS} value={activityLevel} onChange={setActivityLevel} />

      <Text style={styles.formLabel}>Fitness Goal</Text>
      <ChipPicker options={FITNESS_GOALS} value={fitnessGoal} onChange={setFitnessGoal} />

      <Text style={styles.formLabel}>Goal Intensity</Text>
      <ChipPicker options={GOAL_INTENSITIES} value={goalIntensity} onChange={setGoalIntensity} />

      <Text style={styles.formLabel}>Diet (comma separated)</Text>
      <TextInput value={dietaryPreferences} onChangeText={setDietaryPreferences} style={styles.input} placeholder="e.g. vegetarian" placeholderTextColor={colors.inkFaint} />

      <Text style={styles.formLabel}>Cuisine (comma separated)</Text>
      <TextInput value={cuisinePreferences} onChangeText={setCuisinePreferences} style={styles.input} placeholder="e.g. south indian" placeholderTextColor={colors.inkFaint} />

      <Text style={styles.formLabel}>Allergies (comma separated)</Text>
      <TextInput value={allergies} onChangeText={setAllergies} style={styles.input} placeholder="e.g. peanuts" placeholderTextColor={colors.inkFaint} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable onPress={save} disabled={saving} style={[styles.primaryButton, saving ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryButtonText}>Save Changes</Text>}
      </Pressable>
    </AppCard>
  );
}

function CoachEditForm({
  data,
  onClose,
  onSaved,
}: {
  data: CoachProfileData;
  onClose: () => void;
  onSaved: (profile: CoachProfileData["profile"]) => void;
}) {
  const profile = data.profile;
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [specializations, setSpecializations] = useState((profile?.specializations ?? []).join(", "));
  const [languages, setLanguages] = useState((profile?.languages ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function splitList(value: string): string[] {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/coach/profile", {
        method: "PATCH",
        body: JSON.stringify({
          bio: bio.trim() || undefined,
          specializations: splitList(specializations),
          languages: splitList(languages),
        }),
      });
      if (!res.ok) {
        setError("Could not save changes.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { profile?: CoachProfileData["profile"] };
      onSaved(body.profile ?? null);
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppCard>
      <View style={styles.editHeader}>
        <Text style={styles.cardTitle}>Edit Profile</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.editText}>Close</Text>
        </Pressable>
      </View>

      <Text style={styles.formLabel}>Bio</Text>
      <TextInput value={bio} onChangeText={setBio} style={[styles.input, styles.inputMultiline]} placeholder="Tell athletes about your coaching style" placeholderTextColor={colors.inkFaint} multiline />

      <Text style={styles.formLabel}>Specializations (comma separated)</Text>
      <TextInput value={specializations} onChangeText={setSpecializations} style={styles.input} placeholder="e.g. strength, mobility" placeholderTextColor={colors.inkFaint} />

      <Text style={styles.formLabel}>Languages (comma separated)</Text>
      <TextInput value={languages} onChangeText={setLanguages} style={styles.input} placeholder="e.g. english, hindi" placeholderTextColor={colors.inkFaint} />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable onPress={save} disabled={saving} style={[styles.primaryButton, saving ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryButtonText}>Save Changes</Text>}
      </Pressable>
    </AppCard>
  );
}

function ChipPicker<T extends string>({ options, value, onChange }: { options: readonly T[]; value: string; onChange: (value: T) => void }) {
  return (
    <View style={styles.chipPickerRow}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.chipOption, value === option ? styles.chipOptionActive : null]}
        >
          <Text style={[styles.chipOptionText, value === option ? styles.chipOptionTextActive : null]}>{titleCase(option)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function NotificationCard() {
  const { prefs, status, update } = useNotificationPreferences();
  if (!prefs) return null;
  const categories = { ...DEFAULT_NOTIFICATION_CATEGORIES, ...(prefs.categories ?? {}) };
  const enabled = prefs.enabled ?? true;
  const disabled = status === "saving";
  return (
    <AppCard>
      <SectionHeader title="Notifications" />
      {NOTIFICATION_ROWS.map((row, index) => (
        <View key={row.key}>
          <View style={styles.switchRow}>
            <IconTile icon={row.icon} size={36} />
            <Text style={styles.switchLabel}>{row.label}</Text>
            <Switch
              value={enabled && categories[row.key]}
              disabled={disabled}
              onValueChange={(value) => update({ enabled: value || enabled, categories: { [row.key]: value } })}
              trackColor={{ true: colors.primarySoft }}
              thumbColor={categories[row.key] ? colors.primary : colors.inkMuted}
            />
          </View>
          {index < NOTIFICATION_ROWS.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </AppCard>
  );
}

function SupportCard() {
  return (
    <AppCard>
      <SectionHeader title="Help & Legal" />
      <SettingsRow icon="help-circle-outline" label="Help & Support" onPress={() => openExternal(SUPPORT_URL)} />
      <SettingsRow icon="shield-checkmark-outline" label="Privacy Policy" onPress={() => openExternal(PRIVACY_POLICY_URL)} />
    </AppCard>
  );
}

function SecurityCard() {
  const { setUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!expanded) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage(null);
    }
  }, [expanded]);

  const localError = useMemo(() => {
    if (next && next.length < 8) return "New password must be at least 8 characters.";
    if (confirm && next !== confirm) return "Passwords do not match.";
    return null;
  }, [next, confirm]);

  async function save() {
    setMessage(null);
    if (!current || !next || !confirm) {
      setMessage({ kind: "error", text: "Fill in all three fields." });
      return;
    }
    if (localError) {
      setMessage({ kind: "error", text: localError });
      return;
    }
    setSaving(true);
    const res = await changePassword(current, next);
    setSaving(false);
    if (res.ok) {
      setUser(res.user);
      setExpanded(false);
      setMessage({ kind: "ok", text: "Password updated." });
      return;
    }
    setMessage({ kind: "error", text: res.status === 401 ? "Current password is incorrect." : "Could not update password." });
  }

  return (
    <AppCard>
      <Pressable onPress={() => setExpanded((value) => !value)} style={styles.securityHeader}>
        <IconTile icon="lock-closed-outline" size={38} />
        <Text style={styles.cardTitle}>Account & Security</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={22} color={colors.ink} />
      </Pressable>
      {expanded ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.passwordForm}>
          <SecureInput value={current} onChangeText={setCurrent} placeholder="Current password" />
          <SecureInput value={next} onChangeText={setNext} placeholder="New password" />
          <SecureInput value={confirm} onChangeText={setConfirm} placeholder="Confirm new password" />
          {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
          {message ? <Text style={message.kind === "ok" ? styles.successText : styles.errorText}>{message.text}</Text> : null}
          <Pressable onPress={save} disabled={saving} style={[styles.primaryButton, saving ? styles.disabled : null]}>
            {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryButtonText}>Update Password</Text>}
          </Pressable>
        </KeyboardAvoidingView>
      ) : null}
    </AppCard>
  );
}

function SecureInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      secureTextEntry
      autoCapitalize="none"
      placeholder={placeholder}
      placeholderTextColor={colors.inkFaint}
      style={styles.input}
    />
  );
}

function DangerZone() {
  const router = useRouter();
  const { signOut, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);

  async function onSignOut() {
    await signOut();
    router.replace("/");
  }

  function confirmDelete() {
    Alert.alert("Delete account?", "This permanently deletes your account and associated personal data.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          const result = await deleteAccount();
          setDeleting(false);
          if (result.ok) router.replace("/");
          else Alert.alert("Could not delete account", "Please try again.");
        },
      },
    ]);
  }

  return (
    <>
      <Pressable onPress={onSignOut} style={styles.logout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
      <Pressable onPress={confirmDelete} disabled={deleting} style={styles.deleteButton}>
        {deleting ? <ActivityIndicator color={colors.bad} /> : <Text style={styles.deleteText}>Delete Account</Text>}
      </Pressable>
    </>
  );
}

function ageFromDob(dob: string) {
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDelta = now.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < date.getDate())) age -= 1;
  return age;
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  editText: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 15 },
  identityName: { fontFamily: fonts.display, textTransform: "uppercase", color: colors.ink, fontSize: 26, lineHeight: 30 },
  identityRole: { color: colors.inkMuted, fontSize: 16, lineHeight: 22, marginTop: 3 },
  muted: { color: colors.inkMuted, fontSize: 14, lineHeight: 19, marginTop: 3 },
  cardTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  inlineTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  goalRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  coachRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusText: { fontSize: 14, lineHeight: 19, fontWeight: "800", marginTop: 2 },
  avatarEditLink: { color: colors.primary, fontSize: 13, fontWeight: "800", marginTop: 6 },
  avatarEditor: { gap: 12, marginTop: 16, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  switchRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 14 },
  switchLabel: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "800" },
  securityHeader: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 },
  passwordForm: { gap: 10, marginTop: 12 },
  // DateField box/text matched to `input` below.
  dateInput: { minHeight: 50, borderRadius: radius.md, paddingHorizontal: 14 },
  dateInputText: { fontSize: 15, fontWeight: "400" },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: "900" },
  logout: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { color: colors.bad, fontSize: 15, fontWeight: "800" },
  deleteButton: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  deleteText: { color: colors.bad, fontSize: 14, fontWeight: "700" },
  successText: { color: colors.ok, fontSize: 14, fontWeight: "800" },
  errorText: { color: colors.bad, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  divider: { height: 1, backgroundColor: colors.line },
  editHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  formLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", textTransform: "uppercase", marginTop: 12, marginBottom: 6 },
  inputMultiline: { minHeight: 90, paddingTop: 14, textAlignVertical: "top" },
  chipPickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipOption: {
    minHeight: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOptionActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipOptionText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  chipOptionTextActive: { color: colors.primary },
});
