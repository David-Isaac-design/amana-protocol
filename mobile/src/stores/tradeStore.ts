import { create } from 'zustand';

import { tradeApi } from '../api/trade';
import { viewForError } from '../api/errorInterceptor';
import { AdminErrorView } from '../api/errors';
import type { Trade, TradeListResult, TradeStatus } from '../types/trade';

interface TradeState {
  trades: Trade[];
  total: number;
  currentTrade: Trade | null;
  isLoading: boolean;
  /**
   * True while a user-initiated pull-to-refresh is in flight. Kept
   * separate from `isLoading` so the list can render its
   * `RefreshControl` spinner without also swapping the whole screen
   * into the initial-load state.
   */
  isRefreshing: boolean;

  /**
   * Error view for **load** actions (`fetchTrades`, `fetchTrade`).
   * Screens that primarily render a list/detail read this and put the
   * banner above the content.
   */
  errorView: AdminErrorView | null;
  /**
   * Error view for **mutation** actions (`createTrade`,
   * `confirmDelivery`, `releaseFunds`, `deposit`, `initiateDispute`).
   * Kept separate from `errorView` so a successful poll doesn't wipe
   * the most-recent mutation error before the user can read it (this
   * mirrors the dual-state pattern used by the admin screens — see
   * `loadErrorView` vs `actionErrorView`).
   */
  lastActionErrorView: AdminErrorView | null;

  fetchTrades: (params?: { status?: TradeStatus; page?: number }) => Promise<void>;
  /**
   * Pull-to-refresh entry point for the trade list. Re-runs the list
   * fetch while toggling `isRefreshing` so the `RefreshControl`
   * spinner reflects the in-flight request.
   */
  refreshTrades: (params?: { status?: TradeStatus; page?: number }) => Promise<void>;
  /**
   * Refresh a single trade.
   *
   * `silent: true` opts out of the visible load-slot error so that
   * transient refresh failures (e.g. releaseFunds / deposit doing a
   * post-action refresh via `fetchTrade(tradeId, { silent: true })`)
   * are NOT promoted to a misleading "load failed" banner above a
   * successful mutation. Use the default (silent omitted) for any
   * user-initiated load — those still surface in `errorView`.
   */
  fetchTrade: (
    tradeId: string,
    options?: { silent?: boolean },
  ) => Promise<void>;
  createTrade: (data: {
    sellerAddress: string;
    amountUsdc: string;
    buyerLossBps?: number;
    sellerLossBps?: number;
    commodity?: string;
    quantity?: string;
    unit?: string;
  }) => Promise<{ tradeId: string; unsignedXdr: string } | null>;
  confirmDelivery: (tradeId: string) => Promise<void>;
  releaseFunds: (tradeId: string) => Promise<void>;
  deposit: (tradeId: string) => Promise<void>;
  initiateDispute: (tradeId: string, reason: string) => Promise<void>;
  /**
   * Clears both error slots. Called by banner `onGoBack` / `onRetry`
   * paths and after explicit dismissals so a stale mutation banner
   * never leaks behind a successful refresh.
   */
  clearErrorView: () => void;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  trades: [],
  total: 0,
  currentTrade: null,
  isLoading: false,
  isRefreshing: false,
  errorView: null,
  lastActionErrorView: null,

  fetchTrades: async (params) => {
    set({ isLoading: true, errorView: null });
    try {
      const result: TradeListResult = await tradeApi.listTrades(params);
      set({ trades: result.trades, total: result.total, isLoading: false });
    } catch (error: unknown) {
      set({ errorView: viewForError(error), isLoading: false });
    }
  },

  refreshTrades: async (params) => {
    set({ isRefreshing: true, errorView: null });
    try {
      const result: TradeListResult = await tradeApi.listTrades(params);
      set({ trades: result.trades, total: result.total, isRefreshing: false });
    } catch (error: unknown) {
      set({ errorView: viewForError(error), isRefreshing: false });
    }
  },

  fetchTrade: async (tradeId, options) => {
    // Quiet refreshes (`silent: true`) are used by post-action hooks
    // (releaseFunds / deposit) to reload the trade without promoting
    // a transient refresh failure to the visible "load failed"
    // banner above a successful mutation.
    const silent = options?.silent === true;
    // Intentionally: a silent background refresh does NOT clear a
    // pre-existing `errorView` from a prior user-initiated load — the
    // user might still need to act on it. Only explicit (non-silent)
    // refreshes wipe the load-slot on entry. Don't "simplify" by
    // removing the conditional spread.
    set({ isLoading: true, ...(silent ? {} : { errorView: null }) });
    try {
      const trade = await tradeApi.getTrade(tradeId);
      set({ currentTrade: trade, isLoading: false });
    } catch (error: unknown) {
      if (silent) {
        // Leave both error slots untouched — the caller's mutation
        // succeeded, surfacing a load failure here would only mislead
        // the user. The stale `currentTrade` is recoverable by the
        // next explicit refresh.
        set({ isLoading: false });
        return;
      }
      set({ errorView: viewForError(error), isLoading: false });
    }
  },

  createTrade: async (data) => {
    set({ isLoading: true, lastActionErrorView: null });
    try {
      const result = await tradeApi.createTrade(data);
      set({ isLoading: false });
      return result;
    } catch (error: unknown) {
      set({ lastActionErrorView: viewForError(error), isLoading: false });
      return null;
    }
  },

  confirmDelivery: async (tradeId) => {
    set({ isLoading: true, lastActionErrorView: null });
    try {
      const trade = await tradeApi.confirmDelivery(tradeId);
      set({ currentTrade: trade, isLoading: false });
    } catch (error: unknown) {
      set({ lastActionErrorView: viewForError(error), isLoading: false });
    }
  },

  releaseFunds: async (tradeId) => {
    set({ isLoading: true, lastActionErrorView: null });
    try {
      await tradeApi.releaseFunds(tradeId);
      if (get().currentTrade) {
        // Chain: refresh `currentTrade` after the mutation. Use the
        // `silent: true` mode so a transient refresh failure does NOT
        // promote itself to a misleading "load failed" banner above a
        // successful release — `lastActionErrorView` is intentionally
        // left alone so an earlier mutation banner stays visible if
        // this chain fails.
        await get().fetchTrade(tradeId, { silent: true });
      }
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ lastActionErrorView: viewForError(error), isLoading: false });
    }
  },

  deposit: async (tradeId) => {
    set({ isLoading: true, lastActionErrorView: null });
    try {
      await tradeApi.deposit(tradeId);
      if (get().currentTrade) {
        await get().fetchTrade(tradeId, { silent: true });
      }
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ lastActionErrorView: viewForError(error), isLoading: false });
    }
  },

  initiateDispute: async (tradeId, reason) => {
    set({ isLoading: true, lastActionErrorView: null });
    try {
      const trade = await tradeApi.initiateDispute(tradeId, reason);
      set({ currentTrade: trade, isLoading: false });
    } catch (error: unknown) {
      set({ lastActionErrorView: viewForError(error), isLoading: false });
    }
  },

  clearErrorView: () =>
    set({
      errorView: null,
      lastActionErrorView: null,
    }),
}));
