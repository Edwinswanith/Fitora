import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AppCard,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  ProgressBar,
  ScreenContainer,
  StatusChip,
  VideoThumb,
} from "../../components/fitora";
import { VideoPlayerModal } from "../../components/VideoPlayerModal";
import { apiFetch } from "../../lib/api";
import { celebrate, showError, successFeedback } from "../../lib/feedback";
import { colors } from "../../lib/theme";
import {
  loadAthleteDashboardData,
  loadWorkoutDetail,
  updateCachedData,
  useAsyncData,
  type AthleteDashboardData,
  type WorkoutAssignmentDetail,
} from "../../lib/fitoraData";

type SetInput = { setNumber: number; reps?: number; weightKg?: number; durationSec?: number };

const SKIP_REASONS = ["Equipment unavailable", "Pain or discomfort", "Too difficult", "Other"];

async function refreshAthleteDashboardCache() {
  const dashboard = await loadAthleteDashboardData().catch(() => null);
  if (dashboard) updateCachedData<AthleteDashboardData>("athlete-dashboard", () => dashboard);
}

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ assignmentId?: string }>();
  const assignmentId = Array.isArray(params.assignmentId) ? params.assignmentId[0] : params.assignmentId;
  const state = useAsyncData(
    () => {
      if (!assignmentId) throw new Error("missing_assignment");
      return loadWorkoutDetail(assignmentId);
    },
    [assignmentId]
  );

  if (!assignmentId) {
    return (
      <ScreenContainer>
        <BackHeader title="Workout" />
        <EmptyState title="No workout selected" body="Open a workout from the Training tab to continue." icon="barbell-outline" />
      </ScreenContainer>
    );
  }

  if (state.loading && !state.data) {
    return (
      <ScreenContainer>
        <BackHeader title="Workout" />
        <LoadingState label="Loading workout..." />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer>
        <BackHeader title="Workout" />
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  if (!state.data) return null;

  /** The request body already fully describes the new progress row — apply it locally instead of refetching the whole assignment. */
  function patchProgress(exerciseIndex: number, status: string, setsCompleted: SetInput[], notes?: string) {
    state.setData((prev) => {
      if (!prev) return prev;
      const fullSets = setsCompleted.map((s) => ({
        setNumber: s.setNumber,
        reps: s.reps ?? null,
        weightKg: s.weightKg ?? null,
        durationSec: s.durationSec ?? null,
      }));
      const existingIndex = prev.progress.findIndex((row) => row.exerciseIndex === exerciseIndex);
      const nextRow = {
        exerciseIndex,
        status,
        setsCompleted: fullSets,
        notes: notes ?? prev.progress[existingIndex]?.notes ?? null,
        completedAt: null,
      };
      const progress =
        existingIndex === -1
          ? [...prev.progress, nextRow]
          : prev.progress.map((row, i) => (i === existingIndex ? { ...row, ...nextRow } : row));
      // Matches the server's own terminal-state definition (services/workoutAssignment.ts) —
      // a skipped exercise advances the workout just like a completed one.
      const completedCount = progress.filter((row) => row.status === "completed" || row.status === "skipped").length;
      return { ...prev, progress, completedCount };
    });
  }

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload} contentStyle={styles.screenContent}>
      <BackHeader title={state.data.name} onBack={() => router.back()} />
      <WorkoutTask assignment={state.data} onProgressSaved={patchProgress} />
    </ScreenContainer>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack ?? (() => router.back())} style={styles.backButton}>
        <Ionicons name="chevron-back" size={27} color={colors.ink} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
    </View>
  );
}

