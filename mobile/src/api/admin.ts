import apiClient from './client';

/**
 * Shape mirrors `backend/src/services/adminStreams.service.ts`.
 * Backend returns `{ items: AdminStreamSummary[], pagination }`.
 */
export interface AdminStreamSummary {
  streamId: string;
  recipient: string;
  status: string;
  vestingState: 'not_started' | 'vesting' | 'fully_vested';
  totalVested: string;
  claimed: string;
  unclaimed: string;
  pendingClawback: string;
  adminTags: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminStreamListResult {
  items: AdminStreamSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ClawbackPreviewResult {
  streamId: string;
  remainingVested: string;
  requestedClawback: string;
  postClawbackBalance: string;
  preview: true;
  timestamp: string;
}

// --- admin.trades.batch.status ---
// `TradeStatus` mirrors `@prisma/client` so the dropdown matches the
// backend's `VALID_TRANSITIONS` table. The canonical definition lives
// in `../constants/admin` so test setups can `jest.requireActual` the
// value without re-declaring it inside the mock factory for this
// module (which used to drift whenever statuses were added/removed).
//
// `import` brings `TradeStatus` into the local module scope so the
// `BatchTradeUpdate` interface below can reference it; the separate
// `export` re-export keeps the public API of this module unchanged for
// any caller still doing `import { TradeStatus } from '../api/admin'`.
import { TradeStatus, TRADE_STATUSES } from '../constants/admin';
export { TRADE_STATUSES };
export type { TradeStatus };

export interface BatchTradeUpdate {
  tradeId: string;
  status: TradeStatus;
}

export interface BatchTradeUpdateResult {
  succeeded: string[];
  failed: { tradeId: string; reason: string }[];
}

// --- admin.contract ---
// All contract routes return an unsigned XDR the admin must sign with
// their Stellar wallet (typically Freighter). Mobile rendering is left
// to callers; adminApi here just calls the backend.
export interface ContractTxResult {
  unsignedXdr: string;
}

export interface TxStatusResult {
  status: 'success' | 'failed' | 'pending';
}

const HORIZON_URL =
  process.env.EXPO_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';

// --- admin.features ---
export interface FeatureFlag {
  enabled: boolean;
  rolloutPercentage?: number;
}

export interface FeatureFlagListResult {
  flags: Record<string, FeatureFlag>;
}

export interface FeatureFlagSetResult {
  name: string;
  flag: FeatureFlag;
}

export interface AdminAuditRecord {
  id: number;
  action: string;
  actorAddress: string;
  targetReference: string | null;
  note: string | null;
  createdAt: string;
}

export interface AdminAuditListResult {
  items: AdminAuditRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const adminApi = {
  async listStreams(params?: {
    page?: number;
    limit?: number;
    status?: string;
    vestingState?: 'not_started' | 'vesting' | 'fully_vested';
    adminTag?: string;
  }): Promise<AdminStreamListResult> {
    const response = await apiClient.get('/admin/streams', { params });
    return response.data;
  },

  async getStream(streamId: string): Promise<AdminStreamSummary> {
    const response = await apiClient.get(`/admin/streams/${streamId}`);
    return response.data;
  },

  async lockStream(
    streamId: string,
    reason?: string,
  ): Promise<{ streamId: string; locked: true; reason?: string }> {
    const response = await apiClient.post(
      `/admin/streams/${streamId}/lock`,
      { reason },
    );
    return response.data;
  },

  async unlockStream(
    streamId: string,
    reason?: string,
  ): Promise<{ streamId: string; locked: false; reason?: string }> {
    const response = await apiClient.post(
      `/admin/streams/${streamId}/unlock`,
      { reason },
    );
    return response.data;
  },

  async suspendStream(
    streamId: string,
    reason?: string,
  ): Promise<{ streamId: string; status: string; reason?: string }> {
    const response = await apiClient.post(
      `/admin/streams/${streamId}/suspend`,
      { reason },
    );
    return response.data;
  },

  async resumeStream(
    streamId: string,
    note?: string,
  ): Promise<{ streamId: string; status: string; note?: string }> {
    const response = await apiClient.post(
      `/admin/streams/${streamId}/resume`,
      { note },
    );
    return response.data;
  },

  async terminateStream(
    streamId: string,
    options?: { reason?: string; unsignedTxXdr?: string },
  ): Promise<unknown> {
    const response = await apiClient.post(
      `/admin/streams/${streamId}/terminate`,
      options ?? {},
    );
    return response.data;
  },

  async previewClawback(
    streamId: string,
    amount: string,
  ): Promise<ClawbackPreviewResult> {
    const response = await apiClient.post(
      `/admin/streams/${streamId}/clawback/preview`,
      { amount },
    );
    return response.data;
  },

  // --- admin.trades.batch.status ---
  async updateTradeStatusesBatch(
    updates: BatchTradeUpdate[],
  ): Promise<BatchTradeUpdateResult> {
    const response = await apiClient.post('/admin/trades/batch/status', {
      updates,
    });
    return response.data;
  },

  // --- admin.contract ---
  async addMediator(mediatorAddress: string): Promise<ContractTxResult> {
    const response = await apiClient.post('/admin/contract/mediators', {
      mediatorAddress,
    });
    return response.data;
  },

  async removeMediator(mediatorAddress: string): Promise<ContractTxResult> {
    const response = await apiClient.delete(
      `/admin/contract/mediators/${mediatorAddress}`,
    );
    return response.data;
  },

  async updateContractFeeBps(feeBps: number): Promise<ContractTxResult> {
    const response = await apiClient.patch('/admin/contract/fee', { feeBps });
    return response.data;
  },

  async submitSignedXdr(signedXdr: string): Promise<{ hash: string }> {
    const response = await fetch(`${HORIZON_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(signedXdr)}`,
    });
    if (!response.ok) {
      throw new Error(`Transaction submission failed (${response.status})`);
    }
    const data = (await response.json()) as { hash: string };
    return { hash: data.hash };
  },

  async getTxStatus(hash: string): Promise<TxStatusResult> {
    try {
      const response = await apiClient.get(`/stellar/tx/${hash}/status`);
      return response.data;
    } catch (error: unknown) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) {
        return { status: 'pending' };
      }
      throw error;
    }
  },

  // --- admin.features ---
  async listFeatureFlags(): Promise<FeatureFlagListResult> {
    const response = await apiClient.get('/admin/features');
    return response.data;
  },

  async setFeatureFlag(
    name: string,
    opts: { enabled: boolean; rolloutPercentage?: number },
  ): Promise<FeatureFlagSetResult> {
    const response = await apiClient.patch(
      `/admin/features/${name}`,
      opts,
    );
    return response.data;
  },

  async getAuditTrail(
    params?: { page?: number; limit?: number },
  ): Promise<AdminAuditListResult> {
    const response = await apiClient.get('/api/admin/audit', { params });
    return response.data;
  },
};
