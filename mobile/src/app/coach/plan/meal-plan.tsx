import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "../../../components/AppText";
import { AlertBanner, ErrorState, LoadingState, StatusChip } from "../../../components/fitora";
import {
  Chip,
  ChipRow,
  EditorHeader,
  EditorScreen,
  ErrorList,
  Field,
  FieldLabel,
  IconButton,
  PrimaryButton,
  editorStyles,
} from "../../../components/planEditor";
import { requestJson } from "../../../lib/planApi";
import { celebrate, errorFeedback } from "../../../lib/feedback";
import {
  MEAL_LIMITS,
  MEAL_PLAN_DURATIONS,
  MEAL_TYPES,
  copyDay,
  dayCalories,
  describeServerError,
  emptyDay,
  emptyFood,
  emptyMeal,
  emptyMealPlanDraft,
  markPlanLibraryDirty,
  mealPlanToDraft,
  nextFreeDayIndex,
  validateMealPlanDraft,
  type DayDraft,
  type FoodDraft,
  type MealDraft,
  type MealPlanDraft,
  type MealPlanDuration,
  type MealPlanPayload,
  type MealType,
  type ServerMealPlan,
} from "../../../lib/planBuilder";

const MEAL_TYPE_LABELS: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export default function MealPlanEditor() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mealPlanId?: string }>();
  const mealPlanId = typeof params.mealPlanId === "string" && params.mealPlanId ? params.mealPlanId : null;

  const [draft, setDraft] = useState<MealPlanDraft | null>(mealPlanId ? null : emptyMealPlanDraft());
  const [original, setOriginal] = useState<ServerMealPlan | null>(null);
  const [loading, setLoading] = useState(Boolean(mealPlanId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!mealPlanId) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    requestJson<{ mealPlan: ServerMealPlan }>(`/api/coach/meal-plans/${mealPlanId}`).then((res) => {
      if (!active) return;
      if (res.ok && res.body?.mealPlan) {
        const next = mealPlanToDraft(res.body.mealPlan);
        setOriginal(res.body.mealPlan);
        setDraft(next);
        // Long plans start collapsed past the first day so the screen stays scannable.
        setCollapsed(new Set(next.days.slice(1).map((d) => d.key)));
      } else {
        setLoadError(describeServerError(res.body?.error, res.status));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [mealPlanId, loadVersion]);

  const originalPayload = useMemo(() => {
    if (!original) return null;
    const result = validateMealPlanDraft(mealPlanToDraft(original));
    return result.ok ? result.payload : null;
  }, [original]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/coach/plan" as never);
  }, [router]);

  const updateDay = useCallback((key: string, updater: (day: DayDraft) => DayDraft) => {
    setDraft((current) => current && { ...current, days: current.days.map((d) => (d.key === key ? updater(d) : d)) });
  }, []);

  if (loading) {
    return (
      <EditorScreen>
        <EditorHeader title="Edit meal plan" onBack={goBack} />
        <LoadingState label="Loading meal plan..." />
      </EditorScreen>
    );
  }
  if (loadError || !draft) {
    return (
      <EditorScreen>
        <EditorHeader title="Edit meal plan" onBack={goBack} />
        <ErrorState message={loadError ?? "Meal plan not available."} onRetry={() => setLoadVersion((v) => v + 1)} />
      </EditorScreen>
    );
  }

  const isEdit = Boolean(mealPlanId && original);
  const isArchived = Boolean(original?.isArchived);
  const maxDayIndex = draft.days.reduce((m, d) => Math.max(m, d.dayIndex), -1);
  const sortedDays = draft.days.slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const canAddDay = nextFreeDayIndex(draft.days, draft.durationDays) !== null;

  function setDuration(durationDays: MealPlanDuration) {
    setDraft((current) => current && { ...current, durationDays });
  }

  function addDay() {
    setDraft((current) => {
      if (!current) return current;
      const last = current.days.reduce((m, d) => Math.max(m, d.dayIndex), -1);
      const index = nextFreeDayIndex(current.days, current.durationDays, last);
      if (index === null) return current;
      return { ...current, days: [...current.days, emptyDay(index)] };
    });
  }

  function duplicateDay(day: DayDraft) {
    setDraft((current) => {
      if (!current) return current;
      const index = nextFreeDayIndex(current.days, current.durationDays, day.dayIndex);
      if (index === null) return current;
      return { ...current, days: [...current.days, copyDay(day, index)] };
    });
  }

  function removeDay(key: string) {
    setDraft((current) => current && { ...current, days: current.days.filter((d) => d.key !== key) });
  }

  function shiftDay(day: DayDraft, delta: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const used = new Set(current.days.filter((d) => d.key !== day.key).map((d) => d.dayIndex));
      let index = day.dayIndex + delta;
      while (index >= 0 && index < current.durationDays && used.has(index)) index += delta;
      if (index < 0 || index >= current.durationDays) return current;
      return { ...current, days: current.days.map((d) => (d.key === day.key ? { ...d, dayIndex: index } : d)) };
    });
  }

  function toggleCollapsed(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    const result = validateMealPlanDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setSaving(true);
    let body: Partial<MealPlanPayload> = result.payload;
    if (isEdit) {
      // durationDays is fixed after creation (the server ignores it on PATCH),
      // and days are only sent when changed because each days edit bumps the version.
      body = { name: result.payload.name, description: result.payload.description };
      if (!originalPayload || JSON.stringify(originalPayload.days) !== JSON.stringify(result.payload.days)) body.days = result.payload.days;
    }
    const res = await requestJson<{ mealPlan: ServerMealPlan }>(
      isEdit ? `/api/coach/meal-plans/${mealPlanId}` : "/api/coach/meal-plans",
      { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(body) }
    );
    setSaving(false);
    if (!res.ok || !res.body?.mealPlan) {
      errorFeedback();
      setErrors([describeServerError(res.body?.error, res.status)]);
      return;
    }
    markPlanLibraryDirty();
    celebrate({ title: isEdit ? "Meal plan updated" : "Meal plan created" });
    goBack();
  }

  async function toggleArchive() {
    if (!mealPlanId) return;
    setArchiving(true);
    const res = await requestJson<{ mealPlan: ServerMealPlan }>(
      `/api/coach/meal-plans/${mealPlanId}/${isArchived ? "unarchive" : "archive"}`,
      { method: "POST" }
    );
    setArchiving(false);
    if (!res.ok || !res.body?.mealPlan) {
      errorFeedback();
      setErrors([describeServerError(res.body?.error, res.status)]);
      return;
    }
    markPlanLibraryDirty();
    if (isArchived) setOriginal(res.body.mealPlan);
    else goBack();
  }

  return (
    <EditorScreen>
      <EditorHeader
        title={isEdit ? "Edit meal plan" : "New meal plan"}
        subtitle={
          isEdit
            ? "Saving day changes creates a new version. Plans you already assigned keep their original copy."
            : "Fill as many days as you need - days you leave out simply have no planned meals."
        }
        onBack={goBack}
      />
      {isEdit ? (
        <View style={editorStyles.row}>
          <StatusChip label={`Version ${original?.version ?? 1}`} tone="primary" />
          {isArchived ? <StatusChip label="Archived" tone="warning" /> : null}
        </View>
      ) : null}

      <View style={editorStyles.card}>
        <Field label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="e.g. Lean bulk - week 1" maxLength={MEAL_LIMITS.nameMax} />
        <Field
          label="Description (optional)"
          value={draft.description}
          onChange={(description) => setDraft({ ...draft, description })}
          placeholder="Goal, macro focus, prep notes"
          multiline
          maxLength={MEAL_LIMITS.descriptionMax}
        />
        <View style={{ gap: 4 }}>
          <FieldLabel>Plan length</FieldLabel>
          <ChipRow>
            {MEAL_PLAN_DURATIONS.map((d) => (
              <Chip
                key={d}
                label={d === 1 ? "1 day" : `${d} days`}
                selected={draft.durationDays === d}
                onPress={() => setDuration(d)}
                disabled={isEdit || maxDayIndex >= d || draft.days.length > d}
              />
            ))}
          </ChipRow>
          <Text style={editorStyles.muted}>
            {isEdit
              ? "Plan length can't change after creation. Create a new plan for a different length."
              : "Assigning starts Day 1 on the date you pick. Shorter lengths are disabled while later days are filled."}
          </Text>
        </View>
      </View>

      <Text style={editorStyles.sectionTitle}>
        Days ({draft.days.length} of {draft.durationDays} filled)
      </Text>
      {draft.days.length === 0 ? <AlertBanner tone="primary" title="No days yet" body="Add at least one day to save this plan." /> : null}

      {sortedDays.map((day) => (
        <DayCard
          key={day.key}
          day={day}
          durationDays={draft.durationDays}
          canDuplicate={canAddDay}
          collapsed={collapsed.has(day.key)}
          onToggle={() => toggleCollapsed(day.key)}
          onShift={(delta) => shiftDay(day, delta)}
          onDuplicate={() => duplicateDay(day)}
          onRemove={() => removeDay(day.key)}
          onChange={(updater) => updateDay(day.key, updater)}
        />
      ))}

      <PrimaryButton label={canAddDay ? "+ Add day" : "All days filled"} tone="outline" onPress={addDay} disabled={!canAddDay} />

      <ErrorList title="Fix these before saving" errors={errors} />
      <PrimaryButton label={isEdit ? "Save changes" : "Create meal plan"} onPress={save} busy={saving} disabled={archiving} />
      {isEdit ? (
        <PrimaryButton
          label={archiving ? "Working..." : isArchived ? "Restore meal plan" : "Archive meal plan"}
          tone={isArchived ? "outline" : "danger"}
          onPress={toggleArchive}
          disabled={saving || archiving}
        />
      ) : null}
      {isEdit && !isArchived ? (
        <Text style={editorStyles.muted}>Archiving hides it from your library and the assign picker. Existing assignments are not affected, and you can restore it later.</Text>
      ) : null}
    </EditorScreen>
  );
}

