/**
 * Milestone scheduling maths.
 *
 * These mirror `milestone_unlock_time` in the Soroban contract exactly:
 *
 *   unlock(i) = start_time + duration * (i + 1) / milestones   (integer division)
 *
 * Keeping the client-side copy means the timeline can count down between
 * indexer polls, and `schedule.test.ts` pins it against the contract's rules.
 */

import type { MilestoneState } from "./types";

/** Unlock timestamp of milestone `index`, matching the contract's schedule. */
export function milestoneUnlockTime(
  startTime: number,
  duration: number,
  milestones: number,
  index: number,
): number {
  if (milestones <= 0) return startTime;
  return startTime + Math.floor((duration * (index + 1)) / milestones);
}

/** Every unlock timestamp in a vault's schedule, oldest first. */
export function vaultSchedule(startTime: number, duration: number, milestones: number): number[] {
  return Array.from({ length: Math.max(0, milestones) }, (_value, index) =>
    milestoneUnlockTime(startTime, duration, milestones, index),
  );
}

/** Index of the next milestone the contract would release, or `null` when done. */
export function nextMilestoneIndex(milestonesReleased: number, milestones: number): number | null {
  return milestonesReleased >= milestones ? null : milestonesReleased;
}

/** Completion percentage of a vault's schedule. */
export function vaultProgress(milestonesReleased: number, milestones: number): number {
  if (milestones <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((milestonesReleased / milestones) * 100)));
}

/**
 * State of a single milestone at time `now`.
 *
 * `cancelled` covers clawed-back and completed vaults, where the remaining
 * allocations will never be released.
 */
export function milestoneState(options: {
  released: boolean;
  status: string;
  unlockTime: number;
  now: number;
}): MilestoneState {
  const { released, status, unlockTime, now } = options;
  if (released) return "released";
  if (status !== "Active") return "cancelled";
  return now >= unlockTime ? "releasable" : "locked";
}

export interface TimelineBucket {
  /** Milestones whose funds are still timelocked. */
  locked: number;
  /** Unlocked but not yet released — anyone may release these. */
  releasable: number;
  released: number;
  cancelled: number;
}

/** Counts milestones per state at time `now`. */
export function bucketTimeline(
  milestones: { released: boolean; unlockTime: number }[],
  status: string,
  now: number,
): TimelineBucket {
  const bucket: TimelineBucket = { locked: 0, releasable: 0, released: 0, cancelled: 0 };

  for (const milestone of milestones) {
    const state = milestoneState({
      released: milestone.released,
      status,
      unlockTime: milestone.unlockTime,
      now,
    });
    bucket[state] += 1;
  }

  return bucket;
}

/** Sums milestone amounts per state at time `now`. */
export function bucketAmounts(
  milestones: { released: boolean; unlockTime: number; amount: string }[],
  status: string,
  now: number,
): Record<MilestoneState, bigint> {
  const totals: Record<MilestoneState, bigint> = {
    locked: 0n,
    releasable: 0n,
    released: 0n,
    cancelled: 0n,
  };

  for (const milestone of milestones) {
    const state = milestoneState({
      released: milestone.released,
      status,
      unlockTime: milestone.unlockTime,
      now,
    });
    let amount: bigint;
    try {
      amount = BigInt(milestone.amount);
    } catch {
      continue;
    }
    totals[state] += amount;
  }

  return totals;
}

/** Whether a vault's escrow can still be clawed back by its funder. */
export function canClawback(status: string, clawbackTime: number, now: number): boolean {
  return status === "Active" && now >= clawbackTime;
}

/** Seconds until a vault's clawback deadline; negative once it has passed. */
export function clawbackCountdown(clawbackTime: number, now: number): number {
  return clawbackTime - now;
}

export const MILESTONE_STATE_LABEL: Record<MilestoneState, string> = {
  locked: "Locked",
  releasable: "Unlocked",
  released: "Released",
  cancelled: "Cancelled",
};

export const VAULT_STATUS_LABEL: Record<string, string> = {
  Active: "Streaming",
  Completed: "Completed",
  ClawedBack: "Clawed back",
};
