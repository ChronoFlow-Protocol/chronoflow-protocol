"use client";

import { useEffect, useState } from "react";

/**
 * Current unix time in seconds, refreshed on an interval.
 *
 * The timeline runs on this rather than on indexer data so countdowns and
 * unlock states stay accurate between polls without hitting the RPC.
 */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
