export const SESSION_SLOTS = ["AM", "AFT", "PM"] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

export const SLOT_LABEL: Record<SessionSlot, string> = {
  AM: "AM",
  AFT: "Afternoon",
  PM: "PM",
};
