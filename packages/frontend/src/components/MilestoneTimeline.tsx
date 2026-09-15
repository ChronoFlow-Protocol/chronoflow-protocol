"use client";

import { useMemo } from "react";

import { Badge, type BadgeTone } from "@/components/ui";
import {
  formatCount,
  formatDateTime,
  formatRelativeTime,
  formatUnits,
  percent,
} from "@/lib/format";
import {
  MILESTONE_STATE_LABEL,
  bucketAmounts,
  milestoneState,
  vaultProgress,
} from "@/lib/schedule";
import type { MilestoneState, VaultView } from "@/lib/types";

const STATE_TONES: Record<MilestoneState, BadgeTone> = {
  locked: "neutral",
  releasable: "cyan",
  released: "emerald",
  cancelled: "rose",
};

const SEGMENT_CLASSES: Record<MilestoneState, string> = {
  locked: "bg-ink-600",
  releasable: "bg-chrono-500/80 animate-pulse-bar",
  released: "bg-emerald-500/80",
  cancelled: "bg-rose-500/50",
};

export function MilestoneTimeline({ vault, now }: { vault: VaultView; now: number }) {
  const view = useMemo(() => {
    const decimals = vault.decimals;
    const totals = bucketAmounts(vault.timeline, vault.status, now);
    const nextIndex = vault.nextUnlockTime ?? null;

    return {
      totals,
      segments: vault.timeline.map((milestone) => ({
        ...milestone,
        state: milestoneState({
          released: milestone.released,
          status: vault.status,
          unlockTime: milestone.unlockTime,
          now,
        }),
      })),
      progress: vaultProgress(vault.milestonesReleased, vault.milestones),
      nextUnlockTime: nextIndex,
      decimals,
    };
  }, [vault, now]);

  const lockedShare = percent(
    Number(view.totals.locked),
    Number(
      view.totals.locked + view.totals.releasable + view.totals.released + view.totals.cancelled,
    ),
  );
  const releasableShare = percent(
    Number(view.totals.releasable),
    Number(
      view.totals.locked + view.totals.releasable + view.totals.released + view.totals.cancelled,
    ),
  );
  const releasedShare = percent(
    Number(view.totals.released),
    Number(
      view.totals.locked + view.totals.releasable + view.totals.released + view.totals.cancelled,
    ),
  );

  return (
    <div className="space-y-3" data-testid="milestone-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">
          Milestone timeline · {formatCount(vault.milestonesReleased)}/
          {formatCount(vault.milestones)} released
        </p>
        <p className="text-xs text-slate-400">
          {view.nextUnlockTime && vault.status === "Active"
            ? `next unlock ${formatRelativeTime(view.nextUnlockTime, now)}`
            : vault.status === "Active"
              ? "all milestones unlocked"
              : "stream finished"}
        </p>
      </div>

      {/* Locked vs unlocked funds: one bar, three slices. */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-700">
        <div className="bg-emerald-500/80" style={{ width: `${releasedShare}%` }} />
        <div className="bg-chrono-500/80" style={{ width: `${releasableShare}%` }} />
        <div className="bg-ink-600" style={{ width: `${lockedShare}%` }} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-3 py-2">
          <p className="text-slate-400">Released</p>
          <p className="font-semibold tabular-nums text-emerald-300">
            {formatUnits(view.totals.released, vault.decimals)} XLM
          </p>
        </div>
        <div className="rounded-lg border border-chrono-400/20 bg-chrono-500/5 px-3 py-2">
          <p className="text-slate-400">Unlocked (claimable)</p>
          <p className="font-semibold tabular-nums text-chrono-200">
            {formatUnits(view.totals.releasable, vault.decimals)} XLM
          </p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-slate-400">Timelocked</p>
          <p className="font-semibold tabular-nums text-slate-200">
            {formatUnits(view.totals.locked, vault.decimals)} XLM
          </p>
        </div>
      </div>

      {/* Per-milestone segments. */}
      <div className="flex gap-1.5">
        {view.segments.map((segment) => (
          <div
            key={segment.index}
            className="group relative flex-1"
            title={`Milestone ${segment.index + 1} · ${MILESTONE_STATE_LABEL[segment.state]} · ${segment.amountDisplay} XLM · unlocks ${formatDateTime(segment.unlockTime)}`}
          >
            <div className={`h-8 rounded-md ${SEGMENT_CLASSES[segment.state]}`} />
            <p className="mt-1 truncate text-center text-[10px] text-slate-500">
              #{segment.index + 1}
            </p>
          </div>
        ))}
      </div>

      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {view.segments.map((segment) => (
          <div
            key={segment.index}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900/40 px-3 py-2 text-xs"
          >
            <span className="flex items-center gap-2">
              <Badge tone={STATE_TONES[segment.state]}>
                {MILESTONE_STATE_LABEL[segment.state]}
              </Badge>
              <span className="text-slate-300">Milestone {segment.index + 1}</span>
            </span>
            <span className="flex items-center gap-3 tabular-nums">
              <span className="text-slate-200">{segment.amountDisplay} XLM</span>
              <span className="text-slate-500">
                {segment.released
                  ? `paid ${formatDateTime(segment.releasedAt ?? segment.unlockTime)}`
                  : formatRelativeTime(segment.unlockTime, now)}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-chrono-400 to-violet-500 transition-all"
          style={{ width: `${view.progress}%` }}
        />
      </div>
    </div>
  );
}
