import { PrismaClient, TradeStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/db';
import { appLogger } from '../middleware/logger';
import { notificationQueue } from '../jobs/queue';
import { recordTradeFunnelEvent } from '../lib/metrics';

export interface SweepResult {
  scanned: number;
  expired: number;
  /** Expired trades that were FUNDED, so an escrow refund is owed. */
  refunded: number;
  errors: number;
}

/** Non-terminal statuses eligible for expiry sweep. */
const EXPIRABLE_STATUSES: TradeStatus[] = [
  TradeStatus.CREATED,
  TradeStatus.FUNDED,
  TradeStatus.PENDING_SIGNATURE,
];

export class TradeExpiryService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Scans for trades whose `expiresAt` has passed and whose status is still
   * non-terminal. Marks each as EXPIRED and enqueues buyer/seller notifications.
   * Idempotent: already-expired trades are skipped.
   */
  async sweepExpiredTrades(batchSize = 100): Promise<SweepResult> {
    const now = new Date();
    const result: SweepResult = { scanned: 0, expired: 0, refunded: 0, errors: 0 };

    const stale = await this.db.trade.findMany({
      where: {
        expiresAt: { lte: now },
        status: { in: EXPIRABLE_STATUSES },
        expiredAt: null,
      },
      take: batchSize,
      select: {
        id: true,
        tradeId: true,
        buyerAddress: true,
        sellerAddress: true,
        amountUsdc: true,
        status: true,
        version: true,
      },
      orderBy: { expiresAt: 'asc' },
    });

    result.scanned = stale.length;

    for (const trade of stale) {
      try {
        await this.db.trade.updateMany({
          where: {
            id: trade.id,
            version: trade.version,
            status: { in: EXPIRABLE_STATUSES },
          },
          data: {
            status: TradeStatus.EXPIRED,
            expiredAt: now,
            version: { increment: 1 },
          },
        });

        await Promise.all([
          notificationQueue.add('trade-expired-buyer', {
            userAddress: trade.buyerAddress,
            type: 'in_app',
            title: 'Trade Expired',
            message: `Trade ${trade.tradeId} has expired. A refund will be processed shortly.`,
            metadata: { tradeId: trade.tradeId, amountUsdc: trade.amountUsdc },
          }),
          notificationQueue.add('trade-expired-seller', {
            userAddress: trade.sellerAddress,
            type: 'in_app',
            title: 'Trade Expired',
            message: `Trade ${trade.tradeId} has expired and was not completed.`,
            metadata: { tradeId: trade.tradeId },
          }),
        ]);

        result.expired++;
        if (trade.status === TradeStatus.FUNDED) {
          result.refunded++;
        }
        recordTradeFunnelEvent("expired");
        appLogger.info({ tradeId: trade.tradeId, previousStatus: trade.status }, 'Trade expired by sweeper');
      } catch (err) {
        result.errors++;
        appLogger.error({ tradeId: trade.tradeId, err }, 'Sweeper failed to expire trade');
      }
    }

    return result;
  }

  /** Returns trades that have been marked EXPIRED but not yet refunded on-chain. */
  async getPendingRefunds(limit = 50) {
    return this.db.trade.findMany({
      where: { status: TradeStatus.EXPIRED },
      take: limit,
      orderBy: { expiredAt: 'asc' },
      select: {
        tradeId: true,
        buyerAddress: true,
        amountUsdc: true,
        expiredAt: true,
      },
    });
  }
}

export const tradeExpiryService = new TradeExpiryService();
