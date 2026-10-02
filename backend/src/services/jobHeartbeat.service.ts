/**
 * Job Heartbeat Service
 * 
 * Tracks and monitors scheduled job execution status.
 * Jobs ping heartbeats before/after execution; watchdog detects missed beats.
 */

import { prisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { alertService } from "./alert.service";

export enum JobType {
  RECONCILIATION = "reconciliation",
  TRADE_EXPIRY = "trade-expiry",
  WEBHOOK = "webhook",
  NOTIFICATION = "notification",
  EXPORT = "export",
  OUTBOX_SCAN = "outbox-consistency-scan",
  STREAM_CLAWBACK_MONITOR = "stream-clawback-monitor",
  WEBHOOK_PURGE = "webhook-purge",
}

export interface HeartbeatPingData {
  status: "started" | "completed" | "failed";
  result?: Record<string, unknown>;
  error?: string;
  duration?: number; // milliseconds
}

export interface JobHealthStatus {
  jobType: JobType;
  status: "healthy" | "stale" | "failed" | "unknown";
  lastHeartbeat: Date;
  nextExpectedAt: Date;
  timeSinceLastBeat: number; // milliseconds
  failureCount: number;
  isOverdue: boolean;
}

/**
 * Job configurations with heartbeat intervals
 */
export const JOB_CONFIGS: Record<JobType, { intervalMs: number; description: string }> = {
  [JobType.RECONCILIATION]: {
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    description: "Daily ledger reconciliation sweep",
  },
  [JobType.TRADE_EXPIRY]: {
    intervalMs: 60 * 60 * 1000, // 1 hour
    description: "Hourly trade expiry checker",
  },
  [JobType.WEBHOOK]: {
    intervalMs: 5 * 60 * 1000, // 5 minutes
    description: "Webhook delivery worker",
  },
  [JobType.NOTIFICATION]: {
    intervalMs: 5 * 60 * 1000, // 5 minutes
    description: "Notification dispatch worker",
  },
  [JobType.EXPORT]: {
    intervalMs: 10 * 60 * 1000, // 10 minutes
    description: "Data export worker",
  },
  [JobType.OUTBOX_SCAN]: {
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    description: "Outbox consistency verification scan",
  },
  [JobType.STREAM_CLAWBACK_MONITOR]: {
    intervalMs: 60 * 60 * 1000, // 1 hour
    description: "Stream clawback monitoring job",
  },
  [JobType.WEBHOOK_PURGE]: {
    intervalMs: 24 * 60 * 60 * 1000, // 24 hours
    description: "Daily purge of old WebhookDeliveryAttempt rows",
  },
};

/**
 * Grace period after expected time before alert (milliseconds)
 * Accounts for clock skew, network delays, etc.
 */
const HEARTBEAT_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

export class JobHeartbeatService {
  /**
   * Initialize heartbeat registry for all known job types
   * Call this during application startup
   */
  async initializeJobRegistry(): Promise<void> {
    appLogger.info("[JobHeartbeat] Initializing registry");

    for (const [jobType, config] of Object.entries(JOB_CONFIGS)) {
      try {
        const existing = await prisma.jobHeartbeat.findUnique({
          where: { jobType },
        });

        if (!existing) {
          const nextExpectedAt = new Date(Date.now() + config.intervalMs);
          await prisma.jobHeartbeat.create({
            data: {
              jobType,
              lastHeartbeat: new Date(),
              status: "idle",
              intervalMs: config.intervalMs,
              nextExpectedAt,
              notes: config.description,
            },
          });
          appLogger.debug({ jobType }, "[JobHeartbeat] Registered new job");
        } else {
          // Ensure interval is updated
          if (existing.intervalMs !== config.intervalMs) {
            await prisma.jobHeartbeat.update({
              where: { jobType },
              data: { intervalMs: config.intervalMs },
            });
          }
        }
      } catch (error) {
        appLogger.error(
          { jobType, error },
          "[JobHeartbeat] Failed to initialize job",
        );
      }
    }

    appLogger.info(
      { count: Object.keys(JOB_CONFIGS).length },
      "[JobHeartbeat] Registry initialization complete",
    );
  }

  /**
   * Ping heartbeat for a job
   * Called at the start and end of job execution
   */
  async ping(jobType: JobType, data: HeartbeatPingData): Promise<void> {
    try {
      const config = JOB_CONFIGS[jobType];
      if (!config) {
        appLogger.warn({ jobType }, "[JobHeartbeat] Unknown job type");
        return;
      }

      const nextExpectedAt = new Date(Date.now() + config.intervalMs);

      const heartbeat = await prisma.jobHeartbeat.upsert({
        where: { jobType },
        create: {
          jobType,
          lastHeartbeat: new Date(),
          status: data.status === "completed" ? "idle" : data.status,
          intervalMs: config.intervalMs,
          nextExpectedAt,
          notes: config.description,
          failureCount: data.status === "failed" ? 1 : 0,
          lastError: data.error,
        },
        update: {
          lastHeartbeat: new Date(),
          status: data.status === "completed" ? "idle" : data.status,
          nextExpectedAt,
          failureCount:
            data.status === "failed"
              ? { increment: 1 }
              : 0,
          lastError: data.error || null,
          lastCheckedAt: new Date(),
        },
      });

      appLogger.debug(
        {
          jobType,
          status: data.status,
          duration: data.duration,
        },
        "[JobHeartbeat] Ping recorded",
      );

      // Alert on repeated failures
      if (heartbeat.failureCount > 3) {
        await alertService.dispatch(
          "job_repeated_failures",
          `Job ${jobType} has failed ${heartbeat.failureCount} times`,
          {
            jobType,
            failureCount: heartbeat.failureCount,
            lastError: data.error,
          },
        );
      }
    } catch (error) {
      appLogger.error(
        { jobType, error },
        "[JobHeartbeat] Failed to record ping",
      );
    }
  }

  /**
   * Check health of all jobs
   * Returns which jobs are healthy, stale, or overdue
   */
  async checkAllJobHealth(): Promise<{
    healthy: JobHealthStatus[];
    stale: JobHealthStatus[];
    overdue: JobHealthStatus[];
  }> {
    const heartbeats = await prisma.jobHeartbeat.findMany();

    const healthy: JobHealthStatus[] = [];
    const stale: JobHealthStatus[] = [];
    const overdue: JobHealthStatus[] = [];
    const now = Date.now();

    for (const hb of heartbeats) {
      const timeSinceLastBeat = now - hb.lastHeartbeat.getTime();
      const isOverdue = hb.nextExpectedAt.getTime() < now;
      const timeSinceExpected =
        now - hb.nextExpectedAt.getTime();

      let status: "healthy" | "stale" | "failed" | "unknown" =
        "unknown";

      if (hb.status === "failed" || hb.failureCount > 0) {
        status = "failed";
      } else if (isOverdue && timeSinceExpected > HEARTBEAT_GRACE_PERIOD_MS) {
        status = "failed"; // Treat overdue as failed for health status
      } else if (timeSinceLastBeat > hb.intervalMs + HEARTBEAT_GRACE_PERIOD_MS) {
        status = "stale";
      } else {
        status = "healthy";
      }

      const healthStatus: JobHealthStatus = {
        jobType: hb.jobType as JobType,
        status,
        lastHeartbeat: hb.lastHeartbeat,
        nextExpectedAt: hb.nextExpectedAt,
        timeSinceLastBeat,
        failureCount: hb.failureCount,
        isOverdue,
      };

      if (status === "healthy") {
        healthy.push(healthStatus);
      } else if (status === "stale") {
        stale.push(healthStatus);
      } else if (status === "failed" || isOverdue) {
        overdue.push(healthStatus);
      }
    }

    // Log results
    appLogger.info(
      {
        healthy: healthy.length,
        stale: stale.length,
        overdue: overdue.length,
      },
      "[JobHeartbeat] Health check complete",
    );

    return { healthy, stale, overdue };
  }

  /**
   * Watchdog alert function
   * Should be called periodically (e.g., every 2 minutes) by a scheduler
   * Triggers alerts for missed/stale heartbeats
   */
  async watchdogCheck(): Promise<void> {
    try {
      const health = await this.checkAllJobHealth();

      // Alert on overdue jobs (highest priority)
      if (health.overdue.length > 0) {
        for (const job of health.overdue) {
          const timeSinceExpected =
            Date.now() - job.nextExpectedAt.getTime();
          const severity =
            timeSinceExpected > 30 * 60 * 1000
              ? "critical"
              : "warning"; // > 30 mins = critical

          await alertService.dispatch(
            "job_missed_heartbeat",
            `Job ${job.jobType} missed its scheduled heartbeat by ${Math.floor(timeSinceExpected / 60000)} minutes`,
            {
              jobType: job.jobType,
              severity,
              lastHeartbeat: job.lastHeartbeat.toISOString(),
              expectedAt: job.nextExpectedAt.toISOString(),
              minutesOverdue: Math.floor(timeSinceExpected / 60000),
              failureCount: job.failureCount,
            },
          );

          appLogger.error(
            {
              jobType: job.jobType,
              severity,
              minutesOverdue: Math.floor(
                timeSinceExpected / 60000,
              ),
            },
            "[JobHeartbeat] Watchdog: Job overdue alert",
          );
        }
      }

      // Warn on stale jobs (job not recently pinged but not overdue yet)
      if (health.stale.length > 0) {
        appLogger.warn(
          { count: health.stale.length, jobs: health.stale.map((j) => j.jobType) },
          "[JobHeartbeat] Watchdog: Stale jobs detected",
        );
      }
    } catch (error) {
      appLogger.error({ error }, "[JobHeartbeat] Watchdog check failed");
    }
  }

  /**
   * Get health status for a specific job
   */
  async getJobHealth(jobType: JobType): Promise<JobHealthStatus | null> {
    const heartbeat = await prisma.jobHeartbeat.findUnique({
      where: { jobType },
    });

    if (!heartbeat) return null;

    const now = Date.now();
    const timeSinceLastBeat = now - heartbeat.lastHeartbeat.getTime();
    const isOverdue = heartbeat.nextExpectedAt.getTime() < now;

    let status: "healthy" | "stale" | "failed" | "unknown" = "unknown";
    if (heartbeat.status === "failed" || heartbeat.failureCount > 0) {
      status = "failed";
    } else if (
      isOverdue &&
      now - heartbeat.nextExpectedAt.getTime() > HEARTBEAT_GRACE_PERIOD_MS
    ) {
      status = "failed"; // Treat overdue as failed
    } else if (timeSinceLastBeat > heartbeat.intervalMs + HEARTBEAT_GRACE_PERIOD_MS) {
      status = "stale";
    } else {
      status = "healthy";
    }

    return {
      jobType: heartbeat.jobType as JobType,
      status,
      lastHeartbeat: heartbeat.lastHeartbeat,
      nextExpectedAt: heartbeat.nextExpectedAt,
      timeSinceLastBeat,
      failureCount: heartbeat.failureCount,
      isOverdue,
    };
  }

  /**
   * Get all job health statuses
   */
  async getAllJobHealth(): Promise<JobHealthStatus[]> {
    const health = await this.checkAllJobHealth();
    return [...health.healthy, ...health.stale, ...health.overdue];
  }
}

export const jobHeartbeatService = new JobHeartbeatService();
