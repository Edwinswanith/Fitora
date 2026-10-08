import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, metricColors } from "../lib/theme";
import type { Role } from "../lib/roles";

const BRAND_MARK = require("../../assets/fitora/brand-mark.png");

type RoleOption = {
  role: Role;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type Feature = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  tone: "blue" | "purple" | "green" | "gold";
};

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: "athlete",
    label: "Athlete",
    sub: "Train, eat well\nand get coached",
    icon: "person-outline",
  },
  {
    role: "coach",
    label: "Coach",
    sub: "Clients, plans\nand content",
    icon: "barbell-outline",
  },
];

const FEATURES: Feature[] = [
  {
    icon: "calendar-outline",
    title: "Daily coaching plan",
    sub: "Workouts, meals and sessions in one place.",
    tone: "blue",
  },
  {
    icon: "shield-checkmark-outline",
    title: "Readiness and risk flags",
    sub: "Know when to push and when to rest.",
    tone: "purple",
  },
  {
    icon: "restaurant-outline",
    title: "Nutrition support",
    sub: "Calorie targets, meals and water.",
    tone: "green",
  },
  {
    icon: "trending-up-outline",
    title: "Progress views",
    sub: "Trends and feedback from your coach.",
    tone: "gold",
  },
];

const FEATURE_TONES: Record<Feature["tone"], { bg: string; color: string }> = {
  // Same colors the app uses for these metrics once you're inside.
  blue: { bg: metricColors.readiness.soft, color: metricColors.readiness.ink },
  purple: { bg: metricColors.training.soft, color: metricColors.training.ink },
  green: { bg: metricColors.nutrition.soft, color: metricColors.nutrition.ink },
  gold: { bg: metricColors.water.soft, color: metricColors.water.ink },
};

export default function Landing() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<Role>("athlete");

  function continueToLogin() {
    router.push(`/login/${selectedRole}` as never);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <Image source={BRAND_MARK} style={styles.brandMark} resizeMode="contain" />
          <Text style={styles.brandText}>FITORA</Text>
        </View>

        <Text style={styles.hero}>
          Coaching that{"\n"}stays organized<Text style={styles.heroDot}>.</Text>
        </Text>
        <Text style={styles.subcopy}>Choose the Fitora experience that{"\n"}fits your role.</Text>

        <View style={styles.roleGrid}>
          {ROLE_OPTIONS.map((option) => {
            const selected = option.role === selectedRole;
            return (
              <Pressable
                key={option.role}
                onPress={() => setSelectedRole(option.role)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.roleCard,
                  selected ? styles.roleCardSelected : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <View style={styles.roleIconTile}>
                  <Ionicons name={option.icon} size={31} color={colors.primary} />
                </View>
                <Text style={styles.roleTitle}>{option.label}</Text>
                <Text style={styles.roleSub}>{option.sub}</Text>
                <View style={[styles.selector, selected ? styles.selectorSelected : null]}>
                  {selected ? <Ionicons name="checkmark" size={21} color={colors.onPrimary} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.notice}>
          <View style={styles.noticeIcon}>
            <Ionicons name="shield-checkmark-outline" size={17} color={colors.primary} />
          </View>
          <Text style={styles.noticeText}>
            Your role is set when you first sign up.
          </Text>
        </View>

        <View style={styles.sectionLabelWrap}>
          <View style={styles.sectionLine} />
          <View style={styles.diamond} />
          <Text style={styles.sectionLabel}>BUILT FOR COACHING</Text>
          <View style={styles.diamond} />
          <View style={styles.sectionLine} />
        </View>

        <View style={styles.featureGrid}>
          {FEATURES.map((feature, index) => {
            const tone = FEATURE_TONES[feature.tone];
            const rightCell = index % 2 === 1;
            const bottomCell = index > 1;
            return (
              <View
                key={feature.title}
                style={[
                  styles.featureCell,
                  rightCell ? styles.featureCellRight : null,
                  bottomCell ? styles.featureCellBottom : null,
                ]}
              >
                <View style={[styles.featureIcon, { backgroundColor: tone.bg }]}>
                  <Ionicons name={feature.icon} size={21} color={tone.color} />
                </View>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureSub}>{feature.sub}</Text>
              </View>
            );
          })}
        </View>

        <Pressable onPress={continueToLogin} style={({ pressed }) => [styles.continueButton, pressed ? styles.pressed : null]}>
          <Text style={styles.continueText}>Continue</Text>
          <Ionicons name="arrow-forward" size={20} color={colors.onPrimary} />
        </Pressable>

        <View style={styles.footer}>
          <Ionicons name="lock-closed-outline" size={12} color={colors.inkFaint} />
          <Text style={styles.footerText}>Secure. Private. Built for you.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: {
    minHeight: "100%",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 11,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 38, height: 38 },
  brandText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: 7,
  },
  hero: {
    marginTop: 18,
    color: colors.ink,
    fontFamily: fonts.display,
    fontSize: 44,
    lineHeight: 46,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  heroDot: { color: colors.primary },
  subcopy: {
    marginTop: 8,
    color: colors.inkMuted,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "500",
    letterSpacing: 0,
  },
  roleGrid: {
    marginTop: 13,
    flexDirection: "row",
    gap: 14,
  },
  roleCard: {
    flex: 1,
    height: 220,
    alignItems: "center",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingTop: 27,
  },
  roleCardSelected: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    backgroundColor: colors.primarySoft,
  },
  roleIconTile: {
    width: 59,
    height: 59,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  roleTitle: {
    marginTop: 10,
    color: colors.ink,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
    letterSpacing: 0,
  },
  roleSub: {
    marginTop: 5,
    color: colors.inkMuted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "500",
    textAlign: "center",
    letterSpacing: 0,
  },
  selector: {
    marginTop: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  selectorSelected: {
    borderWidth: 0,
    backgroundColor: colors.primary,
  },
  notice: {
    minHeight: 45,
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
  },
  noticeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  noticeText: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    letterSpacing: 0,
  },
  sectionLabelWrap: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  diamond: {
    width: 6,
    height: 6,
    marginHorizontal: 12,
    backgroundColor: colors.primary,
    transform: [{ rotate: "45deg" }],
  },
  sectionLabel: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 4,
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 17,
    overflow: "hidden",
    backgroundColor: colors.surfaceRaised,
  },
  featureCell: {
    width: "50%",
    minHeight: 120,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 14,
    borderColor: colors.line,
  },
  featureCellRight: {
    borderLeftWidth: 1,
  },
  featureCellBottom: {
    borderTopWidth: 1,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: {
    marginTop: 8,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
    letterSpacing: 0,
  },
  featureSub: {
    marginTop: 5,
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    letterSpacing: 0,
  },
  continueButton: {
    height: 52,
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  continueText: {
    color: colors.onPrimary,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    letterSpacing: 0,
  },
  footer: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  footerText: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    letterSpacing: 0,
  },
  pressed: { opacity: 0.76 },
});
