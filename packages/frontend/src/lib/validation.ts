/**
 * Client-side validation for the vault creation form.
 *
 * Mirrors the checks the contract performs in `create_vault`, so an obviously
 * invalid vault is rejected before the wallet is asked to sign anything.
 */

import { Address } from "@stellar/stellar-sdk";

import { parseUnits } from "./format";

/** Mirrors `MAX_MILESTONES` in `chronoflow_escrow::lib`. */
export const MAX_MILESTONES = 100;

export type DurationUnit = "minutes" | "hours" | "days";

export const DURATION_UNIT_SECONDS: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3_600,
  days: 86_400,
};

export function isValidAccountAddress(value: string): boolean {
  if (!value.startsWith("G")) return false;
  try {
    Address.fromString(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidContractAddress(value: string): boolean {
  if (!value.startsWith("C")) return false;
  try {
    Address.fromString(value);
    return true;
  } catch {
    return false;
  }
}

export interface VaultFormValues {
  recipient: string;
  token: string;
  amount: string;
  duration: string;
  durationUnit: DurationUnit;
  milestones: string;
}

export interface VaultFormErrors {
  recipient?: string;
  token?: string;
  amount?: string;
  duration?: string;
  milestones?: string;
}

export interface ParsedVaultForm {
  recipient: string;
  token: string;
  /** Deposit in base units. */
  amount: bigint;
  /** Seconds from creation to the last unlock. */
  duration: number;
  milestones: number;
}

export interface ValidationResult {
  errors: VaultFormErrors;
  values: ParsedVaultForm | null;
}

/**
 * Validates the form and returns the values ready for `create_vault`.
 *
 * @param decimals base-unit decimals of the selected token (7 for XLM).
 */
export function validateVaultForm(values: VaultFormValues, decimals: number): ValidationResult {
  const errors: VaultFormErrors = {};

  const recipient = values.recipient.trim();
  if (!recipient) errors.recipient = "Enter the address that receives the payouts.";
  else if (!isValidAccountAddress(recipient))
    errors.recipient = "That is not a valid Stellar account address (it should start with G).";

  const token = values.token.trim();
  if (!token) errors.token = "Enter the token contract address.";
  else if (!isValidContractAddress(token))
    errors.token = "That is not a valid Stellar Asset Contract address (it should start with C).";

  const amount = parseUnits(values.amount, decimals);
  if (amount === null) {
    errors.amount = `Enter a positive amount with at most ${decimals} decimals.`;
  }

  // `Number` rather than `parseInt`: "2.5" must be rejected, not truncated to 2.
  const milestonesValue = Number(values.milestones.trim());
  const milestonesValid =
    values.milestones.trim().length > 0 &&
    Number.isInteger(milestonesValue) &&
    milestonesValue >= 1 &&
    milestonesValue <= MAX_MILESTONES;

  if (!milestonesValid) {
    errors.milestones = `Milestones must be a whole number between 1 and ${MAX_MILESTONES}.`;
  }

  const durationValue = Number(values.duration);
  const durationSeconds = Math.floor(durationValue * DURATION_UNIT_SECONDS[values.durationUnit]);
  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    errors.duration = "Enter a duration greater than zero.";
  } else if (!Number.isFinite(durationSeconds) || durationSeconds < 1) {
    errors.duration = "That duration is too small — use at least one second.";
  }

  // The contract splits the deposit into equal slices, so the amount has to
  // divide evenly; catching it here beats a failed simulation.
  if (amount !== null && milestonesValid && amount % BigInt(milestonesValue) !== 0n) {
    errors.amount = `The amount must split evenly across ${milestonesValue} milestones (currently ${(
      amount % BigInt(milestonesValue)
    ).toString()} left over).`;
  }

  if (Object.keys(errors).length > 0) return { errors, values: null };

  return {
    errors,
    values: {
      recipient,
      token,
      amount: amount as bigint,
      duration: durationSeconds,
      milestones: milestonesValue,
    },
  };
}
