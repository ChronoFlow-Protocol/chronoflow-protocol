import { describe, expect, it } from "vitest";

import {
  bucketAmounts,
  bucketTimeline,
  canClawback,
  clawbackCountdown,
  milestoneState,
  milestoneUnlockTime,
  nextMilestoneIndex,
  vaultProgress,
  vaultSchedule,
} from "@/lib/schedule";

const START = 1_700_000_000;

describe("milestoneUnlockTime", () => {
  it("matches the contract schedule start + duration * (i + 1) / milestones", () => {
    expect(milestoneUnlockTime(START, 900, 4, 0)).toBe(START + 225);
    expect(milestoneUnlockTime(START, 900, 4, 3)).toBe(START + 900);
  });

  it("uses integer division like the on-chain u64 maths", () => {
    // 100 / 3 = 33 (not 33.33), so the last slice lands exactly on the duration.
    expect(milestoneUnlockTime(START, 100, 3, 0)).toBe(START + 33);
    expect(milestoneUnlockTime(START, 100, 3, 1)).toBe(START + 66);
    expect(milestoneUnlockTime(START, 100, 3, 2)).toBe(START + 100);
  });

  it("is defensive about a zero milestone count", () => {
    expect(milestoneUnlockTime(START, 100, 0, 0)).toBe(START);
  });
});

describe("vaultSchedule", () => {
  it("returns one timestamp per milestone, ending at start + duration", () => {
    const schedule = vaultSchedule(START, 600, 4);
    expect(schedule).toEqual([START + 150, START + 300, START + 450, START + 600]);
    expect(schedule).toHaveLength(4);
  });

  it("returns an empty schedule for a non-positive count", () => {
    expect(vaultSchedule(START, 600, 0)).toEqual([]);
  });
});

describe("nextMilestoneIndex / vaultProgress", () => {
  it("walks the schedule and stops once complete", () => {
    expect(nextMilestoneIndex(0, 3)).toBe(0);
    expect(nextMilestoneIndex(2, 3)).toBe(2);
    expect(nextMilestoneIndex(3, 3)).toBeNull();
  });

  it("reports completion percentage", () => {
    expect(vaultProgress(0, 4)).toBe(0);
    expect(vaultProgress(1, 4)).toBe(25);
    expect(vaultProgress(4, 4)).toBe(100);
    expect(vaultProgress(2, 0)).toBe(0);
  });
});

describe("milestoneState", () => {
  it("marks released milestones regardless of time", () => {
    expect(
      milestoneState({ released: true, status: "Active", unlockTime: START + 100, now: START }),
    ).toBe("released");
  });

  it("distinguishes locked from unlocked", () => {
    expect(
      milestoneState({ released: false, status: "Active", unlockTime: START + 100, now: START }),
    ).toBe("locked");
    expect(
      milestoneState({
        released: false,
        status: "Active",
        unlockTime: START + 100,
        now: START + 100,
      }),
    ).toBe("releasable");
  });

  it("cancels everything left in a finished vault", () => {
    expect(
      milestoneState({
        released: false,
        status: "Completed",
        unlockTime: START,
        now: START + 10_000,
      }),
    ).toBe("cancelled");
    expect(
      milestoneState({
        released: false,
        status: "ClawedBack",
        unlockTime: START,
        now: START + 10_000,
      }),
    ).toBe("cancelled");
  });
});

describe("bucketTimeline / bucketAmounts", () => {
  const milestones = [
    { released: true, unlockTime: START, amount: "100" },
    { released: false, unlockTime: START + 100, amount: "100" },
    { released: false, unlockTime: START + 300, amount: "100" },
  ];

  it("counts each state at a point in time", () => {
    expect(bucketTimeline(milestones, "Active", START + 150)).toEqual({
      locked: 1,
      releasable: 1,
      released: 1,
      cancelled: 0,
    });
  });

  it("sums amounts per state", () => {
    const totals = bucketAmounts(milestones, "Active", START + 150);
    expect(totals.released).toBe(100n);
    expect(totals.releasable).toBe(100n);
    expect(totals.locked).toBe(100n);
    expect(totals.released + totals.releasable + totals.locked).toBe(300n);
  });

  it("ignores unparsable amounts rather than throwing", () => {
    const totals = bucketAmounts(
      [{ released: false, unlockTime: START + 10, amount: "not-a-number" }],
      "Active",
      START,
    );
    expect(totals.locked).toBe(0n);
  });
});

describe("clawback helpers", () => {
  it("only allows clawback after the grace period on an active vault", () => {
    expect(canClawback("Active", START + 500, START + 499)).toBe(false);
    expect(canClawback("Active", START + 500, START + 500)).toBe(true);
    expect(canClawback("Completed", START + 500, START + 900)).toBe(false);
    expect(canClawback("ClawedBack", START + 500, START + 900)).toBe(false);
  });

  it("counts down to the deadline", () => {
    expect(clawbackCountdown(START + 500, START)).toBe(500);
    expect(clawbackCountdown(START + 500, START + 600)).toBe(-100);
  });
});
