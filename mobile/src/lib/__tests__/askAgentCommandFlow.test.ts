import { classifyReportQuery } from "../askAgentReportIntents";

function askAgentCommandReply(command: string): string {
  const intent = classifyReportQuery(command);

  switch (intent.kind) {
    case "metric_report":
      return `Opening ${intent.subject} report for ${intent.days} days.`;
    case "day_extremum":
      return `Finding ${intent.direction} ${intent.metric} day for ${intent.days} days.`;
    case "progress_advice":
      return `Building progress advice for ${intent.days} days.`;
    case "list_training_history":
      return `Listing training history for ${intent.days} days.`;
    case "report":
      return `Opening ${intent.mode} report for ${intent.days} days.`;
    case "none":
      return "I can help with reports, training history, and progress advice.";
  }
}

describe("Ask Agent command flow", () => {
  test("voice-like heart rate report opens a metric-specific report", () => {
    expect(askAgentCommandReply("give me a report of my last heart rate")).toBe("Opening heartRate report for 7 days.");
  });

  test("misheard average-day query opens the day ranking command", () => {
    expect(askAgentCommandReply("give em a report of which day i preform avarage in last weak.")).toBe(
      "Finding average readiness day for 7 days."
    );
  });

  test("training history command opens the history flow", () => {
    expect(askAgentCommandReply("show me every session I did this month")).toBe("Listing training history for 30 days.");
  });

  test("non-report command falls back without claiming a report ran", () => {
    expect(askAgentCommandReply("log my sleep as 8 hours")).toBe(
      "I can help with reports, training history, and progress advice."
    );
  });
});
