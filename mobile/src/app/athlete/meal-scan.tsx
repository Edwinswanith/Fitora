import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
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
import { colors } from "../../lib/theme";
import { todayKey, titleCase } from "../../lib/fitoraData";

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

export default function MealScanScreen() {
  const router = useRouter();
  const [scan, setScan] = useState<MealScan | null>(null);
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const totals = useMemo(() => {
    if (!scan) return null;
    return scan.items.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories,
        proteinG: acc.proteinG + item.proteinG,
        carbsG: acc.carbsG + item.carbsG,
        fatG: acc.fatG + item.fatG,
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );
  }, [scan]);

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
    form.append("file", {
      uri: asset.uri,
      name: asset.name || "meal.jpg",
      type: asset.mimeType || "image/jpeg",
    } as unknown as Blob);
    setBusy("upload");
    try {
      const res = await apiFetch("/api/athlete/nutrition/meal-scan", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { scan?: MealScan; error?: string };
      if (!res.ok || !body.scan) {
        setError(body.error ?? "Could not analyze this meal.");
        return;
      }
      setScan(body.scan);
    } catch {
      setError("Network failed while uploading the meal image.");
    } finally {
      setBusy(null);
    }
  }

  async function saveMeal() {
    if (!scan) return;
    setBusy("save");
    setError(null);
    const foods = scan.items.map((item) => ({
      name: item.foodName,
      quantity: item.quantity,
      unit: item.unit,
      calories: item.calories,
      proteinG: item.proteinG,
      carbsG: item.carbsG,
      fatG: item.fatG,
      fiberG: item.fiberG ?? undefined,
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
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not save this meal.");
        return;
      }
      router.replace({ pathname: "/athlete/dashboard", params: { section: "nutrition" } } as never);
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

      {scan ? (
        <>
          <AppCard>
            <Text style={styles.eyebrow}>We Found</Text>
            <Text style={styles.mealTitle}>{scan.suggestedMealName || "Meal"}</Text>
            {totals ? (
              <View style={styles.totalRow}>
                <Text style={styles.calories}>{Math.round(totals.calories)} kcal</Text>
                <StatusChip label={scan.status === "confirmed" ? "Saved" : "Review required"} tone={scan.status === "confirmed" ? "success" : "warning"} />
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
            {scan.items.length ? (
              scan.items.map((item, index) => (
                <View key={`${item.foodName}-${index}`}>
                  <View style={styles.foodRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.foodName}>{item.foodName}</Text>
                      <Text style={styles.foodMeta}>{item.quantity} {item.unit}</Text>
                    </View>
                    <View style={styles.confidenceBlock}>
                      <Text style={styles.foodKcal}>{Math.round(item.calories)} kcal</Text>
                      <Text style={styles.confidence}>{confidenceLabel(item.foodConfidence)} confidence</Text>
                    </View>
                  </View>
                  {index < scan.items.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))
            ) : (
              <EmptyState title="No foods detected" body="Try another image with better lighting." icon="camera-reverse-outline" />
            )}
          </AppCard>

          <AppCard>
            <Text style={styles.cardTitle}>Review</Text>
            <Text style={styles.reviewBody}>AI results are not saved automatically. Edit support can be added on top of this review step, but saving remains explicit.</Text>
            <ProgressBar value={(scan.overallConfidence ?? 0) / 100} />
            <View style={styles.actionRow}>
              <ActionButton label="Rescan" icon="camera-outline" onPress={chooseImage} />
              <ActionButton label={busy === "save" ? "Saving..." : "Save Meal"} icon="checkmark-outline" variant="filled" onPress={saveMeal} />
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

const styles = StyleSheet.create({
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: { height: 42, width: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  headerTitle: { flex: 1, color: colors.ink, fontSize: 28, lineHeight: 35, fontWeight: "900" },
  pickCard: { alignItems: "center", gap: 12, paddingVertical: 28 },
  pickTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  pickBody: { color: colors.inkMuted, textAlign: "center", fontSize: 15, lineHeight: 21 },
  errorCard: { backgroundColor: colors.badSoft, borderColor: "#fecaca" },
  errorText: { color: colors.bad, fontSize: 15, fontWeight: "800" },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: "900", textTransform: "uppercase" },
  mealTitle: { color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: "900", marginTop: 6 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14 },
  calories: { color: colors.ink, fontSize: 24, fontWeight: "900" },
  macroRow: { flexDirection: "row", gap: 12, marginTop: 18 },
  macro: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceInset },
  macroValue: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  macroLabel: { color: colors.inkMuted, fontSize: 13, marginTop: 3 },
  cardTitle: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: "900" },
  foodRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 12 },
  foodName: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  foodMeta: { color: colors.inkMuted, fontSize: 14, marginTop: 3 },
  confidenceBlock: { alignItems: "flex-end" },
  foodKcal: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  confidence: { color: colors.inkMuted, fontSize: 12, marginTop: 3 },
  divider: { height: 1, backgroundColor: colors.line },
  reviewBody: { color: colors.inkMuted, fontSize: 15, lineHeight: 21, marginVertical: 12 },
  actionRow: { flexDirection: "row", gap: 12, marginTop: 16 },
});
