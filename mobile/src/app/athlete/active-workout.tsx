import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AppCard,
  BackHeader,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  ScreenContainer,
  StatusChip,
  VideoThumb,
} from "../../components/fitora";
import { VideoPlayerModal } from "../../components/VideoPlayerModal";
import { apiFetch } from "../../lib/api";
import { celebrate, showError, successFeedback } from "../../lib/feedback";
import { colors, fonts } from "../../lib/theme";
import { prefersReducedMotion, useAnimatedNumber } from "../../lib/motion";
import { summarizeWorkout, workoutSetProgress } from "../../lib/workoutSummary";
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
  // New key per rest, so each rest's ring starts full.
  const [restKey, setRestKey] = useState(0);
  const [repsInput, setRepsInput] = useState(0);
  const [weightInput, setWeightInput] = useState(0);
  const [showSkipReasons, setShowSkipReasons] = useState(false);
  const [skipReason, setSkipReason] = useState<string | null>(null);
  const [skipOtherText, setSkipOtherText] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  // Fallback start for the summary when the server has no startedAt yet.
  const [openedAt] = useState(() => Date.now());
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const progressByIndex = useMemo(() => new Map(assignment.progress.map((row) => [row.exerciseIndex, row])), [assignment.progress]);
  const exercise = assignment.exercises[activeIndex];
  const rowProgress = progressByIndex.get(activeIndex);
  const completedSets = rowProgress?.setsCompleted.length ?? 0;
  const totalSets = exercise?.sets ?? 1;
  const setProgress = workoutSetProgress(assignment.exercises, assignment.progress);
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
      setFinishedAt(Date.now());
      setRestRemaining(null);
      return;
    }
    if (restSec) {
      setRestKey((key) => key + 1);
      setRestRemaining(restSec);
    }
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

  if (done) {
    const startedAtMs = assignment.startedAt ? Date.parse(assignment.startedAt) : openedAt;
    return (
      <WorkoutDone
        name={assignment.name}
        byCoach={assignment.assignedByRole === "coach"}
        summary={summarizeWorkout(assignment.progress, startedAtMs, finishedAt ?? openedAt)}
        selectedRpe={selectedRpe}
        onSelectRpe={setSelectedRpe}
        onLogEffort={() => router.push({ pathname: "/athlete/rpe", params: { sessionType: assignment.slot ?? "gym", rpe: String(selectedRpe) } } as never)}
        onDone={() => router.back()}
      />
    );
  }

  return (
    <>
      <AppCard>
        <Text style={styles.eyebrow}>Exercise {activeIndex + 1} of {assignment.exercises.length}</Text>
        <Text style={styles.workoutTitle}>{assignment.name}</Text>
        <SetSegments done={setProgress.done} total={setProgress.total} />
        <Text style={styles.setCount}>{setProgress.done} of {setProgress.total} sets</Text>
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
            <View key={index} style={[styles.setRow, index === completedSets ? styles.setRowCurrent : null, setDone ? styles.setRowDone : null]}>
              <SetCheck done={setDone} number={index + 1} />
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

        {done ? null : (
          <>
            {restRemaining != null && restRemaining > 0 ? (
              <RestTimer
                key={restKey}
                seconds={restRemaining}
                nextLabel={completedSets > 0 && completedSets < totalSets ? `${exercise.title}, set ${completedSets + 1}` : exercise.title}
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
              busy={saving}
              style={styles.completeButton}
            />

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

const REST_RING = 72;
const REST_STROKE = 7;

/** Countdown ring: drains from full to empty over the rest, in the progress (teal) color. */
function RestTimer({ seconds, nextLabel, onAddTime, onSkip }: { seconds: number; nextLabel: string; onAddTime: () => void; onSkip: () => void }) {
  // The longest value seen this rest is the ring's full length (+30 s extends it).
  const [total, setTotal] = useState(seconds);
  if (seconds > total) setTotal(seconds);
  const r = (REST_RING - REST_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const shown = useAnimatedNumber(total > 0 ? seconds / total : 0, { duration: 900, from: 1 });
  return (
    <View style={styles.restBox} accessibilityRole="timer" accessibilityLabel={`${formatClock(seconds)} rest remaining`}>
      <View style={{ width: REST_RING, height: REST_RING, alignItems: "center", justifyContent: "center" }}>
        <Svg width={REST_RING} height={REST_RING} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={REST_RING / 2} cy={REST_RING / 2} r={r} stroke={colors.surfaceInset} strokeWidth={REST_STROKE} fill="none" />
          <Circle
            cx={REST_RING / 2}
            cy={REST_RING / 2}
            r={r}
            stroke={colors.progress}
            strokeWidth={REST_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - Math.max(0, Math.min(1, shown)))}
          />
        </Svg>
        <Text style={styles.restClock}>{formatClock(seconds)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.restTitle}>Rest</Text>
        <Text style={styles.restNext} numberOfLines={2}>Next: {nextLabel}</Text>
      </View>
      <View style={styles.restActions}>
        <Pressable onPress={onAddTime} accessibilityRole="button" style={({ pressed }) => [styles.restChip, pressed ? styles.pressedChip : null]}>
          <Text style={styles.restChipText}>+30 s</Text>
        </Pressable>
        <Pressable onPress={onSkip} accessibilityRole="button" style={({ pressed }) => [styles.restSkip, pressed ? styles.pressedChip : null]}>
          <Text style={styles.restSkipText}>Skip</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** One thin segment per set across the whole workout; done segments fill lime. */
function SetSegments({ done, total }: { done: number; total: number }) {
  // Past ~24 segments they turn into hairlines, so long workouts get one bar.
  if (total > 24) {
    return (
      <View style={styles.segmentTrack}>
        <View style={[styles.segmentFill, { width: `${(done / total) * 100}%` }]} />
      </View>
    );
  }
  return (
    <View style={styles.segments} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}>
      {Array.from({ length: total }, (_, index) => (
        <View key={index} style={[styles.segment, index < done ? styles.segmentDone : null]} />
      ))}
    </View>
  );
}

/** Set marker: a number while pending, a check that pops in when the set is saved. */
function SetCheck({ done, number }: { done: boolean; number: number }) {
  const [scale] = useState(() => new Animated.Value(1));
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current && !prefersReducedMotion()) {
      scale.setValue(0.6);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
    wasDone.current = done;
  }, [done, scale]);
  return (
    <Animated.View style={[styles.setIcon, done ? styles.setIconDone : null, { transform: [{ scale }] }]}>
      {done ? <Ionicons name="checkmark" size={18} color={colors.onPrimary} /> : <Text style={styles.setNumber}>{number}</Text>}
    </Animated.View>
  );
}

const DONE_RING = 168;
const DONE_STROKE = 12;

/** The payoff after the last set: ring draws, a burst, then the real numbers. */
function WorkoutDone({
  name,
  byCoach,
  summary,
  selectedRpe,
  onSelectRpe,
  onLogEffort,
  onDone,
}: {
  name: string;
  byCoach: boolean;
  summary: ReturnType<typeof summarizeWorkout>;
  selectedRpe: number;
  onSelectRpe: (value: number) => void;
  onLogEffort: () => void;
  onDone: () => void;
}) {
  const ring = useAnimatedNumber(1, { duration: 900 });
  const [burst] = useState(() => new Animated.Value(0));
  const [reveal] = useState(() => [0, 1, 2].map(() => new Animated.Value(0)));
  useEffect(() => {
    successFeedback();
    if (prefersReducedMotion()) {
      burst.setValue(1);
      reveal.forEach((value) => value.setValue(1));
      return;
    }
    Animated.timing(burst, { toValue: 1, duration: 900, delay: 550, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.stagger(
      150,
      reveal.map((value) => Animated.timing(value, { toValue: 1, duration: 300, delay: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }))
    ).start();
  }, [burst, reveal]);

  const r = (DONE_RING - DONE_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const fadeUp = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  });
  const stats = [
    summary.minutes != null ? { value: String(summary.minutes), unit: " min", label: "Time" } : null,
    { value: String(summary.sets), unit: "", label: summary.sets === 1 ? "Set" : "Sets" },
    summary.volumeKg != null ? { value: summary.volumeKg.toLocaleString("en-US"), unit: " kg", label: "Volume" } : null,
  ].filter((stat): stat is { value: string; unit: string; label: string } => stat != null);

  return (
    <View style={styles.doneWrap} accessibilityLiveRegion="polite">
      <View style={styles.doneRingWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.doneBurst,
            {
              opacity: burst.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.6, 0] }),
              transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.6] }) }],
            },
          ]}
        />
        <Svg width={DONE_RING} height={DONE_RING} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={DONE_RING / 2} cy={DONE_RING / 2} r={r} stroke={colors.surfaceInset} strokeWidth={DONE_STROKE} fill="none" />
          <Circle
            cx={DONE_RING / 2}
            cy={DONE_RING / 2}
            r={r}
            stroke={colors.primary}
            strokeWidth={DONE_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - ring)}
            opacity={ring > 0.01 ? 1 : 0}
          />
        </Svg>
        <Ionicons name="checkmark" size={64} color={colors.primary} />
      </View>

      <Animated.View style={[styles.doneCopy, fadeUp(reveal[0])]}>
        <Text style={styles.doneTitle}>Workout done</Text>
        <Text style={styles.doneSub}>{byCoach ? `${name} · your coach will see it` : name}</Text>
      </Animated.View>

      <Animated.View style={[styles.doneStats, fadeUp(reveal[1])]}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.doneStat}>
            <Text style={styles.doneStatValue}>
              {stat.value}
              <Text style={styles.doneStatUnit}>{stat.unit}</Text>
            </Text>
            <Text style={styles.doneStatLabel}>{stat.label}</Text>
          </View>
        ))}
      </Animated.View>

      <Animated.View style={[styles.doneRpe, fadeUp(reveal[2])]}>
        <Text style={styles.doneRpeTitle}>How hard was it?</Text>
        <View style={styles.rpeRow}>
          {Array.from({ length: 10 }, (_, index) => (
            <Pressable
              key={index}
              onPress={() => onSelectRpe(index + 1)}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedRpe === index + 1 }}
              style={[styles.rpeDot, selectedRpe === index + 1 ? styles.rpeDotActive : null]}
            >
              <Text style={[styles.rpeText, selectedRpe === index + 1 ? styles.rpeTextActive : null]}>{index + 1}</Text>
            </Pressable>
          ))}
        </View>
        <ActionButton label="Log Effort" variant="filled" onPress={onLogEffort} style={styles.completeButton} />
        <ActionButton label="Done" onPress={onDone} style={styles.completeButton} />
      </Animated.View>
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
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: "900", textTransform: "uppercase" },
  workoutTitle: { fontFamily: fonts.display, textTransform: "uppercase", color: colors.ink, fontSize: 29, lineHeight: 33, marginTop: 6 },
  currentLabel: { color: colors.ink, fontSize: 19, fontWeight: "900", marginBottom: 8 },
  exerciseTitle: { fontFamily: fonts.display, textTransform: "uppercase", color: colors.ink, fontSize: 31, lineHeight: 35, marginBottom: 14 },
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
  setRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10 },
  setRowCurrent: { backgroundColor: colors.surfaceInset },
  setRowDone: { opacity: 0.7 },
  setNumber: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  setCount: { color: colors.inkMuted, fontSize: 13, fontWeight: "700", marginTop: 8 },
  segments: { flexDirection: "row", gap: 4, marginTop: 14 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceInset },
  segmentDone: { backgroundColor: colors.primary },
  segmentTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceInset, marginTop: 14, overflow: "hidden" },
  segmentFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  completeButton: { minHeight: 54, marginTop: 14 },
  setIcon: { height: 30, width: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  setIconDone: { backgroundColor: colors.ok, borderColor: colors.ok },
  setText: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: "800" },
  setStatus: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  rpeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rpeDot: { height: 34, width: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  rpeDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  rpeText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  rpeTextActive: { color: colors.onPrimary },
  restBox: { marginTop: 16, marginBottom: 4, padding: 12, borderRadius: 16, backgroundColor: colors.surfaceInset, flexDirection: "row", alignItems: "center", gap: 14 },
  restClock: { fontFamily: fonts.display, color: colors.ink, fontSize: 22 },
  restTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  restNext: { color: colors.inkMuted, fontSize: 13, fontWeight: "600", marginTop: 2 },
  restActions: { gap: 8 },
  restChip: { minHeight: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  restChipText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  restSkip: { minHeight: 34, paddingHorizontal: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  restSkipText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  pressedChip: { opacity: 0.88, transform: [{ scale: 0.96 }] },
  doneWrap: { alignItems: "center", paddingTop: 24, paddingBottom: 8, gap: 18 },
  doneRingWrap: { width: DONE_RING, height: DONE_RING, alignItems: "center", justifyContent: "center" },
  doneBurst: { position: "absolute", width: DONE_RING, height: DONE_RING, borderRadius: DONE_RING / 2, backgroundColor: colors.energy },
  doneCopy: { alignItems: "center", gap: 4 },
  doneTitle: { fontFamily: fonts.display, textTransform: "uppercase", color: colors.ink, fontSize: 40, lineHeight: 44 },
  doneSub: { color: colors.inkMuted, fontSize: 15, fontWeight: "600", textAlign: "center" },
  doneStats: { flexDirection: "row", gap: 10, alignSelf: "stretch" },
  doneStat: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 16, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  doneStatValue: { fontFamily: fonts.display, color: colors.ink, fontSize: 28 },
  doneStatUnit: { fontFamily: fonts.display, color: colors.inkMuted, fontSize: 16 },
  doneStatLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  doneRpe: { alignSelf: "stretch", gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  doneRpeTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
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
