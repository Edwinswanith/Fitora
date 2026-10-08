// Per-turn voice timings, so latency work can be measured instead of guessed.
// One line per turn: "[voice:turn] {...}" with milliseconds since the turn
// started listening. Never includes transcript text (privacy, see the server's
// lib/voiceObservability.ts for the same rule).

export type VoiceStage = "listening" | "speech" | "final" | "reply" | "speechStart" | "speechEnd";

export type VoiceTurnReport = {
  path: string;
  outcome: string;
  stages: Partial<Record<VoiceStage, number>>;
  at: string;
};

const MAX_REPORTS = 20;
const reports: VoiceTurnReport[] = [];

export type VoiceTurnTimer = {
  mark: (stage: VoiceStage) => void;
  finish: (outcome: string) => void;
};

export function startVoiceTurnTimer(path: string, now: () => number = Date.now): VoiceTurnTimer {
  const startedAt = now();
  const stages: Partial<Record<VoiceStage, number>> = {};
  let done = false;
  return {
    mark(stage) {
      if (done || stages[stage] !== undefined) return;
      stages[stage] = now() - startedAt;
    },
    finish(outcome) {
      if (done) return;
      done = true;
      const report: VoiceTurnReport = { path, outcome, stages, at: new Date(startedAt).toISOString() };
      reports.push(report);
      if (reports.length > MAX_REPORTS) reports.shift();
      console.info("[voice:turn]", JSON.stringify(report));
    },
  };
}

/** The last few turns, newest last (for a debug view or bug reports). */
export function recentVoiceTurns(): readonly VoiceTurnReport[] {
  return reports;
}
