import { average, finiteValues, halvesDelta, halvesPercentDelta, latestValue } from "../progressStats";

describe("finiteValues", () => {
  it("drops missing days instead of treating them as zero", () => {
    expect(finiteValues([null, 71, undefined, 74, Number.NaN, 0])).toEqual([71, 74, 0]);
  });
});

describe("average / latestValue", () => {
  it("averages only real entries", () => {
    expect(average(finiteValues([null, 60, 80, null]))).toBe(70);
    expect(average([])).toBeNull();
    expect(latestValue([60, 80])).toBe(80);
    expect(latestValue([])).toBeNull();
  });
});

describe("halvesDelta", () => {
  it("compares the recent half's average with the earlier half's", () => {
    expect(halvesDelta([60, 62, 70, 72])).toBe(10);
    expect(halvesDelta([80, 78, 70, 68])).toBe(-10);
  });

  it("damps a single bad day instead of reporting it as the whole trend", () => {
    // last-minus-first would say -30 from one bad morning; the halves say -10
    expect(halvesDelta([70, 70, 70, 70, 70, 40])).toBe(-10);
  });

  it("needs enough entries in each half", () => {
    expect(halvesDelta([70, 76])).toBeNull();
    expect(halvesDelta([70, 72, 76])).toBeNull();
  });

  it("regression: a missed first day no longer produces a +76 jump", () => {
    const series = [null, 71, 74, 75, 76];
    expect(halvesDelta(finiteValues(series))).toBe(3);
  });
});

describe("halvesPercentDelta", () => {
  it("reports the change as a percentage of the earlier half", () => {
    expect(halvesPercentDelta([100, 100, 110, 110])).toBe(10);
    expect(halvesPercentDelta([0, 0, 10, 10])).toBeNull();
  });
});
