import { createQueryString, request } from "./client";
import type { DisputeListResponse } from "./types";

export const disputesApi = {
  list: (
    token: string,
    params?: {
      status?: string;
      /** Cursor-based: pass the last item's id from the previous page. */
      cursor?: number;
      limit?: number;
      sortBy?: "age" | "amount";
      sortDir?: "asc" | "desc";
      /** Legacy offset-based page (kept for backward-compat with backend). */
      page?: number;
    },
  ) =>
    request<DisputeListResponse>(
      `/disputes${createQueryString({
        status: params?.status,
        cursor: params?.cursor,
        limit: params?.limit,
        sortBy: params?.sortBy,
        sortDir: params?.sortDir,
        page: params?.page,
      })}`,
      { token },
    ),
};