/**
 * Plain data tables for Pex's SVG poses — no JSX here. `PexMascot.tsx` reads
 * this generically, so a future swap to Rive/Lottie only touches that one
 * file. Anatomy (ring/body geometry) is fixed and lives in `tourConfig.ts`;
 * this file only holds what changes per pose: eyebrows, eyes, mouth, and a
 * small accessory mark. Path data is transcribed 1:1 from the approved
 * mascot concept (viewBox 0 0 200 190, ring cx100 cy88 r66, body cx100 cy92
 * r46) so Pex looks identical to what the user signed off on.
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

export type ColorToken =
  | "tone"
  | "line"
  | "ready"
  | "caution"
  | "alert"
  | "coach"
  | "athlete"
  | "guardian";

export type PexShape =
  | {
      kind: "path";
      d: string;
      stroke: ColorToken;
      strokeWidth: number;
      opacity?: number;
      linecap?: "round";
      linejoin?: "round";
      fill?: "none";
    }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill?: ColorToken; stroke?: ColorToken; strokeWidth?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: ColorToken }
  | { kind: "rect"; x: number; y: number; width: number; height: number; rx?: number; fill: ColorToken }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: ColorToken; strokeWidth: number; opacity?: number };

export type PexEyeSpec = { cx: number; cy: number; rx: number; ry: number; fill?: ColorToken };

export type PexPoseSpec = {
  /** SVG stroke-dasharray for the 66-radius ring; null renders a full solid ring. */
  ringDasharray: string | null;
  /** Eyebrows, mouth, and any pose-drawn closed/squint eyes (e.g. celebrating, successful) — drawn on top of the body circle. */
  face: PexShape[];
  /**
   * Open, blinkable eyes — kept separate from `face` so `PexMascot` can
   * animate them shut and open again for a natural idle blink. Poses whose
   * "eyes" are already a drawn closed/squint shape (celebrating, successful)
   * leave this empty since there's nothing open to blink.
   */
  eyes: PexEyeSpec[];
  /** Pose-specific extra mark: confetti, arrow, question/exclamation, etc. */
  accessory: PexShape[];
};

const line: ColorToken = "line";