function DayCard({
  day,
  durationDays,
  canDuplicate,
  collapsed,
  onToggle,
  onShift,
  onDuplicate,
  onRemove,
  onChange,
}: {
  day: DayDraft;
  durationDays: number;
  canDuplicate: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onShift: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onChange: (updater: (day: DayDraft) => DayDraft) => void;
}) {
  const kcal = Math.round(dayCalories(day));
  const foodCount = day.meals.reduce((s, m) => s + m.foods.length, 0);

  function updateMeal(key: string, patch: (meal: MealDraft) => MealDraft) {
    onChange((d) => ({ ...d, meals: d.meals.map((m) => (m.key === key ? patch(m) : m)) }));
  }
  function addMeal() {
    onChange((d) => {
      const used = new Set(d.meals.map((m) => m.mealType));
      const type = MEAL_TYPES.find((t) => !used.has(t)) ?? "snack";
      return { ...d, meals: [...d.meals, emptyMeal(type)] };
    });
  }

  return (
    <View style={editorStyles.card}>
      <View style={editorStyles.cardHead}>
        <IconButton icon={collapsed ? "chevron-forward" : "chevron-down"} label={collapsed ? `Expand day ${day.dayIndex + 1}` : `Collapse day ${day.dayIndex + 1}`} onPress={onToggle} tone="primary" />
        <View style={editorStyles.flex1}>
          <Text style={editorStyles.cardTitle} numberOfLines={1}>Day {day.dayIndex + 1}</Text>
          <Text style={editorStyles.muted} numberOfLines={2}>
            {day.meals.length} meal{day.meals.length === 1 ? "" : "s"} - {foodCount} food{foodCount === 1 ? "" : "s"} - {kcal} kcal
          </Text>
        </View>
        <IconButton icon="remove" label={`Move day ${day.dayIndex + 1} earlier`} onPress={() => onShift(-1)} disabled={day.dayIndex === 0} />
        <IconButton icon="add" label={`Move day ${day.dayIndex + 1} later`} onPress={() => onShift(1)} disabled={day.dayIndex >= durationDays - 1} />
        <IconButton icon="copy-outline" label={`Copy day ${day.dayIndex + 1} to the next empty day`} onPress={onDuplicate} disabled={!canDuplicate} />
        <IconButton icon="trash-outline" label={`Remove day ${day.dayIndex + 1}`} onPress={onRemove} tone="danger" />
      </View>
      {collapsed ? null : (
        <>
          {day.meals.map((meal, mealIndex) => (
            <MealBlock
              key={meal.key}
              meal={meal}
              index={mealIndex}
              onChange={(patch) => updateMeal(meal.key, patch)}
              onRemove={() => onChange((d) => ({ ...d, meals: d.meals.filter((m) => m.key !== meal.key) }))}
            />
          ))}
          {day.meals.length === 0 ? <Text style={editorStyles.muted}>No meals yet - add one below.</Text> : null}
          <PrimaryButton
            label={day.meals.length >= MEAL_LIMITS.mealsPerDayMax ? `Max ${MEAL_LIMITS.mealsPerDayMax} meals per day` : "+ Add meal"}
            tone="outline"
            onPress={addMeal}
            disabled={day.meals.length >= MEAL_LIMITS.mealsPerDayMax}
          />
        </>
      )}
    </View>
  );
}

