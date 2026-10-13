import { formatLikeTemplate, parseNumberTemplate } from "../countUp";

describe("count-up formatting", () => {
  it("keeps decimals, commas, prefix and suffix while counting", () => {
    const litres = parseNumberTemplate("1.5 L")!;
    expect(litres).toMatchObject({ value: 1.5, decimals: 1, suffix: " L" });
    expect(formatLikeTemplate(litres, 0.73)).toBe("0.7 L");
    const kcal = parseNumberTemplate("1,240")!;
    expect(formatLikeTemplate(kcal, 987.4)).toBe("987");
    expect(formatLikeTemplate(kcal, 1239.6)).toBe("1,240");
    expect(formatLikeTemplate(parseNumberTemplate("of 2,000 kcal")!, 12345)).toBe("of 12,345 kcal");
  });

  it("leaves text without a number alone", () => {
    expect(parseNumberTemplate("--")).toBeNull();
  });
});
