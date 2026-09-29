import { Worker, Job } from 'bullmq';
import { appLogger } from '../../middleware/logger';
import { createQueueConnection } from '../queue';
import { tradeExpiryService } from '../../services/tradeExpiry.service';
import { attachDeadLetterQueue } from '../deadLetter';
import { recordTradeExpirySweep } from '../../lib/metrics';

export interface TradeExpirySweepJobData {
  batchSize?: number;
}

export async function processTradeExpirySweep(job: Job<TradeExpirySweepJobData>) {
  const { batchSize = 100 } = job.data;
  appLogger.info({ jobId: job.id, batchSize }, 'Trade expiry sweep started');
  const startedAt = Date.now();
  try {
    const result = await tradeExpiryService.sweepExpiredTrades(batchSize);
    recordTradeExpirySweep({
      swept: result.expired,
      refunded: result.refunded,
      failed: result.errors,
      durationMs: Date.now() - startedAt,
      status: 'success',
    });
    appLogger.info({ jobId: job.id, ...result }, 'Trade expiry sweep completed');
    return result;
  } catch (err) {
    recordTradeExpirySweep({
      swept: 0,
      refunded: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      status: 'error',
    });
    throw err;
  }
}

export function createTradeExpiryWorker(): Worker<TradeExpirySweepJobData> {
  const worker = new Worker<TradeExpirySweepJobData>(
    'trade-expiry',
    processTradeExpirySweep,
    { connection: createQueueConnection() },
  );
  attachDeadLetterQueue(worker, 'trade-expiry');
  return worker;
}
