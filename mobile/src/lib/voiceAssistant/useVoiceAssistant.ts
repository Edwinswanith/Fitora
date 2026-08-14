import { useCallback, useReducer, useRef } from "react";
import * as Crypto from "expo-crypto";
import { speakAgentReply } from "../agentSpeech";
import { apiJson } from "../api";
import { initialVoiceAssistantState, voiceAssistantReducer } from "./state";
import { executeVoiceAction, fetchAssignedCoaches } from "./actionDispatch";
import { fetchAnswerFor } from "./answerFetchers";
import type { InterpretV2Response, VoiceIntentNameV2 } from "./types";

export type UseVoiceAssistantOptions = {
  /** Called after a successful save, so the screen can refresh whatever data changed. */
  onExecuted?: (intent: VoiceIntentNameV2) => void;
};

/**
 * The V2 voice-assistant client wiring (plan Phase B). Deliberately does NOT
 * manage its own mic/STT/TTS session — AskAgentControl already owns that
 * lifecycle (start/stop, listening/speaking state, text-input fallback) via
 * its `onCommand` prop. `handleCommand` below is exactly that prop's shape:
 * pass it straight through. Every turn goes through the server's
 * deterministic policy engine (/api/athlete/voice/interpret-v2), and a write
 * only ever happens after the athlete has explicitly confirmed, via the one
 * orchestration/REST call the policy resolved to (actionDispatch.ts).
 */
export function useVoiceAssistant(options: UseVoiceAssistantOptions = {}) {
  const [state, dispatch] = useReducer(voiceAssistantReducer, initialVoiceAssistantState);
  const clientActionIdRef = useRef<string | null>(null);
  const resolvedCoachIdRef = useRef<string | null>(null);

  const interpret = useCallback(async (transcript: string): Promise<InterpretV2Response> => {
    return apiJson<InterpretV2Response>("/api/athlete/voice/interpret-v2", {
      method: "POST",
      body: JSON.stringify({ transcript }),
    });
  }, []);

  const performExecute = useCallback(
    async (intent: VoiceIntentNameV2, entities: Record<string, unknown>): Promise<string> => {
      dispatch({ type: "EXECUTING" });
      const clientActionId = clientActionIdRef.current ?? Crypto.randomUUID();
      clientActionIdRef.current = null;
      const coachId = intent === "send_coach_note" ? resolvedCoachIdRef.current ?? undefined : undefined;
      resolvedCoachIdRef.current = null;
      try {
        const { message } = await executeVoiceAction(intent, entities, { clientActionId, coachId });
        dispatch({ type: "EXECUTED", message });
        options.onExecuted?.(intent);
        return message;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong saving that. Please try again.";
        dispatch({ type: "ERROR", message });
        return message;
      }
    },
    [options]
  );

  const handleTurn = useCallback(
    async (res: InterpretV2Response): Promise<string> => {
      if (res.action === "execute") {
        return performExecute(res.intent, res.entities);
      }

      if (res.action === "answer") {
        // The server deliberately never states real data (voiceIntentPolicy's
        // spokenResponse is a fixed placeholder here) — fetch the athlete's
        // real record and say that instead. explain_app_field's res.spokenResponse
        // IS the real answer already (a canned definition), so it's passed
        // through as the fallback and used as-is.
        try {
          const text = await fetchAnswerFor(res.intent, res.spokenResponse);
          dispatch({ type: "ANSWERED", text });
          return text;
        } catch {
          const message = "Couldn't fetch that right now. Please try again.";
          dispatch({ type: "ERROR", message });
          return message;
        }
      }

      const newClientActionId = res.action === "ready_to_confirm" && !clientActionIdRef.current ? Crypto.randomUUID() : null;
      if (newClientActionId) clientActionIdRef.current = newClientActionId;
      dispatch({ type: "TURN", payload: res, clientActionId: newClientActionId });

      if (res.action === "ready_to_confirm" && res.intent === "send_coach_note") {
        try {
          const coaches = await fetchAssignedCoaches();
          if (coaches.length === 0) {
            const message = "You don't have a coach assigned yet.";
            dispatch({ type: "ERROR", message });
            return message;
          }
          if (coaches.length === 1) {
            resolvedCoachIdRef.current = coaches[0].coachId;
            dispatch({ type: "COACH_CHOSEN", coachId: coaches[0].coachId });
          } else {
            dispatch({ type: "NEEDS_COACH", coaches });
            return `Which coach — ${coaches.map((c) => c.name).join(", ")}?`;
          }
        } catch {
          const message = "Couldn't check your coach list. Please try again.";
          dispatch({ type: "ERROR", message });
          return message;
        }
      }

      return res.spokenResponse;
    },
    [performExecute]
  );

  const runTurn = useCallback(
    async (transcript: string): Promise<string> => {
      dispatch({ type: "PROCESSING", transcript });
      try {
        const res = await interpret(transcript);
        return await handleTurn(res);
      } catch {
        const message = "Sorry, I couldn't reach the server. Please try again.";
        dispatch({ type: "ERROR", message });
        return message;
      }
    },
    [interpret, handleTurn]
  );

  /**
   * Pass directly as AskAgentControl's `onCommand` prop — same signature,
   * same auto-speak-the-return-value behavior. AskAgentControl owns the
   * mic/listening/speaking UI itself; this only drives the confirmation
   * state machine (state.phase), not the "is the mic on" state.
   */
  const handleCommand = runTurn;

  const confirm = useCallback(async () => {
    const message = await runTurn("yes");
    speakAgentReply(message);
  }, [runTurn]);

  const cancel = useCallback(async () => {
    const message = await runTurn("no");
    speakAgentReply(message);
  }, [runTurn]);

  /** Tap-to-edit a field on the confirmation card — routes through the exact same server-validated update_field path a spoken correction would use. */
  const editField = useCallback(
    async (spokenFieldLabel: string, spokenValue: string) => {
      const message = await runTurn(`change ${spokenFieldLabel} to ${spokenValue}`);
      speakAgentReply(message);
    },
    [runTurn]
  );

  const chooseCoach = useCallback(
    async (coachId: string) => {
      resolvedCoachIdRef.current = coachId;
      dispatch({ type: "COACH_CHOSEN", coachId });
    },
    []
  );

  const reset = useCallback(() => {
    clientActionIdRef.current = null;
    resolvedCoachIdRef.current = null;
    dispatch({ type: "RESET" });
  }, []);

  return { state, handleCommand, confirm, cancel, editField, chooseCoach, reset };
}
