import { centeredStart, dayOfMonth, monthKey, monthLabel, monthRange, monthsAround, stripDates, weekdayShort } from "../dateStrip";

describe("dateStrip", () => {
  test("covers the chosen days either side of today, in order", () => {
    const days = stripDates("2026-10-14", 3, 2);
    expect(days).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  });

  test("crosses month and year ends", () => {
    expect(stripDates("2026-12-31", 0, 2)).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  test("weekday and day labels come from the date itself", () => {
    expect(weekdayShort("2026-10-14")).toBe("WED");
    expect(weekdayShort("2026-10-18")).toBe("SUN");
    expect(dayOfMonth("2026-10-09")).toBe(9);
  });

  test("month helpers", () => {
    expect(monthLabel("2026-10-14")).toBe("October 2026");
    expect(monthKey("2026-10-14")).toBe("2026-10");
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthsAround("2026-01-15")).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  test("centers the selected day and stops at the ends", () => {
    expect(centeredStart(180, 7, 361)).toBe(177);
    expect(centeredStart(1, 7, 361)).toBe(0);
    expect(centeredStart(359, 7, 361)).toBe(354);
  });
});
