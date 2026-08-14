import { Image, ImageStyle, Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { Text } from "./AppText";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import { API_BASE, getAccessToken } from "../lib/api";
import { colors } from "../lib/theme";

export type AvatarInfo = { kind: "photo" | "default" | null; defaultId: string | null } | null | undefined;

export const AVATAR_DEFAULTS = [
  { id: "male-1", label: "Male badge 1" },
  { id: "male-2", label: "Male badge 2" },
  { id: "female-1", label: "Female badge 1" },
  { id: "female-2", label: "Female badge 2" },
] as const;

type HairStyle = "short-side" | "buzz" | "ponytail" | "buns";

type MascotRecipe = {
  bg: string;
  skin: string;
  hair: string;
  jersey: string;
  shorts: string;
  sock: string;
  hairStyle: HairStyle;
};

const MASCOT_RECIPES: Record<string, MascotRecipe> = {
  "male-1": {
    bg: "#eff6ff",
    skin: "#f2c9a0",
    hair: "#2b2118",
    jersey: "#2563eb",
    shorts: "#ffffff",
    sock: "#2563eb",
    hairStyle: "short-side",
  },
  "male-2": {
    bg: "#f0fdf4",
    skin: "#8d5524",
    hair: "#16110c",
    jersey: "#16a34a",
    shorts: "#ffffff",
    sock: "#16a34a",
    hairStyle: "buzz",
  },
  "female-1": {
    bg: "#fdf2f8",
    skin: "#f8d9b4",
    hair: "#6b3410",
    jersey: "#db2777",
    shorts: "#ffffff",
    sock: "#db2777",
    hairStyle: "ponytail",
  },
  "female-2": {
    bg: "#f5f3ff",
    skin: "#c68642",
    hair: "#16110c",
    jersey: "#7c3aed",
    shorts: "#ffffff",
    sock: "#7c3aed",
    hairStyle: "buns",
  },
};

const BANGS_PATH = "M15 9c0-4 2-7 5-7s5 3 5 7c-1-1.5-3-2-5-2s-4 .5-5 2Z";
const BUZZ_PATH = "M15.5 8.5c0-3.5 2-6.5 4.5-6.5s4.5 3 4.5 6.5c-1-1-2.5-1.5-4.5-1.5s-3.5.5-4.5 1.5Z";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** A small full-body athletic mascot: jersey + shorts + akimbo stance, not just a face. */
function BadgeIcon({ id, size }: { id: string; size: number }) {
  const m = MASCOT_RECIPES[id] ?? MASCOT_RECIPES["male-1"];
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Circle cx={20} cy={20} r={20} fill={m.bg} />

      {/* arms, akimbo (hands on hips) */}
      <Path d="M13 19C9 21 9 26 13 28L15 27C12 25 12 21 15 19Z" fill={m.skin} />
      <Path d="M27 19C31 21 31 26 27 28L25 27C28 25 28 21 25 19Z" fill={m.skin} />

      {/* legs + shoes */}
      <Rect x={15} y={33} width={3.5} height={5.5} rx={1.5} fill={m.sock} />
      <Rect x={21.5} y={33} width={3.5} height={5.5} rx={1.5} fill={m.sock} />
      <Ellipse cx={16.7} cy={38.3} rx={2.3} ry={1.3} fill="#1a1a1a" />
      <Ellipse cx={23.3} cy={38.3} rx={2.3} ry={1.3} fill="#1a1a1a" />

      {/* shorts + jersey */}
      <Rect x={14} y={28} width={12} height={6} rx={2} fill={m.shorts} />
      <Rect x={13} y={18} width={14} height={11} rx={4} fill={m.jersey} />
      <Circle cx={20} cy={22} r={2} fill="#fff" fillOpacity={0.95} />
      <Circle cx={20} cy={22} r={1} fill={m.jersey} />

      {/* neck + head */}
      <Rect x={18} y={15} width={4} height={3} fill={m.skin} />
      <Circle cx={20} cy={11} r={5} fill={m.skin} />

      {/* hairstyle */}
      {m.hairStyle === "buzz" ? <Path d={BUZZ_PATH} fill={m.hair} /> : <Path d={BANGS_PATH} fill={m.hair} />}
      {m.hairStyle === "ponytail" ? <Ellipse cx={26.5} cy={12} rx={1.8} ry={3.2} fill={m.hair} /> : null}
      {m.hairStyle === "buns" ? (
        <>
          <Circle cx={15.5} cy={6.5} r={2} fill={m.hair} />
          <Circle cx={24.5} cy={6.5} r={2} fill={m.hair} />
        </>
      ) : null}

      <Circle cx={18} cy={11} r={0.7} fill="#2b2118" />
      <Circle cx={22} cy={11} r={0.7} fill="#2b2118" />
    </Svg>
  );
}

/** Renders a user's profile picture: photo, bundled badge icon, or initials fallback. */
export function Avatar({
  avatar,
  name,
  size = 38,
  style,
  accentSoft,
  accentStrong,
  photoPath = "/api/me/avatar/file",
}: {
  avatar: AvatarInfo;
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  accentSoft?: string;
  accentStrong?: string;
  /** Override to view another user's photo, e.g. a coach viewing an assigned athlete's avatar. */
  photoPath?: string;
}) {
  if (avatar?.kind === "photo") {
    const token = getAccessToken();
    return (
      <Image
        source={{
          uri: `${API_BASE}${photoPath}`,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }}
        style={
          [
            { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceInset },
            style,
          ] as StyleProp<ImageStyle>
        }
      />
    );
  }
  if (avatar?.kind === "default" && avatar.defaultId) {
    return (
      <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }, style]}>
        <BadgeIcon id={avatar.defaultId} size={size} />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: accentSoft ?? colors.surfaceInset,
        },
        style,
      ]}
    >
      <Text style={[styles.fallbackText, { color: accentStrong ?? colors.inkMuted, fontSize: size * 0.32 }]} numberOfLines={1}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

export function AvatarBadgePicker({
  selectedId,
  onSelect,
  accentColor,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  accentColor: string;
}) {
  return (
    <View style={styles.pickerRow}>
      {AVATAR_DEFAULTS.map((d) => (
        <Pressable
          key={d.id}
          onPress={() => onSelect(d.id)}
          accessibilityRole="button"
          accessibilityLabel={d.label}
          style={[
            styles.pickerItem,
            selectedId === d.id ? { borderWidth: 2, borderColor: accentColor } : null,
          ]}
        >
          <BadgeIcon id={d.id} size={48} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
  fallbackText: { fontWeight: "900" },
  pickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  pickerItem: { borderRadius: 26, padding: 2 },
});
