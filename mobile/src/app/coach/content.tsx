import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import {
  ActionButton,
  AppCard,
  EmptyState,
  ErrorState,
  IconTile,
  LoadingState,
  PrimaryAppBar,
  ScreenContainer,
  SectionHeader,
  SegmentedControl,
  StatusChip,
  VideoThumb,
} from "../../components/fitora";
import { apiFetch } from "../../lib/api";
import { colors, radius } from "../../lib/theme";
import { formatDuration, loadCoachContentData, titleCase, todayKey, useAsyncData, type CoachContentData, type CoachVideo } from "../../lib/fitoraData";

type Tab = "library" | "assigned" | "analytics";
type Category = "all" | "exercise" | "workouts" | "nutrition" | "recovery";
type ContentAction = "assign" | "workout";
type UploadDraft = {
  uri: string;
  name: string;
  mimeType: string;
  title: string;
  category: string;
  visibility: "private" | "subscribers" | "selected_clients" | "public_preview";
};

const CATEGORY_FILTERS: { value: Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "exercise", label: "Exercise" },
  { value: "workouts", label: "Workouts" },
  { value: "nutrition", label: "Nutrition" },
  { value: "recovery", label: "Recovery" },
];

export default function CoachContent() {
  const state = useAsyncData(loadCoachContentData, []);
  const [tab, setTab] = useState<Tab>("library");
  const [category, setCategory] = useState<Category>("all");
  const [draft, setDraft] = useState<UploadDraft | null>(null);
  const [action, setAction] = useState<ContentAction | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [menuVideoId, setMenuVideoId] = useState<string | null>(null);
  const [editingVideo, setEditingVideo] = useState<CoachVideo | null>(null);
  const [videoActionMessage, setVideoActionMessage] = useState<string | null>(null);
  const [videoActionBusy, setVideoActionBusy] = useState<string | null>(null);

  async function archiveVideo(video: CoachVideo) {
    setVideoActionBusy(video.id);
    setVideoActionMessage(null);
    try {
      const res = await apiFetch(`/api/coach/videos/${video.id}/${video.isArchived ? "unarchive" : "archive"}`, { method: "POST" });
      if (!res.ok) {
        setVideoActionMessage("Could not update this video.");
        return;
      }
      setMenuVideoId(null);
      state.reload();
    } catch {
      setVideoActionMessage("Network error while updating video.");
    } finally {
      setVideoActionBusy(null);
    }
  }

  async function deleteVideo(video: CoachVideo) {
    setVideoActionBusy(video.id);
    setVideoActionMessage(null);
    try {
      const res = await apiFetch(`/api/coach/videos/${video.id}`, { method: "DELETE" });
      if (!res.ok) {
        setVideoActionMessage("Could not delete this video.");
        return;
      }
      setMenuVideoId(null);
      state.reload();
    } catch {
      setVideoActionMessage("Network error while deleting video.");
    } finally {
      setVideoActionBusy(null);
    }
  }

  async function pickVideo() {
    setMessage(null);
    const result = await DocumentPicker.getDocumentAsync({ type: "video/*", copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const baseTitle = (asset.name ?? "Training video").replace(/\.[^.]+$/, "").trim() || "Training video";
    setDraft({
      uri: asset.uri,
      name: asset.name ?? "video.mp4",
      mimeType: asset.mimeType ?? "video/mp4",
      title: baseTitle,
      category: "exercise",
      visibility: "private",
    });
  }

  async function uploadVideo() {
    if (!draft || !draft.title.trim()) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", {
        uri: draft.uri,
        name: draft.name,
        type: draft.mimeType,
      } as unknown as Blob);
      body.append("title", draft.title.trim());
      body.append("category", draft.category);
      body.append("visibility", draft.visibility);
      const res = await apiFetch("/api/coach/videos", { method: "POST", body });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        setMessage(error?.error === "unsupported_file_type" ? "Choose an MP4, WebM, or MOV video." : "Could not upload this video.");
        return;
      }
      setDraft(null);
      setMessage("Video uploaded.");
      state.reload();
    } catch {
      setMessage("Network error while uploading.");
    } finally {
      setUploading(false);
    }
  }

  if (state.loading && !state.data) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (state.error && !state.data) {
    return (
      <ScreenContainer>
        <ErrorState message={state.error} onRetry={state.reload} />
      </ScreenContainer>
    );
  }

  const data = state.data;
  if (!data) return null;

  const filtered = data.videos.filter((video) => category === "all" || video.category === category);
  const recent = [...data.videos].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const subscriberCount = data.videos.filter((video) => video.visibility === "subscribers").length;
  const publicCount = data.videos.filter((video) => video.visibility === "public_preview").length;
  const assignedCount = data.videos.filter((video) => video.visibility === "selected_clients").length;
  const libraryTotal = data.videos.length;
  const subscriberTotal = subscriberCount;
  const publicTotal = publicCount;

  return (
    <ScreenContainer refreshing={state.refreshing} onRefresh={state.reload}>
      <PrimaryAppBar title="Content" showNotifications={false} actionLabel="+ Upload" onAction={pickVideo} />

      <SegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: "library", label: "Library" },
          { value: "assigned", label: "Assigned" },
          { value: "analytics", label: "Analytics" },
        ]}
      />

      {draft ? (
        <UploadCard draft={draft} setDraft={setDraft} uploading={uploading} onUpload={uploadVideo} onCancel={() => setDraft(null)} />
      ) : null}
      {action ? <ContentActionCard data={data} action={action} onClose={() => setAction(null)} onDone={state.reload} /> : null}
      {editingVideo ? (
        <EditVideoCard
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSaved={() => {
            setEditingVideo(null);
            setMenuVideoId(null);
            state.reload();
          }}
        />
      ) : null}
      {message ? <Text style={message === "Video uploaded." ? styles.successText : styles.errorText}>{message}</Text> : null}
      {videoActionMessage ? <Text style={styles.errorText}>{videoActionMessage}</Text> : null}

      {tab === "library" ? (
        <>
          <View style={styles.filterRow}>
            {CATEGORY_FILTERS.map((item) => (
              <Pressable
                key={item.value}
                onPress={() => setCategory(item.value)}
                style={[styles.filterChip, category === item.value ? styles.filterChipActive : null]}
              >
                <Text style={[styles.filterText, category === item.value ? styles.filterTextActive : null]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          <SectionHeader title="Recently Added" action={recent ? "View all" : undefined} onAction={() => setCategory("all")} />
          {recent ? (
            <FeaturedVideo
              video={recent}
              menuOpen={menuVideoId === recent.id}
              busy={videoActionBusy === recent.id}
              onToggleMenu={() => setMenuVideoId((current) => (current === recent.id ? null : recent.id))}
              onEdit={() => { setEditingVideo(recent); setMenuVideoId(null); }}
              onArchive={() => archiveVideo(recent)}
              onDelete={() => deleteVideo(recent)}
            />
          ) : <EmptyState title="No videos yet" body="Upload your first coaching video to build a reusable library." icon="videocam-outline" />}

          <SectionHeader title="Video Library" action={filtered.length ? "View all" : undefined} onAction={() => setCategory("all")} />
          <AppCard>
            {filtered.length ? (
              filtered.map((video, index) => (
                <View key={video.id}>
                  <VideoRow
                    video={video}
                    menuOpen={menuVideoId === video.id}
                    busy={videoActionBusy === video.id}
                    onToggleMenu={() => setMenuVideoId((current) => (current === video.id ? null : video.id))}
                    onEdit={() => { setEditingVideo(video); setMenuVideoId(null); }}
                    onArchive={() => archiveVideo(video)}
                    onDelete={() => deleteVideo(video)}
                  />
                  {index < filtered.length - 1 ? <Divider /> : null}
                </View>
              ))
            ) : (
              <Text style={styles.muted}>No videos match this filter.</Text>
            )}
          </AppCard>

          <AppCard>
            <View style={styles.statGrid}>
              <ContentStat icon="film-outline" value={String(libraryTotal)} label="videos" />
              <ContentStat icon="people-outline" value={String(subscriberTotal)} label="subscriber videos" tone="success" />
              <ContentStat icon="globe-outline" value={String(publicTotal)} label="public previews" />
            </View>
          </AppCard>

          <SectionHeader title="Quick Actions" />
          <View style={styles.actionRow}>
            <ActionButton label="Upload Video" icon="cloud-upload-outline" onPress={pickVideo} />
            <ActionButton label="Assign Video" icon="people-outline" onPress={() => setAction("assign")} />
            <ActionButton label="Add to Workout" icon="barbell-outline" onPress={() => setAction("workout")} />
          </View>
        </>
      ) : null}

      {tab === "assigned" ? (
        <AppCard>
          {assignedCount ? (
            data.videos
              .filter((video) => video.visibility === "selected_clients")
              .map((video, index, list) => (
                <View key={video.id}>
                  <VideoRow
                    video={video}
                    menuOpen={menuVideoId === video.id}
                    busy={videoActionBusy === video.id}
                    onToggleMenu={() => setMenuVideoId((current) => (current === video.id ? null : video.id))}
                    onEdit={() => { setEditingVideo(video); setMenuVideoId(null); }}
                    onArchive={() => archiveVideo(video)}
                    onDelete={() => deleteVideo(video)}
                  />
                  {index < list.length - 1 ? <Divider /> : null}
                </View>
              ))
          ) : (
            <EmptyState title="No selected-client videos" body="Videos assigned to specific clients will appear here." icon="people-outline" />
          )}
        </AppCard>
      ) : null}

      {tab === "analytics" ? (
        <AppCard>
          <View style={styles.analyticsGrid}>
            <ContentStat icon="film-outline" value={String(libraryTotal)} label="library size" />
            <ContentStat icon="people-outline" value={String(subscriberCount + assignedCount)} label="gated videos" tone="success" />
            <ContentStat icon="globe-outline" value={String(publicTotal)} label="preview videos" />
          </View>
          <View style={styles.metricBlock}>
            <Text style={styles.cardTitle}>Video analytics</Text>
            <Text style={styles.muted}>Watch progress and completion rates will appear as clients view assigned videos.</Text>
          </View>
        </AppCard>
      ) : null}
    </ScreenContainer>
  );
}

function ContentActionCard({
  data,
  action,
  onClose,
  onDone,
}: {
  data: CoachContentData;
  action: ContentAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [videoId, setVideoId] = useState(data.videos[0]?.id ?? "");
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>(() => data.roster[0]?.athleteId ? [data.roster[0].athleteId] : []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const selectedVideo = data.videos.find((video) => video.id === videoId) ?? null;

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submit() {
    setMessage(null);
    if (!selectedVideo) {
      setMessage("Select a video first.");
      return;
    }
    if (!selectedAthleteIds.length) {
      setMessage("Select at least one client.");
      return;
    }
    setSaving(true);
    try {
      const patchRes = await apiFetch(`/api/coach/videos/${selectedVideo.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          visibility: "selected_clients",
          selectedClientIds: Array.from(new Set([...(selectedVideo.selectedClientIds ?? []), ...selectedAthleteIds])),
        }),
      });
      if (!patchRes.ok) throw new Error("video_assign_failed");

      if (action === "workout") {
        const templateRes = await apiFetch("/api/workout-templates", {
          method: "POST",
          body: JSON.stringify({
            name: `Watch: ${selectedVideo.title}`,
            description: "Video task created from the Fitora content library.",
            exercises: [
              {
                title: `Watch ${selectedVideo.title}`,
                type: "checklist",
                instructions: "Open the assigned video in Content and mark this item complete after watching.",
              },
            ],
          }),
        });
        const templateJson = await templateRes.json().catch(() => ({}));
        if (!templateRes.ok || !templateJson.template?.id) throw new Error("template_failed");
        const assignRes = await apiFetch("/api/coach/workout-assignments/bulk", {
          method: "POST",
          body: JSON.stringify({ templateId: templateJson.template.id, athleteIds: selectedAthleteIds, scheduledDate: todayKey() }),
        });
        const assignJson = await assignRes.json().catch(() => ({}));
        if (!assignRes.ok && assignRes.status !== 207) throw new Error(assignJson.error || "workout_assign_failed");
      }

      setMessage(action === "assign" ? "Video assigned to selected clients." : "Video task added to selected clients' workouts.");
      onDone();
    } catch {
      setMessage("Could not complete this action. Try another video or client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppCard style={styles.uploadCard}>
      <View style={styles.uploadHeader}>
        <IconTile icon={action === "assign" ? "people-outline" : "barbell-outline"} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{action === "assign" ? "Assign Video" : "Add Video to Workout"}</Text>
          <Text style={styles.muted}>{action === "assign" ? "Publishes this video to selected clients." : "Creates a checklist workout task from this video."}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <Text style={styles.formLabel}>Video</Text>
      <View style={styles.choiceStack}>
        {data.videos.length ? data.videos.slice(0, 5).map((video) => (
          <ChoiceRow
            key={video.id}
            selected={video.id === videoId}
            title={video.title}
            subtitle={titleCase(video.category)}
            onPress={() => setVideoId(video.id)}
          />
        )) : <Text style={styles.muted}>Upload a video before assigning content.</Text>}
      </View>

      <Text style={styles.formLabel}>Clients</Text>
      <View style={styles.choiceStack}>
        {data.roster.length ? data.roster.map((client) => (
          <ChoiceRow
            key={client.athleteId}
            selected={selectedAthleteIds.includes(client.athleteId)}
            title={client.name}
            subtitle={client.sport || "Client"}
            onPress={() => toggleAthlete(client.athleteId)}
          />
        )) : <Text style={styles.muted}>Add clients before assigning content.</Text>}
      </View>

      {message ? <Text style={message.startsWith("Video") ? styles.successText : styles.errorText}>{message}</Text> : null}
      <Pressable onPress={submit} disabled={saving || !data.videos.length || !data.roster.length} style={[styles.uploadButton, saving ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadButtonText}>{action === "assign" ? "Assign Video" : "Create Workout Task"}</Text>}
      </Pressable>
    </AppCard>
  );
}

function ChoiceRow({ selected, title, subtitle, onPress }: { selected: boolean; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choiceRow, selected ? styles.choiceRowActive : null]}>
      <View style={[styles.radio, selected ? styles.radioOn : null]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.choiceTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.choiceSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

function UploadCard({
  draft,
  setDraft,
  uploading,
  onUpload,
  onCancel,
}: {
  draft: UploadDraft;
  setDraft: (draft: UploadDraft) => void;
  uploading: boolean;
  onUpload: () => void;
  onCancel: () => void;
}) {
  return (
    <AppCard style={styles.uploadCard}>
      <View style={styles.uploadHeader}>
        <IconTile icon="cloud-upload-outline" />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Upload Video</Text>
          <Text style={styles.muted} numberOfLines={1}>{draft.name}</Text>
        </View>
      </View>
      <TextInput
        value={draft.title}
        onChangeText={(title) => setDraft({ ...draft, title })}
        editable={!uploading}
        placeholder="Video title"
        placeholderTextColor={colors.inkFaint}
        style={styles.input}
      />
      <View style={styles.pickerRow}>
        {["exercise", "workouts", "nutrition", "recovery"].map((item) => (
          <Pressable
            key={item}
            onPress={() => setDraft({ ...draft, category: item })}
            style={[styles.smallChoice, draft.category === item ? styles.smallChoiceActive : null]}
          >
            <Text style={[styles.smallChoiceText, draft.category === item ? styles.smallChoiceTextActive : null]}>{titleCase(item)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.pickerRow}>
        {[
          { value: "private", label: "Private" },
          { value: "subscribers", label: "Subscribers" },
          { value: "selected_clients", label: "Selected" },
          { value: "public_preview", label: "Preview" },
        ].map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setDraft({ ...draft, visibility: item.value as UploadDraft["visibility"] })}
            style={[styles.smallChoice, draft.visibility === item.value ? styles.smallChoiceActive : null]}
          >
            <Text style={[styles.smallChoiceText, draft.visibility === item.value ? styles.smallChoiceTextActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.actionRow}>
        <ActionButton label="Cancel" onPress={onCancel} />
        <Pressable onPress={onUpload} disabled={uploading || !draft.title.trim()} style={[styles.uploadButton, uploading ? styles.disabled : null]}>
          {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadButtonText}>Save Video</Text>}
        </Pressable>
      </View>
    </AppCard>
  );
}

type VideoRowActions = {
  menuOpen: boolean;
  busy: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

function FeaturedVideo({ video, ...actions }: { video: CoachVideo } & VideoRowActions) {
  return (
    <AppCard>
      <View style={styles.featuredRow}>
        <VideoThumb duration={formatDuration(video.durationSec)} title={video.title} category={video.category} compact />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
          <Text style={styles.muted}>{titleCase(video.category)}</Text>
          <VisibilityChip visibility={video.visibility} />
          {video.isArchived ? <StatusChip label="Archived" tone="neutral" /> : null}
          <Text style={styles.muted}>{new Date(video.createdAt).toLocaleDateString()}</Text>
        </View>
        <Pressable onPress={actions.onToggleMenu} hitSlop={10}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.ink} />
        </Pressable>
      </View>
      {actions.menuOpen ? <VideoActionMenu video={video} {...actions} /> : null}
    </AppCard>
  );
}

function VideoRow({ video, ...actions }: { video: CoachVideo } & VideoRowActions) {
  return (
    <View>
      <View style={styles.videoRow}>
        <VideoThumb duration={formatDuration(video.durationSec)} title={video.title} category={video.category} compact />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.videoTitle} numberOfLines={2}>{video.title}</Text>
          <Text style={styles.muted} numberOfLines={1}>{titleCase(video.category)}</Text>
          <VisibilityChip visibility={video.visibility} />
          {video.isArchived ? <StatusChip label="Archived" tone="neutral" /> : null}
        </View>
        <Pressable onPress={actions.onToggleMenu} hitSlop={10}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.ink} />
        </Pressable>
      </View>
      {actions.menuOpen ? <VideoActionMenu video={video} {...actions} /> : null}
    </View>
  );
}

function VideoActionMenu({ video, busy, onEdit, onArchive, onDelete, onToggleMenu }: { video: CoachVideo } & VideoRowActions) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <View style={styles.videoMenu}>
      <Pressable onPress={onEdit} style={styles.videoMenuRow} disabled={busy}>
        <Text style={styles.videoMenuText}>Edit</Text>
      </Pressable>
      <Pressable onPress={onArchive} style={styles.videoMenuRow} disabled={busy}>
        <Text style={styles.videoMenuText}>{video.isArchived ? "Unarchive" : "Archive"}</Text>
      </Pressable>
      <Pressable
        onPress={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
        style={styles.videoMenuRow}
        disabled={busy}
      >
        <Text style={[styles.videoMenuText, styles.videoMenuDanger]}>{confirmingDelete ? "Confirm delete?" : "Delete"}</Text>
      </Pressable>
      <Pressable onPress={onToggleMenu} style={styles.videoMenuRow} disabled={busy}>
        <Text style={styles.videoMenuText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function EditVideoCard({ video, onClose, onSaved }: { video: CoachVideo; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(video.title);
  const [category, setCategory] = useState(video.category);
  const [visibility, setVisibility] = useState(video.visibility as UploadDraft["visibility"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/coach/videos/${video.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim(), category, visibility }),
      });
      if (!res.ok) {
        setError("Could not save changes.");
        return;
      }
      onSaved();
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppCard style={styles.uploadCard}>
      <View style={styles.uploadHeader}>
        <IconTile icon="create-outline" />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Edit Video</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <TextInput
        value={title}
        onChangeText={setTitle}
        editable={!saving}
        placeholder="Video title"
        placeholderTextColor={colors.inkFaint}
        style={styles.input}
      />
      <View style={styles.pickerRow}>
        {["exercise", "workouts", "nutrition", "recovery"].map((item) => (
          <Pressable
            key={item}
            onPress={() => setCategory(item)}
            style={[styles.smallChoice, category === item ? styles.smallChoiceActive : null]}
          >
            <Text style={[styles.smallChoiceText, category === item ? styles.smallChoiceTextActive : null]}>{titleCase(item)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.pickerRow}>
        {[
          { value: "private", label: "Private" },
          { value: "subscribers", label: "Subscribers" },
          { value: "selected_clients", label: "Selected" },
          { value: "public_preview", label: "Preview" },
        ].map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setVisibility(item.value as UploadDraft["visibility"])}
            style={[styles.smallChoice, visibility === item.value ? styles.smallChoiceActive : null]}
          >
            <Text style={[styles.smallChoiceText, visibility === item.value ? styles.smallChoiceTextActive : null]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable onPress={save} disabled={saving || !title.trim()} style={[styles.uploadButton, saving ? styles.disabled : null]}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.uploadButtonText}>Save Changes</Text>}
      </Pressable>
    </AppCard>
  );
}

function VisibilityChip({ visibility }: { visibility: string }) {
  if (visibility === "subscribers") return <StatusChip label="Subscribers" tone="success" icon="people-outline" />;
  if (visibility === "selected_clients") return <StatusChip label="Selected clients" tone="warning" icon="people-outline" />;
  if (visibility === "public_preview") return <StatusChip label="Public preview" tone="primary" icon="globe-outline" />;
  return <StatusChip label={titleCase(visibility)} tone="neutral" icon="lock-closed-outline" />;
}

function ContentStat({
  icon,
  value,
  label,
  tone = "primary",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  tone?: "primary" | "success";
}) {
  return (
    <View style={styles.contentStat}>
      <IconTile icon={icon} tone={tone} size={36} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  filterChip: {
    minHeight: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: "#fff" },
  uploadCard: { gap: 12 },
  uploadHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  closeText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  formLabel: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, fontWeight: "900", textTransform: "uppercase" },
  choiceStack: { gap: 6 },
  choiceRow: { minHeight: 45, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 9 },
  choiceRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: { width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: colors.inkFaint },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  choiceTitle: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  choiceSub: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  pickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallChoice: {
    minHeight: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  smallChoiceActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  smallChoiceText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  smallChoiceTextActive: { color: colors.primary },
  featuredRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  videoRow: { minHeight: 86, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  videoTitle: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "900" },
  cardTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  statGrid: { flexDirection: "row", gap: 10 },
  analyticsGrid: { flexDirection: "row", gap: 10 },
  contentStat: { flex: 1, alignItems: "center", gap: 5 },
  statValue: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: "900" },
  statLabel: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  actionRow: { flexDirection: "row", gap: 10 },
  uploadButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  uploadButtonText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  metricBlock: { marginTop: 18, gap: 6 },
  successText: { color: colors.ok, fontSize: 14, fontWeight: "800" },
  errorText: { color: colors.bad, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  divider: { height: 1, backgroundColor: colors.line },
  videoMenu: {
    marginTop: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    overflow: "hidden",
  },
  videoMenuRow: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  videoMenuText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  videoMenuDanger: { color: colors.bad },
});
