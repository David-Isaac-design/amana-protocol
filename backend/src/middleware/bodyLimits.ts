import express, { NextFunction, Request, RequestHandler, Response } from "express";

/** Default JSON / URL-encoded body limit for every route. */
export const DEFAULT_BODY_LIMIT = "100kb";

/**
 * Routes that legitimately need a larger body than the default. Matched by
 * path prefix against `req.path`; the first match wins. Keep this list short —
 * every entry widens the surface for oversized-payload abuse.
 */
export const BODY_LIMIT_OVERRIDES: ReadonlyArray<{ pattern: RegExp; limit: string }> = [
  // Evidence metadata (descriptions, CIDs, file references) on both API lanes.
  { pattern: /^(\/api\/v1)?\/(trades\/[^/]+\/)?evidence(\/|$)/, limit: "1mb" },
  // Admin batch status updates carry many trade IDs in one request.
  { pattern: /^\/admin\/trades\/batch(\/|$)/, limit: "1mb" },
];

type VerifyFn = (req: Request, res: Response, buf: Buffer, encoding: string) => void;

function buildParsers(limit: string, verify?: VerifyFn): RequestHandler[] {
  return [
    express.json({ limit, verify: verify as any }),
    express.urlencoded({ extended: true, limit }),
  ];
}

export function limitForPath(path: string): string {
  return BODY_LIMIT_OVERRIDES.find((o) => o.pattern.test(path))?.limit ?? DEFAULT_BODY_LIMIT;
}

/**
 * JSON + URL-encoded body parsers whose size limit depends on the route.
 * Payloads above the limit are rejected by body-parser with a 413, which the
 * error handler passes through as-is.
 */
export function bodyParsers(options: { verify?: VerifyFn } = {}): RequestHandler {
  const cache = new Map<string, RequestHandler[]>();
  const parsersFor = (limit: string) => {
    let parsers = cache.get(limit);
    if (!parsers) {
      parsers = buildParsers(limit, options.verify);
      cache.set(limit, parsers);
    }
    return parsers;
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const [json, urlencoded] = parsersFor(limitForPath(req.path));
    json(req, res, (err?: unknown) => {
      if (err) return next(err);
      urlencoded(req, res, next);
    });
  };
}
