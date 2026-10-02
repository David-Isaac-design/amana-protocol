import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import {
  paginateWithCursor,
  normalizeCursorLimit,
  CURSOR_DEPRECATION_WARNING,
  InvalidCursorError,
} from "../lib/cursorPagination";
import { createWalletRateLimiter } from "../lib/rateLimit";

const webhookLogsParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "Webhook ID must be a numeric string"),
});

const webhookLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const redeliverParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "Webhook ID must be a numeric string"),
  attemptId: z.string().regex(/^\d+$/, "Attempt ID must be a numeric string"),
});

/** Rate-limit redeliver requests: max 10 per minute per wallet. */
const redeliverRateLimiter = createWalletRateLimiter({
  windowMs: 60_000,
  max: 10,
  message: "Too many redeliver requests, try again later.",
});

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

export function createWebhookLogsRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/webhooks/:id/logs",
    authMiddleware,
    validateRequest({ params: webhookLogsParamsSchema, query: webhookLogsQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const webhookId = Number(req.params.id);
        const { page, limit, cursor } = req.query as unknown as {
          page?: number;
          limit: number;
          cursor?: string;
        };

        const webhook = await prisma.webhook.findUnique({
          where: { id: webhookId },
          select: { userAddress: true },
        });

        if (!webhook) {
          res.status(404).json({ error: "Webhook not found" });
          return;
        }

        if (webhook.userAddress !== walletAddress) {
          res.status(403).json({ error: "Forbidden: you do not own this webhook" });
          return;
        }

        const select = {
          id: true,
          timestamp: true,
          status: true,
          statusCode: true,
          responseBody: true,
        } as const;

        // Legacy offset mode: engaged only when a caller still sends `page`
        // and no `cursor`. New/updated clients should use `cursor` instead.
        if (page !== undefined && !cursor) {
          const skip = (page - 1) * limit;
          const [attempts, total] = await Promise.all([
            prisma.webhookDeliveryAttempt.findMany({
              where: { webhookId },
              orderBy: { timestamp: "desc" },
              skip,
              take: limit,
              select,
            }),
            prisma.webhookDeliveryAttempt.count({ where: { webhookId } }),
          ]);

          res.setHeader("Warning", CURSOR_DEPRECATION_WARNING);
          res.status(200).json({
            attempts,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          });
          return;
        }

        const result = await paginateWithCursor({
          findMany: (args) =>
            prisma.webhookDeliveryAttempt.findMany({
              where: { webhookId },
              select,
              ...args,
            } as any),
          orderBy: [{ timestamp: "desc" }, { id: "desc" }],
          cursor,
          limit: normalizeCursorLimit(limit),
        });

        res.status(200).json({
          attempts: result.items,
          pageInfo: result.pageInfo,
        });
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          res.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  /**
   * POST /webhooks/:id/deliveries/:attemptId/redeliver
   *
   * Manually re-fires a previously failed delivery. Only the webhook owner
   * may call this endpoint. Redeliver is rate-limited per wallet address to
   * prevent abuse.
   *
   * The redelivery is recorded as a brand-new `WebhookDeliveryAttempt` row so
   * it appears in the delivery log alongside the original attempt.
   *
   * Issue #23.
   */
  router.post(
    "/webhooks/:id/deliveries/:attemptId/redeliver",
    authMiddleware,
    redeliverRateLimiter,
    validateRequest({ params: redeliverParamsSchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const webhookId = Number(req.params.id);
        const attemptId = Number(req.params.attemptId);

        // Verify webhook ownership
        const webhook = await prisma.webhook.findUnique({
          where: { id: webhookId },
          select: { userAddress: true, url: true, isActive: true },
        });

        if (!webhook) {
          res.status(404).json({ error: "Webhook not found" });
          return;
        }

        if (webhook.userAddress !== walletAddress) {
          res.status(403).json({ error: "Forbidden: you do not own this webhook" });
          return;
        }

        // Verify the original attempt belongs to this webhook
        const originalAttempt = await prisma.webhookDeliveryAttempt.findUnique({
          where: { id: attemptId },
          select: { id: true, webhookId: true, status: true },
        });

        if (!originalAttempt) {
          res.status(404).json({ error: "Delivery attempt not found" });
          return;
        }

        if (originalAttempt.webhookId !== webhookId) {
          res.status(404).json({ error: "Delivery attempt not found" });
          return;
        }

        // Dispatch the redeliver request to the webhook URL
        const payload = JSON.stringify({
          event: "webhook.redeliver",
          originalAttemptId: attemptId,
          webhookId,
          timestamp: new Date().toISOString(),
        });

        let statusCode = 0;
        let responseBody: string | null = null;
        let deliveryStatus = "failure";

        try {
          const response = await fetch(webhook.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          });
          statusCode = response.status;
          responseBody = await response.text().catch(() => null);
          deliveryStatus = response.ok ? "success" : "failure";
        } catch (dispatchError) {
          statusCode = 0;
          responseBody =
            dispatchError instanceof Error ? dispatchError.message : "dispatch error";
          deliveryStatus = "failure";
        }

        // Record the new attempt
        const newAttempt = await prisma.webhookDeliveryAttempt.create({
          data: {
            webhookId,
            status: deliveryStatus,
            statusCode,
            responseBody,
          },
          select: {
            id: true,
            timestamp: true,
            status: true,
            statusCode: true,
            responseBody: true,
          },
        });

        res.status(201).json({
          message: "Redelivery recorded",
          attempt: newAttempt,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
