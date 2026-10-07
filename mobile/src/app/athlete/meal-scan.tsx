import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AppCard,
  EmptyState,
  IconTile,
  LoadingState,
  ProgressBar,
  ScreenContainer,
  StatusChip,
} from "../../components/fitora";
import { apiFetch } from "../../lib/api";
import { colors, radius } from "../../lib/theme";
import { todayKey, titleCase, updateCachedData, type AthleteDashboardData, type Meal } from "../../lib/fitoraData";

type MealScan = {
  id: string;
  status: string;
  overallConfidence: number | null;
  suggestedMealName: string | null;
  suggestedMealType: string | null;
  error: string | null;
  items: {
    foodName: string;
    quantity: number;
    unit: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number | null;
    foodConfidence: number;
    quantityConfidence: number;
  }[];
};

/**
 * The editable review draft — kept as strings (not the scan's numeric
 * fields) so text inputs never fight a controlled-value snap-back while
 * typing decimals. Converted to numbers only when the athlete saves.
 * `confidence` is null for a row the athlete added themselves (Phase 5B:
 * "add missing item") since there's no AI confidence to show for it.
 */
type DraftItem = {
  key: string;
  foodName: string;
  quantity: string;
  unit: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  confidence: number | null;
};

const SCAN_ISSUE_TITLES: Record<string, string> = {
  no_food_detected: "No Food Detected",
  low_quality: "Image Too Unclear",
  low_confidence: "Not Confident Enough",
  rejected: "Scan Didn't Go Through",
};

const SCAN_ISSUE_MESSAGES: Record<string, string> = {
  no_food_detected: "We couldn't detect any food in this image. Please scan a meal or food item and try again.",
  low_quality: "The image isn't clear enough to identify the food. Please take another photo with better lighting and keep the food clearly visible.",
  low_confidence: "We're not confident enough to identify this food accurately. Please retake the photo or enter the food manually.",
  rejected: "We couldn't process that image. Please try scanning again, or enter the food manually.",
};

function draftFromScanItem(item: MealScan["items"][number], index: number): DraftItem {
  return {
    key: `scan-${index}`,
    foodName: item.foodName,
    quantity: String(item.quantity),
    unit: item.unit,
    calories: String(Math.round(item.calories)),
    proteinG: String(Math.round(item.proteinG)),
    carbsG: String(Math.round(item.carbsG)),
    fatG: String(Math.round(item.fatG)),
    confidence: item.foodConfidence,
  };
}

function blankDraftItem(): DraftItem {
  return {
    key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    foodName: "",
    quantity: "1",
    unit: "serving",
    calories: "0",
    proteinG: "0",
    carbsG: "0",
    fatG: "0",
    confidence: null,
  };
}

