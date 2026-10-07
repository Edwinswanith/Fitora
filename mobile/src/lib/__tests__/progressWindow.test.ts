import { eligibleDays, judgeRate, localDayOf, windowStart } from "../progressWindow";

describe("eligibleDays / windowStart", () => {
  it("uses the full window for a long-time user", () => {
    expect(eligibleDays("2026-10-07", "2026-01-01", 7)).toBe(7);
    expect(windowStart("2026-10-07", "2026-01-01", 7)).toBe("2026-10-01");
  });

  it("counts only days since joining for a new user", () => {
    expect(eligibleDays("2026-10-07", "2026-10-07", 7)).toBe(1);
    expect(eligibleDays("2026-10-07", "2026-10-05", 7)).toBe(3);
    expect(windowStart("2026-10-07", "2026-10-05", 7)).toBe("2026-10-05");
  });

  it("falls back to the full window when the join date is unknown", () => {
    expect(eligibleDays("2026-10-07", null, 7)).toBe(7);
  });

  it("handles month boundaries and clock skew", () => {
    expect(eligibleDays("2026-11-02", "2026-10-31", 7)).toBe(3);
    expect(eligibleDays("2026-10-07", "2026-10-09", 7)).toBe(1);
  });
});

describe("judgeRate", () => {
  it("never shows red or amber on a small sample", () => {
    expect(judgeRate(0, 1)).toBe("neutral");
    expect(judgeRate(0, 2)).toBe("neutral");
    expect(judgeRate(0.5, 2)).toBe("success");
    expect(judgeRate(1, 1)).toBe("success");
  });

  it("judges normally once there is enough history", () => {
    expect(judgeRate(0, 7)).toBe("danger");
    expect(judgeRate(0.29, 7)).toBe("danger");
    expect(judgeRate(0.5, 7)).toBe("warning");
    expect(judgeRate(0.6, 7)).toBe("neutral");
    expect(judgeRate(0.79, 7)).toBe("neutral");
    expect(judgeRate(0.8, 7)).toBe("success");
  });

  it("is neutral with no data", () => {
    expect(judgeRate(null, 7)).toBe("neutral");
  });
});

describe("localDayOf", () => {
  it("returns a YYYY-MM-DD day or null", () => {
    expect(localDayOf(null)).toBeNull();
    expect(localDayOf("not a date")).toBeNull();
    expect(localDayOf(new Date(2026, 9, 7, 23, 30).toISOString())).toBe("2026-10-07");
  });
});
