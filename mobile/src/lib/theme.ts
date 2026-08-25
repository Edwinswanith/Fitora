// Shared Fitora design tokens for the Expo mobile app.

import type { Role } from "./roles";

export const colors = {
  surface: "#fbfcff",
  surfaceRaised: "#ffffff",
  surfaceInset: "#f5f7fb",
  ink: "#0f172a",
  inkMuted: "#475569",
  inkFaint: "#64748b",
  line: "#e2e8f0",
  lineStrong: "#cbd5e1",
  primary: "#0b5cff",
  primaryStrong: "#0048d9",
  primarySoft: "#eaf1ff",
  ok: "#16a34a",
  okSoft: "#e8f7ed",
  warn: "#f59e0b",
  warnSoft: "#fff7e6",
  bad: "#ef4444",
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
    label: "User",
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
export const space = (n: number) => n * 4;
