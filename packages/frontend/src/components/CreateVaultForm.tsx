"use client";

import { useMemo, useState } from "react";

import { Card, Callout, Field, SectionTitle, Button, inputClass } from "@/components/ui";
import { useWallet } from "@/components/wallet/WalletProvider";
import { useTransaction } from "@/hooks/useTransaction";
import { stellarConfig } from "@/lib/config";
import { formatDuration, formatUnits } from "@/lib/format";
import { createVault } from "@/lib/soroban";
import {
  DURATION_UNIT_SECONDS,
  MAX_MILESTONES,
  validateVaultForm,
  type DurationUnit,
  type VaultFormValues,
} from "@/lib/validation";

const INITIAL_VALUES: VaultFormValues = {
  recipient: "",
  token: stellarConfig.nativeAssetContractId,
  amount: "100",
  duration: "30",
  durationUnit: "days",
  milestones: "4",
};

export function CreateVaultForm({ onCreated }: { onCreated?: () => void }) {
  const wallet = useWallet();
  const tx = useTransaction();
  const [values, setValues] = useState<VaultFormValues>(INITIAL_VALUES);
  const [touched, setTouched] = useState(false);

  const validation = useMemo(() => validateVaultForm(values, stellarConfig.decimals), [values]);
  const errors = touched ? validation.errors : {};

  const preview = useMemo(() => {
    const parsed = validation.values;
    if (!parsed) return null;
    const perMilestone = parsed.amount / BigInt(parsed.milestones);
    return {
      perMilestone,
      schedule: formatDuration(parsed.duration),
      cadence: formatDuration(Math.floor(parsed.duration / parsed.milestones)),
    };
  }, [validation.values]);

  const update = <K extends keyof VaultFormValues>(key: K, value: VaultFormValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const submit = async () => {
    setTouched(true);
    const parsed = validation.values;
    if (!parsed || !wallet.address) return;

    await tx.run(
      () =>
        createVault({
          funder: wallet.address as string,
          recipient: parsed.recipient,
          token: parsed.token,
          amount: parsed.amount,
          duration: parsed.duration,
          milestones: parsed.milestones,
          signer: wallet.sign,
        }),
      () => onCreated?.(),
    );
  };

  const disabledReason = !stellarConfig.isDeployed
    ? "No contract deployed for this network yet."
    : wallet.status === "unavailable"
      ? "Install Freighter to create a vault."
      : wallet.status !== "connected"
        ? "Connect your wallet to fund a vault."
        : null;

  return (
    <Card data-testid="create-vault-form">
      <SectionTitle hint={`${stellarConfig.decimals} decimals · XLM by default`}>
        Initialize a time-locked vault
      </SectionTitle>

      <div className="space-y-4">
        <Field label="Recipient" hint="G…" error={errors.recipient}>
          <input
            className={inputClass}
            placeholder="G…"
            spellCheck={false}
            value={values.recipient}
            onChange={(event) => update("recipient", event.target.value)}
          />
        </Field>

        <Field label="Token contract" hint="C… · defaults to XLM" error={errors.token}>
          <input
            className={`${inputClass} font-mono text-xs`}
            spellCheck={false}
            value={values.token}
            onChange={(event) => update("token", event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total deposit" hint="XLM" error={errors.amount}>
            <input
              className={inputClass}
              inputMode="decimal"
              value={values.amount}
              onChange={(event) => update("amount", event.target.value)}
            />
          </Field>

          <Field label="Milestones" hint={`1–${MAX_MILESTONES}`} error={errors.milestones}>
            <input
              className={inputClass}
              inputMode="numeric"
              value={values.milestones}
              onChange={(event) => update("milestones", event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duration" hint="time to the final unlock" error={errors.duration}>
            <input
              className={inputClass}
              inputMode="decimal"
              value={values.duration}
              onChange={(event) => update("duration", event.target.value)}
            />
          </Field>

          <Field label="Unit">
            <select
              className={inputClass}
              value={values.durationUnit}
              onChange={(event) => update("durationUnit", event.target.value as DurationUnit)}
            >
              {Object.keys(DURATION_UNIT_SECONDS).map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {preview ? (
          <div className="rounded-xl border border-white/10 bg-ink-900/50 px-4 py-3 text-xs text-slate-300">
            <p>
              <span className="font-semibold text-slate-100">
                {formatUnits(preview.perMilestone, stellarConfig.decimals)} XLM
              </span>{" "}
              per milestone · unlocks roughly every{" "}
              <span className="text-chrono-200">{preview.cadence}</span> over{" "}
              <span className="text-chrono-200">{preview.schedule}</span>.
            </p>
            <p className="mt-1 text-slate-500">
              Unclaimed funds return to you {formatDuration(14 * 24 * 60 * 60)} after the final
              unlock.
            </p>
          </div>
        ) : null}

        <div>
          <Button
            onClick={() => void submit()}
            loading={tx.pending}
            disabled={Boolean(disabledReason)}
            className="w-full"
          >
            {tx.pending ? "Waiting for the wallet…" : "Lock funds & start streaming"}
          </Button>
          {disabledReason ? (
            <p className="mt-2 text-center text-xs text-slate-400">{disabledReason}</p>
          ) : (
            <p className="mt-2 text-center text-xs text-slate-500">
              Funds go into the escrow contract — not to the recipient until each milestone unlocks.
            </p>
          )}
        </div>

        {tx.error ? (
          <Callout tone="rose" title="Could not create the vault">
            {tx.error}
          </Callout>
        ) : null}

        {tx.outcome ? (
          <Callout tone="emerald" title="Vault created">
            <a className="underline" href={tx.outcome.explorerUrl} target="_blank" rel="noreferrer">
              {tx.outcome.hash.slice(0, 20)}… confirmed in ledger {tx.outcome.ledger}
            </a>
            <p className="mt-1 text-xs text-slate-400">
              The indexer picks it up within a few seconds.
            </p>
          </Callout>
        ) : null}
      </div>
    </Card>
  );
}
