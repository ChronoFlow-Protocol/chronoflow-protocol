/**
 * Helpers for working with the values `scValToNative` produces.
 *
 * The Soroban SDK maps contract types onto JavaScript like this:
 *   u32 / i32        → number
 *   u64 / i64 / i128 → bigint
 *   bool             → boolean
 *   address / symbol → string
 *   map              → plain object (snake_case keys)
 *
 * JSON fixtures and HTTP bodies lose the difference between `bigint` and
 * string, so every helper below accepts both.
 */

export class DecodeError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`cannot decode '${field}': ${message}`);
    this.name = "DecodeError";
    this.field = field;
  }
}

export function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new DecodeError(field, `expected an integer, got ${value}`);
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new DecodeError(field, `expected an integer, got ${typeof value}`);
}

export function asNumber(value: unknown, field: string): number {
  const asInteger = asBigInt(value, field);
  const result = Number(asInteger);
  if (!Number.isSafeInteger(result)) {
    throw new DecodeError(field, `value ${asInteger} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return result;
}

export function asString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  throw new DecodeError(field, `expected a string, got ${typeof value}`);
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new DecodeError(field, `expected a boolean, got ${typeof value}`);
}

export function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new DecodeError(
    field,
    `expected an object, got ${Array.isArray(value) ? "array" : typeof value}`,
  );
}

/**
 * Renders a base-unit amount as a decimal string.
 *
 * `formatUnits(400000000n, 7)` → `"40"`, `formatUnits(1n, 7)` → `"0.0000001"`.
 */
export function formatUnits(value: bigint, decimals: number): string {
  if (decimals < 0) throw new RangeError("decimals must be >= 0");

  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0").replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole.toString()}${fraction.length > 0 ? `.${fraction}` : ""}`;
}

/** Parses a decimal string into base units. */
export function parseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === "." || trimmed === "-") {
    throw new DecodeError("amount", `'${value}' is not a decimal number`);
  }

  const negative = trimmed.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? trimmed.slice(1) : trimmed).split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(`${whole || "0"}${paddedFraction}`);
  return negative ? -result : result;
}
