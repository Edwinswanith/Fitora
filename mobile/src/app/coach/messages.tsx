import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { apiFetch, apiJson } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { Card, Muted } from "../../components/ui";
import { ChatMediaBubble, type ChatMedia, type WorkoutTableRow } from "../../components/ChatMediaBubble";
import type { MessageView } from "../../components/MessageCenter";
import { ScreenHeader } from "../../components/ScreenHeader";
import { Avatar as PhotoAvatar, type AvatarInfo } from "../../components/Avatar";
import { useTourHighlight, useTourScrollView } from "../../lib/tour/MobileTourProvider";
import { SpotlightTarget } from "../../lib/tour/SpotlightTarget";

const theme = ROLE_THEMES.coach;

type Athlete = {
  athleteId: string;
  name: string;
  email: string;
  sport: string;
  position: string | null;
  avatar?: AvatarInfo;
};

const AVATAR_PALETTE = [
  { bg: "#e3f5ea", fg: "#188a4e" },
  { bg: "#e7f0ff", fg: "#2f6fe0" },
  { bg: "#fdf3e3", fg: "#b2790a" },
  { bg: "#f2eafb", fg: "#7c4fd6" },
  { bg: "#fdecec", fg: "#c2382f" },
];

function paletteFor(id: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

type HomeFilter = "all" | "unread" | "recent" | "archived";

type ThreadSummary = {
  partyId: string;
  partyName: string;
  lastMessage: string;
  lastAt: string;
  lastSenderRole: "coach" | "athlete";
  unreadCount: number;
};

type Party = {
  id: string;
  name: string;
  subtitle: string;
};

function athleteMeta(athlete?: Athlete): string {
  if (!athlete) return "Assigned athlete";
  return [athlete.sport, athlete.position].filter(Boolean).join(" / ") || athlete.email || "Assigned athlete";
}

function messageTime(iso?: string): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yest.toDateString();
  if (isToday) return "Today";
  if (isYesterday) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function CoachMessages() {
  const { highlightStyle: messagesHighlight } = useTourHighlight("mobile-coach-messages");
  const tourScrollRef = useTourScrollView<ScrollView>();
  const accent = theme.accent;
  const params = useLocalSearchParams<{ athleteId?: string }>();
  const requestedId = typeof params.athleteId === "string" ? params.athleteId : null;

  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedId);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [homeFilter, setHomeFilter] = useState<HomeFilter>("all");

  // Coach image compose: the uploaded-but-not-yet-sent media, and a busy flag
  // covering upload/convert/send — mirrors the web app's flow exactly.
  const [pending, setPending] = useState<ChatMedia | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [tableDraft, setTableDraft] = useState<WorkoutTableRow[] | null>(null);
  const [tableDirty, setTableDirty] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const parties = useMemo<Party[]>(() => {
    const athleteById = new Map(athletes.map((athlete) => [athlete.athleteId, athlete]));
    return threads.map((thread) => {
      const athlete = athleteById.get(thread.partyId);
      return {
        id: thread.partyId,
        name: thread.partyName || athlete?.name || "Athlete",
        subtitle: athleteMeta(athlete),
      };
    });
  }, [athletes, threads]);

  const selectedParty =
    parties.find((p) => p.id === selectedId) ??
    (selectedId ? { id: selectedId, name: athletes.find((a) => a.athleteId === selectedId)?.name ?? "Athlete", subtitle: athleteMeta(athletes.find((a) => a.athleteId === selectedId)) } : null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterRes, threadsRes] = await Promise.all([
        apiJson<{ athletes: Athlete[] }>("/api/coach/athletes"),
        apiJson<{ threads: ThreadSummary[] }>("/api/coach/messages/threads"),
      ]);
      setAthletes(rosterRes.athletes ?? []);
      setThreads(threadsRes.threads ?? []);
    } catch {
      setError("Couldn't load messages. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThread = useCallback(
    async (initial: boolean) => {
      if (!selectedId) {
        setMessages([]);
        return;
      }
      if (initial) setThreadLoading(true);
      try {
        const res = await apiJson<{ messages: MessageView[]; hasMore: boolean }>(
          `/api/coach/athletes/${selectedId}/messages?limit=50`
        );
        setMessages(res.messages ?? []);
        setThreadError(null);
        setThreads((prev) =>
          prev.map((thread) => (thread.partyId === selectedId ? { ...thread, unreadCount: 0 } : thread))
        );
        await apiFetch(`/api/coach/athletes/${selectedId}/messages/read`, { method: "POST" }).catch(() => undefined);
      } catch {
        if (initial) {
          setMessages([]);
          setThreadError("Couldn't load this conversation.");
        }
      } finally {
        if (initial) setThreadLoading(false);
      }
    },
    [selectedId]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (requestedId) setSelectedId(requestedId);
  }, [requestedId]);

  useEffect(() => {
    setPending(null);
    setTableDraft(null);
    setTableDirty(false);
    setThreadError(null);
    void loadThread(true);
  }, [selectedId, loadThread]);

  // Poll while a thread is open (every 4s), same cadence as web.
  useEffect(() => {
    if (!selectedId) return;
    const id = setInterval(() => void loadThread(false), 4000);
    return () => clearInterval(id);
  }, [selectedId, loadThread]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages]);

  async function send() {
    const athleteId = selectedId;
    const body = draft.trim();
    if (!athleteId || !body) return;
    setSending(true);
    setThreadError(null);
    try {
      const res = await apiFetch(`/api/coach/athletes/${athleteId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { message?: MessageView };
      if (!res.ok || !payload.message) {
        setThreadError("Message was not sent. Try again.");
        return;
      }
      setDraft("");
      setMessages((prev) => [...prev, payload.message!]);
      await load();
    } catch {
      setThreadError("Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function pickAndUploadImage() {
    if (!selectedId || pending) return;
    const result = await DocumentPicker.getDocumentAsync({ type: "image/*" });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setMediaBusy(true);
    setThreadError(null);
    try {
      const form = new FormData();
      form.append("file", {
        uri: asset.uri,
        name: asset.name ?? "workout.jpg",
        type: asset.mimeType ?? "image/jpeg",
      } as unknown as Blob);
      form.append("context", "workout");
      const res = await apiFetch(`/api/coach/athletes/${selectedId}/media`, { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { media?: ChatMedia; error?: string };
      if (!res.ok || !json.media) {
        setThreadError(json.error === "file_too_large" ? "Image is too large." : "Couldn't upload the image.");
        return;
      }
      setPending(json.media);
      setTableDraft(null);
      setTableDirty(false);
    } catch {
      setThreadError("Network error uploading image.");
    } finally {
      setMediaBusy(false);
    }
  }

  async function convertPending() {
    if (!pending) return;
    setMediaBusy(true);
    setThreadError(null);
    try {
      const res = await apiFetch(`/api/coach/media/${pending.id}/convert`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { media?: ChatMedia };
      if (res.ok && json.media) {
        setPending(json.media);
        setTableDraft(json.media.conversion.table);
        setTableDirty(false);
      } else {
        setThreadError("Couldn't convert the image to a table.");
      }
    } catch {
      setThreadError("Network error converting.");
    } finally {
      setMediaBusy(false);
    }
  }

  function discardPending() {
    setPending(null);
    setTableDraft(null);
    setTableDirty(false);
  }

  async function sendPendingMedia() {
    if (!pending) return;
    setMediaBusy(true);
    setThreadError(null);
    try {
      if (tableDirty && tableDraft) {
        const patchRes = await apiFetch(`/api/coach/media/${pending.id}/table`, {
          method: "PATCH",
          body: JSON.stringify({ table: tableDraft }),
        });
        const patchJson = (await patchRes.json().catch(() => ({}))) as { media?: ChatMedia };
        if (!patchRes.ok || !patchJson.media) {
          setThreadError("Couldn't save your table edits — try again before sending.");
          return;
        }
        setPending(patchJson.media);
        setTableDirty(false);
      }
      const caption = draft.trim();
      const res = await apiFetch(`/api/coach/media/${pending.id}/send`, {
        method: "POST",
        body: JSON.stringify(caption ? { caption } : {}),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: MessageView };
      if (!res.ok || !json.message) {
        setThreadError("Couldn't send the image.");
        return;
      }
      setMessages((prev) => [...prev, json.message!]);
      setPending(null);
      setTableDraft(null);
      setTableDirty(false);
      setDraft("");
      await load();
    } catch {
      setThreadError("Network error sending.");
    } finally {
      setMediaBusy(false);
    }
  }

  const unreadTotal = threads.reduce((sum, thread) => sum + thread.unreadCount, 0);
  const messagedIds = new Set(threads.map((thread) => thread.partyId));
  const starters = athletes
    .filter((athlete) => !messagedIds.has(athlete.athleteId))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (selectedId) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <View style={styles.chatHeader}>
            <Pressable onPress={() => setSelectedId(null)} hitSlop={10} style={styles.chatBack}>
              <Ionicons name="arrow-back" size={20} color={colors.ink} />
            </Pressable>
            <View style={styles.chatAvatar}>
              <Text style={styles.chatAvatarText}>{(selectedParty?.name || "?").charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.chatName} numberOfLines={1}>{selectedParty?.name || "Athlete"}</Text>
              <Text style={styles.chatSubtitle} numberOfLines={1}>{selectedParty?.subtitle || "Direct message"}</Text>
            </View>
          </View>

          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.chatBody}>
            {threadLoading ? (
              <ActivityIndicator color={accent} style={{ marginTop: 32 }} />
            ) : messages.length === 0 ? (
              <View style={styles.chatEmpty}>
                <Text style={styles.chatEmptyTitle}>No messages yet</Text>
                <Text style={styles.chatEmptySub}>Say hello to start the conversation.</Text>
              </View>
            ) : (
              messages.map((message, i) => {
                const prevMessage = messages[i - 1];
                const showDay =
                  !prevMessage || new Date(prevMessage.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                return (
                  <View key={message.id}>
                    {showDay ? <Text style={styles.dayDivider}>{dayLabel(message.createdAt)}</Text> : null}
                    <View style={[styles.messageRow, message.mine ? styles.messageRowMine : null]}>
                      <View
                        style={[
                          styles.bubble,
                          message.media ? styles.bubbleMedia : null,
                          !message.media && message.mine ? { backgroundColor: `${accent}1f`, borderColor: `${accent}40` } : null,
                        ]}
                      >
                        {message.media ? (
                          <ChatMediaBubble media={message.media} role="coach" mine={message.mine} imageStyle={styles.mediaImage} />
                        ) : null}
                        <View style={message.media ? styles.mediaCaption : undefined}>
                          {message.body ? (
                            <Text style={[styles.bubbleText, !message.media && message.mine ? { color: theme.accentStrong } : null]}>
                              {message.body}
                            </Text>
                          ) : null}
                          <Text style={styles.bubbleTime}>{timeLabel(message.createdAt)}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {threadError ? (
            <View style={{ paddingHorizontal: 16 }}>
              <Muted style={{ color: colors.bad }}>{threadError}</Muted>
            </View>
          ) : null}

          {pending ? (
            <View style={styles.pendingCard}>
              <View style={styles.pendingRow}>
                <ChatMediaBubble media={pending} role="coach" imageStyle={styles.pendingThumb} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pendingName} numberOfLines={1}>{pending.originalName}</Text>
                  <Text style={styles.pendingSub}>Ready to send · caption optional below</Text>
                  <View style={styles.pendingActions}>
                    {pending.conversion.status === "completed" ? (
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>Table extracted ✓</Text>
                      </View>
                    ) : (
                      <Pressable onPress={convertPending} disabled={mediaBusy} style={styles.pendingButton}>
                        <Text style={styles.pendingButtonText}>
                          {mediaBusy ? "Converting…" : "Convert to table"}
                        </Text>
                      </Pressable>
                    )}
                    <Pressable onPress={discardPending} disabled={mediaBusy} style={styles.pendingButton}>
                      <Text style={styles.pendingButtonText}>Discard</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
              {pending.conversion.status === "completed" ? (
                <EditableWorkoutTable
                  rows={tableDraft ?? pending.conversion.table}
                  onChange={(rows) => {
                    setTableDraft(rows);
                    setTableDirty(true);
                  }}
                />
              ) : null}
            </View>
          ) : null}

          <View style={styles.composer}>
            <Pressable
              onPress={pickAndUploadImage}
              disabled={mediaBusy || Boolean(pending)}
              style={[styles.attachButton, { opacity: mediaBusy || pending ? 0.5 : 1 }]}
              accessibilityLabel="Attach image"
            >
              <Ionicons name="add" size={22} color={colors.inkMuted} />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={pending ? "Add a caption…" : "Message…"}
              placeholderTextColor={colors.inkFaint}
              multiline
              maxLength={4000}
              style={styles.input}
            />
            <Pressable
              onPress={() => (pending ? void sendPendingMedia() : void send())}
              disabled={pending ? mediaBusy : !draft.trim() || sending}
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: accent, opacity: (pending ? !mediaBusy : draft.trim() && !sending) ? (pressed ? 0.88 : 1) : 0.42 },
              ]}
              accessibilityLabel={pending ? "Send image" : "Send"}
            >
              {sending || (mediaBusy && pending) ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="send" size={18} color="#fff" />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        ref={tourScrollRef}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={accent} />}
      >
        <ScreenHeader
          title="Messages"
          accent={accent}
          roleLabel="Coach"
          subtitle="Direct chats with your athletes"
        />

        {loading && parties.length === 0 ? (
          <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Card>
            <Muted>{error}</Muted>
          </Card>
        ) : (
          <>
            <SpotlightTarget id="mobile-coach-messages" style={messagesHighlight}>
            <MessagesHome
              threads={threads}
              athletes={athletes}
              starters={starters}
              unreadTotal={unreadTotal}
              query={query}
              onQueryChange={setQuery}
              filter={homeFilter}
              onFilterChange={setHomeFilter}
              onSelect={setSelectedId}
            />
            </SpotlightTarget>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** RN equivalent of the web app's editable pre-send workout table. */
function EditableWorkoutTable({
  rows,
  onChange,
}: {
  rows: WorkoutTableRow[];
  onChange: (rows: WorkoutTableRow[]) => void;
}) {
  function updateRow(i: number, patch: Partial<WorkoutTableRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function addRow() {
    onChange([...rows, { name: "" }]);
  }

  return (
    <View style={styles.tableCard}>
      <Text style={styles.tableHeader}>
        Review &amp; edit before sending · {rows.length} {rows.length === 1 ? "exercise" : "exercises"}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.tableRow, styles.tableHeadRow]}>
            <Text style={[styles.tableCellHead, styles.colName]}>Exercise</Text>
            <Text style={[styles.tableCellHead, styles.colSmall]}>Sets</Text>
            <Text style={[styles.tableCellHead, styles.colSmall]}>Reps</Text>
            <Text style={[styles.tableCellHead, styles.colMed]}>Duration</Text>
            <Text style={[styles.tableCellHead, styles.colMed]}>Distance</Text>
            <Text style={[styles.tableCellHead, styles.colMed]}>Intensity</Text>
            <View style={styles.colRemove} />
          </View>
          <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
            {rows.map((r, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : null]}>
                <TextInput
                  value={r.name}
                  placeholder="Exercise name"
                  placeholderTextColor={colors.inkFaint}
                  onChangeText={(v) => updateRow(i, { name: v })}
                  style={[styles.tableInput, styles.colName]}
                />
                <TextInput
                  value={r.sets ?? ""}
                  onChangeText={(v) => updateRow(i, { sets: v })}
                  style={[styles.tableInput, styles.colSmall]}
                />
                <TextInput
                  value={r.reps ?? ""}
                  onChangeText={(v) => updateRow(i, { reps: v })}
                  style={[styles.tableInput, styles.colSmall]}
                />
                <TextInput
                  value={r.duration ?? ""}
                  onChangeText={(v) => updateRow(i, { duration: v })}
                  style={[styles.tableInput, styles.colMed]}
                />
                <TextInput
                  value={r.distance ?? ""}
                  onChangeText={(v) => updateRow(i, { distance: v })}
                  style={[styles.tableInput, styles.colMed]}
                />
                <TextInput
                  value={r.intensity ?? ""}
                  onChangeText={(v) => updateRow(i, { intensity: v })}
                  style={[styles.tableInput, styles.colMed]}
                />
                <Pressable onPress={() => removeRow(i)} style={styles.colRemove} hitSlop={6}>
                  <Ionicons name="close" size={14} color={colors.inkFaint} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </ScrollView>
      <Pressable onPress={addRow} style={styles.addRowButton}>
        <Text style={styles.addRowText}>+ Add exercise</Text>
      </Pressable>
    </View>
  );
}

const HOME_FILTERS: { key: HomeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "recent", label: "Recent" },
  { key: "archived", label: "Archived" },
];

function MessagesHome({
  threads,
  athletes,
  starters,
  unreadTotal,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  onSelect,
}: {
  threads: ThreadSummary[];
  athletes: Athlete[];
  starters: Athlete[];
  unreadTotal: number;
  query: string;
  onQueryChange: (value: string) => void;
  filter: HomeFilter;
  onFilterChange: (value: HomeFilter) => void;
  onSelect: (id: string) => void;
}) {
  const athleteById = useMemo(() => new Map(athletes.map((athlete) => [athlete.athleteId, athlete])), [athletes]);

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads
      .filter((thread) => {
        if (filter === "unread") return thread.unreadCount > 0;
        if (filter === "archived") return false; // no archiving feature yet — always empty, never fabricated
        return true;
      })
      .filter((thread) => {
        if (!q) return true;
        return thread.partyName.toLowerCase().includes(q) || thread.lastMessage.toLowerCase().includes(q);
      })
      .sort((a, b) => (filter === "recent" || filter === "all" ? new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime() : 0));
  }, [threads, filter, query]);

  const filteredStarters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return starters;
    return starters.filter(
      (athlete) => athlete.name.toLowerCase().includes(q) || athleteMeta(athlete).toLowerCase().includes(q)
    );
  }, [starters, query]);

  return (
    <View style={styles.home}>
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={15} color={colors.inkFaint} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search athlete or message"
            placeholderTextColor={colors.inkFaint}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.filterButton}>
          <Ionicons name="options-outline" size={17} color={colors.inkMuted} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.homeFilterRow}>
        {HOME_FILTERS.map((item) => {
          const active = item.key === filter;
          return (
            <Pressable
              key={item.key}
              onPress={() => onFilterChange(item.key)}
              style={[styles.homeFilterChip, active ? styles.homeFilterChipActive : null]}
            >
              <Text style={[styles.homeFilterText, active ? { color: theme.accentStrong } : null]}>
                {item.label}
              </Text>
              {item.key === "unread" && unreadTotal > 0 ? (
                <View style={styles.homeFilterBadge}>
                  <Text style={styles.homeFilterBadgeText}>{unreadTotal}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {threads.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="chatbubble-outline" size={19} color={colors.inkFaint} />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptySub}>Start one with an athlete below.</Text>
        </Card>
      ) : (
        <View>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeaderLabel}>Recent conversations</Text>
            <View style={styles.sectionHeaderRight}>
              <Text style={styles.sectionHeaderCount}>{filteredThreads.length}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.inkFaint} />
            </View>
          </View>
          {filteredThreads.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Muted>No conversations match.</Muted>
            </Card>
          ) : (
            <View style={styles.threadList}>
              {filteredThreads.map((thread) => (
                <Pressable key={thread.partyId} onPress={() => onSelect(thread.partyId)} style={styles.threadRow}>
                  <PersonAvatar id={thread.partyId} name={thread.partyName} avatar={athleteById.get(thread.partyId)?.avatar} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.threadTop}>
                      <Text style={styles.threadName} numberOfLines={1}>{thread.partyName || "Athlete"}</Text>
                      <Text style={styles.threadTime}>{messageTime(thread.lastAt)}</Text>
                    </View>
                    <Text style={styles.threadPreview} numberOfLines={1}>
                      {thread.lastSenderRole === "coach" ? "You: " : ""}
                      {thread.lastMessage}
                    </Text>
                  </View>
                  {thread.unreadCount > 0 ? (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>{thread.unreadCount}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {filteredStarters.length > 0 ? (
        <View>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeaderLabel}>Start a conversation</Text>
            <Text style={styles.sectionHeaderCount}>{filteredStarters.length}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.starterRow}>
            {filteredStarters.map((athlete) => (
              <Pressable key={athlete.athleteId} onPress={() => onSelect(athlete.athleteId)} style={styles.starterCard}>
                <PersonAvatar id={athlete.athleteId} name={athlete.name} avatar={athlete.avatar} size={52} />
                <Text style={styles.starterName} numberOfLines={1}>{athlete.name || "Athlete"}</Text>
                <Text style={styles.starterMeta} numberOfLines={1}>{athlete.position || athlete.sport || "Athlete"}</Text>
                <View style={styles.starterChatButton}>
                  <Ionicons name="chatbubble-outline" size={14} color={theme.accent} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function PersonAvatar({ id, name, avatar, size = 40 }: { id: string; name: string; avatar?: AvatarInfo; size?: number }) {
  const { bg, fg } = paletteFor(id);
  return (
    <PhotoAvatar
      avatar={avatar}
      name={name || "Athlete"}
      size={size}
      accentSoft={bg}
      accentStrong={fg}
      photoPath={`/api/coach/athletes/${id}/avatar/file`}
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 28 },
  home: { gap: 16 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchWrap: {
    flex: 1,
    height: 46,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  filterButton: {
    height: 46,
    width: 46,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
  },
  homeFilterRow: { gap: 6, paddingRight: 2 },
  homeFilterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  homeFilterChipActive: { backgroundColor: theme.accentSoft, borderColor: theme.accent + "55" },
  homeFilterText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  homeFilterBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  homeFilterBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sectionHeaderLabel: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  sectionHeaderRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  sectionHeaderCount: { color: colors.inkFaint, fontSize: 11, fontWeight: "900" },
  emptyCard: { minHeight: 142, alignItems: "center", justifyContent: "center", gap: 6 },
  emptyTitle: { color: colors.inkMuted, fontSize: 17, fontWeight: "600" },
  emptySub: { color: colors.inkFaint, fontSize: 13 },
  threadList: { gap: 8 },
  threadRow: {
    minHeight: 68,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  threadTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  threadName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 14, fontWeight: "800" },
  threadTime: { color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  threadPreview: { marginTop: 2, color: colors.inkMuted, fontSize: 12 },
  unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  unreadText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  starterRow: { gap: 10, paddingRight: 2 },
  starterCard: {
    width: 108,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    padding: 12,
    gap: 6,
  },
  starterName: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  starterMeta: { color: colors.inkFaint, fontSize: 10, marginTop: -4 },
  starterChatButton: {
    height: 26,
    width: 26,
    borderRadius: 13,
    backgroundColor: theme.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },

  // Full-screen chat thread — mirrors the web app's dedicated conversation page.
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  chatBack: { height: 36, width: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  chatAvatar: { height: 38, width: 38, borderRadius: 19, backgroundColor: theme.accentSoft, alignItems: "center", justifyContent: "center" },
  chatAvatarText: { color: theme.accentStrong, fontSize: 15, fontWeight: "900" },
  chatName: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  chatSubtitle: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },
  chatBody: { padding: 14, gap: 8, flexGrow: 1 },
  chatEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 60 },
  chatEmptyTitle: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  chatEmptySub: { color: colors.inkFaint, fontSize: 11 },
  dayDivider: { alignSelf: "center", color: colors.inkFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginVertical: 8 },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  messageRowMine: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "82%",
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  bubbleMedia: { padding: 0, borderWidth: 0, backgroundColor: "transparent" },
  mediaCaption: { paddingHorizontal: 4, paddingTop: 5 },
  mediaImage: { width: 230, borderRadius: radius.md },
  bubbleText: { color: colors.ink, fontSize: 14, lineHeight: 19 },
  bubbleTime: { alignSelf: "flex-end", marginTop: 4, color: colors.inkFaint, fontSize: 10, fontWeight: "700" },

  pendingCard: { marginHorizontal: 12, marginBottom: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 10 },
  pendingRow: { flexDirection: "row", gap: 10 },
  pendingThumb: { width: 72, height: 72, borderRadius: radius.sm },
  pendingName: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  pendingSub: { color: colors.inkFaint, fontSize: 11, marginTop: 2 },
  pendingActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pendingButton: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 5 },
  pendingButtonText: { color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  pendingBadge: { borderRadius: radius.sm, backgroundColor: `${colors.ok}26`, paddingHorizontal: 8, paddingVertical: 5 },
  pendingBadgeText: { color: colors.ok, fontSize: 11, fontWeight: "700" },

  tableCard: { marginTop: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  tableHeader: { paddingHorizontal: 8, paddingVertical: 6, fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, color: colors.inkFaint, backgroundColor: colors.surfaceInset, borderBottomWidth: 1, borderBottomColor: colors.line },
  tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, gap: 4 },
  tableHeadRow: { backgroundColor: colors.surfaceRaised },
  tableRowAlt: { backgroundColor: colors.surfaceInset },
  tableCellHead: { fontSize: 9, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase" },
  tableInput: { fontSize: 11, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: colors.surface },
  colName: { width: 120 },
  colSmall: { width: 48 },
  colMed: { width: 72 },
  colRemove: { width: 24, alignItems: "center" },
  addRowButton: { paddingHorizontal: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.line },
  addRowText: { color: theme.accentStrong, fontSize: 11, fontWeight: "700" },

  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  attachButton: { height: 44, width: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 104,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    color: colors.ink,
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  sendButton: { height: 44, width: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
