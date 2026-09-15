"use client";

import { useMemo, useState } from "react";

import { VaultCard } from "@/components/VaultCard";
import { Callout, Card, SectionTitle, Spinner } from "@/components/ui";
import { useVaults } from "@/hooks/useVaultData";
import { useNow } from "@/hooks/useNow";
import { stellarConfig } from "@/lib/config";
import { API_URL } from "@/lib/config";
import type { VaultStatus } from "@/lib/types";

type Filter = "all" | VaultStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Active", label: "Streaming" },
  { key: "Completed", label: "Completed" },
  { key: "ClawedBack", label: "Clawed back" },
];

export function VaultList() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, loading, error, refresh } = useVaults({ limit: 50 });
  const now = useNow();

  const counts = useMemo(() => {
    const items = data?.items ?? [];
    return {
      all: items.length,
      Active: items.filter((vault) => vault.status === "Active").length,
      Completed: items.filter((vault) => vault.status === "Completed").length,
      ClawedBack: items.filter((vault) => vault.status === "ClawedBack").length,
    } satisfies Record<Filter, number>;
  }, [data]);

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return filter === "all" ? all : all.filter((vault) => vault.status === filter);
  }, [data, filter]);

  return (
    <Card data-testid="vault-list">
      <SectionTitle
        hint={`${counts.all} vault${counts.all === 1 ? "" : "s"} · live from ${API_URL.replace(/^https?:\/\//, "")}`}
      >
        Escrow vaults
      </SectionTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilter(entry.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === entry.key
                ? "border-chrono-400/60 bg-chrono-500/15 text-chrono-100"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {entry.label} · {counts[entry.key]}
          </button>
        ))}
      </div>

      {error && !data ? (
        <Callout tone="amber" title="Indexer API unavailable">
          <p>{error}</p>
          <p className="mt-2 text-xs text-slate-400">
            The dApp reads vault state from the ChronoFlow indexer. Start it with{" "}
            <code className="rounded bg-black/30 px-1">
              pnpm --filter @chronoflow/backend run dev
            </code>
            , then refresh. Contract writes work either way.
          </p>
        </Callout>
      ) : null}

      {loading && !data ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> Loading vaults…
        </p>
      ) : null}

      {data && items.length === 0 ? (
        <p className="text-sm text-slate-400">
          {counts.all === 0
            ? "No vaults yet. Create the first one to start a milestone stream."
            : "No vaults match this filter."}
        </p>
      ) : null}

      <div className="space-y-4">
        {items.map((vault) => (
          <VaultCard key={vault.id} vault={vault} now={now} onChanged={() => void refresh()} />
        ))}
      </div>

      {stellarConfig.isDeployed ? (
        <p className="mt-4 text-[11px] text-slate-500">
          Contract{" "}
          <a
            className="font-mono text-chrono-300 hover:underline"
            href={stellarConfig.explorer.contract(stellarConfig.contractId)}
            target="_blank"
            rel="noreferrer"
          >
            {stellarConfig.contractId}
          </a>{" "}
          · deployed at ledger {stellarConfig.deployedLedger}
        </p>
      ) : null}
    </Card>
  );
}
