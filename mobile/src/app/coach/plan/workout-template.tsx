import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
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
import {
  EXERCISE_TYPES,
  EXERCISE_TYPE_LABELS,
  TEMPLATE_LIMITS,
  describeServerError,
  emptyExercise,
  emptyTemplateDraft,
  exerciseFields,
  markPlanLibraryDirty,
  moveItem,
  nextKey,
  templateToDraft,
  validateTemplateDraft,
  type ExerciseDraft,
  type ExerciseType,
  type ServerWorkoutTemplate,
  type TemplateDraft,
  type TemplatePayload,
} from "../../../lib/planBuilder";

type ExerciseMediaItem = { id: string; originalName: string; kind: string };

export default function WorkoutTemplateEditor() {
  const router = useRouter();
  const params = useLocalSearchParams<{ templateId?: string; kind?: string }>();
  const templateId = typeof params.templateId === "string" && params.templateId ? params.templateId : null;
  const kind = params.kind === "tasks" ? "tasks" : "workout";

  const [draft, setDraft] = useState<TemplateDraft | null>(templateId ? null : emptyTemplateDraft(kind));
  const [original, setOriginal] = useState<ServerWorkoutTemplate | null>(null);
  const [loading, setLoading] = useState(Boolean(templateId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [media, setMedia] = useState<ExerciseMediaItem[]>([]);

  useEffect(() => {
    if (!templateId) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    requestJson<{ template: ServerWorkoutTemplate }>(`/api/workout-templates/${templateId}`).then((res) => {
      if (!active) return;
      if (res.ok && res.body?.template) {
        setOriginal(res.body.template);
        setDraft(templateToDraft(res.body.template));
      } else {
        setLoadError(describeServerError(res.body?.error, res.status));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [templateId, loadVersion]);

  // Optional: the coach's exercise-demo library. A failure just hides the picker.
  useEffect(() => {
    let active = true;
    requestJson<{ media: ExerciseMediaItem[] }>("/api/coach/exercise-media").then((res) => {
      if (active && res.ok && Array.isArray(res.body?.media)) setMedia(res.body.media);
    });
    return () => {
      active = false;
    };
  }, []);

  const originalPayload = useMemo(() => {
    if (!original) return null;
    const result = validateTemplateDraft(templateToDraft(original));
    return result.ok ? result.payload : null;
  }, [original]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/coach/plan" as never);
  }, [router]);

  const updateExercise = useCallback((key: string, patch: Partial<ExerciseDraft>) => {
    setDraft((current) => current && { ...current, exercises: current.exercises.map((ex) => (ex.key === key ? { ...ex, ...patch } : ex)) });
  }, []);

  if (loading) {
    return (
      <EditorScreen>
        <EditorHeader title="Edit workout template" onBack={goBack} />
        <LoadingState label="Loading template..." />
      </EditorScreen>
    );
  }
  if (loadError || !draft) {
    return (
      <EditorScreen>
        <EditorHeader title="Edit workout template" onBack={goBack} />
        <ErrorState message={loadError ?? "Template not available."} onRetry={() => setLoadVersion((v) => v + 1)} />
      </EditorScreen>
    );
  }

  const isEdit = Boolean(templateId && original);
  const isArchived = Boolean(original?.isArchived);
  const title = isEdit ? "Edit workout template" : kind === "tasks" ? "New task list" : "New workout template";

  function setType(ex: ExerciseDraft, type: ExerciseType) {
    const defaults = emptyExercise(type);
    updateExercise(ex.key, {
      type,
      // Keep what the coach typed; seed sensible defaults only for blank fields.
      sets: ex.sets || defaults.sets,
      reps: ex.reps || defaults.reps,
      duration: ex.duration || defaults.duration,
    });
  }

  function addExercise() {
    setDraft((current) => {
      if (!current) return current;
      const last = current.exercises[current.exercises.length - 1];
      return { ...current, exercises: [...current.exercises, emptyExercise(last?.type ?? (kind === "tasks" ? "checklist" : "sets_reps"))] };
    });
  }

  function removeExercise(key: string) {
    setDraft((current) => current && { ...current, exercises: current.exercises.filter((ex) => ex.key !== key) });
  }

  function duplicateExercise(index: number) {
    setDraft((current) => {
      if (!current) return current;
      const copy = { ...current.exercises[index], key: nextKey("ex") };
      const exercises = current.exercises.slice();
      exercises.splice(index + 1, 0, copy);
      return { ...current, exercises };
    });
  }

  function move(index: number, delta: -1 | 1) {
    setDraft((current) => current && { ...current, exercises: moveItem(current.exercises, index, delta) });
  }

  async function save() {
    if (!draft) return;
    const result = validateTemplateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setSaving(true);
    let body: Partial<TemplatePayload> = result.payload;
    if (isEdit && originalPayload) {
      // Only send the exercise list when it actually changed: the server bumps
      // the template version on every exercises edit.
      body = { name: result.payload.name, description: result.payload.description };
      if (JSON.stringify(originalPayload.exercises) !== JSON.stringify(result.payload.exercises)) body.exercises = result.payload.exercises;
    }
    const res = await requestJson<{ template: ServerWorkoutTemplate }>(
      isEdit ? `/api/workout-templates/${templateId}` : "/api/workout-templates",
      { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(body) }
    );
    setSaving(false);
    if (!res.ok || !res.body?.template) {
      setErrors([describeServerError(res.body?.error, res.status)]);
      return;
    }
    markPlanLibraryDirty();
    goBack();
  }

  async function toggleArchive() {
    if (!templateId) return;
    setArchiving(true);
    const res = await requestJson<{ template: ServerWorkoutTemplate }>(
      `/api/workout-templates/${templateId}/${isArchived ? "unarchive" : "archive"}`,
      { method: "POST" }
    );
    setArchiving(false);
    if (!res.ok || !res.body?.template) {
      setErrors([describeServerError(res.body?.error, res.status)]);
      return;
    }
    markPlanLibraryDirty();
    if (isArchived) setOriginal(res.body.template);
    else goBack();
  }

  return (
    <EditorScreen>
      <EditorHeader
        title={title}
        subtitle={
          isEdit
            ? "Saving exercise changes creates a new version. Workouts you already assigned keep their original copy."
            : kind === "tasks"
              ? "Checklist items your clients tick off. Reuse it from the Plan tab."
              : "Build a reusable workout, then assign it from the Plan tab."
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
        <Field
          label="Name"
          value={draft.name}
          onChange={(name) => setDraft({ ...draft, name })}
          placeholder={kind === "tasks" ? "e.g. Morning habits" : "e.g. Lower body strength A"}
          maxLength={TEMPLATE_LIMITS.nameMax}
        />
        <Field
          label="Description (optional)"
          value={draft.description}
          onChange={(description) => setDraft({ ...draft, description })}
          placeholder="Goal, focus, or how to approach this session"
          multiline
          maxLength={TEMPLATE_LIMITS.descriptionMax}
        />
      </View>

      <Text style={editorStyles.sectionTitle}>
        {kind === "tasks" ? "Items" : "Exercises"} ({draft.exercises.length})
      </Text>
      {draft.exercises.length === 0 ? (
        <AlertBanner tone="primary" title="No exercises yet" body="Add at least one exercise to save this template." />
      ) : null}

      {draft.exercises.map((ex, index) => (
        <ExerciseCard
          key={ex.key}
          ex={ex}
          index={index}
          count={draft.exercises.length}
          media={media}
          onChange={(patch) => updateExercise(ex.key, patch)}
          onType={(type) => setType(ex, type)}
          onMove={(delta) => move(index, delta)}
          onDuplicate={() => duplicateExercise(index)}
          onRemove={() => removeExercise(ex.key)}
        />
      ))}

      <PrimaryButton
        label={draft.exercises.length >= TEMPLATE_LIMITS.exercisesMax ? `Limit of ${TEMPLATE_LIMITS.exercisesMax} reached` : kind === "tasks" ? "+ Add item" : "+ Add exercise"}
        tone="outline"
        onPress={addExercise}
        disabled={draft.exercises.length >= TEMPLATE_LIMITS.exercisesMax}
      />

      <ErrorList title="Fix these before saving" errors={errors} />
      <PrimaryButton label={isEdit ? "Save changes" : "Create template"} onPress={save} busy={saving} disabled={archiving} />
      {isEdit ? (
        <PrimaryButton
          label={archiving ? "Working..." : isArchived ? "Restore template" : "Archive template"}
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

function ExerciseCard({
  ex,
  index,
  count,
  media,
  onChange,
  onType,
  onMove,
  onDuplicate,
  onRemove,
}: {
  ex: ExerciseDraft;
  index: number;
  count: number;
  media: ExerciseMediaItem[];
  onChange: (patch: Partial<ExerciseDraft>) => void;
  onType: (type: ExerciseType) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const fields = exerciseFields(ex.type);
  const attachedMissing = ex.mediaId && media.length > 0 && !media.some((m) => m.id === ex.mediaId);
  return (
    <View style={editorStyles.card}>
      <View style={editorStyles.cardHead}>
        <Text style={editorStyles.cardTitle} numberOfLines={1}>
          {index + 1}. {ex.title.trim() || "Untitled"}
        </Text>
        <IconButton icon="arrow-up" label={`Move exercise ${index + 1} up`} onPress={() => onMove(-1)} disabled={index === 0} />
        <IconButton icon="arrow-down" label={`Move exercise ${index + 1} down`} onPress={() => onMove(1)} disabled={index === count - 1} />
        <IconButton icon="copy-outline" label={`Duplicate exercise ${index + 1}`} onPress={onDuplicate} />
        <IconButton icon="trash-outline" label={`Remove exercise ${index + 1}`} onPress={onRemove} tone="danger" />
      </View>
      <Field
        label="Exercise"
        value={ex.title}
        onChange={(title) => onChange({ title })}
        placeholder={ex.type === "checklist" ? "e.g. Log breakfast" : "e.g. Goblet squat"}
        maxLength={TEMPLATE_LIMITS.titleMax}
      />
      <View style={{ gap: 4 }}>
        <FieldLabel>Type</FieldLabel>
        <ChipRow>
          {EXERCISE_TYPES.map((type) => (
            <Chip key={type} label={EXERCISE_TYPE_LABELS[type]} selected={ex.type === type} onPress={() => onType(type)} />
          ))}
        </ChipRow>
      </View>
      {fields.sets || fields.reps ? (
        <View style={editorStyles.row}>
          {fields.sets ? (
            <Field
              style={editorStyles.flex1}
              label={ex.type === "duration" ? "Sets (optional)" : "Sets"}
              value={ex.sets}
              onChange={(sets) => onChange({ sets: sets.replace(/[^0-9]/g, "") })}
              keyboardType="number-pad"
              placeholder="3"
              maxLength={2}
            />
          ) : null}
          {fields.reps ? (
            <Field
              style={editorStyles.flex1}
              label="Reps"
              value={ex.reps}
              onChange={(reps) => onChange({ reps })}
              placeholder="10 or 8-12"
              maxLength={TEMPLATE_LIMITS.repsMax}
            />
          ) : null}
        </View>
      ) : null}
      {fields.duration || fields.rest ? (
        <View style={editorStyles.row}>
          {fields.duration ? (
            <Field
              style={editorStyles.flex1}
              label="Duration (s or m:ss)"
              value={ex.duration}
              onChange={(duration) => onChange({ duration: duration.replace(/[^0-9:]/g, "") })}
              keyboardType="numbers-and-punctuation"
              placeholder="0:45"
              maxLength={8}
            />
          ) : null}
          {fields.rest ? (
            <Field
              style={editorStyles.flex1}
              label="Rest (optional)"
              value={ex.rest}
              onChange={(rest) => onChange({ rest: rest.replace(/[^0-9:]/g, "") })}
              keyboardType="numbers-and-punctuation"
              placeholder="1:30"
              maxLength={5}
            />
          ) : null}
        </View>
      ) : null}
      <Field
        label="Instructions (optional)"
        value={ex.instructions}
        onChange={(instructions) => onChange({ instructions })}
        placeholder="Setup, form cues, tempo"
        multiline
        maxLength={TEMPLATE_LIMITS.instructionsMax}
      />
      <Field
        label="Notes - load, RPE (optional)"
        value={ex.notes}
        onChange={(notes) => onChange({ notes })}
        placeholder="e.g. 60 kg, RPE 7"
        maxLength={TEMPLATE_LIMITS.notesMax}
      />
      {media.length > 0 || ex.mediaId ? (
        <View style={{ gap: 4 }}>
          <FieldLabel>Demo media (optional)</FieldLabel>
          <ChipRow>
            <Chip label="None" selected={!ex.mediaId} onPress={() => onChange({ mediaId: null })} />
            {media.map((item) => (
              <Chip
                key={item.id}
                label={`${item.kind === "video" ? "Video" : "Image"}: ${shorten(item.originalName, 22)}`}
                selected={ex.mediaId === item.id}
                onPress={() => onChange({ mediaId: item.id })}
              />
            ))}
            {ex.mediaId && media.length === 0 ? <Chip label="Attached demo" selected onPress={() => undefined} /> : null}
          </ChipRow>
          {attachedMissing ? <Text style={editorStyles.muted}>The attached demo is no longer in your library. Pick another or None.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function shorten(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
