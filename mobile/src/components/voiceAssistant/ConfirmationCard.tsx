import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../AppText";
import { Card, Label, Muted, PrimaryButton } from "../ui";
import { colors, radius, space } from "../../lib/theme";
import { formatEntitiesForDisplay } from "../../lib/voiceAssistant/entityDisplay";
import type { VoiceAssistantState } from "../../lib/voiceAssistant/state";

type Props = {
  state: VoiceAssistantState;
  accent: string;
  accentInk: string;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
  onEditField: (fieldLabel: string, newValue: string) => Promise<void>;
  onChooseCoach: (coachId: string) => Promise<void>;
};

/**
 * The one editable-before-you-save surface the plan called out as missing
 * from V1 (§11) — shows exactly what the assistant understood, lets the
 * athlete tap a field to correct it (routed through the server's own
 * update_field validation, same as a spoken correction), and only writes
 * anything once Save is pressed or a spoken "yes" resolves the same way.
 */
export function ConfirmationCard({ state, accent, accentInk, onConfirm, onCancel, onEditField, onChooseCoach }: Props) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  if (state.phase === "needs_coach") {
    return (
      <Card style={styles.card}>
        <Label>Which coach?</Label>
        {(state.coachChoices ?? []).map((coach) => (
          <Pressable key={coach.coachId} style={styles.coachRow} onPress={() => onChooseCoach(coach.coachId)}>
            <Text style={styles.coachName}>{coach.name}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
          </Pressable>
        ))}
      </Card>
    );
  }

  if (state.phase !== "confirming") return null;

  const rows = formatEntitiesForDisplay(state.entities);

  function submitEdit(row: { key: string; label: string }) {
    const value = editValue.trim();
    setEditingKey(null);
    if (value) onEditField(row.label, value);
  }

  return (
    <Card style={styles.card}>
      <Label>Confirm before saving</Label>
      <Text style={styles.spoken}>{state.spokenResponse}</Text>

      {rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row) => (
            <View key={row.key} style={styles.row}>
              {editingKey === row.key ? (
                <TextInput
                  autoFocus
                  value={editValue}
                  onChangeText={setEditValue}
                  onSubmitEditing={() => submitEdit(row)}
                  onBlur={() => submitEdit(row)}
                  style={styles.input}
                  placeholder={row.value}
                />
              ) : (
                <Pressable
                  style={styles.rowContent}
                  onPress={() => {
                    setEditingKey(row.key);
                    setEditValue(row.value);
                  }}
                >
                  <Muted>{row.label}</Muted>
                  <View style={styles.valueWrap}>
                    <Text style={styles.value}>{row.value}</Text>
                    <Ionicons name="pencil-outline" size={13} color={colors.inkFaint} />
                  </View>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={onCancel} style={styles.cancelButton}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
        <View style={styles.saveButtonWrap}>
          <PrimaryButton label="Save" successLabel="Saved" accent={accent} accentInk={accentInk} onPress={onConfirm} icon="checkmark-outline" />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { position: "absolute", left: space(4), right: space(4), bottom: space(24) },
  spoken: { marginTop: space(1), marginBottom: space(3), color: colors.inkMuted },
  rows: { gap: space(2), marginBottom: space(3) },
  row: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: space(2) },
  rowContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  valueWrap: { flexDirection: "row", alignItems: "center", gap: space(1) },
  value: { fontWeight: "600", color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    color: colors.ink,
  },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space(3), marginTop: space(1) },
  cancelButton: { paddingVertical: space(2), paddingHorizontal: space(2) },
  cancelLabel: { color: colors.inkMuted, fontWeight: "600" },
  saveButtonWrap: { minWidth: 120 },
  coachRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space(3),
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  coachName: { color: colors.ink, fontWeight: "600" },
});
