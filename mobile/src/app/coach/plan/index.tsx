import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../../components/AppText";
import {
  ActionButton,
  AlertBanner,
  AppCard,
  EmptyState,
  ErrorState,
  HeroCard,
  LoadingState,
  PrimaryAppBar,
  RowLink,
  ScreenContainer,
  SectionHeader,
  SectionLabel,
  SegmentedControl,
} from "../../../components/fitora";
import { requestJson } from "../../../lib/planApi";
import { celebrate, errorFeedback } from "../../../lib/feedback";
import {
  buildAssignOutcome,
  consumePlanLibraryDirty,
  describeServerError,
  exerciseSummary,
  isChecklistTemplate,
  summarizeMealAttempts,
  summarizeWorkoutBulk,
  type AssignOutcome,
  type AssignSection,
  type BulkWorkoutResult,
  type MealAssignAttempt,
  type ServerMealPlan,
  type ServerWorkoutTemplate,
} from "../../../lib/planBuilder";
import { planVisual, workoutVisual, type FitoraIconName, type FitoraTone } from "../../../lib/fitoraIcons";
import { colors } from "../../../lib/theme";
import { addDays, loadCoachPlanData, titleCase, todayKey, useAsyncData, type CoachPlanData } from "../../../lib/fitoraData";

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
  const nav = usePlanNavigation();
  const { reload } = state;

  // Editors live on this tab's stack; refetch when one saved/archived something.
  useFocusEffect(
    useCallback(() => {
      if (consumePlanLibraryDirty()) reload();
    }, [reload])
  );

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
        <PlanComposer data={state.data} mode={mode} onModeChange={setMode} onDone={state.reload} initialAthleteId={initialAthleteId} nav={nav} />
      ) : null}
      {tab === "assignments" ? <Assignments data={state.data} openMode={setMode} showTemplates={() => setTab("templates")} nav={nav} /> : null}
      {tab === "templates" ? <Library data={state.data} nav={nav} onChanged={state.reload} /> : null}
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
  nav,
}: {
  data: CoachPlanData;
  openMode: (mode: PlanMode) => void;
  showTemplates: () => void;
  nav: PlanNavigation;
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

  // Clients with nothing assigned are already named in the planning-gaps hero.
  const routinesWithPlans = data.routineStatus.filter((status) => status.workoutName || status.mealPlanName);
  return (
    <>
      {data.roster.length === 0 ? (
        <HeroCard
          calm
          icon="barbell-outline"
          eyebrow="Get ready"
          title="Build your first workout template"
          body="Templates are reusable plans. Once you add clients, you assign them in two taps."
          actionLabel="New Template"
          onAction={() => nav.newTemplate("workout")}
        />
      ) : planningGaps.length ? (
        <HeroCard
          icon="clipboard-outline"
          eyebrow="Planning gaps"
          title={planningGaps.length === 1 ? "1 client has no workout today" : `${planningGaps.length} clients have no workout today`}
          body={planningGaps.map((status) => status.athleteName).slice(0, 4).join(", ") + (planningGaps.length > 4 ? ` and ${planningGaps.length - 4} more` : "")}
          actionLabel="Assign Workout"
          onAction={() => openMode("workout")}
        />
      ) : (
        <HeroCard
          calm
          icon="checkmark-done-outline"
          eyebrow="All planned"
          title="Every client has a workout today"
          body="Get ahead by planning tomorrow's training and meals."
          actionLabel="Plan Ahead"
          onAction={() => openMode("routine")}
        />
      )}

      <SectionLabel title="Create" />
      <View style={styles.quickCreate}>
        <ActionButton label="Workout" icon="barbell-outline" onPress={() => openMode("workout")} style={styles.quickButton} textStyle={styles.quickButtonText} />
        <ActionButton label="Tasks" icon="checkbox-outline" onPress={() => openMode("tasks")} style={styles.quickButton} textStyle={styles.quickButtonText} />
        <ActionButton label="Meal Plan" icon="restaurant-outline" onPress={() => openMode("meal")} style={styles.quickButton} textStyle={styles.quickButtonText} />
      </View>
      <ActionButton label="New Plan" icon="add-outline" onPress={() => openMode("routine")} />

      {groups.length ? (
      <>
      <SectionLabel title="Today" />
      <AppCard>
        {groups.map((group, index) => {
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
        })}
      </AppCard>
      </>
      ) : null}

      {data.tomorrowWorkouts.length ? (
      <>
      <SectionLabel title="Tomorrow" />
      <AppCard>
        {data.tomorrowWorkouts.slice(0, 4).map((assignment, index) => {
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
        })}
      </AppCard>
      </>
      ) : null}

      <SectionLabel title="Templates" action={data.templates.length ? "View all" : undefined} onAction={showTemplates} />
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
                  onPress={() => nav.editTemplate(template.id)}
                />
                {index < Math.min(data.templates.length, 3) - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <View style={styles.stack}>
            <ActionButton label="New workout template" icon="add-outline" onPress={() => nav.newTemplate("workout")} style={styles.fullButton} />
          </View>
        )}
      </AppCard>

      {routinesWithPlans.length ? (
      <>
      <SectionLabel title="Client routines" />
      <AppCard>
        {routinesWithPlans.slice(0, 2).map((status, index) => {
            const visual = planVisual("routine");
            return (
              <View key={status.athleteId}>
                <PlanRow icon={visual.icon} tone={visual.tone} title={status.athleteName} subtitle={routineStatusSubtitle(status)} />
                {index < Math.min(routinesWithPlans.length, 2) - 1 ? <Divider /> : null}
              </View>
            );
        })}
      </AppCard>
      </>
      ) : null}
    </>
  );
}

