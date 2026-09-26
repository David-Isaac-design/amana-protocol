"use client";

/**
 * @deprecated Use `useTradeDetail` from `@/hooks/useTradeDetail` instead.
 *
 * This shim exists for backward compatibility during the migration from
 * the dual-hook setup to the unified `useTradeDetail` hook (#70).
 * It will be removed once all callers have been updated.
 */

export type { UseTradeDetailResult as UseTradeDetailsResult } from "./useTradeDetail";
export { useTradeDetail as useTradeDetails } from "./useTradeDetail";
