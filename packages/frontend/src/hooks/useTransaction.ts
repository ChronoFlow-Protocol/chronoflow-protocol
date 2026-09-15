"use client";

import { useCallback, useState } from "react";

import type { TxOutcome } from "@/lib/soroban";

type Phase = "idle" | "pending" | "success" | "error";

/**
 * Runs one contract invocation at a time and exposes a render-friendly phase.
 *
 * Kept deliberately small: the wallet already reports its own errors, so this
 * only adds a pending flag, the outcome and a decoded error message.
 */
export function useTransaction() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TxOutcome | null>(null);

  const run = useCallback(
    async (
      action: () => Promise<TxOutcome>,
      onSuccess?: (outcome: TxOutcome) => void | Promise<void>,
    ): Promise<TxOutcome | null> => {
      setPhase("pending");
      setError(null);
      setOutcome(null);

      try {
        const result = await action();
        setOutcome(result);
        setPhase("success");
        await onSuccess?.(result);
        return result;
      } catch (cause) {
        setPhase("error");
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setOutcome(null);
  }, []);

  return {
    phase,
    error,
    outcome,
    pending: phase === "pending",
    run,
    reset,
  };
}
