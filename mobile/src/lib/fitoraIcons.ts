import type { Ionicons } from "@expo/vector-icons";
import { colors } from "./theme";

export type FitoraIconName = keyof typeof Ionicons.glyphMap;
export type FitoraTone = "neutral" | "primary" | "success" | "warning" | "danger";

export type FitoraVisual = {
  icon: FitoraIconName;
  tone: FitoraTone;
  color: string;
};

function normalize(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function hasAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function visual(icon: FitoraIconName, tone: FitoraTone = "primary", color: string = colors.primary): FitoraVisual {
  return { icon, tone, color };
}

export function exerciseVisual(title?: string | null, type?: string | null): FitoraVisual {
  const text = normalize(title, type);

  if (hasAny(text, ["bench", "chest press"])) {
    return visual("barbell-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["shoulder", "overhead", "military press", "lateral raise"])) {
    return visual("barbell-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["push-up", "pushup", "push ups"])) {
    return visual("body-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["lat ", " lat", "pulldown", "pull down", "pull-up", "pullup", "chin-up", "chinup", "row"])) {
    return visual("body-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["mobility", "stretch", "recovery", "yoga", "warmup", "warm-up", "cooldown", "cool-down"])) {
    return visual("accessibility-outline", "success", colors.ok);
  }
  if (hasAny(text, ["squat", "deadlift", "lunge", "leg", "lower", "glute", "calf", "hamstring", "quad"])) {
    return visual("walk-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["run", "cardio", "bike", "cycle", "hiit", "sprint", "conditioning", "interval"])) {
    return visual("pulse-outline", "warning", colors.warn);
  }
  if (hasAny(text, ["plank", "core", "abs", "sit-up", "situp", "crunch"])) {
    return visual("body-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["check", "task", "readiness", "log", "watch"])) {
    return visual("checkbox-outline", "primary", colors.primary);
  }

  return visual("barbell-outline");
}

export function workoutVisual(name?: string | null, type?: string | null): FitoraVisual {
  const text = normalize(name, type);

  if (hasAny(text, ["meal", "nutrition", "calorie", "protein", "macro"])) {
    return visual("restaurant-outline", "success", colors.ok);
  }
  if (hasAny(text, ["quick", "task", "checklist", "habit"])) {
    return visual("checkbox-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["routine", "program", "cycle"])) {
    return visual("repeat-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["mobility", "stretch", "recovery", "yoga", "warmup", "warm-up", "cooldown", "cool-down"])) {
    return visual("accessibility-outline", "success", colors.ok);
  }
  if (hasAny(text, ["lower", "leg", "squat", "deadlift", "lunge", "glute", "calf", "hamstring", "quad"])) {
    return visual("walk-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["cardio", "run", "bike", "cycle", "hiit", "sprint", "conditioning", "interval"])) {
    return visual("pulse-outline", "warning", colors.warn);
  }
  if (hasAny(text, ["upper", "body", "strength", "push", "pull", "bench", "press", "workout", "training", "exercise"])) {
    return visual("barbell-outline", "primary", colors.primary);
  }

  return visual("barbell-outline");
}

export function planVisual(name?: string | null, type?: string | null): FitoraVisual {
  const text = normalize(name, type);

  if (hasAny(text, ["meal", "nutrition", "calorie", "protein", "macro", "diet"])) {
    return visual("restaurant-outline", "success", colors.ok);
  }
  if (hasAny(text, ["quick", "task", "checklist", "habit", "to-do", "todo"])) {
    return visual("checkbox-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["routine", "program", "cycle", "repeat"])) {
    return visual("repeat-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["video", "content", "tutorial", "library"])) {
    return visual("play-circle-outline", "primary", colors.primary);
  }
  if (hasAny(text, ["session", "call", "booking", "appointment", "review"])) {
    return visual("calendar-outline", "primary", colors.primary);
  }

  return workoutVisual(name, type);
}

export function mealVisual(type?: string | null): FitoraVisual {
  const text = normalize(type);

  if (text.includes("breakfast")) return visual("sunny-outline", "warning", colors.warn);
  if (text.includes("lunch")) return visual("partly-sunny-outline", "success", colors.ok);
  if (text.includes("snack")) return visual("cafe-outline", "primary", "#6d5dfc");
  if (text.includes("dinner")) return visual("restaurant-outline", "warning", "#f97316");

  return visual("restaurant-outline", "success", colors.ok);
}

export function activityVisual(kind?: string | null, title?: string | null): FitoraVisual {
  const text = normalize(kind, title);

  if (hasAny(text, ["water", "hydration"])) return visual("water-outline", "primary", colors.primary);
  if (hasAny(text, ["video", "content", "tutorial", "watched"])) return visual("play-circle-outline", "primary", colors.primary);
  if (hasAny(text, ["meal", "nutrition", "food", "lunch", "breakfast", "dinner", "snack"])) return visual("restaurant-outline", "success", colors.ok);
  if (hasAny(text, ["readiness", "check-in", "checkin"])) return visual("speedometer-outline", "primary", colors.primary);
  if (hasAny(text, ["workout", "training", "exercise", "completed"])) return visual("barbell-outline", "primary", colors.primary);
  if (hasAny(text, ["session", "booking", "call"])) return visual("calendar-outline", "primary", colors.primary);
  if (hasAny(text, ["payment", "billing", "membership"])) return visual("card-outline", "danger", colors.bad);
  if (hasAny(text, ["note", "message", "coach"])) return visual("chatbubble-outline", "primary", colors.primary);

  return visual("pulse-outline", "primary", colors.primary);
}
