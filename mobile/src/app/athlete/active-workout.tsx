import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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
import { apiFetch } from "../../lib/api";
import { colors } from "../../lib/theme";
import { loadWorkoutDetail, useAsyncData, type WorkoutAssignmentDetail } from "../../lib/fitoraData";

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
        <EmptyState title="No workout selected" body="Open a workout from the Workouts tab to continue training." icon="barbell-outline" />
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

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <BackHeader title={state.data.name} onBack={() => router.back()} />
      <WorkoutTask assignment={state.data} onChanged={state.reload} />
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

function WorkoutTask({ assignment, onChanged }: { assignment: WorkoutAssignmentDetail; onChanged: () => void }) {
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

  const progressByIndex = useMemo(() => new Map(assignment.progress.map((row) => [row.exerciseIndex, row])), [assignment.progress]);
  const exercise = assignment.exercises[activeIndex];
  const rowProgress = progressByIndex.get(activeIndex);
  const completedSets = rowProgress?.setsCompleted.length ?? 0;
  const totalSets = exercise?.sets ?? 1;
  const overall = assignment.exerciseCount ? assignment.completedCount / assignment.exerciseCount : 0;

  async function completeSet() {
    if (!exercise || saving) return;
    setSaving(true);
    const setsCompleted = Array.from({ length: Math.min(totalSets, completedSets + 1) }, (_, index) => ({
      setNumber: index + 1,
    }));
    const status = setsCompleted.length >= totalSets ? "completed" : "in_progress";
    const res = await apiFetch(`/api/athlete/workout-assignments/${assignment.id}/exercises/${activeIndex}/progress`, {
      method: "POST",
      body: JSON.stringify({ status, setsCompleted }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      if (status === "completed" && activeIndex < assignment.exercises.length - 1) {
        setActiveIndex((index) => index + 1);
      } else if (status === "completed" && activeIndex >= assignment.exercises.length - 1) {
        setDone(true);
      }
      onChanged();
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
        <VideoThumb duration={exercise.mediaId ? "Video" : null} title={exercise.title} category={exercise.type} />
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
      </AppCard>

      <AppCard>
        <Text style={styles.currentLabel}>Sets</Text>
        {Array.from({ length: totalSets }, (_, index) => {
          const setDone = index < completedSets;
          return (
            <View key={index} style={styles.setRow}>
              <View style={[styles.setIcon, setDone ? styles.setIconDone : null]}>
                <Ionicons name={setDone ? "checkmark" : "ellipse-outline"} size={20} color={setDone ? "#fff" : colors.inkMuted} />
              </View>
              <Text style={styles.setText}>Set {index + 1}</Text>
              <Text style={styles.setStatus}>{setDone ? "Complete" : "Pending"}</Text>
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
          <ActionButton label={activeIndex === assignment.exercises.length - 1 && completedSets + 1 >= totalSets ? "Finish Workout" : "Complete Set"} variant="filled" onPress={completeSet} />
        )}
        {saving ? <Text style={styles.savingText}>Saving progress...</Text> : null}
      </AppCard>
    </>
  );
}

const styles = StyleSheet.create({
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
});
