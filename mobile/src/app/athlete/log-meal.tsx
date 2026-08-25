import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { ActionButton, AppCard, ScreenContainer } from "../../components/fitora";
import { apiFetch } from "../../lib/api";
import { todayKey, titleCase } from "../../lib/fitoraData";
import { colors, radius } from "../../lib/theme";

const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"] as const;
type MealType = typeof MEAL_TYPES[number];

export default function LogMealScreen() {
  const router = useRouter();
  const [mealType, setMealType] = useState<MealType>("snack");
  const [mealName, setMealName] = useState("");
  const [foodName, setFoodName] = useState("");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const macroSummary = useMemo(
    () => `${Number(proteinG || 0)}g protein - ${Number(carbsG || 0)}g carbs - ${Number(fatG || 0)}g fat`,
    [proteinG, carbsG, fatG]
  );

  async function saveMeal() {
    const kcal = Number(calories);
    const protein = Number(proteinG);
    const carbs = Number(carbsG);
    const fat = Number(fatG);
    if (!mealName.trim() || !foodName.trim()) {
      setError("Meal and food names are required.");
      return;
    }
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
          name: mealName.trim(),
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
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not save this meal.");
        return;
      }
      router.replace({ pathname: "/athlete/dashboard", params: { section: "nutrition" } } as never);
    } catch {
      setError("Network failed while saving this meal.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={10}>
              <Ionicons name="chevron-back" size={26} color={colors.ink} />
            </Pressable>
            <Text style={styles.title}>Log Meal</Text>
          </View>

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
            <Field label="Meal name" value={mealName} onChangeText={setMealName} placeholder="Chicken rice bowl" />
            <Field label="Food item" value={foodName} onChangeText={setFoodName} placeholder="Chicken rice bowl" />
            <View style={styles.grid}>
              <Field label="Calories" value={calories} onChangeText={setCalories} keyboardType="numeric" />
              <Field label="Protein" value={proteinG} onChangeText={setProteinG} keyboardType="numeric" suffix="g" />
              <Field label="Carbs" value={carbsG} onChangeText={setCarbsG} keyboardType="numeric" suffix="g" />
              <Field label="Fat" value={fatG} onChangeText={setFatG} keyboardType="numeric" suffix="g" />
            </View>
            <Text style={styles.summary}>{macroSummary}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ActionButton label={saving ? "Saving..." : "Save Meal"} icon="checkmark-outline" variant="filled" onPress={saveMeal} disabled={saving} />
          </AppCard>
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
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10 },
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
  title: { flex: 1, color: colors.ink, fontSize: 28, lineHeight: 35, fontWeight: "900" },
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
  chipTextActive: { color: "#fff" },
  fieldBlock: { marginBottom: 12 },
  label: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
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
  summary: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  error: { color: colors.bad, fontSize: 13, lineHeight: 18, fontWeight: "800", marginBottom: 12 },
});
