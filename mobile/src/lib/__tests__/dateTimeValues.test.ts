/**
 * @jest-environment ./src/lib/__tests__/timezoneEnvironment.js
 */
import {
  clampDateString,
  combineLocalDateTime,
  deviceTimeZone,
  formatLocalDate,
  formatLocalTime,
  isInFuture,
  isoToLocalParts,
  isValidDateString,
  isValidTimeString,
  minutesToTime,
  parseLocalDate,
  timeToMinutes,
  timeToPickerDate,
  todayLocalDate,
  yearsAgoLocalDate,
} from "../dateTimeValues";

// timezoneEnvironment.js lets each block pin the process's zone, to prove the
// helpers use LOCAL calendar fields (not UTC) on both sides of UTC.
declare const __setTimeZone: (zone: string) => void;

function withTimeZone(zone: string, fn: () => void) {
  describe(`in ${zone}`, () => {
    beforeAll(() => {
      __setTimeZone(zone);
    });
    afterAll(() => {
      __setTimeZone("UTC");
    });
    fn();
  });
}

describe("test harness", () => {
  it("really switches the process timezone", () => {
    __setTimeZone("Asia/Kolkata");
    expect(new Date("2026-01-01T00:00:00.000Z").getTimezoneOffset()).toBe(-330);
    __setTimeZone("UTC");
    expect(new Date("2026-01-01T00:00:00.000Z").getTimezoneOffset()).toBe(0);
  });
});

describe("validation", () => {
  it("accepts only real calendar dates", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true);
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-04-31")).toBe(false);
    expect(isValidDateString("2026-4-1")).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });

  it("accepts only 24h HH:MM times", () => {
    expect(isValidTimeString("00:00")).toBe(true);
    expect(isValidTimeString("23:59")).toBe(true);
    expect(isValidTimeString("24:00")).toBe(false);
    expect(isValidTimeString("9:00")).toBe(false);
    expect(isValidTimeString("09:60")).toBe(false);
  });
});

describe("minute conversions", () => {
  it("round-trips HH:MM and minutes", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("nope")).toBeNull();
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(1440)).toBe("24:00");
    expect(minutesToTime(-5)).toBe("00:00");
  });

  it("clamps dates with plain string comparison", () => {
    expect(clampDateString("2026-01-01", "2026-03-01")).toBe("2026-03-01");
    expect(clampDateString("2030-01-01", undefined, "2026-10-07")).toBe("2026-10-07");
    expect(clampDateString("2026-05-05", "2026-01-01", "2026-12-31")).toBe("2026-05-05");
  });

  it("checks future instants against a given clock", () => {
    expect(isInFuture(new Date(2000), 1000)).toBe(true);
    expect(isInFuture(new Date(1000), 1000)).toBe(false);
  });
});

withTimeZone("Asia/Kolkata", () => {
  it("pre-fills a session's LOCAL date/time, not the UTC slice", () => {
    // 20:00 UTC on 7 Oct is 01:30 IST on 8 Oct; toISOString().slice would say 2026-10-07 / 20:00.
    expect(isoToLocalParts("2026-10-07T20:00:00.000Z")).toEqual({ date: "2026-10-08", time: "01:30" });
    expect(isoToLocalParts("2026-10-07T04:30:00.000Z")).toEqual({ date: "2026-10-07", time: "10:00" });
  });

  it("builds the UTC instant from local date + time", () => {
    expect(combineLocalDateTime("2026-10-08", "01:30")?.toISOString()).toBe("2026-10-07T20:00:00.000Z");
    expect(combineLocalDateTime("2026-10-07", "10:00")?.toISOString()).toBe("2026-10-07T04:30:00.000Z");
    expect(combineLocalDateTime("2026-02-30", "10:00")).toBeNull();
    expect(combineLocalDateTime("2026-10-07", "")).toBeNull();
  });

  it("round-trips ISO -> local parts -> ISO", () => {
    const iso = "2026-12-31T19:15:00.000Z";
    const parts = isoToLocalParts(iso);
    expect(parts).toEqual({ date: "2027-01-01", time: "00:45" });
    expect(combineLocalDateTime(parts.date, parts.time)?.toISOString()).toBe(iso);
  });

  it("formats 'today' from local fields, even when UTC is still yesterday", () => {
    // 2026-10-07 23:00 UTC is 2026-10-08 04:30 IST.
    expect(todayLocalDate(new Date("2026-10-07T23:00:00.000Z"))).toBe("2026-10-08");
  });

  it("parses YYYY-MM-DD to the same local calendar day", () => {
    const date = parseLocalDate("2026-03-14");
    expect(date).not.toBeNull();
    expect(formatLocalDate(date!)).toBe("2026-03-14");
    expect(parseLocalDate("2026-02-30")).toBeNull();
  });

  it("puts a picker time on the base day without shifting it", () => {
    const base = new Date("2026-10-07T06:00:00.000Z");
    const picked = timeToPickerDate("18:45", base)!;
    expect(formatLocalTime(picked)).toBe("18:45");
    expect(formatLocalDate(picked)).toBe("2026-10-07");
    expect(timeToPickerDate("25:00", base)).toBeNull();
  });
});

withTimeZone("America/Los_Angeles", () => {
  it("keeps the local day for evening times west of UTC", () => {
    // 18:00 PDT on 7 Oct is 01:00 UTC on 8 Oct.
    expect(isoToLocalParts("2026-10-08T01:00:00.000Z")).toEqual({ date: "2026-10-07", time: "18:00" });
    expect(combineLocalDateTime("2026-10-07", "18:00")?.toISOString()).toBe("2026-10-08T01:00:00.000Z");
  });

  it("uses the right offset on each side of a DST change", () => {
    // DST ends 1 Nov 2026: PDT (UTC-7) before, PST (UTC-8) after.
    expect(combineLocalDateTime("2026-10-31", "09:00")?.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(combineLocalDateTime("2026-11-02", "09:00")?.toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });

  it("parses dates on DST-change days to the right calendar day", () => {
    expect(formatLocalDate(parseLocalDate("2026-03-08")!)).toBe("2026-03-08");
    expect(formatLocalDate(parseLocalDate("2026-11-01")!)).toBe("2026-11-01");
  });
});

describe("yearsAgoLocalDate", () => {
  it("steps back whole years", () => {
    expect(yearsAgoLocalDate(25, new Date(2026, 9, 7, 12))).toBe("2001-10-07");
  });

  it("maps Feb 29 to Feb 28 in a non-leap year", () => {
    expect(yearsAgoLocalDate(1, new Date(2024, 1, 29, 12))).toBe("2023-02-28");
    expect(yearsAgoLocalDate(4, new Date(2024, 1, 29, 12))).toBe("2020-02-29");
  });
});

describe("deviceTimeZone", () => {
  it("returns an IANA zone string", () => {
    expect(typeof deviceTimeZone()).toBe("string");
    expect(deviceTimeZone().length).toBeGreaterThan(0);
  });

  it("falls back when Intl can't resolve a zone", () => {
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () => ({ resolvedOptions: () => ({ timeZone: "" }) }) as unknown as Intl.DateTimeFormat
    );
    try {
      expect(deviceTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
      expect(deviceTimeZone()).toBe("UTC");
      expect(deviceTimeZone(null)).toBe("UTC");
    } finally {
      spy.mockRestore();
    }
  });
});
