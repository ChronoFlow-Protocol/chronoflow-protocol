import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatDateTime,
  formatDuration,
  formatRelativeTime,
  formatUnits,
  formatUnitsFixed,
  parseUnits,
  percent,
  shortenAddress,
} from "@/lib/format";

describe("formatUnits", () => {
  it("renders stroops as a decimal amount", () => {
    expect(formatUnits(100_000_000n, 7)).toBe("10");
    expect(formatUnits(150_000_000n, 7)).toBe("15");
    expect(formatUnits(1n, 7)).toBe("0.0000001");
    expect(formatUnits(0n, 7)).toBe("0");
  });

  it("groups thousands and keeps precision that exceeds Number", () => {
    const huge = 12_345_678_900_000_000n; // 1.23… billion XLM in stroops
    expect(formatUnits(huge, 7)).toBe("1,234,567,890");
    expect(formatUnits(huge + 1n, 7)).toBe("1,234,567,890.0000001");
  });

  it("handles negatives and zero decimals", () => {
    expect(formatUnits(-25_000_000n, 7)).toBe("-2.5");
    expect(formatUnits(42n, 0)).toBe("42");
  });
});

describe("formatUnitsFixed", () => {
  it("pads and truncates to the requested precision", () => {
    expect(formatUnitsFixed(100_000_000n, 7, 2)).toBe("10.00");
    expect(formatUnitsFixed(123_456_789n, 7, 4)).toBe("12.3456");
    expect(formatUnitsFixed(100_000_000n, 7, 0)).toBe("10");
  });
});

describe("parseUnits", () => {
  it("parses decimals into base units", () => {
    expect(parseUnits("10", 7)).toBe(100_000_000n);
    expect(parseUnits("0.5", 7)).toBe(5_000_000n);
    expect(parseUnits("1,000.25", 7)).toBe(10_002_500_000n);
    expect(parseUnits(".5", 7)).toBe(5_000_000n);
  });

  it("rejects invalid or out-of-precision input instead of rounding", () => {
    expect(parseUnits("", 7)).toBeNull();
    expect(parseUnits("0", 7)).toBeNull();
    expect(parseUnits("-5", 7)).toBeNull();
    expect(parseUnits("abc", 7)).toBeNull();
    expect(parseUnits("1.23456789", 7)).toBeNull();
    expect(parseUnits("1.2.3", 7)).toBeNull();
  });

  it("round-trips through formatUnits", () => {
    const value = parseUnits("12.3456789", 7);
    expect(value).not.toBeNull();
    expect(formatUnits(value as bigint, 7)).toBe("12.3456789");
  });
});

describe("formatDuration", () => {
  it("uses the two largest units", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3_600)).toBe("1h");
    expect(formatDuration(200_000)).toBe("2d 7h");
  });
});

describe("formatRelativeTime", () => {
  it("describes past and future offsets", () => {
    expect(formatRelativeTime(1_000, 1_000)).toBe("now");
    expect(formatRelativeTime(1_120, 1_000)).toBe("in 2m");
    expect(formatRelativeTime(1_000, 1_300)).toBe("5m ago");
  });
});

describe("misc helpers", () => {
  it("shortens addresses", () => {
    expect(shortenAddress("GDXL6H4YEZCPGRDNNDSRLYAQXK73RSPSWFGUWF5OJ4COR6PYQCEHO4EK")).toBe(
      "GDXL…O4EK",
    );
    expect(shortenAddress("GDXL6H4YEZCPGRDNNDSRLYAQXK73RSPSWFGUWF5OJ4COR6PYQCEHO4EK", 6, 6)).toBe(
      "GDXL6H…EHO4EK",
    );
    expect(shortenAddress("SHORT", 3, 3)).toBe("SHORT");
  });

  it("computes percentages safely", () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(5, 0)).toBe(0);
    expect(percent(-1, 4)).toBe(0);
    expect(percent(10, 4)).toBe(100);
  });

  it("formats counts and timestamps", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatDateTime(0)).toBe("—");
    expect(formatDateTime(1_700_000_000)).not.toBe("—");
  });
});
