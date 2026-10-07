import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, View, type AppStateStatus } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../../components/AppText";
import { Avatar } from "../../../components/Avatar";
import {
  ActionButton,
  AlertBanner,
  AppCard,
  EmptyState,
  ErrorState,
  LoadingState,
  ScreenContainer,
  SectionHeader,
  StatusChip,
} from "../../../components/fitora";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { PAYMENTS_ENABLED } from "../../../lib/features";
import { colors } from "../../../lib/theme";
import {
  formatCurrency,
  loadCoachMarketplaceProfile,
  loadMoreCoachReviews,
  titleCase,
  updateCachedData,
  useAsyncData,
  type AthleteDashboardData,
  type CoachReview,
  type PricingPlan,
} from "../../../lib/fitoraData";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CHECKOUT_ERROR_MESSAGES: Record<string, string> = {
  already_your_coach: "This is already your current coach.",
  athlete_has_active_coach: "You already have an active coach — this should have started a switch instead. Pull to refresh and try again.",
  athlete_already_subscribing: "You already have a membership checkout in progress. Finish or wait for that one first.",
  switch_already_in_progress: "You already have a coach switch in progress. Wait for it to complete before starting another.",
  pricing_plan_not_found: "This plan is no longer available. Pull to refresh and try again.",
  coach_not_found: "This coach is no longer available.",
  payments_unavailable: "Online sign-up isn't available yet. Ask this coach to add you by your account email.",
};

type CheckoutState =
  | { kind: "idle" }
  | { kind: "pending"; isSwitch: boolean; planName: string }
  | { kind: "success"; isSwitch: boolean }
  | { kind: "error"; message: string };

