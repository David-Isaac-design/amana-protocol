import { createHash } from "crypto";
import { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { appLogger } from "./logger";
import { alertService } from "../services/alert.service";

function bodyHash(body: unknown): string {
  const normalized = JSON.stringify(body ?? null);
  return createHash("sha256").update(normalized).digest("hex");
}

const IDEMPOTENCY_TTL = 60 * 60 * 24; // 24 hours
const IDEMPOTENCY_LOCK_TTL = 30; // 30 seconds
/** Seconds a client should wait before retrying a request that is still in flight. */
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 1;

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const key = req.headers["idempotency-key"] as string;

  if (!key) {
    return next();
  }

  // Only apply to mutations (POST, PUT, PATCH, DELETE)
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const cacheKey = `idempotency:${req.method}:${req.path}:${key}`;
  const lockKey = `idempotency:lock:${req.method}:${req.path}:${key}`;

  try {
    const cachedResponse = await redis.get(cacheKey);

    if (cachedResponse) {
      appLogger.info({ key, path: req.path }, "Idempotency cache hit");
      const { status, body, headers, requestBodyHash } = JSON.parse(cachedResponse);

      // 409 if same key but different request body
      if (requestBodyHash !== undefined && requestBodyHash !== bodyHash(req.body)) {
        return res.status(409).json({
          error: "Idempotency key already used with a different request body",
        });
      }

      // Set cached headers
      Object.entries(headers).forEach(([k, v]) => {
        res.setHeader(k, v as string);
      });
      res.setHeader("X-Idempotency-Cache", "HIT");

      return res.status(status).json(body);
    }

    const lock = await redis.set(lockKey, "1", "NX", "EX", IDEMPOTENCY_LOCK_TTL);

    if (lock !== "OK") {
      // The first request may have finished between our cache read and the lock attempt.
      const replayResponse = await redis.get(cacheKey);
      if (replayResponse) {
        appLogger.info({ key, path: req.path }, "Idempotency replay after in-flight request");
        const { status, body, headers } = JSON.parse(replayResponse);

        Object.entries(headers).forEach(([k, v]) => {
          res.setHeader(k, v as string);
        });
        res.setHeader("X-Idempotency-Cache", "HIT");

        return res.status(status).json(body);
      }

      appLogger.info({ key, path: req.path }, "Idempotency duplicate rejected while in flight");
      res.setHeader("X-Idempotency-Cache", "IN_PROGRESS");
      res.setHeader("Retry-After", String(IDEMPOTENCY_RETRY_AFTER_SECONDS));
      return res.status(409).json({
        error: "Request with this idempotency key is already in progress",
      });
    }

    let lockReleased = false;
    const releaseLock = () => {
      if (lockReleased) {
        return;
      }
      lockReleased = true;
      redis.del(lockKey).catch((err) =>
        appLogger.error({ err, key }, "Failed to release idempotency lock"),
      );
    };

    res.once("finish", releaseLock);
    res.once("close", releaseLock);

    // Intercept res.json and res.send to cache successful responses regardless of Express helper used.
    const originalJson = res.json.bind(res);
    const originalSend = (res.send as any)?.bind(res);

    const cacheResponse = (body: any) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const responseData = {
          status: res.statusCode,
          body,
          headers: res.getHeaders(),
          requestBodyHash: bodyHash(req.body),
        };
        redis.set(cacheKey, JSON.stringify(responseData), "EX", IDEMPOTENCY_TTL)
          .catch(err => appLogger.error({ err }, "Failed to cache idempotent response"));
      }
    };

    res.json = (body: any) => {
      cacheResponse(body);
      return originalJson(body);
    };

    if (typeof originalSend === "function") {
      res.send = (body: any) => {
        cacheResponse(body);
        return originalSend(body);
      };
    }

    next();
  } catch (error) {
    appLogger.error({ error, key }, "Idempotency middleware error");
    void alertService.dispatch(
      "cache_unavailable",
      "Idempotency cache unavailable; proceeding without idempotency protection",
      {
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    );
    next(); // Proceed without idempotency if Redis fails
  }
};
