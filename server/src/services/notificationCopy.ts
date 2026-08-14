export const NOTIFICATION_PREVIEW_MAX = 120;

export function notificationPreview(
  text: string | null | undefined,
  maxLength = NOTIFICATION_PREVIEW_MAX
): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
