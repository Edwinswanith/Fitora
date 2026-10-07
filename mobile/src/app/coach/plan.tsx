import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AlertBanner,
  AppCard,
  EmptyState,
  ErrorState,
  LoadingState,
  PrimaryAppBar,
  RowLink,
  ScreenContainer,
  SectionHeader,
  SegmentedControl,
} from "../../components/fitora";
import { apiFetch } from "../../lib/api";
import { planVisual, workoutVisual, type FitoraIconName, type FitoraTone } from "../../lib/fitoraIcons";
import { colors } from "../../lib/theme";
import { addDays, loadCoachPlanData, titleCase, todayKey, useAsyncData, type CoachPlanData } from "../../lib/fitoraData";

type Tab = "assignments" | "templates" | "routines";
type PlanMode = "workout" | "tasks" | "meal" | "routine";

const PLAN_MODES: PlanMode[] = ["workout", "tasks", "meal", "routine"];

export default function CoachPlan() {
  const params = useLocalSearchParams<{ athleteId?: string; mode?: string }>();
  const initialAthleteId = typeof params.athleteId === "string" ? params.athleteId : undefined;
  const initialMode = PLAN_MODES.includes(params.mode as PlanMode) ? (params.mode as PlanMode) : null;
  const state = useAsyncData(loadCoachPlanData, [], "coach-plan");
  const [tab, setTab] = useState<Tab>("assignments");
  const [mode, setMode] = useState<PlanMode | null>(initialMode);

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
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <PrimaryAppBar title="Plan" showNotifications={false} actionLabel="+ New" onAction={() => setMode("routine")} />
      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "assignments", label: "Assignments", icon: "clipboard-outline" },
          { value: "templates", label: "Templates", icon: "document-text-outline" },
          { value: "routines", label: "Routines", icon: "repeat-outline" },
        ]}
      />
      {mode ? (
        <PlanComposer data={state.data} mode={mode} onModeChange={setMode} onDone={state.reload} initialAthleteId={initialAthleteId} />
      ) : null}
      {tab === "assignments" ? <Assignments data={state.data} openMode={setMode} showTemplates={() => setTab("templates")} /> : null}
      {tab === "templates" ? <Templates data={state.data} openMode={setMode} /> : null}
      {tab === "routines" ? <Routines data={state.data} openMode={setMode} /> : null}
      {state.data.partialIssues.length ? (
        <AlertBanner
          tone="primary"
          title="Some plan data is unavailable"
          body={`${state.data.partialIssues.slice(0, 3).join(", ")} - pull to refresh to retry.`}
        />
      ) : null}
    </ScreenContainer>
  );
}

