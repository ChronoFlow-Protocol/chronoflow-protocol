import { describe, expect, it } from "vitest";

import { MAX_MILESTONES, validateVaultForm, type VaultFormValues } from "@/lib/validation";

// Real testnet addresses, so the StrKey checks are exercised against the encoder
// rather than against a hand-made string.
const RECIPIENT = "GDV7QIR76MDAWEKBXSHCQF3OENPRIY2SSHCKGZOONFMBGGN3SM5KVS2A";
const NATIVE_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const base: VaultFormValues = {
  recipient: RECIPIENT,
  token: NATIVE_SAC,
  amount: "100",
  duration: "30",
  durationUnit: "days",
  milestones: "4",
};

const validate = (overrides: Partial<VaultFormValues> = {}) =>
  validateVaultForm({ ...base, ...overrides }, 7);

describe("validateVaultForm", () => {
  it("accepts a well-formed vault", () => {
    const { errors, values } = validate();
    expect(errors).toEqual({});
    expect(values).not.toBeNull();
    expect(values?.amount).toBe(1_000_000_000n);
    expect(values?.duration).toBe(30 * 86_400);
    expect(values?.milestones).toBe(4);
    expect(values?.recipient).toBe(RECIPIENT);
  });

  it("converts the chosen duration unit", () => {
    expect(validate({ duration: "45", durationUnit: "minutes" }).values?.duration).toBe(2_700);
    expect(validate({ duration: "2", durationUnit: "hours" }).values?.duration).toBe(7_200);
  });

  it("rejects malformed addresses", () => {
    expect(validate({ recipient: "" }).errors.recipient).toMatch(/receives the payouts/);
    expect(validate({ recipient: "GABC" }).errors.recipient).toMatch(/not a valid Stellar account/);
    expect(validate({ recipient: NATIVE_SAC }).errors.recipient).toMatch(
      /not a valid Stellar account/,
    );
    expect(validate({ token: "not-a-contract" }).errors.token).toMatch(/not a valid Stellar Asset/);
    expect(validate({ token: RECIPIENT }).errors.token).toMatch(/not a valid Stellar Asset/);
  });

  it("rejects amounts the contract would refuse", () => {
    expect(validate({ amount: "0" }).errors.amount).toMatch(/positive amount/);
    expect(validate({ amount: "-5" }).errors.amount).toMatch(/positive amount/);
    expect(validate({ amount: "1.12345678" }).errors.amount).toMatch(/decimals/);

    // 100 does not split evenly across 3 milestones, and the contract would fail.
    const uneven = validate({ milestones: "3" });
    expect(uneven.errors.amount).toMatch(/split evenly across 3 milestones/);
    expect(uneven.values).toBeNull();
  });

  it("bounds the milestone count", () => {
    expect(validate({ milestones: "0" }).errors.milestones).toMatch(/between 1 and 100/);
    expect(validate({ milestones: String(MAX_MILESTONES + 1) }).errors.milestones).toMatch(
      /between 1 and 100/,
    );
    expect(validate({ milestones: "2.5" }).errors.milestones).toMatch(/between 1 and 100/);
    expect(validate({ milestones: "1" }).values?.milestones).toBe(1);
  });

  it("requires a positive duration", () => {
    expect(validate({ duration: "0" }).errors.duration).toMatch(/greater than zero/);
    expect(validate({ duration: "abc" }).errors.duration).toMatch(/greater than zero/);
    // A duration that rounds down to zero seconds is rejected, not silently truncated.
    expect(validate({ duration: "0.0000000001", durationUnit: "minutes" }).errors.duration).toMatch(
      /too small/,
    );
  });

  it("reports every problem at once", () => {
    const { errors } = validate({ recipient: "nope", token: "nope", amount: "0", milestones: "0" });
    expect(Object.keys(errors).sort()).toEqual(["amount", "milestones", "recipient", "token"]);
  });

  it("keeps a single-milestone vault valid", () => {
    const { values } = validate({ milestones: "1", amount: "3.5" });
    expect(values?.milestones).toBe(1);
    expect(values?.amount).toBe(35_000_000n);
  });
});
