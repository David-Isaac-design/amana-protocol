import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import { adminErrorResponseErrorInterceptor } from './errorInterceptor';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Version prefix prepended to consumer-facing API paths.
 *
 * Defaults to `/api/v1` — the stable, versioned backend lane. Set
 * `EXPO_PUBLIC_API_VERSION_PREFIX=` (empty) to fall back to the legacy
 * unversioned aliases (deprecated, but still served with Deprecation/Sunset
 * headers). The backend serves both lanes, so reverting is a config-only
 * change.
 */
const API_VERSION_PREFIX =
  process.env.EXPO_PUBLIC_API_VERSION_PREFIX ?? '/api/v1';

/** Admin (/admin, /api/admin) and health endpoints are never versioned. */
const UNVERSIONED_PREFIXES = ['/admin', '/api/admin', '/health'];

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

// Add token to requests
apiClient.interceptors.request.use((config) => {
  // Token would be added here from secure store if needed
  return config;
});

// Inject the API version prefix centrally for consumer-facing routes. Admin
// and health routes are excluded so they keep hitting the legacy paths.
apiClient.interceptors.request.use((config) => {
  const url = config.url ?? '';
  const isUnversioned =
    UNVERSIONED_PREFIXES.some(
      (p) => url === p || url.startsWith(`${p}/`),
    ) || /^https?:\/\//.test(url);

  if (!isUnversioned && !url.startsWith('/api/v')) {
    config.url = `${API_VERSION_PREFIX}${url}`;
  }
  return config;
});

/**
 * Refresh-token flow.
 *
 * On a 401 we attempt to refresh the access token exactly once and replay the
 * original request. Concurrent 401s share a single in-flight refresh promise
 * so we never fire multiple refresh calls; each queued request is replayed
 * once the refresh resolves. If the refresh fails we clear the auth state
 * (log the user out) and reject the queued requests.
 *
 * The refresh/logout hooks are injected by the auth store to avoid a circular
 * import between the store and the API client.
 */
type RefreshHandler = () => Promise<string | null>;
type LogoutHandler = () => void | Promise<void>;

let refreshHandler: RefreshHandler | null = null;
let logoutHandler: LogoutHandler | null = null;
let refreshPromise: Promise<string | null> | null = null;

/** Register the auth store's refresh + logout callbacks. */
export function setAuthRefreshHandlers(handlers: {
  refresh: RefreshHandler;
  logout: LogoutHandler;
}): void {
  refreshHandler = handlers.refresh;
  logoutHandler = handlers.logout;
}

/** Reset the in-flight refresh state (used by tests). */
export function resetAuthRefreshState(): void {
  refreshPromise = null;
}

interface RetryableConfig extends AxiosRequestConfig {
  _retry?: boolean;
}

function isUnauthorized(error: AxiosError): boolean {
  return error.response?.status === 401;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshHandler) {
    return null;
  }
  if (!refreshPromise) {
    refreshPromise = refreshHandler().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function handleUnauthorized(error: AxiosError): Promise<unknown> {
  const config = error.config as RetryableConfig | undefined;

  // Only retry once, and never retry the refresh call itself.
  if (!config || config._retry || !refreshHandler) {
    return Promise.reject(error);
  }

  config._retry = true;

  let token: string | null = null;
  try {
    token = await refreshAccessToken();
  } catch {
    token = null;
  }

  if (!token) {
    if (logoutHandler) {
      await logoutHandler();
    }
    return Promise.reject(error);
  }

  config.headers = {
    ...(config.headers ?? {}),
    Authorization: `Bearer ${token}`,
  };

  return apiClient.request(config);
}

// Map backend admin errors into typed AdminApiError instances so screens
// and stores don't have to handle raw AxiosErrors.
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (isUnauthorized(error)) {
      return handleUnauthorized(error);
    }
    return adminErrorResponseErrorInterceptor(error);
  },
);

export default apiClient;
