"use client";

import { useState } from "react";

import { CreateVaultForm } from "@/components/CreateVaultForm";
import { StatsGrid } from "@/components/StatsGrid";
import { VaultList } from "@/components/VaultList";
import { Callout, Card } from "@/components/ui";
import { stellarConfig } from "@/lib/config";
import { formatDuration } from "@/lib/format";

const STEPS = [
  {
    title: "1 · Fund the escrow",
    body: "Approve a Soroban transfer into the contract. Funds leave your wallet, not the protocol's.",
  },
  {
    title: "2 · Milestones unlock on a clock",
    body: "Each slice unlocks at start + duration × (i+1) ÷ milestones — no keeper, no oracle.",
  },
  {
    title: "3 · Recipient claims, funder recovers",
    body: "Releases are permissionless and always pay the recipient; unclaimed funds return after the grace period.",
  },
];

export default function DashboardPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <section className="text-balance">
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
          Time-locked escrow with milestone streaming, settled on Stellar.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-300 sm:text-base">
          ChronoFlow holds a deposit in a Soroban contract and releases it in equal milestones as
          the clock advances. Recipients claim payouts as they unlock; funders can claw back
          whatever is never claimed once the grace period elapses.
        </p>
      </section>

      {!stellarConfig.isDeployed ? (
        <Callout tone="amber" title="No deployment configured">
          Deploy the contract first:{" "}
          <code className="rounded bg-black/30 px-1">
            pnpm --filter @chronoflow/contracts run deploy:testnet
          </code>
          . That writes the contract id, RPC url and network passphrase into this app.
        </Callout>
      ) : null}

      <StatsGrid />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-6">
          <CreateVaultForm onCreated={() => setRefreshKey((value) => value + 1)} />
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
              How the stream works
            </h2>
            <ul className="space-y-3 text-sm text-slate-400">
              {STEPS.map((step) => (
                <li key={step.title}>
                  <p className="font-medium text-slate-200">{step.title}</p>
                  <p>{step.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              Default clawback grace period: {formatDuration(14 * 24 * 60 * 60)} after the final
              unlock.
            </p>
          </Card>
        </div>

        <div key={refreshKey}>
          <VaultList />
        </div>
      </div>
    </div>
  );
}