export const PEX_POSES: Record<PexPose, PexPoseSpec> = {
  neutral: {
    ringDasharray: "330 90",
    face: [
      { kind: "path", d: "M78 76 Q88 70 98 76", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M104 76 Q114 70 124 76", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M84 116 Q100 126 116 116", stroke: line, strokeWidth: 4, linecap: "round" },
    ],
    eyes: [
      { cx: 84, cy: 94, rx: 6.5, ry: 8, fill: "line" },
      { cx: 116, cy: 94, rx: 6.5, ry: 8, fill: "line" },
    ],
    accessory: [],
  },
  welcoming: {
    ringDasharray: "330 90",
    face: [
      { kind: "path", d: "M76 70 Q86 64 96 70", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M104 70 Q114 64 124 70", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M82 114 Q100 126 118 114", stroke: line, strokeWidth: 4, linecap: "round" },
    ],
    eyes: [
      { cx: 84, cy: 92, rx: 6.5, ry: 8, fill: "line" },
      { cx: 116, cy: 92, rx: 6.5, ry: 8, fill: "line" },
    ],
    accessory: [{ kind: "path", d: "M40 96 Q28 84 34 68", stroke: "tone", strokeWidth: 4.5, linecap: "round" }],
  },
  celebrating: {
    ringDasharray: null,
    face: [
      { kind: "path", d: "M76 76 Q86 68 96 76", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M104 76 Q114 68 124 76", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M78 96 Q84 88 90 96", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M110 96 Q116 88 122 96", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M78 114 Q100 130 122 114", stroke: line, strokeWidth: 4.5, linecap: "round" },
    ],
    // Already a closed, squinting happy-eye shape drawn above — nothing open to blink.
    eyes: [],
    accessory: [
      { kind: "path", d: "M36 100 Q22 84 30 62", stroke: "tone", strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M164 100 Q178 84 170 62", stroke: "tone", strokeWidth: 4, linecap: "round" },
      { kind: "circle", cx: 66, cy: 50, r: 2.6, fill: "athlete" },
      { kind: "circle", cx: 134, cy: 46, r: 2.6, fill: "guardian" },
      { kind: "circle", cx: 100, cy: 34, r: 2.6, fill: "coach" },
    ],
  },
  thinking: {
    ringDasharray: "240 180",
    face: [
      { kind: "line", x1: 78, y1: 78, x2: 92, y2: 78, stroke: line, strokeWidth: 4 },
      { kind: "line", x1: 108, y1: 78, x2: 122, y2: 78, stroke: line, strokeWidth: 4 },
      { kind: "line", x1: 92, y1: 116, x2: 108, y2: 116, stroke: line, strokeWidth: 4 },
      { kind: "path", d: "M120 108 Q132 100 128 88", stroke: line, strokeWidth: 4, linecap: "round" },
    ],
    eyes: [
      { cx: 84, cy: 94, rx: 5, ry: 6, fill: "line" },
      { cx: 116, cy: 94, rx: 5, ry: 6, fill: "line" },
    ],
    accessory: [
      { kind: "circle", cx: 146, cy: 52, r: 2.4, fill: "caution" },
      { kind: "circle", cx: 152, cy: 62, r: 2, fill: "caution" },
      { kind: "circle", cx: 156, cy: 72, r: 1.6, fill: "caution" },
    ],
  },
  guiding: {
    ringDasharray: "330 90",
    face: [
      { kind: "path", d: "M78 76 Q88 70 98 76", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M104 76 Q114 70 124 76", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M84 116 Q100 126 116 116", stroke: line, strokeWidth: 4, linecap: "round" },
    ],
    eyes: [
      { cx: 84, cy: 94, rx: 6.5, ry: 8, fill: "line" },
      { cx: 116, cy: 94, rx: 6.5, ry: 8, fill: "line" },
    ],
    accessory: [
      { kind: "line", x1: 144, y1: 92, x2: 166, y2: 92, stroke: line, strokeWidth: 4.5 },
      { kind: "path", d: "M158 84 l10 8 l-10 8", stroke: line, strokeWidth: 4, linecap: "round", linejoin: "round", fill: "none" },
    ],
  },
  warning: {
    ringDasharray: "360 60",
    face: [
      { kind: "line", x1: 76, y1: 76, x2: 94, y2: 70, stroke: line, strokeWidth: 4 },
      { kind: "line", x1: 106, y1: 70, x2: 124, y2: 76, stroke: line, strokeWidth: 4 },
      { kind: "ellipse", cx: 100, cy: 116, rx: 7, ry: 5, stroke: "line", strokeWidth: 4 },
    ],
    eyes: [
      { cx: 84, cy: 94, rx: 6, ry: 7, fill: "line" },
      { cx: 116, cy: 94, rx: 6, ry: 7, fill: "line" },
    ],
    accessory: [
      { kind: "rect", x: 96, y: 30, width: 8, height: 20, rx: 4, fill: "alert" },
      { kind: "circle", cx: 100, cy: 58, r: 3.4, fill: "alert" },
    ],
  },
  confused: {
    ringDasharray: "240 180",
    face: [
      { kind: "path", d: "M76 72 Q86 64 96 70", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "line", x1: 106, y1: 78, x2: 122, y2: 78, stroke: line, strokeWidth: 4 },
      { kind: "path", d: "M84 116 q8 6 16 0 q8 6 16 0", stroke: line, strokeWidth: 4, linecap: "round", fill: "none" },
      { kind: "path", d: "M64 96 Q52 90 54 78", stroke: line, strokeWidth: 4, linecap: "round" },
    ],
    eyes: [
      { cx: 84, cy: 92, rx: 6, ry: 7, fill: "line" },
      { cx: 116, cy: 94, rx: 6, ry: 6, fill: "line" },
    ],
    accessory: [
      { kind: "path", d: "M148 46 q10 -6 10 6 q0 8 -8 8", stroke: "caution", strokeWidth: 4, linecap: "round", fill: "none" },
      { kind: "circle", cx: 150, cy: 70, r: 2.6, fill: "caution" },
    ],
  },
  successful: {
    ringDasharray: null,
    face: [
      { kind: "path", d: "M78 88 Q84 82 90 88", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M110 88 Q116 82 122 88", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M82 114 Q100 126 118 114", stroke: line, strokeWidth: 4.5, linecap: "round" },
      { kind: "path", d: "M60 104 Q46 108 44 96", stroke: line, strokeWidth: 4, linecap: "round" },
    ],
    // Calm, content closed eyes — same reasoning as celebrating.
    eyes: [],
    accessory: [
      { kind: "path", d: "M138 60 l8 8 l14 -16", stroke: "tone", strokeWidth: 5, linecap: "round", linejoin: "round", fill: "none" },
    ],
  },
  encouraging: {
    ringDasharray: "280 140",
    face: [
      { kind: "path", d: "M76 74 Q86 68 96 74", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M104 74 Q114 68 124 74", stroke: line, strokeWidth: 4, linecap: "round" },
      { kind: "path", d: "M80 112 Q100 128 120 112", stroke: line, strokeWidth: 4.5, linecap: "round" },
      { kind: "line", x1: 60, y1: 100, x2: 46, y2: 92, stroke: line, strokeWidth: 4 },
      { kind: "line", x1: 140, y1: 100, x2: 154, y2: 92, stroke: line, strokeWidth: 4 },
    ],
    eyes: [
      { cx: 84, cy: 92, rx: 6.5, ry: 8, fill: "line" },
      { cx: 116, cy: 92, rx: 6.5, ry: 8, fill: "line" },
    ],
    accessory: [
      { kind: "line", x1: 30, y1: 70, x2: 16, y2: 60, stroke: "tone", strokeWidth: 4, opacity: 0.55 },
      { kind: "line", x1: 34, y1: 86, x2: 18, y2: 82, stroke: "tone", strokeWidth: 4, opacity: 0.35 },
    ],
  },
};

/** Default pose for a mascot `state` when the caller hasn't set an explicit expression. */
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