function Assignments({
  data,
  openMode,
  showTemplates,
}: {
  data: CoachPlanData;
  openMode: (mode: PlanMode) => void;
  showTemplates: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; clients: number; completed: number }>();
    for (const card of data.cards) {
      for (const session of Object.values(card.sessions ?? {})) {
        if (!session?.status) continue;
        const label = session.workoutType || session.type || "Training";
        const row = map.get(label) ?? { label, clients: 0, completed: 0 };
        row.clients += 1;
        if (session.status === "completed") row.completed += 1;
        map.set(label, row);
      }
    }
    return Array.from(map.values());
  }, [data.cards]);
  const planningGaps = useMemo(() => data.routineStatus.filter((status) => !status.workoutName && !status.dataUnavailable), [data.routineStatus]);

  return (
    <>
      <View style={styles.quickCreate}>
        <ActionButton label="Workout" icon="barbell-outline" onPress={() => openMode("workout")} style={styles.quickButton} textStyle={styles.quickButtonText} />
        <ActionButton label="Tasks" icon="checkbox-outline" onPress={() => openMode("tasks")} style={styles.quickButton} textStyle={styles.quickButtonText} />
        <ActionButton label="Meal Plan" icon="restaurant-outline" onPress={() => openMode("meal")} style={styles.quickButton} textStyle={styles.quickButtonText} />
      </View>
      <ActionButton label="New Plan" icon="add-outline" variant="filled" onPress={() => openMode("routine")} />

      <SectionHeader title="Today" />
      <AppCard>
        {groups.length ? (
          groups.map((group, index) => {
            const visual = planVisual(group.label);
            return (
              <View key={group.label}>
                <PlanRow
                  icon={visual.icon}
                  tone={visual.tone}
                  title={titleCase(group.label)}
                  subtitle={`${group.clients} client${group.clients === 1 ? "" : "s"}`}
                  value={`${group.completed} completed`}
                  progress={group.clients ? group.completed / group.clients : 0}
                />
                {index < groups.length - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <EmptyState title="No assignments today" body="Assigned workouts and tasks will show here after clients have plans." icon="clipboard-outline" />
        )}
      </AppCard>

      <SectionHeader title="Tomorrow" />
      <AppCard>
        {data.tomorrowWorkouts.length ? (
          data.tomorrowWorkouts.slice(0, 4).map((assignment, index) => {
            const visual = workoutVisual(assignment.name);
            return (
              <View key={assignment.id}>
                <PlanRow
                  icon={visual.icon}
                  tone={visual.tone}
                  title={assignment.name}
                  subtitle={assignment.athleteName}
                  value={titleCase(assignment.status)}
                  progress={assignment.progressPercent / 100}
                />
                {index < Math.min(data.tomorrowWorkouts.length, 4) - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <EmptyState title="No assignments tomorrow" body="Assign routines to keep client plans complete." icon="calendar-outline" />
        )}
      </AppCard>

      {planningGaps.length ? (
        <AlertBanner
          title="Planning gaps"
          body={`${planningGaps.length} client${planningGaps.length === 1 ? "" : "s"} - ${planningGaps.map((status) => status.athleteName).join(", ")} - ${planningGaps.length === 1 ? "has" : "have"} no workout assigned today.`}
          action="Review"
          onPress={() => openMode("routine")}
        />
      ) : data.roster.length ? (
        <AlertBanner tone="primary" title="No planning gaps" body="Every client has a workout assigned today." />
      ) : null}

      <SectionHeader title="Templates" action={data.templates.length ? "View Templates" : undefined} onAction={showTemplates} />
      <AppCard>
        {data.templates.length ? (
          data.templates.slice(0, 3).map((template, index) => {
            const visual = workoutVisual(template.name);
            return (
              <View key={template.id}>
                <PlanRow
                  icon={visual.icon}
                  tone={visual.tone}
                  title={template.name}
                  subtitle={`${Array.isArray(template.exercises) ? template.exercises.length : 0} exercises${template.estimatedDurationMin ? ` - ${template.estimatedDurationMin} min` : ""}`}
                />
                {index < Math.min(data.templates.length, 3) - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <Text style={styles.muted}>No workout templates yet.</Text>
        )}
      </AppCard>

      <SectionHeader title="Upcoming Routines" />
      <AppCard>
        {data.routineStatus.length ? (
          data.routineStatus.slice(0, 2).map((status, index) => {
            const visual = planVisual("routine");
            return (
              <View key={status.athleteId}>
                <PlanRow icon={visual.icon} tone={visual.tone} title={status.athleteName} subtitle={routineStatusSubtitle(status)} />
                {index < Math.min(data.routineStatus.length, 2) - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <EmptyState title="No clients yet" body="Routines will show after clients are assigned." icon="repeat-outline" />
        )}
      </AppCard>
    </>
  );
}

function Templates({ data, openMode }: { data: CoachPlanData; openMode: (mode: PlanMode) => void }) {
  return (
    <>
      <View style={styles.quickCreate}>
        <ActionButton label="New Workout" icon="barbell-outline" onPress={() => openMode("workout")} />
        <ActionButton label="New Meal Plan" icon="restaurant-outline" onPress={() => openMode("meal")} />
      </View>
      <SectionHeader title="Workout Templates" />
      <AppCard>
        {data.templates.length ? (
          data.templates.map((template, index) => {
            const visual = workoutVisual(template.name);
            return (
              <View key={template.id}>
                <PlanRow
                  icon={visual.icon}
                  tone={visual.tone}
                  title={template.name}
                  subtitle={`${Array.isArray(template.exercises) ? template.exercises.length : 0} exercises${template.estimatedDurationMin ? ` - ${template.estimatedDurationMin} min` : ""}`}
                />
                {index < data.templates.length - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <EmptyState title="No templates" body="Create reusable workouts to speed up assignments." icon="document-text-outline" />
        )}
      </AppCard>

      <SectionHeader title="Meal Plans" />
      <AppCard>
        {data.mealPlans.length ? (
          data.mealPlans.map((plan, index) => {
            const visual = planVisual(plan.name, "meal plan");
            return (
              <View key={plan.id}>
                <PlanRow icon={visual.icon} tone={visual.tone} title={plan.name} subtitle={`${plan.durationDays ?? 0} day meal template`} />
                {index < data.mealPlans.length - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <Text style={styles.muted}>No meal plan templates yet.</Text>
        )}
      </AppCard>
    </>
  );
}

function Routines({ data, openMode }: { data: CoachPlanData; openMode: (mode: PlanMode) => void }) {
  return (
    <>
      <ActionButton label="Assign Routine" icon="repeat-outline" variant="filled" onPress={() => openMode("routine")} />
      <AppCard>
        {data.routineStatus.length ? (
          data.routineStatus.map((status, index) => {
            const visual = planVisual("routine");
            return (
              <View key={status.athleteId}>
                <PlanRow icon={visual.icon} tone={visual.tone} title={status.athleteName} subtitle={routineStatusSubtitle(status)} />
                {index < data.routineStatus.length - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <EmptyState title="No routines" body="Add clients and assign routines to fill this view." icon="repeat-outline" />
        )}
      </AppCard>
    </>
  );
}

function routineStatusSubtitle(status: CoachPlanData["routineStatus"][number]): string {
  const parts: string[] = [];
  parts.push(status.workoutName ? `Workout: ${status.workoutName} (${titleCase(status.workoutStatus ?? "")})` : "No workout assigned today");
  parts.push(status.mealPlanName ? `Meal plan: ${status.mealPlanName}${status.mealPlanActive ? "" : " (inactive)"}` : "No meal plan assigned");
  return parts.join(" - ");
}

function PlanComposer({
  data,
  mode,
  onModeChange,
  onDone,
  initialAthleteId,
}: {
  data: CoachPlanData;
  mode: PlanMode;
  onModeChange: (mode: PlanMode | null) => void;
  onDone: () => void;
  initialAthleteId?: string;
}) {
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>(() => {
    const seedId = initialAthleteId && data.roster.some((athlete) => athlete.athleteId === initialAthleteId)
      ? initialAthleteId
      : data.roster[0]?.athleteId;
    return seedId ? [seedId] : [];
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(data.templates[0]?.id ?? "");
  const [selectedMealPlanId, setSelectedMealPlanId] = useState(data.mealPlans[0]?.id ?? "");
  const [scheduledDate, setScheduledDate] = useState(mode === "meal" ? todayKey() : addDays(todayKey(), 1));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTemplateId && data.templates[0]?.id) setSelectedTemplateId(data.templates[0].id);
    if (!selectedMealPlanId && data.mealPlans[0]?.id) setSelectedMealPlanId(data.mealPlans[0].id);
    if (!selectedAthleteIds.length && data.roster[0]?.athleteId) setSelectedAthleteIds([data.roster[0].athleteId]);
  }, [data.mealPlans, data.roster, data.templates, selectedAthleteIds.length, selectedMealPlanId, selectedTemplateId]);

  const title = mode === "tasks" ? "Assign Quick Tasks" : mode === "meal" ? "Assign Meal Plan" : mode === "routine" ? "Create Routine" : "Assign Workout";
  const needsWorkout = mode === "workout" || mode === "tasks" || mode === "routine";
  const needsMeal = mode === "meal" || mode === "routine";

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  }

  async function createDefaultWorkoutTemplate(kind: "workout" | "tasks") {
    const name = kind === "tasks" ? `Quick Tasks - ${shortDateLabel(scheduledDate)}` : `Full Body Strength - ${shortDateLabel(scheduledDate)}`;
    const exercises = kind === "tasks"
      ? [
          { title: "Complete readiness check-in", type: "checklist" },
          { title: "Log meals and water", type: "checklist" },
          { title: "Watch assigned coaching video", type: "checklist" },
        ]
      : [
          { title: "Goblet Squat", type: "sets_reps", sets: 3, reps: "10" },
          { title: "Push-ups", type: "sets_reps", sets: 3, reps: "12" },
          { title: "Lat Pulldown", type: "sets_reps", sets: 3, reps: "10" },
          { title: "Plank", type: "duration", durationSec: 45 },
        ];
    const res = await apiFetch("/api/workout-templates", {
      method: "POST",
      body: JSON.stringify({ name, description: kind === "tasks" ? "Coach-assigned quick task checklist." : "Default Fitora workout created from mobile.", exercises }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.template?.id) throw new Error(json.error || "template_failed");
    return String(json.template.id);
  }

  async function createDefaultMealPlan() {
    const res = await apiFetch("/api/coach/meal-plans", {
      method: "POST",
      body: JSON.stringify({
        name: `Balanced 7-Day Plan - ${shortDateLabel(scheduledDate)}`,
        description: "Default Fitora meal plan created from mobile.",
        durationDays: 7,
        days: [
          {
            dayIndex: 0,
            meals: [
              {
                mealType: "breakfast",
                name: "Oats, eggs, and fruit",
                foods: [{ name: "Oats + eggs", quantity: 1, unit: "meal", calories: 480, proteinG: 28, carbsG: 52, fatG: 16 }],
              },
              {
                mealType: "lunch",
                name: "Chicken rice bowl",
                foods: [{ name: "Chicken rice bowl", quantity: 1, unit: "bowl", calories: 650, proteinG: 44, carbsG: 64, fatG: 18 }],
              },
              {
                mealType: "dinner",
                name: "Grilled protein and vegetables",
                foods: [{ name: "Protein + vegetables", quantity: 1, unit: "plate", calories: 580, proteinG: 36, carbsG: 42, fatG: 20 }],
              },
            ],
          },
        ],
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.mealPlan?.id) throw new Error(json.error || "meal_plan_failed");
    return String(json.mealPlan.id);
  }

  async function submit() {
    setMessage(null);
    if (!selectedAthleteIds.length) {
      setMessage("Select at least one client.");
      return;
    }
    setSaving(true);
    try {
      let assignedWorkouts = 0;
      let assignedMeals = 0;
      if (needsWorkout) {
        const templateId = mode === "tasks"
          ? await createDefaultWorkoutTemplate("tasks")
          : selectedTemplateId || await createDefaultWorkoutTemplate("workout");
        const res = await apiFetch("/api/coach/workout-assignments/bulk", {
          method: "POST",
          body: JSON.stringify({ templateId, athleteIds: selectedAthleteIds, scheduledDate }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 207) throw new Error(json.error || "workout_assign_failed");
        assignedWorkouts = Array.isArray(json.results) ? json.results.filter((item: { ok?: boolean }) => item.ok).length : 0;
      }
      if (needsMeal) {
        const mealPlanId = selectedMealPlanId || await createDefaultMealPlan();
        const results = await Promise.all(
          selectedAthleteIds.map(async (athleteId) => {
            const res = await apiFetch(`/api/coach/athletes/${athleteId}/meal-plan-assignments`, {
              method: "POST",
              body: JSON.stringify({ mealPlanId, startDate: scheduledDate }),
            });
            return res.ok;
          })
        );
        assignedMeals = results.filter(Boolean).length;
      }
      const parts = [];
      if (needsWorkout) parts.push(`${assignedWorkouts} workout${assignedWorkouts === 1 ? "" : "s"}`);
      if (needsMeal) parts.push(`${assignedMeals} meal plan${assignedMeals === 1 ? "" : "s"}`);
      setMessage(`Assigned ${parts.join(" and ")}.`);
      onDone();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppCard style={styles.composer}>
      <View style={styles.composerHeader}>
        <Text style={styles.composerTitle}>{title}</Text>
        <Pressable onPress={() => onModeChange(null)} hitSlop={10}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <View style={styles.modeRow}>
        {(["workout", "tasks", "meal", "routine"] as PlanMode[]).map((item) => (
          <Pressable key={item} onPress={() => onModeChange(item)} style={[styles.choiceChip, mode === item ? styles.choiceChipActive : null]}>
            <Text style={[styles.choiceText, mode === item ? styles.choiceTextActive : null]}>{titleCase(item)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Date</Text>
      <View style={styles.modeRow}>
        {[todayKey(), addDays(todayKey(), 1), addDays(todayKey(), 2)].map((date) => (
          <Pressable key={date} onPress={() => setScheduledDate(date)} style={[styles.choiceChip, scheduledDate === date ? styles.choiceChipActive : null]}>
            <Text style={[styles.choiceText, scheduledDate === date ? styles.choiceTextActive : null]}>{date === todayKey() ? "Today" : date === addDays(todayKey(), 1) ? "Tomorrow" : shortDateLabel(date)}</Text>
          </Pressable>
        ))}
      </View>

      {needsWorkout && mode !== "tasks" ? (
        <>
          <Text style={styles.label}>Workout template</Text>
          <View style={styles.stack}>
            {data.templates.length ? (
              data.templates.map((template) => (
                <ChoiceRow
                  key={template.id}
                  selected={selectedTemplateId === template.id}
                  title={template.name}
                  subtitle={`${Array.isArray(template.exercises) ? template.exercises.length : 0} exercises`}
                  onPress={() => setSelectedTemplateId(template.id)}
                />
              ))
            ) : (
              <Text style={styles.muted}>No templates yet. Fitora will create a starter workout.</Text>
            )}
          </View>
        </>
      ) : null}

      {needsMeal ? (
        <>
          <Text style={styles.label}>Meal plan</Text>
          <View style={styles.stack}>
            {data.mealPlans.length ? (
              data.mealPlans.map((plan) => (
                <ChoiceRow
                  key={plan.id}
                  selected={selectedMealPlanId === plan.id}
                  title={plan.name}
                  subtitle={`${plan.durationDays ?? 7} days`}
                  onPress={() => setSelectedMealPlanId(plan.id)}
                />
              ))
            ) : (
              <Text style={styles.muted}>No meal templates yet. Fitora will create a balanced starter plan.</Text>
            )}
          </View>
        </>
      ) : null}

      <Text style={styles.label}>Clients</Text>
      <View style={styles.stack}>
        {data.roster.map((client) => (
          <ChoiceRow
            key={client.athleteId}
            multi
            selected={selectedAthleteIds.includes(client.athleteId)}
            title={client.name}
            subtitle={client.sport || "Client"}
            onPress={() => toggleAthlete(client.athleteId)}
          />
        ))}
      </View>

      {message ? <Text style={message.startsWith("Assigned") ? styles.successText : styles.errorText}>{message}</Text> : null}
      <Pressable onPress={submit} disabled={saving || !data.roster.length} style={[styles.submitButton, saving || !data.roster.length ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Assign</Text>}
      </Pressable>
    </AppCard>
  );
}

/**
 * `multi` swaps the indicator from a round radio (implying only one choice
 * can be active, as with template/meal-plan pickers) to a square checkbox
 * (implying several can be active at once, as with the client picker) — the
 * indicator shape communicates the real selection behavior instead of
 * contradicting it.
 */
function ChoiceRow({ selected, title, subtitle, onPress, multi }: { selected: boolean; title: string; subtitle?: string; onPress: () => void; multi?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.choiceRow, selected ? styles.choiceRowActive : null]}>
      {multi ? (
        <View style={[styles.checkbox, selected ? styles.checkboxOn : null]}>
          {selected ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
        </View>
      ) : (
        <View style={[styles.radio, selected ? styles.radioOn : null]} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.choiceTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.choiceSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

function shortDateLabel(key: string) {
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

function errorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : "action_failed";
  if (raw === "slot_already_assigned") return "A workout already exists for one selected client/date.";
  if (raw === "nutrition_not_included") return "One selected client does not include nutrition in their membership.";
  return "Could not complete this action. Check the selected clients and try again.";
}

function PlanRow({
  icon,
  title,
  subtitle,
  value,
  progress,
  tone = "primary",
}: {
  icon: FitoraIconName;
  title: string;
  subtitle?: string;
  value?: string;
  progress?: number;
  tone?: FitoraTone;
}) {
  return (
    <RowLink
      icon={icon}
      tone={tone}
      title={title}
      subtitle={subtitle}
      value={value}
      progress={progress}
    />
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  quickCreate: { flexDirection: "row", gap: 12 },
  quickButton: { paddingHorizontal: 8 },
  quickButtonText: { fontSize: 13 },
  composer: { gap: 9, borderColor: colors.primary },
  composerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  composerTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "900" },
  closeText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  label: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "uppercase" },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  choiceChip: { minHeight: 32, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  choiceChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  choiceTextActive: { color: colors.primary },
  stack: { gap: 6 },
  choiceRow: { minHeight: 45, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 9 },
  choiceRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: { width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: colors.inkFaint },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: colors.inkFaint, alignItems: "center", justifyContent: "center" },
  checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  choiceTitle: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  choiceSub: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  submitButton: { minHeight: 42, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  successText: { color: colors.ok, fontSize: 12, fontWeight: "800" },
  errorText: { color: colors.bad, fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  muted: { color: colors.inkMuted, fontSize: 15, lineHeight: 21 },
  divider: { height: 1, backgroundColor: colors.line },
});
