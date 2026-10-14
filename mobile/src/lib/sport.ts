// An athlete's sport is optional: the server stores "Not set" until they pick
// one in onboarding, and that placeholder must never reach the screen.

const NOT_SET = "not set";

/** Sports offered in onboarding; anything else goes in "Other". */
export const SPORT_OPTIONS = ["Cricket", "Football", "Running", "Badminton", "Basketball", "Tennis", "Swimming", "Strength training"] as const;

/** The sport to show, or null when the athlete hasn't picked one. */
export function sportLabel(sport?: string | null): string | null {
  const value = sport?.trim();
  if (!value || value.toLowerCase() === NOT_SET) return null;
  return value;
}
