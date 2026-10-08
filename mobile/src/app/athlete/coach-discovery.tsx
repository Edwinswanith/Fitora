import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { Avatar } from "../../components/Avatar";
import {
  AlertBanner,
  AppCard,
  BackHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  ScreenContainer,
  SectionHeader,
  StatusChip,
} from "../../components/fitora";
import { apiJson } from "../../lib/api";
import { colors, radius } from "../../lib/theme";
import { formatCurrency, loadMarketplaceCoaches, useAsyncData, type MarketplaceCoach, type MarketplaceFilters } from "../../lib/fitoraData";

type QuickFilter = "all" | "nutrition" | "experienced" | "topRated";

const QUICK_FILTER_PARAMS: Record<QuickFilter, MarketplaceFilters> = {
  all: {},
  nutrition: { nutritionSupport: true },
  experienced: { minExperience: 5 },
  topRated: { minRating: 4 },
};

async function loadDiscovery(quickFilter: QuickFilter, specialization: string | null) {
  const [result, currentCoach] = await Promise.all([
    loadMarketplaceCoaches({ ...QUICK_FILTER_PARAMS[quickFilter], specialization: specialization ?? undefined }),
    apiJson<{ coaches: { coachId: string; name: string }[] }>("/api/athlete/coaches").catch(() => ({ coaches: [] })),
  ]);
  return { ...result, currentCoachName: currentCoach.coaches[0]?.name ?? null };
}

