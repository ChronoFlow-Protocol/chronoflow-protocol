"use client";

import { useWallet } from "@/components/wallet/WalletProvider";
import { Button, Callout } from "@/components/ui";
import { useTransaction } from "@/hooks/useTransaction";
import { formatRelativeTime } from "@/lib/format";
import { canClawback, milestoneState, nextMilestoneIndex } from "@/lib/schedule";
import { clawbackVault, releaseMilestone } from "@/lib/soroban";
import type { VaultView } from "@/lib/types";

interface VaultActionsProps {
  vault: VaultView;
  now: number;
  /** Called after a confirmed write so the parent can refetch vault state. */
  onChanged?: () => void;
}

export function VaultActions({ vault, now, onChanged }: VaultActionsProps) {
  const wallet = useWallet();
  const release = useTransaction();
  const clawback = useTransaction();

  const nextIndex = nextMilestoneIndex(vault.milestonesReleased, vault.milestones);
  const nextMilestone = nextIndex === null ? undefined : vault.timeline[nextIndex];
  const nextState = nextMilestone
    ? milestoneState({
        released: nextMilestone.released,
        status: vault.status,
        unlockTime: nextMilestone.unlockTime,
        now,
      })
    : null;

  const isRecipient =
    Boolean(wallet.address) && wallet.address?.toUpperCase() === vault.recipient.toUpperCase();
  const isFunder =
    Boolean(wallet.address) && wallet.address?.toUpperCase() === vault.funder.toUpperCase();

  const releasable = vault.status === "Active" && nextState === "releasable";
  const clawbackReady = canClawback(vault.status, vault.clawbackTime, now);

  const runRelease = () =>
    void release.run(
      async () => {
        if (!wallet.address) throw new Error("Connect a wallet to release a milestone.");
        return releaseMilestone({
          vaultId: vault.id,
          source: wallet.address,
          signer: wallet.sign,
        });
      },
      () => onChanged?.(),
    );

  const runClawback = () =>
    void clawback.run(
      async () => {
        if (!wallet.address) throw new Error("Connect a wallet to claw back escrow.");
        return clawbackVault({
          vaultId: vault.id,
          source: wallet.address,
          signer: wallet.sign,
        });
      },
      () => onChanged?.(),
    );

  const releaseLabel = isRecipient ? "Claim Payout" : "Release Milestone";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={runRelease}
          loading={release.pending}
          disabled={!releasable || wallet.status !== "connected"}
          title={
            wallet.status !== "connected"
              ? "Connect your Freighter wallet first"
              : releasable
                ? "Anyone can release the next unlocked milestone; the payout goes to the recipient"
                : undefined
          }
        >
          {releaseLabel}
        </Button>

        {isFunder ? (
          <Button
            tone="danger"
            onClick={runClawback}
            loading={clawback.pending}
            disabled={!clawbackReady || wallet.status !== "connected"}
            title={
              clawbackReady
                ? "Return every unclaimed milestone to you as the funder"
                : `Available after the grace period (${formatRelativeTime(vault.clawbackTime, now)})`
            }
          >
            Clawback Escrow
          </Button>
        ) : null}

        <span className="text-xs text-slate-400">
          {vault.status !== "Active"
            ? "This vault is closed."
            : releasable
              ? nextMilestone?.amountDisplay
                ? `${nextMilestone.amountDisplay} XLM is claimable now`
                : "A milestone is claimable now"
              : nextMilestone
                ? `Milestone ${nextMilestone.index + 1} unlocks ${formatRelativeTime(nextMilestone.unlockTime, now)}`
                : "Every milestone has been released"}
        </span>
      </div>

      {release.error ? (
        <Callout tone="rose" title="Release failed">
          {release.error}
        </Callout>
      ) : null}
      {release.outcome ? (
        <Callout tone="emerald" title="Milestone released">
          <a
            className="underline"
            href={release.outcome.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            {release.outcome.hash.slice(0, 16)}… confirmed in ledger {release.outcome.ledger}
          </a>
        </Callout>
      ) : null}

      {clawback.error ? (
        <Callout tone="rose" title="Clawback failed">
          {clawback.error}
        </Callout>
      ) : null}
      {clawback.outcome ? (
        <Callout tone="emerald" title="Escrow clawed back">
          <a
            className="underline"
            href={clawback.outcome.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            {clawback.outcome.hash.slice(0, 16)}… confirmed in ledger {clawback.outcome.ledger}
          </a>
        </Callout>
      ) : null}

      {wallet.error && wallet.status === "wrong-network" ? (
        <Callout tone="amber" title="Wrong network">
          {wallet.error}
        </Callout>
      ) : null}
    </div>
  );
}
