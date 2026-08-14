/**
 * Sound plumbing for the tour/mascot system. No audio files are bundled today
 * (this app only has TTS, no sound-effect assets) — `playSound` is wired at
 * every call site so dropping real files into `ASSET_REGISTRY` later needs no
 * call-site changes. Silently no-ops until then, and always respects the
 * user's own "Sound effects" preference.
 */

type SoundName = "step-arrive" | "tour-complete" | "reaction-success" | "reaction-error" | "reaction-celebrate";

// Intentionally empty — populate with require()'d assets when real .mp3/.wav
// files are added to the project.
const ASSET_REGISTRY: Partial<Record<SoundName, number>> = {};

export async function playSound(name: SoundName, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const asset = ASSET_REGISTRY[name];
  if (!asset) return; // no bundled asset yet — silent by design
  // When real assets are registered above, play them with `expo-audio`
  // (createAudioPlayer(asset).play()) — the app's only installed audio lib.
}
