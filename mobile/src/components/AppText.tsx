import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from "react-native";

/**
 * Maps the app's existing `fontWeight` values (500/600/700/800/900, plus the
 * `"bold"`/`"normal"` string forms) to the matching bundled Inter static cut.
 * A statically-loaded font file ignores the `fontWeight` style prop — it only
 * ever renders its own baked-in weight — so this is the only way to honor the
 * weight app code already sets everywhere, without touching every call site.
 */
const WEIGHT_TO_FAMILY: Record<string, string> = {
  "400": "Inter_400Regular",
  normal: "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
  bold: "Inter_700Bold",
  "800": "Inter_700Bold",
  "900": "Inter_800ExtraBold",
};

function familyForWeight(weight: TextStyle["fontWeight"]): string {
  if (weight === undefined || weight === null) return "Inter_400Regular";
  return WEIGHT_TO_FAMILY[String(weight)] ?? "Inter_400Regular";
}

/**
 * Drop-in replacement for React Native's `Text` that renders in Inter,
 * matching the web app's font stack. Reads `fontWeight` off the passed style
 * (same prop every screen already sets) to pick the right Inter cut, then
 * clears `fontWeight` so the OS doesn't synthetically re-bold an already-bold
 * static font file.
 */
export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fontFamily = familyForWeight(flat.fontWeight);
  return <RNText {...props} style={[style, { fontFamily, fontWeight: "normal", includeFontPadding: false }]} />;
}
