import { act } from '@testing-library/react-native';

import { useTradeStore } from './tradeStore';
import { tradeApi } from '../api/trade';
import { AdminApiError } from '../api/errors';
import { NETWORK_ERROR_CODE } from '../api/errorInterceptor';

jest.mock('../api/trade', () => ({
  tradeApi: {
    listTrades: jest.fn(),
    getTrade: jest.fn(),
    createTrade: jest.fn(),
    confirmDelivery: jest.fn(),
    releaseFunds: jest.fn(),
    deposit: jest.fn(),
    initiateDispute: jest.fn(),
  },
}));

const mockList = tradeApi.listTrades as jest.MockedFunction<
  typeof tradeApi.listTrades
>;
const mockConfirm = tradeApi.confirmDelivery as jest.MockedFunction<
  typeof tradeApi.confirmDelivery
>;
const mockGet = tradeApi.getTrade as jest.MockedFunction<
  typeof tradeApi.getTrade
>;
const mockRelease = tradeApi.releaseFunds as jest.MockedFunction<
  typeof tradeApi.releaseFunds
>;
const mockDeposit = tradeApi.deposit as jest.MockedFunction<
  typeof tradeApi.deposit
>;

function resetStore(): void {
  act(() => {
    useTradeStore.setState({
      isLoading: false,
      trades: [],
      total: 0,
      currentTrade: null,
      errorView: null,
      lastActionErrorView: null,
    });
  });
}

