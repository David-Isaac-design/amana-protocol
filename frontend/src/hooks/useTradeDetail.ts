"use client";

/**
 * useTradeDetail — unified, offline-capable hook for a single trade.
 *
 * Merges the former `useTradeDetail` (simple fetch) and `useTradeDetails`
 * (deferred fetch, different token signature) into one canonical hook.
 * Offline cache support from `useCachedTradeDetail` is preserved here
 * so callers automatically get stale-while-revalidate behaviour. (#70)
 *
 * Migration guide
 * ───────────────
 * Old: useTradeDetail(tradeId)        → NEW: useTradeDetail(tradeId)  ✅ same signature
 * Old: useTradeDetails(token, id)     → NEW: useTradeDetail(id)        ✅ token from useAuth
 * Old: useCachedTradeDetail(tradeId)  → NEW: useTradeDetail(tradeId)   ✅ same, cache included
 *
 * The legacy files (useTradeDetails.ts, useCachedTradeDetail.ts) have been
 * kept as thin re-export shims for backward compatibility during the
 * migration window; they will be removed once all callers are updated.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { useOffline } from "./useOffline";
import { api, ApiError } from "@/lib/api";
import {
  cacheRead,
  cacheWrite,
  cacheInvalidate,
} from "@/lib/offlineCache";
import type { TradeResponse } from "@/lib/api/types";

const DOMAIN = "trade_detail" as const;

export interface UseTradeDetailResult {
  trade: TradeResponse | null;
  loading: boolean;
  /** True when serving cached data while a background refresh is in flight. */
  isStale: boolean;
  /** Unix timestamp (ms) when the cached entry was written, or null. */
  cachedAt: number | null;
  error: string | null;
  /** Re-fetch from the network (no-ops when offline). */
  refetch: () => void;
  /** Wipe the cache entry then re-fetch. */
  invalidateAndRefetch: () => void;
}

export function useTradeDetail(tradeId: string): UseTradeDetailResult {
  const { token, isAuthenticated } = useAuth();
  const { isOffline } = useOffline();

  // Seed state from cache on the first render.
  const initialRead = cacheRead<TradeResponse>(DOMAIN, tradeId);

  const [trade, setTrade] = useState<TradeResponse | null>(
    initialRead.entry?.data ?? null,
  );
  const [isStale, setIsStale] = useState(initialRead.isStale);
  const [cachedAt, setCachedAt] = useState<number | null>(
    initialRead.entry?.cachedAt ?? null,
  );
  // Start loading only if there is no cached entry at all.
  const [loading, setLoading] = useState(initialRead.isMiss);
  const [error, setError] = useState<string | null>(null);

  // Guard against concurrent fetches.
  const fetchingRef = useRef(false);

  const fetchFresh = useCallback(async () => {
    if (!isAuthenticated || !token || isOffline || fetchingRef.current) return;

    fetchingRef.current = true;
    setError(null);

    try {
      const fresh = await api.trades.get(token, tradeId);
      cacheWrite(DOMAIN, tradeId, fresh);
      setTrade(fresh);
      setIsStale(false);
      setCachedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load trade";
      setError(msg);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [isAuthenticated, token, isOffline, tradeId]);

  // Re-seed from cache whenever tradeId changes.
  useEffect(() => {
    const read = cacheRead<TradeResponse>(DOMAIN, tradeId);
    if (read.entry) {
      setTrade(read.entry.data);
      setIsStale(read.isStale);
      setCachedAt(read.entry.cachedAt);
      setLoading(false);
    } else {
      setTrade(null);
      setIsStale(false);
      setCachedAt(null);
      setLoading(true);
    }
    setError(null);
  }, [tradeId]);

  // Trigger a background refresh whenever we go online or the tradeId changes.
  useEffect(() => {
    if (!isOffline && isAuthenticated && token) {
      void fetchFresh();
    }
  }, [isOffline, isAuthenticated, token, fetchFresh]);

  const refetch = useCallback(() => void fetchFresh(), [fetchFresh]);

  const invalidateAndRefetch = useCallback(() => {
    cacheInvalidate(DOMAIN, tradeId);
    setTrade(null);
    setLoading(true);
    setIsStale(false);
    setCachedAt(null);
    void fetchFresh();
  }, [fetchFresh, tradeId]);

  return {
    trade,
    loading,
    isStale,
    cachedAt,
    error,
    refetch,
    invalidateAndRefetch,
  };
}
