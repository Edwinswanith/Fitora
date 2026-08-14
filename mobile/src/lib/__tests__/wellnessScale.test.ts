import { spokenTenToFive } from "../wellnessScale";

describe("spokenTenToFive", () => {
  test("maps the endpoints of the spoken scale to the endpoints of the stored scale", () => {
    expect(spokenTenToFive(1)).toBe(1);
    expect(spokenTenToFive(10)).toBe(5);
  });

  test("maps the midpoint proportionally", () => {
    expect(spokenTenToFive(5.5)).toBeCloseTo(3, 5);
  });

  test("clamps out-of-range spoken values instead of extrapolating", () => {
    expect(spokenTenToFive(15)).toBe(5);
    expect(spokenTenToFive(0)).toBe(1);
    expect(spokenTenToFive(-5)).toBe(1);
  });
});
