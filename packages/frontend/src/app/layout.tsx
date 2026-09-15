import type { Metadata, Viewport } from "next";

import { Header } from "@/components/Header";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import { stellarConfig } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  title: "ChronoFlow Protocol · Time-locked escrow on Stellar",
  description:
    "Lock funds in a Soroban escrow contract and stream them to a recipient as milestones unlock over time.",
  applicationName: "ChronoFlow Protocol",
  openGraph: {
    title: "ChronoFlow Protocol",
    description:
      "On-chain time-locked escrow and milestone-based payment streaming, built on Soroban.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-slate-500">
            <p>
              ChronoFlow Protocol · MIT licensed · {stellarConfig.network} contract{" "}
              <a
                className="font-mono text-chrono-300 hover:underline"
                href={stellarConfig.explorer.contract(stellarConfig.contractId)}
                target="_blank"
                rel="noreferrer"
              >
                {stellarConfig.contractId || "not deployed"}
              </a>
            </p>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