export default function CoachDiscovery() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [specialization, setSpecialization] = useState<string | null>(null);
  const [availableOnly, setAvailableOnly] = useState(false);
  const state = useAsyncData(
    () => loadDiscovery(quickFilter, specialization),
    [quickFilter, specialization],
    `athlete-coach-discovery:${quickFilter}:${specialization ?? "all"}`
  );

  // Specialization options are derived from whatever the current
  // (quick-filter-scoped) batch actually contains — never a fabricated fixed
  // list, since coach specializations are free text with no enumeration
  // endpoint. This naturally narrows/widens as the quick filter changes.
  const specializationOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const coach of state.data?.coaches ?? []) {
      for (const tag of coach.specializations ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);
  }, [state.data?.coaches]);

  const coaches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (state.data?.coaches ?? []).filter((coach) => {
      if (availableOnly && !coach.hasAvailability) return false;
      if (!q) return true;
      const text = [coach.name, ...(coach.specializations ?? []), ...(coach.coachingTypes ?? []), ...(coach.languages ?? [])]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [availableOnly, query, state.data?.coaches]);

  const hasAnyFilterApplied = quickFilter !== "all" || Boolean(specialization) || availableOnly || Boolean(query.trim());

  function clearFilters() {
    setQuery("");
    setQuickFilter("all");
    setSpecialization(null);
    setAvailableOnly(false);
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

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <BackHeader title="Find a Coach" subtitle="Match your goal to a coach's plan, price and availability." />

      {state.data?.currentCoachName ? (
        <AlertBanner
          tone="primary"
          title={`Currently coached by ${state.data.currentCoachName}`}
          body="Choosing a plan below starts a coach switch — your current coach stays active until the new one is confirmed."
        />
      ) : null}

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={22} color={colors.inkFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search coaches, specialties, languages..."
          placeholderTextColor={colors.inkFaint}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {([
          { value: "all", label: "All" },
          { value: "nutrition", label: "Nutrition" },
          { value: "experienced", label: "5+ Years" },
          { value: "topRated", label: "Top Rated" },
        ] as { value: QuickFilter; label: string }[]).map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setQuickFilter(item.value)}
            style={[styles.filterChip, quickFilter === item.value ? styles.filterChipActive : null]}
          >
            <Text style={[styles.filterText, quickFilter === item.value ? styles.filterTextActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setAvailableOnly((value) => !value)}
          style={[styles.filterChip, availableOnly ? styles.filterChipActive : null]}
        >
          <Text style={[styles.filterText, availableOnly ? styles.filterTextActive : null]}>Available</Text>
        </Pressable>
      </ScrollView>

      {specializationOptions.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {specializationOptions.map((tag) => {
            const active = specialization === tag;
            return (
              <Pressable
                key={tag}
                onPress={() => setSpecialization(active ? null : tag)}
                style={[styles.specChip, active ? styles.specChipActive : null]}
              >
                <Text style={[styles.specText, active ? styles.specTextActive : null]}>{tag}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <SectionHeader
        title={`${coaches.length} Coach${coaches.length === 1 ? "" : "es"}`}
        action={hasAnyFilterApplied ? "Clear filters" : undefined}
        onAction={clearFilters}
      />
      {coaches.length ? (
        coaches.map((coach) => (
          <CoachCard key={coach.coachId} coach={coach} onPress={() => router.push(`/athlete/coach-profile/${coach.coachId}` as never)} />
        ))
      ) : hasAnyFilterApplied ? (
        <EmptyState title="No coaches match" body="Try clearing a filter or searching a different specialty." icon="search-outline" />
      ) : (
        <EmptyState title="No coaches available" body="No coaches are currently listed in the marketplace. Check back soon." icon="people-outline" />
      )}
    </ScreenContainer>
  );
}

function CoachCard({ coach, onPress }: { coach: MarketplaceCoach; onPress: () => void }) {
  const price = coach.startingPrice ? `${formatCurrency(coach.startingPrice.amount, coach.startingPrice.currency)}/mo` : "Pricing unavailable";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed ? styles.pressed : null]}>
      <AppCard>
        <View style={styles.coachTop}>
          <Avatar
            avatar={coach.avatar}
            name={coach.name}
            size={64}
            accentSoft={colors.primarySoft}
            accentStrong={colors.primary}
            photoPath={`/api/marketplace/coaches/${coach.coachId}/avatar/file`}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameRow}>
              <Text style={styles.coachName} numberOfLines={1}>{coach.name}</Text>
              {coach.verifiedStatus === "verified" ? <Ionicons name="checkmark-circle" size={17} color={colors.primary} /> : null}
            </View>
            <Text style={styles.muted} numberOfLines={1}>{(coach.specializations ?? [])[0] || "Fitness Coach"}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color={colors.warn} />
              <Text style={styles.rating}>
                {coach.avgRating ? coach.avgRating.toFixed(1) : "New"}{coach.reviewCount ? ` - ${coach.reviewCount} reviews` : ""}
              </Text>
              {coach.hasAvailability ? (
                <View style={styles.availableDot}>
                  <View style={styles.dot} />
                  <Text style={styles.availableText}>Available</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.tagWrap}>
          {(coach.specializations ?? []).slice(1, 3).map((tag) => <StatusChip key={tag} label={tag} tone="primary" />)}
          {coach.nutritionSupport ? <StatusChip label="Nutrition" tone="success" /> : null}
        </View>
        <View style={styles.bottomRow}>
          <View>
            <Text style={styles.price}>{price}</Text>
            <Text style={styles.mutedSmall}>Starting plan</Text>
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>View Coach</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onPrimary} />
          </View>
        </View>
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    minHeight: 52,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15 },
  filterRow: { flexDirection: "row", gap: 8, paddingRight: 4 },
  filterChip: {
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  filterTextActive: { color: colors.onPrimary },
  specChip: {
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  specChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  specText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  specTextActive: { color: colors.primary },
  pressed: { opacity: 0.85 },
  coachTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  coachName: { flex: 1, color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  mutedSmall: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  rating: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  availableDot: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ok },
  availableText: { color: colors.ok, fontSize: 12, fontWeight: "800" },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11 },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 13 },
  price: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  cta: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 38, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: 14 },
  ctaText: { color: colors.onPrimary, fontSize: 13, fontWeight: "900" },
});
