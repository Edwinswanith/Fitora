import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from "react-native";

/**
 * Maps the app's existing `fontWeight` values (500/600/700/800/900, plus the
 * `"bold"`/`"normal"` string forms) to the matching bundled Manrope static cut.
 * A statically-loaded font file ignores the `fontWeight` style prop — it only
 * ever renders its own baked-in weight — so this is the only way to honor the
 * weight app code already sets everywhere, without touching every call site.
 */
const WEIGHT_TO_FAMILY: Record<string, string> = {
  "400": "Manrope_500Medium",
  normal: "Manrope_500Medium",
  "500": "Manrope_500Medium",
  "600": "Manrope_600SemiBold",
  "700": "Manrope_700Bold",
  bold: "Manrope_700Bold",
  "800": "Manrope_800ExtraBold",
  "900": "Manrope_800ExtraBold",
};

function familyForWeight(weight: TextStyle["fontWeight"]): string {
  if (weight === undefined || weight === null) return "Manrope_500Medium";
  return WEIGHT_TO_FAMILY[String(weight)] ?? "Manrope_500Medium";
}

/**
 * Drop-in replacement for React Native's `Text` that renders in Manrope.
 * Reads `fontWeight` off the passed style (same prop every screen already
 * sets) to pick the right Manrope cut, then
 * clears `fontWeight` so the OS doesn't synthetically re-bold an already-bold
 * static font file.
 */
export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  // An explicit display family (fonts.display, Barlow Condensed) is kept as is.
  const fontFamily = flat.fontFamily?.startsWith("BarlowCondensed") ? flat.fontFamily : familyForWeight(flat.fontWeight);
  return <RNText {...props} style={[style, { fontFamily, fontWeight: "normal", includeFontPadding: false }]} />;
}
