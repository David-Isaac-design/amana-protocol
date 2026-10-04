import { Worker } from 'bullmq';
import { appLogger } from '../../middleware/logger';
import { createQueueConnection } from '../queue';
import { attachDeadLetterQueue } from '../deadLetter';
import { webhookService } from '../../services/webhook.service';

/** Drops previous webhook signing secrets once their rotation grace period has expired. */
export function createWebhookSecretPurgeWorker(): Worker {
  const worker = new Worker(
    'webhook-secret-purge',
    async () => {
      const purged = await webhookService.purgeExpiredPreviousSecrets();
      appLogger.info({ purged }, 'Expired webhook secrets purged');
      return { purged };
    },
    { connection: createQueueConnection() },
  );
  attachDeadLetterQueue(worker, 'webhook-secret-purge');
  return worker;
}