function formatClock(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function WorkoutTask({
  assignment,
  onProgressSaved,
}: {
  assignment: WorkoutAssignmentDetail;
  onProgressSaved: (exerciseIndex: number, status: string, setsCompleted: SetInput[], notes?: string) => void;
}) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(() => {
    const current = assignment.exercises.findIndex((_, index) => {
      const row = assignment.progress.find((item) => item.exerciseIndex === index);
      return row?.status !== "completed" && row?.status !== "skipped";
    });
    return Math.max(0, current);
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [selectedRpe, setSelectedRpe] = useState(6);
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const [repsInput, setRepsInput] = useState(0);
  const [weightInput, setWeightInput] = useState(0);
  const [showSkipReasons, setShowSkipReasons] = useState(false);
  const [skipReason, setSkipReason] = useState<string | null>(null);
  const [skipOtherText, setSkipOtherText] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);

  const progressByIndex = useMemo(() => new Map(assignment.progress.map((row) => [row.exerciseIndex, row])), [assignment.progress]);
  const exercise = assignment.exercises[activeIndex];
  const rowProgress = progressByIndex.get(activeIndex);
  const completedSets = rowProgress?.setsCompleted.length ?? 0;
  const totalSets = exercise?.sets ?? 1;
  const overall = assignment.exerciseCount ? assignment.completedCount / assignment.exerciseCount : 0;
  const showSetInputs = exercise?.type === "sets_reps";

  // Reset per-exercise state (but not the rest timer, which counts down across the transition into the next exercise).
  useEffect(() => {
    const targetReps = exercise ? Number.parseInt(exercise.reps ?? "", 10) : NaN;
    setRepsInput(Number.isFinite(targetReps) ? targetReps : 0);
    setWeightInput(0);
    setShowSkipReasons(false);
    setSkipReason(null);
    setSkipOtherText("");
    setNoteOpen(false);
    setNoteText(progressByIndex.get(activeIndex)?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  useEffect(() => {
    if (restRemaining == null || restRemaining <= 0) return;
    const timer = setTimeout(() => setRestRemaining((r) => (r == null ? null : Math.max(0, r - 1))), 1000);
    return () => clearTimeout(timer);
  }, [restRemaining]);

  function advance(finishedExercise: boolean, restSec?: number | null) {
    const isLastExercise = activeIndex >= assignment.exercises.length - 1;
    if (finishedExercise && isLastExercise) {
      setDone(true);
      celebrate({ title: "Workout complete!", body: `${assignment.name} is done. Great job.`, big: true });
      return;
    }
    if (restSec) setRestRemaining(restSec);
    if (finishedExercise) setActiveIndex((index) => index + 1);
  }

  async function completeSet() {
    if (!exercise || saving) return;
    setSaving(true);
    const existingSets: SetInput[] = (rowProgress?.setsCompleted ?? []).map((s) => ({
      setNumber: s.setNumber,
      reps: s.reps ?? undefined,
      weightKg: s.weightKg ?? undefined,
      durationSec: s.durationSec ?? undefined,
    }));
    const setsCompleted: SetInput[] = [
      ...existingSets,
      {
        setNumber: existingSets.length + 1,
        reps: showSetInputs && repsInput > 0 ? repsInput : undefined,
        weightKg: showSetInputs && weightInput > 0 ? weightInput : undefined,
      },
    ];
    const status = setsCompleted.length >= totalSets ? "completed" : "in_progress";
    const res = await apiFetch(`/api/athlete/workout-assignments/${assignment.id}/exercises/${activeIndex}/progress`, {
      method: "POST",
      body: JSON.stringify({ status, setsCompleted }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      // A tick per set (no toast: that would be noise mid-workout).
      successFeedback();
      onProgressSaved(activeIndex, status, setsCompleted);
      void refreshAthleteDashboardCache();
      advance(status === "completed", exercise.restSec);
    } else {
      showError("Set not saved", "Check your connection and tap again.");
    }
  }

  async function skipExercise() {
    if (!exercise || saving || !skipReason) return;
    const reason = skipReason === "Other" ? skipOtherText.trim() : skipReason;
    if (!reason) return;
    setSaving(true);
    const res = await apiFetch(`/api/athlete/workout-assignments/${assignment.id}/exercises/${activeIndex}/progress`, {
      method: "POST",
      body: JSON.stringify({ status: "skipped", notes: `Can't perform: ${reason}` }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      onProgressSaved(activeIndex, "skipped", (rowProgress?.setsCompleted as SetInput[] | undefined) ?? [], `Can't perform: ${reason}`);
      void refreshAthleteDashboardCache();
      setShowSkipReasons(false);
      advance(true, null);
    } else {
      showError("Couldn't skip this exercise", "Check your connection and try again.");
    }
  }

  async function saveNote() {
    if (noteSaving) return;
    setNoteSaving(true);
    const res = await apiFetch(`/api/athlete/workout-assignments/${assignment.id}/exercises/${activeIndex}/progress`, {
      method: "POST",
      body: JSON.stringify({ notes: noteText.trim() }),
    }).catch(() => null);
    setNoteSaving(false);
    if (res?.ok) {
      onProgressSaved(
        activeIndex,
        rowProgress?.status ?? "not_started",
        (rowProgress?.setsCompleted as SetInput[] | undefined) ?? [],
        noteText.trim()
      );
      void refreshAthleteDashboardCache();
      setNoteOpen(false);
      celebrate({ title: "Note saved" });
    } else {
      showError("Note not saved", "Check your connection and try again.");
    }
  }

  if (!exercise) {
    return <EmptyState title="No exercises found" body="This workout has no exercise rows yet." icon="barbell-outline" />;
  }

  return (
    <>
      <AppCard>
        <Text style={styles.eyebrow}>Exercise {activeIndex + 1} of {assignment.exercises.length}</Text>
        <Text style={styles.workoutTitle}>{assignment.name}</Text>
        <ProgressBar value={overall} style={{ marginTop: 14 }} />
      </AppCard>

      <AppCard>
        <Text style={styles.currentLabel}>Current exercise</Text>
        <Text style={styles.exerciseTitle}>{exercise.title}</Text>
        <Pressable disabled={!exercise.mediaId} onPress={() => setVideoOpen(true)} accessibilityRole={exercise.mediaId ? "button" : undefined}>
          <VideoThumb duration={exercise.mediaId ? "Video" : null} title={exercise.title} category={exercise.type} />
        </Pressable>
        <View style={styles.exerciseMeta}>
          <StatusChip label={exercise.sets ? `${exercise.sets} sets` : "Timed"} tone="primary" />
          {exercise.reps ? <StatusChip label={`${exercise.reps} reps`} /> : null}
          {exercise.restSec ? <StatusChip label={`Rest ${exercise.restSec} sec`} tone="warning" /> : null}
        </View>
        {exercise.instructions ? (
          <View style={styles.coachInstruction}>
            <IconTile icon="chatbubble-outline" size={42} />
            <View style={{ flex: 1 }}>
              <Text style={styles.instructionLabel}>Coach instruction</Text>
              <Text style={styles.instructionText}>{exercise.instructions}</Text>
            </View>
          </View>
        ) : null}
        {noteOpen ? (
          <View style={styles.noteBox}>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="e.g. felt easy, could go heavier"
              placeholderTextColor={colors.inkFaint}
              style={styles.noteInput}
              multiline
            />
            <View style={styles.noteActionsRow}>
              <Pressable onPress={() => setNoteOpen(false)} hitSlop={8}>
                <Text style={styles.noteCancelText}>Cancel</Text>
              </Pressable>
              <ActionButton label={noteSaving ? "Saving..." : "Save Note"} variant="filled" style={styles.noteSaveButton} onPress={saveNote} />
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setNoteOpen(true)} style={styles.noteTrigger} hitSlop={8}>
            <Ionicons name="create-outline" size={14} color={colors.inkMuted} />
            <Text style={styles.noteTriggerText}>{noteText ? "Edit note" : "Add a note"}</Text>
          </Pressable>
        )}
      </AppCard>

      <AppCard>
        <Text style={styles.currentLabel}>Sets</Text>
        {Array.from({ length: totalSets }, (_, index) => {
          const setDone = index < completedSets;
          const loggedSet = rowProgress?.setsCompleted[index];
          return (
            <View key={index} style={styles.setRow}>
              <View style={[styles.setIcon, setDone ? styles.setIconDone : null]}>
                <Ionicons name={setDone ? "checkmark" : "ellipse-outline"} size={20} color={setDone ? "#fff" : colors.inkMuted} />
              </View>
              <Text style={styles.setText}>Set {index + 1}</Text>
              <Text style={styles.setStatus}>
                {setDone && (loggedSet?.reps || loggedSet?.weightKg)
                  ? [loggedSet?.reps ? `${loggedSet.reps} reps` : null, loggedSet?.weightKg ? `${loggedSet.weightKg} kg` : null].filter(Boolean).join(" · ")
                  : setDone
                    ? "Complete"
                    : "Pending"}
              </Text>
            </View>
          );
        })}

        {done ? (
          <View style={styles.rpeBox}>
            <Text style={styles.currentLabel}>How hard was the workout?</Text>
            <View style={styles.rpeRow}>
              {Array.from({ length: 10 }, (_, index) => (
                <Pressable
                  key={index}
                  onPress={() => setSelectedRpe(index + 1)}
                  style={[styles.rpeDot, selectedRpe === index + 1 ? styles.rpeDotActive : null]}
                >
                  <Text style={[styles.rpeText, selectedRpe === index + 1 ? styles.rpeTextActive : null]}>{index + 1}</Text>
                </Pressable>
              ))}
            </View>
            <ActionButton
              label="Log Effort"
              variant="filled"
              onPress={() => router.push({ pathname: "/athlete/rpe", params: { sessionType: assignment.slot ?? "gym", rpe: String(selectedRpe) } } as never)}
            />
          </View>
        ) : (
          <>
            {restRemaining != null ? (
              <RestTimer
                seconds={restRemaining}
                onAddTime={() => setRestRemaining((r) => (r ?? 0) + 30)}
                onSkip={() => setRestRemaining(null)}
              />
            ) : null}

            {showSetInputs ? (
              <View style={styles.setInputRow}>
                <MiniStepper label="Reps" value={repsInput} onChange={(v) => setRepsInput(Math.max(0, v))} step={1} />
                <MiniStepper label="Weight (kg)" value={weightInput} onChange={(v) => setWeightInput(Math.max(0, v))} step={2.5} />
              </View>
            ) : null}

            <ActionButton
              label={activeIndex === assignment.exercises.length - 1 && completedSets + 1 >= totalSets ? "Finish Workout" : "Complete Set"}
              variant="filled"
              onPress={completeSet}
              disabled={saving}
            />
            {saving ? <Text style={styles.savingText}>Saving progress...</Text> : null}

            {showSkipReasons ? (
              <View style={styles.skipBox}>
                <Text style={styles.skipTitle}>{"Why can't you do this exercise?"}</Text>
                <View style={styles.skipChips}>
                  {SKIP_REASONS.map((reason) => {
                    const active = skipReason === reason;
                    return (
                      <Pressable key={reason} onPress={() => setSkipReason(reason)} style={[styles.skipChip, active ? styles.skipChipActive : null]}>
                        <Text style={[styles.skipChipText, active ? styles.skipChipTextActive : null]}>{reason}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {skipReason === "Other" ? (
                  <TextInput
                    value={skipOtherText}
                    onChangeText={setSkipOtherText}
                    placeholder="Briefly describe the issue"
                    placeholderTextColor={colors.inkFaint}
                    style={styles.noteInput}
                  />
                ) : null}
                <View style={styles.noteActionsRow}>
                  <Pressable onPress={() => setShowSkipReasons(false)} hitSlop={8}>
                    <Text style={styles.noteCancelText}>Cancel</Text>
                  </Pressable>
                  <ActionButton
                    label="Confirm"
                    variant="filled"
                    style={styles.noteSaveButton}
                    disabled={!skipReason || (skipReason === "Other" && !skipOtherText.trim())}
                    onPress={skipExercise}
                  />
                </View>
              </View>
            ) : (
              <Pressable onPress={() => setShowSkipReasons(true)} style={styles.skipTrigger} hitSlop={8}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.inkMuted} />
                <Text style={styles.skipTriggerText}>{"Can't perform this exercise"}</Text>
              </Pressable>
            )}
          </>
        )}
      </AppCard>

      {exercise.mediaId ? (
        <VideoPlayerModal
          visible={videoOpen}
          title={exercise.title}
          streamPath={`/api/athlete/exercise-media/${exercise.mediaId}/file`}
          onClose={() => setVideoOpen(false)}
        />
      ) : null}
    </>
  );
}

function RestTimer({ seconds, onAddTime, onSkip }: { seconds: number; onAddTime: () => void; onSkip: () => void }) {
  return (
    <View style={styles.restBox}>
      <View style={styles.restHeadRow}>
        <Ionicons name="time-outline" size={18} color={colors.primary} />
        <Text style={styles.restText}>{formatClock(seconds)} rest remaining</Text>
      </View>
      <View style={styles.restActionsRow}>
        <Pressable onPress={onAddTime} style={styles.restChip}>
          <Text style={styles.restChipText}>+30 sec</Text>
        </Pressable>
        <Pressable onPress={onSkip} style={styles.restChip}>
          <Text style={styles.restChipText}>Skip Rest</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MiniStepper({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step: number;
}) {
  return (
    <View style={styles.miniStepper}>
      <Text style={styles.miniStepperLabel}>{label}</Text>
      <View style={styles.miniStepperControls}>
        <Pressable onPress={() => onChange(value - step)} style={styles.miniStepBtn} hitSlop={6}>
          <Ionicons name="remove" size={16} color={colors.primary} />
        </Pressable>
        <Text style={styles.miniStepValue}>{Number.isInteger(value) ? value : value.toFixed(1)}</Text>
        <Pressable onPress={() => onChange(value + step)} style={styles.miniStepBtn} hitSlop={6}>
          <Ionicons name="add" size={16} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Extra bottom clearance so the last card's controls (esp. the weight
  // stepper's "+" button, hugging the right edge) never sit under the
  // globally-mounted Ask Agent FAB (bottom-right on every screen).
  screenContent: { paddingBottom: 110 },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: { height: 42, width: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  headerTitle: { flex: 1, color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: "900" },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: "900", textTransform: "uppercase" },
  workoutTitle: { color: colors.ink, fontSize: 25, lineHeight: 31, fontWeight: "900", marginTop: 6 },
  currentLabel: { color: colors.ink, fontSize: 19, fontWeight: "900", marginBottom: 8 },
  exerciseTitle: { color: colors.ink, fontSize: 27, lineHeight: 33, fontWeight: "900", marginBottom: 14 },
  exerciseMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  coachInstruction: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceInset },
  instructionLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  instructionText: { color: colors.ink, fontSize: 15, lineHeight: 21, marginTop: 2 },
  noteTrigger: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  noteTriggerText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  noteBox: { marginTop: 14, gap: 8 },
  noteInput: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    color: colors.ink,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  noteActionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 16 },
  noteCancelText: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  noteSaveButton: { flex: 0, minHeight: 38, paddingHorizontal: 16 },
  setRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  setIcon: { height: 30, width: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  setIconDone: { backgroundColor: colors.ok, borderColor: colors.ok },
  setText: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: "800" },
  setStatus: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  rpeBox: { marginTop: 16, gap: 12 },
  rpeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rpeDot: { height: 34, width: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  rpeDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  rpeText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  rpeTextActive: { color: "#fff" },
  savingText: { color: colors.inkMuted, textAlign: "center", marginTop: 8, fontSize: 13 },
  restBox: { marginTop: 16, marginBottom: 4, padding: 12, borderRadius: 14, backgroundColor: colors.primarySoft, gap: 10 },
  restHeadRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  restText: { color: colors.primary, fontSize: 16, fontWeight: "900" },
  restActionsRow: { flexDirection: "row", gap: 8 },
  restChip: { flex: 1, minHeight: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  restChipText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  // Deliberately compact/left-hugging (not stretched edge-to-edge): the
  // app's global Ask Agent FAB is a fixed ~150px hit target pinned to the
  // bottom-right of every screen, so a stepper "+" button flush against the
  // card's right edge can render directly underneath it and never be
  // reachable. Keeping +/- tight around the value avoids that zone entirely.
  setInputRow: { flexDirection: "row", gap: 28, marginTop: 16, marginBottom: 4 },
  miniStepper: { gap: 6 },
  miniStepperLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  miniStepperControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  miniStepBtn: { height: 32, width: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset, borderWidth: 1, borderColor: colors.line },
  miniStepValue: { minWidth: 28, color: colors.ink, fontSize: 16, fontWeight: "900", textAlign: "center" },
  skipTrigger: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, paddingVertical: 4 },
  skipTriggerText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  skipBox: { marginTop: 14, gap: 10 },
  skipTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  skipChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  skipChip: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  skipChipActive: { borderColor: colors.bad, backgroundColor: colors.badSoft },
  skipChipText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  skipChipTextActive: { color: colors.bad },
});
