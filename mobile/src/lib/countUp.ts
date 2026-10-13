// Formatting for numbers that count up on screen ("1.5 L", "1,240", "72").
// The display string stays the source of truth: we find its number, tween
// that, and print each frame in the same shape (decimals, thousands commas,
// prefix and suffix), so a counting value never jitters between formats.

export type NumberTemplate = {
  value: number;
  prefix: string;
  suffix: string;
  decimals: number;
  grouped: boolean;
};

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;

/** The first number in a display string, or null when it has none ("--"). */
export function parseNumberTemplate(text: string): NumberTemplate | null {
  const match = NUMBER.exec(text);
  if (!match) return null;
  const raw = match[0];
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const dot = raw.indexOf(".");
  return {
    value,
    prefix: text.slice(0, match.index),
    suffix: text.slice(match.index + raw.length),
    decimals: dot === -1 ? 0 : raw.length - dot - 1,
    grouped: raw.includes(","),
  };
}

/** Print `value` in the template's shape. */
export function formatLikeTemplate(template: NumberTemplate, value: number): string {
  const fixed = value.toFixed(template.decimals);
  let body = fixed;
  if (template.grouped) {
    const [whole, fraction] = fixed.split(".");
    const sign = whole.startsWith("-") ? "-" : "";
    const digits = sign ? whole.slice(1) : whole;
    body = sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction != null ? `.${fraction}` : "");
  }
  return template.prefix + body + template.suffix;
}
