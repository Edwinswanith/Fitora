import type { PexPose, PexTone } from "./mascotPoses";

export type MascotReactionName = "athlete.checkin.success" | "athlete.checkin.error" | "notifications.empty" | "tour.completed";

export type MascotReactionSpec = { pose: PexPose; tone: PexTone; message: string; durationMs: number };

export const MASCOT_REACTIONS: Record<MascotReactionName, MascotReactionSpec> = {
  "athlete.checkin.success": { pose: "successful", tone: "ready", message: "Check-in saved — nice consistency!", durationMs: 1600 },
  "athlete.checkin.error": {
    pose: "confused",
    tone: "alert",
    message: "That didn't save — check your connection and try again.",
    durationMs: 2400,
  },
  "notifications.empty": {
    pose: "welcoming",
    tone: "ready",
    message: "You're all caught up. Nothing needs your attention right now.",
    durationMs: 2200,
  },
  "tour.completed": {
    pose: "celebrating",
    tone: "ready",
    message: "Tour complete! You're all set to explore.",
    durationMs: 2400,
  },
};

type ReactionEvent = { name: MascotReactionName; token: number };
type Listener = (event: ReactionEvent) => void;

let listener: Listener | null = null;
let tokenCounter = 0;

/**
 * Fires a one-off mascot reaction. No React context needed — there's only
 * ever one listener (the singleton `MascotReactionOverlay` mounted at the app
 * root), so a tiny module-level pub/sub is simpler than another Provider
 * nested inside `MobileTourProvider`. Reactions never walk; they just pop in
 * near a fixed on-screen spot and fade out on their own.
 */
export function fireMascotReaction(name: MascotReactionName): void {
  listener?.({ name, token: ++tokenCounter });
}

export function subscribeMascotReactions(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
