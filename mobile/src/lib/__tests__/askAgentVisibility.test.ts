import { isAskAgentHiddenOn } from "../askAgentVisibility";

describe("isAskAgentHiddenOn", () => {
  it("hides on form, editor and chat screens", () => {
    for (const path of ["/athlete/check-in", "/athlete/log-meal", "/athlete/active-workout", "/athlete/water", "/coach/plan/workout-template", "/coach/messages", "/account"]) {
      expect(isAskAgentHiddenOn(path)).toBe(true);
    }
  });

  it("stays on the main tabs and overview screens", () => {
    for (const path of ["/athlete/dashboard", "/coach/dashboard", "/coach/plan", "/coach/athletes", "/athlete/trends"]) {
      expect(isAskAgentHiddenOn(path)).toBe(false);
    }
  });

  it("handles trailing slashes, query strings and nested routes", () => {
    expect(isAskAgentHiddenOn("/athlete/check-in/")).toBe(true);
    expect(isAskAgentHiddenOn("/coach/plan/meal-plan?mealPlanId=1")).toBe(true);
    expect(isAskAgentHiddenOn("/coach/athletes/new")).toBe(true);
    expect(isAskAgentHiddenOn("/coach/athletes/abc123")).toBe(false);
    expect(isAskAgentHiddenOn("/athlete/check-in-history")).toBe(false);
  });

  it("is visible when the route is unknown", () => {
    expect(isAskAgentHiddenOn(null)).toBe(false);
    expect(isAskAgentHiddenOn("")).toBe(false);
  });
});
