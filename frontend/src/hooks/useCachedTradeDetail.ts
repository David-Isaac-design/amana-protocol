"use client";

/**
 * @deprecated Use `useTradeDetail` from `@/hooks/useTradeDetail` instead.
 *
 * The offline-cache functionality from this hook has been merged into the
 * unified `useTradeDetail` hook (#70). This shim re-exports it so existing
 * callers continue to work during the migration window.
 */

export type { UseTradeDetailResult as UseCachedTradeDetailResult } from "./useTradeDetail";
export { useTradeDetail as useCachedTradeDetail } from "./useTradeDetail";
