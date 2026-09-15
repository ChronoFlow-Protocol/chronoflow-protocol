"use client";

import { useState } from "react";

import { useWallet } from "@/components/wallet/WalletProvider";
import { Badge, Button } from "@/components/ui";
import { stellarConfig } from "@/lib/config";
import { shortenAddress } from "@/lib/format";

function WalletButton() {
  const { address, status, network, connect, disconnect, error } = useWallet();
  const [open, setOpen] = useState(false);

  if (status === "checking" || status === "connecting") {
    return (
      <Button tone="secondary" loading>
        {status === "checking" ? "Checking wallet" : "Connecting"}
      </Button>
    );
  }

  if (status === "unavailable") {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/20"
      >
        Install Freighter
      </a>
    );
  }

  if (!address) {
    return (
      <Button onClick={() => void connect()} title={error ?? undefined}>
        Connect Wallet
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button tone="ghost" onClick={() => setOpen((value) => !value)}>
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="font-mono text-xs">{shortenAddress(address, 5, 4)}</span>
      </Button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/10 bg-ink-800 p-4 text-sm shadow-glow">
          <p className="text-xs uppercase tracking-wide text-slate-400">Connected wallet</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-200">{address}</p>
          <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">Network</p>
          <p className="mt-1 text-slate-200">{network ?? "unknown"}</p>
          <div className="mt-4 flex gap-2">
            <a
              href={stellarConfig.explorer.account(address)}
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-center text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              View account
            </a>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="flex-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Header() {
  const { wrongNetwork, status } = useWallet();

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-ink-900/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-chrono-400 to-violet-500 text-lg font-black text-ink-900">
            ⧗
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-100">
              ChronoFlow Protocol
            </p>
            <p className="text-[11px] text-slate-400">
              Time-locked escrow · milestone streaming on Stellar
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge tone={wrongNetwork ? "rose" : "cyan"}>
            {stellarConfig.network}
            {status === "wrong-network" ? " · wrong wallet network" : ""}
          </Badge>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
