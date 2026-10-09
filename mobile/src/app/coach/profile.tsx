import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { Avatar } from "../../components/Avatar";
import { DateField, TimeField } from "../../components/DateTimeField";
import { deviceTimeZone, displayDate, minutesToTime, timeToMinutes, todayLocalDate } from "../../lib/dateTimeValues";
import { celebrate, errorFeedback, selectionFeedback } from "../../lib/feedback";
import {
  ActionButton,
  AppCard,
  EmptyState,
  ErrorState,
  HeroCard,
  LoadingState,
  PrimaryAppBar,
  RowLink,
  ScreenContainer,
  SegmentedControl,
  SectionHeader,
  SettingsRow,
  StatusChip,
} from "../../components/fitora";
import { apiFetch } from "../../lib/api";
import { PAYMENTS_ENABLED } from "../../lib/features";
import { PRIVACY_POLICY_URL, SUPPORT_URL, openExternal } from "../../lib/links";
import { useAuth } from "../../lib/auth";
import { colors, fonts } from "../../lib/theme";
import { animateNextLayout } from "../../lib/motion";
import {
  formatCurrency,
  loadCoachProfileData,
  titleCase,
  useAsyncData,
  type CoachAvailabilityException,
  type CoachAvailabilityRule,
  type CoachOwnProfile,
  type CoachReview,
  type PricingPlan,
  type PublicCoachProfile,
} from "../../lib/fitoraData";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CoachProfile() {
  const state = useAsyncData(loadCoachProfileData, [], "coach-profile");
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [preview, setPreview] = useState<PublicCoachProfile | null>(null);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PricingPlan | null>(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  // What athletes see vs. the coach's own account settings, so neither page is a wall of cards.
  const [section, setSection] = useState<"public" | "settings">("public");

  async function loadMoreReviews() {
    const coachId = state.data?.profile?.coachId ?? state.data?.profile?.id;
    if (!coachId || loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const nextPage = reviewsPage + 1;
      const res = await apiFetch(`/api/marketplace/coaches/${coachId}/reviews?limit=5&page=${nextPage}`);
      const json = (await res.json().catch(() => ({}))) as { reviews?: CoachReview[] };
      if (res.ok && json.reviews?.length) {
        state.setData((prev) => (prev ? { ...prev, reviews: [...prev.reviews, ...json.reviews!] } : prev));
        setReviewsPage(nextPage);
      }
    } finally {
      setLoadingMoreReviews(false);
    }
  }

  async function toggleMarketplace(active: boolean) {
    setSavingVisibility(true);
    try {
      const path = active ? "/api/coach/profile/activate" : "/api/coach/profile/deactivate";
      const res = await apiFetch(path, { method: "POST" });
      // The response is just {active}, and that's the only field this
      // toggle changes — patch it directly instead of re-fetching the
      // profile, pricing plans, availability, and reviews just to flip
      // one boolean.
      if (res.ok) state.setData((prev) => (prev?.profile ? { ...prev, profile: { ...prev.profile, active } } : prev));
    } finally {
      setSavingVisibility(false);
    }
  }

  async function onSignOut() {
    await signOut();
    router.replace("/");
  }

  async function previewPublicProfile() {
    const coachId = state.data?.profile?.coachId ?? state.data?.profile?.id;
    if (!coachId) return;
    setPreview(null);
    setPreviewMessage(null);
    try {
      const res = await apiFetch(`/api/marketplace/coaches/${coachId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.profile) {
        setPreviewMessage("Public profile is hidden. Activate marketplace visibility to preview it.");
        return;
      }
      setPreview(json.profile);
    } catch {
      setPreviewMessage("Could not load public preview.");
    }
  }

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

  const data = state.data;
  if (!data) return null;

  const profile = data.profile;
  const displayName = profile?.name || user?.name || "Coach";

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <PrimaryAppBar title="Profile" showNotifications={false} showAvatar={false} actionLabel="Edit" onAction={() => router.push("/account" as never)} />

      <SegmentedControl
        value={section}
        onChange={setSection}
        options={[
          { value: "public", label: "Public Profile", icon: "person-circle-outline" },
          { value: "settings", label: "Settings", icon: "settings-outline" },
        ]}
      />

      {section === "public" ? (
        <>
      <ProfileReadinessHero
        hasBio={Boolean(profile?.bio?.trim() || profile?.philosophy?.trim())}
        hasSpecializations={Boolean(profile?.specializations?.length)}
        hasAvailability={data.availabilityRules.length > 0}
        listed={Boolean(profile?.active)}
        onEditProfile={() => router.push("/account" as never)}
        onSetAvailability={() => setAvailabilityOpen(true)}
        onGoLive={() => void toggleMarketplace(true)}
      />

      <AppCard>
        <View style={styles.profileRow}>
          <Avatar avatar={user?.avatar} name={displayName} size={76} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              {profile?.verifiedStatus === "verified" ? <Ionicons name="checkmark-circle" size={21} color={colors.primary} /> : null}
            </View>
            <Text style={styles.muted} numberOfLines={1}>
              {coachHeadline(profile)}
            </Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={17} color={colors.warn} />
              <Text style={styles.ratingText}>
                {profile?.avgRating ? profile.avgRating.toFixed(1) : "New"} {profile?.reviewCount ? `- ${profile.reviewCount} reviews` : ""}
              </Text>
            </View>
            {profile?.yearsExperience != null ? <Text style={styles.muted}>{profile.yearsExperience} years experience</Text> : null}
            <View style={styles.tagWrap}>
              {(profile?.specializations ?? []).slice(0, 3).map((tag) => (
                <StatusChip key={tag} label={tag} tone="primary" />
              ))}
            </View>
          </View>
        </View>
        <ActionButton label="Preview Public Profile" icon="eye-outline" variant="outline" onPress={previewPublicProfile} />
      </AppCard>

      {preview || previewMessage ? (
        <AppCard style={styles.editorCard}>
          <View style={styles.editorHeader}>
            <Text style={styles.cardTitle}>Public Preview</Text>
            <Pressable onPress={() => { setPreview(null); setPreviewMessage(null); }} hitSlop={10}>
              <Text style={styles.linkText}>Close</Text>
            </Pressable>
          </View>
          {preview ? (
            <>
              <Text style={styles.name}>{preview.name}</Text>
              <Text style={styles.muted}>{preview.bio || preview.philosophy || "No public bio yet."}</Text>
              <View style={styles.tagWrap}>
                {(preview.specializations ?? []).slice(0, 4).map((tag) => <StatusChip key={tag} label={tag} tone="primary" />)}
              </View>
              <Text style={styles.muted}>{preview.pricingPlans?.length ?? 0} visible pricing plan{preview.pricingPlans?.length === 1 ? "" : "s"}</Text>
            </>
          ) : (
            <Text style={styles.muted}>{previewMessage}</Text>
          )}
        </AppCard>
      ) : null}

      <AppCard>
        <View style={styles.publishRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Marketplace Profile</Text>
            <Text style={styles.muted}>{profile?.active ? "Visible to athletes." : "Hidden from athletes."}</Text>
          </View>
          {savingVisibility ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Switch
              value={Boolean(profile?.active)}
              onValueChange={toggleMarketplace}
              trackColor={{ true: colors.primarySoft }}
              thumbColor={profile?.active ? colors.primary : colors.inkMuted}
            />
          )}
        </View>
      </AppCard>

      <AppCard>
        <SectionHeader title="Professional details" />
        <SettingsRow icon="briefcase-outline" label="Experience" value={profile?.yearsExperience != null ? `${profile.yearsExperience} Years` : "Not set"} />
        <SettingsRow icon="ribbon-outline" label="Certifications" value={String(profile?.certifications?.length ?? 0)} />
        <SettingsRow icon="barbell-outline" label="Specializations" value={String(profile?.specializations?.length ?? 0)} />
        <SettingsRow icon="globe-outline" label="Languages" value={(profile?.languages ?? []).join(", ") || "Not set"} />
        <SettingsRow icon="chatbubble-outline" label="Coaching Philosophy" value={profile?.philosophy ? "Added" : "Not set"} />
      </AppCard>

      <AppCard>
        <SectionHeader title="Coaching Plans" action="Manage Pricing" onAction={() => { animateNextLayout(); setPricingOpen((value) => !value); setEditingPlan(null); }} />
        {pricingOpen ? (
          <PricingEditor
            plan={editingPlan}
            onCancel={() => { setPricingOpen(false); setEditingPlan(null); }}
            onSaved={(message, plan) => {
              setActionMessage(message);
              // The save/toggle response already returns the full plan —
              // upsert it locally instead of re-fetching profile + pricing +
              // availability + reviews for a one-plan change.
              if (plan) {
                state.setData((prev) => {
                  if (!prev) return prev;
                  const exists = prev.pricingPlans.some((p) => p.id === plan.id);
                  return {
                    ...prev,
                    pricingPlans: exists ? prev.pricingPlans.map((p) => (p.id === plan.id ? plan : p)) : [...prev.pricingPlans, plan],
                  };
                });
              }
            }}
          />
        ) : null}
        {data.pricingPlans.length ? (
          data.pricingPlans.map((plan, index) => (
            <View key={plan.id}>
              <PricingRow plan={plan} onPress={() => { setPricingOpen(true); setEditingPlan(plan); }} />
              {index < data.pricingPlans.length - 1 ? <Divider /> : null}
            </View>
          ))
        ) : (
          <EmptyState title="No pricing plans" body="Needed before you publish." icon="ribbon-outline" />
        )}
      </AppCard>

      <View style={styles.twoCol}>
        <AppCard style={styles.splitCard}>
          <SectionHeader title="Availability" action={availabilityOpen ? "Close" : "Manage"} onAction={() => { animateNextLayout(); setAvailabilityOpen((value) => !value); }} />
          <AvailabilityList rules={data.availabilityRules} />
          <Pressable onPress={() => { animateNextLayout(); setExceptionsOpen((value) => !value); }} style={styles.exceptionsToggle}>
            <Text style={styles.linkText}>{exceptionsOpen ? "Hide date overrides" : "Manage date overrides"}</Text>
          </Pressable>
        </AppCard>
        <AppCard style={styles.splitCard}>
          <SectionHeader
            title="Reviews"
            action={data.reviews.length ? (reviewsOpen ? "Hide" : `View ${Math.min(data.reviews.length, profile?.reviewCount ?? data.reviews.length)} of ${profile?.reviewCount ?? data.reviews.length}`) : undefined}
            onAction={() => { animateNextLayout(); setReviewsOpen((value) => !value); }}
          />
          <Text style={styles.reviewScore}>{profile?.avgRating ? profile.avgRating.toFixed(1) : "-"}</Text>
          <Text style={styles.muted}>{profile?.reviewCount ?? 0} reviews</Text>
          {data.reviews.length ? (
            (reviewsOpen ? data.reviews : data.reviews.slice(0, 1)).map((review, index) => (
              <View key={review.id} style={styles.reviewItem}>
                <Text style={styles.ratingText}>{review.overallRating.toFixed(1)} stars{review.athleteName ? ` - ${review.athleteName}` : ""}</Text>
                {review.body ? <Text style={styles.reviewBody} numberOfLines={reviewsOpen ? undefined : 4}>{review.body}</Text> : null}
                {index < (reviewsOpen ? data.reviews.length : 1) - 1 ? <Divider /> : null}
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No reviews yet.</Text>
          )}
          {reviewsOpen && data.reviews.length < (profile?.reviewCount ?? 0) ? (
            <Pressable onPress={loadMoreReviews} disabled={loadingMoreReviews} style={styles.exceptionsToggle}>
              {loadingMoreReviews ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.linkText}>Load more reviews</Text>}
            </Pressable>
          ) : null}
        </AppCard>
      </View>

      {/* The editors open full width below the half-width cards so the time
          fields and option chips have room on a phone. */}
      {availabilityOpen ? (
        <AppCard style={styles.editorCard}>
          <View style={styles.editorHeader}>
            <Text style={styles.cardTitle}>Edit Availability</Text>
            <Pressable onPress={() => setAvailabilityOpen(false)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.linkText}>Close</Text>
            </Pressable>
          </View>
          <AvailabilityEditor
            rules={data.availabilityRules}
            onSaved={(rules) => {
              setActionMessage("Availability updated.");
              setAvailabilityOpen(false);
              state.setData((prev) => (prev ? { ...prev, availabilityRules: rules } : prev));
            }}
          />
        </AppCard>
      ) : null}

      {exceptionsOpen ? (
        <AppCard style={styles.editorCard}>
          <View style={styles.editorHeader}>
            <Text style={styles.cardTitle}>Date Overrides</Text>
            <Pressable onPress={() => setExceptionsOpen(false)} hitSlop={10} accessibilityRole="button">
              <Text style={styles.linkText}>Close</Text>
            </Pressable>
          </View>
          <AvailabilityExceptionsEditor
            exceptions={data.availabilityExceptions}
            onChanged={(message, patch) => {
              setActionMessage(message);
              state.setData((prev) => {
                if (!prev) return prev;
                if ("added" in patch) {
                  // The server upserts one override per date: replace any existing row for that date.
                  const others = prev.availabilityExceptions.filter((e) => e.id !== patch.added.id && e.date !== patch.added.date);
                  return { ...prev, availabilityExceptions: [...others, patch.added].sort((a, b) => a.date.localeCompare(b.date)) };
                }
                return { ...prev, availabilityExceptions: prev.availabilityExceptions.filter((e) => e.id !== patch.removedId) };
              });
            }}
          />
        </AppCard>
      ) : null}
        </>
      ) : (
        <>
      {PAYMENTS_ENABLED ? (
      <AppCard>
        <SectionHeader title="Payments & Membership" />
        <SettingsRow icon="business-outline" label="Payout Settings" />
        <SettingsRow icon="card-outline" label="Payment History" />
        <SettingsRow icon="people-outline" label="Client Memberships" />
        <SettingsRow icon="document-text-outline" label="Invoices" />
      </AppCard>
      ) : null}
      <AppCard>
        <SectionHeader title="Account" />
        <SettingsRow icon="notifications-outline" label="Notifications" onPress={() => router.push("/account" as never)} />
        <SettingsRow icon="lock-closed-outline" label="Account & Security" onPress={() => router.push("/account" as never)} />
        <SettingsRow icon="help-circle-outline" label="Help & Support" onPress={() => openExternal(SUPPORT_URL)} />
        <SettingsRow icon="shield-checkmark-outline" label="Privacy Policy" onPress={() => openExternal(PRIVACY_POLICY_URL)} />
      </AppCard>
      <Pressable onPress={onSignOut} style={styles.logout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
        </>
      )}

      {data.partialIssues.length ? (
        <Text style={styles.partialText}>Some data could not load: {data.partialIssues.slice(0, 3).join(", ")}</Text>
      ) : null}

      {actionMessage ? <Text style={styles.successText}>{actionMessage}</Text> : null}

    </ScreenContainer>
  );
}

/**
 * What still stops athletes from finding and booking this coach, in the order
 * to fix it. One action at a time; calm once everything is in place.
 */
function ProfileReadinessHero({
  hasBio,
  hasSpecializations,
  hasAvailability,
  listed,
  onEditProfile,
  onSetAvailability,
  onGoLive,
}: {
  hasBio: boolean;
  hasSpecializations: boolean;
  hasAvailability: boolean;
  listed: boolean;
  onEditProfile: () => void;
  onSetAvailability: () => void;
  onGoLive: () => void;
}) {
  const steps = [hasBio, hasSpecializations, hasAvailability, listed];
  const done = steps.filter(Boolean).length;
  const progressLine = `${done} of ${steps.length} done`;
  if (!hasBio || !hasSpecializations) {
    return (
      <HeroCard
        icon="person-circle-outline"
        eyebrow={`Profile setup · ${progressLine}`}
        title={!hasBio ? "Add a short bio" : "Add your specializations"}
        body="Athletes read this first. Two or three sentences is enough."
        actionLabel="Edit Profile"
        onAction={onEditProfile}
      />
    );
  }
  if (!hasAvailability) {
    return (
      <HeroCard
        icon="calendar-outline"
        eyebrow={`Profile setup · ${progressLine}`}
        title="Set your working hours"
        body="Clients can book only inside these hours."
        actionLabel="Set Availability"
        onAction={onSetAvailability}
      />
    );
  }
  if (!listed) {
    return (
      <HeroCard
        icon="storefront-outline"
        eyebrow={`Profile setup · ${progressLine}`}
        title="Ready to be found"
        body="Your profile is complete. List it so athletes can find you."
        actionLabel="List My Profile"
        onAction={onGoLive}
      />
    );
  }
  return (
    <HeroCard
      calm
      icon="checkmark-done-outline"
      eyebrow="Profile complete"
      title="Athletes can find and book you"
      body="Keep your hours current."
    />
  );
}

function coachHeadline(profile?: CoachOwnProfile | null): string {
  const specializations = profile?.specializations ?? [];
  if (specializations.some((tag) => tag.toLowerCase() === "strength")) {
    return "Strength & Conditioning Coach";
  }
  const coachingType = profile?.coachingTypes?.[0];
  return coachingType ? `${titleCase(coachingType)} Coach` : "Fitness Coach";
}

function PricingRow({ plan, onPress }: { plan: PricingPlan; onPress: () => void }) {
  const services = [
    plan.workoutPlanningIncluded ? "Workout planning" : null,
    plan.nutritionIncluded ? "Nutrition" : null,
    plan.liveSessionsPerCycle ? `${plan.liveSessionsPerCycle} calls` : null,
    plan.messagingIncluded ? "Messaging" : null,
  ].filter(Boolean);
  return (
    <RowLink
      icon={plan.name.toLowerCase().includes("premium") ? "diamond-outline" : plan.name.toLowerCase().includes("pro") ? "trophy-outline" : "star-outline"}
      title={plan.name}
      subtitle={services.join(" - ") || plan.description || "Plan details"}
      value={`${formatCurrency(plan.monthlyPrice, plan.currency)}/month`}
      tone="primary"
      onPress={onPress}
    />
  );
}

function PricingEditor({
  plan,
  onCancel,
  onSaved,
}: {
  plan: PricingPlan | null;
  onCancel: () => void;
  onSaved: (message: string, plan?: PricingPlan) => void;
}) {
  const [name, setName] = useState(plan?.name ?? "New Plan");
  const [price, setPrice] = useState(plan ? String(plan.monthlyPrice) : "2999");
  const [currency, setCurrency] = useState(plan?.currency ?? "INR");
  const [sessions, setSessions] = useState(String(plan?.liveSessionsPerCycle ?? 2));
  const [nutrition, setNutrition] = useState(Boolean(plan?.nutritionIncluded));
  const [workout, setWorkout] = useState(plan?.workoutPlanningIncluded ?? true);
  const [messaging, setMessaging] = useState(plan?.messagingIncluded ?? true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setName(plan?.name ?? "New Plan");
    setPrice(plan ? String(plan.monthlyPrice) : "2999");
    setCurrency(plan?.currency ?? "INR");
    setSessions(String(plan?.liveSessionsPerCycle ?? 2));
    setNutrition(Boolean(plan?.nutritionIncluded));
    setWorkout(plan?.workoutPlanningIncluded ?? true);
    setMessaging(plan?.messagingIncluded ?? true);
    setMessage(null);
  }, [plan]);

  async function save() {
    setMessage(null);
    if (!name.trim() || !Number.isFinite(Number(price))) {
      setMessage("Name and price are required.");
      return;
    }
    setSaving(true);
    try {
      const path = plan ? `/api/coach/pricing-plans/${plan.id}` : "/api/coach/pricing-plans";
      const method = plan ? "PATCH" : "POST";
      const includedServices = [
        workout ? "Workout planning" : null,
        nutrition ? "Nutrition support" : null,
        messaging ? "Messaging" : null,
        Number(sessions) > 0 ? `${Number(sessions)} live sessions` : null,
      ].filter(Boolean);
      const res = await apiFetch(path, {
        method,
        body: JSON.stringify({
          name: name.trim(),
          monthlyPrice: Number(price),
          currency: currency.trim().toUpperCase(),
          liveSessionsPerCycle: Number(sessions) || 0,
          nutritionIncluded: nutrition,
          workoutPlanningIncluded: workout,
          messagingIncluded: messaging,
          includedServices,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; pricingPlan?: PricingPlan };
      if (!res.ok) {
        setMessage(json.error === "invalid_currency" ? "Use a 3-letter currency code." : "Could not save pricing plan.");
        return;
      }
      onSaved(plan ? "Pricing plan updated." : "Pricing plan created.", json.pricingPlan);
    } catch {
      setMessage("Network error while saving pricing.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!plan) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/coach/pricing-plans/${plan.id}/${plan.active === false ? "activate" : "deactivate"}`, { method: "POST" });
      if (!res.ok) {
        setMessage("Could not update visibility.");
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { pricingPlan?: PricingPlan };
      onSaved(plan.active === false ? "Pricing plan activated." : "Pricing plan deactivated.", json.pricingPlan);
    } catch {
      setMessage("Network error while updating visibility.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.editorBlock}>
      <Text style={styles.editorTitle}>{plan ? `Edit ${plan.name}` : "Create Pricing Plan"}</Text>
      <FormInput label="Plan name" value={name} onChangeText={setName} />
      <View style={styles.formGrid}>
        <FormInput label="Price" value={price} onChangeText={setPrice} keyboardType="numeric" />
        <FormInput label="Currency" value={currency} onChangeText={setCurrency} autoCapitalize="characters" />
      </View>
      <FormInput label="Live sessions" value={sessions} onChangeText={setSessions} keyboardType="numeric" />
      <View style={styles.toggleRow}>
        <ToggleChip label="Workout" active={workout} onPress={() => setWorkout((value) => !value)} />
        <ToggleChip label="Nutrition" active={nutrition} onPress={() => setNutrition((value) => !value)} />
        <ToggleChip label="Messaging" active={messaging} onPress={() => setMessaging((value) => !value)} />
      </View>
      {message ? <Text style={styles.errorText}>{message}</Text> : null}
      <View style={styles.editorActions}>
        <ActionButton label="Cancel" onPress={onCancel} />
        {plan ? <ActionButton label={plan.active === false ? "Activate" : "Deactivate"} onPress={toggleActive} /> : null}
        <Pressable onPress={save} disabled={saving} style={[styles.saveButton, saving ? styles.disabled : null]}>
          {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const SESSION_LENGTH_OPTIONS = [15, 30, 45, 60, 90];
const BUFFER_OPTIONS = [0, 5, 10, 15];

/** Plain-language text for PUT /api/coach/availability error codes. */
function availabilityErrorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_startMinute":
      return "The start time isn't valid. Pick a start time again.";
    case "invalid_endMinute":
      return "The end time must be later than the start time on the same day.";
    case "invalid_sessionDurationMin":
      return "Session length must be between 5 minutes and 4 hours.";
    case "invalid_bufferMin":
      return "Break between sessions must be 2 hours or less.";
    case "invalid_dayOfWeek":
    case "invalid_rules":
      return "Those days couldn't be saved. Re-select your days and try again.";
    case "too_many_requests":
      return "Too many saves in a row. Wait a minute and try again.";
    default:
      return "Could not save your availability. Please try again.";
  }
}

function AvailabilityEditor({ rules, onSaved }: { rules: CoachAvailabilityRule[]; onSaved: (rules: CoachAvailabilityRule[]) => void }) {
  // Pre-fill from the first saved rule (earliest day/start); the editor applies
  // one range to every selected day, so warn when saved days currently differ.
  const first = rules[0];
  const [selectedDays, setSelectedDays] = useState<number[]>(() => Array.from(new Set(rules.map((rule) => rule.dayOfWeek))));
  const [startTime, setStartTime] = useState(() => minutesToTime(first?.startMinute ?? 9 * 60));
  const [endTime, setEndTime] = useState(() => (first && first.endMinute < 1440 ? minutesToTime(first.endMinute) : first ? "23:59" : "18:00"));
  const [sessionLength, setSessionLength] = useState(first?.sessionDurationMin ?? 30);
  const [buffer, setBuffer] = useState(first?.bufferMin ?? 10);
  const [timezone] = useState(() => deviceTimeZone(first?.timezone));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const mixedHours = rules.some(
    (rule) =>
      rule.startMinute !== first?.startMinute ||
      rule.endMinute !== first?.endMinute ||
      rule.sessionDurationMin !== first?.sessionDurationMin ||
      rule.bufferMin !== first?.bufferMin
  ) || rules.length !== new Set(rules.map((rule) => rule.dayOfWeek)).size;
  const lengthOptions = SESSION_LENGTH_OPTIONS.includes(sessionLength) ? SESSION_LENGTH_OPTIONS : [...SESSION_LENGTH_OPTIONS, sessionLength].sort((a, b) => a - b);
  const bufferOptions = BUFFER_OPTIONS.includes(buffer) ? BUFFER_OPTIONS : [...BUFFER_OPTIONS, buffer].sort((a, b) => a - b);

  function toggleDay(day: number) {
    selectionFeedback();
    setSelectedDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort());
  }

  async function save() {
    setMessage(null);
    const startMinute = timeToMinutes(startTime);
    const endMinute = timeToMinutes(endTime);
    if (startMinute == null || endMinute == null) {
      setMessage("Pick a start and end time.");
      return;
    }
    if (endMinute <= startMinute) {
      setMessage("End time must be later than start time (hours can't run past midnight).");
      return;
    }
    if (endMinute - startMinute < sessionLength) {
      setMessage(`Your hours are shorter than one ${sessionLength}-minute session.`);
      return;
    }
    setSaving(true);
    try {
      // Exactly the fields PUT /api/coach/availability validates. The whole
      // array replaces the coach's rules; no days selected clears availability.
      const nextRules = selectedDays.map((day) => ({
        dayOfWeek: day,
        startMinute,
        endMinute,
        timezone,
        sessionDurationMin: sessionLength,
        bufferMin: buffer,
      }));
      const res = await apiFetch("/api/coach/availability", { method: "PUT", body: JSON.stringify({ rules: nextRules }) });
      const json = (await res.json().catch(() => ({}))) as { rules?: CoachAvailabilityRule[]; error?: string };
      if (!res.ok) {
        errorFeedback();
        setMessage(availabilityErrorMessage(json.error));
        return;
      }
      celebrate({ title: "Availability saved" });
      onSaved(json.rules ?? []);
    } catch {
      errorFeedback();
      setMessage("Network error while saving availability.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.editorBlock}>
      <Text style={styles.editorTitle}>Working Days</Text>
      <View style={styles.dayGrid}>
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const on = selectedDays.includes(day);
          return (
            <Pressable
              key={day}
              onPress={() => toggleDay(day)}
              accessibilityRole="checkbox"
              accessibilityLabel={DAY_LABELS[day]}
              accessibilityState={{ checked: on }}
              style={[styles.dayChip, on ? styles.dayChipActive : null]}
            >
              <Text style={[styles.dayChipText, on ? styles.dayChipTextActive : null]}>{DAY_LABELS[day]}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.editorTitle}>Working Hours</Text>
      <View style={styles.formGrid}>
        <TimeField label="Start" accessibilityLabel="Working hours start" value={startTime} onChange={setStartTime} minuteInterval={5} style={styles.formField} />
        <TimeField label="End" accessibilityLabel="Working hours end" value={endTime} onChange={setEndTime} minuteInterval={5} style={styles.formField} />
      </View>
      <Text style={styles.muted}>Applies to every selected day. Times are in {timezone}.</Text>
      {first && first.timezone !== timezone ? (
        <Text style={styles.warnText}>Your saved hours use {first.timezone}. Saving will switch them to this device&apos;s timezone ({timezone}).</Text>
      ) : null}
      {mixedHours ? <Text style={styles.warnText}>Your days currently have different hours. Saving sets these hours for all selected days.</Text> : null}

      <Text style={styles.formLabel}>Session length</Text>
      <View style={styles.toggleRow}>
        {lengthOptions.map((minutes) => (
          <OptionChip
            key={minutes}
            label={`${minutes} min`}
            accessibilityLabel={`${minutes} minute sessions`}
            active={sessionLength === minutes}
            onPress={() => { selectionFeedback(); setSessionLength(minutes); }}
          />
        ))}
      </View>

      <Text style={styles.formLabel}>Break between sessions</Text>
      <View style={styles.toggleRow}>
        {bufferOptions.map((minutes) => (
          <OptionChip
            key={minutes}
            label={minutes === 0 ? "None" : `${minutes} min`}
            accessibilityLabel={minutes === 0 ? "No break between sessions" : `${minutes} minute break between sessions`}
            active={buffer === minutes}
            onPress={() => { selectionFeedback(); setBuffer(minutes); }}
          />
        ))}
      </View>

      {selectedDays.length === 0 ? <Text style={styles.warnText}>No days selected. Saving will hide all your bookable times.</Text> : null}
      {message ? <Text style={styles.errorText}>{message}</Text> : null}
      <Pressable onPress={save} disabled={saving} accessibilityRole="button" style={[styles.saveButton, styles.saveButtonTall, saving ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Save Availability</Text>}
      </Pressable>
    </View>
  );
}

function OptionChip({ label, accessibilityLabel, active, onPress }: { label: string; accessibilityLabel: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, checked: active }}
      style={[styles.toggleChip, active ? styles.toggleChipActive : null]}
    >
      <Text style={[styles.toggleChipText, active ? styles.toggleChipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function FormInput({
  label,
  value,
  onChangeText,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "numeric";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholderTextColor={colors.inkFaint}
        style={styles.input}
      />
    </View>
  );
}

function ToggleChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggleChip, active ? styles.toggleChipActive : null]}>
      <Text style={[styles.toggleChipText, active ? styles.toggleChipTextActive : null]}>{titleCase(label)}</Text>
    </Pressable>
  );
}

function AvailabilityList({ rules }: { rules: CoachAvailabilityRule[] }) {
  if (!rules.length) {
    return <Text style={styles.muted}>No weekly hours set.</Text>;
  }
  const byDay = new Map<number, CoachAvailabilityRule[]>();
  for (const rule of rules) {
    byDay.set(rule.dayOfWeek, [...(byDay.get(rule.dayOfWeek) ?? []), rule]);
  }
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];
  return (
    <View>
      {orderedDays.map((day) => {
        const dayRules = byDay.get(day) ?? [];
        return (
          <View key={day} style={styles.availabilityRow}>
            <Text style={styles.dayLabel}>{DAY_LABELS[day]}</Text>
            <Text style={styles.dayValue} numberOfLines={1}>
              {dayRules.length ? dayRules.map((rule) => `${minuteClock(rule.startMinute)} - ${minuteClock(rule.endMinute)}`).join(", ") : "Unavailable"}
            </Text>
            <View style={[styles.availabilityDot, dayRules.length ? styles.availabilityDotOn : null]} />
          </View>
        );
      })}
      <Text style={styles.availabilitySummary}>{availabilitySummary(rules)}</Text>
    </View>
  );
}

/** e.g. "30-min sessions, 10-min break · Asia/Kolkata" (lists each distinct setting if days differ). */
function availabilitySummary(rules: CoachAvailabilityRule[]): string {
  const unique = (values: string[]) => Array.from(new Set(values)).join(" / ");
  const lengths = unique(rules.map((rule) => `${rule.sessionDurationMin}-min sessions`));
  const breaks = unique(rules.map((rule) => (rule.bufferMin ? `${rule.bufferMin}-min break` : "no break")));
  const zones = unique(rules.map((rule) => rule.timezone));
  return `${lengths}, ${breaks} · ${zones}`;
}

function AvailabilityExceptionsEditor({
  exceptions,
  onChanged,
}: {
  exceptions: CoachAvailabilityException[];
  onChanged: (message: string, patch: { added: CoachAvailabilityException } | { removedId: string }) => void;
}) {
  const [date, setDate] = useState("");
  const [minDate] = useState(() => todayLocalDate());
  const [type, setType] = useState<"unavailable" | "custom_hours">("unavailable");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function addException() {
    setMessage(null);
    if (!date) {
      setMessage("Pick a date first.");
      return;
    }
    const body: Record<string, unknown> = { date, type, reason: reason.trim() || undefined };
    if (type === "custom_hours") {
      const startMinute = timeToMinutes(startTime);
      const endMinute = timeToMinutes(endTime);
      if (startMinute == null || endMinute == null) {
        setMessage("Pick a start and end time.");
        return;
      }
      if (endMinute <= startMinute) {
        setMessage("End time must be later than start time.");
        return;
      }
      body.startMinute = startMinute;
      body.endMinute = endMinute;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/coach/availability/exceptions", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(
          json.error === "invalid_endMinute"
            ? "End time must be later than start time."
            : json.error === "invalid_date"
              ? "That date isn't valid. Pick it again."
              : json.error === "too_many_requests"
                ? "Too many changes in a row. Wait a minute and try again."
                : "Could not save this override."
        );
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { exception?: CoachAvailabilityException };
      setDate("");
      setReason("");
      if (json.exception) onChanged("Availability override saved.", { added: json.exception });
    } catch {
      setMessage("Network error while saving override.");
    } finally {
      setSaving(false);
    }
  }

  async function removeException(id: string) {
    setDeletingId(id);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/coach/availability/exceptions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setMessage("Could not remove this override.");
        return;
      }
      onChanged("Availability override removed.", { removedId: id });
    } catch {
      setMessage("Network error while removing override.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <View style={styles.editorBlock}>
      <Text style={styles.editorTitle}>Upcoming overrides</Text>
      {exceptions.length ? (
        exceptions.map((exception) => (
          <View key={exception.id} style={styles.exceptionRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.dayValue} numberOfLines={1}>
                {displayDate(exception.date)} - {exception.type === "unavailable" ? "Unavailable" : `Custom ${minuteClock(exception.startMinute ?? 0)} - ${minuteClock(exception.endMinute ?? 0)}`}
              </Text>
              {exception.reason ? <Text style={styles.muted} numberOfLines={1}>{exception.reason}</Text> : null}
            </View>
            <Pressable onPress={() => removeException(exception.id)} disabled={deletingId === exception.id} hitSlop={8}>
              <Text style={styles.linkText}>{deletingId === exception.id ? "..." : "Remove"}</Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={styles.muted}>No date overrides in the next 60 days.</Text>
      )}

      <Text style={styles.editorTitle}>Add an override</Text>
      <DateField label="Date" accessibilityLabel="Override date" placeholder="Select a date" value={date} onChange={setDate} minimumDate={minDate} />
      <View style={styles.toggleRow}>
        <ToggleChip label="Unavailable" active={type === "unavailable"} onPress={() => setType("unavailable")} />
        <ToggleChip label="Custom Hours" active={type === "custom_hours"} onPress={() => setType("custom_hours")} />
      </View>
      {type === "custom_hours" ? (
        <View style={styles.formGrid}>
          <TimeField label="Start" accessibilityLabel="Override start time" value={startTime} onChange={setStartTime} minuteInterval={5} style={styles.formField} />
          <TimeField label="End" accessibilityLabel="Override end time" value={endTime} onChange={setEndTime} minuteInterval={5} style={styles.formField} />
        </View>
      ) : null}
      <FormInput label="Reason (optional)" value={reason} onChangeText={setReason} />
      {message ? <Text style={styles.errorText}>{message}</Text> : null}
      <Pressable onPress={addException} disabled={saving} style={[styles.saveButton, saving ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>Add Override</Text>}
      </Pressable>
    </View>
  );
}

function minuteClock(minutes: number) {
  const hour24 = Math.floor(minutes / 60) % 24; // 1440 (end of day) reads as 12:00 AM
  const mins = minutes % 60;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(mins).padStart(2, "0")} ${ampm}`;
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  profileRow: { flexDirection: "row", gap: 16, alignItems: "center", marginBottom: 16 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontFamily: fonts.display, textTransform: "uppercase", flex: 1, minWidth: 0, color: colors.ink, fontSize: 26, lineHeight: 30 },
  cardTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 14, lineHeight: 19 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 7 },
  star: { color: "#ffc533", fontSize: 17, fontWeight: "900" },
  ratingText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  publishRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  twoCol: { flexDirection: "row", gap: 12 },
  splitCard: { flex: 1, minWidth: 0 },
  reviewScore: { fontFamily: fonts.display, textTransform: "uppercase", color: colors.ink, fontSize: 34, lineHeight: 38, marginTop: 7 },
  reviewItem: { gap: 5, marginTop: 9 },
  reviewBody: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 10 },
  availabilityRow: { minHeight: 31, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  dayLabel: { width: 34, color: colors.ink, fontSize: 13, fontWeight: "900" },
  dayValue: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12, lineHeight: 17 },
  availabilityDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.inkFaint },
  availabilityDotOn: { backgroundColor: colors.ok },
  availabilitySummary: { marginTop: 6, color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  warnText: { color: colors.warn, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  saveButtonTall: { minHeight: 44, flex: 0 },
  exceptionsToggle: { marginTop: 10, alignSelf: "flex-start" },
  exceptionRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line },
  partialText: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  editorCard: { gap: 10 },
  editorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  linkText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  editorBlock: { gap: 9, paddingVertical: 6 },
  editorTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "900" },
  formGrid: { flexDirection: "row", gap: 8 },
  formField: { flex: 1, gap: 5 },
  formLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", textTransform: "uppercase" },
  input: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: 10, color: colors.ink, fontSize: 13, fontWeight: "800" },
  toggleRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  toggleChip: { minHeight: 32, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  toggleChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  toggleChipText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  toggleChipTextActive: { color: colors.primary },
  editorActions: { flexDirection: "row", gap: 8 },
  saveButton: { flex: 1, minHeight: 34, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  saveText: { color: colors.onPrimary, fontSize: 13, fontWeight: "900" },
  errorText: { color: colors.bad, fontSize: 12, fontWeight: "800" },
  successText: { color: colors.ok, fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  dayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dayChip: { minHeight: 30, minWidth: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  dayChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dayChipText: { color: colors.inkMuted, fontSize: 12, fontWeight: "900" },
  dayChipTextActive: { color: colors.primary },
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
  divider: { height: 1, backgroundColor: colors.line },
});
