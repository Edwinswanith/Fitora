// Numbers for the active-workout screen: set progress across the whole
// workout, and the "Workout done" summary. Only real logged data is shown:
// volume needs logged weight, and time needs a believable start.

type Exercise = { sets: number | null };
type Progress = {
  exerciseIndex: number;
  status: string;
  setsCompleted: { reps: number | null; weightKg: number | null }[];
};

/** A workout open longer than this was resumed later; its clock time means nothing. */
const MAX_CREDIBLE_MINUTES = 4 * 60;

function plannedSets(exercise: Exercise): number {
  return Math.max(1, exercise.sets ?? 1);
}

/** Set-level progress across every exercise. A finished or skipped exercise counts all of its sets. */
export function workoutSetProgress(exercises: Exercise[], progress: Progress[]): { done: number; total: number } {
  const byIndex = new Map(progress.map((row) => [row.exerciseIndex, row]));
  let done = 0;
  let total = 0;
  exercises.forEach((exercise, index) => {
    const planned = plannedSets(exercise);
    total += planned;
    const row = byIndex.get(index);
    if (!row) return;
    done += row.status === "completed" || row.status === "skipped" ? planned : Math.min(planned, row.setsCompleted.length);
  });
  return { done, total };
}

export type WorkoutSummary = {
  /** Whole minutes, or null when the start time is unknown or not believable. */
  minutes: number | null;
  /** Sets actually logged (skipped exercises add none). */
  sets: number;
  /** Sum of reps x kg over sets with both logged, or null when no weight was logged. */
  volumeKg: number | null;
};

export function summarizeWorkout(progress: Progress[], startedAtMs: number | null, nowMs: number): WorkoutSummary {
  let sets = 0;
  let volume = 0;
  for (const row of progress) {
    sets += row.setsCompleted.length;
    for (const set of row.setsCompleted) {
      if (set.reps && set.weightKg) volume += set.reps * set.weightKg;
    }
  }
  let minutes: number | null = null;
  if (startedAtMs != null && Number.isFinite(startedAtMs) && nowMs >= startedAtMs) {
    const elapsed = Math.round((nowMs - startedAtMs) / 60000);
    minutes = elapsed <= MAX_CREDIBLE_MINUTES ? Math.max(1, elapsed) : null;
  }
  return { minutes, sets, volumeKg: volume > 0 ? Math.round(volume) : null };
}
