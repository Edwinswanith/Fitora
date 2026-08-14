import type { CoachOption, InterpretV2Response, VoiceActionV2, VoiceIntentNameV2 } from "./types";

/**
 * Client-side mirror of the conversation (plan §8.3). The server's
 * VoicePendingState is the durable/authoritative copy; this is a cache of it
 * for immediate UI responsiveness — no network round-trip needed to render
 * the confirmation card, live transcript, etc.
 */
export type VoiceAssistantPhase =
  | "idle"
  | "listening"
  | "processing"
  | "collecting"
  | "confirming"
  | "needs_coach"
  | "executing"
  | "done"
  | "error";

export type VoiceAssistantState = {
  phase: VoiceAssistantPhase;
  intent: VoiceIntentNameV2 | null;
  entities: Record<string, unknown>;
  missingFields: string[];
  requiresConfirmation: boolean;
  action: VoiceActionV2 | null;
  spokenResponse: string;
  lastTranscript: string;
  errorMessage: string | null;
  successMessage: string | null;
  /** The real answer to a show_* question, fetched and formatted client-side (answerFetchers.ts) — distinct from successMessage, which confirms a write. */
  answerText: string | null;
  /** Generated once per pending workflow and reused across retries — never regenerated mid-confirmation (plan §6). */
  clientActionId: string | null;
  coachChoices: CoachOption[] | null;
  resolvedCoachId: string | null;
};

export const initialVoiceAssistantState: VoiceAssistantState = {
  phase: "idle",
  intent: null,
  entities: {},
  missingFields: [],
  requiresConfirmation: false,
  action: null,
  spokenResponse: "",
  lastTranscript: "",
  errorMessage: null,
  successMessage: null,
  answerText: null,
  clientActionId: null,
  coachChoices: null,
  resolvedCoachId: null,
};

export type VoiceAssistantEvent =
  | { type: "LISTENING" }
  | { type: "PROCESSING"; transcript: string }
  | { type: "TURN"; payload: InterpretV2Response; clientActionId: string | null }
  | { type: "NEEDS_COACH"; coaches: CoachOption[] }
  | { type: "COACH_CHOSEN"; coachId: string }
  | { type: "EXECUTING" }
  | { type: "EXECUTED"; message: string }
  | { type: "ANSWERED"; text: string }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

function phaseForAction(action: VoiceActionV2): VoiceAssistantPhase {
  switch (action) {
    case "collect_fields":
      return "collecting";
    case "ready_to_confirm":
      return "confirming";
    case "execute":
      return "executing";
    case "navigate":
    case "answer":
      return "done";
    case "reject":
      return "idle";
    default:
      return "idle";
  }
}

export function voiceAssistantReducer(state: VoiceAssistantState, event: VoiceAssistantEvent): VoiceAssistantState {
  switch (event.type) {
    case "LISTENING":
      return { ...initialVoiceAssistantState, phase: "listening" };

    case "PROCESSING":
      return { ...state, phase: "processing", lastTranscript: event.transcript, errorMessage: null };

    case "TURN": {
      const phase = phaseForAction(event.payload.action);
      // A fresh (non-confirming) turn starts a new workflow — drop any
      // clientActionId from a prior, now-superseded pending action.
      const clientActionId =
        phase === "confirming" ? (state.clientActionId ?? event.clientActionId) : phase === "collecting" ? state.clientActionId : null;
      return {
        ...state,
        phase,
        intent: event.payload.intent,
        entities: event.payload.entities,
        missingFields: event.payload.missingFields,
        requiresConfirmation: event.payload.requiresConfirmation,
        action: event.payload.action,
        spokenResponse: event.payload.spokenResponse,
        errorMessage: null,
        clientActionId,
      };
    }

    case "NEEDS_COACH":
      return { ...state, phase: "needs_coach", coachChoices: event.coaches };

    case "COACH_CHOSEN":
      return { ...state, phase: "confirming", coachChoices: null, resolvedCoachId: event.coachId };

    case "EXECUTING":
      return { ...state, phase: "executing", errorMessage: null };

    case "EXECUTED":
      return { ...initialVoiceAssistantState, phase: "done", successMessage: event.message };

    case "ANSWERED":
      return { ...initialVoiceAssistantState, phase: "done", answerText: event.text };

    case "ERROR":
      return { ...state, phase: "error", errorMessage: event.message };

    case "RESET":
      return initialVoiceAssistantState;

    default:
      return state;
  }
}
