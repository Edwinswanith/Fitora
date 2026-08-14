import { useState } from "react";
import { Image, ImageStyle, Modal, Pressable, ScrollView, StatusBar, StyleProp, StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE, getAccessToken } from "../lib/api";
import { colors, radius } from "../lib/theme";

export type WorkoutTableRow = {
  name: string;
  sets?: string;
  reps?: string;
  distance?: string;
  duration?: string;
  intensity?: string;
  notes?: string;
};

export type ChatMedia = {
  id: string;
  originalName: string;
  mimeType: string;
  conversion: {
    status: "none" | "pending" | "completed" | "failed" | string;
    table: WorkoutTableRow[];
  };
};

/**
 * Renders a coach-shared chat image (loaded from the role-scoped, Bearer-
 * authenticated media-file endpoint) plus, when the coach converted it, a
 * compact workout table. View-only — sending is coach-side.
 */
export function ChatMediaBubble({
  media,
  role,
  imageStyle,
}: {
  media: ChatMedia;
  /** Which side is viewing — picks the authenticated media-file endpoint. */
  role: "coach" | "athlete";
  /** Whether the message is the viewer's own (accepted for call-site symmetry). */
  mine?: boolean;
  /** Overrides the default image sizing/corners (e.g. to sit flush against a bubble edge). */
  imageStyle?: StyleProp<ImageStyle>;
}) {
  const token = getAccessToken();
  const uri = `${API_BASE}/api/${role}/media/${media.id}/file`;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
  const table = media.conversion?.status === "completed" ? media.conversion.table ?? [] : [];
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setViewerOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={`View ${media.originalName}`}>
        <Image
          source={{ uri, headers: authHeaders }}
          style={[styles.image, imageStyle]}
          resizeMode="cover"
          accessibilityLabel={media.originalName}
        />
      </Pressable>
      {/* Full-screen, tap-to-dismiss view-only lightbox — WhatsApp-style. */}
      <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <StatusBar hidden />
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerOpen(false)}>
          <Image
            source={{ uri, headers: authHeaders }}
            style={styles.viewerImage}
            resizeMode="contain"
            accessibilityLabel={media.originalName}
          />
          <Pressable onPress={() => setViewerOpen(false)} style={styles.viewerClose} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
      {table.length > 0 ? (
        <View style={styles.table}>
          <Text style={styles.tableTitle}>
            Workout plan · {table.length} {table.length === 1 ? "exercise" : "exercises"}
          </Text>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.cellName, styles.headerText]}>Exercise</Text>
            <Text style={[styles.cell, styles.headerText]}>Sets</Text>
            <Text style={[styles.cell, styles.headerText]}>Reps</Text>
            <Text style={[styles.cellWide, styles.headerText]}>Rest/Dur</Text>
          </View>
          {/* Capped height so a long extracted plan scrolls in place instead of
              growing the bubble (and pushing the composer off-screen). */}
          <ScrollView style={styles.rowsScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {table.map((r, i) => (
              <View key={i} style={[styles.row, i > 0 ? styles.rowDivider : null]}>
                <View style={styles.cellName}>
                  <Text style={styles.rowName} numberOfLines={2}>
                    {r.name}
                  </Text>
                  {r.notes ? (
                    <Text style={styles.rowNotes} numberOfLines={2}>
                      {r.notes}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.cell}>{r.sets || "—"}</Text>
                <Text style={styles.cell}>{r.reps || "—"}</Text>
                <Text style={styles.cellWide} numberOfLines={2}>
                  {r.duration || r.distance || r.intensity || "—"}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: 220, aspectRatio: 4 / 3, borderRadius: radius.sm, backgroundColor: colors.surfaceInset },
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center" },
  viewerImage: { width: "100%", height: "82%" },
  viewerClose: {
    position: "absolute",
    top: 48,
    right: 16,
    height: 40,
    width: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  // Always a solid light card so the plan stays readable inside a colored bubble.
  table: {
    width: 260,
    maxWidth: "100%",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
    paddingBottom: 2,
  },
  tableTitle: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkFaint,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surfaceInset,
  },
  // Capped so a long extracted plan scrolls inside the card instead of growing
  // the chat bubble (and pushing the composer off-screen) without limit.
  rowsScroll: { maxHeight: 240 },
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 8, paddingVertical: 5, gap: 4 },
  headerRow: { paddingTop: 6, paddingBottom: 4 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  cellName: { flex: 2, minWidth: 0 },
  cell: { flex: 1, fontSize: 10, color: colors.inkMuted },
  cellWide: { flex: 1.2, fontSize: 10, color: colors.inkMuted },
  headerText: { fontSize: 9, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase" },
  rowName: { fontSize: 11, fontWeight: "800", color: colors.ink },
  rowNotes: { marginTop: 1, fontSize: 9, color: colors.inkFaint },
});