export default function CoachProfileScreen() {
  const params = useLocalSearchParams<{ coachId?: string }>();
  const coachId = typeof params.coachId === "string" ? params.coachId : "";
  const state = useAsyncData(() => loadCoachMarketplaceProfile(coachId), [coachId], coachId ? `coach-marketplace-profile:${coachId}` : undefined);
  const [currentCoachId, setCurrentCoachId] = useState<string | null>(null);
  const [currentCoachName, setCurrentCoachName] = useState<string | null>(null);
  const [assignedLoaded, setAssignedLoaded] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: "idle" });
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState<CoachReview[]>([]);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (state.data) setReviewsOpen(state.data.reviews);
  }, [state.data]);

  useEffect(() => {
    let active = true;
    apiFetch("/api/athlete/coaches")
      .then((res) => res.json())
      .then((body: { coaches?: { coachId: string; name: string }[] }) => {
        if (!active) return;
        setCurrentCoachId(body.coaches?.[0]?.coachId ?? null);
        setCurrentCoachName(body.coaches?.[0]?.name ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setAssignedLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function checkActivation(isSwitch: boolean) {
    try {
      const res = await apiFetch("/api/athlete/coaches");
      const body = (await res.json().catch(() => ({}))) as { coaches?: { coachId: string; name: string }[] };
      const nowCoachId = body.coaches?.[0]?.coachId ?? null;
      if (nowCoachId === coachId) {
        setCheckout({ kind: "success", isSwitch });
        setCurrentCoachId(nowCoachId);
        setCurrentCoachName(body.coaches?.[0]?.name ?? null);
        if (state.data) {
          updateCachedData<AthleteDashboardData>("athlete-dashboard", (prev) =>
            prev ? { ...prev, coaches: [{ coachId, name: state.data!.profile.name }] } : prev
          );
        }
        return true;
      }
      // Not activated yet — for a plain subscribe (not a switch, which has no
      // athlete-facing status endpoint to check), tell a genuinely failed/
      // cancelled payment apart from one that's still legitimately pending,
      // instead of leaving the coach staring at "pending" forever.
      if (!isSwitch) {
        const subRes = await apiFetch("/api/athlete/coach-subscriptions/current");
        const subBody = (await subRes.json().catch(() => ({}))) as { subscription: { status: string } | null };
        if (!subBody.subscription) {
          setCheckout({ kind: "error", message: "This payment didn't go through. You can try again with the same or a different plan." });
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  // If a real checkout URL was opened, re-check status once the athlete
  // returns to the app from that browser session — no server push exists for
  // this, so returning-to-foreground is the best available "they might be
  // done" signal. A manual "Check status" button covers the rest.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      appStateRef.current = next;
      if (wasBackground && next === "active" && checkout.kind === "pending") {
        void checkActivation(checkout.isSwitch);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout]);

  async function loadMoreReviews() {
    if (loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const nextPage = reviewsPage + 1;
      const more = await loadMoreCoachReviews(coachId, nextPage);
      if (more.length) {
        setReviewsOpen((prev) => [...prev, ...more]);
        setReviewsPage(nextPage);
      }
    } finally {
      setLoadingMoreReviews(false);
    }
  }

  async function startCheckout(plan: PricingPlan) {
    if (submitting) return;
    const isSwitch = Boolean(currentCoachId) && currentCoachId !== coachId;
    setSubmitting(true);
    setCheckout({ kind: "idle" });
    try {
      const res = await apiFetch(isSwitch ? "/api/athlete/coach-switch" : "/api/athlete/coach-subscriptions", {
        method: "POST",
        body: JSON.stringify(
          isSwitch ? { newCoachId: coachId, newPricingPlanId: plan.id } : { coachId, pricingPlanId: plan.id }
        ),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; checkoutRef?: string };
      if (!res.ok) {
        setCheckout({ kind: "error", message: CHECKOUT_ERROR_MESSAGES[body.error ?? ""] ?? "Could not start this membership. Please try again." });
        return;
      }
      if (body.checkoutRef) {
        if (/^https?:\/\//.test(body.checkoutRef)) {
          Linking.openURL(body.checkoutRef).catch(() => undefined);
        }
        setCheckout({ kind: "pending", isSwitch, planName: plan.name });
      } else {
        // No checkout ref means a free/legacy path that activated immediately.
        const confirmed = await checkActivation(isSwitch);
        if (confirmed) {
          setCheckout({ kind: "success", isSwitch });
        } else {
          setCheckout({ kind: "error", message: "Membership created, but activation didn't confirm yet — pull to refresh." });
        }
      }
    } catch {
      setCheckout({ kind: "error", message: "Network error while starting checkout." });
    } finally {
      setSubmitting(false);
    }
  }

  if (state.loading && !state.data) {
    return (
      <ScreenContainer>
        <BackHeader title="Coach" />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer>
        <BackHeader title="Coach" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  if (!state.data) return null;
  const { profile } = state.data;
  const isCurrentCoach = assignedLoaded && currentCoachId === coachId;
  const isSwitchTarget = assignedLoaded && Boolean(currentCoachId) && currentCoachId !== coachId;
  const plans = profile.pricingPlans ?? [];

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <BackHeader title={profile.name} />

      <AppCard>
        <View style={styles.identityRow}>
          <Avatar
            avatar={profile.avatar}
            name={profile.name}
            size={84}
            accentSoft={colors.primarySoft}
            accentStrong={colors.primary}
            photoPath={`/api/marketplace/coaches/${coachId}/avatar/file`}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
              {profile.verifiedStatus === "verified" ? <Ionicons name="checkmark-circle" size={19} color={colors.primary} /> : null}
            </View>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={16} color={colors.warn} />
              <Text style={styles.ratingText}>
                {profile.avgRating ? profile.avgRating.toFixed(1) : "New"}{profile.reviewCount ? ` - ${profile.reviewCount} reviews` : " - no reviews yet"}
              </Text>
            </View>
            <Text style={styles.muted}>{profile.yearsExperience != null ? `${profile.yearsExperience} years experience` : "Experience not listed"}</Text>
          </View>
        </View>
        {isCurrentCoach ? <StatusChip label="Your current coach" tone="success" icon="checkmark-circle-outline" /> : null}
      </AppCard>

      <AppCard>
        <SectionHeader title="Expertise" />
        <View style={styles.tagWrap}>
          {(profile.specializations ?? []).map((tag) => <StatusChip key={tag} label={tag} tone="primary" />)}
          {(profile.coachingTypes ?? []).map((tag) => <StatusChip key={tag} label={titleCase(tag)} tone="neutral" />)}
          {profile.nutritionSupport ? <StatusChip label="Nutrition support" tone="success" /> : null}
        </View>
        {(profile.languages ?? []).length ? (
          <Text style={styles.languagesText}>Speaks {(profile.languages ?? []).map(titleCase).join(", ")}</Text>
        ) : null}
        {!(profile.specializations ?? []).length && !(profile.coachingTypes ?? []).length ? (
          <Text style={styles.mutedBody}>{"This coach hasn't listed specializations yet."}</Text>
        ) : null}
      </AppCard>

      <AppCard>
        <SectionHeader title="About" />
        <Text style={styles.mutedBody}>{profile.bio || profile.philosophy || "This coach hasn't added a bio yet."}</Text>
      </AppCard>

      <AppCard>
        <SectionHeader title="Availability" />
        {(profile.availableDays ?? []).length ? (
          <Text style={styles.mutedBody}>
            Weekly availability: {(profile.availableDays ?? []).map((d) => WEEKDAY_NAMES[d]).join(", ")}
          </Text>
        ) : (
          <Text style={styles.mutedBody}>{PAYMENTS_ENABLED ? "This coach hasn't published weekly availability yet. You can message them once you subscribe." : "This coach hasn't published weekly availability yet. You can message them once they add you as a client."}</Text>
        )}
      </AppCard>

      <SectionHeader title={PAYMENTS_ENABLED ? "Pricing Plans" : "Coaching Plans"} />
      {plans.length ? (
        plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            selected={PAYMENTS_ENABLED && selectedPlanId === plan.id}
            onSelect={PAYMENTS_ENABLED ? () => setSelectedPlanId(plan.id) : undefined}
          />
        ))
      ) : (
        <AppCard>
          <EmptyState title="No pricing plans yet" body={PAYMENTS_ENABLED ? "This coach hasn't published a plan to subscribe to." : "This coach hasn't published a coaching plan yet."} icon="ribbon-outline" />
        </AppCard>
      )}

      <AppCard>
        <SectionHeader
          title="Reviews"
          action={reviewsOpen.length && reviewsOpen.length < state.data.reviewsTotal ? `Load more (${reviewsOpen.length} of ${state.data.reviewsTotal})` : undefined}
          onAction={loadMoreReviews}
        />
        {reviewsOpen.length ? (
          reviewsOpen.map((review, index) => (
            <View key={review.id}>
              <ReviewRow review={review} />
              {index < reviewsOpen.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          ))
        ) : (
          <EmptyState title="No reviews yet" body="Be the first to work with this coach and leave feedback." icon="star-outline" />
        )}
        {loadingMoreReviews ? <Text style={styles.mutedBody}>Loading more reviews...</Text> : null}
      </AppCard>

      {checkout.kind === "pending" ? (
        <AlertBanner
          tone="warning"
          title="Payment pending"
          body={`Complete payment for ${checkout.planName} in the window that opened, then check status below. This can take a minute after you pay.`}
        />
      ) : null}
      {checkout.kind === "pending" ? (
        <ActionButton label="Check Payment Status" onPress={() => void checkActivation(checkout.isSwitch)} />
      ) : null}
      {checkout.kind === "success" ? (
        <AlertBanner
          tone="primary"
          title={checkout.isSwitch ? "Coach switched" : "Membership active"}
          body={`${profile.name} is now your coach. Head to your Coach tab to see it reflected.`}
        />
      ) : null}
      {checkout.kind === "error" ? <AlertBanner tone="danger" title="Could not complete this" body={checkout.message} /> : null}

      {!PAYMENTS_ENABLED && !isCurrentCoach ? (
        <AlertBanner
          tone="primary"
          title={`Work with ${profile.name}`}
          body={`Online sign-up is coming soon. To start now, share your account email${user?.email ? ` (${user.email})` : ""} with ${profile.name}. Once they add you as a client, they'll appear in your Coach tab.`}
        />
      ) : null}
      {!PAYMENTS_ENABLED || isCurrentCoach ? null : plans.length ? (
        <ActionButton
          label={
            submitting
              ? "Starting..."
              : !selectedPlanId
                ? "Select a plan above"
                : isSwitchTarget
                  ? `Switch to ${plans.find((p) => p.id === selectedPlanId)?.name ?? "this plan"}`
                  : `Subscribe to ${plans.find((p) => p.id === selectedPlanId)?.name ?? "this plan"}`
          }
          variant="filled"
          disabled={!selectedPlanId || submitting}
          onPress={() => {
            const plan = plans.find((p) => p.id === selectedPlanId);
            if (plan) void startCheckout(plan);
          }}
        />
      ) : null}
      {PAYMENTS_ENABLED && isSwitchTarget && !isCurrentCoach ? (
        <Text style={styles.switchNote}>
          {"You're currently coached by "}{currentCoachName ?? "another coach"}{". Subscribing here starts a switch — your current coach stays active and billed until this one is confirmed."}
        </Text>
      ) : null}
    </ScreenContainer>
  );
}

function BackHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={10}>
        <Ionicons name="arrow-back" size={24} color={colors.ink} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.backButton} />
    </View>
  );
}

function PlanCard({ plan, selected, onSelect }: { plan: PricingPlan; selected: boolean; onSelect?: () => void }) {
  return (
    <Pressable onPress={onSelect} disabled={!onSelect} style={({ pressed }) => [pressed ? styles.pressed : null]}>
      <AppCard style={[styles.planCard, selected ? styles.planCardSelected : null]}>
        <View style={styles.planHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.planName}>{plan.name}</Text>
            <Text style={styles.planPrice}>{formatCurrency(plan.monthlyPrice, plan.currency)} / month</Text>
          </View>
          {onSelect ? <View style={[styles.radio, selected ? styles.radioOn : null]} /> : null}
        </View>
        {plan.description ? <Text style={styles.planDescription}>{plan.description}</Text> : null}
        <View style={styles.planFeatureList}>
          <PlanFeature label={plan.liveSessionsPerCycle ? `${plan.liveSessionsPerCycle} live sessions / cycle` : "No live sessions included"} included={Boolean(plan.liveSessionsPerCycle)} />
          <PlanFeature label="Nutrition support" included={Boolean(plan.nutritionIncluded)} />
          <PlanFeature label="Workout planning" included={Boolean(plan.workoutPlanningIncluded)} />
          <PlanFeature label="Direct messaging" included={plan.messagingIncluded !== false} />
        </View>
        {(plan.includedServices ?? []).length ? (
          <View style={styles.tagWrap}>
            {(plan.includedServices ?? []).map((service) => <StatusChip key={service} label={service} tone="neutral" />)}
          </View>
        ) : null}
      </AppCard>
    </Pressable>
  );
}

function PlanFeature({ label, included }: { label: string; included: boolean }) {
  return (
    <View style={styles.planFeatureRow}>
      <Ionicons name={included ? "checkmark-circle" : "close-circle-outline"} size={16} color={included ? colors.ok : colors.inkFaint} />
      <Text style={[styles.planFeatureText, !included ? styles.planFeatureTextMuted : null]}>{label}</Text>
    </View>
  );
}

function ReviewRow({ review }: { review: CoachReview }) {
  return (
    <View style={styles.reviewRow}>
      <View style={styles.reviewHeader}>
        <View style={styles.reviewStars}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Ionicons key={i} name={i < Math.round(review.overallRating) ? "star" : "star-outline"} size={14} color={colors.warn} />
          ))}
        </View>
        <Text style={styles.reviewDate}>{new Date(review.createdAt).toLocaleDateString()}</Text>
      </View>
      {review.athleteName ? <Text style={styles.reviewerName}>{review.athleteName}</Text> : null}
      {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { height: 42, width: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "900" },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flex: 1, color: colors.ink, fontSize: 21, lineHeight: 27, fontWeight: "900" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  ratingText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  muted: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  mutedBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  languagesText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: 8 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 4 },
  pressed: { opacity: 0.88 },
  planCard: { borderWidth: 1, borderColor: colors.line, gap: 10 },
  planCardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  planHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  planName: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  planPrice: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "800", marginTop: 2 },
  planDescription: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.inkFaint },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  planFeatureList: { gap: 6 },
  planFeatureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  planFeatureText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  planFeatureTextMuted: { color: colors.inkFaint, fontWeight: "600" },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  reviewRow: { gap: 4 },
  reviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reviewStars: { flexDirection: "row", gap: 2 },
  reviewDate: { color: colors.inkFaint, fontSize: 11, fontWeight: "700" },
  reviewerName: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  reviewBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
  switchNote: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, textAlign: "center" },
});