function MealBlock({
  meal,
  index,
  onChange,
  onRemove,
}: {
  meal: MealDraft;
  index: number;
  onChange: (patch: (meal: MealDraft) => MealDraft) => void;
  onRemove: () => void;
}) {
  function updateFood(key: string, patch: Partial<FoodDraft>) {
    onChange((m) => ({ ...m, foods: m.foods.map((f) => (f.key === key ? { ...f, ...patch } : f)) }));
  }
  return (
    <View style={styles.meal}>
      <View style={editorStyles.cardHead}>
        <Text style={editorStyles.cardTitle} numberOfLines={1}>
          Meal {index + 1}: {MEAL_TYPE_LABELS[meal.mealType]}
        </Text>
        <IconButton icon="trash-outline" label={`Remove meal ${index + 1}`} onPress={onRemove} tone="danger" />
      </View>
      <ChipRow>
        {MEAL_TYPES.map((type) => (
          <Chip key={type} label={MEAL_TYPE_LABELS[type]} selected={meal.mealType === type} onPress={() => onChange((m) => ({ ...m, mealType: type }))} />
        ))}
      </ChipRow>
      <Field
        label="Meal name (optional)"
        value={meal.name}
        onChange={(name) => onChange((m) => ({ ...m, name }))}
        placeholder="e.g. Chicken rice bowl"
        maxLength={MEAL_LIMITS.mealNameMax}
      />
      {meal.foods.map((food, foodIndex) => (
        <FoodBlock
          key={food.key}
          food={food}
          index={foodIndex}
          onChange={(patch) => updateFood(food.key, patch)}
          onRemove={() => onChange((m) => ({ ...m, foods: m.foods.filter((f) => f.key !== food.key) }))}
        />
      ))}
      <PrimaryButton
        label={meal.foods.length >= MEAL_LIMITS.foodsPerMealMax ? `Max ${MEAL_LIMITS.foodsPerMealMax} foods` : "+ Add food"}
        tone="outline"
        onPress={() => onChange((m) => ({ ...m, foods: [...m.foods, emptyFood()] }))}
        disabled={meal.foods.length >= MEAL_LIMITS.foodsPerMealMax}
      />
    </View>
  );
}

