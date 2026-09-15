"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { stellarConfig } from "@/lib/config";
import {
  WalletError,
  connectWallet,
  currentAddress,
  isWalletAuthorized,
  isWalletAvailable,
  signTransactionXdr,
  walletNetwork,
} from "@/lib/freighter";

export type WalletStatus =
  | "checking"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong-network";

interface WalletContextValue {
  address: string | null;
  status: WalletStatus;
  /** Network reported by the wallet, e.g. `TESTNET`. */
  network: string | null;
  error: string | null;
  isConnected: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  /** Signs a prepared envelope with the connected wallet. */
  sign: (preparedXdr: string) => Promise<string>;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [network, setNetwork] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Re-reads wallet availability, authorization and network. */
  const refresh = useCallback(async () => {
    const available = await isWalletAvailable();
    if (!mounted.current) return;

    if (!available) {
      setStatus("unavailable");
      setAddress(null);
      setNetwork(null);
      return;
    }

    const details = await walletNetwork();
    if (mounted.current) setNetwork(details?.network ?? null);

    const wrongNetwork =
      details !== null && details.networkPassphrase !== stellarConfig.networkPassphrase;

    const authorized = await isWalletAuthorized();
    const walletAddress = authorized ? await currentAddress() : null;
    if (!mounted.current) return;

    setAddress(walletAddress);
    if (wrongNetwork) setStatus("wrong-network");
    else setStatus(walletAddress ? "connected" : "disconnected");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");

    try {
      const walletAddress = await connectWallet();
      const details = await walletNetwork();
      if (!mounted.current) return;

      setAddress(walletAddress);
      setNetwork(details?.network ?? null);

      if (details && details.networkPassphrase !== stellarConfig.networkPassphrase) {
        setStatus("wrong-network");
        setError(
          `Your wallet is on ${details.network}, but ChronoFlow runs on ${stellarConfig.network}. Switch networks in Freighter and reconnect.`,
        );
      } else {
        setStatus("connected");
      }
    } catch (cause) {
      if (!mounted.current) return;
      setStatus("disconnected");
      setError(cause instanceof WalletError ? cause.message : String(cause));
    }
  }, []);

  const disconnect = useCallback(() => {
    // Freighter has no programmatic disconnect; dropping local state is the
    // closest equivalent and the user can revoke access in the extension.
    setAddress(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  const sign = useCallback(
    async (preparedXdr: string): Promise<string> => {
      if (!address) throw new WalletError("Connect a wallet before signing.");

      if (network === null) {
        const details = await walletNetwork();
        if (details && details.networkPassphrase !== stellarConfig.networkPassphrase) {
          setStatus("wrong-network");
          throw new WalletError(
            `Wrong network: switch Freighter to ${stellarConfig.network} before signing.`,
            "WRONG_NETWORK",
          );
        }
      }

      return signTransactionXdr(preparedXdr, {
        address,
        networkPassphrase: stellarConfig.networkPassphrase,
      });
    },
    [address, network],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      status,
      network,
      error,
      isConnected: status === "connected" || status === "wrong-network",
      wrongNetwork: status === "wrong-network",
      connect,
      disconnect,
      refresh,
      sign,
      clearError: () => setError(null),
    }),
    [address, status, network, error, connect, disconnect, refresh, sign],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside a <WalletProvider>.");
  return context;
}
