// Shared Fitora design tokens for the Expo mobile app.

import type { Role } from "./roles";

// Dark sports palette ("Fitora Dark"): near-black ground, slightly lighter
// cards, one electric-lime accent. One job per color: primary lime = things
// you tap (text on it is `onPrimary`, never white); progress teal =
// rings/bars/goals; orange "energy" = streaks and celebrations; amber/red =
// warnings and problems only. Every text pairing below is >= 4.5:1 (WCAG AA)
// on surface, surfaceRaised and surfaceInset.
export const colors = {
  surface: "#0a0d12",
  surfaceRaised: "#12171e",
  surfaceInset: "#1a212a",
  ink: "#f2f5f8",
  inkMuted: "#9aa4b2",
  inkFaint: "#8a94a3",
  line: "#252d38",
  lineStrong: "#3a4553",
  primary: "#c8f250",
  primaryStrong: "#b2dc3a",
  primarySoft: "#1e2a10",
  onPrimary: "#0a0d12",
  progress: "#2dd4bf",
  progressSoft: "#1d3b39",
  energy: "#ff8a3d",
  energySoft: "#2a1a12",
  energyInk: "#ff9f5e",
  ok: "#4ade80",
  okSoft: "#12291a",
  warn: "#ffb547",
  warnSoft: "#2e2412",
  bad: "#ff6b78",
  badSoft: "#331418",
  /** Scrim behind sheets and modals. */
  overlay: "rgba(0, 0, 0, 0.6)",
} as const;

/** Barlow Condensed for screen titles, hero titles and big numbers (uppercase); Manrope for everything else (see AppText). */
export const fonts = {
  display: "BarlowCondensed_800ExtraBold",
  displayBold: "BarlowCondensed_700Bold",
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
    accentInk: colors.onPrimary,
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
    accentInk: colors.onPrimary,
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
 * (>= 4.5:1 on the dark surfaces), `soft` = tinted background.
 */
export const metricColors = {
  readiness: { from: "#5eead4", to: "#2dd4bf", track: "#1d3b39", ink: "#5eead4", soft: "#12302d" },
  nutrition: { from: "#ffb199", to: "#ff7a59", track: "#3a2520", ink: "#ff9a80", soft: "#2e1c17" },
  water: { from: "#93c5fd", to: "#5aa9ff", track: "#1c2b40", ink: "#7dbbff", soft: "#152234" },
  training: { from: "#ddd6fe", to: "#a78bfa", track: "#2a2340", ink: "#c4b5fd", soft: "#211b33" },
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
