/**
 * Pose and state names the guided tour and reaction overlay use for Pex.
 * The drawing itself lives in components/mascot/PexMascot.tsx, which maps
 * each pose to an expression in lib/pex/faces.ts.
 */

export type PexPose =
  | "neutral"
  | "welcoming"
  | "celebrating"
  | "thinking"
  | "guiding"
  | "warning"
  | "confused"
  | "successful"
  | "encouraging";

export type PexTone = "ready" | "caution" | "alert";

export type PexMascotState =
  | "entering"
  | "walking"
  | "pointing"
  | "speaking"
  | "listening"
  | "waiting"
  | "leaving"
  | "returning";

export const DEFAULT_POSE_FOR_STATE: Record<PexMascotState, PexPose> = {
  entering: "welcoming",
  walking: "neutral",
  pointing: "guiding",
  speaking: "neutral",
  listening: "thinking",
  waiting: "neutral",
  leaving: "neutral",
  returning: "welcoming",
};
