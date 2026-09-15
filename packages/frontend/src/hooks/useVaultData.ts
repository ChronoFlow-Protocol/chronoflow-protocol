"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, fetchStats, fetchVaults, type VaultQuery } from "@/lib/api";
import type { ListMeta, StatsView, VaultView } from "@/lib/types";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const DEFAULT_REFRESH_MS = 12_000;

/**
 * Polls `GET /api/vaults`, so on-chain changes appear shortly after the indexer
 * picks them up (and immediately after a local write triggers `refresh`).
 */
export function useVaults(query: VaultQuery = {}, refreshMs = DEFAULT_REFRESH_MS) {
  const [state, setState] = useState<AsyncState<{ items: VaultView[]; meta: ListMeta }>>({
    data: null,
    loading: true,
    error: null,
  });
  const queryKey = JSON.stringify(query);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await fetchVaults(JSON.parse(queryKey) as VaultQuery);
      if (mounted.current) setState({ data: result, loading: false, error: null });
    } catch (error) {
      if (!mounted.current) return;
      setState((previous) => ({
        data: previous.data,
        loading: false,
        error: error instanceof ApiError ? error.message : String(error),
      }));
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}

/** Polls `GET /api/stats` for protocol-wide aggregates. */
export function useStats(refreshMs = DEFAULT_REFRESH_MS) {
  const [state, setState] = useState<AsyncState<StatsView>>({
    data: null,
    loading: true,
    error: null,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await fetchStats();
      if (mounted.current) setState({ data: result, loading: false, error: null });
    } catch (error) {
      if (!mounted.current) return;
      setState((previous) => ({
        data: previous.data,
        loading: false,
        error: error instanceof ApiError ? error.message : String(error),
      }));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}
