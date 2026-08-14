import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";

export type NotificationCategories = {
  reminders: boolean;
  alerts: boolean;
  deadlines: boolean;
  digests: boolean;
  milestones: boolean;
  messages: boolean;
};

export type NotificationPreferences = {
  enabled: boolean;
  categories: NotificationCategories;
  quietHours: { enabled: boolean; startMinute: number; endMinute: number };
  dailyCap: number | null;
  minIntervalMinutes: number | null;
};

export function useNotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await apiFetch("/api/notification-preferences");
      if (!res.ok) throw new Error("load_failed");
      setPrefs((await res.json()) as NotificationPreferences);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(async (patch: Record<string, unknown>) => {
    setStatus("saving");
    try {
      const res = await apiFetch("/api/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save_failed");
      setPrefs((await res.json()) as NotificationPreferences);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, []);

  return { prefs, status, update };
}
