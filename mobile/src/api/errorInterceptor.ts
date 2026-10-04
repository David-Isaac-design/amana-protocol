import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import {
  AdminApiError,
  AdminErrorView,
  RawBackendErrorBody,
} from './errors';
import { buildAdminApiError, mapAdminErrorCode } from './adminErrorMap';

/**
 * Network-failure error codes we synthesise when the backend never
 * responded. These are not in the backend enum — they're a mobile-only
 * convenience so maps and views stay uniform.
 */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
export const TIMEOUT_ERROR_CODE = 'TIMEOUT_ERROR';
export const UNKNOWN_ERROR_CODE = 'UNKNOWN';

/**
 * Axios response error interceptor that converts an `AxiosError` into a
 * typed `AdminApiError`. Exported so it can be unit-tested directly
 * without spinning up the full axios instance.
 *
 * Behavior:
 *  - HTTP 401/403 → preserves the backend `code` and sanitizes the
 *    message. Falls back to a friendly AUTH_ERROR message when the
 *    backend didn't supply a specific code.
 *  - HTTP 429 → reads `Retry-After` and maps to `wait_then_retry`.
 *  - HTTP error + parsed backend `{code,message,details,...}` → mapped
 *    admin error view.
 *  - No response (network error / offline / CORS) → `NETWORK_ERROR`
 *    offline-friendly map with `retry` action.
 *  - Timeout (`ECONNABORTED`) → `TIMEOUT_ERROR` mapped view.
 *  - Anything else → generic `INTERNAL_ERROR` mapping.
 */
export function adminErrorResponseErrorInterceptor(
  error: AxiosError<RawBackendErrorBody>,
): Promise<never> {
  const status = error.response?.status;
  const body: RawBackendErrorBody | undefined = error.response?.data;
  const fallback = error.message || 'Request failed';

  // --- Network / timeout (no response) ---
  if (!error.response) {
    const isTimeout =
      error.code === 'ECONNABORTED' || /timeout/i.test(error.message);
    const apiError = buildAdminApiError(
      {
        code: isTimeout ? TIMEOUT_ERROR_CODE : NETWORK_ERROR_CODE,
        message: isTimeout
          ? 'The request timed out. Check your connection and try again.'
          : "You appear to be offline. Check your connection and try again.",
        details: { axiosCode: error.code, message: error.message },
      },
      undefined,
      fallback,
    );
    return Promise.reject(apiError);
  }

  // --- HTTP 401/403 → preserve backend code, sanitize the message ---
  // Spread the original body first so requestId / correlationId / path
  // flow through `buildAdminApiError`; then overlay code + message
  // only when we don't already have a specific backend code (so e.g.
  // `TRADE_ACCESS_DENIED` keeps its original code).
  if (status === 401 || status === 403) {
    const originalCode = body?.code;
    return Promise.reject(
      buildAdminApiError(
        {
          ...(body ?? {}),
          code: originalCode ?? 'AUTH_ERROR',
          message:
            originalCode
              ? body?.message ?? 'Access denied for this action.'
              : status === 401
                ? 'Your session expired. Sign in again to continue.'
                : "Your account doesn't have permission for this admin action.",
        },
        status,
        'Access denied for this action.',
      ),
    );
  }

  // --- HTTP 429 → wait_then_retry with Retry-After / quota seconds ---
  if (status === 429) {
    const retryAfterSeconds =
      pickRetryAfterFromDetails(body?.details) ??
      parseRetryAfterHeader(error.response.headers['retry-after']);
    const apiError = buildAdminApiError(
      {
        ...(body ?? {}),
        code: body?.code ?? 'RATE_LIMIT_EXCEEDED',
        message:
          body?.message ??
          (retryAfterSeconds
            ? `Too many requests. Try again in ${formatRetryAfter(retryAfterSeconds)}.`
            : 'Too many requests. Wait a moment and try again.'),
        ...(retryAfterSeconds
          ? { details: { ...(body?.details ?? {}), retryAfterSeconds } }
          : {}),
      },
      status,
      'Too many requests.',
    );
    return Promise.reject(apiError);
  }

  // --- Standard structured backend error (most admin paths) ---
  if (body && typeof body.code === 'string') {
    return Promise.reject(buildAdminApiError(body, status, fallback));
  }

  // --- Unknown shape — synthesize a generic internal error ---
  return Promise.reject(
    buildAdminApiError(
      {
        code: UNKNOWN_ERROR_CODE,
        message:
          status && status >= 500
            ? 'The server hit an unexpected error. Try again in a moment.'
            : 'The request could not be completed. Try again.',
      },
      status,
      fallback,
    ),
  );
}

