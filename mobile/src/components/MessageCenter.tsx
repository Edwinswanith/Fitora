import type { ChatMedia } from "./ChatMediaBubble";

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
