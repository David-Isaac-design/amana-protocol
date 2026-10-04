import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { prisma } from "../lib/db";
import { TradeStatus } from "@prisma/client";

interface WebhookPayload {
  event: string;
  tradeId: string;
  status: TradeStatus;
  timestamp: string;
  data: Record<string, unknown>;
}

interface DeliveryTarget {
  url: string;
  secret?: string;
  previousSecret?: string;
  subscriptionId?: number | null;
}

const sign = (secret: string, body: string) =>
  crypto.createHmac("sha256", secret).update(body).digest("hex");

/** Builds `v1=<sig>` entries for the current secret and, during the grace window, the previous one. */
export function buildSignatureHeader(
  body: string,
  secret: string,
  previousSecret?: string,
): string {
  return [secret, previousSecret]
    .filter((s): s is string => !!s)
    .map((s) => `v1=${sign(s, body)}`)
    .join(",");
}

export class WebhookService {
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor() {
    this.webhookUrl = env.WEBHOOK_URL;
    this.webhookSecret = env.WEBHOOK_SECRET;
    this.maxAttempts = env.WEBHOOK_MAX_ATTEMPTS;
    this.retryBaseMs = env.WEBHOOK_RETRY_BASE_MS;
    this.retryMaxMs = env.WEBHOOK_RETRY_MAX_MS;
  }

  async dispatch(tradeId: string, status: TradeStatus, metadata: Record<string, unknown> = {}): Promise<void> {
    const event = `trade.${status.toLowerCase()}`;
    const activeSubscriptions = await prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        events: { has: event },
      },
      select: {
        id: true,
        url: true,
        secretHash: true,
        previousSecretHash: true,
        previousSecretExpiresAt: true,
      },
    });

    const now = new Date();

    const deliveryTargets: DeliveryTarget[] = activeSubscriptions.map((subscription) => ({
      url: subscription.url,
      secret: subscription.secretHash,
      previousSecret:
        subscription.previousSecretHash &&
        subscription.previousSecretExpiresAt &&
        subscription.previousSecretExpiresAt > now
          ? subscription.previousSecretHash
          : undefined,
      subscriptionId: subscription.id,
    }));

    if (this.webhookUrl) {
      deliveryTargets.push({
        url: this.webhookUrl,
        secret: this.webhookSecret,
        subscriptionId: null,
      });
    }

    if (deliveryTargets.length === 0) {
      return;
    }

    const payload: WebhookPayload = {
      event,
      tradeId,
      status,
      timestamp: new Date().toISOString(),
      data: metadata,
    };

    const body = JSON.stringify(payload);

    await Promise.allSettled(
      deliveryTargets.map((target) => this.sendWebhookWithRetry(target, body, tradeId, status)),
    );
  }

  private async sendWebhookWithRetry(
    target: DeliveryTarget,
    body: string,
    tradeId: string,
    status: TradeStatus,
  ): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const signature = target.secret
          ? sign(target.secret, body)
          : undefined;
        const signatures = target.secret
          ? buildSignatureHeader(body, target.secret, target.previousSecret)
          : undefined;

        const response = await fetch(target.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(signature ? { "X-Webhook-Signature": signature } : {}),
            ...(signatures ? { "X-Webhook-Signatures": signatures } : {}),
          },
          body,
        });

        if (response.ok) {
          appLogger.debug(
            {
              tradeId,
              status,
              webhookUrl: target.url,
              subscriptionId: target.subscriptionId,
              attempt,
            },
            "Webhook dispatched successfully",
          );
          return;
        }

        const shouldRetry = response.status >= 500 || response.status === 429;
        appLogger.warn(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            statusCode: response.status,
            attempt,
            shouldRetry,
          },
          "Webhook delivery returned non-OK status",
        );

        if (!shouldRetry || attempt === this.maxAttempts) {
          return;
        }
      } catch (error) {
        lastError = error;
        appLogger.warn(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            attempt,
            error,
          },
          "Webhook delivery attempt failed",
        );
      }

      if (attempt < this.maxAttempts) {
        const delay = Math.min(this.retryBaseMs * 2 ** (attempt - 1), this.retryMaxMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    appLogger.error(
      {
        tradeId,
        status,
        webhookUrl: target.url,
        subscriptionId: target.subscriptionId,
        error: lastError,
      },
      "Webhook delivery failed after retries",
    );
  }

  /** Drops previous secrets whose grace period has ended. Returns the number cleared. */
  async purgeExpiredPreviousSecrets(now: Date = new Date()): Promise<number> {
    const { count } = await prisma.webhookSubscription.updateMany({
      where: { previousSecretExpiresAt: { lte: now } },
      data: { previousSecretHash: null, previousSecretExpiresAt: null },
    });
    return count;
  }

  isConfigured(): boolean {
    return !!this.webhookUrl;
  }
}

export const webhookService = new WebhookService();
