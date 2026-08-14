import { athleteNavigationReply, parseAthleteNavigationCommand } from "../athleteAskNavigation";

describe("athlete Ask Agent navigation parsing", () => {
  test.each([
    ["open water", { kind: "dashboard", section: "water" }],
    ["navigate to water", { kind: "dashboard", section: "water" }],
    ["move to chat", { kind: "dashboard", section: "messages" }],
    ["switch to achievements", { kind: "dashboard", section: "achievements" }],
    ["show me trends", { kind: "dashboard", section: "trends" }],
    ["can you open water", { kind: "dashboard", section: "water" }],
    ["please could you switch to messages", { kind: "dashboard", section: "messages" }],
    ["go progress", { kind: "dashboard", section: "progress" }],
    ["take me to coach feedback", { kind: "dashboard", section: "coach" }],
    ["open notifications", { kind: "notifications" }],
    ["open calender", { kind: "calendar" }],
  ])("%s redirects to the expected destination", (command, expected) => {
    expect(parseAthleteNavigationCommand(command)).toMatchObject(expected);
  });

  test.each([
    ["PM session", "PM"],
    ["open pm", "PM"],
    ["navigate to afternoon training", "AFT"],
    ["show morning kisan", "AM"],
  ])("%s opens a focused session log", (command, slot) => {
    expect(parseAthleteNavigationCommand(command)).toMatchObject({ kind: "dashboard", section: "log", slot });
  });

  test("does not steal water write commands", () => {
    expect(parseAthleteNavigationCommand("add 250 ml water")).toBeNull();
  });

  test.each([
    "show me every session I did this month",
    "show training history",
    "show last week training report",
  ])("does not steal training history/report queries: %s", (command) => {
    expect(parseAthleteNavigationCommand(command)).toBeNull();
  });

  test("still opens the current training log directly", () => {
    expect(parseAthleteNavigationCommand("show training log")).toMatchObject({ kind: "dashboard", section: "log" });
  });

  test("produces a clear spoken reply for focused session navigation", () => {
    const command = parseAthleteNavigationCommand("open afternoon session");
    expect(command && athleteNavigationReply(command)).toBe("Opening Afternoon log.");
  });
});
