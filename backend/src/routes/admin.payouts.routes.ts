import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { appLogger } from "../middleware/logger";
import {
  PayoutIntentService,
  payoutIntentService as defaultPayoutIntentService,
} from "../services/payoutIntent.service";
import { StellarService } from "../services/stellar.service";
import {
  DEFAULT_CURSOR_LIMIT,
  InvalidCursorError,
  MAX_CURSOR_LIMIT,
} from "../lib/cursorPagination";

const reconcileBodySchema = z.object({
  /** Skip intents touched more recently than this, so in-flight work is left alone. */
  olderThanMs: z.number().int().min(0).max(86_400_000).default(60_000),
  limit: z.number().int().min(1).max(500).default(100),
});

const listQuerySchema = z
  .object({
    status: z.enum(["PENDING", "SUBMITTED", "CONFIRMED", "FAILED"]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_CURSOR_LIMIT).default(DEFAULT_CURSOR_LIMIT),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "`from` must not be after `to`",
    path: ["from"],
  });

/**
 * Resolves a transaction hash against the chain.
 *
 * `NOT_FOUND` is deliberately distinct from `FAILED`: an RPC that has not yet
 * seen the transaction tells us nothing, and treating that as failure would
 * release the idempotency key while a payout may still be in flight.
 */
async function chainOutcome(
  stellar: Pick<StellarService, "getTransactionStatus">,
  txHash: string,
): Promise<"SUCCESS" | "FAILED" | "NOT_FOUND"> {
  try {
    const status = await stellar.getTransactionStatus(txHash);
    if (status === "SUCCESS") return "SUCCESS";
    if (status === "FAILED") return "FAILED";
    return "NOT_FOUND";
  } catch (err) {
    appLogger.warn({ err, txHash }, "Payout reconciliation could not reach the RPC");
    return "NOT_FOUND";
  }
}

/**
 * Admin routes for the payout idempotency ledger (issue #179).
 *
 * Reconciliation exists because a crash between submission and the DB commit
 * leaves an intent unresolved. Until the chain is consulted the key stays
 * claimed, so no retry can double-pay; this sweep is what eventually releases
 * or confirms it.
 */
export function createAdminPayoutsRouter(
  payoutIntents: Pick<
    PayoutIntentService,
    "reconcile" | "findUnresolved" | "findByKey" | "list"
  > =
    defaultPayoutIntentService,
  stellar: Pick<StellarService, "getTransactionStatus"> = new StellarService(),
): Router {
  const router = Router();

  router.use(authMiddleware, adminMiddleware);

  /**
   * GET /api/admin/payouts?status&from&to&cursor&limit
   * List payout intents newest first, so stuck or failed payouts are visible
   * without querying the database.
   */
  router.get("/api/admin/payouts", async (req: AuthRequest, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid query parameters",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const page = await payoutIntents.list(parsed.data);
      return res.json(page);
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        return res.status(400).json({ error: err.message });
      }
      appLogger.error({ err }, "Failed to list payout intents");
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/admin/payouts/reconcile
   * Resolve unresolved payout intents against the chain.
   */
  router.post(
    "/api/admin/payouts/reconcile",
    validateRequest({ body: reconcileBodySchema }),
    async (req: AuthRequest, res: Response) => {
      try {
        const { olderThanMs, limit } = reconcileBodySchema.parse(req.body);
        const result = await payoutIntents.reconcile(
          (txHash) => chainOutcome(stellar, txHash),
          { olderThanMs, limit },
        );
        appLogger.info(
          { actorAddress: req.user?.walletAddress, ...result },
          "Admin triggered payout reconciliation",
        );
        res.json(result);
      } catch (err) {
        appLogger.error({ err }, "Payout reconciliation failed");
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  /**
   * GET /api/admin/payouts/pending
   * List intents that have not reached a terminal state.
   */
  router.get("/api/admin/payouts/pending", async (_req: AuthRequest, res: Response) => {
    try {
      const intents = await payoutIntents.findUnresolved(0, 100);
      res.json({ intents });
    } catch (err) {
      appLogger.error({ err }, "Failed to list pending payout intents");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

export const adminPayoutsRoutes = createAdminPayoutsRouter();
