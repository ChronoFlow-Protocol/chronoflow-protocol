"use client";

import { Card, SectionTitle, Stat } from "@/components/ui";
import { useStats } from "@/hooks/useVaultData";
import { stellarConfig } from "@/lib/config";
import { formatCount } from "@/lib/format";

export function StatsGrid() {
  const { data, loading, error } = useStats();

  if (error && !data) {
    return (
      <Card>
        <SectionTitle hint="indexer API">Protocol overview</SectionTitle>
        <p className="text-sm text-rose-300">{error}</p>
      </Card>
    );
  }

  const totals = data?.totals;
  const amounts = data?.amounts;

  return (
    <Card data-testid="stats-grid">
      <SectionTitle
        hint={
          data
            ? `ledger ${formatCount(data.indexer.lastLedger)} · ${
                data.indexer.lastPollAt
                  ? new Date(data.indexer.lastPollAt).toLocaleTimeString()
                  : "never polled"
              }`
            : undefined
        }
      >
        Protocol overview
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Total escrowed"
          value={amounts ? `${amounts.escrowedDisplay} XLM` : loading ? "…" : "—"}
          sub={totals ? `across ${formatCount(totals.vaults)} vaults` : undefined}
        />
        <Stat
          label="Released"
          value={amounts ? `${amounts.releasedDisplay} XLM` : loading ? "…" : "—"}
          sub={totals ? `${formatCount(totals.milestonesReleased)} milestones paid` : undefined}
        />
        <Stat
          label="Still locked"
          value={amounts ? `${amounts.lockedDisplay} XLM` : loading ? "…" : "—"}
          sub={amounts ? `${amounts.streamedDisplay} XLM claimable now` : undefined}
        />
        <Stat
          label="Vaults"
          value={totals ? formatCount(totals.vaults) : loading ? "…" : "—"}
          sub={
            totals
              ? `${formatCount(totals.activeVaults)} streaming · ${formatCount(totals.completedVaults)} completed`
              : undefined
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>
          contract{" "}
          <a
            className="font-mono text-chrono-300 hover:underline"
            href={stellarConfig.explorer.contract(stellarConfig.contractId)}
            target="_blank"
            rel="noreferrer"
          >
            {stellarConfig.contractId
              ? `${stellarConfig.contractId.slice(0, 8)}…${stellarConfig.contractId.slice(-6)}`
              : "not deployed"}
          </a>
        </span>
        {data?.indexer.lastError ? (
          <span className="text-amber-300">indexer warning: {data.indexer.lastError}</span>
        ) : null}
        <span>
          explorer:{" "}
          <a
            className="text-chrono-300 hover:underline"
            href={stellarConfig.explorer.base}
            target="_blank"
            rel="noreferrer"
          >
            {stellarConfig.network}
          </a>
        </span>
      </div>
    </Card>
  );
}
