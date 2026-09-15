/**
 * Formatting helpers.
 *
 * Amounts move through the app as decimal strings in base units (stroops), so
 * every conversion happens on `bigint` and never through `Number`, which would
 * silently lose precision on i128 values.
 */

/** Renders base units as a human decimal string, trimming trailing zeros. */
export function formatUnits(value: bigint | string, decimals: number): string {
  const raw = typeof value === "string" ? value : value.toString();
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : digits.slice(digits.length - decimals);
  const trimmed = fraction.replace(/0+$/, "");
  // Group thousands on the integer part only — never inside the fraction.
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = trimmed.length > 0 ? `${groupedWhole}.${trimmed}` : groupedWhole;
  return negative ? `-${body}` : body;
}

/** Renders base units with a fixed number of decimals (no trimming). */
export function formatUnitsFixed(value: bigint | string, decimals: number, places: number): string {
  const rendered = formatUnits(value, decimals).replace(/,/g, "");
  const [whole = "0", fraction = ""] = rendered.split(".");
  if (places === 0) return whole;
  return `${whole}.${fraction.padEnd(places, "0").slice(0, places)}`;
}

/**
 * Parses a human decimal amount into base units.
 *
 * Returns `null` for anything that is not a positive, well-formed decimal with
 * at most `decimals` fractional digits, so callers can show a validation error
 * instead of sending a wrong amount on-chain.
 */
export function parseUnits(input: string, decimals: number): bigint | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed.length === 0) return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;

  const [wholePart = "", fractionPart = ""] = trimmed.split(".");
  if (wholePart.length === 0 && fractionPart.length === 0) return null;
  if (fractionPart.length > decimals) return null;

  const scaled = `${wholePart || "0"}${fractionPart.padEnd(decimals, "0")}`;
  try {
    const value = BigInt(scaled);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

/** `GABCD…WXYZ` for display in tight spaces. */
export function shortenAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** "3d 4h", "12m", "45s" — coarse, largest-two-units form. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const abs = Math.max(Math.floor(Math.abs(seconds)), 0);
  if (abs === 0) return "0s";

  const units: [number, string][] = [
    [86_400, "d"],
    [3_600, "h"],
    [60, "m"],
    [1, "s"],
  ];

  const parts: string[] = [];
  let remaining = abs;
  for (const [size, label] of units) {
    const count = Math.floor(remaining / size);
    if (count > 0) {
      parts.push(`${count}${label}`);
      remaining -= count * size;
    }
    if (parts.length === 2) break;
  }

  return parts.join(" ");
}

/** "in 2h 5m" / "3d ago" / "now". */
export function formatRelativeTime(targetSeconds: number, nowSeconds: number): string {
  const delta = targetSeconds - nowSeconds;
  if (Math.abs(delta) < 5) return "now";
  return delta > 0 ? `in ${formatDuration(delta)}` : `${formatDuration(delta)} ago`;
}

/** Local timestamp for `title` attributes and detail rows. */
export function formatDateTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Percentage (0-100) of a part over a total, safe for zero totals. */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

/** Groups an integer for display: 12_345 -> "12,345". */
export function formatCount(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString();
}
