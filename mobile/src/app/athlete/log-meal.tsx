import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AppCard,
  BackHeader,
  EmptyState,
  ScreenContainer,
} from "../../components/fitora";
import { apiFetch, apiJson } from "../../lib/api";
import { celebrate, errorFeedback } from "../../lib/feedback";
import { addDays, todayKey, titleCase, updateCachedData, mealCalories, type AthleteDashboardData, type Meal } from "../../lib/fitoraData";
import { colors, radius } from "../../lib/theme";

const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"] as const;
type MealType = typeof MEAL_TYPES[number];

type RecentFood = { name: string; calories: number; proteinG: number; carbsG: number; fatG: number };

export default function LogMealScreen() {
  const router = useRouter();
  const [mealType, setMealType] = useState<MealType>("snack");
  const [foodName, setFoodName] = useState("");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recentFoods, setRecentFoods] = useState<RecentFood[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  // "Recent" reuses the last 3 days of already-logged meals (same single-date
  // endpoint the dashboard uses, just called a few times) rather than a
  // separate favorites system — there's no food database in this app, so
  // this is the cleanest way to offer "log this again" without building one.
  useEffect(() => {
    let active = true;
    (async () => {
      const days = [0, 1, 2].map((offset) => addDays(todayKey(), -offset));
      const results = await Promise.all(
        days.map((day) => apiJson<{ meals: Meal[] }>(`/api/athlete/nutrition/meals?date=${day}`).catch(() => ({ meals: [] })))
      );
      const seen = new Set<string>();
      const items: RecentFood[] = [];
      for (const result of results) {
        for (const meal of [...result.meals].reverse()) {
          for (const food of meal.foods) {
            const key = food.name.trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            items.push({
              name: food.name,
              calories: Number(food.calories) || 0,
              proteinG: Number(food.proteinG) || 0,
              carbsG: Number(food.carbsG) || 0,
              fatG: Number(food.fatG) || 0,
            });
          }
        }
      }
      if (active) {
        setRecentFoods(items.slice(0, 8));
        setRecentLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const macroSummary = useMemo(
    () => `${Number(proteinG || 0)}g protein · ${Number(carbsG || 0)}g carbs · ${Number(fatG || 0)}g fat`,
    [proteinG, carbsG, fatG]
  );

  function applyRecent(food: RecentFood) {
    setFoodName(food.name);
    setCalories(String(Math.round(food.calories)));
    setProteinG(String(Math.round(food.proteinG)));
    setCarbsG(String(Math.round(food.carbsG)));
    setFatG(String(Math.round(food.fatG)));
    setShowDetails(true);
  }

  async function saveMeal() {
    if (!foodName.trim()) {
      setError("Enter what you ate first.");
      return;
    }
    const kcal = Number(calories || 0);
    const protein = Number(proteinG || 0);
    const carbs = Number(carbsG || 0);
    const fat = Number(fatG || 0);
    if (![kcal, protein, carbs, fat].every((value) => Number.isFinite(value) && value >= 0)) {
      setError("Calories and macros must be valid numbers.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/athlete/nutrition/meals", {
        method: "POST",
        body: JSON.stringify({
          date: todayKey(),
          mealType,
          source: "ad_hoc",
          name: foodName.trim(),
          foods: [
            {
              name: foodName.trim(),
              quantity: 1,
              unit: "serving",
              calories: kcal,
              proteinG: protein,
              carbsG: carbs,
              fatG: fat,
            },
          ],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; meal?: Meal };
      if (!res.ok) {
        setError(body.error ?? "Could not save this meal.");
        return;
      }
      // Patch the dashboard's cached data directly (it's still mounted right
      // underneath this screen in the stack) and go back to it, instead of
      // `replace`-ing to it — that used to remount the whole dashboard,
      // briefly showing stale totals before a full background reload caught up.
      const createdMeal = body.meal;
      if (createdMeal) {
        updateCachedData<AthleteDashboardData>("athlete-dashboard", (prev) => {
          if (!prev) return prev;
          const addedCalories = mealCalories(createdMeal);
          const addedProtein = createdMeal.foods.reduce((sum, f) => sum + (Number(f.proteinG) || 0), 0);
          const addedCarbs = createdMeal.foods.reduce((sum, f) => sum + (Number(f.carbsG) || 0), 0);
          const addedFat = createdMeal.foods.reduce((sum, f) => sum + (Number(f.fatG) || 0), 0);
          return {
            ...prev,
            meals: [...prev.meals, createdMeal],
            mealTotals: {
              calories: (prev.mealTotals?.calories ?? 0) + addedCalories,
              proteinG: (prev.mealTotals?.proteinG ?? 0) + addedProtein,
              carbsG: (prev.mealTotals?.carbsG ?? 0) + addedCarbs,
              fatG: (prev.mealTotals?.fatG ?? 0) + addedFat,
            },
          };
        });
      }
      celebrate({ title: "Meal logged", body: createdMeal ? `${Math.round(createdMeal.foods.reduce((sum, f) => sum + (Number(f.calories) || 0), 0))} kcal added to today.` : undefined });
      router.back();
    } catch {
      errorFeedback();
      setError("Network failed while saving this meal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BackHeader title="Log Meal" />

          <AppCard>
            <Text style={styles.cardTitle}>Meal Type</Text>
            <View style={styles.chipRow}>
              {MEAL_TYPES.map((type) => (
                <Pressable key={type} onPress={() => setMealType(type)} style={[styles.chip, mealType === type ? styles.chipActive : null]}>
                  <Text style={[styles.chipText, mealType === type ? styles.chipTextActive : null]}>{titleCase(type)}</Text>
                </Pressable>
              ))}
            </View>
          </AppCard>

          <AppCard>
            <Text style={styles.cardTitle}>What did you eat?</Text>
            <View style={{ marginTop: 10 }}>
              <TextInput
                value={foodName}
                onChangeText={setFoodName}
                placeholder="e.g. Chicken rice bowl"
                placeholderTextColor={colors.inkFaint}
                style={styles.mainInput}
              />
            </View>

            <Pressable onPress={() => router.push("/athlete/meal-scan" as never)} style={styles.scanRow} hitSlop={6}>
              <Ionicons name="camera-outline" size={16} color={colors.primary} />
              <Text style={styles.scanRowText}>Scan a photo instead</Text>
            </Pressable>

            {recentLoading || recentFoods.length ? (
              <View style={styles.recentBlock}>
                <Text style={styles.recentLabel}>RECENT</Text>
                {recentLoading ? (
                  <Text style={styles.muted}>Loading your recent foods...</Text>
                ) : (
                  <View style={styles.recentChipRow}>
                    {recentFoods.map((food) => (
                      <Pressable key={food.name} onPress={() => applyRecent(food)} style={styles.recentChip}>
                        <Text style={styles.recentChipText} numberOfLines={1}>{food.name}</Text>
                        <Text style={styles.recentChipMeta}>{Math.round(food.calories)} kcal</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </AppCard>

          <AppCard>
            <Pressable onPress={() => setShowDetails((value) => !value)} style={styles.detailsToggle} hitSlop={8}>
              <Ionicons name={showDetails ? "chevron-up" : "chevron-down"} size={16} color={colors.inkMuted} />
              <Text style={styles.detailsToggleText}>Nutrition details (optional)</Text>
            </Pressable>
            {showDetails ? (
              <>
                <View style={styles.grid}>
                  <Field label="Calories" value={calories} onChangeText={setCalories} keyboardType="numeric" />
                  <Field label="Protein" value={proteinG} onChangeText={setProteinG} keyboardType="numeric" suffix="g" />
                  <Field label="Carbs" value={carbsG} onChangeText={setCarbsG} keyboardType="numeric" suffix="g" />
                  <Field label="Fat" value={fatG} onChangeText={setFatG} keyboardType="numeric" suffix="g" />
                </View>
                <Text style={styles.summary}>{macroSummary}</Text>
              </>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ActionButton label={saving ? "Saving..." : "Save Meal"} icon="checkmark-outline" variant="filled" onPress={saveMeal} disabled={saving} />
          </AppCard>

          {!recentLoading && !recentFoods.length ? (
            <EmptyState icon="restaurant-outline" title="No meal history yet" body="Foods you log will show up here as quick Recent picks next time." />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function Field({
  label,
  suffix,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  suffix?: string;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput {...props} placeholderTextColor={colors.inkFaint} style={styles.input} />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 36 },
  backButton: {
    height: 42,
    width: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: {
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  chipTextActive: { color: colors.onPrimary },
  mainInput: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  scanRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  scanRowText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  recentBlock: { marginTop: 16 },
  recentLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "900", letterSpacing: 0.4, marginBottom: 8 },
  muted: { color: colors.inkMuted, fontSize: 13 },
  recentChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recentChip: {
    maxWidth: 170,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  recentChipText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  recentChipMeta: { color: colors.inkMuted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  detailsToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  detailsToggleText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  fieldBlock: { marginBottom: 12, marginTop: 12 },
  label: { color: colors.inkMuted, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  inputWrap: { position: "relative", justifyContent: "center", marginTop: 6 },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 14,
    paddingRight: 38,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  suffix: { position: "absolute", right: 14, color: colors.inkMuted, fontSize: 14, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: 10 },
  summary: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  error: { color: colors.bad, fontSize: 13, lineHeight: 18, fontWeight: "800", marginTop: 8, marginBottom: 12 },
});
