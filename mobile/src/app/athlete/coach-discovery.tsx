import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { Avatar } from "../../components/Avatar";
import {
  ActionButton,
  AppCard,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  ScreenContainer,
  SectionHeader,
  StatusChip,
} from "../../components/fitora";
import { apiFetch, apiJson } from "../../lib/api";
import { colors, radius } from "../../lib/theme";
import { formatCurrency, titleCase, useAsyncData, type MarketplaceCoach, type PublicCoachProfile } from "../../lib/fitoraData";

async function loadCoaches() {
  return apiJson<{ coaches: MarketplaceCoach[] }>("/api/marketplace/coaches?limit=50");
}

export default function CoachDiscovery() {
  const router = useRouter();
  const state = useAsyncData(loadCoaches, []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "nutrition" | "strength" | "experienced">("all");

  const coaches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (state.data?.coaches ?? []).filter((coach) => {
      const text = [
        coach.name,
        ...(coach.specializations ?? []),
        ...(coach.coachingTypes ?? []),
        ...(coach.languages ?? []),
      ].join(" ").toLowerCase();
      const matchesQuery = !q || text.includes(q);
      const matchesFilter =
        filter === "all" ||
        (filter === "nutrition" && coach.nutritionSupport) ||
        (filter === "strength" && text.includes("strength")) ||
        (filter === "experienced" && (coach.yearsExperience ?? 0) >= 5);
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, state.data?.coaches]);

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

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>Find Coach</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={24} color={colors.inkFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search coaches..."
          placeholderTextColor={colors.inkFaint}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.filterRow}>
        {[
          { value: "all", label: "All" },
          { value: "nutrition", label: "Nutrition" },
          { value: "strength", label: "Strength" },
          { value: "experienced", label: "5+ Years" },
        ].map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setFilter(item.value as typeof filter)}
            style={[styles.filterChip, filter === item.value ? styles.filterChipActive : null]}
          >
            <Text style={[styles.filterText, filter === item.value ? styles.filterTextActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <SectionHeader title={`${coaches.length} Coaches`} />
      {coaches.length ? (
        coaches.map((coach) => <CoachCard key={coach.coachId} coach={coach} />)
      ) : (
        <EmptyState title="No coaches found" body="Try a different specialization, language, or rating filter." icon="search-outline" />
      )}
    </ScreenContainer>
  );
}

function CoachCard({ coach }: { coach: MarketplaceCoach }) {
  const [expanded, setExpanded] = useState(false);
  const [profile, setProfile] = useState<PublicCoachProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const price = coach.startingPrice ? `${formatCurrency(coach.startingPrice.amount, coach.startingPrice.currency)}/month` : "Pricing unavailable";

  async function toggleDetails() {
    setExpanded((value) => !value);
    if (profile || loadingProfile) return;
    setLoadingProfile(true);
    setMessage(null);
    try {
      const result = await apiJson<{ profile: PublicCoachProfile }>(`/api/marketplace/coaches/${coach.coachId}`);
      setProfile(result.profile);
    } catch {
      setMessage("Could not load coach details.");
    } finally {
      setLoadingProfile(false);
    }
  }

  async function startSubscription(planId: string) {
    setMessage(null);
    try {
      const res = await apiFetch("/api/athlete/coach-subscriptions", {
        method: "POST",
        body: JSON.stringify({ coachId: coach.coachId, pricingPlanId: planId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; checkoutRef?: string };
      if (!res.ok) {
        setMessage(body.error ?? "Could not start this membership.");
        return;
      }
      setMessage(body.checkoutRef ? "Membership checkout started." : "Membership request created.");
    } catch {
      setMessage("Network failed while starting membership.");
    }
  }

  return (
    <AppCard>
      <View style={styles.coachTop}>
        <Avatar
          avatar={coach.avatar}
          name={coach.name}
          size={76}
          accentSoft={colors.primarySoft}
          accentStrong={colors.primary}
          photoPath={`/api/marketplace/coaches/${coach.coachId}/avatar/file`}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={styles.coachName} numberOfLines={1}>{coach.name}</Text>
            {coach.verifiedStatus === "verified" ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
          </View>
          <Text style={styles.muted} numberOfLines={1}>{(coach.specializations ?? [])[0] || "Fitness Coach"}</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={16} color={colors.warn} />
            <Text style={styles.rating}>
              {coach.avgRating ? coach.avgRating.toFixed(1) : "New"} {coach.reviewCount ? `- ${coach.reviewCount} reviews` : ""}
            </Text>
          </View>
          <Text style={styles.muted}>{coach.yearsExperience ? `${coach.yearsExperience} years experience` : "Experience not listed"}</Text>
        </View>
      </View>
      <View style={styles.tagWrap}>
        {(coach.specializations ?? []).slice(0, 3).map((tag) => <StatusChip key={tag} label={tag} tone="primary" />)}
        {coach.nutritionSupport ? <StatusChip label="Nutrition" tone="success" /> : null}
      </View>
      <View style={styles.priceRow}>
        <IconTile icon="ribbon-outline" size={44} />
        <View style={{ flex: 1 }}>
          <Text style={styles.price}>{price}</Text>
          <Text style={styles.muted}>Starting plan</Text>
        </View>
        <ActionButton label={expanded ? "Hide" : loadingProfile ? "Loading..." : "View"} onPress={toggleDetails} />
      </View>
      {expanded ? (
        <View style={styles.detailPanel}>
          {profile ? (
            <>
              <Text style={styles.detailBody}>{profile.bio || profile.philosophy || "This coach has not added a full bio yet."}</Text>
              <View style={styles.tagWrap}>
                {(profile.coachingTypes ?? []).slice(0, 4).map((tag) => <StatusChip key={tag} label={titleCase(tag)} tone="primary" />)}
                {(profile.languages ?? []).slice(0, 4).map((tag) => <StatusChip key={tag} label={titleCase(tag)} tone="neutral" />)}
              </View>
              {(profile.pricingPlans ?? []).slice(0, 3).map((plan) => (
                <View key={plan.id} style={styles.planRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.planTitle}>{plan.name}</Text>
                    <Text style={styles.muted}>{formatCurrency(plan.monthlyPrice, plan.currency)} / month</Text>
                  </View>
                  <ActionButton label="Choose" variant="filled" onPress={() => startSubscription(plan.id)} />
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.detailBody}>{loadingProfile ? "Loading coach details..." : "Coach details unavailable."}</Text>
          )}
          {message ? <Text style={message.includes("started") || message.includes("created") ? styles.successText : styles.errorText}>{message}</Text> : null}
        </View>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  headerRow: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { height: 42, width: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  title: { color: colors.ink, fontSize: 30, lineHeight: 38, fontWeight: "900" },
  searchBox: {
    minHeight: 58,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 18 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  filterChip: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  filterTextActive: { color: "#fff" },
  coachTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  coachName: { flex: 1, color: colors.ink, fontSize: 22, lineHeight: 28, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  rating: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  price: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  detailPanel: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line, gap: 10 },
  detailBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  planRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  planTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  successText: { color: colors.ok, fontSize: 13, lineHeight: 18, fontWeight: "800" },
  errorText: { color: colors.bad, fontSize: 13, lineHeight: 18, fontWeight: "800" },
});
