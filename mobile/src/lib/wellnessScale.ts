/**
 * Single shared conversion between the scale an athlete speaks a wellness/RPE
 * sub-score in (1-10, matching the V2 voice assistant's system prompt) and
 * the scale the app stores it in (1-5). V1 has two independent copies of this
 * same formula (RoleAskAgentOverlays.tsx and athlete/dashboard.tsx); this is
 * the single copy for V2 code paths — see mobile/AGENTS.md-adjacent plan notes.
 */
export function spokenTenToFive(raw: number): number {
  const clamped = Math.max(1, Math.min(10, raw));
  return 1 + ((clamped - 1) * 4) / 9;
}
