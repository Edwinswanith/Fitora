import { summarizeWorkout, workoutSetProgress } from "../workoutSummary";

const set = (reps: number | null, weightKg: number | null) => ({ reps, weightKg });

describe("workoutSetProgress", () => {
  const exercises = [{ sets: 3 }, { sets: 2 }, { sets: null }];

  it("counts logged sets and whole finished or skipped exercises", () => {
    const progress = [
      { exerciseIndex: 0, status: "completed", setsCompleted: [set(6, 60), set(6, 60), set(6, 60)] },
      { exerciseIndex: 1, status: "in_progress", setsCompleted: [set(8, 50)] },
    ];
    expect(workoutSetProgress(exercises, progress)).toEqual({ done: 4, total: 6 });
    const skipped = [...progress, { exerciseIndex: 2, status: "skipped", setsCompleted: [] }];
    expect(workoutSetProgress(exercises, skipped)).toEqual({ done: 5, total: 6 });
  });
});

describe("summarizeWorkout", () => {
  const start = Date.parse("2026-10-13T07:00:00Z");

  it("sums volume only over sets with reps and weight", () => {
    const summary = summarizeWorkout(
      [
        { exerciseIndex: 0, status: "completed", setsCompleted: [set(6, 60), set(6, 60), set(6, null)] },
        { exerciseIndex: 1, status: "completed", setsCompleted: [set(8, 50), set(null, 50)] },
      ],
      start,
      start + 38 * 60000
    );
    expect(summary).toEqual({ minutes: 38, sets: 5, volumeKg: 1120 });
  });

  it("hides volume with no weight and time that is not believable", () => {
    const progress = [{ exerciseIndex: 0, status: "completed", setsCompleted: [set(10, null)] }];
    expect(summarizeWorkout(progress, start, start + 26 * 3600e3)).toEqual({ minutes: null, sets: 1, volumeKg: null });
    expect(summarizeWorkout(progress, null, start).minutes).toBeNull();
  });
});
