import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@/generated/chronoflow";
import { describeSorobanError } from "@/lib/soroban";

describe("describeSorobanError", () => {
  it("maps contract error codes to actionable copy", () => {
    const locked = describeSorobanError(
      "HostError: Error(Contract, #7)\nEvent log (newest first): ...",
    );
    expect(locked).toContain("MilestoneLocked");
    expect(locked).toMatch(/has not unlocked yet/);

    const tooEarly = describeSorobanError(
      `HostError: Error(Contract, #${ERROR_CODES.ClawbackTooEarly})`,
    );
    expect(tooEarly).toMatch(/grace period/);

    const paused = describeSorobanError(
      `HostError: Error(Contract, #${ERROR_CODES.ContractPaused})`,
    );
    expect(paused).toMatch(/paused/);
  });

  it("stays aligned with the generated spec", () => {
    // Every code the contract defines must produce copy that names the variant.
    for (const [name, code] of Object.entries(ERROR_CODES)) {
      const message = describeSorobanError(`Error(Contract, #${code})`);
      expect(message).toContain(name);
    }
  });

  it("passes through unknown codes and messages unchanged", () => {
    expect(describeSorobanError("Error(Contract, #99)")).toBe("Error(Contract, #99)");
    expect(describeSorobanError("network unreachable")).toBe("network unreachable");
  });
});
