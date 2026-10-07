import { useState } from "react";
import { ActivityIndicator, Image, ImageStyle, Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { Text } from "./AppText";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import { API_BASE, apiFetch, getAccessToken } from "../lib/api";
import { colors } from "../lib/theme";

export type AvatarInfo = { kind: "photo" | "default" | null; defaultId: string | null } | null | undefined;

export const AVATAR_DEFAULTS = [
  { id: "male-1", label: "Male badge 1" },
  { id: "male-2", label: "Male badge 2" },
  { id: "female-1", label: "Female badge 1" },
  { id: "female-2", label: "Female badge 2" },
] as const;

const DEFAULT_PHOTO_ASSETS: Record<string, number> = {
  "male-1": require("../../assets/fitora/avatar-male-1.png"),
  "male-2": require("../../assets/fitora/avatar-male-2.png"),
  "female-1": require("../../assets/fitora/avatar-female-1.png"),
  "female-2": require("../../assets/fitora/avatar-female-1.png"),
  "coach-1": require("../../assets/fitora/avatar-coach.png"),
};

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
    const photoAsset = DEFAULT_PHOTO_ASSETS[avatar.defaultId];
    if (photoAsset) {
      return (
        <Image
          source={photoAsset}
          style={
            [
              { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceInset },
              style,
            ] as StyleProp<ImageStyle>
          }
        />
      );
    }
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

/**
 * Shared upload panel for both the athlete Account screen and the coach
 * Profile screen — pick a photo, pick a bundled badge, or revert to
 * initials. Wired to `/api/me/avatar*` (server/src/routes/avatar.ts). Callers
 * pass `onChanged` to update whatever they use to render `<Avatar>` (the
 * cached auth user via `useAuth().setUser`, plus their own screen data).
 */
export function AvatarEditorPanel({
  avatar,
  name,
  onChanged,
}: {
  avatar: AvatarInfo;
  name: string;
  onChanged: (avatar: AvatarInfo) => void;
}) {
  const [busy, setBusy] = useState<"photo" | "badge" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickPhoto() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to set a profile picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setBusy("photo");
    try {
      const body = new FormData();
      body.append("file", new File(asset.uri), asset.fileName ?? "avatar.jpg");
      const res = await apiFetch("/api/me/avatar", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error === "file_too_large" ? "That photo is too large." : json.error === "unsupported_file_type" ? "Choose a JPEG, PNG, or WebP photo." : "Could not upload this photo.");
        return;
      }
      onChanged(json.avatar as AvatarInfo);
    } catch {
      setError("Network error while uploading your photo.");
    } finally {
      setBusy(null);
    }
  }

  async function pickBadge(defaultId: string) {
    setError(null);
    setBusy("badge");
    try {
      const res = await apiFetch("/api/me/avatar/default", { method: "POST", body: JSON.stringify({ defaultId }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError("Could not set this avatar.");
        return;
      }
      onChanged(json.avatar as AvatarInfo);
    } catch {
      setError("Network error while setting your avatar.");
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    setError(null);
    setBusy("remove");
    try {
      const res = await apiFetch("/api/me/avatar", { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError("Could not remove your photo.");
        return;
      }
      onChanged(json.avatar as AvatarInfo);
    } catch {
      setError("Network error while removing your photo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.editorPanel}>
      <View style={styles.editorTop}>
        <Avatar avatar={avatar} name={name} size={64} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
        <View style={{ flex: 1, gap: 6 }}>
          <Pressable onPress={pickPhoto} disabled={busy !== null} style={styles.editorButton}>
            {busy === "photo" ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.editorButtonText}>Choose Photo</Text>}
          </Pressable>
          {avatar?.kind ? (
            <Pressable onPress={removePhoto} disabled={busy !== null} hitSlop={8}>
              <Text style={styles.editorRemoveText}>{busy === "remove" ? "Removing..." : "Remove Photo"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.editorLabel}>Or choose a badge</Text>
      <AvatarBadgePicker selectedId={avatar?.kind === "default" ? avatar.defaultId : null} onSelect={pickBadge} accentColor={colors.primary} />
      {error ? <Text style={styles.editorError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
  fallbackText: { fontWeight: "900" },
  pickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  pickerItem: { borderRadius: 26, padding: 2 },
  editorPanel: { gap: 12 },
  editorTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  editorButton: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  editorButtonText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  editorRemoveText: { color: colors.bad, fontSize: 12, fontWeight: "800" },
  editorLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  editorError: { color: colors.bad, fontSize: 12, fontWeight: "800" },
});