type PlanNavigation = {
  editTemplate: (id: string) => void;
  newTemplate: (kind: "workout" | "tasks") => void;
  editMealPlan: (id: string) => void;
  newMealPlan: () => void;
};

function usePlanNavigation(): PlanNavigation {
  const router = useRouter();
  return useMemo(
    () => ({
      editTemplate: (id: string) => router.push({ pathname: "/coach/plan/workout-template", params: { templateId: id } } as never),
      newTemplate: (kind: "workout" | "tasks") => router.push({ pathname: "/coach/plan/workout-template", params: { kind } } as never),
      editMealPlan: (id: string) => router.push({ pathname: "/coach/plan/meal-plan", params: { mealPlanId: id } } as never),
      newMealPlan: () => router.push("/coach/plan/meal-plan" as never),
    }),
    [router]
  );
}

function templateSubtitle(template: Pick<ServerWorkoutTemplate, "exercises" | "version">): string {
  const exercises = Array.isArray(template.exercises) ? template.exercises : [];
  const kind = isChecklistTemplate(template) ? "Task list" : `${exercises.length} exercise${exercises.length === 1 ? "" : "s"}`;
  const preview = exercises
    .slice(0, 2)
    .map((e) => (e.type === "checklist" ? e.title : `${e.title} ${exerciseSummary(e)}`))
    .join(", ");
  return [kind, preview].filter(Boolean).join(" - ");
}

function mealPlanSubtitle(plan: Pick<ServerMealPlan, "durationDays" | "days">): string {
  const filled = Array.isArray(plan.days) ? plan.days.length : 0;
  return `${plan.durationDays ?? 0}-day plan - ${filled} day${filled === 1 ? "" : "s"} filled`;
}

type ArchivedLibrary = { templates: ServerWorkoutTemplate[]; mealPlans: ServerMealPlan[] };

