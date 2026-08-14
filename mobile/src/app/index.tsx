import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ROLE_THEME_LIST, colors, radius } from "../lib/theme";
import { H1, Muted } from "../components/ui";

const APP_ICON = require("../../assets/images/adaptive-icon.png");

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  { icon: "flash", title: "Daily check-in & RPM", sub: "Log training load, sleep, soreness in seconds" },
  { icon: "speedometer-outline", title: "Readiness & risk flags", sub: "Green / amber / red, computed for you" },
  { icon: "chatbubble-ellipses-outline", title: "Coach feedback", sub: "Notes and guidance, right where you train" },
  { icon: "trending-up-outline", title: "Trends & history", sub: "Watch every number move over time" },
];

export default function Landing() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={styles.markWrap}>
            <Image source={APP_ICON} style={styles.mark} resizeMode="contain" />
          </View>
          <Text style={styles.brand}>APEX</Text>
        </View>

        <H1 style={{ marginTop: 24 }}>
          Train by the numbers<Text style={styles.dot}>.</Text>
        </H1>
        <Muted style={{ marginTop: 10, maxWidth: 300 }}>
          One performance OS. Choose how you are signing in.
        </Muted>

        <View style={{ marginTop: 28, gap: 12 }}>
          {ROLE_THEME_LIST.map((t) => (
            <Pressable
              key={t.role}
              onPress={() => router.push(`/login/${t.role}` as never)}
              style={({ pressed }) => [styles.roleCard, { opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={[styles.roleIcon, { backgroundColor: t.accentSoft }]}>
                <Ionicons name={`${t.icon}` as never} size={22} color={t.accentStrong} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.roleLabel}>{t.label}</Text>
                <Text style={styles.roleTag}>{t.tagline}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.inkFaint} />
            </Pressable>
          ))}
        </View>

        <View style={styles.noticeRow}>
          <View style={styles.noticeIcon}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.inkMuted} />
          </View>
          <Muted style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
            Existing accounts keep their saved role. New Google users are created from the role they pick.
          </Muted>
        </View>

        <View style={styles.featureSection}>
          <View style={styles.sectionLabelRow}>
            <View style={styles.sectionDivider} />
            <Text style={styles.sectionLabel}>What you get</Text>
            <View style={styles.sectionDivider} />
          </View>
          <View style={styles.featureCard}>
            {FEATURES.map((feature, index) => (
              <View
                key={feature.title}
                style={[styles.featureRow, index === FEATURES.length - 1 ? styles.featureRowLast : null]}
              >
                <View style={styles.featureIcon}>
                  <Ionicons name={feature.icon} size={18} color={colors.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureSub}>{feature.sub}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 24, paddingTop: 32, flexGrow: 1 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  markWrap: {
    height: 32,
    width: 32,
    borderRadius: 9,
    backgroundColor: "#0f1410",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  mark: { height: 22, width: 22 },
  brand: { fontSize: 14, fontWeight: "700", letterSpacing: 4, color: colors.inkMuted },
  dot: { color: "#ff7e1a" },
  noticeRow: { marginTop: 22, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  noticeIcon: {
    height: 26,
    width: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  roleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  roleIcon: { height: 44, width: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  roleLabel: { fontSize: 17, fontWeight: "700", color: colors.ink },
  roleTag: { fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  featureSection: { marginTop: 28 },
  sectionLabelRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionDivider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.lineStrong },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  featureCard: {
    marginTop: 12,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  featureRowLast: { borderBottomWidth: 0 },
  featureIcon: {
    height: 36,
    width: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  featureSub: { fontSize: 12, color: colors.inkMuted, marginTop: 2, lineHeight: 16 },
});
