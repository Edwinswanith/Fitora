/** Human-readable label + formatted value for each entity key the confirmation card can show. Pure — no React/Expo import, unit-testable directly. */
const FIELD_LABELS: Record<string, string> = {
  sessionType: "Session",
  status: "Status",
  workoutType: "Workout",
  actualDurationMin: "Duration",
  sets: "Sets",
  reps: "Reps",
  notes: "Notes",
  rpe: "RPE",
  effortScore: "Effort",
  trainingCategory: "Category",
  plannedIntensityPercent: "Planned intensity",
  sleepQuality: "Sleep quality",
  mood: "Mood",
  stress: "Stress",
  soreness: "Soreness",
  fatigue: "Fatigue",
  sleepHours: "Hours slept",
  amountMl: "Amount",
  goalMl: "Goal",
  enabled: "Enabled",
  intervalMinutes: "Reminder spacing",
  modalities: "Modalities",
  skipped: "Skipped",
  wakeHr: "Wake heart rate",
  bedHr: "Resting heart rate",
  heightCm: "Height",
  weightKg: "Weight",
  position: "Position",
  body: "Message",
};

function formatValue(key: string, value: unknown): string {
  if (key === "actualDurationMin") return `${value} min`;
  if (key === "amountMl" || key === "goalMl") return `${value} ml`;
  if (key === "intervalMinutes") return `${value} min apart`;
  if (key === "plannedIntensityPercent") return `${value}%`;
  if (key === "heightCm") return `${value} cm`;
  if (key === "weightKg") return `${value} kg`;
  if (key === "wakeHr" || key === "bedHr") return `${value} bpm`;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export type EntityDisplayRow = { key: string; label: string; value: string };

export function formatEntitiesForDisplay(entities: Record<string, unknown>): EntityDisplayRow[] {
  return Object.entries(entities)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({ key, label: FIELD_LABELS[key] ?? key, value: formatValue(key, value) }));
}
