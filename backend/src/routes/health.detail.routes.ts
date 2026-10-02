import { Router, Request, Response, NextFunction } from "express";
import { HealthService } from "../services/health.service";
import { appLogger } from "../middleware/logger";

/**
 * Ledger lag above this many ledgers (approximately 5 seconds each) is
 * reported as "degraded". Override with EVENT_LISTENER_LAG_THRESHOLD_LEDGERS.
 *
 * Issue #35: expose event-listener lag in the detailed health route and allow
 * operators to tune the degraded threshold without redeploying.
 */
const LAG_THRESHOLD_LEDGERS = Number(
  process.env.EVENT_LISTENER_LAG_THRESHOLD_LEDGERS ?? "100",
);

/**
 * GET /health/detail
 *
 * Returns per-service health with latency for every external dependency.
 * A single service failure degrades (not crashes) the endpoint.
 * HTTP 200 → healthy/degraded, HTTP 503 → all-down or unhandled error.
 *
 * The response now includes an `eventListener` block (issue #35) with:
 *   - lastProcessedLedger  — sequence number of the last persisted event
 *   - lagSeconds           — wall-clock seconds since that event was processed
 *   - status               — "up" | "degraded" | "down"
 */
export function createHealthDetailRouter(): Router {
    const router = Router();
    const healthService = new HealthService();

    router.get("/detail", async (req: Request, res: Response, _next: NextFunction) => {
        try {
            const result = await healthService.performHealthCheck();

            appLogger.info(
                { status: result.status, checks: result.checks },
                "Health detail check performed"
            );

            // Derive event-listener lag status
            const lagSeconds = result.details?.indexerLagSeconds ?? -1;
            const lastProcessedLedger = result.details?.lastProcessedLedger ?? null;

            // Lag threshold in seconds: use the same 5 s/ledger approximation
            const lagThresholdSeconds = LAG_THRESHOLD_LEDGERS * 5;

            let eventListenerStatus: "up" | "degraded" | "down";
            if (lagSeconds < 0) {
                // No processed events yet — listener has not started or DB is empty
                eventListenerStatus = "down";
            } else if (lagSeconds > lagThresholdSeconds) {
                eventListenerStatus = "degraded";
            } else {
                eventListenerStatus = "up";
            }

            // Elevate overall status when the event listener is behind
            let overallStatus = result.status;
            if (eventListenerStatus === "degraded" && overallStatus === "healthy") {
                overallStatus = "degraded";
            } else if (eventListenerStatus === "down" && overallStatus !== "unhealthy") {
                overallStatus = "degraded";
            }

            // Respond 503 only when fully down — degraded is still 200
            const statusCode = overallStatus === "unhealthy" ? 503 : 200;

            res.status(statusCode).json({
                status: overallStatus,
                timestamp: new Date().toISOString(),
                checks: Object.fromEntries(
                    Object.entries(result.checks).map(([service, check]) => [
                        service,
                        {
                            status: check.status,
                            latency: check.responseTime,
                            ...(check.status === "down" && check.message
                                ? { error: check.message }
                                : {}),
                        },
                    ])
                ),
                eventListener: {
                    status: eventListenerStatus,
                    lastProcessedLedger,
                    lagSeconds: lagSeconds >= 0 ? lagSeconds : null,
                    lagThresholdSeconds,
                },
            });
        } catch (error) {
            appLogger.error({ error }, "Health detail check failed");
            res.status(503).json({
                status: "down",
                timestamp: new Date().toISOString(),
                error: "Health detail check failed",
            });
        }
    });

    return router;
}
