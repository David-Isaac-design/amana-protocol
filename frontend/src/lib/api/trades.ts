import { createQueryString, request, withIdempotency, ApiError } from "./client";
import { getApiBaseUrl, getApiVersionPrefix } from "./env";
import type {
  CreateTradeRequest,
  CreateTradeResponse,
  DepositResponse,
  EvidenceResponse,
  SubmitManifestRequest,
  SubmitManifestResponse,
  TradeHistoryResponse,
  TradeListResponse,
  TradeResponse,
  TradeStatsResponse,
} from "./types";

export type ExportFormat = "csv" | "json";

export interface ExportTradesParams {
  format: ExportFormat;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export const tradesApi = {
  list: (token: string, params?: { status?: string; page?: number; limit?: number }) =>
    request<TradeListResponse>(
      `/trades${createQueryString({
        status: params?.status,
        page: params?.page,
        limit: params?.limit,
      })}`,
      { token },
    ),

  get: (token: string, id: string) =>
    request<TradeResponse>(`/trades/${id}`, { token }),

  getHistory: (token: string, id: string) =>
    request<TradeHistoryResponse>(`/trades/${id}/history`, { token }),

  getEvidence: (token: string, id: string) =>
    request<EvidenceResponse>(`/trades/${id}/evidence`, { token }),

  submitManifest: (token: string, tradeId: string, data: SubmitManifestRequest) =>
    request<SubmitManifestResponse>(`/trades/${tradeId}/manifest`, {
      method: "POST",
      token,
      body: JSON.stringify(data),
    }),

  getStats: (token: string) =>
    request<TradeStatsResponse>("/trades/stats", { token }),

  create: (token: string, data: CreateTradeRequest, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<CreateTradeResponse>("/trades", {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
      body: JSON.stringify(data),
    }),

  deposit: (token: string, tradeId: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<DepositResponse>(`/trades/${tradeId}/deposit`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
    }),

  confirmDelivery: (token: string, tradeId: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/confirm`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
    }),

  releaseFunds: (token: string, tradeId: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/release`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
    }),

  initiateDispute: (token: string, tradeId: string, reason: string, category: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/dispute`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
      body: JSON.stringify({ reason, category }),
    }),

  /**
   * Download a trades export from /trades/export.
   * Returns a Blob so the caller can trigger a browser download.
   * CSV exports get the UTF-8 BOM that the backend prepends. (#72)
   */
  exportTrades: async (token: string, params: ExportTradesParams): Promise<Blob> => {
    const qs = createQueryString({
      format: params.format,
      status: params.status,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
    const base = getApiBaseUrl();
    const prefix = getApiVersionPrefix();
    const url = `${base}${prefix}/trades/export${qs}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: params.format === "csv" ? "text/csv" : "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new ApiError(response.status, text);
    }

    return response.blob();
  },
};
