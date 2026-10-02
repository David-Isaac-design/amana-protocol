import { getApiBaseUrl, getApiVersionPrefix } from "./env";
import { trackApiFailure } from "@/lib/analytics";
import { parseBackendError, BackendErrorResponse } from "../errorHandler";
import { z } from "zod";

export type FetchOptions = RequestInit & {
  token?: string | null;
  skipAuth?: boolean;
};

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

export class ApiError extends Error {
  status: number;
  data: unknown;
  backendError?: BackendErrorResponse | null;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.backendError = parseBackendError(this);
  }
}

const TOKEN_STORAGE_KEY = "amana_jwt";

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export const navigationHelpers = {
  reload(): void {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  },
};

function createHeaders(
  headers?: HeadersInit,
  token?: string | null,
): Record<string, string> {
  const resolvedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      resolvedHeaders[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      resolvedHeaders[key] = value;
    }
  } else if (headers) {
    Object.assign(resolvedHeaders, headers);
  }

  if (token) {
    resolvedHeaders.Authorization = `Bearer ${token}`;
  }

  // Idempotency: if caller passes Idempotency-Key header via headers param, preserve it
  // Otherwise, caller should use withIdempotency wrapper. We do not auto-generate here to avoid
  // leaking keys for idempotent GETs.
  return resolvedHeaders;
}

/**
 * Helper to build headers with idempotency + correlation IDs (unified toast contract).
 * Use for mutations that require exactly-once semantics and toast correlation.
 */
export function withIdempotency(headers?: HeadersInit, opts?: { idempotencyKey?: string; correlationId?: string }): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((v, k) => { out[k] = v; });
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
  } else if (headers) Object.assign(out, headers as Record<string, string>);
  if (opts?.idempotencyKey) out["Idempotency-Key"] = opts.idempotencyKey;
  if (opts?.correlationId) {
    out["X-Correlation-Id"] = opts.correlationId;
    out["X-Request-Id"] = opts.correlationId;
  }
  return out;
}

export function createQueryString(
  params?: Record<string, string | number | undefined>,
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

/**
 * Consumer-facing endpoints are versioned under `/api/v1` on the backend. The
 * version prefix is injected here (centrally) so individual API modules don't
 * each hardcode a version — switching versions is a single env toggle.
 *
 * Admin (/admin, /api/admin) and infrastructure (/health*) endpoints are
 * intentionally excluded: they are unversioned internal/ops routes and must
 * keep hitting the legacy paths regardless of the version prefix config.
 */
export function resolveApiUrl(endpoint: string): string {
  const isUnversioned =
    endpoint.startsWith("/admin") ||
    endpoint.startsWith("/api/admin") ||
    endpoint.startsWith("/health");

  return isUnversioned
    ? `${getApiBaseUrl()}${endpoint}`
    : `${getApiBaseUrl()}${getApiVersionPrefix()}${endpoint}`;
}

export async function request<T>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const { token, skipAuth, headers, ...fetchOptions } = options;

  const authToken = token ?? (!skipAuth ? getStoredToken() : null);

  try {
    const response = await fetch(resolveApiUrl(endpoint), {
      ...fetchOptions,
      headers: createHeaders(headers, authToken),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      trackApiFailure(endpoint, response.status, {
        method: fetchOptions.method ?? "GET",
      });
      throw new ApiError(
        response.status,
        // Backend AppError payloads use `message` (e.g. the pilot trade cap, #127); older routes use `error`.
        (data as { error?: string; message?: string })?.error ||
          (data as { message?: string })?.message ||
          response.statusText,
        data,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    trackApiFailure(endpoint, 0, {
      method: fetchOptions.method ?? "GET",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw new ApiError(
      0,
      error instanceof Error ? error.message : "Network error",
    );
  }
}

export async function requestWithResult<T>(
  endpoint: string,
  schema?: z.ZodSchema<T>,
  options: FetchOptions = {},
): Promise<ApiResult<T>> {
  try {
    const data = await request<T>(endpoint, options);

    if (schema) {
      const validationResult = schema.safeParse(data);
      if (!validationResult.success) {
        throw new ApiError(
          500,
          "Response validation failed",
          validationResult.error,
        );
      }
      return { success: true, data: validationResult.data };
    }

    return { success: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        const storedToken = getStoredToken();
        if (storedToken) {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY);
          navigationHelpers.reload();
        }
      }
      return { success: false, error };
    }
    return {
      success: false,
      error: new ApiError(
        0,
        error instanceof Error ? error.message : "Unknown error",
      ),
    };
  }
}
