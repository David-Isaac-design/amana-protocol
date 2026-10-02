import { Worker, Job } from 'bullmq';
import { appLogger } from '../../middleware/logger';
import { createQueueConnection, WebhookPurgeJobData } from '../queue';
import { prisma } from '../../lib/db';
import { attachDeadLetterQueue } from '../deadLetter';
import { jobHeartbeatService, JobType } from '../../services/jobHeartbeat.service';

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;

/**
 * Deletes WebhookDeliveryAttempt rows older than the configured retention period.
 * Rows are deleted in batches to avoid long table locks.
 */
export function createWebhookPurgeWorker(): Worker<WebhookPurgeJobData> {
  const worker = new Worker<WebhookPurgeJobData>(
    'webhook-purge',
    async (job: Job<WebhookPurgeJobData>) => {
      const retentionDays =
        job.data.retentionDays ??
        (process.env.WEBHOOK_DELIVERY_RETENTION_DAYS
          ? parseInt(process.env.WEBHOOK_DELIVERY_RETENTION_DAYS, 10)
          : DEFAULT_RETENTION_DAYS);

      const batchSize = job.data.batchSize ?? DEFAULT_BATCH_SIZE;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      appLogger.info(
        { jobId: job.id, retentionDays, batchSize, cutoffDate },
        'Webhook delivery attempt purge started',
      );

      await jobHeartbeatService.ping(JobType.WEBHOOK_PURGE, { status: 'started' });

      let totalDeleted = 0;

      // Batch delete to avoid long table locks
      while (true) {
        const batch = await prisma.webhookDeliveryAttempt.findMany({
          where: { timestamp: { lt: cutoffDate } },
          select: { id: true },
          take: batchSize,
        });

        if (batch.length === 0) break;

        const ids = batch.map((r) => r.id);
        const { count } = await prisma.webhookDeliveryAttempt.deleteMany({
          where: { id: { in: ids } },
        });

        totalDeleted += count;
        appLogger.debug({ count, totalDeleted }, 'Webhook purge batch deleted');
      }

      appLogger.info(
        { jobId: job.id, totalDeleted, retentionDays },
        'Webhook delivery attempt purge completed',
      );

      await jobHeartbeatService.ping(JobType.WEBHOOK_PURGE, {
        status: 'completed',
        result: { totalDeleted, retentionDays },
      });

      return { totalDeleted, retentionDays };
    },
    { connection: createQueueConnection() },
  );

  attachDeadLetterQueue(worker, 'webhook-purge');
  return worker;
}
