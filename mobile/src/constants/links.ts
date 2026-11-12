import type { RootStackParamList } from '../types/navigation';

/**
 * Shared deep-link constants (issue #261).
 *
 * One place that maps a canonical path (`/trades/:id`) to a navigator screen
 * and back to a public web URL. The web app mirrors this in
 * `frontend/src/lib/links.ts` — keep the two in sync (the path table below is
 * the contract).
 */

export const APP_SCHEME = 'amanavault';
export const WEB_ORIGIN = 'https://example.com';

/** Hosts we accept universal / app links from. */
export const LINK_PREFIXES = [`${APP_SCHEME}://`, `${WEB_ORIGIN}`, 'https://www.example.com'];

export interface DeepLinkTarget {
  screen: keyof RootStackParamList;
  params?: Record<string, string>;
}

/** Screens reachable without authentication. Everything else defers to login. */
export const PUBLIC_SCREENS: ReadonlySet<keyof RootStackParamList> = new Set(['WalletConnect']);

interface Route {
  /** react-navigation linking `path` (relative, no leading slash). */
  path: string;
  screen: keyof RootStackParamList;
  match: RegExp;
  toParams: (m: RegExpMatchArray) => Record<string, string>;
  toWebPath: (params: Record<string, string>) => string;
}

const ROUTES: Route[] = [
  {
    path: 'trades/:tradeId',
    screen: 'TradeDetail',
    match: /^\/?trades\/([^/?#]+)\/?$/,
    toParams: (m) => ({ tradeId: decodeURIComponent(m[1]) }),
    toWebPath: (p) => `/trades/${encodeURIComponent(p.tradeId)}`,
  },
  {
    path: 'disputes/:id',
    screen: 'DisputeDetail',
    match: /^\/?disputes\/([^/?#]+)\/?$/,
    toParams: (m) => ({ id: decodeURIComponent(m[1]) }),
    toWebPath: (p) => `/disputes/${encodeURIComponent(p.id)}`,
  },
  {
    path: 'trades/:tradeId/evidence',
    screen: 'EvidenceCapture',
    match: /^\/?(?:trades\/([^/?#]+)\/evidence|evidence\/([^/?#]+))\/?$/,
    toParams: (m) => ({ tradeId: decodeURIComponent(m[1] ?? m[2]) }),
    toWebPath: (p) => `/trades/${encodeURIComponent(p.tradeId)}/evidence`,
  },
  {
    path: 'trades',
    screen: 'TradeList',
    match: /^\/?trades\/?$/,
    toParams: () => ({}),
    toWebPath: () => `/trades`,
  },
  {
    path: 'create-trade',
    screen: 'CreateTrade',
    match: /^\/?create-trade\/?$/,
    toParams: () => ({}),
    toWebPath: () => `/trades/create`,
  },
];

/** react-navigation `linking.config.screens` map. */
export const LINKING_SCREEN_CONFIG: Partial<Record<keyof RootStackParamList, string>> = ROUTES.reduce(
  (acc, r) => ({ ...acc, [r.screen]: r.path }),
  { WalletConnect: 'connect', VaultDashboard: 'vault' },
);

/**
 * Parse an incoming URL or bare path into a navigation target.
 * Returns `null` for anything unrecognised or malformed — callers must handle
 * that gracefully (see AppNavigator / useDeepLink).
 */
export function parseDeepLink(input: string | null | undefined): DeepLinkTarget | null {
  if (!input || typeof input !== 'string') return null;

  let pathname: string;
  try {
    if (input.includes('://')) {
      const url = new URL(input);
      // custom scheme: amanavault://trades/123  -> host="trades", pathname="/123"
      pathname = url.protocol === `${APP_SCHEME}:` ? `/${url.host}${url.pathname}` : url.pathname;
    } else {
      pathname = input.startsWith('/') ? input : `/${input}`;
    }
  } catch {
    return null;
  }

  pathname = pathname.replace(/\/{2,}/g, '/');

  for (const route of ROUTES) {
    const m = pathname.match(route.match);
    if (m) {
      const params = route.toParams(m);
      // reject empty / obviously bad ids
      if (Object.values(params).some((v) => v === '' || v === 'undefined' || v === 'null')) {
        return null;
      }
      return { screen: route.screen, params: Object.keys(params).length ? params : undefined };
    }
  }
  return null;
}

/** Map a navigation target to the public web URL (for "share" / fallback). */
export function webUrlFor(target: DeepLinkTarget): string {
  const route = ROUTES.find((r) => r.screen === target.screen);
  if (!route) return WEB_ORIGIN;
  return `${WEB_ORIGIN}${route.toWebPath(target.params ?? {})}`;
}

export function requiresAuth(target: DeepLinkTarget): boolean {
  return !PUBLIC_SCREENS.has(target.screen);
}
