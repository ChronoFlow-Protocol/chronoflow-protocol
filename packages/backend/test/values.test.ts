import { describe, expect, it } from "vitest";

import {
  DecodeError,
  asBigInt,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  formatUnits,
  parseUnits,
} from "../src/lib/values.js";

describe("formatUnits", () => {
  it("renders stroop amounts as XLM", () => {
    expect(formatUnits(400_000_000n, 7)).toBe("40");
    expect(formatUnits(1n, 7)).toBe("0.0000001");
    expect(formatUnits(12_345_678n, 7)).toBe("1.2345678");
    expect(formatUnits(0n, 7)).toBe("0");
  });

  it("keeps the sign and supports other decimal counts", () => {
    expect(formatUnits(-15_000_000n, 7)).toBe("-1.5");
    expect(formatUnits(42n, 0)).toBe("42");
    expect(formatUnits(1234n, 2)).toBe("12.34");
  });

  it("rejects negative decimal counts", () => {
    expect(() => formatUnits(1n, -1)).toThrow(RangeError);
  });
});

describe("parseUnits", () => {
  it("parses decimal strings into base units", () => {
    expect(parseUnits("40", 7)).toBe(400_000_000n);
    expect(parseUnits("1.5", 7)).toBe(15_000_000n);
    expect(parseUnits("0.0000001", 7)).toBe(1n);
    expect(parseUnits("-2", 7)).toBe(-20_000_000n);
    expect(parseUnits(".5", 2)).toBe(50n);
  });

  it("truncates extra precision instead of rounding silently up", () => {
    expect(parseUnits("1.00000009", 7)).toBe(10_000_000n);
  });

  it("rejects malformed input", () => {
    for (const value of ["", ".", "-", "abc", "1.2.3"]) {
      expect(() => parseUnits(value, 7)).toThrow(DecodeError);
    }
  });

  it("round-trips with formatUnits", () => {
    const amount = 987_654_321n;
    expect(parseUnits(formatUnits(amount, 7), 7)).toBe(amount);
  });
});

describe("value coercions", () => {
  it("accepts bigints, integers and integer strings", () => {
    expect(asBigInt(4n, "x")).toBe(4n);
    expect(asBigInt(4, "x")).toBe(4n);
    expect(asBigInt("4", "x")).toBe(4n);
    expect(asBigInt("-9", "x")).toBe(-9n);
  });

  it("rejects non-integers with a field-annotated error", () => {
    expect(() => asBigInt(1.5, "amount")).toThrow(DecodeError);
    expect(() => asBigInt("not a number", "amount")).toThrow(/cannot decode 'amount'/);
    expect(() => asBigInt(null, "amount")).toThrow(DecodeError);
  });

  it("converts to safe numbers only", () => {
    expect(asNumber(4n, "index")).toBe(4);
    expect(asNumber("12", "index")).toBe(12);
    expect(() => asNumber("9007199254740993", "index")).toThrow(/MAX_SAFE_INTEGER/);
  });

  it("narrows strings, booleans and records", () => {
    expect(asString("GABCD", "address")).toBe("GABCD");
    expect(asBoolean(false, "paused")).toBe(false);
    expect(asRecord({ vault_id: 1n }, "payload")).toEqual({ vault_id: 1n });

    expect(() => asString(1, "address")).toThrow(DecodeError);
    expect(() => asBoolean("true", "paused")).toThrow(DecodeError);
    expect(() => asRecord([1, 2], "payload")).toThrow(DecodeError);
  });
});