function Library({ data, nav, onChanged }: { data: CoachPlanData; nav: PlanNavigation; onChanged: () => void }) {
  const templates = data.templates as unknown as ServerWorkoutTemplate[];
  const mealPlans = data.mealPlans as unknown as ServerMealPlan[];
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ArchivedLibrary | null>(null);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archivedVersion, setArchivedVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!showArchived) return;
    let active = true;
    setArchivedError(null);
    Promise.all([
      requestJson<{ templates: ServerWorkoutTemplate[] }>("/api/workout-templates?includeArchived=1"),
      requestJson<{ mealPlans: ServerMealPlan[] }>("/api/coach/meal-plans?includeArchived=1"),
    ]).then(([t, m]) => {
      if (!active) return;
      if (!t.ok || !m.ok) {
        setArchivedError(describeServerError((t.ok ? m : t).body?.error, (t.ok ? m : t).status));
        return;
      }
      setArchived({
        templates: (t.body?.templates ?? []).filter((x) => x.isArchived),
        mealPlans: (m.body?.mealPlans ?? []).filter((x) => x.isArchived),
      });
    });
    return () => {
      active = false;
    };
  }, [showArchived, archivedVersion]);

  async function setArchivedState(kind: "template" | "mealPlan", id: string, archive: boolean) {
    setBusyId(id);
    setActionError(null);
    const base = kind === "template" ? `/api/workout-templates/${id}` : `/api/coach/meal-plans/${id}`;
    const res = await requestJson(`${base}/${archive ? "archive" : "unarchive"}`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) {
      setActionError(describeServerError(res.body?.error, res.status));
      return;
    }
    onChanged();
    if (showArchived) setArchivedVersion((v) => v + 1);
  }

  function archiveAction(kind: "template" | "mealPlan", id: string, archive: boolean) {
    const busy = busyId === id;
    return (
      <Pressable
        onPress={() => setArchivedState(kind, id, archive)}
        disabled={busyId !== null}
        hitSlop={6}
        accessibilityRole="button"
        style={[styles.rowAction, busyId !== null && !busy ? styles.disabled : null]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.rowActionText}>{archive ? "Archive" : "Restore"}</Text>}
      </Pressable>
    );
  }

  return (
    <>
      <View style={styles.quickCreate}>
        <ActionButton label="New Workout" icon="barbell-outline" onPress={() => nav.newTemplate("workout")} />
        <ActionButton label="New Tasks" icon="checkbox-outline" onPress={() => nav.newTemplate("tasks")} />
      </View>
      <ActionButton label="New Meal Plan" icon="restaurant-outline" onPress={nav.newMealPlan} style={styles.fullButton} />
      {actionError ? <AlertBanner tone="danger" title="Could not update the library" body={actionError} /> : null}

      <SectionHeader title="Workout Templates" />
      <AppCard>
        {templates.length ? (
          templates.map((template, index) => {
            const visual = workoutVisual(template.name);
            return (
              <View key={template.id}>
                <PlanRow
                  icon={visual.icon}
                  tone={visual.tone}
                  title={template.name}
                  subtitle={templateSubtitle(template)}
                  onPress={() => nav.editTemplate(template.id)}
                  right={archiveAction("template", template.id, true)}
                />
                {index < templates.length - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <EmptyState title="No templates" body="Create reusable workouts or task lists, then assign them to clients." icon="document-text-outline" />
        )}
      </AppCard>

      <SectionHeader title="Meal Plans" />
      <AppCard>
        {mealPlans.length ? (
          mealPlans.map((plan, index) => {
            const visual = planVisual(plan.name, "meal plan");
            return (
              <View key={plan.id}>
                <PlanRow
                  icon={visual.icon}
                  tone={visual.tone}
                  title={plan.name}
                  subtitle={mealPlanSubtitle(plan)}
                  onPress={() => nav.editMealPlan(plan.id)}
                  right={archiveAction("mealPlan", plan.id, true)}
                />
                {index < mealPlans.length - 1 ? <Divider /> : null}
              </View>
            );
          })
        ) : (
          <EmptyState title="No meal plans" body="Build a meal plan with days, meals and foods, then assign it to clients." icon="restaurant-outline" />
        )}
      </AppCard>

      <SectionHeader title="Archived" action={showArchived ? "Hide" : "Show"} onAction={() => setShowArchived((v) => !v)} />
      {showArchived ? (
        <AppCard>
          {archivedError ? (
            <ErrorState message={archivedError} onRetry={() => setArchivedVersion((v) => v + 1)} />
          ) : !archived ? (
            <LoadingState label="Loading archived items..." variant="inline" />
          ) : archived.templates.length + archived.mealPlans.length === 0 ? (
            <Text style={styles.muted}>Nothing archived.</Text>
          ) : (
            <>
              {archived.templates.map((template) => (
                <PlanRow
                  key={template.id}
                  icon="archive-outline"
                  tone="neutral"
                  title={template.name}
                  subtitle={`Workout - ${templateSubtitle(template)}`}
                  onPress={() => nav.editTemplate(template.id)}
                  right={archiveAction("template", template.id, false)}
                />
              ))}
              {archived.mealPlans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  icon="archive-outline"
                  tone="neutral"
                  title={plan.name}
                  subtitle={`Meal plan - ${mealPlanSubtitle(plan)}`}
                  onPress={() => nav.editMealPlan(plan.id)}
                  right={archiveAction("mealPlan", plan.id, false)}
                />
              ))}
            </>
          )}
        </AppCard>
      ) : null}
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
  parts.push(status.workoutName ? `${status.workoutName} (${titleCase(status.workoutStatus ?? "")})` : "No workout today");
  parts.push(status.mealPlanName ? `${status.mealPlanName}${status.mealPlanActive ? "" : " (inactive)"}` : "No meal plan");
  return parts.join(" · ");
}

function PlanComposer({
  data,
  mode,
  onModeChange,
  onDone,
  initialAthleteId,
  nav,
}: {
  data: CoachPlanData;
  mode: PlanMode;
  onModeChange: (mode: PlanMode | null) => void;
  onDone: () => void;
  initialAthleteId?: string;
  nav: PlanNavigation;
}) {
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>(() => {
    const seedId = initialAthleteId && data.roster.some((athlete) => athlete.athleteId === initialAthleteId)
      ? initialAthleteId
      : data.roster[0]?.athleteId;
    return seedId ? [seedId] : [];
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedMealPlanId, setSelectedMealPlanId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(mode === "meal" ? todayKey() : addDays(todayKey(), 1));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AssignOutcome | null>(null);

  useEffect(() => {
    if (!selectedAthleteIds.length && data.roster[0]?.athleteId) setSelectedAthleteIds([data.roster[0].athleteId]);
  }, [data.roster, selectedAthleteIds.length]);

  // "Tasks" assigns checklist-only templates; the other workout modes can use any template.
  const workoutTemplates = useMemo(
    () => (mode === "tasks" ? data.templates.filter((t) => isChecklistTemplate(t)) : data.templates),
    [data.templates, mode]
  );
  // Fall back to the first available item if the selection was archived or filtered out.
  const templateId = workoutTemplates.some((t) => t.id === selectedTemplateId) ? selectedTemplateId : workoutTemplates[0]?.id ?? "";
  const mealPlanId = data.mealPlans.some((p) => p.id === selectedMealPlanId) ? selectedMealPlanId : data.mealPlans[0]?.id ?? "";

  const title = mode === "tasks" ? "Assign Task List" : mode === "meal" ? "Assign Meal Plan" : mode === "routine" ? "Assign Routine" : "Assign Workout";
  const needsWorkout = mode === "workout" || mode === "tasks" || mode === "routine";
  const needsMeal = mode === "meal" || mode === "routine";
  const nameOf = (athleteId: string) => data.roster.find((a) => a.athleteId === athleteId)?.name ?? "Client";

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  }

  async function submit() {
    setMessage(null);
    setOutcome(null);
    if (!selectedAthleteIds.length) {
      setMessage("Select at least one client.");
      return;
    }
    if (needsWorkout && !templateId) {
      setMessage(mode === "tasks" ? "Create a task list first, then assign it." : "Create a workout template first, then assign it.");
      return;
    }
    if (needsMeal && !mealPlanId) {
      setMessage("Create a meal plan first, then assign it.");
      return;
    }
    const athleteIds = selectedAthleteIds.slice();
    setSaving(true);
    const sections: AssignSection[] = [];
    try {
      if (needsWorkout) {
        const res = await requestJson<{ results?: BulkWorkoutResult[] }>("/api/coach/workout-assignments/bulk", {
          method: "POST",
          body: JSON.stringify({ templateId, athleteIds, scheduledDate }),
        });
        sections.push(summarizeWorkoutBulk(mode === "tasks" ? "Task list" : "Workout", athleteIds, res, nameOf));
      }
      if (needsMeal) {
        const attempts: MealAssignAttempt[] = await Promise.all(
          athleteIds.map(async (athleteId) => {
            const res = await requestJson<NonNullable<MealAssignAttempt["body"]>>(`/api/coach/athletes/${athleteId}/meal-plan-assignments`, {
              method: "POST",
              body: JSON.stringify({ mealPlanId, startDate: scheduledDate }),
            });
            return { athleteId, status: res.status, body: res.body };
          })
        );
        sections.push(summarizeMealAttempts("Meal plan", attempts, nameOf));
      }
    } finally {
      setSaving(false);
    }
    const result = buildAssignOutcome(sections);
    setOutcome(result);
    if (result.tone === "success") celebrate({ title: result.title.replace(/\.$/, "") });
    else errorFeedback();
    if (sections.some((section) => section.succeeded > 0)) onDone();
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
        {PLAN_MODES.map((item) => (
          <Pressable
            key={item}
            onPress={() => {
              setOutcome(null);
              setMessage(null);
              onModeChange(item);
            }}
            style={[styles.choiceChip, mode === item ? styles.choiceChipActive : null]}
          >
            <Text style={[styles.choiceText, mode === item ? styles.choiceTextActive : null]}>{titleCase(item)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{needsMeal && !needsWorkout ? "Start date" : "Date"}</Text>
      <View style={styles.modeRow}>
        {[todayKey(), addDays(todayKey(), 1), addDays(todayKey(), 2)].map((date) => (
          <Pressable key={date} onPress={() => setScheduledDate(date)} style={[styles.choiceChip, scheduledDate === date ? styles.choiceChipActive : null]}>
            <Text style={[styles.choiceText, scheduledDate === date ? styles.choiceTextActive : null]}>{date === todayKey() ? "Today" : date === addDays(todayKey(), 1) ? "Tomorrow" : shortDateLabel(date)}</Text>
          </Pressable>
        ))}
      </View>

      {needsWorkout ? (
        <>
          <Text style={styles.label}>{mode === "tasks" ? "Task list" : "Workout template"}</Text>
          <View style={styles.stack}>
            {workoutTemplates.length ? (
              workoutTemplates.map((template) => (
                <ChoiceRow
                  key={template.id}
                  selected={templateId === template.id}
                  title={template.name}
                  subtitle={templateSubtitle(template as unknown as ServerWorkoutTemplate)}
                  onPress={() => setSelectedTemplateId(template.id)}
                />
              ))
            ) : (
              <Text style={styles.muted}>
                {mode === "tasks"
                  ? "No task lists yet. A task list is a template made only of checklist items."
                  : "No workout templates yet. Build one to assign it."}
              </Text>
            )}
            <View style={styles.inlineActions}>
              <ActionButton
                label={mode === "tasks" ? "New task list" : "New template"}
                icon="add-outline"
                onPress={() => nav.newTemplate(mode === "tasks" ? "tasks" : "workout")}
              />
              {templateId ? <ActionButton label="Edit selected" icon="create-outline" onPress={() => nav.editTemplate(templateId)} /> : null}
            </View>
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
                  selected={mealPlanId === plan.id}
                  title={plan.name}
                  subtitle={mealPlanSubtitle(plan as unknown as ServerMealPlan)}
                  onPress={() => setSelectedMealPlanId(plan.id)}
                />
              ))
            ) : (
              <Text style={styles.muted}>No meal plans yet. Build one to assign it.</Text>
            )}
            <View style={styles.inlineActions}>
              <ActionButton label="New meal plan" icon="add-outline" onPress={nav.newMealPlan} />
              {mealPlanId ? <ActionButton label="Edit selected" icon="create-outline" onPress={() => nav.editMealPlan(mealPlanId)} /> : null}
            </View>
          </View>
        </>
      ) : null}

      <Text style={styles.label}>Clients</Text>
      <View style={styles.stack}>
        {data.roster.length ? (
          data.roster.map((client) => (
            <ChoiceRow
              key={client.athleteId}
              multi
              selected={selectedAthleteIds.includes(client.athleteId)}
              title={client.name}
              subtitle={client.sport || "Client"}
              onPress={() => toggleAthlete(client.athleteId)}
            />
          ))
        ) : (
          <Text style={styles.muted}>No clients yet. Add clients from the Clients tab to assign plans.</Text>
        )}
      </View>

      {message ? <Text style={styles.errorText}>{message}</Text> : null}
      {outcome ? (
        <AlertBanner
          tone={outcome.tone === "success" ? "primary" : outcome.tone === "partial" ? "warning" : "danger"}
          title={outcome.title}
          body={outcome.lines.length ? outcome.lines.join("\n") : undefined}
        />
      ) : null}
      {outcome?.warnings.length ? (
        <AlertBanner tone="warning" title="Review before clients start" body={outcome.warnings.join("\n")} />
      ) : null}
      <Pressable onPress={submit} disabled={saving || !data.roster.length} style={[styles.submitButton, saving || !data.roster.length ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Assign to {selectedAthleteIds.length} client{selectedAthleteIds.length === 1 ? "" : "s"}</Text>}
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

function PlanRow({
  icon,
  title,
  subtitle,
  value,
  progress,
  tone = "primary",
  onPress,
  right,
}: {
  icon: FitoraIconName;
  title: string;
  subtitle?: string;
  value?: string;
  progress?: number;
  tone?: FitoraTone;
  onPress?: () => void;
  right?: ReactNode;
}) {
  return (
    <RowLink
      icon={icon}
      tone={tone}
      title={title}
      subtitle={subtitle}
      value={value}
      progress={progress}
      onPress={onPress}
      right={right}
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
  fullButton: { flex: 0, minHeight: 40 },
  inlineActions: { flexDirection: "row", gap: 8 },
  rowAction: { minHeight: 30, minWidth: 64, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  rowActionText: { color: colors.inkMuted, fontSize: 12, fontWeight: "900" },
  composer: { gap: 9, borderColor: colors.primary },
  composerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  composerTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "900" },
  closeText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  label: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", textTransform: "uppercase" },
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
  choiceSub: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  submitButton: { minHeight: 42, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  errorText: { color: colors.bad, fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  muted: { color: colors.inkMuted, fontSize: 15, lineHeight: 21 },
  divider: { height: 1, backgroundColor: colors.line },
});
