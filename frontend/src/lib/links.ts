/**
 * Web <-> mobile deep-link mapping (issue #261).
 *
 * Mirror of `mobile/src/constants/links.ts`. The web app owns the canonical
 * URLs; the mobile app claims `/trades/*` and `/disputes/*` via universal /
 * app links (see frontend/public/.well-known/*). Keep the two tables in sync.
 */

export const APP_SCHEME = "amanavault";
export const WEB_ORIGIN = "https://example.com";

export type DeepLinkScreen =
  | "TradeDetail"
  | "DisputeDetail"
  | "EvidenceCapture"
  | "TradeList"
  | "CreateTrade";

interface LinkRoute {
  screen: DeepLinkScreen;
  /** Web path matcher. */
  match: RegExp;
  /** Build the custom-scheme URL the mobile app understands. */
  toAppUrl: (params: Record<string, string>) => string;
  toParams: (m: RegExpMatchArray) => Record<string, string>;
}

const ROUTES: LinkRoute[] = [
  {
    screen: "TradeDetail",
    match: /^\/trades\/([^/?#]+)\/?$/,
    toParams: (m) => ({ tradeId: decodeURIComponent(m[1]) }),
    toAppUrl: (p) => `${APP_SCHEME}://trades/${encodeURIComponent(p.tradeId)}`,
  },
  {
    screen: "DisputeDetail",
    match: /^\/disputes\/([^/?#]+)\/?$/,
    toParams: (m) => ({ id: decodeURIComponent(m[1]) }),
    toAppUrl: (p) => `${APP_SCHEME}://disputes/${encodeURIComponent(p.id)}`,
  },
  {
    screen: "EvidenceCapture",
    match: /^\/trades\/([^/?#]+)\/evidence\/?$/,
    toParams: (m) => ({ tradeId: decodeURIComponent(m[1]) }),
    toAppUrl: (p) => `${APP_SCHEME}://evidence/${encodeURIComponent(p.tradeId)}`,
  },
  {
    screen: "TradeList",
    match: /^\/trades\/?$/,
    toParams: () => ({}),
    toAppUrl: () => `${APP_SCHEME}://trades`,
  },
];

/** Web URL for a trade, used for share links and the "open in app" affordance. */
export function webUrlForTrade(tradeId: string): string {
  return `${WEB_ORIGIN}/trades/${encodeURIComponent(tradeId)}`;
}

/** Deep (custom-scheme) URL for the current web path, or null if not mappable. */
export function appUrlForPath(pathname: string): string | null {
  for (const route of ROUTES) {
    const m = pathname.match(route.match);
    if (m) return route.toAppUrl(route.toParams(m));
  }
  return null;
}

/** Which app screen a web path corresponds to (null = not a deep-linkable page). */
export function screenForPath(pathname: string): DeepLinkScreen | null {
  return ROUTES.find((r) => r.match.test(pathname))?.screen ?? null;
}
