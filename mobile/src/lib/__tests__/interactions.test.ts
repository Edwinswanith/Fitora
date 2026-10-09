// Pure helpers behind the interaction polish: which water entry an Undo
// removes, and the easing every progress animation uses.

import { newestWaterEntryId } from "../fitoraData";
import { easeOutCubic } from "../motion";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("../api", () => ({ apiJson: jest.fn() }));
jest.mock("react-native", () => ({
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove: () => undefined }) },
  LayoutAnimation: {},
  Platform: { OS: "web" },
}));

describe("newestWaterEntryId", () => {
  it("picks the entry logged last, whatever the array order", () => {
    const day = {
      entries: [
        { id: "a", amountMl: 250, loggedAt: "2026-10-09T08:00:00.000Z" },
        { id: "c", amountMl: 500, loggedAt: "2026-10-09T12:30:00.000Z" },
        { id: "b", amountMl: 250, loggedAt: "2026-10-09T10:00:00.000Z" },
      ],
    };
    expect(newestWaterEntryId(day)).toBe("c");
  });

  it("returns null when there is nothing to undo", () => {
    expect(newestWaterEntryId({ entries: [] })).toBeNull();
    expect(newestWaterEntryId(null)).toBeNull();
  });
});

describe("easeOutCubic", () => {
  it("starts at 0, ends at 1 and moves fastest at the start", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("clamps out-of-range time", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});