function decimalOnly(text: string) {
  const cleaned = text.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  return firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

function FoodBlock({ food, index, onChange, onRemove }: { food: FoodDraft; index: number; onChange: (patch: Partial<FoodDraft>) => void; onRemove: () => void }) {
  return (
    <View style={styles.food}>
      <View style={editorStyles.cardHead}>
        <Field
          style={editorStyles.flex1}
          value={food.name}
          onChange={(name) => onChange({ name })}
          placeholder={`Food ${index + 1}, e.g. Basmati rice`}
          accessibilityLabel={`Food ${index + 1} name`}
          maxLength={MEAL_LIMITS.foodNameMax}
          compact
        />
        <IconButton icon="close" label={`Remove food ${index + 1}`} onPress={onRemove} tone="danger" />
      </View>
      <View style={editorStyles.row}>
        <Field style={editorStyles.flex1} label="Qty" value={food.quantity} onChange={(quantity) => onChange({ quantity: decimalOnly(quantity) })} keyboardType="decimal-pad" placeholder="1" compact />
        <Field style={editorStyles.flex1} label="Unit" value={food.unit} onChange={(unit) => onChange({ unit })} placeholder="g, cup" maxLength={MEAL_LIMITS.unitMax} compact />
        <Field style={editorStyles.flex1} label="kcal" value={food.calories} onChange={(calories) => onChange({ calories: decimalOnly(calories) })} keyboardType="decimal-pad" placeholder="0" compact />
      </View>
      <View style={editorStyles.row}>
        <Field style={editorStyles.flex1} label="Protein g" value={food.proteinG} onChange={(proteinG) => onChange({ proteinG: decimalOnly(proteinG) })} keyboardType="decimal-pad" placeholder="0" compact />
        <Field style={editorStyles.flex1} label="Carbs g" value={food.carbsG} onChange={(carbsG) => onChange({ carbsG: decimalOnly(carbsG) })} keyboardType="decimal-pad" placeholder="0" compact />
        <Field style={editorStyles.flex1} label="Fat g" value={food.fatG} onChange={(fatG) => onChange({ fatG: decimalOnly(fatG) })} keyboardType="decimal-pad" placeholder="0" compact />
      </View>
      <Field
        label="Allergen tags (comma separated)"
        value={food.allergenTags}
        onChange={(allergenTags) => onChange({ allergenTags })}
        placeholder="e.g. peanuts, dairy"
        compact
      />
    </View>
  );
}

const styles = StyleSheet.create({
  meal: { gap: 8, borderTopWidth: 1, borderTopColor: "#e8f5f3", paddingTop: 10 },
  food: { gap: 6, borderRadius: 10, borderWidth: 1, borderColor: "#e8f5f3", backgroundColor: "#f8fdfc", padding: 8 },
});