export default function MealScanScreen() {
  const router = useRouter();
  const [scan, setScan] = useState<MealScan | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => {
    if (!items.length) return null;
    return items.reduce(
      (acc, item) => ({
        calories: acc.calories + (Number(item.calories) || 0),
        proteinG: acc.proteinG + (Number(item.proteinG) || 0),
        carbsG: acc.carbsG + (Number(item.carbsG) || 0),
        fatG: acc.fatG + (Number(item.fatG) || 0),
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );
  }, [items]);

  async function chooseImage() {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: "image/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const form = new FormData();
    form.append("file", new File(asset.uri), asset.name || "meal.jpg");
    setBusy("upload");
    try {
      const res = await apiFetch("/api/athlete/nutrition/meal-scan", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { scan?: MealScan; error?: string };
      if (!res.ok || !body.scan) {
        setError(body.error ?? "Could not analyze this meal.");
        return;
      }
      setScan(body.scan);
      setItems(body.scan.items.map(draftFromScanItem));
    } catch {
      setError("Network failed while uploading the meal image.");
    } finally {
      setBusy(null);
    }
  }

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((item) => item.key !== key));
  }

  function addItem() {
    setItems((prev) => [...prev, blankDraftItem()]);
  }

  async function saveMeal() {
    if (!scan) return;
    const cleaned = items.filter((item) => item.foodName.trim());
    if (!cleaned.length) {
      setError("Add at least one food before saving.");
      return;
    }
    setBusy("save");
    setError(null);
    const foods = cleaned.map((item) => ({
      name: item.foodName.trim(),
      quantity: Number(item.quantity) || 1,
      unit: item.unit.trim() || "serving",
      calories: Number(item.calories) || 0,
      proteinG: Number(item.proteinG) || 0,
      carbsG: Number(item.carbsG) || 0,
      fatG: Number(item.fatG) || 0,
    }));
    try {
      const res = await apiFetch(`/api/athlete/nutrition/meal-scan/${scan.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          date: todayKey(),
          mealType: scan.suggestedMealType || "lunch",
          foods,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; meal?: Meal };
      if (!res.ok) {
        setError(body.error ?? "Could not save this meal.");
        return;
      }
      const createdMeal = body.meal;
      if (createdMeal) {
        updateCachedData<AthleteDashboardData>("athlete-dashboard", (prev) => {
          if (!prev) return prev;
          const addedCalories = createdMeal.foods.reduce((sum, f) => sum + (Number(f.calories) || 0), 0);
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
      router.back();
    } catch {
      setError("Network failed while saving this meal.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={27} color={colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Scan Meal</Text>
      </View>

      {error ? (
        <AppCard style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </AppCard>
      ) : null}

      {!scan && busy === "upload" ? <LoadingState label="Analyzing meal..." /> : null}

      {!scan && busy !== "upload" ? (
        <AppCard style={styles.pickCard}>
          <IconTile icon="camera-outline" size={62} />
          <Text style={styles.pickTitle}>Camera or Gallery</Text>
          <Text style={styles.pickBody}>Choose a meal photo. Fitora will analyze it, then you can review and save.</Text>
          <ActionButton label="Choose Photo" icon="image-outline" variant="filled" onPress={chooseImage} />
        </AppCard>
      ) : null}

      {scan && SCAN_ISSUE_MESSAGES[scan.status] ? (
        <AppCard style={styles.issueCard}>
          <IconTile icon={scan.status === "low_quality" ? "flashlight-outline" : "camera-outline"} size={56} />
          <Text style={styles.issueTitle}>{SCAN_ISSUE_TITLES[scan.status]}</Text>
          <Text style={styles.issueBody}>{SCAN_ISSUE_MESSAGES[scan.status]}</Text>
          <View style={styles.actionRow}>
            <ActionButton label="Scan Again" icon="camera-outline" onPress={chooseImage} />
            <ActionButton label="Add Manually" icon="create-outline" variant="filled" onPress={() => router.push("/athlete/log-meal" as never)} />
          </View>
        </AppCard>
      ) : null}

      {scan && !SCAN_ISSUE_MESSAGES[scan.status] ? (
        <>
          <AppCard>
            <Text style={styles.eyebrow}>We Found</Text>
            <Text style={styles.mealTitle}>{scan.suggestedMealName || "Meal"}</Text>
            {totals ? (
              <View style={styles.totalRow}>
                <Text style={styles.calories}>{Math.round(totals.calories)} kcal</Text>
                <StatusChip label="Review required" tone="warning" />
              </View>
            ) : null}
            {totals ? (
              <View style={styles.macroRow}>
                <Macro label="Protein" value={totals.proteinG} />
                <Macro label="Carbs" value={totals.carbsG} />
                <Macro label="Fat" value={totals.fatG} />
              </View>
            ) : null}
          </AppCard>

          <AppCard>
            <Text style={styles.cardTitle}>Detected Foods</Text>
            <Text style={styles.reviewHint}>Edit anything that&rsquo;s wrong, remove items that aren&rsquo;t yours, or add ones we missed.</Text>
            {items.length ? (
              items.map((item, index) => (
                <View key={item.key}>
                  <EditableFoodRow item={item} onChange={(patch) => updateItem(item.key, patch)} onRemove={() => removeItem(item.key)} />
                  {index < items.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))
            ) : (
              <EmptyState title="No foods left" body="Add at least one food item before saving." icon="camera-reverse-outline" />
            )}
            <Pressable onPress={addItem} style={styles.addRow} hitSlop={8}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.addRowText}>Add missing item</Text>
            </Pressable>
          </AppCard>

          <AppCard>
            <Text style={styles.cardTitle}>Review</Text>
            <Text style={styles.reviewBody}>Nothing is saved until you confirm below.</Text>
            <ProgressBar value={(scan.overallConfidence ?? 0) / 100} />
            <View style={styles.actionRow}>
              <ActionButton label="Rescan" icon="camera-outline" onPress={chooseImage} />
              <ActionButton label={busy === "save" ? "Saving..." : "Confirm & Save"} icon="checkmark-outline" variant="filled" onPress={saveMeal} disabled={busy === "save"} />
            </View>
          </AppCard>
        </>
      ) : null}
    </ScreenContainer>
  );
}

function confidenceLabel(value: number): string {
  if (value >= 0.8) return "High";
  if (value >= 0.5) return "Medium";
  return "Low";
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroValue}>{Math.round(value)} g</Text>
      <Text style={styles.macroLabel}>{titleCase(label)}</Text>
    </View>
  );
}

function EditableFoodRow({
  item,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.editRow}>
      <View style={styles.editNameRow}>
        <TextInput
          value={item.foodName}
          onChangeText={(value) => onChange({ foodName: value })}
          placeholder="Food name"
          placeholderTextColor={colors.inkFaint}
          style={styles.editNameInput}
        />
        <Pressable onPress={onRemove} hitSlop={10} style={styles.removeButton} accessibilityLabel={`Remove ${item.foodName || "item"}`}>
          <Ionicons name="trash-outline" size={18} color={colors.bad} />
        </Pressable>
      </View>
      <View style={styles.editFieldsRow}>
        <MiniField label="Qty" value={item.quantity} onChangeText={(value) => onChange({ quantity: value })} width={44} />
        <MiniField label="Unit" value={item.unit} onChangeText={(value) => onChange({ unit: value })} width={70} keyboardType="default" />
        <MiniField label="Kcal" value={item.calories} onChangeText={(value) => onChange({ calories: value })} width={56} />
        <MiniField label="Protein" value={item.proteinG} onChangeText={(value) => onChange({ proteinG: value })} width={52} />
        <MiniField label="Carbs" value={item.carbsG} onChangeText={(value) => onChange({ carbsG: value })} width={52} />
        <MiniField label="Fat" value={item.fatG} onChangeText={(value) => onChange({ fatG: value })} width={48} />
      </View>
      {item.confidence != null ? <Text style={styles.confidence}>{confidenceLabel(item.confidence)} confidence</Text> : null}
    </View>
  );
}

function MiniField({
  label,
  value,
  onChangeText,
  width,
  keyboardType = "numeric",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  width: number;
  keyboardType?: "default" | "numeric";
}) {
  return (
    <View style={{ width }}>
      <Text style={styles.miniFieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={styles.miniFieldInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: { height: 42, width: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  headerTitle: { flex: 1, color: colors.ink, fontSize: 28, lineHeight: 35, fontWeight: "900" },
  pickCard: { alignItems: "center", gap: 12, paddingVertical: 28 },
  pickTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  pickBody: { color: colors.inkMuted, textAlign: "center", fontSize: 15, lineHeight: 21 },
  errorCard: { backgroundColor: colors.badSoft, borderColor: "#fecaca" },
  errorText: { color: colors.bad, fontSize: 15, fontWeight: "800" },
  issueCard: { alignItems: "center", gap: 10, paddingVertical: 28 },
  issueTitle: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  issueBody: { color: colors.inkMuted, textAlign: "center", fontSize: 15, lineHeight: 21 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: "900", textTransform: "uppercase" },
  mealTitle: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: "900", marginTop: 6 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14 },
  calories: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  macroRow: { flexDirection: "row", gap: 12, marginTop: 18 },
  macro: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceInset },
  macroValue: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  macroLabel: { color: colors.inkMuted, fontSize: 13, marginTop: 3 },
  cardTitle: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: "900" },
  reviewHint: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  editRow: { paddingVertical: 12, gap: 10 },
  editNameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  editNameInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 12,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  removeButton: { height: 36, width: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.badSoft },
  editFieldsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  miniFieldLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", marginBottom: 4 },
  miniFieldInput: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  confidence: { color: colors.inkMuted, fontSize: 12 },
  divider: { height: 1, backgroundColor: colors.line },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  addRowText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  reviewBody: { color: colors.inkMuted, fontSize: 15, lineHeight: 21, marginVertical: 12 },
  actionRow: { flexDirection: "row", gap: 12, marginTop: 16 },
});
