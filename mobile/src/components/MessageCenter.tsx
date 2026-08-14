import { ActivityIndicator, Pressable, ScrollView, StyleProp, StyleSheet, TextInput, View, ViewStyle } from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../lib/theme";
import { Card, Muted } from "./ui";
import { ChatMediaBubble, type ChatMedia } from "./ChatMediaBubble";

export type MessageSenderRole = "coach" | "athlete";

export type MessageView = {
  id: string;
  body: string;
  senderRole: MessageSenderRole;
  mine: boolean;
  read: boolean;
  createdAt: string;
  /** Set when a coach shared an image on this message (view-only). */
  media?: ChatMedia | null;
};

export type MessageParty = {
  id: string;
  name: string;
  subtitle?: string;
  lastMessage?: string;
  lastAt?: string;
  lastSenderRole?: MessageSenderRole;
  unreadCount?: number;
};

type MessageCenterProps = {
  title: string;
  subtitle?: string;
  parties: MessageParty[];
  selectedId: string | null;
  messages: MessageView[];
  loadingMessages: boolean;
  error?: string | null;
  draft: string;
  sending: boolean;
  /** Which side is viewing — picks the authenticated media-file endpoint for images. */
  role: MessageSenderRole;
  accent: string;
  accentInk: string;
  /** Darker accent for text on a light tint (falls back to `accent`) — used for the sender's own bubble. */
  accentStrong?: string;
  emptyPartiesText: string;
  emptyThreadText: string;
  onSelect: (id: string) => void;
  onDraftChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  style?: StyleProp<ViewStyle>;
  maxThreadHeight?: number;
};

export function messageTime(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function MessageCenter({
  title,
  subtitle,
  parties,
  selectedId,
  messages,
  loadingMessages,
  error,
  draft,
  sending,
  role,
  accent,
  accentInk,
  accentStrong = accent,
  emptyPartiesText,
  emptyThreadText,
  onSelect,
  onDraftChange,
  onSend,
  style,
  maxThreadHeight = 360,
}: MessageCenterProps) {
  const selected = parties.find((party) => party.id === selectedId) ?? null;
  const canSend = Boolean(selected && draft.trim() && !sending);

  return (
    <Card style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={accent} />
      </View>

      {parties.length === 0 ? (
        <Muted>{emptyPartiesText}</Muted>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.partyRow}>
            {parties.map((party) => {
              const active = party.id === selected?.id;
              return (
                <Pressable
                  key={party.id}
                  onPress={() => onSelect(party.id)}
                  style={[styles.partyChip, active ? { borderColor: accent, backgroundColor: `${accent}14` } : null]}
                >
                  <View style={[styles.avatar, { backgroundColor: active ? accent : colors.surfaceInset }]}>
                    <Text style={[styles.avatarText, { color: active ? accentInk : colors.inkMuted }]}>
                      {(party.name || "?").charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ minWidth: 0 }}>
                    <Text style={[styles.partyName, active ? { color: accent } : null]} numberOfLines={1}>
                      {party.name || "Conversation"}
                    </Text>
                    {party.unreadCount ? (
                      <Text style={[styles.partyMeta, { color: accent }]}>{party.unreadCount} new</Text>
                    ) : (
                      <Text style={styles.partyMeta}>{messageTime(party.lastAt) || party.subtitle || ""}</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {selected ? (
            <View style={styles.selectedHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.selectedName} numberOfLines={1}>{selected.name || "Conversation"}</Text>
                {selected.subtitle ? <Text style={styles.selectedMeta} numberOfLines={1}>{selected.subtitle}</Text> : null}
              </View>
              {selected.unreadCount ? (
                <View style={[styles.unreadPill, { backgroundColor: `${accent}18` }]}>
                  <Text style={[styles.unreadText, { color: accent }]}>{selected.unreadCount}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <ScrollView
            nestedScrollEnabled
            style={[styles.thread, { maxHeight: maxThreadHeight }]}
            contentContainerStyle={styles.threadContent}
          >
            {loadingMessages ? (
              <ActivityIndicator color={accent} style={{ marginVertical: 24 }} />
            ) : error ? (
              <Muted>{error}</Muted>
            ) : messages.length > 0 ? (
              messages.map((message) => (
                <View key={message.id} style={[styles.messageRow, message.mine ? styles.messageRowMine : null]}>
                  <View
                    style={[
                      styles.bubble,
                      message.media ? styles.bubbleMedia : null,
                      !message.media && message.mine ? { backgroundColor: `${accent}1f`, borderColor: `${accent}40` } : null,
                    ]}
                  >
                    {message.media ? (
                      <ChatMediaBubble media={message.media} role={role} mine={message.mine} imageStyle={styles.mediaImage} />
                    ) : null}
                    <View style={message.media ? styles.mediaCaption : null}>
                      {message.body ? (
                        <Text style={[styles.bubbleText, !message.media && message.mine ? { color: accentStrong } : null]}>
                          {message.body}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.bubbleTime,
                          !message.media && message.mine ? { color: `${accentStrong}b3` } : null,
                        ]}
                      >
                        {messageTime(message.createdAt)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            ) : (
              <Muted>{emptyThreadText}</Muted>
            )}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={onDraftChange}
              placeholder={selected ? "Type a message" : "Select a conversation"}
              placeholderTextColor={colors.inkFaint}
              multiline
              maxLength={4000}
              editable={Boolean(selected) && !sending}
              style={styles.input}
            />
            <Pressable
              onPress={onSend}
              disabled={!canSend}
              accessibilityLabel="Send message"
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: accent, opacity: canSend ? (pressed ? 0.88 : 1) : 0.42 },
              ]}
            >
              {sending ? <ActivityIndicator color={accentInk} /> : <Ionicons name="send" size={19} color={accentInk} />}
            </Pressable>
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  subtitle: { marginTop: 3, color: colors.inkFaint, fontSize: 12 },
  partyRow: { gap: 8, paddingVertical: 2 },
  partyChip: {
    maxWidth: 178,
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
  },
  avatar: { height: 34, width: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontWeight: "900" },
  partyName: { maxWidth: 112, color: colors.ink, fontSize: 12, fontWeight: "800" },
  partyMeta: { marginTop: 2, color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  selectedHeader: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectedName: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  selectedMeta: { marginTop: 2, color: colors.inkFaint, fontSize: 11 },
  unreadPill: { minWidth: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  unreadText: { fontSize: 12, fontWeight: "900" },
  thread: { borderRadius: radius.md, backgroundColor: colors.surfaceInset },
  threadContent: { gap: 8, padding: 10 },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  messageRowMine: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "86%",
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  // Media messages carry no card border/fill of their own — just the image and a plain caption/time.
  bubbleMedia: { padding: 0, borderWidth: 0, backgroundColor: "transparent" },
  mediaCaption: { paddingHorizontal: 4, paddingTop: 5 },
  mediaImage: { width: 220, borderRadius: radius.md },
  bubbleText: { color: colors.ink, fontSize: 14, lineHeight: 19 },
  bubbleTime: { alignSelf: "flex-end", marginTop: 5, color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  composer: { minHeight: 56, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 104,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 11,
    textAlignVertical: "top",
  },
  sendButton: {
    height: 48,
    width: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
