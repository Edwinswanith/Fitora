// Pex's expressions as plain data. PexMascot draws any of these; lib/pex/brain.ts
// picks one from the athlete's (or coach's) current state.

export type PexFace =
  | "ready"
  | "welcome"
  | "guide"
  | "sleepyMorning"
  | "pumped"
  | "focus"
  | "curious"
  | "hungry"
  | "thirsty"
  | "proud"
  | "calm"
  | "worried"
  | "gentle"
  | "waiting"
  | "news"
  | "sleepy"
  | "alarm";

export type PexMouth = "smile" | "grin" | "o" | "flat" | "smirk" | "worried";
export type PexMotion = "bob" | "bounce" | "shake" | "droop" | "lean";
export type PexExtra = "zzz" | "drop" | "sweat";
export type PexTone = "ready" | "caution" | "alert";

export type PexFaceSpec = {
  /** Resting closure of each upper lid: 0 wide open, 1 shut. */
  lidLeft: number;
  lidRight: number;
  /** Lower lids pushed up into a happy squint. */
  smile: boolean;
  /** Where the pupils look, in tenths of the eye radius (x right, y down). */
  gaze: [number, number];
  /** Degrees the lids tilt toward the nose (worried look). */
  tilt: number;
  mouth: PexMouth;
  motion: PexMotion;
  extra?: PexExtra;
  /** Eyes glance around now and then (only for relaxed faces). */
  roam: boolean;
};

const face = (spec: Partial<PexFaceSpec> & { lid?: number }): PexFaceSpec => ({
  lidLeft: spec.lidLeft ?? spec.lid ?? 0.1,
  lidRight: spec.lidRight ?? spec.lid ?? 0.1,
  smile: spec.smile ?? false,
  gaze: spec.gaze ?? [0, 0],
  tilt: spec.tilt ?? 0,
  mouth: spec.mouth ?? "smile",
  motion: spec.motion ?? "bob",
  extra: spec.extra,
  roam: spec.roam ?? false,
});

export const PEX_FACES: Record<PexFace, PexFaceSpec> = {
  ready: face({ lid: 0.1, gaze: [0, 0.6], roam: true }),
  welcome: face({ lid: 0, mouth: "grin", motion: "bounce" }),
  guide: face({ lid: 0.08, gaze: [-3, 4] }),
  sleepyMorning: face({ lid: 0.45, gaze: [0, 1], mouth: "o", motion: "droop" }),
  pumped: face({ lid: 0, mouth: "grin", motion: "bounce" }),
  focus: face({ lid: 0.32, mouth: "flat" }),
  curious: face({ lidLeft: 0.05, lidRight: 0.35, gaze: [3, -2], mouth: "smirk", motion: "lean" }),
  hungry: face({ lid: 0.12, gaze: [-3, 3], mouth: "o" }),
  thirsty: face({ lid: 0.15, gaze: [-2, 3], mouth: "o", extra: "drop" }),
  proud: face({ lid: 0.22, smile: true, mouth: "grin", motion: "bounce" }),
  calm: face({ lid: 0.08, smile: true }),
  worried: face({ lid: 0.38, tilt: 14, gaze: [0, 2], mouth: "worried", motion: "shake" }),
  gentle: face({ lid: 0.18, tilt: 8, gaze: [0, 1] }),
  waiting: face({ lid: 0.25, gaze: [4, -3], mouth: "flat", motion: "lean" }),
  news: face({ lid: 0, gaze: [4, -4], mouth: "o", motion: "bounce" }),
  sleepy: face({ lid: 0.62, gaze: [0, 2], mouth: "o", motion: "droop", extra: "zzz" }),
  alarm: face({ lid: 0.3, tilt: 16, mouth: "worried", motion: "shake", extra: "sweat" }),
};

/** The guided tour and reaction overlay still speak in the older pose names. */
export type LegacyPexPose =
  | "neutral"
  | "welcoming"
  | "celebrating"
  | "thinking"
  | "guiding"
  | "warning"
  | "confused"
  | "successful"
  | "encouraging";

export const FACE_FOR_LEGACY_POSE: Record<LegacyPexPose, PexFace> = {
  neutral: "ready",
  welcoming: "welcome",
  celebrating: "proud",
  thinking: "waiting",
  guiding: "guide",
  warning: "worried",
  confused: "curious",
  successful: "calm",
  encouraging: "gentle",
};
