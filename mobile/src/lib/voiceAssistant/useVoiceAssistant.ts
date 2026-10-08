import { useCallback, useEffect, useReducer, useRef } from "react";
import * as Crypto from "expo-crypto";
import { speakAgentReply } from "../agentSpeech";
import { apiJson } from "../api";
import { actionKey, turnFailureMessage } from "./turnRules";
import { initialVoiceAssistantState, voiceAssistantReducer } from "./state";
import { executeVoiceAction, fetchAssignedCoaches } from "./actionDispatch";
import { fetchAnswerFor } from "./answerFetchers";
import type { InterpretV2Response, VoiceIntentNameV2 } from "./types";

export type UseVoiceAssistantOptions = {
  /**
   * Called after a successful save, so the app can sync whatever data
   * changed — entities are the confirmed values that were saved, response is
   * the write endpoint's raw parsed body (server-confirmed, not a guess).
   */
  onExecuted?: (intent: VoiceIntentNameV2, entities: Record<string, unknown>, response: unknown) => void;
  /** Called for policy-approved open_screen commands. */
  onNavigate?: (screen: string) => void;
  /** The Fitora tab the athlete is currently looking at (e.g. "nutrition", "water") — sent with every turn so the server can disambiguate a vague reference like "add this" (spec item 6). Read fresh on every turn via a ref, not captured at mount. */
  currentScreen?: string;
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
  const clientActionIdRef = useRef<{ key: string; id: string } | null>(null);
  // One turn at a time across every entry point (voice, typed, confirmation
  // card): a spoken "yes" and a tapped Save must not both execute.
  const turnInFlightRef = useRef(false);
  const resolvedCoachIdRef = useRef<string | null>(null);
  const currentScreenRef = useRef<string | undefined>(options.currentScreen);
  useEffect(() => {
    currentScreenRef.current = options.currentScreen;
  }, [options.currentScreen]);

  const interpret = useCallback(async (transcript: string): Promise<InterpretV2Response> => {
    return apiJson<InterpretV2Response>("/api/athlete/voice/interpret-v2", {
      method: "POST",
      body: JSON.stringify({ transcript, currentScreen: currentScreenRef.current }),
    });
  }, []);

  const performExecute = useCallback(
    async (intent: VoiceIntentNameV2, entities: Record<string, unknown>): Promise<string> => {
      dispatch({ type: "EXECUTING" });
      const key = actionKey(intent, entities);
      const clientActionId = clientActionIdRef.current?.key === key ? clientActionIdRef.current.id : Crypto.randomUUID();
      // Kept until the save succeeds, so retrying the same command reuses it.
      clientActionIdRef.current = { key, id: clientActionId };
      const coachId = intent === "send_coach_note" ? resolvedCoachIdRef.current ?? undefined : undefined;
      resolvedCoachIdRef.current = null;
      try {
        const { message, response } = await executeVoiceAction(intent, entities, { clientActionId, coachId });
        clientActionIdRef.current = null;
        dispatch({ type: "EXECUTED", message });
        options.onExecuted?.(intent, entities, response);
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

      if (res.action === "navigate") {
        dispatch({ type: "TURN", payload: res, clientActionId: null });
        const screen = typeof res.entities.screen === "string" ? res.entities.screen : "";
        if (screen) options.onNavigate?.(screen);
        return res.spokenResponse;
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

      dispatch({ type: "TURN", payload: res, clientActionId: null });

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
    [performExecute, options]
  );

  const runTurn = useCallback(
    async (transcript: string): Promise<string> => {
      // Another turn is still running (e.g. Save tapped while a spoken "yes"
      // is processing): drop this one rather than run both.
      if (turnInFlightRef.current) return "";
      turnInFlightRef.current = true;
      dispatch({ type: "PROCESSING", transcript });
      try {
        const res = await interpret(transcript);
        return await handleTurn(res);
      } catch (err) {
        const message = turnFailureMessage(err);
        dispatch({ type: "ERROR", message });
        return message;
      } finally {
        turnInFlightRef.current = false;
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
    if (message) void speakAgentReply(message).catch(() => undefined);
  }, [runTurn]);

  const cancel = useCallback(async () => {
    const message = await runTurn("no");
    if (message) void speakAgentReply(message).catch(() => undefined);
  }, [runTurn]);

  /** Tap-to-edit a field on the confirmation card — routes through the exact same server-validated update_field path a spoken correction would use. */
  const editField = useCallback(
    async (spokenFieldLabel: string, spokenValue: string) => {
      const message = await runTurn(`change ${spokenFieldLabel} to ${spokenValue}`);
      if (message) void speakAgentReply(message).catch(() => undefined);
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