describe('useTradeStore — error slot routing', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  it('writes fetchTrades failures to errorView (load slot)', async () => {
    mockList.mockRejectedValueOnce(
      new AdminApiError({
        code: NETWORK_ERROR_CODE,
        message: 'offline',
      }),
    );

    await act(async () => {
      await useTradeStore.getState().fetchTrades();
    });

    const state = useTradeStore.getState();
    // Assert on action/code, not message — the friendly copy is owned
    // by `mapAdminErrorCode` and may change without breaking tests.
    expect(state.errorView?.action).toBe('retry');
    expect(state.errorView?.code).toBe(NETWORK_ERROR_CODE);
    expect(state.lastActionErrorView).toBeNull();
  });

  it('writes confirmDelivery failures to lastActionErrorView (mutation slot)', async () => {
    mockConfirm.mockRejectedValueOnce(
      new AdminApiError({
        code: 'TRADE_INVALID_STATUS',
        message: 'cannot confirm',
        status: 400,
      }),
    );

    await act(async () => {
      await useTradeStore.getState().confirmDelivery('trade-1');
    });

    const state = useTradeStore.getState();
    expect(state.lastActionErrorView?.action).toBe('refresh');
    expect(state.lastActionErrorView?.code).toBe('TRADE_INVALID_STATUS');
    expect(state.errorView).toBeNull();
  });

  it('does NOT wipe lastActionErrorView when a follow-up fetch succeeds', async () => {
    // 1. confirmDelivery fails with TRADE_INVALID_STATUS → goes to mutation slot.
    mockConfirm.mockRejectedValueOnce(
      new AdminApiError({
        code: 'TRADE_INVALID_STATUS',
        message: 'cannot confirm',
      }),
    );
    await act(async () => {
      await useTradeStore.getState().confirmDelivery('trade-1');
    });
    expect(useTradeStore.getState().lastActionErrorView).not.toBeNull();

    // 2. Subsequent successful fetch should NOT erase the mutation banner.
    mockList.mockResolvedValueOnce({
      trades: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    await act(async () => {
      await useTradeStore.getState().fetchTrades();
    });

    expect(useTradeStore.getState().lastActionErrorView).not.toBeNull();
    expect(useTradeStore.getState().errorView).toBeNull();
  });

  it('clears both slots at the start of every action', async () => {
    // Seed stale state in both slots.
    act(() => {
      useTradeStore.setState({
        errorView: {
          title: 'stale',
          message: 'stale',
          action: 'retry',
          code: 'STALE_LOAD',
        },
        lastActionErrorView: {
          title: 'stale',
          message: 'stale',
          action: 'retry',
          code: 'STALE_ACTION',
        },
      });
    });

    mockList.mockResolvedValueOnce({
      trades: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    await act(async () => {
      await useTradeStore.getState().fetchTrades();
    });

    const state = useTradeStore.getState();
    expect(state.errorView).toBeNull();
    // Mutation slot lives across loads — only a mutation clears it.
    expect(state.lastActionErrorView?.code).toBe('STALE_ACTION');
  });

  // --- Issue #96: 404 and 403 deep-link guard tests ---
  it('fetchTrade with 404 sets errorView with go_back action (not-found state)', async () => {
    mockGet.mockRejectedValueOnce(
      new AdminApiError({
        code: 'TRADE_NOT_FOUND',
        message: 'Trade not found',
        status: 404,
      }),
    );

    await act(async () => {
      await useTradeStore.getState().fetchTrade('nonexistent-id');
    });

    const state = useTradeStore.getState();
    expect(state.errorView?.action).toBe('go_back');
    expect(state.errorView?.code).toBe('TRADE_NOT_FOUND');
    expect(state.currentTrade).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('fetchTrade with 403 sets errorView and stops the loading spinner', async () => {
    mockGet.mockRejectedValueOnce(
      new AdminApiError({
        code: 'TRADE_ACCESS_DENIED',
        message: 'Forbidden',
        status: 403,
      }),
    );

    await act(async () => {
      await useTradeStore.getState().fetchTrade('forbidden-id');
    });

    const state = useTradeStore.getState();
    expect(state.errorView?.code).toBe('TRADE_ACCESS_DENIED');
    expect(state.currentTrade).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('clearErrorView() drops both error slots', () => {
    act(() => {
      useTradeStore.setState({
        errorView: {
          title: 'a',
          message: 'a',
          action: 'retry',
          code: 'A',
        },
        lastActionErrorView: {
          title: 'b',
          message: 'b',
          action: 'refresh',
          code: 'B',
        },
      });
    });

    act(() => {
      useTradeStore.getState().clearErrorView();
    });
    expect(useTradeStore.getState().errorView).toBeNull();
    expect(useTradeStore.getState().lastActionErrorView).toBeNull();
  });

  // Locks the silent-refresh invariant added alongside fetchTrade's
  // `{ silent?: boolean }` option. Both releaseFunds and deposit chain
  // into `fetchTrade(tradeId, { silent: true })` after their mutation
  // succeeds. If the chained refresh fails, the user must NOT see a
  // misleading "load failed" banner above a successful action — the
  // failure should stay silent and `lastActionErrorView` stays clean
  // (the user's mutation succeeded) while `errorView` is never written
  // from a silent refresh.
  it('does NOT promote a failed post-action refresh (releaseFunds / deposit) to errorView', async () => {
    // Minimal currentTrade stub — only `tradeId` is needed to make the
    // `if (get().currentTrade)` gate inside releaseFunds/deposit fire
    // so the silent-refresh branch runs.
    const baseTrade = {
      tradeId: 'trade-1',
      status: 'PENDING',
    } as any;

    // ----- releaseFunds path -----
    act(() => {
      useTradeStore.setState({ currentTrade: baseTrade });
    });
    mockRelease.mockResolvedValueOnce({ unsignedXdr: 'stub-xdr' });
    mockGet.mockRejectedValueOnce(
      new AdminApiError({ code: NETWORK_ERROR_CODE, message: 'timed out' }),
    );
    await act(async () => {
      await useTradeStore.getState().releaseFunds('trade-1');
    });

    let state = useTradeStore.getState();
    expect(state.errorView).toBeNull();
    expect(state.lastActionErrorView).toBeNull();
    expect(state.isLoading).toBe(false);

    // ----- deposit path (same invariant) -----
    act(() => {
      useTradeStore.setState({ currentTrade: baseTrade });
    });
    mockDeposit.mockResolvedValueOnce({ unsignedXdr: 'stub-xdr' });
    mockGet.mockRejectedValueOnce(
      new AdminApiError({ code: NETWORK_ERROR_CODE, message: 'timed out' }),
    );
    await act(async () => {
      await useTradeStore.getState().deposit('trade-1');
    });

    state = useTradeStore.getState();
    expect(state.errorView).toBeNull();
    expect(state.lastActionErrorView).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});
