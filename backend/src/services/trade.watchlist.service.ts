import { PrismaClient, TradeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import type { NotificationJobData } from "../jobs/queue";

export class WatchTradeNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Trade not found");
    this.name = "WatchTradeNotFoundError";
  }
}

export class WatchTradeAccessDeniedError extends Error {
  status = 403;
  constructor() {
    super("Forbidden");
    this.name = "WatchTradeAccessDeniedError";
  }
}

type WatchlistDatabase = Pick<
  PrismaClient,
  "trade" | "userWatchlist" | "notificationPreference"
>;

/** Status transitions watchers are told about. */
const WATCHED_TRANSITIONS: Partial<Record<TradeStatus, string>> = {
  [TradeStatus.FUNDED]: "funded",
  [TradeStatus.DELIVERED]: "delivered",
  [TradeStatus.DISPUTED]: "disputed",
  [TradeStatus.COMPLETED]: "completed",
};

export type WatcherNotificationEnqueue = (
  name: string,
  data: NotificationJobData,
  opts: { jobId: string },
) => Promise<unknown>;

/** Lazily bind to the BullMQ queue so importing this service never opens Redis. */
const enqueueToNotificationQueue: WatcherNotificationEnqueue = async (name, data, opts) => {
  const { notificationQueue } = await import("../jobs/queue");
  return notificationQueue.add(name, data, opts);
};

export class TradeWatchlistService {
  constructor(
    private readonly prisma: WatchlistDatabase = defaultPrisma,
    private readonly enqueue: WatcherNotificationEnqueue = enqueueToNotificationQueue,
  ) {}

  private async assertTradeAccess(tradeId: string, userAddress: string) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new WatchTradeNotFoundError();
    const caller = userAddress.toLowerCase();
    if (trade.buyerAddress.toLowerCase() !== caller && trade.sellerAddress.toLowerCase() !== caller) {
      throw new WatchTradeAccessDeniedError();
    }
    return trade;
  }

  async add(tradeId: string, userAddress: string) {
    const trade = await this.assertTradeAccess(tradeId, userAddress);
    const userAddressNormalized = userAddress.toLowerCase();
    const item = await this.prisma.userWatchlist.upsert({
      where: { userAddress_tradeId: { userAddress: userAddressNormalized, tradeId: trade.tradeId } },
      create: { userAddress: userAddressNormalized, tradeId: trade.tradeId },
      update: {},
    });
    return item;
  }

  async remove(tradeId: string, userAddress: string) {
    // Verify ownership even when no bookmark exists, avoiding a delete endpoint
    // that can be used to probe unrelated trades.
    const trade = await this.assertTradeAccess(tradeId, userAddress);
    const result = await this.prisma.userWatchlist.deleteMany({
      where: { userAddress: userAddress.toLowerCase(), tradeId: trade.tradeId },
    });
    return { removed: result.count > 0 };
  }

  async list(userAddress: string) {
    const entries = await this.prisma.userWatchlist.findMany({
      where: { userAddress: userAddress.toLowerCase() },
      include: { trade: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return entries.map(({ trade, createdAt }) => ({ ...trade, watchedAt: createdAt }));
  }

  /**
   * Enqueue one in-app notification per watcher of `tradeId` for a status
   * transition (funded, delivered, disputed, completed).
   *
   * - Preferences: a watcher who has an explicit `trade_<status>` preference
   *   that does not include "in-app" is skipped; with no preference set the
   *   default is to notify.
   * - Exactly once: the job id is derived from (trade, status, watcher), so a
   *   replayed or retried event cannot enqueue a second notification.
   *
   * Returns the number of notifications enqueued.
   */
  async notifyWatchers(
    tradeId: string,
    status: TradeStatus,
    metadata: Record<string, unknown> = {},
  ): Promise<number> {
    const label = WATCHED_TRANSITIONS[status];
    if (!label) return 0;

    const watchers = await this.prisma.userWatchlist.findMany({
      where: { tradeId },
      select: { userAddress: true },
    });
    if (watchers.length === 0) return 0;

    const addresses = [...new Set(watchers.map((w) => w.userAddress))];
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userAddress: { in: addresses } },
      select: { userAddress: true, preferences: true },
    });
    const preferencesByUser = new Map(stored.map((p) => [p.userAddress, p.preferences]));
    const preferenceKey = `trade_${label}`;

    let enqueued = 0;
    for (const userAddress of addresses) {
      const prefs = preferencesByUser.get(userAddress) as Record<string, unknown> | undefined;
      const channels = prefs?.[preferenceKey];
      if (Array.isArray(channels) && !channels.includes("in-app")) continue;

      await this.enqueue(
        "watched-trade-status",
        {
          userAddress,
          type: "in_app",
          title: `Watched trade ${label}`,
          message: `Trade ${tradeId} is now ${label}.`,
          metadata: { ...metadata, tradeId, status, watched: true },
        },
        { jobId: `watch-${tradeId}-${status}-${userAddress}` },
      );
      enqueued++;
    }

    appLogger.info({ tradeId, status, enqueued }, "[Watchlist] Notified watchers");
    return enqueued;
  }
}
