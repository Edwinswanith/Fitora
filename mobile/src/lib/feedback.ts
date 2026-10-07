import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Touch feedback for meaningful moments (a save, a goal hit, a choice made).
// Deliberately not wired into every button press: haptics on everything stop
// meaning anything. Web has no haptics, so every call is a safe no-op there.

const enabled = Platform.OS === "ios" || Platform.OS === "android";

/** A light tick when the user picks an option (rating, chip, slot). */
export function selectionFeedback(): void {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => undefined);
}

/** Something was saved or completed. */
export function successFeedback(): void {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** A save failed or needs attention. */
export function errorFeedback(): void {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

export type CelebrationOptions = {
  title: string;
  body?: string;
  /** A daily goal or a whole workout finished: bigger, centered celebration. */
  big?: boolean;
};

type Listener = (options: CelebrationOptions) => void;
let listener: Listener | null = null;

/** Registered by <FeedbackHost /> (mounted once in app/_layout.tsx). */
export function setCelebrationListener(next: Listener | null): void {
  listener = next;
}

/**
 * Success haptic + animated confirmation. Call after the server confirms the
 * save (the database is the source of truth), never optimistically.
 */
export function celebrate(options: CelebrationOptions): void {
  successFeedback();
  listener?.(options);
}
