// Shared Fitora design tokens for the Expo mobile app.

import type { Role } from "./roles";

// Teal + Coral palette (chosen over the original blue). One job per color:
// primary teal = things you tap; progress teal = rings/bars/goals; coral
// "energy" = streaks and celebrations (fills/icons only, text uses energyInk);
// amber/red = warnings and problems only. Every text pairing below is >= 4.5:1
// (WCAG AA) on white, surface, surfaceInset and its own *Soft background.
export const colors = {
  surface: "#f5faf9",
  surfaceRaised: "#ffffff",
  surfaceInset: "#edf5f3",
  ink: "#10201e",
  inkMuted: "#3e5552",
  inkFaint: "#4f6764",
  line: "#cfdfdb",
  lineStrong: "#b9ceca",
  primary: "#0f766e",
  primaryStrong: "#0b5f58",
  primarySoft: "#e3f4f1",
  progress: "#14b8a6",
  progressSoft: "#dcf3ef",
  energy: "#f4573d",
  energySoft: "#fdeeea",
  energyInk: "#b3361f",
  ok: "#157a3a",
  okSoft: "#e8f7ed",
  warn: "#b45309",
  warnSoft: "#fff7e6",
  bad: "#c81e1e",
  badSoft: "#feecec",
} as const;

export type IconName = "home-outline" | "barbell-outline";

export type RoleTheme = {
  role: Role;
  label: string;
  heading: string;
  subcopy: string;
  tagline: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  accentSoft: string;
  icon: IconName;
};

export const ROLE_THEMES: Record<Role, RoleTheme> = {
  athlete: {
    role: "athlete",
    label: "Athlete",
    heading: "Your coaching day, simplified.",
    subcopy: "Workout, nutrition, coaching and progress in one place.",
    tagline: "Fitness, nutrition and coaching",
    accent: colors.primary,
    accentStrong: colors.primaryStrong,
    accentInk: "#ffffff",
    accentSoft: colors.primarySoft,
    icon: "home-outline",
  },
  coach: {
    role: "coach",
    label: "Coach",
    heading: "Coach every client with context.",
    subcopy: "Plans, sessions, content and client readiness in one flow.",
    tagline: "Clients, plans and content",
    accent: colors.primary,
    accentStrong: colors.primaryStrong,
    accentInk: "#ffffff",
    accentSoft: colors.primarySoft,
    icon: "barbell-outline",
  },
};

export const ROLE_THEME_LIST: RoleTheme[] = [
  ROLE_THEMES.athlete,
  ROLE_THEMES.coach,
];

export const radius = { sm: 8, md: 12, lg: 16, xl: 18, pill: 999 } as const;

/**
 * One color per metric, used everywhere that number appears (rings, bars,
 * icons, chips), so people read the screen by color like Apple's rings.
 * `from`/`to` = ring gradient, `track` = empty ring, `ink` = text-safe
 * (>= 4.5:1 on white), `soft` = tinted background.
 */
export const metricColors = {
  readiness: { from: "#5eead4", to: "#0f766e", track: "#dcf3ef", ink: "#0f766e", soft: "#e3f4f1" },
  nutrition: { from: "#ffb199", to: "#e2452b", track: "#fdeeea", ink: "#b3361f", soft: "#fdeeea" },
  water: { from: "#93c5fd", to: "#2f7df6", track: "#e3eefe", ink: "#1f5fc8", soft: "#eaf2fe" },
  training: { from: "#c4b5fd", to: "#7c3aed", track: "#efe9fe", ink: "#6d28d9", soft: "#f3eefe" },
} as const;
export type MetricKey = keyof typeof metricColors;

/** Layout rhythm shared by every screen. */
export const layout = {
  gutter: 16,
  sectionGap: 12,
  cardPadding: 14,
  cardRadius: 16,
} as const;
export const space = (n: number) => n * 4;
