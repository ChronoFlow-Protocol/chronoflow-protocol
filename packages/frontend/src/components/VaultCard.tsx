"use client";

import { useState } from "react";

import { MilestoneTimeline } from "@/components/MilestoneTimeline";
import { VaultActions } from "@/components/VaultActions";
import { Badge, Card, type BadgeTone } from "@/components/ui";
import { stellarConfig } from "@/lib/config";
import { formatDateTime, formatRelativeTime, shortenAddress } from "@/lib/format";
import { VAULT_STATUS_LABEL } from "@/lib/schedule";
import type { VaultStatus, VaultView } from "@/lib/types";

const STATUS_TONES: Record<VaultStatus, BadgeTone> = {
  Active: "cyan",
  Completed: "emerald",
  ClawedBack: "rose",
};

export function VaultCard({
  vault,
  now,
  onChanged,
}: {
  vault: VaultView;
  now: number;
  onChanged?: () => void;
}) {
  const [showLog, setShowLog] = useState(false);
  const statusTone = STATUS_TONES[vault.status] ?? "neutral";

  return (
    <Card className="space-y-4" data-testid="vault-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-100">Vault #{vault.id}</h3>
            <Badge tone={statusTone}>{VAULT_STATUS_LABEL[vault.status] ?? vault.status}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {vault.milestones} milestones · {formatRelativeTime(vault.endTime, now)} final unlock ·{" "}
            <a
              className="text-chrono-300 hover:underline"
              href={stellarConfig.explorer.tx(vault.createdTxHash)}
              target="_blank"
              rel="noreferrer"
            >
              created in ledger {vault.createdLedger}
            </a>
          </p>
        </div>

        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Total escrow</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-100">
            {vault.totalAmountDisplay} <span className="text-sm text-slate-400">XLM</span>
          </p>
          <p className="text-[11px] text-slate-500">
            {vault.amountPerMilestoneDisplay} XLM per milestone
          </p>
        </div>
      </div>

      <MilestoneTimeline vault={vault} now={now} />

      <VaultActions vault={vault} now={now} onChanged={onChanged} />

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <p className="text-slate-400">
          Funder{" "}
          <a
            className="font-mono text-slate-200 hover:underline"
            href={stellarConfig.explorer.account(vault.funder)}
            target="_blank"
            rel="noreferrer"
          >
            {shortenAddress(vault.funder, 6, 6)}
          </a>
        </p>
        <p className="text-slate-400">
          Recipient{" "}
          <a
            className="font-mono text-slate-200 hover:underline"
            href={stellarConfig.explorer.account(vault.recipient)}
            target="_blank"
            rel="noreferrer"
          >
            {shortenAddress(vault.recipient, 6, 6)}
          </a>
        </p>
        <p className="text-slate-400">
          Token{" "}
          <a
            className="font-mono text-slate-200 hover:underline"
            href={stellarConfig.explorer.contract(vault.token)}
            target="_blank"
            rel="noreferrer"
          >
            {shortenAddress(vault.token, 6, 6)}
          </a>
        </p>
        <p className="text-slate-400" title={formatDateTime(vault.clawbackTime)}>
          Clawback window {formatRelativeTime(vault.clawbackTime, now)}
        </p>
      </div>

      <div className="border-t border-white/5 pt-3">
        <button
          type="button"
          onClick={() => setShowLog((value) => !value)}
          className="text-xs font-medium text-chrono-300 hover:underline"
        >
          {showLog ? "Hide" : "Show"} contract event log ({vault.events?.length ?? 0})
        </button>

        {showLog ? (
          <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
            {(vault.events ?? []).map((event) => (
              <li key={event.eventId} className="flex flex-wrap items-center gap-2">
                <Badge tone="violet">{event.kind}</Badge>
                <span>ledger {event.ledger}</span>
                <a
                  className="font-mono text-chrono-300 hover:underline"
                  href={stellarConfig.explorer.tx(event.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {event.txHash.slice(0, 12)}…
                </a>
                <span className="text-slate-500">{formatDateTime(event.occurredAt)}</span>
              </li>
            ))}
            {(vault.events?.length ?? 0) === 0 ? <li>No events indexed yet.</li> : null}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