/**
 * Produce the render-ready `AdminErrorView` for any caught error.
 * The mapper (`mapAdminErrorCode`) is the single source of truth for
 * friendly title / message / action; this function only stitches in the
 * cross-cutting bits: requestId propagation and a stable fallback for
 * non-`AdminApiError` throws (e.g. raw strings, plain Error objects).
 */
export function viewForError(error: unknown): AdminErrorView {
  if (error instanceof AdminApiError) {
    const view = mapAdminErrorCode(error.code, error.retryAfterSeconds);
    return {
      title: view.title,
      message: view.message,
      action: view.action,
      code: view.code,
      ...(view.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: view.retryAfterSeconds }
        : {}),
      ...(error.requestId ? { requestId: error.requestId } : {}),
    };
  }

  // Non-AdminApiError — synthesize a generic retryable fallback.
  const fallbackView = mapAdminErrorCode('INTERNAL_ERROR');
  return {
    title: fallbackView.title,
    message:
      error instanceof Error && error.message
        ? error.message
        : 'Something went wrong. Try again.',
    action: 'retry',
    code: UNKNOWN_ERROR_CODE,
  };
}

/** Format a wait interval as human-friendly relative time. */
export function formatRetryAfter(seconds: number): string {
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Callbacks the refresh-token interceptor needs from the auth layer.
 * Kept as a plain object so the interceptor stays decoupled from the
 * concrete auth store implementation and is trivial to unit-test.
 */
export interface RefreshTokenHandlers {
  /** Attempt to refresh the access token. Resolve on success, reject on failure. */
  refresh: () => Promise<void>;
  /** Clear auth state and send the user back to sign-in. */
  logout: () => void;
}

/** Marker set on a request config once it has already been retried. */
interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * Attach an automatic refresh-token flow to an axios instance.
 *
 * On a 401 response the interceptor:
 *  1. Refreshes the access token exactly once (concurrent 401s share a
 *     single in-flight refresh promise).
 *  2. Replays the original request with the refreshed credentials.
 *  3. Logs the user out if the refresh fails, or if the retried request
 *     still comes back 401 (avoids infinite retry loops).
 *
 * Non-401 errors and already-retried requests fall through to the
 * existing `adminErrorResponseErrorInterceptor` so error mapping is
 * unchanged.
 */
export function attachRefreshTokenInterceptor(
  instance: AxiosInstance,
  handlers: RefreshTokenHandlers,
): void {
  let refreshPromise: Promise<void> | null = null;

  const runRefresh = (): Promise<void> => {
    if (!refreshPromise) {
      refreshPromise = handlers.refresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  };

  instance.interceptors.response.use(undefined, (error: AxiosError) => {
    const config = error.config as RetriableRequestConfig | undefined;
    const status = error.response?.status;

    if (status !== 401 || !config || config._retry) {
      return adminErrorResponseErrorInterceptor(error);
    }

    config._retry = true;

    return runRefresh()
      .then(() => instance.request(config))
      .catch((refreshError: unknown) => {
        handlers.logout();
        return adminErrorResponseErrorInterceptor(error);
      });
  });
}

function parseRetryAfterHeader(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  // RFC 7231 HTTP-date form (Retry-After: Wed, 21 Oct 2015 07:28:00 GMT).
  const ts = Date.parse(value);
  if (Number.isFinite(ts)) {
    return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
  }
  return undefined;
}

function pickRetryAfterFromDetails(
  details: Record<string, unknown> | undefined,
): number | undefined {
  if (!details) return undefined;
  for (const key of ['retryAfterSeconds', 'retryAfter', 'retry_after']) {
    const v = details[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      return Math.ceil(v);
    }
  }
  return undefined;
}
