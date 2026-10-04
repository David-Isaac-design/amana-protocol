import {
  webhookQueue,
  notificationQueue,
  exportQueue,
} from "../jobs/queue";
import {
  recordQueueDepth,
  recordQueueActive,
  recordQueueFailed,
} from "../lib/metrics";
import { appLogger } from "../middleware/logger";

/**
 * Monitors and records BullMQ queue metrics (depth, active, failed counts).
 * Called periodically to emit queue health metrics to Prometheus.
 */
export class QueueMetricsService {
  private metricsInterval: NodeJS.Timer | null = null;
  private readonly intervalMs: number = 30_000; // 30 seconds

  /**
   * Start the periodic metrics collection.
   * Call this during app bootstrap.
   */
  public start(): void {
    if (this.metricsInterval) {
      appLogger.warn("QueueMetricsService already running");
      return;
    }

    appLogger.info({ intervalMs: this.intervalMs }, "Starting queue metrics collection");

    // Emit metrics immediately, then on interval
    this.collectMetrics().catch((error) => {
      appLogger.error({ error }, "Failed to collect initial queue metrics");
    });

    this.metricsInterval = setInterval(
      () => {
        this.collectMetrics().catch((error) => {
          appLogger.error({ error }, "Failed to collect queue metrics");
        });
      },
      this.intervalMs,
    );
  }

  /**
   * Stop the periodic metrics collection.
   * Call this during graceful shutdown.
   */
  public stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
      appLogger.info("Stopped queue metrics collection");
    }
  }

  /**
   * Collect queue metrics for all monitored queues.
   * Queries each queue for depth, active, and failed counts.
   */
  private async collectMetrics(): Promise<void> {
    const queues = [
      { queue: webhookQueue, name: "webhooks" },
      { queue: notificationQueue, name: "notifications" },
      { queue: exportQueue, name: "exports" },
    ];

    for (const { queue, name } of queues) {
      try {
        const [depth, active, failed] = await Promise.all([
          queue.count(), // Waiting jobs
          queue.getActiveCount(), // Jobs currently being processed
          queue.getFailedCount(), // Jobs in the failed set
        ]);

        recordQueueDepth(name, depth);
        recordQueueActive(name, active);
        recordQueueFailed(name, failed);

        appLogger.debug(
          { queue: name, depth, active, failed },
          "Queue metrics recorded",
        );
      } catch (error) {
        appLogger.error(
          { error, queue: name },
          "Failed to collect metrics for queue",
        );
      }
    }
  }
}

export const queueMetricsService = new QueueMetricsService();
