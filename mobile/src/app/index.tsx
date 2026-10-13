import { Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { Text } from "../components/AppText";
import { colors, fonts } from "../lib/theme";
import type { Role } from "../lib/roles";

const BRAND_MARK = require("../../assets/fitora/brand-mark.png");

type Door = { role: Role; label: string; sub: string };

const DOORS: Door[] = [
  { role: "athlete", label: "I'm an Athlete", sub: "Train, eat well, get coached" },
  { role: "coach", label: "I'm a Coach", sub: "Clients, plans and content" },
];

const RING_SIZE = 380;
/** Below this height the ring would sit behind the headline, so it is left out. */
const RING_MIN_SCREEN_HEIGHT = 720;
/** Headline size that fits "TRAIN SMARTER." on one line at 390 px wide. */
const HERO_SIZE = 54;
const HERO_FIT_WIDTH = 346;

/**
 * The welcome screen asks one question, athlete or coach, so it shows two
 * buttons: one tap goes straight to that role's sign in (which also offers
 * a new account). The large ring repeats the opening animation's mark.
 */
export default function Landing() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const heroSize = Math.min(HERO_SIZE, Math.floor(((Math.min(width, 520) - 44) / HERO_FIT_WIDTH) * HERO_SIZE));
  const showRing = height >= RING_MIN_SCREEN_HEIGHT;

  return (
    <SafeAreaView style={styles.safe}>
      {showRing ? (
        <View pointerEvents="none" style={styles.ring} importantForAccessibility="no-hide-descendants">
          <Svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 120 120">
            <Circle cx={60} cy={60} r={38} fill="none" stroke={colors.surfaceRaised} strokeWidth={10} />
            <Circle
              cx={60}
              cy={60}
              r={38}
              fill="none"
              stroke={colors.primary}
              strokeOpacity={0.9}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray="179 239"
              transform="rotate(-90 60 60)"
            />
          </Svg>
        </View>
      ) : null}

      <View style={styles.content}>
        <View style={styles.brandRow}>
          <Image source={BRAND_MARK} style={styles.brandMark} resizeMode="contain" accessibilityIgnoresInvertColors />
          <Text style={styles.brandText}>FITORA</Text>
        </View>

        <View style={styles.bottom}>
          <Text style={[styles.hero, { fontSize: heroSize, lineHeight: heroSize * 0.96 }]} accessibilityRole="header">
            Train smarter.{"\n"}Get <Text style={styles.heroAccent}>coached</Text>.
          </Text>
          <Text style={styles.subcopy}>Your plan, food and recovery in one place.</Text>

          <View style={styles.doors}>
            {DOORS.map((door, index) => {
              const primary = index === 0;
              return (
                <Pressable
                  key={door.role}
                  onPress={() => router.push(`/login/${door.role}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${door.label}. ${door.sub}`}
                  style={({ pressed }) => [styles.door, primary ? styles.doorPrimary : styles.doorSecondary, pressed ? styles.pressed : null]}
                >
                  <View style={styles.doorCopy}>
                    <Text style={[styles.doorTitle, primary ? styles.onPrimary : null]}>{door.label}</Text>
                    <Text style={[styles.doorSub, primary ? styles.onPrimarySub : null]}>{door.sub}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={22} color={primary ? colors.onPrimary : colors.ink} />
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fine}>New here or coming back, start with your role.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface, overflow: "hidden" },
  ring: { position: "absolute", right: -120, top: 110 },
  content: { flex: 1, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 20 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 34, height: 34 },
  brandText: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "800", letterSpacing: 6 },
  bottom: { marginTop: "auto", width: "100%", maxWidth: 520, alignSelf: "center" },
  hero: { color: colors.ink, fontFamily: fonts.display, textTransform: "uppercase", fontSize: 54, lineHeight: 52 },
  heroAccent: { color: colors.primary, fontFamily: fonts.display },
  subcopy: { marginTop: 10, color: colors.inkMuted, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  doors: { marginTop: 26, gap: 10 },
  door: { minHeight: 64, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, paddingVertical: 12 },
  doorPrimary: { backgroundColor: colors.primary },
  doorSecondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.lineStrong },
  doorCopy: { flex: 1 },
  doorTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  doorSub: { marginTop: 1, color: colors.inkMuted, fontSize: 13, fontWeight: "600" },
  onPrimary: { color: colors.onPrimary },
  onPrimarySub: { color: colors.onPrimary, opacity: 0.75 },
  fine: { marginTop: 14, textAlign: "center", color: colors.inkFaint, fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
});
